import { CatalogItem } from '@/utils/xtreamCatalog';
import { historyScope, PlayHistoryEntry } from '@/utils/idb';
import { normalizeForCompare, normalizeTitle, titleSimilarityTokens, titleTokens } from '@/utils/titleNormalize';

export interface Recommendation {
  item: CatalogItem;
  score: number;
}

/** Poids de similarité d'un visionnage récent : demi-vie de 30 jours. */
const RECENCY_HALF_LIFE_MS = 30 * 24 * 3600 * 1000;
const CATEGORY_BOOST = 1.5;
const TITLE_BOOST = 2;

/** Titre normalisé + mots par objet catalogue. Normaliser un catalogue de 20 000 titres
 * coûte des centaines de ms : le travail ne doit pas se refaire à chaque changement
 * d'historique. Les entrées meurent avec le catalogue (WeakMap). */
const itemTitlesCache = new WeakMap<CatalogItem, { name: string; tokens: Set<string> }>();

function catalogTitle(item: CatalogItem): { name: string; tokens: Set<string> } {
  let cached = itemTitlesCache.get(item);
  if (!cached) {
    const name = normalizeForCompare(normalizeTitle(item.name).title);
    cached = { name, tokens: titleTokens(name) };
    itemTitlesCache.set(item, cached);
  }
  return cached;
}

/** Au moins un mot partagé : sans mot commun, la similarité vaut 0 (même filtre de mots). */
function sharesToken(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) if (b.has(token)) return true;
  return false;
}

/**
 * Recommandations « Pour toi » calculées localement à partir de l'historique VOD :
 * même catégorie + titres proches, pondérés par la fraîcheur du visionnage.
 * Les titres déjà vus sont exclus. Pur et déterministe (nowMs injectable pour les tests).
 */
export function recommendForHistory(
  history: PlayHistoryEntry[],
  items: CatalogItem[],
  options: { playlistId: string; limit?: number; nowMs?: number },
): Recommendation[] {
  const now = options?.nowMs ?? Date.now();
  const watched = history.map(historyScope).filter(e => e.kind === 'vod' && e.playlistId === options.playlistId && e.mediaKind === 'movie' && !!e.name && (e.status === 'completed' || (e.positionMs || 0) >= 60000));
  if (!watched.length) return [];
  const completedIds = new Set(watched.filter(e => e.status === 'completed').map(e => e.channelId));

  // Visionnages normalisés et récence calculés UNE fois : dans la boucle interne, la
  // normalisation + Math.exp par couple film × visionnage coûtait ~1 M d'appels sur un
  // catalogue de 20 000 films (gel de plusieurs secondes à chaque recalcul).
  const watchedMeta = watched.map((w) => {
    const name = normalizeForCompare(normalizeTitle(w.name as string).title);
    return {
      categoryId: w.categoryId,
      recency: Math.exp(-Math.LN2 * Math.max(0, now - w.ts) / RECENCY_HALF_LIFE_MS),
      name,
      tokens: titleTokens(name),
    };
  });

  const scored: Recommendation[] = [];
  for (const item of items) {
    const { name, tokens } = catalogTitle(item);
    if (!name || completedIds.has(`vod:${options.playlistId}:movie:${item.id}`)) continue;
    let score = 0;
    for (const w of watchedMeta) {
      let s = 0;
      if (w.categoryId && item.categoryId === w.categoryId) s += CATEGORY_BOOST;
      if (sharesToken(tokens, w.tokens)) s += titleSimilarityTokens(tokens, w.tokens) * TITLE_BOOST;
      score += w.recency * s;
    }
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options?.limit ?? 12);
}
