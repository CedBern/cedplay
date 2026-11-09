import { describe, it, expect } from 'vitest';
import {
  MAX_WATCH_OFFERS, parseWatchAvailability, providerLogoUrl, watchPackagesFor, watchPlatformName, watchUrlFor,
} from '@/utils/watchAvailability';

const provider = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  provider_id: id, provider_name: name, logo_path: `/logo-${id}.png`, display_priority: id, ...extra,
});

const payload = (country: Record<string, unknown>) => ({ id: 27205, results: { FR: country } });

describe('parseWatchAvailability', () => {
  it('range abonnement, gratuit, location puis achat et garde le lien TMDB', () => {
    const availability = parseWatchAvailability(payload({
      link: 'https://www.themoviedb.org/movie/27205/watch?locale=FR',
      buy: [provider(3, 'Apple TV')],
      rent: [provider(2, 'Google Play Movies')],
      flatrate: [provider(8, 'Netflix', { display_priority: 1 })],
    }));
    expect(availability?.region).toBe('FR');
    expect(availability?.link).toBe('https://www.themoviedb.org/movie/27205/watch?locale=FR');
    expect(availability?.offers.map(offer => [offer.name, offer.kind])).toEqual([
      ['Netflix', 'flatrate'],
      ['Google Play Movies', 'rent'],
      ['Apple TV', 'buy'],
    ]);
  });

  it('ne garde qu’une offre par fournisseur, la plus favorable', () => {
    const availability = parseWatchAvailability(payload({
      flatrate: [provider(9, 'Amazon Prime Video')],
      rent: [provider(9, 'Amazon Prime Video'), provider(2, 'Google Play Movies')],
    }));
    expect(availability?.offers.map(offer => offer.kind)).toEqual(['flatrate', 'rent']);
    expect(availability?.offers[0]).toMatchObject({ providerId: 9, platformId: 'primevideo' });
  });

  it('rapproche les noms TMDB des plateformes CedPlay et laisse les autres sans identifiant', () => {
    const availability = parseWatchAvailability(payload({
      flatrate: [
        provider(8, 'Netflix', { display_priority: 1 }),
        provider(119, 'Amazon Prime Video', { display_priority: 2 }),
        provider(337, 'Disney Plus', { display_priority: 3 }),
        provider(1899, 'HBO Max', { display_priority: 4 }),
        provider(234, 'Arte', { display_priority: 5 }),
        provider(3, 'Google Play Movies', { display_priority: 6 }),
      ],
    }));
    expect(availability?.offers.map(offer => offer.platformId))
      .toEqual(['netflix', 'primevideo', 'disneyplus', 'max', 'arte', null]);
    expect(availability?.offers.map(offer => offer.displayName))
      .toEqual(['Netflix', 'Prime Video', 'Disney+', 'Max', 'Arte', 'Google Play Movies']);
  });

  it('conserve le nom complet et le distributeur d’une offre Amazon Channel', () => {
    const availability = parseWatchAvailability(payload({
      flatrate: [
        provider(1825, 'HBO Max Amazon Channel', { display_priority: 1 }),
        provider(1853, 'Paramount Plus Amazon Channel', { display_priority: 2 }),
      ],
    }));
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
    const availability = parseWatchAvailability(payload({
      flatrate: [provider(1853, 'Paramount Plus Apple TV Channel')],
    }));
    expect(availability?.offers[0]).toMatchObject({
      name: 'Paramount Plus Apple TV Channel',
      displayName: 'Paramount Plus Apple TV Channel',
      platformId: 'appletv',
      distributedBy: 'Apple TV+',
    });
  });

  it('accepte un pays sans offre mais avec un lien', () => {
    const availability = parseWatchAvailability(payload({ link: 'https://www.themoviedb.org/movie/27205/watch' }));
    expect(availability).toMatchObject({ offers: [] });
  });

  it('ignore un pays absent ou une réponse vide', () => {
    expect(parseWatchAvailability(payload(undefined as unknown as Record<string, unknown>))).toBeNull();
    expect(parseWatchAvailability({ id: 1, results: {} })).toBeNull();
    expect(parseWatchAvailability({})).toBeNull();
  });

  it('borne le nombre d’offres affichées', () => {
    const flatrate = Array.from({ length: MAX_WATCH_OFFERS + 4 }, (_, index) => provider(index + 1, `Plateforme ${index + 1}`));
    expect(parseWatchAvailability(payload({ flatrate }))?.offers).toHaveLength(MAX_WATCH_OFFERS);
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
    expect(watchPlatformName('primevideo', 'Amazon Prime Video')).toBe('Prime Video');
    expect(watchPlatformName(null, 'Google Play Movies')).toBe('Google Play Movies');
    expect(watchPlatformName('primevideo', 'HBO Max Amazon Channel')).toBe('HBO Max Amazon Channel');
  });

  it('construit l’adresse du logo TMDB', () => {
    expect(providerLogoUrl('/abc.png')).toBe('https://image.tmdb.org/t/p/w45/abc.png');
    expect(providerLogoUrl(null)).toBe('');
  });
});
