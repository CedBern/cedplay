import { CatalogItem } from '@/utils/xtreamCatalog';
import { historyScope, PlayHistoryEntry } from '@/utils/idb';
import { matchTaste, TASTE_MAX_SCORE, type TasteProfile } from '@/utils/tasteProfile';
import type { TmdbDetails } from '@/utils/tmdb';
import { normalizeForCompare, normalizeTitle, stripQualityTags, titleSimilarityTokens, titleTokens } from '@/utils/titleNormalize';

export interface Recommendation {
  item: CatalogItem;
  score: number;
  /** Justifications affichées sous l'affiche : au plus deux, la plus forte d'abord. */
  reasons: string[];
  sourceId?: string;
}

export interface RecommendationOptions {
  playlistId: string;
  kind?: 'movie' | 'series';
  limit?: number;
  /** Injectable pour rendre le calcul déterministe dans les tests. */
  nowMs?: number;
  /** Profil de goût issu des fiches TMDB des films vus (facultatif). */
  profile?: TasteProfile | null;
  /** Fiches TMDB des candidats, par identifiant catalogue. */
  detailsByItemId?: Map<string, TmdbDetails> | null;
  /** Candidats pré-classés avant reclassement par le goût (défaut : 40). */
  pool?: number;
}

/** Poids de similarité d'un visionnage récent : demi-vie de 30 jours. */
const RECENCY_HALF_LIFE_MS = 30 * 24 * 3600 * 1000;
const CATEGORY_BOOST = 1.5;
const TITLE_BOOST = 2;
/** Le goût TMDB complète le classement local sans l'effacer. */
const TASTE_WEIGHT = 1.5;
const DEFAULT_POOL = 40;

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

/** Nom de titre lisible dans une justification : sans tags de qualité ni année. */
function displayName(raw: string): string {
  return stripQualityTags(raw).trim() || raw.trim();
}

interface ScoredItem {
  item: CatalogItem;
  base: number;
  reasons: string[];
  sourceId: string;
}

/**
 * Recommandations « Pour toi » calculées localement à partir de l'historique VOD :
 * même catégorie + titres proches, pondérés par la fraîcheur du visionnage.
 * Les titres déjà vus sont exclus.
 *
 * Si un profil de goût est fourni, les meilleurs candidats sont reclassés avec les
 * genres, les personnes et les films similaires TMDB, et chaque résultat porte une
 * justification lisible. Sans profil (pas de clé TMDB), le classement et les
 * justifications de catégorie/titre restent inchangés.
 * Pur et déterministe (nowMs injectable pour les tests).
 */
