import 'fake-indexeddb/auto';
import { expect, it, beforeEach } from 'vitest';
import { getPlayHistory, manageContinueEntry, pushPlayHistory, setMeta, updateVodHistoryProgress } from '@/utils/idb';

beforeEach(async () => { await setMeta('playHistory', []); });

it('conserve la VOD quand plus de cinquante chaînes sont zappées, y compris avec écritures simultanées', async () => {
  await pushPlayHistory({ channelId: 'vod:ma-liste:movie:42', kind: 'vod', name: 'Film', ts: 1 });
  await Promise.all(Array.from({ length: 60 }, (_, i) => pushPlayHistory({ channelId: `live:${i}`, ts: i + 2 })));
  const history = await getPlayHistory();
  expect(history.filter(e => e.kind !== 'vod')).toHaveLength(50);
  expect(history.find(e => e.kind === 'vod')).toMatchObject({ playlistId: 'ma-liste', mediaKind: 'movie', name: 'Film' });
});

it('réaffiche un titre retiré lorsqu’il est relancé et préserve affiche et progression', async () => {
  await pushPlayHistory({ channelId: 'vod:p:movie:1', kind: 'vod', name: 'Film', ts: 1, positionMs: 90000, poster: 'https://example.test/a.jpg' });
  await manageContinueEntry('vod:p:movie:1', 'hide');
  await pushPlayHistory({ channelId: 'vod:p:movie:1', kind: 'vod', ts: 2 });
  expect((await getPlayHistory())[0]).toMatchObject({ hiddenFromContinue: false, positionMs: 90000, poster: 'https://example.test/a.jpg' });
});

it('distingue un lancement, une lecture en cours et une lecture terminée', async () => {
  await pushPlayHistory({ channelId: 'vod:p:series:9', kind: 'vod', name: 'Épisode', ts: 1, status: 'started' });
  await updateVodHistoryProgress('p:series:9', 90000, 1800000);
  expect((await getPlayHistory())[0]).toMatchObject({ status: 'started', positionMs: 90000 });
  await updateVodHistoryProgress('p:series:9', 1800000, 1800000, true);
  expect((await getPlayHistory())[0]).toMatchObject({ status: 'completed', mediaKind: 'series' });
});
