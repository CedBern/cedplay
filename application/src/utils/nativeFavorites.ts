import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { toast } from 'sonner';
import type { Channel } from '@/types/channel';
import { getFavoritesFromDB, saveFavoritesToDB } from './idb';

interface FavoriteChange { channelUrl: string; favorite: boolean; revision: number }
interface FavoritePlugin {
  getFavoriteChanges(): Promise<{ entries: FavoriteChange[] }>;
  acknowledgeFavoriteChanges(options: { entries: FavoriteChange[] }): Promise<void>;
  setFavoritesSnapshot(options: { urls: string[] }): Promise<void>;
  addListener(event: 'favoritesChanged', listener: () => void): Promise<PluginListenerHandle>;
}
const plugin = registerPlugin<FavoritePlugin>('NativePlayer');
// Une nouvelle liste attend la fin de l'écriture précédente, même lors d'un démontage.
let writes = Promise.resolve();

/** Réconcilie le journal Android avec les favoris IndexedDB sans perdre les autres listes. */
export function watchNativeFavorites(channels: Channel[]): () => void {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('NativePlayer') || !channels.length) return () => {};
  const byUrl = new Map<string, string>();
  for (const channel of channels) {
    if (!byUrl.has(channel.url)) byUrl.set(channel.url, channel.id);
    for (const variant of channel.variants ?? []) if (!byUrl.has(variant.url)) byUrl.set(variant.url, channel.id);
  }
  let active = true;
  let handle: PluginListenerHandle | undefined;
  const reconcile = async () => {
    if (!active) return;
    let entries: FavoriteChange[];
    try { entries = (await plugin.getFavoriteChanges()).entries; }
    catch { return; } // Ancienne APK : le catalogue reste utilisable.
    const applicable = entries.filter(e => typeof e.channelUrl === 'string' && typeof e.favorite === 'boolean'
      && Number.isSafeInteger(e.revision) && byUrl.has(e.channelUrl)).sort((a, b) => a.revision - b.revision);
    const previous = await getFavoritesFromDB();
    let next = [...previous];
    for (const entry of applicable) {
      const id = byUrl.get(entry.channelUrl)!;
      next = next.filter(favorite => favorite !== id);
      if (entry.favorite) next.push(id);
    }
    if (applicable.length) {
      await saveFavoritesToDB(next);
      // L'accusé n'efface que la révision effectivement enregistrée, pas un appui ultérieur.
      await plugin.acknowledgeFavoriteChanges({ entries: applicable });
      window.dispatchEvent(new Event('favorites-updated'));
    }
    if (active) {
      const selected = new Set(next);
      await plugin.setFavoritesSnapshot({ urls: [...byUrl].filter(([, id]) => selected.has(id)).map(([url]) => url) });
    }
  };
  const request = () => {
    writes = writes.then(reconcile).catch(() => {
      if (active) toast.error('Favori conservé sur cet appareil ; synchronisation à réessayer.');
    });
  };
  void plugin.addListener('favoritesChanged', request).then(listener => {
    if (active) handle = listener; else void listener.remove();
  }).catch(() => {});
  window.addEventListener('favorites-updated', request);
  window.addEventListener('focus', request);
  request();
  return () => {
    active = false;
    void handle?.remove();
    window.removeEventListener('favorites-updated', request);
    window.removeEventListener('focus', request);
  };
}
