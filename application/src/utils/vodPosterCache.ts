import type { CatalogItem } from '@/utils/xtreamCatalog';

// Cache mémoire des affiches chargées et des URLs en échec pendant la session.
// Les deux ensembles sont bornés : un catalogue de plusieurs milliers de titres ne doit pas
// conserver une entrée par affiche jusqu'à la fermeture de l'application.
export const MAX_LOADED_POSTERS = 2_000;
export const MAX_FAILED_POSTERS = 500;

/** Ajoute en évitant la croissance à vie : les plus anciennes entrées sortent d'abord. */
function remember(set: Set<string>, url: string, max: number): void {
  if (set.has(url)) return;
  set.add(url);
  while (set.size > max) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

export const loadedPosterUrls = new Set<string>();
export const failedPosterUrls = new Set<string>();

export function rememberLoadedPoster(url: string): void { remember(loadedPosterUrls, url, MAX_LOADED_POSTERS); }
export function rememberFailedPoster(url: string): void { remember(failedPosterUrls, url, MAX_FAILED_POSTERS); }

/**
 * Cache mémoire des listes de titres par catégorie VOD.
 * Évite les requêtes réseau répétées à chaque navigation entre catégories.
 */
export const categoryCatalogCache = new Map<string, { fetchedAt: number; items: CatalogItem[] }>();

/**
 * Précharge en mémoire une liste d'URLs d'affiches pour que l'affichage
 * soit immédiat et synchronisé lorsque l'utilisateur atteint la rangée.
 */
export function prefetchPosters(urls: (string | null | undefined)[], limit = 20): void {
  let count = 0;
  for (const url of urls) {
    if (!url || typeof url !== 'string' || loadedPosterUrls.has(url) || failedPosterUrls.has(url)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { rememberLoadedPoster(url); };
    img.onerror = () => { rememberFailedPoster(url); };
    img.src = url;
    count++;
    if (count >= limit) break;
  }
}

export function clearPosterCache(): void {
  loadedPosterUrls.clear();
  failedPosterUrls.clear();
}

export function clearVodCategoryCache(): void {
  categoryCatalogCache.clear();
}
