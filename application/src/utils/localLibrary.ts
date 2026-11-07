import { normalizeTitle } from '@/utils/titleNormalize';

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
