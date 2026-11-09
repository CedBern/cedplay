import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WATCH_REGION, MAX_WATCH_OFFERS, normalizeWatchRegion, normalizeWatchSubscriptions,
  parseWatchAvailability, providerLogoUrl, watchPackagesFor, watchPlatformName, watchRegionLabel,
  watchRegionPhrase, watchUrlFor,
} from '@/utils/watchAvailability';

const provider = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  provider_id: id, provider_name: name, logo_path: `/logo-${id}.png`, display_priority: id, ...extra,
});

/** Réponse TMDB d'un pays, lue en France sauf mention contraire. */
const payload = (country: Record<string, unknown>, region = 'FR') => ({ id: 27205, results: { [region]: country } });
const parseFR = (country: Record<string, unknown>) => parseWatchAvailability(payload(country), 'FR');

describe('parseWatchAvailability', () => {
  it('range abonnement, gratuit, location puis achat et garde le lien TMDB', () => {
    const availability = parseFR({
      link: 'https://www.themoviedb.org/movie/27205/watch?locale=FR',
      buy: [provider(3, 'Apple TV')],
      rent: [provider(2, 'Google Play Movies')],
      flatrate: [provider(8, 'Netflix', { display_priority: 1 })],
    });
    expect(availability?.region).toBe('FR');
    expect(availability?.link).toBe('https://www.themoviedb.org/movie/27205/watch?locale=FR');
    expect(availability?.offers.map(offer => [offer.name, offer.kind])).toEqual([
      ['Netflix', 'flatrate'],
      ['Google Play Movies', 'rent'],
      ['Apple TV', 'buy'],
    ]);
  });

  it('ne garde qu’une offre par fournisseur, la plus favorable', () => {
    const availability = parseFR({
      flatrate: [provider(9, 'Amazon Prime Video')],
      rent: [provider(9, 'Amazon Prime Video'), provider(2, 'Google Play Movies')],
    });
    expect(availability?.offers.map(offer => offer.kind)).toEqual(['flatrate', 'rent']);
    expect(availability?.offers[0]).toMatchObject({ providerId: 9, platformId: 'primevideo' });
  });

  it('rapproche les noms TMDB des plateformes CedPlay et laisse les autres sans identifiant', () => {
    const availability = parseFR({
      flatrate: [
        provider(8, 'Netflix', { display_priority: 1 }),
        provider(119, 'Amazon Prime Video', { display_priority: 2 }),
        provider(337, 'Disney Plus', { display_priority: 3 }),
        provider(1899, 'HBO Max', { display_priority: 4 }),
        provider(234, 'Arte', { display_priority: 5 }),
        provider(3, 'Google Play Movies', { display_priority: 6 }),
      ],
    });
    expect(availability?.offers.map(offer => offer.platformId))
      .toEqual(['netflix', 'primevideo', 'disneyplus', 'max', 'arte', null]);
    expect(availability?.offers.map(offer => offer.displayName))
      .toEqual(['Netflix', 'Prime Video', 'Disney+', 'Max', 'Arte', 'Google Play Movies']);
  });

  it('lit le Mexique par défaut et ignore les offres des autres pays', () => {
    const data = {
      id: 27205,
      results: {
        MX: { flatrate: [provider(8, 'Netflix'), provider(457, 'VIX'), provider(167, 'Claro video')] },
        FR: { flatrate: [provider(337, 'Disney Plus')] },
      },
    };
    const mexico = parseWatchAvailability(data);
    expect(mexico?.region).toBe(DEFAULT_WATCH_REGION);
    expect(mexico?.offers.map(offer => offer.platformId)).toEqual(['netflix', 'clarovideo', 'vix']);
    expect(parseWatchAvailability(data, 'FR')?.offers.map(offer => offer.displayName)).toEqual(['Disney+']);
  });

  it('reconnaît les variantes mexicaines et les offres avec publicité', () => {
    const availability = parseWatchAvailability({
      id: 1,
      results: { MX: { flatrate: [provider(1796, 'Netflix Standard with Ads'), provider(2303, 'Paramount Plus Premium')] } },
    });
    expect(availability?.offers.map(offer => offer.displayName)).toEqual(['Netflix', 'Paramount+']);
  });

  it('conserve le nom complet et le distributeur d’une offre Amazon Channel', () => {
    const availability = parseFR({
      flatrate: [
        provider(1825, 'HBO Max Amazon Channel', { display_priority: 1 }),
        provider(1853, 'Paramount Plus Amazon Channel', { display_priority: 2 }),
      ],
    });
    expect(availability?.offers.map(offer => [offer.name, offer.displayName, offer.platformId, offer.distributedBy]))
      .toEqual([
        ['HBO Max Amazon Channel', 'HBO Max Amazon Channel', 'primevideo', 'Prime Video'],
        ['Paramount Plus Amazon Channel', 'Paramount Plus Amazon Channel', 'primevideo', 'Prime Video'],
      ]);
    expect(watchUrlFor(availability?.offers[0]?.platformId ?? null, 'Inception'))
      .toBe('https://www.primevideo.com/search/ref=atv_nb_sr?phrase=Inception');
    const first = availability?.offers[0];
    expect(watchPlatformName(first?.platformId ?? null, first?.name ?? '')).toBe('HBO Max Amazon Channel');
  });

  it('garde le service Paramount dans une offre Apple TV Channel', () => {
    const availability = parseFR({
      flatrate: [provider(1853, 'Paramount Plus Apple TV Channel')],
    });
    expect(availability?.offers[0]).toMatchObject({
      name: 'Paramount Plus Apple TV Channel',
      displayName: 'Paramount Plus Apple TV Channel',
      platformId: 'appletv',
      distributedBy: 'Apple TV+',
    });
  });

  it('accepte un pays sans offre mais avec un lien', () => {
    const availability = parseFR({ link: 'https://www.themoviedb.org/movie/27205/watch' });
    expect(availability).toMatchObject({ offers: [] });
  });

  it('ignore un pays absent ou une réponse vide', () => {
    expect(parseFR(undefined as unknown as Record<string, unknown>)).toBeNull();
    expect(parseWatchAvailability({ id: 1, results: {} })).toBeNull();
    expect(parseWatchAvailability({})).toBeNull();
  });

  it('borne le nombre d’offres affichées', () => {
    const flatrate = Array.from({ length: MAX_WATCH_OFFERS + 4 }, (_, index) => provider(index + 1, `Plateforme ${index + 1}`));
    expect(parseFR({ flatrate })?.offers).toHaveLength(MAX_WATCH_OFFERS);
  });
});

