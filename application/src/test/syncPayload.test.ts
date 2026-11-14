import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteMeta,
  getPlayHistory,
  getSettingsFromDB,
  getVodWatchlistFromDB,
  getVodWatchlistTombstonesFromDB,
  manageContinueEntry,
  pushPlayHistory,
  saveSettingsToDB,
  toggleVodWatchlist,
} from '@/utils/idb';
import {
  applyMergedSyncPayload,
  buildLocalCatalogRemapIndex,
  buildLocalSyncPayload,
  computeXtreamProviderKey,
  mergeSyncPayloads,
  mergeVodHistory,
  mergeVodProgress,
  mergeWatchlist,
  parseSyncPayload,
  remapSyncPayloadToLocal,
  SYNC_FORMAT,
  SYNC_VERSION,
  type SyncPayload,
} from '@/utils/syncPayload';

beforeEach(async () => {
  localStorage.clear();
  await Promise.all([
    deleteMeta('playHistory'),
    deleteMeta('vod_watchlist'),
    deleteMeta('vod_watchlist_tombstones'),
    deleteMeta('sync_device_id'),
    deleteMeta('settings'),
  ]);
});

describe('syncPayload — validation et fusion déterministe', () => {
  it('valide un payload conforme et rejette les structures invalides ou trop profondes', () => {
    const valid = parseSyncPayload({
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      deviceId: 'device-1234',
      exportedAt: 1700000000000,
      vodHistory: [],
      vodProgress: {},
      watchlist: [],
      watchlistTombstones: {},
    });
    expect(valid.deviceId).toBe('device-1234');

    expect(() => parseSyncPayload({ format: 'autre', version: 1 })).toThrow();
    expect(() =>
      parseSyncPayload({
        format: SYNC_FORMAT,
        version: SYNC_VERSION,
        deviceId: 'device-1234',
        exportedAt: 1,
        vodHistory: [],
        vodProgress: {},
        watchlist: [],
        watchlistTombstones: {},
        settings: { theme: 'dark' },
      }),
    ).toThrow();
  });

  it('fusionne vodHistory en gardant la mise à jour la plus récente et en conservant les métadonnées manquantes', () => {
    const merged = mergeVodHistory(
      [
        {
          channelId: 'vod:p1:movie:10',
          kind: 'vod',
          name: 'Dune',
          poster: 'https://img/dune.jpg',
          tmdbId: 438631,
          ts: 1000,
          positionMs: 120000,
          durationMs: 7200000,
          status: 'started',
        },
      ],
      [
        {
          channelId: 'vod:p1:movie:10',
          kind: 'vod',
          ts: 2000,
          positionMs: 650000,
          durationMs: 7200000,
          status: 'started',
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      channelId: 'vod:p1:movie:10',
      ts: 2000,
      positionMs: 650000,
      poster: 'https://img/dune.jpg',
      tmdbId: 438631,
    });
  });

  it('à ts égal, préfère completed à started dans vodHistory', () => {
    const merged = mergeVodHistory(
      [{ channelId: 'vod:p1:movie:1', kind: 'vod', ts: 5000, status: 'started', positionMs: 500 }],
      [{ channelId: 'vod:p1:movie:1', kind: 'vod', ts: 5000, status: 'completed', positionMs: 500 }],
    );
    expect(merged[0]?.status).toBe('completed');
  });

  it('nettoie vodProgress si vodHistory indique completed plus récemment', () => {
    const history = mergeVodHistory(
      [],
      [{ channelId: 'vod:p1:movie:42', kind: 'vod', ts: 3000, status: 'completed', positionMs: 7190000, durationMs: 7200000 }],
    );
    const progress = mergeVodProgress(
      { 'p1:movie:42': { positionMs: 500000, durationMs: 7200000, updatedAt: 2000 } },
      { 'p1:movie:42': { positionMs: 900000, durationMs: 7200000, updatedAt: 2500 } },
      history,
    );
    expect(progress['p1:movie:42']).toBeUndefined();
  });

  it('gère les tombstones de Ma liste : une suppression plus récente l’emporte, un ré-ajout plus récent restaure', () => {
    const now = 1_700_000_000_000;
    const item = { id: '55', name: 'Severance', kind: 'series' as const, playlistId: 'p1', addedAt: now - 10_000 };

    // Appareil A a supprimé à now - 5000 ; Appareil B l'avait ajouté à now - 10000
    const afterDelete = mergeWatchlist(
      [],
      { 'p1:series:55': now - 5_000 },
      [item],
      {},
      now,
    );
    expect(afterDelete.watchlist).toEqual([]);
    expect(afterDelete.watchlistTombstones['p1:series:55']).toBe(now - 5_000);

    // Appareil B le ré-ajoute à now - 1000 (> tombstone à now - 5000)
    const afterReAdd = mergeWatchlist(
      [],
      { 'p1:series:55': now - 5_000 },
      [{ ...item, addedAt: now - 1_000 }],
      {},
      now,
    );
    expect(afterReAdd.watchlist).toHaveLength(1);
    expect(afterReAdd.watchlistTombstones['p1:series:55']).toBeUndefined();
  });

  it('applique la fusion localement sans toucher à l’historique live ni aux réglages appareil', async () => {
    await saveSettingsToDB({ theme: 'dark', compactMode: true } as never);
    await pushPlayHistory({ channelId: 'live-tf1', ts: 9999, kind: 'live', name: 'TF1' });
    await pushPlayHistory({
      channelId: 'vod:p1:movie:7',
      kind: 'vod',
      name: 'Matrix',
      ts: 1000,
      positionMs: 100000,
      durationMs: 6000000,
      status: 'started',
    });
    localStorage.setItem('vod_progress_p1:movie:7', JSON.stringify({ positionMs: 100000, durationMs: 6000000, updatedAt: 1000 }));

    await toggleVodWatchlist({ id: '99', name: 'Andor', kind: 'series', playlistId: 'p1' });
    const removed = await toggleVodWatchlist({ id: '99', name: 'Andor', kind: 'series', playlistId: 'p1' });
    expect(removed).toBe(false);

    const localPayload = await buildLocalSyncPayload();
    expect(localPayload.vodHistory).toHaveLength(1);
    expect(localPayload.watchlist).toHaveLength(0);
    expect(Object.keys(localPayload.watchlistTombstones)).toContain('p1:series:99');

    const remotePayload: SyncPayload = {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      deviceId: 'remote-tv',
      exportedAt: Date.now(),
      vodHistory: [
        {
          channelId: 'vod:p1:movie:7',
          kind: 'vod',
          name: 'Matrix',
          ts: Date.now() + 5000,
          positionMs: 2400000,
          durationMs: 6000000,
          status: 'started',
        },
      ],
      vodProgress: {
        'p1:movie:7': { positionMs: 2400000, durationMs: 6000000, updatedAt: Date.now() + 5000 },
      },
      watchlist: [
        { id: '99', name: 'Andor', kind: 'series', playlistId: 'p1', addedAt: 1000 },
        { id: '101', name: 'The Bear', kind: 'series', playlistId: 'p1', addedAt: Date.now() + 1000 },
      ],
      watchlistTombstones: {},
    };

    const onHistory = vi.fn();
    const onWatchlist = vi.fn();
    window.addEventListener('vod-history-updated', onHistory);
    window.addEventListener('vod-watchlist-updated', onWatchlist);

    const merged = mergeSyncPayloads(localPayload, remotePayload);
    const result = await applyMergedSyncPayload(merged);

    window.removeEventListener('vod-history-updated', onHistory);
    window.removeEventListener('vod-watchlist-updated', onWatchlist);

    expect(result.changed).toBe(true);
    expect(onHistory).toHaveBeenCalled();
    expect(onWatchlist).toHaveBeenCalled();

    const historyAfter = await getPlayHistory();
    expect(historyAfter.find(e => e.channelId === 'live-tf1')).toBeTruthy();
    expect(historyAfter.find(e => e.channelId === 'vod:p1:movie:7')?.positionMs).toBe(2400000);
    expect(JSON.parse(localStorage.getItem('vod_progress_p1:movie:7') || '{}').positionMs).toBe(2400000);

    const watchlistAfter = await getVodWatchlistFromDB();
    expect(watchlistAfter.map(i => i.id)).toEqual(['101']);
    const tombstonesAfter = await getVodWatchlistTombstonesFromDB();
    expect(tombstonesAfter['p1:series:99']).toBeGreaterThan(0);

    // Les réglages propres à l'appareil restent intacts
    expect(await getSettingsFromDB()).toMatchObject({ theme: 'dark', compactMode: true });
  });

  it('horodate le masquage Reprendre (hide) pour qu’il survive à la synchro', async () => {
    await pushPlayHistory({
      channelId: 'vod:p1:movie:88',
      kind: 'vod',
      name: 'Hidden Film',
      ts: 1000,
      positionMs: 50000,
      durationMs: 5000000,
      status: 'started',
    });
    await manageContinueEntry('vod:p1:movie:88', 'hide');
    const [entry] = await getPlayHistory();
    expect(entry?.hiddenFromContinue).toBe(true);
    expect(entry?.hiddenAt).toBeGreaterThan(1000);
  });

  it('traduit les identifiants distants par empreinte fournisseur Xtream (playlistId différent)', async () => {
    const providerKey = await computeXtreamProviderKey({
      server: 'https://iptv.example.test:8443/',
      username: 'ced',
      password: 'secret',
    });
    const index = await buildLocalCatalogRemapIndex({
      playlists: [{ id: 'pl-tv', name: 'TV', channels: [], groups: [] }],
      playlistSources: { 'pl-tv': providerKey },
      vodHistory: [],
      watchlist: [],
    });
    const remote: SyncPayload = {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      deviceId: 'phone-1',
      exportedAt: 5000,
      playlistSources: { 'pl-phone': providerKey },
      vodHistory: [
        {
          channelId: 'vod:pl-phone:movie:42',
          playlistId: 'pl-phone',
          mediaKind: 'movie',
          kind: 'vod',
          name: 'Dune',
          ts: 5000,
          positionMs: 900_000,
          durationMs: 7_000_000,
          status: 'started',
        },
      ],
      vodProgress: {
        'pl-phone:movie:42': { positionMs: 900_000, durationMs: 7_000_000, updatedAt: 5000 },
      },
      watchlist: [
        { id: '99', name: 'Andor', kind: 'series', playlistId: 'pl-phone', addedAt: 4000 },
      ],
      watchlistTombstones: {
        'pl-phone:movie:7': 4500,
      },
    };

    const translated = remapSyncPayloadToLocal(remote, index);
    expect(translated.vodHistory[0]?.channelId).toBe('vod:pl-tv:movie:42');
    expect(translated.vodHistory[0]?.playlistId).toBe('pl-tv');
    expect(translated.vodProgress['pl-tv:movie:42']?.positionMs).toBe(900_000);
    expect(translated.vodProgress['pl-phone:movie:42']).toBeUndefined();
    expect(translated.watchlist[0]?.playlistId).toBe('pl-tv');
    expect(translated.watchlistTombstones['pl-tv:movie:7']).toBe(4500);
  });

  it('traduit par TMDB (+ saison/épisode) sans jamais rapprocher sur le titre seul', async () => {
    const index = await buildLocalCatalogRemapIndex({
      playlists: [{ id: 'pl-tv', name: 'TV', channels: [], groups: [] }],
      playlistSources: {},
      vodHistory: [
        {
          channelId: 'vod:pl-tv:series:777',
          playlistId: 'pl-tv',
          mediaKind: 'series',
          seriesId: '300',
          kind: 'vod',
          name: 'Severance',
          tmdbId: 95396,
          season: 1,
          episode: 2,
          ts: 1000,
        },
      ],
      watchlist: [
        { id: '888', name: 'Dune 2', kind: 'movie', playlistId: 'pl-tv', tmdbId: 693134, addedAt: 1000 },
      ],
    });
    const remote: SyncPayload = {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      deviceId: 'phone-2',
      exportedAt: 6000,
      vodHistory: [
        {
          channelId: 'vod:pl-other:series:111',
          playlistId: 'pl-other',
          mediaKind: 'series',
          seriesId: '10',
          kind: 'vod',
          name: 'Severance',
          tmdbId: 95396,
          season: 1,
          episode: 2,
          ts: 6000,
          positionMs: 600_000,
        },
        {
          // Épisode différent (S01E03) absent du catalogue local -> ne doit PAS être remappé sur E02
          channelId: 'vod:pl-other:series:112',
          playlistId: 'pl-other',
          mediaKind: 'series',
          seriesId: '10',
          kind: 'vod',
          name: 'Severance',
          tmdbId: 95396,
          season: 1,
          episode: 3,
          ts: 6000,
        },
        {
          // Même titre seul sans TMDB ni fournisseur commun -> ne doit PAS être remappé
          channelId: 'vod:pl-other:movie:999',
          playlistId: 'pl-other',
          mediaKind: 'movie',
          kind: 'vod',
          name: 'Dune 2',
          ts: 6000,
        },
      ],
      vodProgress: {
        'pl-other:series:111': { positionMs: 600_000, durationMs: 3_000_000, updatedAt: 6000 },
      },
      watchlist: [
        { id: '555', name: 'Dune 2', kind: 'movie', playlistId: 'pl-other', tmdbId: 693134, addedAt: 7000 },
      ],
      watchlistTombstones: {},
    };

    const translated = remapSyncPayloadToLocal(remote, index);
    expect(translated.vodHistory[0]?.channelId).toBe('vod:pl-tv:series:777');
    expect(translated.vodHistory[0]?.seriesId).toBe('300');
    expect(translated.vodProgress['pl-tv:series:777']?.positionMs).toBe(600_000);
    expect(translated.vodHistory[1]?.channelId).toBe('vod:pl-other:series:112');
    expect(translated.vodHistory[2]?.channelId).toBe('vod:pl-other:movie:999');
    expect(translated.watchlist[0]).toMatchObject({ playlistId: 'pl-tv', id: '888' });
  });
});
