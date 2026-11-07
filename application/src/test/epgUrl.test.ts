import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEPGSource, getEPGUrl, getParsedEPGCache, saveParsedEPGCache } from '@/utils/epg';
import { getMeta, setMeta } from '@/utils/idb';
import { StorageManager } from '@/utils/storage';
import type { PlaylistInfo } from '@/types/channel';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { get: vi.fn() },
}));
vi.mock('@/utils/xtreamCatalog', () => ({ getXtreamAccount: vi.fn() }));

import { getXtreamAccount } from '@/utils/xtreamCatalog';

const getXtreamAccountMock = vi.mocked(getXtreamAccount);
const baseSettings = { ...StorageManager.getSettings() };

function makePlaylist(id: string): PlaylistInfo {
  return { id, name: 'Test', channels: [], groups: [] };
}

const XMLTV = '<tv><programme start="20261103120000" stop="20261103130000" channel="c1"><title>Test</title></programme></tv>';

beforeEach(() => {
  getXtreamAccountMock.mockReset();
  getXtreamAccountMock.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getEPGUrl', () => {
  it('construit l\'URL xmltv.php du compte Xtream avec credentials encodés', () => {
    getXtreamAccountMock.mockReturnValue({ server: 'http://serv:8080', username: 'us&er', password: 'p@ss word' });
    const url = getEPGUrl(makePlaylist('xt'), baseSettings);
    expect(url).toBe('http://serv:8080/xmltv.php?username=us%26er&password=p%40ss%20word');
  });

  it('utilise l\'adresse XMLTV personnalisée sans compte Xtream', () => {
    expect(getEPGUrl(makePlaylist('custom'), { ...baseSettings, epgUrl: 'https://example.test/epg.xml' }))
      .toBe('https://example.test/epg.xml');
  });

  it('trimme l\'adresse personnalisée et renvoie null si invalide ou absente', () => {
    expect(getEPGUrl(makePlaylist('blank'), { ...baseSettings, epgUrl: '  https://ok.test/epg  ' }))
      .toBe('https://ok.test/epg');
    expect(getEPGUrl(makePlaylist('bad'), { ...baseSettings, epgUrl: 'pas une url' })).toBeNull();
    expect(getEPGUrl(makePlaylist('none'), { ...baseSettings, epgUrl: '' })).toBeNull();
  });

  it('ne prend l\'adresse personnalisée que si aucun compte Xtream n\'est lié', () => {
    getXtreamAccountMock.mockReturnValue({ server: 'http://serv', username: 'u', password: 'p' });
    const url = getEPGUrl(makePlaylist('prio'), { ...baseSettings, epgUrl: 'https://example.test/other.xml' });
    expect(url).toContain('xmltv.php');
    expect(url).not.toContain('other.xml');
  });
});

describe('fetchEPGSource', () => {
  it('ne télécharge rien quand le cache de moins de 12 h correspond à la source', async () => {
    const playlist = makePlaylist('fresh-cache');
    const epgUrl = 'https://epg.test/guide.xml';
    await setMeta(`epgCache_${playlist.id}`, { xml: XMLTV, fetchedAt: Date.now() - 3600_000, source: epgUrl });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchEPGSource(playlist, { ...baseSettings, epgUrl });
    expect(result).toMatchObject({ xml: XMLTV, stale: false, url: epgUrl });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('considère le cache périmé après 12 h et recharge', async () => {
    const playlist = makePlaylist('stale-cache');
    const epgUrl = 'https://epg.test/guide.xml';
    await setMeta(`epgCache_${playlist.id}`, { xml: '<tv>vieux</tv>', fetchedAt: Date.now() - 13 * 3600_000, source: epgUrl });
    const fetcher = vi.fn().mockResolvedValue(new Response(XMLTV));
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchEPGSource(playlist, { ...baseSettings, epgUrl });
    expect(result).toMatchObject({ xml: XMLTV, stale: false });
    expect(fetcher).toHaveBeenCalledOnce();
    // Le cache est rafraîchi avec la nouvelle source
    const saved = await getMeta<{ xml: string; fetchedAt: number; source: string }>(`epgCache_${playlist.id}`);
    expect(saved?.xml).toBe(XMLTV);
  });

  it('ignore un cache rattaché à une autre source', async () => {
    const playlist = makePlaylist('other-source');
    await setMeta(`epgCache_${playlist.id}`, { xml: '<tv>autre</tv>', fetchedAt: Date.now(), source: 'https://ancien.test/epg' });
    const fetcher = vi.fn().mockResolvedValue(new Response(XMLTV));
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchEPGSource(playlist, { ...baseSettings, epgUrl: 'https://epg.test/guide.xml' });
    expect(result?.xml).toBe(XMLTV);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retombe sur le cache périmé si le serveur renvoie du non-XMLTV', async () => {
    const playlist = makePlaylist('non-xmltv');
    const epgUrl = 'https://epg.test/guide.xml';
    await setMeta(`epgCache_${playlist.id}`, { xml: '<tv>secours</tv>', fetchedAt: Date.now() - 24 * 3600_000, source: epgUrl });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>page web</html>')));
    const result = await fetchEPGSource(playlist, { ...baseSettings, epgUrl });
    expect(result).toMatchObject({ xml: '<tv>secours</tv>', stale: true });
  });

  it('échoue sans cache de secours si la réponse n\'est pas du XMLTV', async () => {
    const playlist = makePlaylist('no-fallback');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>page web</html>')));
    await expect(fetchEPGSource(playlist, { ...baseSettings, epgUrl: 'https://epg.test/guide.xml' }))
      .rejects.toThrow('Guide indisponible');
  });

  it('renvoie null sans aucune source disponible (ni Xtream ni réglage)', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchEPGSource(makePlaylist('no-source'), baseSettings)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('cache du résultat parsé', () => {
  const data = { channels: { c1: [{ title: 'JT', start: 0, endTime: 60 }] } } as never;

  it('fait l\'aller-retour par playlist, url et fetchedAt', async () => {
    await saveParsedEPGCache('parsed-1', 'https://epg.test/g.xml', 1000, data);
    await expect(getParsedEPGCache('parsed-1', 'https://epg.test/g.xml', 1000)).resolves.toEqual(data);
  });

  it('renvoie null si l\'url ou fetchedAt diffèrent', async () => {
    await saveParsedEPGCache('parsed-2', 'https://epg.test/g.xml', 2000, data);
    await expect(getParsedEPGCache('parsed-2', 'https://autre.test/g.xml', 2000)).resolves.toBeNull();
    await expect(getParsedEPGCache('parsed-2', 'https://epg.test/g.xml', 3000)).resolves.toBeNull();
  });
});
