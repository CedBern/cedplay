import { CatalogItem } from '@/utils/xtreamCatalog';
import { historyScope, PlayHistoryEntry } from '@/utils/idb';
import { normalizeForCompare, normalizeTitle, titleSimilarity } from '@/utils/titleNormalize';

export interface Recommendation {
  item: CatalogItem;
  score: number;
}

/** Poids de similarité d'un visionnage récent : demi-vie de 30 jours. */
const RECENCY_HALF_LIFE_MS = 30 * 24 * 3600 * 1000;
const CATEGORY_BOOST = 1.5;
const TITLE_BOOST = 2;

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

  const scored: Recommendation[] = [];
  for (const item of items) {
    const name = normalizeForCompare(normalizeTitle(item.name).title);
    if (!name || completedIds.has(`vod:${options.playlistId}:movie:${item.id}`)) continue;
    let score = 0;
    for (const w of watched) {
      const recency = Math.exp(-Math.LN2 * Math.max(0, now - w.ts) / RECENCY_HALF_LIFE_MS);
      let s = 0;
      if (w.categoryId && item.categoryId === w.categoryId) s += CATEGORY_BOOST;
      s += titleSimilarity(name, normalizeForCompare(normalizeTitle(w.name as string).title)) * TITLE_BOOST;
      score += recency * s;
    }
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options?.limit ?? 12);
}
