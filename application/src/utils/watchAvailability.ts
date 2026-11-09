/**
 * Disponibilité légale d'un titre (TMDB / watch providers) et ouverture de l'app
 * officielle de la plateforme qui le propose.
 *
 * Aucun flux tiers n'est manipulé : on affiche seulement où un film est diffusé
 * légalement en France, puis on délègue à l'application officielle (ou au site)
 * exactement comme les tuiles « Plateformes » du Direct.
 */

import { streamingPlatforms } from '@/data/streamingPlatforms';

export type WatchOfferKind = 'flatrate' | 'free' | 'ads' | 'rent' | 'buy';

export interface WatchOffer {
  providerId: number;
  /** Nom complet renvoyé par TMDB (distributeur compris, ex. « HBO Max Amazon Channel »). */
  name: string;
  /** Libellé à afficher : plateforme CedPlay, ou nom TMDB complet pour une offre distribuée. */
  displayName: string;
  logoPath: string | null;
  kind: WatchOfferKind;
  displayPriority: number;
  /** Identifiant CedPlay de la plateforme à ouvrir (app officielle du distributeur si besoin). */
  platformId: string | null;
  /** Distributeur d'une offre packagée (Amazon Channel, Apple TV Channel), sinon null. */
  distributedBy: string | null;
}

export interface WatchAvailability {
  /** Pays interrogé (TMDB ne renvoie que les offres de ce pays). */
  region: string;
  /** Page TMDB des offres : repli quand le fournisseur n'a pas d'app connue. */
  link: string;
  offers: WatchOffer[];
}

/** L'application est francophone : les offres affichées sont celles de la France. */
export const WATCH_REGION = 'FR';
export const MAX_WATCH_OFFERS = 8;

const KIND_ORDER: WatchOfferKind[] = ['flatrate', 'free', 'ads', 'rent', 'buy'];

export const OFFER_KIND_LABELS: Record<WatchOfferKind, string> = {
  flatrate: 'abonnement',
  free: 'gratuit',
  ads: 'gratuit avec pub',
  rent: 'location',
  buy: 'achat',
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Correspondance explicite des fournisseurs TMDB (nom normalisé → plateforme CedPlay).
 *
 * On ne réutilise pas le détecteur des listes IPTV : il reconnaît la marque contenue
 * dans le nom et confond une offre distribuée avec le service autonome
 * (« HBO Max Amazon Channel » lu comme Max). Seuls les noms connus sont rapprochés.
 */
const TMDB_PROVIDER_PLATFORMS: Record<string, string> = {
  netflix: 'netflix',
  'netflix basic with ads': 'netflix',
  'netflix with ads': 'netflix',
  'amazon prime video': 'primevideo',
  'amazon prime video with ads': 'primevideo',
  'prime video': 'primevideo',
  'amazon video': 'primevideo',
  'disney plus': 'disneyplus',
  'disney plus with ads': 'disneyplus',
  'hbo max': 'max',
  'hbo max with ads': 'max',
  max: 'max',
  'apple tv': 'appletv',
  'apple tv plus': 'appletv',
  'paramount plus': 'paramountplus',
  'paramount plus with ads': 'paramountplus',
  'canal plus': 'canalplus',
  'mycanal': 'canalplus',
  'crunchyroll': 'crunchyroll',
  'adn': 'adn',
  'animation digital network': 'adn',
  'youtube': 'youtube',
  'youtube premium': 'youtube',
  'twitch': 'twitch',
  'pluto tv': 'plutotv',
  'rakuten tv': 'rakutentv',
  'plex': 'plex',
  'molotov': 'molotov',
  'tf1 plus': 'tf1plus',
  'tf1': 'tf1plus',
  'm6 plus': 'm6plus',
  'm6': 'm6plus',
  'france tv': 'francetv',
  'francetv': 'francetv',
  'arte': 'arte',
  'arte tv': 'arte',
  'dazn': 'dazn',
  'ocs': 'ocs',
  'cine plus ocs': 'ocs',
};

/**
 * Offres packagées : le service est vendu par un distributeur (Amazon, Apple TV).
 * Le nom TMDB complet est conservé et c'est l'application du distributeur qui est
 * ouverte, puisque c'est là que l'offre se regarde.
 */
const DISTRIBUTED_OFFERS: Array<{ suffix: RegExp; platformId: string }> = [
  { suffix: / amazon channel$/, platformId: 'primevideo' },
  { suffix: / apple tv channel$/, platformId: 'appletv' },
];

/** Normalise un nom de fournisseur TMDB : casse, accents, « + » et séparateurs. */
function providerKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveProvider(name: string): Pick<WatchOffer, 'platformId' | 'displayName' | 'distributedBy'> {
  const key = providerKey(name);
  const distributed = DISTRIBUTED_OFFERS.find(entry => entry.suffix.test(key));
  if (distributed) {
    const distributor = streamingPlatforms.find(p => p.id === distributed.platformId);
    return {
      platformId: distributed.platformId,
      displayName: name,
      distributedBy: distributor?.name ?? null,
    };
  }
  const platformId = TMDB_PROVIDER_PLATFORMS[key] ?? null;
  const platform = platformId ? streamingPlatforms.find(p => p.id === platformId) : undefined;
  return {
    platformId: platform?.id ?? null,
    displayName: platform?.name ?? name,
    distributedBy: null,
  };
}

export function providerLogoUrl(logoPath: string | null): string {
  return logoPath ? `https://image.tmdb.org/t/p/w45${logoPath}` : '';
}

/**
 * Lit la réponse `/movie|tv/{id}/watch/providers`.
 *
 * TMDB range les fournisseurs par mode d'accès ; un même fournisseur peut apparaître
 * en abonnement **et** en location (Prime Video par exemple). On ne garde que le mode
 * le plus favorable, puis on trie : abonnement, gratuit, pub, location, achat.
 */
export function parseWatchAvailability(data: unknown, region = WATCH_REGION): WatchAvailability | null {
  const results = object(object(data).results);
  const country = object(results[region]);
  const link = str(country.link);
  const byProvider = new Map<number, WatchOffer>();
  for (const kind of KIND_ORDER) {
    const group = country[kind];
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const value = object(raw);
      const providerId = num(value.provider_id);
      const name = str(value.provider_name);
      if (providerId <= 0 || !name || byProvider.has(providerId)) continue;
      byProvider.set(providerId, {
        providerId,
        name,
        logoPath: str(value.logo_path) || null,
        kind,
        displayPriority: num(value.display_priority),
        ...resolveProvider(name),
      });
    }
  }
  const offers = [...byProvider.values()]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      || a.displayPriority - b.displayPriority
      || a.name.localeCompare(b.name, 'fr'))
    .slice(0, MAX_WATCH_OFFERS);
  if (!offers.length && !link) return null;
  return { region, link, offers };
}

