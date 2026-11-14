import { historyScope, type PlayHistoryEntry } from '@/utils/idb';
import {
  catalogRequest,
  parseCatalog,
  parseCategories,
  type CatalogItem,
  type XtreamAccount,
} from '@/utils/xtreamCatalog';
import { categoryCatalogCache } from '@/utils/vodPosterCache';
import { recommendForHistory } from '@/utils/recommendations';
import { externalSeeds } from '@/utils/externalWatch';
import {
  readForYouSignature,
  readForYouSnapshot,
  saveForYouSignature,
  saveForYouSnapshot,
  type ForYouSnapshotItem,
} from '@/utils/discover';
import { enrichRecommendations, type TasteEnrichment } from '@/utils/tasteEnrichment';
import { tmdbImageUrl } from '@/utils/tmdb';
import { normalizeForCompare, normalizeTitle } from '@/utils/titleNormalize';
import type { AdultVodFilter } from '@/hooks/useAdultVodCategories';
import type { PlaylistInfo } from '@/types/channel';

export type VodKind = 'movie' | 'series';

const MAX_TARGET_CATEGORIES = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;

/**
 * Signature synthétique des visionnages qualifiés (locaux et externes) pour une liste et un type donnés.
 * Un changement de titre, de statut, une avancée significative ou un import externe modifie la signature.
 */
export function historySignature(
  history: PlayHistoryEntry[],
  playlistId: string,
  kind: VodKind,
  externalWatches?: PlayHistoryEntry[],
): string {
  const watched = history
    .map(historyScope)
    .filter(e => e.kind === 'vod' && e.playlistId === playlistId && (e.mediaKind ?? 'movie') === kind && !!e.name && (e.status === 'completed' || (e.positionMs ?? 0) >= 60000))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  const ext = (externalWatches || [])
    .filter(e => (e.mediaKind ?? 'movie') === kind && !!e.name)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  if (!watched.length && !ext.length) return '';

  const localPart = watched
    .map(e => `${e.channelId}:${e.status || ''}:${Math.floor((e.positionMs || 0) / 60000)}`)
    .join('|');
  const extPart = ext
    .map(e => `${e.channelId}:${e.tmdbId || ''}`)
    .join('|');

  return `${localPart}#${extPart}`;
}

/**
 * Vérifie si l'utilisateur a au moins une graine de recommandation pour ce type
 * (soit via l'historique local de visionnage, soit via les œuvres importées « Vu ailleurs » / Trakt).
 */
export function hasRecommendationSeed(
  history: PlayHistoryEntry[],
  playlistId: string,
  kind: VodKind,
  externalWatches?: PlayHistoryEntry[],
): boolean {
  if (historySignature(history, playlistId, kind, externalWatches) !== '') return true;
  return Boolean(externalWatches?.some(w => (w.mediaKind ?? 'movie') === kind && !!w.name));
}

/**
 * Détermine si les recommandations d'accueil doivent être alimentées ou rafraîchies :
 * - Aucune recommandation en cache alors qu'un visionnage (local ou externe) existe.
 * - Le cache actuel ne porte aucun `sourceId` (nécessaire pour « Parce que tu as regardé »).
 * - La signature des visionnages récents a changé par rapport au dernier calcul connu.
 */
export function shouldRefreshRecommendations(
  playlistId: string,
  kind: VodKind,
  history: PlayHistoryEntry[],
  lastKnownSignature?: string,
  externalWatches?: PlayHistoryEntry[],
): boolean {
  const currentSig = historySignature(history, playlistId, kind, externalWatches);
  if (!currentSig) return false;

  const existing = readForYouSnapshot(playlistId, kind);
  if (existing.length === 0) return true;

  // Ancien cache sans sourceId : à renouveler pour alimenter « Parce que tu as regardé »
  if (existing.some(item => !item.sourceId)) return true;

  const knownSignature = lastKnownSignature ?? readForYouSignature(playlistId, kind);
  if (knownSignature !== undefined && knownSignature !== currentSig) return true;

  return false;
}

/**
 * Extrait les catégories des œuvres regardées pour ce type, ordonnées par récence du visionnage.
 * Les catégories adultes verrouillées sont éliminées.
 */
export function watchedCategoryIds(
  history: PlayHistoryEntry[],
  playlistId: string,
  kind: VodKind,
  adult: AdultVodFilter,
  limit = MAX_TARGET_CATEGORIES,
): string[] {
  const watched = history
    .map(historyScope)
    .filter(e => e.kind === 'vod' && e.playlistId === playlistId && (e.mediaKind ?? 'movie') === kind && !!e.name && (e.status === 'completed' || (e.positionMs ?? 0) >= 60000))
    .sort((a, b) => b.ts - a.ts);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of watched) {
    const catId = entry.categoryId?.trim();
    if (!catId || seen.has(catId)) continue;
    if (adult.isAdult(kind, catId)) continue;
    seen.add(catId);
    result.push(catId);
    if (result.length >= limit) break;
  }
  return result;
}

