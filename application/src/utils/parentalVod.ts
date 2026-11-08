import type { PlaylistInfo } from '@/types/channel';
import { catalogRequest, getXtreamAccount, parseCategories, type CatalogCategory, type XtreamAccount } from '@/utils/xtreamCatalog';
import { isAdultGroupName } from '@/utils/parentalControl';

export type VodKind = 'movie' | 'series';

/**
 * Catégories VOD adultes connues pendant la session, par liste et par type.
 *
 * Le direct est verrouillé à partir des noms de groupes de la liste ; le catalogue
 * Xtream, lui, arrive après une requête réseau et ses éléments ne portent qu'un
 * `categoryId`. Ce registre garde la correspondance id → adulte dès qu'une
 * catégorie a été lue, pour que la recherche globale et « Continuer » filtrent
 * sans redemander les catégories à chaque écran.
 *
 * Aucune donnée sensible : uniquement des identifiants de catégorie, en mémoire.
 */
const registry = new Map<string, Map<VodKind, Set<string>>>();

const categoriesAction = (kind: VodKind): string => kind === 'movie' ? 'get_vod_categories' : 'get_series_categories';

export function rememberVodCategories(playlistId: string, kind: VodKind, categories: CatalogCategory[]): Set<string> {
  const ids = new Set(categories.filter(category => isAdultGroupName(category.name)).map(category => category.id));
  let byKind = registry.get(playlistId);
  if (!byKind) { byKind = new Map(); registry.set(playlistId, byKind); }
  byKind.set(kind, ids);
  return ids;
}

export function hasKnownAdultVodCategories(playlistId: string, kind: VodKind): boolean {
  return registry.get(playlistId)?.has(kind) === true;
}

export function knownAdultVodCategoryIds(playlistId: string, kind: VodKind): Set<string> {
  return registry.get(playlistId)?.get(kind) ?? new Set<string>();
}

/** Lit les catégories une seule fois par liste et par type, puis les garde en mémoire. */
export async function ensureAdultVodCategoryIds(
  playlist: PlaylistInfo,
  kind: VodKind,
  account: XtreamAccount | null,
  signal?: AbortSignal,
): Promise<Set<string>> {
  if (hasKnownAdultVodCategories(playlist.id, kind)) return knownAdultVodCategoryIds(playlist.id, kind);
  if (!account) return new Set<string>();
  const data = await catalogRequest(account, categoriesAction(kind), {}, signal);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return rememberVodCategories(playlist.id, kind, parseCategories(data));
}

export function isAdultVodCategory(ids: Set<string> | null | undefined, categoryId: string | null | undefined): boolean {
  return !!ids && !!categoryId && ids.has(categoryId);
}

/** Oublie l'état mémorisé (tests, changement de compte). */
export function clearParentalVodRegistry(): void {
  registry.clear();
}

/** Compte Xtream de la liste, ou null si elle n'en a pas. */
export function vodAccountOf(playlist: PlaylistInfo | null): XtreamAccount | null {
  return playlist ? getXtreamAccount(playlist) : null;
}
