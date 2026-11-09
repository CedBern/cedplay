// Pays des offres : liste des fournisseurs d'un pays et rangée /discover filtrée.
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

import { fetchDiscover, fetchRegionProviders, parseRegionProviders } from '@/utils/tmdb';

const providersPayload = {
  results: [
    { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png', display_priorities: { MX: 1, FR: 4 } },
    { provider_id: 457, provider_name: 'VIX', logo_path: '/v.png', display_priorities: { MX: 3 } },
    { provider_id: 9999, provider_name: 'Ailleurs', logo_path: null, display_priorities: { US: 2 } },
  ],
};

const discoverPayload = {
  results: [
    { id: 603, title: 'Matrix', release_date: '1999-03-31', poster_path: '/m.jpg', vote_average: 8.2 },
    { id: 604, title: 'Sans affiche', first_air_date: '2001-01-01', poster_path: null, vote_average: 7 },
    { id: 0, title: '' },
  ],
};

const fetcher = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  meta.store.clear();
  http.native = false;
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockResolvedValue({ ok: true, json: async () => providersPayload });
});
afterEach(() => vi.unstubAllGlobals());

describe('parseRegionProviders', () => {
  it('ne garde que les fournisseurs du pays, triés par priorité', () => {
    expect(parseRegionProviders(providersPayload, 'MX').map(p => [p.providerId, p.name, p.priority]))
      .toEqual([[8, 'Netflix', 1], [457, 'VIX', 3]]);
    expect(parseRegionProviders(providersPayload, 'FR').map(p => p.name)).toEqual(['Netflix']);
    expect(parseRegionProviders({ results: [] }, 'MX')).toEqual([]);
    expect(parseRegionProviders({}, 'MX')).toEqual([]);
  });
});

describe('fetchRegionProviders', () => {
  it('demande la liste du pays à TMDB puis sert le cache', async () => {
    const first = await fetchRegionProviders('MX', 'cle-test');
    expect(first.map(p => p.name)).toEqual(['Netflix', 'VIX']);
    const url = new URL(fetcher.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/3/watch/providers/movie');
    expect(url.searchParams.get('watch_region')).toBe('MX');

    await fetchRegionProviders('MX', 'cle-test');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('fetchDiscover', () => {
  it('filtre par pays, fournisseurs et genres, puis sert le cache', async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => discoverPayload });
    const first = await fetchDiscover('movie', { region: 'MX', providerIds: [119, 8, 8], genreIds: [28, 12, 99] }, 'cle-test');
    expect(first.map(item => item.title)).toEqual(['Matrix', 'Sans affiche']);

    const url = new URL(fetcher.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/3/discover/movie');
    expect(url.searchParams.get('watch_region')).toBe('MX');
    expect(url.searchParams.get('with_watch_providers')).toBe('8|119');
    // Sans ce filtre, /discover rend aussi la location et l'achat : ce ne sont pas des abonnements.
    expect(url.searchParams.get('with_watch_monetization_types')).toBe('flatrate');
    expect(url.searchParams.get('with_genres')).toBe('28,12');

    await fetchDiscover('movie', { region: 'MX', providerIds: [8, 119], genreIds: [28, 12] }, 'cle-test');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ne fait aucun appel sans abonnement coché', async () => {
    expect(await fetchDiscover('tv', { region: 'MX', providerIds: [] }, 'cle-test')).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sépare le cache par pays', async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => discoverPayload });
    await fetchDiscover('movie', { region: 'MX', providerIds: [8] }, 'cle-test');
    await fetchDiscover('movie', { region: 'FR', providerIds: [8] }, 'cle-test');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