/** Catégorie mémorisée de la dernière visite TV du catalogue. */
function lastVisitedCategory(playlistId: string, kind: VodKind): string {
  try {
    const raw = localStorage.getItem(`cedplay.tvVod:${playlistId}:${kind}`);
    if (!raw) return '';
    const value = JSON.parse(raw) as { category?: unknown };
    return typeof value.category === 'string' ? value.category : '';
  } catch { return ''; }
}

/**
 * Détermine les catégories cibles à interroger :
 * 1. D'abord les catégories réelles des œuvres locales déjà vues.
 * 2. Si aucune catégorie locale n'est disponible, interroge la liste des catégories du fournisseur
 *    pour retenir la dernière visitée ou une catégorie populaire/générale (Top, Populaire, etc.).
 * Aucune requête globale `get_vod_streams` n'est jamais émise.
 */
export async function resolveTargetCategoryIds(
  account: XtreamAccount,
  playlistId: string,
  kind: VodKind,
  history: PlayHistoryEntry[],
  adult: AdultVodFilter,
  signal?: AbortSignal,
): Promise<string[]> {
  const fromHistory = watchedCategoryIds(history, playlistId, kind, adult);
  if (fromHistory.length > 0) return fromHistory;

  if (signal?.aborted) return [];

  try {
    const rawCategories = await catalogRequest(
      account,
      kind === 'movie' ? 'get_vod_categories' : 'get_series_categories',
      {},
      signal,
    );
    if (signal?.aborted) return [];
    const categories = parseCategories(rawCategories).filter(
      c => !/^test\b/i.test(c.name.trim()) && !adult.isAdult(kind, c.id),
    );
    if (!categories.length) return [];

    const stored = lastVisitedCategory(playlistId, kind);
    if (stored && categories.some(c => c.id === stored)) {
      return [stored];
    }

    const popular = categories.find(c => /(\btop\b|\bbest\b|populaire|meilleur|imdb|film|s[ée]rie)/i.test(c.name));
    return [popular ? popular.id : categories[0].id];
  } catch {
    return [];
  }
}

/**
 * Charge les titres d'une catégorie ciblée, avec réutilisation du cache session
 * `categoryCatalogCache` pour ne pas réinterroger le serveur Xtream si la catégorie est déjà en mémoire.
 */
export async function fetchCategoryCandidates(
  account: XtreamAccount,
  playlistId: string,
  kind: VodKind,
  categoryId: string,
  adult: AdultVodFilter,
  signal?: AbortSignal,
): Promise<CatalogItem[]> {
  const cacheKey = `${playlistId}:${account.server}:${kind}:${categoryId}`;
  const cached = categoryCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.items.filter(item => !adult.isAdult(kind, item.categoryId));
  }

  if (signal?.aborted) return [];

  const raw = await catalogRequest(
    account,
    kind === 'movie' ? 'get_vod_streams' : 'get_series',
    { category_id: categoryId },
    signal,
  );
  if (signal?.aborted) return [];

  const items = parseCatalog(raw, kind);
  categoryCatalogCache.set(cacheKey, { fetchedAt: Date.now(), items });
  while (categoryCatalogCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = categoryCatalogCache.keys().next().value;
    if (oldestKey !== undefined) categoryCatalogCache.delete(oldestKey);
  }

  return items.filter(item => !adult.isAdult(kind, item.categoryId));
}

export interface FeedRecommendationsOptions {
  account: XtreamAccount;
  playlist: PlaylistInfo;
  kind: VodKind;
  history: PlayHistoryEntry[];
  externalWatches?: PlayHistoryEntry[] | undefined;
  adult: AdultVodFilter;
  tmdbApiKey?: string | undefined;
  signal?: AbortSignal;
}

/**
 * Alimente les recommandations d'accueil pour un type (film ou série) directement
 * en arrière-plan sans visite préalable de la bibliothèque VOD :
 * 1. Identifie les catégories d'intérêt.
 * 2. Récupère les candidats correspondants par petits lots ciblés.
 * 3. Amorce le classement avec l'historique local et les graines « Vu ailleurs » (Trakt).
 * 4. Calcule le classement avec `recommendForHistory`.
 * 5. Persiste dans `saveForYouSnapshot` (ce qui dispatche 'for-you-updated').
 */
