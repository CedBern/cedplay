import { getMeta, setMeta } from '@/utils/idb';

/**
 * Listes de favoris supplémentaires (Sport, Enfants…). La liste « Favoris » d'origine
 * reste à part : c'est elle qui donne les numéros de télécommande 1, 2, 3…
 */
export interface FavoriteList {
  id: string;
  name: string;
  channelIds: string[];
}

export const FAVORITE_LISTS_EVENT = 'favorite-lists-updated';
const KEY = 'favoriteLists';
const MAX_LISTS = 20;

function sanitize(raw: unknown): FavoriteList[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FavoriteList[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, name, channelIds } = item as Partial<FavoriteList>;
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string' || !name.trim()) continue;
    seen.add(id);
    out.push({
      id,
      name: name.trim().slice(0, 40),
      channelIds: Array.isArray(channelIds) ? [...new Set(channelIds.filter((c): c is string => typeof c === 'string'))] : [],
    });
  }
  return out.slice(0, MAX_LISTS);
}

export async function loadFavoriteLists(): Promise<FavoriteList[]> {
  try { return sanitize(await getMeta<unknown>(KEY)); } catch { return []; }
}

export async function saveFavoriteLists(lists: FavoriteList[]): Promise<FavoriteList[]> {
  const clean = sanitize(lists);
  await setMeta(KEY, clean);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FAVORITE_LISTS_EVENT));
  return clean;
}

export async function createFavoriteList(name: string, firstChannelId?: string): Promise<FavoriteList | null> {
  const clean = name.trim().slice(0, 40);
  if (!clean) return null;
  const lists = await loadFavoriteLists();
  if (lists.length >= MAX_LISTS) return null;
  const existing = lists.find(l => l.name.toLocaleLowerCase('fr') === clean.toLocaleLowerCase('fr'));
  if (existing) {
    if (firstChannelId && !existing.channelIds.includes(firstChannelId)) {
      existing.channelIds.push(firstChannelId);
      await saveFavoriteLists(lists);
    }
    return existing;
  }
  const list: FavoriteList = { id: `fl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: clean, channelIds: firstChannelId ? [firstChannelId] : [] };
  await saveFavoriteLists([...lists, list]);
  return list;
}

export async function toggleInFavoriteList(listId: string, channelId: string): Promise<boolean> {
  const lists = await loadFavoriteLists();
  const list = lists.find(l => l.id === listId);
  if (!list) return false;
  const present = list.channelIds.includes(channelId);
  list.channelIds = present ? list.channelIds.filter(id => id !== channelId) : [...list.channelIds, channelId];
  await saveFavoriteLists(lists);
  return !present;
}

export async function updateFavoriteList(listId: string, change: Partial<Pick<FavoriteList, 'name' | 'channelIds'>>): Promise<void> {
  const lists = await loadFavoriteLists();
  await saveFavoriteLists(lists.map(l => (l.id === listId ? { ...l, ...change } : l)));
}

export async function deleteFavoriteList(listId: string): Promise<void> {
  const lists = await loadFavoriteLists();
  await saveFavoriteLists(lists.filter(l => l.id !== listId));
}
