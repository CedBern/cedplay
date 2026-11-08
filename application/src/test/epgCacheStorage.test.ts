import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ getMeta: vi.fn(), setMeta: vi.fn() }));
vi.mock('@/utils/idb', async () => ({
  ...await vi.importActual<typeof import('@/utils/idb')>('@/utils/idb'),
  getMeta: mocks.getMeta,
  setMeta: mocks.setMeta,
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: {} }));

import { fetchEPGSource } from '@/utils/epg';
import { StorageManager } from '@/utils/storage';

const playlist: PlaylistInfo = { id: 'epg-quota', name: 'Test', channels: [], groups: [] };
const settings = { ...StorageManager.getSettings(), epgUrl: 'https://example.test/epg.xml' };

afterEach(() => vi.unstubAllGlobals());

it('sert le guide téléchargé quand le cache ne peut pas être écrit (quota plein)', async () => {
  mocks.getMeta.mockResolvedValue(undefined);
  mocks.setMeta.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<tv><programme start="20261108000000 +0000" stop="20261108010000 +0000" channel="c1"><title>Journal</title></programme></tv>')));

  const source = await fetchEPGSource(playlist, settings);

  expect(source).toMatchObject({ stale: false });
  expect(source?.xml).toContain('<programme');
  expect(mocks.setMeta).toHaveBeenCalled();
});

it('n’annonce une panne réseau que lorsque le téléchargement échoue', async () => {
  mocks.getMeta.mockResolvedValue(undefined);
  mocks.setMeta.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau')));

  await expect(fetchEPGSource(playlist, settings)).rejects.toThrow('Guide indisponible');
});
