import { expect, it } from 'vitest';
import { followedSeries, nextSeriesEpisode } from '@/utils/discoverSeries';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { Episode } from '@/utils/xtreamCatalog';

const seed: PlayHistoryEntry = { channelId: 'vod:p:series:e1', playlistId: 'p', mediaKind: 'series', seriesId: 's1', kind: 'vod', name: 'Série suivie', ts: 1, status: 'completed' };
const episode = (id: string, season: string, number: number): Episode => ({ id, season, number, name: id, extension: 'mp4', plot: '' });

it('ne propose que les séries terminées récemment dans la bonne playlist', () => {
  expect(followedSeries([seed, { ...seed, playlistId: 'autre', seriesId: 's2' }], 'p')).toEqual([seed]);
  expect(followedSeries([seed, { ...seed, channelId: 'vod:p:series:e2', ts: 2, status: 'started', positionMs: 60000 }], 'p')).toEqual([]);
  expect(followedSeries([{ ...seed, hiddenFromContinue: true }], 'p')).toEqual([]);
});

it('trie saisons et épisodes, ignore les spéciaux et les épisodes déjà vus', () => {
  const episodes = [episode('e3', '2', 1), episode('special', '0', 1), episode('e2', '1', 2), episode('e1', '1', 1)];
  expect(nextSeriesEpisode(seed, episodes, [seed])?.id).toBe('e2');
  expect(nextSeriesEpisode(seed, episodes, [seed, { ...seed, channelId: 'vod:p:series:e2' }])?.id).toBe('e3');
  expect(nextSeriesEpisode(seed, episodes, [seed, { ...seed, playlistId: 'autre', channelId: 'vod:autre:series:e2' }])?.id).toBe('e2');
  expect(nextSeriesEpisode(seed, episodes, [seed, { ...seed, channelId: 'vod:p:series:e2', status: 'started', positionMs: 1000 }])).toBeUndefined();
  expect(nextSeriesEpisode(seed, episodes, [seed, { ...seed, channelId: 'vod:p:series:e2', status: 'started', hiddenFromContinue: true }])).toBeUndefined();
});

it('ne devine pas un épisode si le précédent est absent ou si la série est finie', () => {
  expect(nextSeriesEpisode(seed, [episode('e2', '1', 2)], [seed])).toBeUndefined();
  expect(nextSeriesEpisode(seed, [episode('e1', '1', 1)], [seed])).toBeUndefined();
  expect(nextSeriesEpisode(seed, [episode('e1', '1', 1), { ...episode('e2', '1', 2), extension: '' }], [seed])).toBeUndefined();
});
