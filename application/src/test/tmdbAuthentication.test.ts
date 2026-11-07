import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ native: false, get: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => http.native },
  CapacitorHttp: { get: http.get },
}));
vi.mock('@/utils/idb', () => ({ getMeta: vi.fn(), setMeta: vi.fn() }));

import { fetchTmdbDetails, searchTmdb } from '@/utils/tmdb';

const shortKey = '0123456789abcdef0123456789abcdef';
// Identifiant synthétique : aucune clé ou session réelle dans ces tests.
const token = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(260)}.signature`;
const fetcher = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
  http.get.mockResolvedValue({ status: 200, data: { results: [] } });
});
afterEach(() => vi.unstubAllGlobals());

describe.each([false, true])('Authentification TMDB (Android : %s)', native => {
  beforeEach(() => { http.native = native; });

  it('conserve la clé courte dans api_key en retirant les espaces de collage', async () => {
    await searchTmdb('Clé courte', '', 'movie', `  ${shortKey}  `);
    const request = native ? http.get.mock.calls[0]![0] : { url: fetcher.mock.calls[0]![0], ...fetcher.mock.calls[0]![1] };
    expect(new URL(request.url).searchParams.get('api_key')).toBe(shortKey);
    expect(request.headers).not.toHaveProperty('Authorization');
  });

  it.each([token, `  Bearer ${token}  `])('envoie le jeton complet dans Authorization sans le mettre dans l’URL (%#)', async credential => {
    // Recherche et fiche partagent le même contrat d’authentification.
    await searchTmdb('Jeton TMDB', '', 'tv', credential);
    await fetchTmdbDetails(42, 'tv', credential);
    const requests = native ? http.get.mock.calls.map(([request]) => request) : fetcher.mock.calls.map(([url, options]) => ({ url, ...options }));
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.Authorization).toBe(`Bearer ${token}`);
      expect(new URL(request.url).searchParams.has('api_key')).toBe(false);
      expect(request.url).not.toContain(token);
    }
  });

  it('explique un refus d’authentification sans afficher le secret', async () => {
    fetcher.mockResolvedValue({ ok: false, status: 401 });
    http.get.mockResolvedValue({ status: 401, data: {} });
    await expect(searchTmdb('Refus TMDB', '', 'movie', token))
      .rejects.toThrow('Clé ou jeton TMDB refusé. Vérifie la valeur dans Réglages › Films et séries.');
  });
});