export function recommendForHistory(
  history: PlayHistoryEntry[],
  items: CatalogItem[],
  options: RecommendationOptions,
): Recommendation[] {
  const now = options?.nowMs ?? Date.now();
  const limit = options?.limit ?? 12;
  const kind = options.kind ?? 'movie';
  const watched = history.map(historyScope).filter(e => e.kind === 'vod' && e.playlistId === options.playlistId && e.mediaKind === kind && !!e.name && (e.status === 'completed' || (e.positionMs || 0) >= 60000));
  if (!watched.length) return [];

  // Un épisode par entrée d'historique : pour les séries, ne compter chaque œuvre
  // qu'une fois (le plus récent épisode), sinon une série à épisodes vus pèse
  // artificiellement plus lourd qu'une autre.
  const works = kind === 'series'
    ? [...watched].sort((a, b) => b.ts - a.ts).filter((entry, index, list) => {
      const key = entry.seriesId ?? normalizeForCompare(normalizeTitle(entry.name as string).title);
      return list.findIndex(other => (other.seriesId ?? normalizeForCompare(normalizeTitle(other.name as string).title)) === key) === index;
    })
    : watched;
  // Films : seuls les titres terminés sont exclus (un film commencé reste suggérable).
  // Séries : l'identifiant de catalogue est le `seriesId` ; l'historique ancien qui
  // n'en a pas est rapproché par titre pour ne pas recommander la série en cours.
  const watchedIds = new Set(works
    .filter(entry => kind === 'series' || entry.status === 'completed')
    .map(entry => (kind === 'series' ? entry.seriesId : entry.channelId.split(':').pop()))
    .filter((id): id is string => !!id));
  const watchedNames = new Set(works.map(entry => normalizeForCompare(normalizeTitle(entry.name as string).title)));

  // Visionnages normalisés et récence calculés UNE fois : dans la boucle interne, la
  // normalisation + Math.exp par couple film × visionnage coûtait ~1 M d'appels sur un
  // catalogue de 20 000 films (gel de plusieurs secondes à chaque recalcul).
  const watchedMeta = works.map((w) => {
    const name = normalizeForCompare(normalizeTitle(w.name as string).title);
    return {
      sourceId: w.originChannelId ?? w.channelId,
      categoryId: w.categoryId,
      recency: Math.exp(-Math.LN2 * Math.max(0, now - w.ts) / RECENCY_HALF_LIFE_MS),
      name,
      tokens: titleTokens(name),
      label: displayName(w.name as string),
    };
  });

  const scored: ScoredItem[] = [];
  for (const item of items) {
    const { name, tokens } = catalogTitle(item);
    if (!name || watchedIds.has(item.id) || (kind === 'series' && watchedNames.has(name))) continue;
    let score = 0;
    let bestWeight = 0;
    let bestReason = '';
    let sourceId = '';
    for (const w of watchedMeta) {
      let s = 0;
      let categoryPart = 0;
      let titlePart = 0;
      if (w.categoryId && item.categoryId === w.categoryId) { categoryPart = CATEGORY_BOOST; s += categoryPart; }
      if (sharesToken(tokens, w.tokens)) { titlePart = titleSimilarityTokens(tokens, w.tokens) * TITLE_BOOST; s += titlePart; }
      const weighted = w.recency * s;
      score += weighted;
      // Le visionnage qui pèse le plus porte la justification : c'est lui qui explique
      // le mieux pourquoi ce titre ressort.
      if (weighted > bestWeight) {
        sourceId = w.sourceId;
        bestWeight = weighted;
        bestReason = titlePart >= categoryPart
          ? `Proche de « ${w.label} »`
          : `Même catégorie que « ${w.label} »`;
      }
    }
    if (score > 0) scored.push({ item, base: score, reasons: bestReason ? [bestReason] : [], sourceId });
  }
  scored.sort((a, b) => b.base - a.base);

  const { profile, detailsByItemId } = options;
  if (!profile?.sampleSize || !detailsByItemId?.size) {
    return scored.slice(0, limit).map(entry => ({ item: entry.item, score: entry.base, reasons: entry.reasons, sourceId: entry.sourceId }));
  }

  const pool = scored.slice(0, Math.max(limit, options.pool ?? DEFAULT_POOL));
  const maxBase = pool[0]?.base || 0;
  const reranked = pool.map((entry) => {
    const details = detailsByItemId.get(entry.item.id);
    const taste = details ? matchTaste(profile, details, 2) : { score: 0, reasons: [] };
    const baseNormalized = maxBase > 0 ? entry.base / maxBase : 0;
    const tasteNormalized = taste.score / TASTE_MAX_SCORE;
    const reasons = [...taste.reasons];
    for (const reason of entry.reasons) if (!reasons.includes(reason)) reasons.push(reason);
    return {
      item: entry.item,
      sourceId: entry.sourceId,
      score: baseNormalized + tasteNormalized * TASTE_WEIGHT,
      reasons: reasons.slice(0, 2),
    };
  });
  // Tri stable : à score égal, l'ordre du classement local est conservé.
  reranked.sort((a, b) => b.score - a.score);
  return reranked.slice(0, limit);
}
