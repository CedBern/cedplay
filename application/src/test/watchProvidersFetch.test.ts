import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ native: false, get: vi.fn() }));
const meta = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => http.native },
  CapacitorHttp: { get: http.get },
}));
vi.mock('@/utils/idb', () => ({
  getMeta: async (key: string) => meta.store.get(key),
  setMeta: async (key: string, value: unknown) => { meta.store.set(key, value); },
}));

import { fetchWatchProviders } from '@/utils/tmdb';

const payload = {
  id: 27205,
  results: {
    FR: {
      link: 'https://www.themoviedb.org/movie/27205/watch?locale=FR',
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png', display_priority: 1 }],
    },
  },
};
const fetcher = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  meta.store.clear();
  http.native = false;
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockResolvedValue({ ok: true, json: async () => payload });
  http.get.mockResolvedValue({ status: 200, data: payload });
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchWatchProviders', () => {
  it('interroge le point TMDB du pays puis sert le cache 12 h', async () => {
    const first = await fetchWatchProviders(27205, 'movie', 'cle-test', 'FR');
    expect(first?.offers[0]).toMatchObject({ name: 'Netflix', platformId: 'netflix' });
    expect(new URL(fetcher.mock.calls[0]![0] as string).pathname).toBe('/3/movie/27205/watch/providers');

    const second = await fetchWatchProviders(27205, 'movie', 'cle-test', 'FR');
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('met le pays dans la clé de cache : le Mexique ne relit pas les offres françaises', async () => {
    await fetchWatchProviders(27205, 'movie', 'cle-test', 'FR');
    const mexico = await fetchWatchProviders(27205, 'movie', 'cle-test', 'MX');
    expect(mexico).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect([...meta.store.keys()]).toEqual(expect.arrayContaining([
      'tmdb_providers_movie_27205_FR',
      'tmdb_providers_movie_27205_MX',
    ]));
  });

  it('passe par CapacitorHttp sur Android et distingue films et séries', async () => {
    http.native = true;
    const availability = await fetchWatchProviders(42, 'tv', 'cle-test', 'FR');
    expect(availability?.region).toBe('FR');
    expect((http.get.mock.calls[0]![0] as { url: string }).url).toContain('/3/tv/42/watch/providers');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
