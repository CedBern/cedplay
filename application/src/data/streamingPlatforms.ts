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
  /**
   * Paquets Android des applications officielles, essayés dans l'ordre (mobile d'abord,
   * variante TV ensuite) avant de retomber sur le navigateur. IDs vérifiés sur le
   * Play Store le 8 novembre 2026. Absent : ouverture navigateur uniquement.
   */
  androidPackages?: string[] | undefined;
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
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com', androidPackages: ['com.netflix.mediaclient'], color: '#e50914', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'primevideo', name: 'Prime Video', url: 'https://www.primevideo.com', androidPackages: ['com.amazon.avod.thirdpartyclient', 'com.amazon.amazonvideo.livingroom'], color: '#00a8e1', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'disneyplus', name: 'Disney+', url: 'https://www.disneyplus.com', androidPackages: ['com.disney.disneyplus'], color: '#113ccf', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'max', name: 'Max', url: 'https://www.max.com', androidPackages: ['com.wbd.stream'], color: '#002be7', category: 'svod', badge: 'SVOD', note: 'Abonnement requis (ex-HBO Max)' },
  { id: 'appletv', name: 'Apple TV+', url: 'https://tv.apple.com', androidPackages: ['com.apple.atve.androidtv.appletv'], color: '#1d1d1f', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  { id: 'canalplus', name: 'Canal+', url: 'https://www.canalplus.com', androidPackages: ['com.canal.android.canal'], color: '#111111', category: 'svod', badge: 'Cinéma & Séries', note: 'Abonnement requis (myCANAL)' },
  { id: 'paramountplus', name: 'Paramount+', url: 'https://www.paramountplus.com', androidPackages: ['com.cbs.app'], color: '#0064ff', category: 'svod', badge: 'SVOD', note: 'Abonnement requis' },
  // OCS vit désormais dans myCANAL : même application que Canal+.
  { id: 'ocs', name: 'OCS', url: 'https://www.canalplus.com/chaines/cine-plus-ocs/', androidPackages: ['com.canal.android.canal'], color: '#ff5500', category: 'svod', badge: 'Cinéma & Séries', note: 'Ciné+ OCS (Abonnement)' },

  // — Anime & Spécialisé —
  { id: 'crunchyroll', name: 'Crunchyroll', url: 'https://www.crunchyroll.com', androidPackages: ['com.crunchyroll.crunchyroid'], color: '#f47521', category: 'anime', badge: 'Anime', note: 'Gratuit & Abonnement' },
  { id: 'adn', name: 'ADN', url: 'https://animationdigitalnetwork.fr', androidPackages: ['fr.anidn'], color: '#0084ff', category: 'anime', badge: 'Anime', note: 'Animation Digital Network' },

  // — Gratuit & FAST / AVOD —
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', androidPackages: ['com.google.android.youtube', 'com.google.android.youtube.tv'], color: '#ff0000', category: 'free', badge: 'Vidéo & Live', note: 'Gratuit (option Premium)' },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv', androidPackages: ['tv.twitch.android.app'], color: '#9146ff', category: 'free', badge: 'Live & Gaming', note: 'Gratuit' },
  { id: 'plutotv', name: 'Pluto TV', url: 'https://www.pluto.tv', androidPackages: ['tv.pluto.android'], color: '#ffe600', category: 'free', badge: '100 % Gratuit', note: 'Chaînes FAST & VOD gratuite' },
  { id: 'rakutentv', name: 'Rakuten TV', url: 'https://www.rakuten.tv', androidPackages: ['tv.wuaki'], color: '#bf0000', category: 'free', badge: 'Gratuit / VOD', note: 'Gratuit avec pub & Location' },
  { id: 'plex', name: 'Plex', url: 'https://www.plex.tv', androidPackages: ['com.plexapp.android'], color: '#e5a00d', category: 'free', badge: '100 % Gratuit', note: 'Films & Séries gratuits' },

  // — Télévision & Replay officiels —
  { id: 'molotov', name: 'Molotov', url: 'https://www.molotov.tv', androidPackages: ['tv.molotov.app'], color: '#0f7ce0', category: 'tv', badge: 'Direct & Replay', note: 'Gratuit (options payantes)' },
  { id: 'tf1plus', name: 'TF1+', url: 'https://www.tf1.fr', androidPackages: ['fr.tf1.mytf1'], color: '#002b7f', category: 'tv', badge: 'Direct & Replay', note: 'Gratuit (compte requis)' },
  { id: 'm6plus', name: 'M6+', url: 'https://www.m6.fr', androidPackages: ['fr.m6.m6replay'], color: '#6a1b9a', category: 'tv', badge: 'Direct & Replay', note: 'Gratuit (compte requis)' },
  { id: 'francetv', name: 'france.tv', url: 'https://www.france.tv', androidPackages: ['fr.francetv.pluzz'], color: '#c62828', category: 'tv', badge: 'Direct & Replay', note: '100 % Gratuit sans abonnement' },
  { id: 'arte', name: 'Arte', url: 'https://www.arte.tv/fr/', androidPackages: ['tv.arte.plus7'], color: '#fa5000', category: 'tv', badge: 'Culture & Cinéma', note: '100 % Gratuit' },

  // — Sport —
  { id: 'dazn', name: 'DAZN', url: 'https://www.dazn.com', androidPackages: ['com.dazn'], color: '#f8ff00', category: 'sport', badge: 'Sport & Ligue 1', note: 'Abonnement requis' },
];
