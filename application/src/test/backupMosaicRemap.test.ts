// Sauvegardes : le registre des notifications programmées reste propre à
// l'appareil (ni exporté, ni restauré), et les dispositions de mosaïque suivent
// leur liste si la restauration lui attribue un nouvel identifiant.
import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { createBackup } from '@/utils/backup';
import {
  exportBackupFromDB, getMeta, getPlaylistsFromDB, restoreBackupToDB, savePlaylistToDB, setMeta,
} from '@/utils/idb';
import type { Channel, PlaylistInfo } from '@/types/channel';

const ch = (id: string, name: string): Channel => ({ id, name, url: `https://s/${id}.ts`, isFavorite: false });
const pl = (id: string, channels: Channel[]): PlaylistInfo => ({ id, name: 'Ma liste', channels, groups: [] });

beforeEach(async () => {
  await setMeta('epgRemindersScheduled', []);
  await setMeta('mosaicLayouts:p1', []);
});

it('n’exporte pas le registre des notifications programmées', async () => {
  await savePlaylistToDB(pl('p1', [ch('1', 'Un')]));
  await setMeta('epgReminders', [{ id: '5:123', channelId: '5', channelName: 'TF1', title: 'Film', startTime: 123 }]);
  await setMeta('epgRemindersScheduled', [{ id: 42, startTime: 123 }]);
  const backup = await exportBackupFromDB();
  const keys = backup.meta.map(m => m.key);
  // Les rappels et les dispositions sont des données : ils partent.
  expect(keys).toContain('epgReminders');
  expect(keys).toContain('mosaicLayouts:p1');
  // Le registre décrit cet appareil : il reste chez lui.
  expect(keys).not.toContain('epgRemindersScheduled');
});

it('ignore le registre présent dans une ancienne sauvegarde', async () => {
  const local = [{ id: 42, startTime: 123 }];
  await setMeta('epgRemindersScheduled', local);
  const backup = createBackup([pl('p2', [ch('9', 'Neuf')])], [{ key: 'epgRemindersScheduled', value: [{ id: 7, startTime: 1 }] }]);
  await restoreBackupToDB(backup);
  expect(await getMeta('epgRemindersScheduled')).toEqual(local);
});

it('suit le nouvel identifiant de la liste et fusionne les dispositions', async () => {
  // Liste locale p1 avec une chaîne ; la sauvegarde décrit p1 avec une chaîne
  // de plus : signature différente → la liste restaurée reçoit un nouvel id.
  await savePlaylistToDB(pl('p1', [ch('1', 'Un')]));
  await setMeta('mosaicLayouts:p1', [{ id: 'l-local', name: 'Soir foot', channelIds: ['1'], createdAt: 1 }]);
  const backup = createBackup([pl('p1', [ch('1', 'Un'), ch('2', 'Deux')])], [
    {
      key: 'mosaicLayouts:p1',
      value: [
        { id: 'l-in', name: 'Matin info', channelIds: ['2'], createdAt: 2 },
        { id: 'l-dup', name: 'SOIR FOOT', channelIds: ['9'], createdAt: 3 },
      ],
    },
  ]);
  const before = new Set((await getPlaylistsFromDB()).map(p => p.id));
  await restoreBackupToDB(backup);
  const restored = (await getPlaylistsFromDB()).find(p => !before.has(p.id));
  expect(restored).toBeDefined();
  // Les dispositions locales ont suivi la liste, la sauvegarde complète les
  // absentes, les doublons (casse ignorée) restent locaux.
  expect(await getMeta(`mosaicLayouts:${restored!.id}`)).toEqual([
    { id: 'l-local', name: 'Soir foot', channelIds: ['1'], createdAt: 1 },
    { id: 'l-in', name: 'Matin info', channelIds: ['2'], createdAt: 2 },
  ]);
  // L'ancien emplacement est libéré.
  expect(await getMeta('mosaicLayouts:p1')).toBeUndefined();
});

it('migre les dispositions locales même sans disposition dans la sauvegarde', async () => {
  await savePlaylistToDB(pl('p3', [ch('1', 'Un')]));
  await setMeta('mosaicLayouts:p3', [{ id: 'l-seule', name: 'Ma sélection', channelIds: ['1'], createdAt: 5 }]);
  const backup = createBackup([pl('p3', [ch('1', 'Un'), ch('2', 'Deux')])], []);
  const before = new Set((await getPlaylistsFromDB()).map(p => p.id));
  await restoreBackupToDB(backup);
  const restored = (await getPlaylistsFromDB()).find(p => !before.has(p.id));
  expect(await getMeta(`mosaicLayouts:${restored!.id}`)).toEqual([{ id: 'l-seule', name: 'Ma sélection', channelIds: ['1'], createdAt: 5 }]);
  expect(await getMeta('mosaicLayouts:p3')).toBeUndefined();
});
