import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchEPGSource } from '@/utils/epg';
import { setMeta } from '@/utils/idb';
import { StorageManager } from '@/utils/storage';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
const playlist = { id: 'epg-test', name: 'Test', channels: [], groups: [] };
const settings = { ...StorageManager.getSettings(), epgUrl: 'https://example.test/epg.xml' };
afterEach(() => vi.unstubAllGlobals());

it('ne réutilise pas le cache d’une ancienne source sous la même liste', async () => {
  await setMeta('epgCache_epg-test', { xml: '<tv>ancien</tv>', fetchedAt: Date.now(), source: 'https://other.test/epg' });
  const fetcher = vi.fn().mockResolvedValue(new Response('<tv>nouveau</tv>'));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchEPGSource(playlist, settings)).toMatchObject({ xml: '<tv>nouveau</tv>', stale: false });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('signale le cache périmé si le rafraîchissement échoue et distingue l’absence de source', async () => {
  await setMeta('epgCache_epg-test', { xml: '<tv/>', fetchedAt: 100, source: settings.epgUrl });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private URL')));
  expect(await fetchEPGSource(playlist, settings, true)).toEqual({ xml: '<tv/>', fetchedAt: 100, stale: true, url: settings.epgUrl });
  expect(await fetchEPGSource(playlist, { ...settings, epgUrl: '' })).toBeNull();
  await expect(fetchEPGSource(playlist, { ...settings, epgUrl: 'https://new.test/xml' })).rejects.toThrow('Guide indisponible');
});
