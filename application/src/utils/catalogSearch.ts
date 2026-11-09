import { catalogRequest, parseCatalog, parseCategories, type XtreamAccount } from './xtreamCatalog';
import { categoryCatalogCache } from './vodPosterCache';
import { normalizeForCompare } from './titleNormalize';
import type { VodWatchlistItem } from './idb';

type Kind = 'movie' | 'series';

/**
 * Recherche VOD sans télécharger tout le catalogue.
 *
 * `get_vod_streams` sans `category_id` renvoie des dizaines de milliers de titres
 * d'un coup : sur une box, le WebView reste bloqué plusieurs minutes. La recherche
 * parcourt donc les catégories du fournisseur par petits lots, s'arrête dès que
 * le budget ou le nombre de catégories est atteint, et signale les résultats au
 * fur et à mesure. Les catégories déjà chargées par le catalogue sont réutilisées.
 */
const CATEGORY_TTL_MS = 10 * 60_000;
/** Budget global : au-delà, la recherche rend ses résultats partiels. */
const SEARCH_BUDGET_MS = 20_000;
/** Catégories explorées au maximum par recherche (un compte peut en avoir 250). */
const MAX_CATEGORIES = 60;
/** Titres correspondants suffisants pour arrêter la recherche. */
const MAX_RESULTS = 40;
/** Une seule requête à la fois : le fournisseur coupe les requêtes VOD parallèles. */
const CONCURRENCY = 2;

export interface CatalogSearchOptions {
  signal: AbortSignal;
  /** Texte saisi ; la recherche ne démarre qu'à partir de deux caractères. */
  query: string;
  /** Résultats partiels, déjà dédoublonnés. */
  onResults?: (items: VodWatchlistItem[]) => void;
  /** Progression : catégories explorées / catégories retenues. */
  onProgress?: (done: number, total: number) => void;
  timeBudgetMs?: number;
}

function words(query: string): string[] {
  return normalizeForCompare(query).split(' ').filter(Boolean);
}

function matchesName(name: string, searchWords: string[]): boolean {
  const normalized = normalizeForCompare(name);
  return searchWords.every(word => normalized.includes(word));
}

/** Catégorie VOD affichée en dernier pour cette liste : le titre cherché y est souvent. */
function lastVisitedCategory(playlistId: string, kind: Kind): string {
  try {
    const raw = localStorage.getItem(`cedplay.tvVod:${playlistId}:${kind}`);
    if (!raw) return '';
    const value = JSON.parse(raw) as { category?: unknown };
    return typeof value.category === 'string' ? value.category : '';
  } catch { return ''; }
}

export function invalidateSearchCatalog(account: XtreamAccount): void {
  // Les catégories déjà chargées restent valables : elles ne dépendent pas de la
  // recherche. Rien à jeter ici ; conservé pour l'API et les tests.
  void account;
}

export async function searchCatalogSource(
  account: XtreamAccount,
  playlistId: string,
  kind: Kind,
  options: CatalogSearchOptions,
): Promise<VodWatchlistItem[]> {
  const { signal, query } = options;
  const searchWords = words(query);
  if (searchWords.length === 0) return [];
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

  const categoriesAction = kind === 'movie' ? 'get_vod_categories' : 'get_series_categories';
  const streamAction = kind === 'movie' ? 'get_vod_streams' : 'get_series';
  const categories = parseCategories(await catalogRequest(account, categoriesAction, {}, signal))
    // Une catégorie « test » du fournisseur n'a pas sa place dans une recherche.
    .filter(category => !/^test\b/i.test(category.name.trim()));
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

  const cachePrefix = `${playlistId}:${account.server}:${kind}:`;
  const lastCategory = lastVisitedCategory(playlistId, kind);
  // La catégorie ouverte dans le catalogue passe avant tout : l'utilisateur y a
  // souvent vu le titre qu'il cherche. Puis les catégories déjà chargées, puis les
  // générales (IMDb/Top/meilleures), avant les dizaines de sous-dossiers « Films - 2024 ».
  const imdb = /imdb/i;
  const general = /(\btop\b|\bbest\b|populaire|meilleur)/i;
  const catalogue = /(film|cin[ée]ma|vod|nouveaut|sortie|s[ée]rie)/i;
  const score = (categoryId: string, categoryName: string): number => {
    if (lastCategory && categoryId === lastCategory) return 6;
    if (categoryCatalogCache.has(`${cachePrefix}${categoryId}`)) return 5;
    if (matchesName(categoryName, searchWords)) return 4;
    if (imdb.test(categoryName)) return 4;
    if (general.test(categoryName)) return 3;
    if (catalogue.test(categoryName)) return 2;
    return 0;
  };
  const ordered = [...categories].sort((a, b) => score(b.id, b.name) - score(a.id, a.name));
  const selected = ordered.slice(0, MAX_CATEGORIES);

  const results = new Map<string, VodWatchlistItem>();
  let done = 0;
  let nextIndex = 0;
  const startedAt = Date.now();
  const budget = options.timeBudgetMs ?? SEARCH_BUDGET_MS;
  const emitResults = () => options.onResults?.([...results.values()]);
  const emitProgress = () => options.onProgress?.(done, selected.length);
  const finished = () => signal.aborted || Date.now() - startedAt > budget || results.size >= MAX_RESULTS;
  const exploreCategory = async (categoryId: string): Promise<void> => {
    if (finished()) return;
    const cacheKey = `${cachePrefix}${categoryId}`;
    const cached = categoryCatalogCache.get(cacheKey);
    let items = cached && Date.now() - cached.fetchedAt < CATEGORY_TTL_MS ? cached.items : null;
    if (!items) {
      const data = await catalogRequest(account, streamAction, { category_id: categoryId }, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      items = parseCatalog(data, kind);
      categoryCatalogCache.set(cacheKey, { fetchedAt: Date.now(), items });
      // Même borne que le catalogue : la mémoire de la box ne doit pas croître sans fin.
      while (categoryCatalogCache.size > 20) categoryCatalogCache.delete(categoryCatalogCache.keys().next().value!);
    }
    let added = false;
    for (const item of items) {
      if (!matchesName(item.name, searchWords)) continue;
      const key = `${kind}:${item.id}`;
      if (results.has(key)) continue;
      results.set(key, { ...item, kind, playlistId, addedAt: 0 });
      added = true;
      if (results.size >= MAX_RESULTS) break;
    }
    done += 1;
    emitProgress();
    if (added || results.size >= MAX_RESULTS) emitResults();
  };

  // La première catégorie (la plus probable : déjà chargée ou nom proche) passe
  // seule, avant le lot : elle donne un résultat sans concurrence avec les autres.
  const firstCategory = selected[0];
  if (firstCategory) {
    try {
      await exploreCategory(firstCategory.id);
    } catch (error) {
      if (signal.aborted) throw error;
      done += 1;
      emitProgress();
    }
    nextIndex = 1;
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(0, selected.length - 1)) }, async () => {
    for (;;) {
      if (finished()) return;
      const index = nextIndex++;
      const category = selected[index];
      if (!category) return;
      try {
        await exploreCategory(category.id);
      } catch (error) {
        if (signal.aborted) throw error;
        // Une catégorie en échec ne doit pas annuler les autres résultats.
        done += 1;
        emitProgress();
      }
    }
  });
  await Promise.all(workers);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  emitProgress();
  emitResults();
  return [...results.values()];
}
