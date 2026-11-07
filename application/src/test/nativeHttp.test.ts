import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Requêtes hors CORS sur Android : httpGetJson (Xtream live / connexion) et
// CORSProxy (import M3U sans User-Agent) doivent passer par CapacitorHttp en
// plateforme native, et rester en fetch standard côté web.

const mocks = vi.hoisted(() => ({
  native: false,
  httpGet: vi.fn(),
  httpRequest: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  CapacitorHttp: { get: mocks.httpGet, request: mocks.httpRequest },
}));

import { httpGetJson, getActiveUserAgent } from '@/utils/userAgent';
import { CORSProxy } from '@/utils/corsProxy';
import { fetchLiveCategories } from '@/utils/xtreamLive';

beforeEach(() => {
  mocks.native = false;
  mocks.httpGet.mockReset();
  mocks.httpRequest.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('httpGetJson', () => {
  it('natif : requête CapacitorHttp, corps texte parsé en JSON, User-Agent actif', async () => {
    mocks.native = true;
    mocks.httpGet.mockResolvedValue({ status: 200, data: '[{"category_id":1}]' });
    const { ok, status, data } = await httpGetJson('http://serveur.test/player_api.php?action=get_live_categories');
    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toEqual([{ category_id: 1 }]);
    const call = mocks.httpGet.mock.calls[0][0] as { url: string; responseType: string; headers: Record<string, string> };
    expect(call.url).toBe('http://serveur.test/player_api.php?action=get_live_categories');
    expect(call.responseType).toBe('json');
    expect(call.headers['User-Agent']).toBe(getActiveUserAgent());
  });

  it('natif : corps objet renvoyé tel quel, statut non 2xx → ok false', async () => {
    mocks.native = true;
    mocks.httpGet.mockResolvedValueOnce({ status: 200, data: { auth: 1 } });
    expect(await httpGetJson('http://serveur.test/player_api.php')).toMatchObject({ ok: true, data: { auth: 1 } });
    mocks.httpGet.mockResolvedValueOnce({ status: 403, data: 'refusé' });
    expect(await httpGetJson('http://serveur.test/player_api.php')).toMatchObject({ ok: false, status: 403, data: 'refusé' });
  });

  it('web : fetch standard, JSON parsé même hors 2xx (erreurs du relais)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'relais indisponible' }) });
    vi.stubGlobal('fetch', fetcher);
    const { ok, status, data } = await httpGetJson('http://relais.test/xtream/categories');
    expect(ok).toBe(false);
    expect(status).toBe(403);
    expect(data).toEqual({ error: 'relais indisponible' });
  });

  it('web : corps non JSON → data null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('pas du JSON'); } }));
    expect(await httpGetJson('http://relais.test/xtream/categories')).toMatchObject({ ok: true, data: null });
  });
});

describe('fetchLiveCategories (natif)', () => {
  it('appelle le serveur direct via CapacitorHttp (sans relais)', async () => {
    mocks.native = true;
    mocks.httpGet.mockResolvedValue({ status: 200, data: [{ category_id: '1', category_name: 'FR | Info' }] });
    const categories = await fetchLiveCategories({ server: 'http://serveur.test:8080', username: 'user', password: 'pass' });
    expect(categories).toEqual([{ category_id: '1', category_name: 'FR | Info' }]);
    const call = mocks.httpGet.mock.calls[0][0] as { url: string };
    expect(call.url).toBe('http://serveur.test:8080/player_api.php?username=user&password=pass&action=get_live_categories');
  });

  it('échec HTTP : message avec le statut ; corps inattendu : message générique', async () => {
    mocks.native = true;
    mocks.httpGet.mockResolvedValue({ status: 503, data: null });
    await expect(fetchLiveCategories({ server: 'http://s.test', username: 'u', password: 'p' }))
      .rejects.toThrow('Catégories Xtream indisponibles (503)');
    mocks.httpGet.mockResolvedValue({ status: 200, data: { error: 'auth' } });
    await expect(fetchLiveCategories({ server: 'http://s.test', username: 'u', password: 'p' }))
      .rejects.toThrow('Réponse Xtream inattendue');
  });
});

describe('CORSProxy.fetchWithProxy (natif)', () => {
  it('passe par CapacitorHttp.request et renvoie le texte', async () => {
    mocks.native = true;
    mocks.httpRequest.mockResolvedValue({ status: 200, data: '#EXTM3U\n#EXTINF:-1,A' });
    await expect(CORSProxy.fetchWithProxy('http://serveur.test/liste.m3u')).resolves.toBe('#EXTM3U\n#EXTINF:-1,A');
    const call = mocks.httpRequest.mock.calls[0][0] as { url: string; method: string };
    expect(call.url).toBe('http://serveur.test/liste.m3u');
    expect(call.method).toBe('GET');
    expect(mocks.httpGet).not.toHaveBeenCalled();
  });

  it('testConnectivity émet un vrai HEAD natif (get() forcerait GET)', async () => {
    mocks.native = true;
    mocks.httpRequest.mockResolvedValue({ status: 200, data: '' });
    await expect(CORSProxy.testConnectivity('https://serveur.test')).resolves.toBe(true);
    expect(mocks.httpRequest.mock.calls[0][0]).toMatchObject({ method: 'HEAD' });
    expect(mocks.httpGet).not.toHaveBeenCalled();
  });

  it('échec HTTP : message avec statut ; échec réseau : message sans « CORS »', async () => {
    mocks.native = true;
    mocks.httpRequest.mockResolvedValue({ status: 403, data: '' });
    await expect(CORSProxy.fetchWithProxy('https://serveur.test/liste.m3u')).rejects.toThrow('Import impossible : HTTP 403');
    mocks.httpRequest.mockRejectedValue(new Error('délai dépassé'));
    await expect(CORSProxy.fetchWithProxy('https://serveur.test/liste.m3u'))
      .rejects.toThrow('Import impossible (connexion ou accès)');
  });
});
