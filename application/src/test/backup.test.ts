import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { createBackup, parseBackup } from '@/utils/backup';
import { exportBackupFromDB, getMeta, getPlaylistsFromDB, restoreBackupToDB, savePlaylistToDB, setMeta } from '@/utils/idb';
import { M3UParser } from '@/utils/m3uParser';

const playlist = () => M3UParser.parseM3U('#EXTM3U\n#EXTINF:-1 group-title="Tests",Alpha\nhttps://example.test/a');
beforeEach(async () => {
  localStorage.clear();
  await getPlaylistsFromDB();
  const db = await openDB('IPTVPlayerDB', 2);
  const tx = db.transaction(['playlists', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('playlists').clear(), tx.objectStore('meta').clear()]);
  await tx.done;
  db.close();
});

describe('Sauvegarde complète et restauration additive', () => {
  it('rattache compte, progression, historique et Ma liste à la copie restaurée en conflit', async () => {
    const original = playlist();
    await savePlaylistToDB(original);
    const backup = createBackup([{ ...original, name: 'Copie ancienne' }], [
      { key: 'vod_watchlist', value: [{ playlistId: original.id, id: '42', kind: 'movie', name: 'Film' }] },
      { key: 'playHistory', value: [{ channelId: `vod:${original.id}:movie:42`, kind: 'vod', ts: 1, positionMs: 70000 }] },
    ], { xtreamAccounts: { [original.id]: { server: 'https://example.test', username: 'fixture', password: 'fixture' } }, vodProgress: { [`${original.id}:movie:42`]: { positionMs: 70000, durationMs: 300000 } } });
    await restoreBackupToDB(backup);
    const restored = (await getPlaylistsFromDB()).find(p => p.name === 'Copie ancienne')!;
    expect(await getMeta('vod_watchlist')).toEqual([expect.objectContaining({ playlistId: restored.id })]);
    expect(await getMeta('playHistory')).toEqual([expect.objectContaining({ playlistId: restored.id, channelId: `vod:${restored.id}:movie:42` })]);
    expect(localStorage.getItem(`xtream_account_${restored.id}`)).toBeTruthy();
    expect(localStorage.getItem(`vod_progress_${restored.id}:movie:42`)).toBeTruthy();
    expect(localStorage.getItem(`xtream_account_${original.id}`)).toBeNull();
  });
  it('restaure dans une base vide les listes, variantes, favoris, réglages et métadonnées', async () => {
    const source = playlist();
    source.channels[0].variants = [{ id: 'variant', name: 'Alternative', url: 'https://example.test/b' }];
    const backup = parseBackup(JSON.stringify(createBackup([source], [
      { key: 'favorites', value: [source.channels[0].id] },
      { key: 'settings', value: { volume: 0.3, theme: 'dark', autoplay: false, keyboardNavigation: false } },
      { key: 'lastPlaylistId', value: source.id }, { key: `lastChannel_${source.id}`, value: source.channels[0].id },
    ])));
    await restoreBackupToDB(backup);
    expect(await getPlaylistsFromDB()).toEqual([source]);
    expect(await getMeta('favorites')).toEqual([source.channels[0].id]);
    expect(await getMeta('settings')).toMatchObject({ volume: 0.3, autoplay: false });
    expect(await getMeta('lastPlaylistId')).toBe(source.id);
  });
  it('exporte un instantané et une seconde restauration identique ne duplique rien', async () => {
    await savePlaylistToDB(playlist());
    await setMeta('favorites', ['a']);
    const snapshot = parseBackup(JSON.stringify(await exportBackupFromDB()));
    expect(await restoreBackupToDB(snapshot)).toEqual({ added: 0, skipped: 1 });
    expect(await getPlaylistsFromDB()).toHaveLength(1);
  });
  it('préserve les listes en conflit, les réglages actuels et réunit les favoris', async () => {
    const source = playlist();
    await savePlaylistToDB(source);
    await setMeta('settings', { volume: 0.8 });
    await setMeta('favorites', ['current']);
    const incoming = { ...source, name: 'Autre version' };
    await restoreBackupToDB(createBackup([incoming], [
      { key: 'settings', value: { volume: 0.2 } }, { key: 'favorites', value: ['saved', 'current'] },
      { key: 'lastPlaylistId', value: source.id }, { key: `lastChannel_${source.id}`, value: 'saved' },
    ]));
    const lists = await getPlaylistsFromDB();
    expect(lists).toHaveLength(2);
    expect(lists.find(p => p.id === source.id)?.name).toBe(source.name);
    const restored = lists.find(p => p.name === incoming.name)!;
    expect(restored.id).not.toBe(source.id);
    expect(await getMeta(`lastChannel_${restored.id}`)).toBe('saved');
    expect(await getMeta('lastPlaylistId')).toBe(restored.id);
    expect(await getMeta('favorites')).toEqual(['current', 'saved']);
    expect(await getMeta('settings')).toEqual({ volume: 0.8 });
  });
  it('garde la date la plus récente pour chaque chaîne de l’historique', async () => {
    await setMeta('playHistory', [{ channelId: 'a', ts: 10 }]);
    await restoreBackupToDB(createBackup([], [{ key: 'playHistory', value: [{ channelId: 'a', ts: 4 }, { channelId: 'b', ts: 20 }] }]));
    expect(await getMeta('playHistory')).toEqual([{ channelId: 'b', ts: 20 }, { channelId: 'a', ts: 10 }]);
  });
  it('ne multiplie pas les copies lors de restaurations répétées d’un conflit', async () => {
    const original = playlist();
    await savePlaylistToDB(original);
    const backup = createBackup([{ ...original, name: 'Version sauvegardée' }], []);
    expect((await restoreBackupToDB(backup)).added).toBe(1);
    expect(await restoreBackupToDB(backup)).toEqual({ added: 0, skipped: 1 });
    expect(await getPlaylistsFromDB()).toHaveLength(2);
  });
  it('annule toute la transaction en cas d’échec après une première écriture', async () => {
    const backup = createBackup([playlist()], [{ key: 'cannotClone', value: () => {} }]);
    await expect(restoreBackupToDB(backup)).rejects.toBeDefined();
    expect(await getPlaylistsFromDB()).toEqual([]);
    expect(await getMeta('cannotClone')).toBeUndefined();
  });
  it('refuse un fichier altéré ou une version inconnue avant restauration', () => {
    const backup = createBackup([playlist()], []);
    for (const bad of ['broken json', JSON.stringify({ ...backup, version: 99 }),
      JSON.stringify({ ...backup, meta: [{ key: 'favorites', value: [42] }] }),
      JSON.stringify({ ...backup, meta: [{ key: 'settings', value: null }] }),
      JSON.stringify({ ...backup, playlists: [backup.playlists[0], backup.playlists[0]] })]) {
      expect(() => parseBackup(bad)).toThrow('Aucune donnée modifiée');
    }
  });
});