export async function feedHomeRecommendations({
  account,
  playlist,
  kind,
  history,
  externalWatches,
  adult,
  tmdbApiKey,
  signal,
}: FeedRecommendationsOptions): Promise<boolean> {
  if (!hasRecommendationSeed(history, playlist.id, kind, externalWatches)) return false;
  if (signal?.aborted) return false;

  const currentSig = historySignature(history, playlist.id, kind, externalWatches);

  try {
    const targetCategories = await resolveTargetCategoryIds(account, playlist.id, kind, history, adult, signal);
    if (signal?.aborted) return false;

    const candidates: CatalogItem[] = [];
    const seenIds = new Set<string>();

    for (const catId of targetCategories) {
      if (signal?.aborted) return false;
      try {
        const items = await fetchCategoryCandidates(account, playlist.id, kind, catId, adult, signal);
        for (const item of items) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            candidates.push(item);
          }
        }
      } catch {
        /* L'échec d'une catégorie ne bloque pas les autres */
      }
    }

    if (signal?.aborted) return false;

    // Amorce avec les visionnages externes Trakt / « Vu ailleurs » si présents
    const seeds = externalWatches?.length && candidates.length
      ? externalSeeds(externalWatches, candidates, playlist.id, kind)
      : [];
    const knownIds = new Set(history.map(e => e.channelId));
    const rankingHistory = [...history, ...seeds.filter(s => !knownIds.has(s.channelId))];

    const baseRecommendations = candidates.length
      ? recommendForHistory(rankingHistory, candidates, {
        playlistId: playlist.id,
        kind,
        limit: 20,
        pool: 40,
      })
      : [];

    let taste: TasteEnrichment | null = null;
    const apiKey = tmdbApiKey?.trim();
    if (apiKey) {
      try {
        taste = await enrichRecommendations({
          kind,
          history,
          movies: candidates,
          candidates: baseRecommendations.map(entry => entry.item),
          playlistId: playlist.id,
          apiKey,
          ...(signal ? { signal } : {}),
          ...(externalWatches?.length ? { external: externalWatches } : {}),
        });
      } catch {
        taste = null;
      }
      if (signal?.aborted) return false;
    }

    const usableTaste = taste && taste.profile.sampleSize > 0 ? taste : null;
    const recommendations = candidates.length
      ? (usableTaste
        ? recommendForHistory(rankingHistory, candidates, {
          playlistId: playlist.id,
          kind,
          limit: 20,
          pool: 40,
          profile: usableTaste.profile,
          detailsByItemId: usableTaste.detailsByItemId,
        })
        : baseRecommendations)
      : [];

    const libraryItems: ForYouSnapshotItem[] = recommendations.map(({ item, reasons, sourceId }) => ({
      id: item.id,
      name: item.name,
      availability: 'library',
      ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
      ...(item.poster ? { poster: item.poster } : {}),
      ...(item.categoryId ? { categoryId: item.categoryId } : {}),
      ...(reasons[0] ? { reason: reasons[0] } : {}),
      ...(sourceId ? { sourceId } : {}),
    }));

    // Titres à découvrir ailleurs (TMDB similaires aux œuvres vues, absents des suggestions bibliothèque)
    const discoverItems: ForYouSnapshotItem[] = [];
    if (taste?.discoverCandidates?.length) {
      const excludedNames = new Set<string>();
      const excludedTmdb = new Set<number>();
      for (const e of history) {
        if (e.name) excludedNames.add(normalizeForCompare(normalizeTitle(e.name).title));
        if (e.tmdbId) excludedTmdb.add(e.tmdbId);
      }
      for (const e of externalWatches || []) {
        if (e.name) excludedNames.add(normalizeForCompare(normalizeTitle(e.name).title));
        if (e.tmdbId) excludedTmdb.add(e.tmdbId);
      }
      for (const lib of libraryItems) {
        excludedNames.add(normalizeForCompare(normalizeTitle(lib.name).title));
        if (lib.tmdbId) excludedTmdb.add(lib.tmdbId);
      }
      for (const item of candidates) {
        if (item.tmdbId) excludedTmdb.add(item.tmdbId);
        excludedNames.add(normalizeForCompare(normalizeTitle(item.name).title));
      }

      const maxDiscover = libraryItems.length > 0 ? 6 : 12;
      for (const candidate of taste.discoverCandidates) {
        if (discoverItems.length >= maxDiscover) break;
        const sim = candidate.item;
        const normName = normalizeForCompare(normalizeTitle(sim.title).title);
        if (!normName || excludedTmdb.has(sim.id) || excludedNames.has(normName)) continue;
        excludedTmdb.add(sim.id);
        excludedNames.add(normName);
        const year = sim.releaseDate.slice(0, 4);
        const poster = tmdbImageUrl(sim.posterPath, 'w342');
        discoverItems.push({
          id: `tmdb:${kind}:${sim.id}`,
          name: sim.title,
          kind,
          availability: 'discover',
          tmdbId: sim.id,
          ...(year ? { year } : {}),
          ...(poster ? { poster } : {}),
          reason: `Proche de « ${candidate.sourceTitle} »`,
          sourceId: candidate.sourceId,
        });
      }
    }

    const combined = [...libraryItems, ...discoverItems];
    if (!combined.length || signal?.aborted) return false;

    saveForYouSnapshot(playlist.id, combined, kind);
    if (currentSig) saveForYouSignature(playlist.id, currentSig, kind);

    return true;
  } catch {
    return false;
  }
}