/**
 * Recherche du titre sur la plateforme. Les adresses de recherche ne sont déclarées
 * que pour les sites dont le chemin est stable ; les autres retombent sur l'accueil
 * du site, que le pont Android ouvre alors dans l'app officielle (`allowAppHome`).
 */
const SEARCH_URLS: Record<string, (query: string) => string> = {
  netflix: query => `https://www.netflix.com/search?q=${query}`,
  primevideo: query => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${query}`,
  disneyplus: query => `https://www.disneyplus.com/search?q=${query}`,
  youtube: query => `https://www.youtube.com/results?search_query=${query}`,
  crunchyroll: query => `https://www.crunchyroll.com/search?q=${query}`,
  // Chemins déjà utilisés par le Replay officiel de CedPlay.
  arte: query => `https://www.arte.tv/fr/videos/recherche/?query=${query}`,
  francetv: query => `https://www.france.tv/recherche/?q=${query}`,
  m6plus: query => `https://www.m6.fr/recherche?query=${query}`,
};

/** URL à ouvrir pour un fournisseur connu, ou `null` s'il n'a pas d'app/site CedPlay. */
export function watchUrlFor(platformId: string | null, title: string): string | null {
  const platform = platformId ? streamingPlatforms.find(p => p.id === platformId) : undefined;
  if (!platform) return null;
  const search = SEARCH_URLS[platform.id];
  return search ? search(encodeURIComponent(title.trim())) : platform.url;
}

/** Paquets Android de l'app officielle du fournisseur (vide si la plateforme est inconnue). */
export function watchPackagesFor(platformId: string | null): string[] | undefined {
  const platform = platformId ? streamingPlatforms.find(p => p.id === platformId) : undefined;
  return platform?.androidPackages;
}

/**
 * Nom à afficher pour une offre : le nom TMDB complet quand l'offre est distribuée
 * (le service vendu par Amazon/Apple TV ne doit pas disparaître), sinon le nom de
 * la plateforme CedPlay reconnue.
 */
export function watchPlatformName(platformId: string | null, fallback: string): string {
  if (DISTRIBUTED_OFFERS.some(entry => entry.suffix.test(providerKey(fallback)))) return fallback;
  const platform = platformId ? streamingPlatforms.find(p => p.id === platformId) : undefined;
  return platform?.name ?? fallback;
}
