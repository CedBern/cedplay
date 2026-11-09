import { normalizeForCompare, normalizeTitle } from '@/utils/titleNormalize';
import type { PlayHistoryEntry } from '@/utils/idb';

/**
 * Extrait un titre affichable et une année depuis un nom de fichier vidéo local.
 * Pur (aucun accès réseau/DOM) : réutilise la normalisation VOD existante.
 */
export function parseLocalFilename(filename: string): { title: string; year: string } {
  const base = filename
    .replace(/\.[^.]+$/, '')   // retire l'extension
    .replace(/[._]+/g, ' ');   // noms « release » séparés par des points/underscores
  const { title, year } = normalizeTitle(base);
  return { title: title || base.trim(), year };
}

export type LocalWorkKind = 'movie' | 'series';

/** Œuvre de la bibliothèque locale, dédoublonnée : un dossier de séries pèse
 * une œuvre, pas un épisode par fichier. */
export interface LocalWork {
  title: string;
  year: string;
  kind: LocalWorkKind;
  /** Date du fichier le plus récent de l'œuvre (ms) ; 0 si inconnue. */
  lastModified: number;
}

/** Borne l'index : une clé USB de 2 000 fichiers ne doit ni peser ni coûter cher. */
export const LOCAL_LIBRARY_MAX_WORKS = 300;

/** Douze œuvres récentes suffisent à amorcer le rail sans saturer le catalogue. */
export const LOCAL_SEED_LIMIT = 12;

/** Marqueur de saison/épisode : « S01E02 », « 1x02 », « Saison 3 », « Episode 4 ». */
const EPISODE_MARKER = /(?:\bS\d{1,2}\s*E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b|(?:^|\s)(?:season|saison|episode|épisode|ep)\s*\d{1,3}\b)/i;

/**
 * Titre, année et type d'une vidéo locale. Un nom d'épisode est ramené au titre
 * de la série : sans cela, chaque épisode compterait comme un film différent.
 */
export function parseLocalMediaName(filename: string): { title: string; year: string; kind: LocalWorkKind } {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ');
  const marker = EPISODE_MARKER.exec(base);
  const head = marker ? base.slice(0, marker.index) : base;
  const title = normalizeTitle(head).title.replace(/[\s._\-–—:]+$/, '').trim();
  const kind: LocalWorkKind = marker ? 'series' : 'movie';
  // Une série porte souvent son année après le marqueur d'épisode : la lire sur
  // le nom complet évite de perdre « Breaking Bad S01E02 2008 ».
  return { title: title || base.trim(), year: normalizeTitle(base).year, kind };
}

/** Œuvres dédoublonnées d'une analyse, de la plus récente à la plus ancienne. */
export function localLibraryWorks(
  files: readonly { name: string; lastModified: number }[],
  cap = LOCAL_LIBRARY_MAX_WORKS,
): LocalWork[] {
  const byKey = new Map<string, LocalWork>();
  for (const file of files) {
    const parsed = parseLocalMediaName(file.name);
    if (!parsed.title) continue;
    const key = `${parsed.kind}|${normalizeForCompare(parsed.title)}|${parsed.year}`;
    const lastModified = Number.isFinite(file.lastModified) && file.lastModified > 0 ? file.lastModified : 0;
    const known = byKey.get(key);
    if (!known || lastModified > known.lastModified) byKey.set(key, { ...parsed, lastModified });
  }
  return [...byKey.values()]
    .sort((a, b) => b.lastModified - a.lastModified || a.title.localeCompare(b.title, 'fr'))
    .slice(0, cap);
}

/**
 * Visionnages synthétiques pour le classement « Pour toi » : posséder un film
 * dans sa bibliothèque locale vaut un visionnage récent. Ces entrées ne sont
 * jamais enregistrées dans l'historique ; seule leur jointure au catalogue
 * (`externalSeeds`) les exploite.
 */
export function localLibraryWatches(works: readonly LocalWork[], ts = Date.now()): PlayHistoryEntry[] {
  return works.map(work => ({
    channelId: `library:${work.kind}:${normalizeForCompare(work.title).replace(/ /g, '-')}${work.year ? `-${work.year}` : ''}`,
    ts,
    kind: 'vod',
    mediaKind: work.kind,
    name: work.title,
    status: 'completed',
    ...(work.year ? { year: work.year } : {}),
  }));
}

/** Formate une taille d'octets en unité lisible (Ko, Mo, Go…). */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
