import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { openDB } from 'idb';
import { deletePlaylistFromDB, getMeta, getPlaylistsFromDB, savePlaylistToDB, setMeta } from '@/utils/idb';
import { M3UParser } from '@/utils/m3uParser';

const clearStores = async () => {
  const db = await openDB('IPTVPlayerDB', 2);
  const tx = db.transaction(['playlists', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('playlists').clear(), tx.objectStore('meta').clear()]);
  await tx.done;
  db.close();
};

beforeEach(async () => {
  localStorage.clear();
  await getPlaylistsFromDB();
  await clearStores();
});

it('supprime les guides, index et préférences rattachés à la liste supprimée', async () => {
  const playlist = M3UParser.parseM3U('#EXTM3U\n#EXTINF:-1 group-title="Tests",Alpha\nhttps://example.test/a');
  await savePlaylistToDB(playlist);
  const owned = [
    `epgCache_${playlist.id}`,
    `epgCache_${playlist.id}_abc`,
    `epgParsed_v2_${playlist.id}`,
    `catchupIndex:${playlist.id}`,
    `channelFilters:${playlist.id}`,
    `epgConfig:${playlist.id}`,
    `hiddenGroups:${playlist.id}`,
    `hiddenChannels:${playlist.id}`,
    `listCustomization:${playlist.id}`,
    `mosaicLayouts:${playlist.id}`,
    `playlistRefreshedAt:${playlist.id}`,
  ];
  for (const key of owned) await setMeta(key, { marker: key });
  // Clés partagées ou appartenant à une autre liste : elles doivent survivre.
  await setMeta('settings', { theme: 'dark' });
  await setMeta('favorites', ['a']);
  await setMeta('epgCache_autre-liste', { xml: '<tv/>' });
  await setMeta('channelFilters:autre-liste', { group: 'x' });

  await deletePlaylistFromDB(playlist.id);

  expect(await getPlaylistsFromDB()).toHaveLength(0);
  for (const key of owned) expect(await getMeta(key)).toBeUndefined();
  expect(await getMeta('settings')).toEqual({ theme: 'dark' });
  expect(await getMeta('favorites')).toEqual(['a']);
  expect(await getMeta('epgCache_autre-liste')).toEqual({ xml: '<tv/>' });
  expect(await getMeta('channelFilters:autre-liste')).toEqual({ group: 'x' });
});
