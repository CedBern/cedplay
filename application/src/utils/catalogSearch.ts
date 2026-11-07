import { catalogRequest, parseCatalog, type XtreamAccount } from './xtreamCatalog';
import type { VodWatchlistItem } from './idb';

type Kind = 'movie' | 'series';
const CACHE_MS = 10 * 60_000;
// Mémoire de session seulement : aucune URL ni identité du compte dans une clé persistante.
const cache = new WeakMap<XtreamAccount, Map<Kind, { at: number; items: VodWatchlistItem[] }>>();
export function invalidateSearchCatalog(account: XtreamAccount): void { cache.delete(account); }

export async function searchCatalogSource(account: XtreamAccount, playlistId: string, kind: Kind, signal: AbortSignal): Promise<VodWatchlistItem[]> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  let sources = cache.get(account);
  if (!sources) { sources = new Map(); cache.set(account, sources); }
  const saved = sources.get(kind);
  if (saved && Date.now() - saved.at < CACHE_MS) return saved.items.map(item => ({ ...item, playlistId }));
  const data = await catalogRequest(account, kind === 'movie' ? 'get_vod_streams' : 'get_series', {}, signal);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const items = parseCatalog(data, kind).map(item => ({ ...item, kind, playlistId, addedAt: 0 }));
  sources.set(kind, { at: Date.now(), items });
  return items;
}
