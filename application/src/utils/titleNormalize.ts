/**
 * Normalisation de titres VOD pour le rapprochement avec TMDB
 * et les recommandations locales. Pur (aucun accès réseau/DOM).
 */

const QUALITY_TAGS = /(\b(?:4k|uhd|hdr|hd|hdrip|hdlight|web-?dl|webrip|dvdrip|dvdr|brrip|bdrip|blu-?ray|x26[45]|h26[45]|hevc|av1|10bit|8bit|aac|ac3|dts|dolby|remux|proper|repack)\b|\b\d{3,4}p\b|\b(?:french|truefrench|trufrench|vff|vfq|vf2|vfi|vf|vostfr|vost|subfrench|frenchsub|fsub|multi|vofr|voa|vo)\b)/gi;

/** Minuscules, sans accents ni ponctuation : « Les Tuche 3 : Liberté » -> « les tuche 3 liberte ». */
export function normalizeForCompare(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Seule une année en métadonnée (parenthèses ou suffixe) est extraite.
 * Un titre numérique, ou un nombre en tête de titre, reste intact. */
function splitTitle(raw: string): { title: string; year: string } {
  let title = raw.replace(QUALITY_TAGS, ' ').replace(/\s+/g, ' ').trim();
  let year = '';
  const bracketed = /[([]((?:19|20)\d{2})[)\]]/g;
  title = title.replace(bracketed, (match, candidate: string, offset: number) => {
    const remainder = title.slice(0, offset) + title.slice(offset + match.length);
    if (!remainder.replace(/[()[\]\s]/g, '')) return match;
    year = candidate;
    return ' ';
  });
  if (!year) {
    const suffix = title.match(/^(.+\S)\s+((?:19|20)\d{2})$/);
    if (suffix) { title = suffix[1]; year = suffix[2]; }
  }
  title = title.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, year };
}

export function extractYear(raw: string): string { return splitTitle(raw).year; }
export function stripQualityTags(raw: string): string { return splitTitle(raw).title; }
export function normalizeTitle(raw: string): { title: string; year: string } { return splitTitle(raw); }

const STOP_WORDS = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'the', 'and', 'of', 'd', 'l']);

/** Similarité de titres par mots partagés (Jaccard), 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
  const tokensB = new Set(b.split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
  if (!tokensA.size || !tokensB.size) return 0;
  let shared = 0;
  for (const w of tokensA) if (tokensB.has(w)) shared += 1;
  return shared / Math.max(tokensA.size, tokensB.size);
}
