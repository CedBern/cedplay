/**
 * Détection et normalisation des plateformes de streaming et réseaux TV
 * pour l'affichage de logos vectoriels précis (locaux, sans dépendance réseau).
 */

export type PlatformCategory = 'all' | 'svod' | 'free' | 'tv' | 'anime' | 'sport';

export interface StreamingPlatformInfo {
  id: string;
  name: string;
  url: string;
  color: string;
  category: 'svod' | 'free' | 'tv' | 'anime' | 'sport';
  badge: string;
  note: string;
  /** Synonymes ou alias pour la détection automatique dans les listes de chaînes / VOD */
  aliases: string[];
}

export const STREAMING_PLATFORMS: StreamingPlatformInfo[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    url: 'https://www.netflix.com',
    color: '#E50914',
    category: 'svod',
    badge: 'SVOD',
    note: 'Abonnement requis',
    aliases: ['netflix', 'nflx'],
  },
  {
    id: 'disneyplus',
    name: 'Disney+',
    url: 'https://www.disneyplus.com',
    color: '#113CCF',
    category: 'svod',
    badge: 'SVOD',
    note: 'Abonnement requis',
    aliases: ['disney+', 'disney plus', 'disney'],
  },
  {
    id: 'primevideo',
    name: 'Prime Video',
    url: 'https://www.primevideo.com',
    color: '#00A8E1',
    category: 'svod',
    badge: 'SVOD',
    note: 'Abonnement requis (Amazon Prime)',
    aliases: ['prime video', 'amazon prime', 'primevideo', 'amazon video'],
  },
  {
    id: 'max',
    name: 'Max',
    url: 'https://www.max.com',
    color: '#002BE7',
    category: 'svod',
    badge: 'SVOD',
    note: 'Abonnement requis (ex-HBO Max)',
    aliases: ['hbo max', 'hbomax', 'hbo', 'warner max', 'max'],
  },
  {
    id: 'appletv',
    name: 'Apple TV+',
    url: 'https://tv.apple.com',
    color: '#1D1D1F',
    category: 'svod',
    badge: 'SVOD',
    note: 'Abonnement requis',
    aliases: ['apple tv+', 'apple tv plus', 'apple tv', 'appletv'],
  },
  {
    id: 'canalplus',
    name: 'Canal+',
    url: 'https://www.canalplus.com',
    color: '#111111',
    category: 'svod',
    badge: 'Cinéma & Séries',
    note: 'Abonnement requis (myCANAL)',
    aliases: ['canal+', 'canal plus', 'canal', 'mycanal'],
  },
  {
    id: 'paramountplus',
    name: 'Paramount+',
    url: 'https://www.paramountplus.com',
    color: '#0064FF',
    category: 'svod',
    badge: 'SVOD',
    note: 'Abonnement requis',
    aliases: ['paramount+', 'paramount plus', 'paramount'],
  },
  {
    id: 'crunchyroll',
    name: 'Crunchyroll',
    url: 'https://www.crunchyroll.com',
    color: '#F47521',
    category: 'anime',
    badge: 'Anime',
    note: 'Gratuit & Abonnement',
    aliases: ['crunchyroll'],
  },
  {
    id: 'adn',
    name: 'ADN',
    url: 'https://animationdigitalnetwork.fr',
    color: '#0084FF',
    category: 'anime',
    badge: 'Anime',
    note: 'Animation Digital Network',
    aliases: ['adn', 'animation digital network'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    url: 'https://www.youtube.com',
    color: '#FF0000',
    category: 'free',
    badge: 'Vidéo & Live',
    note: 'Gratuit (option Premium)',
    aliases: ['youtube', 'yt'],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    url: 'https://www.twitch.tv',
    color: '#9146FF',
    category: 'free',
    badge: 'Live & Gaming',
    note: 'Gratuit',
    aliases: ['twitch'],
  },
  {
    id: 'plutotv',
    name: 'Pluto TV',
    url: 'https://www.pluto.tv',
    color: '#FFE600',
    category: 'free',
    badge: '100 % Gratuit',
    note: 'Chaînes FAST & VOD gratuite',
    aliases: ['pluto tv', 'plutotv', 'pluto'],
  },
  {
    id: 'molotov',
    name: 'Molotov TV',
    url: 'https://www.molotov.tv',
    color: '#0F7CE0',
    category: 'tv',
    badge: 'Direct & Replay',
    note: 'Gratuit (options payantes)',
    aliases: ['molotov tv', 'molotov'],
  },
  {
    id: 'rakutentv',
    name: 'Rakuten TV',
    url: 'https://www.rakuten.tv',
    color: '#BF0000',
    category: 'free',
    badge: 'Gratuit / VOD',
    note: 'Gratuit avec pub & Location',
    aliases: ['rakuten tv', 'rakutentv', 'rakuten'],
  },
  {
    id: 'tf1plus',
    name: 'TF1+',
    url: 'https://www.tf1.fr',
    color: '#002B7F',
    category: 'tv',
    badge: 'Direct & Replay',
    note: 'Gratuit (compte requis)',
    aliases: ['tf1+', 'tf1 plus', 'tf1', 'mytf1', 'tmc', 'tfx', 'lci'],
  },
  {
    id: 'm6plus',
    name: 'M6+',
    url: 'https://www.m6.fr',
    color: '#6A1B9A',
    category: 'tv',
    badge: 'Direct & Replay',
    note: 'Gratuit (compte requis)',
    aliases: ['m6+', 'm6 plus', 'm6', '6play', 'w9', '6ter', 'gulli'],
  },
  {
    id: 'francetv',
    name: 'france.tv',
    url: 'https://www.france.tv',
    color: '#C62828',
    category: 'tv',
    badge: 'Direct & Replay',
    note: '100 % Gratuit sans abonnement',
    aliases: ['france.tv', 'francetv', 'france tv', 'france 2', 'france 3', 'france 4', 'france 5', 'franceinfo'],
  },
  {
    id: 'arte',
    name: 'Arte',
    url: 'https://www.arte.tv/fr/',
    color: '#FA5000',
    category: 'tv',
    badge: 'Culture & Cinéma',
    note: '100 % Gratuit',
    aliases: ['arte', 'arte.tv'],
  },
  {
    id: 'dazn',
    name: 'DAZN',
    url: 'https://www.dazn.com',
    color: '#F8FF00',
    category: 'sport',
    badge: 'Sport & Ligue 1',
    note: 'Abonnement requis',
    aliases: ['dazn'],
  },
  {
    id: 'plex',
    name: 'Plex',
    url: 'https://www.plex.tv',
    color: '#E5A00D',
    category: 'free',
    badge: '100 % Gratuit',
    note: 'Films & Séries gratuits',
    aliases: ['plex', 'plex tv'],
  },
  {
    id: 'ocs',
    name: 'OCS',
    url: 'https://www.canalplus.com/chaines/cine-plus-ocs/',
    color: '#FF5500',
    category: 'svod',
    badge: 'Cinéma & Séries',
    note: 'Ciné+ OCS (Abonnement)',
    aliases: ['ocs', 'cine+ ocs', 'cine ocs', 'orange cinema series'],
  },
];

