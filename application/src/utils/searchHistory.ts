/** Recherches récentes de la recherche unifiée, gardées sur l'appareil (aucun compte, aucun envoi). */
const KEY = 'cedplay_search_history';
/** Au-delà, l'historique encombre l'écran TV sans servir. */
export const SEARCH_HISTORY_MAX = 8;

/** Nettoie une liste lue ou écrite : chaînes utiles seulement, récentes d'abord, sans doublon. */
function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const label = entry.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (label.length < 2) continue;
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(label);
    if (entries.length >= SEARCH_HISTORY_MAX) break;
  }
  return entries;
}

export function readSearchHistory(): string[] {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return [];
  }
}

function write(entries: string[]): string[] {
  const clean = sanitize(entries);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* stockage indisponible : l'historique vaut pour la session */
  }
  return clean;
}

/** Ajoute une requête en tête ; une requête d'un seul caractère n'apprend rien. */
export function rememberSearch(query: string): string[] {
  const label = query.trim();
  if (label.length < 2) return readSearchHistory();
  const key = label.toLocaleLowerCase();
  return write([label, ...readSearchHistory().filter(entry => entry.toLocaleLowerCase() !== key)]);
}

export function forgetSearch(query: string): string[] {
  const key = query.trim().toLocaleLowerCase();
  return write(readSearchHistory().filter(entry => entry.toLocaleLowerCase() !== key));
}

export function clearSearchHistory(): string[] {
  return write([]);
}
