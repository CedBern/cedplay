/**
 * Plateformes de streaming (SVOD / vidéo) accessibles via leur application ou site officiel.
 *
 * Comme pour le Replay, on n'ouvre que les plateformes officielles : l'app délègue la lecture
 * à l'application installée (deep link via ACTION_VIEW) ou au navigateur par défaut.
 * Aucun flux piraté, aucun contournement de DRM ni d'abonnement.
 */

export interface StreamingPlatform {
  id: string;
  name: string;
  /** URL officielle, ouverte dans l'app officielle si installée, sinon le navigateur. */
  url: string;
  /** Couleur de la pastille ou accent du logo. */
  color: string;
  /** Catégorie de la plateforme (pour filtres). */
  category?: 'svod' | 'free' | 'tv' | 'anime' | 'sport' | undefined;
  /** Étiquette informative (ex. SVOD, Gratuit, Anime). */
  badge?: string | undefined;
  /** Mention éventuelle (ex. abonnement requis). */
  note?: string | undefined;
}

export const streamingPlatforms: StreamingPlatform[] = [
  // — SVOD & Cinéma —
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com', color: '#e50914', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'primevideo', name: 'Prime Video', url: 'https://www.primevideo.com', color: '#00a8e1', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'disneyplus', name: 'Disney+', url: 'https://www.disneyplus.com', color: '#113ccf', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'max', name: 'Max', url: 'https://www.max.com', color: '#002be7', category: 'svod', badge: 'SVOD', note: 'Abonnement requis (ex-HBO Max)' },
  { id: 'appletv', name: 'Apple TV+', url: 'https://tv.apple.com', color: '#1d1d1f', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'canalplus', name: 'Canal+', url: 'https://www.canalplus.com', color: '#111111', category: 'svod', badge: 'Cinéma & Séries', note: 'Abonnement requis (myCANAL)' },
  { id: 'paramountplus', name: 'Paramount+', url: 'https://www.paramountplus.com', color: '#0064ff', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'ocs', name: 'OCS', url: 'https://www.canalplus.com/chaines/cine-plus-ocs/', color: '#ff5500', category: 'svod', badge: 'Cinéma & Séries', note: 'Ciné+ OCS (Abonnement)' },

  // — Anime & Spécialisé —
  { id: 'crunchyroll', name: 'Crunchyroll', url: 'https://www.crunchyroll.com', color: '#f47521', category: 'anime', badge: 'Anime', note: 'Gratuit & Abonnement' },
  { id: 'adn', name: 'ADN', url: 'https://animationdigitalnetwork.fr', color: '#0084ff', category: 'anime', badge: 'Anime', note: 'Animation Digital Network' },

  // — Gratuit & FAST / AVOD —
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', color: '#ff0000', category: 'free', badge: 'Vidéo & Live', note: 'Gratuit (option Premium)' },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv', color: '#9146ff', category: 'free', badge: 'Live & Gaming', note: 'Gratuit' },
  { id: 'plutotv', name: 'Pluto TV', url: 'https://www.pluto.tv', color: '#ffe600', category: 'free', badge: '100 % Gratuit', note: 'Chaînes FAST & VOD gratuite' },
  { id: 'rakutentv', name: 'Rakuten TV', url: 'https://www.rakuten.tv', color: '#bf0000', category: 'free', badge: 'Gratuit / VOD', note: 'Gratuit avec pub & Location' },
  { id: 'plex', name: 'Plex', url: 'https://www.plex.tv', color: '#e5a00d', category: 'free', badge: '100 % Gratuit', note: 'Films & Séries gratuits' },

  // — Télévision & Replay officiels —
  { id: 'molotov', name: 'Molotov', url: 'https://www.molotov.tv', color: '#0f7ce0', category: 'tv', badge: 'Direct & Replay', note: 'Gratuit (options payantes)' },
  { id: 'tf1plus', name: 'TF1+', url: 'https://www.tf1.fr', color: '#002b7f', category: 'tv', badge: 'Direct & Replay', note: 'Gratuit (compte requis)' },
  { id: 'm6plus', name: 'M6+', url: 'https://www.m6.fr', color: '#6a1b9a', category: 'tv', badge: 'Direct & Replay', note: 'Gratuit (compte requis)' },
  { id: 'francetv', name: 'france.tv', url: 'https://www.france.tv', color: '#c62828', category: 'tv', badge: 'Direct & Replay', note: '100 % Gratuit sans abonnement' },
  { id: 'arte', name: 'Arte', url: 'https://www.arte.tv/fr/', color: '#fa5000', category: 'tv', badge: 'Culture & Cinéma', note: '100 % Gratuit' },

  // — Sport —
  { id: 'dazn', name: 'DAZN', url: 'https://www.dazn.com', color: '#f8ff00', category: 'sport', badge: 'Sport & Ligue 1', note: 'Abonnement requis' },
];
