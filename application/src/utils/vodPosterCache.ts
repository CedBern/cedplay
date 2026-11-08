import type { CatalogItem } from '@/utils/xtreamCatalog';

// Cache mémoire des affiches chargées et des URLs en échec pendant la session
export const loadedPosterUrls = new Set<string>();
export const failedPosterUrls = new Set<string>();

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
    img.onload = () => { loadedPosterUrls.add(url); };
    img.onerror = () => { failedPosterUrls.add(url); };
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