/**
 * Normalise une chaîne de caractères pour comparaison insensible aux accents,
 * à la casse et aux séparateurs usuels.
 */
function clean(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_|:;–—\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Détecte si un nom de chaîne IPTV ou un titre de VOD correspond à une plateforme
 * ou un réseau de streaming connu.
 *
 * @param name Nom de la chaîne ou du groupe (ex. "FR | NETFLIX 4K", "DISNEY+ CINEMA", "Prime Video 1")
 * @returns Identifiant de la plateforme (ex. 'netflix', 'disneyplus') ou null si non reconnu.
 */
export function matchStreamingPlatformOrNetwork(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = clean(name);
  if (!s) return null;

  // 1. Détections prioritaires par mots-clés spécifiques
  if (/\bnetflix\b/.test(s)) return 'netflix';
  if (/\bdisney\s*\+?|\bdisney\s*plus\b/.test(s)) return 'disneyplus';
  if (/\bprime\s*video\b|\bamazon\s*prime\b|\bprimevideo\b/.test(s)) return 'primevideo';
  if (/\bapple\s*tv\b|\bappletv\b/.test(s)) return 'appletv';
  if (/\bparamount\b/.test(s)) return 'paramountplus';
  if (/\bhbo\s*max\b|\bhbo\b|\bwarner\s*max\b/.test(s)) return 'max';
  if (/\bmax\b/.test(s) && (/\b(4k|fhd|uhd|hd|cinema|series|cine|vod|fr|us)\b/.test(s) || s === 'max')) return 'max';
  if (/\bcanal\s*\+|\bcanal\s*plus\b|\bmycanal\b/.test(s)) return 'canalplus';
  if (/\bcrunchyroll\b/.test(s)) return 'crunchyroll';
  if (/\byoutube\b/.test(s)) return 'youtube';
  if (/\btwitch\b/.test(s)) return 'twitch';
  if (/\bpluto\s*tv\b|\bplutotv\b/.test(s)) return 'plutotv';
  if (/\brakuten\b/.test(s)) return 'rakutentv';
  if (/\bmolotov\b/.test(s)) return 'molotov';
  if (/\b(tf1\+|mytf1|tf1\b|tmc\b|tfx\b|lci\b)/.test(s)) return 'tf1plus';
  if (/\b(m6\+|6play|m6\b|w9\b|6ter\b|gulli\b)/.test(s)) return 'm6plus';
  if (/\b(france\s*tv|francetv|france\s*[2345]\b|franceinfo\b)/.test(s)) return 'francetv';
  if (/\barte\b/.test(s)) return 'arte';
  if (/\b(adn\b|animation\s*digital\s*network)/.test(s)) return 'adn';
  if (/\bdazn\b/.test(s)) return 'dazn';
  if (/\bplex\b/.test(s)) return 'plex';
  if (/\b(ocs\b|cine\+\s*ocs)/.test(s)) return 'ocs';

  // 2. Réseaux sportifs usuels
  if (/\bbein\s*sports?\b/.test(s)) return 'beinsports';
  if (/\beurosport\b/.test(s)) return 'eurosport';

  return null;
}
