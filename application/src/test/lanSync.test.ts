import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteMeta,
  getPlayHistory,
  getVodWatchlistFromDB,
  toggleVodWatchlist,
} from '@/utils/idb';
import {
  getOrCreateLanSyncToken,
  getSyncedPeers,
  normalizeSyncUrl,
  removeSyncedPeer,
  syncAllPairedPeers,
  syncWithPeer,
} from '@/utils/lanSync';
import { SYNC_FORMAT, SYNC_VERSION, type SyncPayload } from '@/utils/syncPayload';

beforeEach(async () => {
  localStorage.clear();
  vi.restoreAllMocks();
  await Promise.all([
    deleteMeta('playHistory'),
    deleteMeta('vod_watchlist'),
    deleteMeta('vod_watchlist_tombstones'),
    deleteMeta('sync_device_id'),
    deleteMeta('sync_lan_token'),
    deleteMeta('sync_lan_peers'),
  ]);
});

describe('lanSync — normalisation, jeton et échange pair-à-pair', () => {
  it('normalise les URL HTTP et les liens cedplay://sync', () => {
    expect(normalizeSyncUrl('http://192.168.1.42:48123/sync/abcd2345efgh')).toBe(
      'http://192.168.1.42:48123/sync/abcd2345efgh',
    );
    expect(normalizeSyncUrl('192.168.1.42:48123/sync/abcd2345efgh')).toBe(
      'http://192.168.1.42:48123/sync/abcd2345efgh',
    );
    expect(
      normalizeSyncUrl(
        'cedplay://sync?url=http%3A%2F%2F192.168.1.42%3A48123%2Fsync%2Fabcd2345efgh',
      ),
    ).toBe('http://192.168.1.42:48123/sync/abcd2345efgh');
    expect(normalizeSyncUrl('http://192.168.1.42:48123/autre/chemin')).toBeNull();
    expect(normalizeSyncUrl('http://192.168.1.42:48123/sync/court')).toBeNull();
  });

  it('génère et persiste un jeton LAN valide', async () => {
    const t1 = await getOrCreateLanSyncToken();
    const t2 = await getOrCreateLanSyncToken();
    expect(t1).toMatch(/^[a-z0-9]{16}$/);
    expect(t2).toBe(t1);
  });

  it('synchronise avec un pair distant, applique la fusion et mémorise le pair', async () => {
    await toggleVodWatchlist({ id: '1', name: 'Film Local', kind: 'movie', playlistId: 'p1' });

    const remoteMerged: SyncPayload = {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      deviceId: 'tv-salon',
      exportedAt: Date.now(),
      vodHistory: [
        {
          channelId: 'vod:p1:movie:2',
          kind: 'vod',
          name: 'Film TV',
          ts: Date.now(),
          positionMs: 420000,
          durationMs: 5400000,
          status: 'started',
        },
      ],
      vodProgress: {
        'p1:movie:2': { positionMs: 420000, durationMs: 5400000, updatedAt: Date.now() },
      },
      watchlist: [
        { id: '1', name: 'Film Local', kind: 'movie', playlistId: 'p1', addedAt: Date.now() - 1000 },
        { id: '2', name: 'Film TV', kind: 'movie', playlistId: 'p1', addedAt: Date.now() },
      ],
      watchlistTombstones: {},
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(remoteMerged), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const summary = await syncWithPeer('http://192.168.1.50:48123/sync/abcd2345efgh', 'TV Salon');
    expect(summary.changed).toBe(true);
    expect(summary.watchlistCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const history = await getPlayHistory();
    expect(history.find(h => h.channelId === 'vod:p1:movie:2')?.positionMs).toBe(420000);
    const watchlist = await getVodWatchlistFromDB();
    expect(watchlist.map(w => w.id).sort()).toEqual(['1', '2']);

    const peers = await getSyncedPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]?.label).toBe('TV Salon');
    expect(peers[0]?.lastSyncedAt).toBeGreaterThan(0);

    await removeSyncedPeer(peers[0]!.url);
    expect(await getSyncedPeers()).toEqual([]);
  });

  it('syncAllPairedPeers ignore les pairs hors ligne sans lever d’exception', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            format: SYNC_FORMAT,
            version: SYNC_VERSION,
            deviceId: 'tv-1',
            exportedAt: Date.now(),
            vodHistory: [],
            vodProgress: {},
            watchlist: [],
            watchlistTombstones: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockRejectedValueOnce(new Error('Network unreachable'));

    // Enregistre deux pairs
    await syncWithPeer('http://192.168.1.50:48123/sync/abcd2345efgh', 'TV 1');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Offline'));
    // Simule un second pair déjà mémorisé en passant par le storage meta via syncWithPeer puis reset
    await expect(
      syncWithPeer('http://192.168.1.51:48123/sync/wxyz2345efgh', 'TV 2'),
    ).rejects.toThrow();

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
    const res = await syncAllPairedPeers();
    expect(res.succeeded).toBe(0);
    expect(res.failed).toBe(1);
  });

  it('préserve les modifications locales effectuées pendant l’attente réseau de syncWithPeer', async () => {
    await toggleVodWatchlist({ id: '1', name: 'Film Initial', kind: 'movie', playlistId: 'p1' });

    let releaseFetch!: (res: Response) => void;
    const pendingFetch = new Promise<Response>(resolve => {
      releaseFetch = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pendingFetch);

    const syncPromise = syncWithPeer('http://192.168.1.50:48123/sync/abcd2345efgh', 'TV Salon');

    // Laisser la requête réseau démarrer puis modifier localement pendant l'attente
    await new Promise(resolve => setTimeout(resolve, 20));
    await toggleVodWatchlist({ id: '99', name: 'Ajout Pendant Réseau', kind: 'movie', playlistId: 'p1' });
    localStorage.setItem(
      'vod_progress_p1:movie:99',
      JSON.stringify({ positionMs: 300_000, durationMs: 5_000_000, updatedAt: Date.now() }),
    );

    const remoteMerged: SyncPayload = {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      deviceId: 'tv-salon',
      exportedAt: Date.now(),
      vodHistory: [],
      vodProgress: {
        'p1:movie:2': { positionMs: 120_000, durationMs: 4_000_000, updatedAt: Date.now() },
      },
      watchlist: [
        { id: '1', name: 'Film Initial', kind: 'movie', playlistId: 'p1', addedAt: 1000 },
        { id: '2', name: 'Film TV', kind: 'movie', playlistId: 'p1', addedAt: Date.now() },
      ],
      watchlistTombstones: {},
    };
    releaseFetch(
      new Response(JSON.stringify(remoteMerged), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await syncPromise;
    const watchlist = await getVodWatchlistFromDB();
    expect(watchlist.map(w => w.id).sort()).toEqual(['1', '2', '99']);
    expect(JSON.parse(localStorage.getItem('vod_progress_p1:movie:99') || '{}').positionMs).toBe(300_000);
    expect(JSON.parse(localStorage.getItem('vod_progress_p1:movie:2') || '{}').positionMs).toBe(120_000);
  });
});
