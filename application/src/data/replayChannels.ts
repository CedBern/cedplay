/**
 * Chaînes françaises accessibles en replay (catch-up), avec le lien officiel.
 *
 * Conformément à l'exigence de légalité du projet, on n'ouvre que les plateformes
 * officielles (TF1+, M6+, france.tv, Arte) : l'app délègue la lecture au site ou à
 * l'application officielle, jamais à un flux privé rétro-ingéniéré.
 */

export interface ReplayPlatform {
  id: string;
  label: string;
  /** Couleur d'accent (badge) utilisée côté interface. */
  color: string;
  /**
   * Construit l'URL officielle permettant d'atteindre un programme à partir de son nom.
   * Selon la plateforme, c'est une page de recherche (M6+, france.tv, Arte) ou la page
   * directe du programme (TF1+, qui n'expose pas de page de recherche publique).
   */
  programUrl: (query: string) => string;
  /**
   * Paquets Android des applications officielles (IDs vérifiés sur le Play Store le
   * 8 novembre 2026). Pour la recherche, l'app officielle n'est ouverte que si elle
   * gère l'URL exacte : jamais de lancement « à l'aveugle » qui perdrait la requête.
   */
  androidPackages?: string[];
}

/**
 * Transforme un nom de programme en « slug » lisible façon TF1+ :
 * minuscules, sans accents ni apostrophes, espaces → tirets.
 * Ex. : « Koh-Lanta » → « koh-lanta », « L'héritière » → « lheritiere ».
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ReplayChannel {
  id: string;
  name: string;
  /** URL de replay officielle (ouverte dans l'app officielle si installée, sinon le navigateur). */
  url: string;
  platform: string;
  /** Couleur de la pastille du logo. */
  color: string;
  /** Marqueurs de nom utilisés pour retrouver le programme en cours dans l'EPG local. */
  epgNames: string[];
  /** Mention éventuelle (ex. compte requis). */
  note?: string;
}

export const replayPlatforms: ReplayPlatform[] = [
  // TF1+ n'a pas de page de recherche publique : on ouvre directement la page du programme (slug).
  { id: 'tf1plus', label: 'TF1+', color: '#1565c0', programUrl: q => `https://www.tf1.fr/tf1/${slugify(q)}`, androidPackages: ['fr.tf1.mytf1'] },
  { id: 'm6plus', label: 'M6+', color: '#6a1b9a', programUrl: q => `https://www.m6.fr/recherche?query=${encodeURIComponent(q)}`, androidPackages: ['fr.m6.m6replay'] },
  { id: 'francetv', label: 'france.tv', color: '#c62828', programUrl: q => `https://www.france.tv/recherche/?q=${encodeURIComponent(q)}`, androidPackages: ['fr.francetv.pluzz'] },
  { id: 'arte', label: 'Arte', color: '#ef6c00', programUrl: q => `https://www.arte.tv/fr/videos/recherche/?query=${encodeURIComponent(q)}`, androidPackages: ['tv.arte.plus7'] },
];

export const replayChannels: ReplayChannel[] = [
  // — TF1+ (groupe TF1) — la page d'une chaîne est la racine du domaine (le chemin /replay a été supprimé)
  { id: 'tf1', name: 'TF1', url: 'https://www.tf1.fr/tf1', platform: 'tf1plus', color: '#1565c0', epgNames: ['TF1'] },
  { id: 'tmc', name: 'TMC', url: 'https://www.tf1.fr/tmc', platform: 'tf1plus', color: '#0d47a1', epgNames: ['TMC'] },
  { id: 'tfx', name: 'TFX', url: 'https://www.tf1.fr/tfx', platform: 'tf1plus', color: '#1976d2', epgNames: ['TFX'] },
  { id: 'tf1sf', name: 'TF1 Séries Films', url: 'https://www.tf1.fr/tf1-series-films', platform: 'tf1plus', color: '#42a5f5', epgNames: ['TF1 Séries Films', 'TF1 Series Films'] },
  { id: 'lci', name: 'LCI', url: 'https://www.tf1.fr/lci', platform: 'tf1plus', color: '#1e88e5', epgNames: ['LCI'] },

  // — M6+ (groupe M6) — un compte M6+ (ex-6play) gratuit est requis
  { id: 'm6', name: 'M6', url: 'https://www.m6.fr/m6', platform: 'm6plus', color: '#6a1b9a', epgNames: ['M6'], note: 'Compte M6+ requis' },
  { id: 'w9', name: 'W9', url: 'https://www.m6.fr/w9', platform: 'm6plus', color: '#8e24aa', epgNames: ['W9'], note: 'Compte M6+ requis' },
  { id: '6ter', name: '6ter', url: 'https://www.m6.fr/6ter', platform: 'm6plus', color: '#ab47bc', epgNames: ['6ter'] },
  { id: 'gulli', name: 'Gulli', url: 'https://www.m6.fr/gulli', platform: 'm6plus', color: '#ba68c8', epgNames: ['Gulli'] },

  // — france.tv (France Télévisions)
  { id: 'france2', name: 'France 2', url: 'https://www.france.tv/france-2/', platform: 'francetv', color: '#c62828', epgNames: ['France 2'] },
  { id: 'france3', name: 'France 3', url: 'https://www.france.tv/france-3/', platform: 'francetv', color: '#d32f2f', epgNames: ['France 3'] },
  { id: 'france4', name: 'France 4', url: 'https://www.france.tv/france-4/', platform: 'francetv', color: '#e53935', epgNames: ['France 4'] },
  { id: 'france5', name: 'France 5', url: 'https://www.france.tv/france-5/', platform: 'francetv', color: '#ef5350', epgNames: ['France 5'] },
  { id: 'franceinfo', name: 'franceinfo', url: 'https://www.france.tv/franceinfo/', platform: 'francetv', color: '#ff7043', epgNames: ['franceinfo', 'Franceinfo', 'France Info'] },

  // — Arte
  { id: 'arte', name: 'Arte', url: 'https://www.arte.tv/fr/', platform: 'arte', color: '#ef6c00', epgNames: ['Arte'] },
];

export const platformOf = (id: string): ReplayPlatform => replayPlatforms.find(p => p.id === id)!;
