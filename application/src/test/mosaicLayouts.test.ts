import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { setMeta } from '@/utils/idb';
import { deleteMosaicLayout, loadMosaicLayouts, resolveLayout, saveMosaicLayout } from '@/utils/mosaicLayouts';
import type { Channel, PlaylistInfo } from '@/types/channel';

const playlistId = 'pl';
const ch = (id: string): Channel => ({ id, name: `Chaîne ${id}`, url: `https://s/${id}.ts`, isFavorite: false });
const pl = (channels: Channel[]): PlaylistInfo => ({ id: playlistId, name: 'Test', channels, groups: [] });

beforeEach(async () => {
  await setMeta(`mosaicLayouts:${playlistId}`, []);
});

it('enregistre puis relit une disposition', async () => {
  await saveMosaicLayout(playlistId, 'Soir foot', ['1', '2', '3']);
  const layouts = await loadMosaicLayouts(playlistId);
  expect(layouts).toHaveLength(1);
  expect(layouts[0]).toMatchObject({ name: 'Soir foot', channelIds: ['1', '2', '3'] });
});

it('remplace la disposition portant le même nom (casse ignorée)', async () => {
  await saveMosaicLayout(playlistId, 'Soir foot', ['1', '2']);
  await saveMosaicLayout(playlistId, 'soir FOOT', ['5', '6', '7']);
  const layouts = await loadMosaicLayouts(playlistId);
  expect(layouts).toHaveLength(1);
  expect(layouts[0]).toMatchObject({ name: 'soir FOOT', channelIds: ['5', '6', '7'] });
});

it('plafonne le nombre de dispositions et ignore les entrées invalides', async () => {
  for (let i = 0; i < 25; i++) await saveMosaicLayout(playlistId, `Mosaïque ${i}`, ['1', '2']);
  await setMeta(`mosaicLayouts:${playlistId}`, [...(await loadMosaicLayouts(playlistId)), { id: 'x', name: 'Une seule', channelIds: ['1'] }, 'nawak', { id: 'y', name: 'Trop', channelIds: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }]);
  const layouts = await loadMosaicLayouts(playlistId);
  expect(layouts).toHaveLength(20);
  expect(layouts.some(l => l.name === 'Une seule' || l.name === 'Trop')).toBe(false);
});

it('supprime une disposition désignée', async () => {
  await saveMosaicLayout(playlistId, 'A', ['1', '2']);
  await saveMosaicLayout(playlistId, 'B', ['3', '4']);
  // Les nouvelles dispositions s'insèrent en tête de liste.
  const a = (await loadMosaicLayouts(playlistId)).find(l => l.name === 'A');
  const kept = await deleteMosaicLayout(playlistId, a!.id);
  expect(kept.map(l => l.name)).toEqual(['B']);
});

it('résout une disposition en chaînes présentes, dans l’ordre, sans les disparues', async () => {
  // Le plafonnement à 8 s'applique déjà à la sauvegarde.
  await saveMosaicLayout(playlistId, 'Mixte', ['3', 'zombie', '1', '2', '4', '5', '6', '7']);
  const resolved = resolveLayout((await loadMosaicLayouts(playlistId))[0], pl([ch('1'), ch('2'), ch('3'), ch('4'), ch('5'), ch('6'), ch('7')]));
  expect(resolved.map(c => c.id)).toEqual(['3', '1', '2', '4', '5', '6', '7']);
});