describe('pays des offres', () => {
  it('normalise un code pays et retombe sur le Mexique', () => {
    expect(normalizeWatchRegion('mx')).toBe('MX');
    expect(normalizeWatchRegion(' fr ')).toBe('FR');
    expect(normalizeWatchRegion('ZZ')).toBe(DEFAULT_WATCH_REGION);
    expect(normalizeWatchRegion(undefined)).toBe(DEFAULT_WATCH_REGION);
    expect(DEFAULT_WATCH_REGION).toBe('MX');
  });

  it('nomme et situe le pays pour les libellés', () => {
    expect(watchRegionLabel('MX')).toBe('Mexique');
    expect(watchRegionPhrase('MX')).toBe('au Mexique');
    expect(watchRegionPhrase('FR')).toBe('en France');
    expect(watchRegionPhrase('US')).toBe('aux États-Unis');
    expect(watchRegionLabel('ZZ')).toBe('ZZ');
  });

  it('nettoie la liste des abonnements retenus', () => {
    expect(normalizeWatchSubscriptions([8, 8, 0, -2, 1.5, 119])).toEqual([8, 119]);
    expect(normalizeWatchSubscriptions(undefined)).toEqual([]);
    expect(normalizeWatchSubscriptions(['8'])).toEqual([]);
  });
});

describe('watchUrlFor', () => {
  it('encode la recherche du titre sur les sites connus', () => {
    expect(watchUrlFor('netflix', 'Le Fabuleux Destin d’Amélie Poulain'))
      .toBe('https://www.netflix.com/search?q=Le%20Fabuleux%20Destin%20d%E2%80%99Am%C3%A9lie%20Poulain');
    expect(watchUrlFor('arte', 'Inception')).toBe('https://www.arte.tv/fr/videos/recherche/?query=Inception');
  });

  it('retombe sur l’accueil de la plateforme sans chemin de recherche connu', () => {
    expect(watchUrlFor('max', 'Inception')).toBe('https://www.max.com');
  });

  it('ouvre le site des plateformes régionales sans tuile dans le Direct', () => {
    expect(watchUrlFor('vix', 'Inception')).toBe('https://vix.com');
    expect(watchUrlFor('clarovideo', 'Inception')).toBe('https://www.clarovideo.com');
    expect(watchUrlFor('tubi', 'Inception')).toBe('https://tubitv.com');
  });

  it('renvoie null pour une plateforme inconnue', () => {
    expect(watchUrlFor(null, 'Inception')).toBeNull();
    expect(watchUrlFor('inconnue', 'Inception')).toBeNull();
  });
});

describe('aides d’ouverture', () => {
  it('donne les paquets Android de la plateforme connue', () => {
    expect(watchPackagesFor('netflix')).toEqual(['com.netflix.mediaclient', 'com.netflix.ninja']);
    expect(watchPackagesFor('primevideo')).toEqual(['com.amazon.avod.thirdpartyclient', 'com.amazon.amazonvideo.livingroom']);
    expect(watchPackagesFor('inconnue')).toBeUndefined();
    expect(watchPackagesFor(null)).toBeUndefined();
    expect(watchPackagesFor('vix')).toBeUndefined();
    expect(watchPlatformName('primevideo', 'Amazon Prime Video')).toBe('Prime Video');
    expect(watchPlatformName(null, 'Google Play Movies')).toBe('Google Play Movies');
    expect(watchPlatformName('primevideo', 'HBO Max Amazon Channel')).toBe('HBO Max Amazon Channel');
    expect(watchPlatformName('vix', 'VIX')).toBe('ViX');
  });

  it('construit l’adresse du logo TMDB', () => {
    expect(providerLogoUrl('/abc.png')).toBe('https://image.tmdb.org/t/p/w45/abc.png');
    expect(providerLogoUrl(null)).toBe('');
  });
});
