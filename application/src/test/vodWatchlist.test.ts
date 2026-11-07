import 'fake-indexeddb/auto';
import { expect, it, beforeEach } from 'vitest';
import { getVodWatchlistFromDB, toggleVodWatchlist, deleteMeta } from '@/utils/idb';

beforeEach(async () => {
  await deleteMeta('vod_watchlist');
});

it('gère l’ajout, le retrait et la persistance dans Ma Liste (Watchlist VOD)', async () => {
  expect(await getVodWatchlistFromDB()).toEqual([]);

  const item1 = {
    id: '123',
    name: 'Inception',
    kind: 'movie' as const,
    playlistId: 'playlist-1',
    poster: 'https://example.com/inception.jpg',
    rating: '8.8',
  };

  // Ajout
  const added = await toggleVodWatchlist(item1);
  expect(added).toBe(true);
  const listAfterAdd = await getVodWatchlistFromDB();
  expect(listAfterAdd).toHaveLength(1);
  expect(listAfterAdd[0]).toMatchObject({
    id: '123',
    name: 'Inception',
    kind: 'movie',
    playlistId: 'playlist-1',
    rating: '8.8',
  });
  expect(listAfterAdd[0]?.addedAt).toBeGreaterThan(0);

  // Retrait via toggle
  const removed = await toggleVodWatchlist(item1);
  expect(removed).toBe(false);
  expect(await getVodWatchlistFromDB()).toEqual([]);
});

it('sépare les entrées par playlist et par type (film/série)', async () => {
  await toggleVodWatchlist({ id: '10', name: 'Breaking Bad', kind: 'series', playlistId: 'p1' });
  await toggleVodWatchlist({ id: '10', name: 'Film 10', kind: 'movie', playlistId: 'p1' });
  await toggleVodWatchlist({ id: '10', name: 'Breaking Bad', kind: 'series', playlistId: 'p2' });

  const list = await getVodWatchlistFromDB();
  expect(list).toHaveLength(3);
  expect(list.filter(item => item.playlistId === 'p1')).toHaveLength(2);
  expect(list.filter(item => item.kind === 'series')).toHaveLength(2);
});
