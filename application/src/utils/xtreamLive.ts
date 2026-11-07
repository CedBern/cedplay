import { v5 as uuidv5 } from 'uuid';
import { Capacitor } from '@capacitor/core';
import { getProxyBase } from '@/utils/proxy';
import type { Channel, ChannelGroup, PlaylistInfo } from '@/types/channel';

/**
 * Chaînes en direct d'un compte Xtream : construction partagée entre l'import (dialog de
 * connexion) et l'actualisation automatique. Les deux produisent exactement les mêmes
 * chaînes (mêmes identifiants, mêmes adresses), ce qui conserve favoris et variantes.
 */

export interface XtreamLiveAccount { server: string; username: string; password: string }
export interface XtreamLiveCategory { category_id: string; category_name: string; parent_id?: number }
export type XtreamStreamFormat = 'm3u8' | 'ts';
/** Ce que l'utilisateur a choisi à l'import : catégories et format de flux. */
export interface XtreamLiveSelection { categoryIds: string[]; format: XtreamStreamFormat }

interface RawStream {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number | string;
  stream_icon?: string;
  epg_channel_id?: string;
  custom_sid?: string;
}

function liveApiUrl(account: XtreamLiveAccount, action: 'categories' | 'streams', categoryId?: string): string {
  const user = encodeURIComponent(account.username);
  const pass = encodeURIComponent(account.password);
  const category = categoryId !== undefined ? `&category_id=${encodeURIComponent(categoryId)}` : '';
  if (Capacitor.isNativePlatform()) {
    const apiAction = action === 'categories' ? 'get_live_categories' : 'get_live_streams';
    return `${account.server}/player_api.php?username=${user}&password=${pass}&action=${apiAction}${category}`;
  }
  return `${getProxyBase()}/xtream/${action}?server=${encodeURIComponent(account.server)}&username=${user}&password=${pass}${category}`;
}

/** Adresse de la requête des catégories (le dialog garde sa propre gestion d'erreurs détaillée). */
export function liveCategoriesUrl(account: XtreamLiveAccount): string {
  return liveApiUrl(account, 'categories');
}

export async function fetchLiveCategories(account: XtreamLiveAccount): Promise<XtreamLiveCategory[]> {
  const res = await fetch(liveCategoriesUrl(account));
  if (!res.ok) throw new Error(`Catégories Xtream indisponibles (${res.status})`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('Réponse Xtream inattendue');
  return data.filter((c): c is XtreamLiveCategory => !!c && typeof c === 'object'
    && (typeof c.category_id === 'string' || typeof c.category_id === 'number')
    && typeof c.category_name === 'string')
    .map(c => ({ ...c, category_id: String(c.category_id) }));
}

export function buildLiveChannel(account: XtreamLiveAccount, stream: RawStream, group: string, format: XtreamStreamFormat): Channel {
  const base = `${account.server}/live/${encodeURIComponent(account.username)}/${encodeURIComponent(account.password)}/${stream.stream_id}`;
  const fallback: XtreamStreamFormat = format === 'm3u8' ? 'ts' : 'm3u8';
  const name = String(stream.name ?? '').trim();
  const altVariant: Channel = {
    id: uuidv5(`${account.server}\0${stream.stream_id}\0${fallback}`, uuidv5.URL),
    name: `${name} (${fallback.toUpperCase()})`,
    url: `${base}.${fallback}`,
    group,
    isFavorite: false,
  };
  return {
    id: uuidv5(`${account.server}\0${stream.stream_id}`, uuidv5.URL),
    name,
    url: `${base}.${format}`,
    variants: [altVariant],
    group,
    ...(stream.stream_icon ? { logo: stream.stream_icon } : {}),
    ...(stream.custom_sid || stream.epg_channel_id ? { tvgId: stream.custom_sid || stream.epg_channel_id } : {}),
    isFavorite: false,
  };
}

export interface LiveChannelsResult { channels: Channel[]; groups: ChannelGroup[]; failed: string[] }

/** Télécharge les chaînes des catégories, 5 requêtes à la fois, dans l'ordre des catégories. */
export async function fetchLiveChannels(
  account: XtreamLiveAccount,
  categories: XtreamLiveCategory[],
  format: XtreamStreamFormat,
  onProgress?: (done: number, total: number) => void,
): Promise<LiveChannelsResult> {
  const perCategory: Channel[][] = categories.map(() => []);
  const failed: string[] = [];
  let next = 0;
  let done = 0;
  const fetchCategory = async (index: number) => {
    const cat = categories[index];
    try {
      const res = await fetch(liveApiUrl(account, 'streams', cat.category_id));
      if (!res.ok) { failed.push(cat.category_name); return; }
      const streams: unknown = await res.json();
      if (!Array.isArray(streams)) { failed.push(cat.category_name); return; }
      for (const s of streams as RawStream[]) {
        if (!s || s.stream_id === undefined || s.stream_id === null || typeof s.name !== 'string') continue;
        perCategory[index].push(buildLiveChannel(account, s, cat.category_name, format));
      }
    } catch {
      failed.push(cat.category_name);
    } finally {
      done += 1;
      onProgress?.(done, categories.length);
    }
  };
  const worker = async () => {
    while (next < categories.length) await fetchCategory(next++);
  };
  await Promise.all(Array.from({ length: Math.min(5, categories.length) }, () => worker()));
  const groupMap = new Map<string, Channel[]>();
  const channels: Channel[] = [];
  categories.forEach((cat, i) => {
    if (!perCategory[i].length) return;
    channels.push(...perCategory[i]);
    const list = groupMap.get(cat.category_name) ?? [];
    list.push(...perCategory[i]);
    groupMap.set(cat.category_name, list);
  });
  return { channels, groups: [...groupMap.entries()].map(([name, list]) => ({ name, channels: list })), failed };
}

const selectionKey = (playlistId: string) => `xtream_live_selection_${playlistId}`;

export function saveLiveSelection(playlistId: string, selection: XtreamLiveSelection): void {
  try { localStorage.setItem(selectionKey(playlistId), JSON.stringify(selection)); } catch { /* stockage indisponible */ }
}

export function readLiveSelection(playlistId: string): XtreamLiveSelection | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(selectionKey(playlistId)) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const { categoryIds, format } = raw as Partial<XtreamLiveSelection>;
    if (!Array.isArray(categoryIds) || !categoryIds.every(id => typeof id === 'string') || (format !== 'm3u8' && format !== 'ts')) return null;
    return { categoryIds, format };
  } catch { return null; }
}

/** Liste issue d'une connexion Xtream (et non d'un fichier M3U contenant des adresses Xtream). */
export function isXtreamLiveImport(playlist: PlaylistInfo): boolean {
  return !playlist.url && (readLiveSelection(playlist.id) !== null || playlist.name.startsWith('Xtream: '));
}

/** Liste que l'application sait retélécharger : M3U par adresse ou connexion Xtream. */
export function canRefreshPlaylist(playlist: PlaylistInfo): boolean {
  return !!playlist.url || isXtreamLiveImport(playlist);
}

function inferFormat(playlist: PlaylistInfo): XtreamStreamFormat {
  const first = playlist.channels.find(c => /\/live\//.test(c.url));
  return first && /\.ts(?:$|\?)/i.test(first.url) ? 'ts' : 'm3u8';
}

/**
 * Nouvelle version d'une liste Xtream, avec les catégories choisies à l'import. Pour une
 * liste importée avant l'enregistrement de ce choix, les catégories sont retrouvées par le
 * nom des groupes. Lève une erreur plutôt que de rendre une liste incomplète.
 */
export async function downloadXtreamLive(playlist: PlaylistInfo, account: XtreamLiveAccount): Promise<PlaylistInfo> {
  const categories = await fetchLiveCategories(account);
  const stored = readLiveSelection(playlist.id);
  let selected: XtreamLiveCategory[];
  let format: XtreamStreamFormat;
  if (stored) {
    // Une catégorie mémorisée absente de la réponse n'apparaîtrait jamais parmi les échecs :
    // sans ce contrôle, la liste serait remplacée sans ses chaînes.
    const available = new Set(categories.map(c => c.category_id));
    const missing = stored.categoryIds.filter(id => !available.has(id));
    if (missing.length) {
      throw new Error(`${missing.length} catégorie(s) Xtream introuvable(s) chez le fournisseur. Réimportez la connexion pour refaire le choix.`);
    }
    const ids = new Set(stored.categoryIds);
    selected = categories.filter(c => ids.has(c.category_id));
    format = stored.format;
  } else {
    const names = new Set(playlist.groups.filter(g => g.channels.length).map(g => g.name));
    selected = categories.filter(c => names.has(c.category_name));
    format = inferFormat(playlist);
  }
  if (!selected.length) throw new Error('Catégories Xtream introuvables chez le fournisseur.');
  const { channels, groups, failed } = await fetchLiveChannels(account, selected, format);
  if (failed.length) throw new Error(`${failed.length} catégorie(s) Xtream sans réponse.`);
  if (!channels.length) throw new Error('Aucune chaîne renvoyée par le fournisseur.');
  // Une chute brutale signale une réponse tronquée du fournisseur (ou, pour une liste
  // ancienne, un mauvais appariement par nom) plutôt qu'un vrai changement : on garde
  // l'ancienne liste, à chaque actualisation.
  if (channels.length < playlist.channels.length / 2) {
    throw new Error(`Liste Xtream trop différente de l'actuelle (${channels.length} chaînes au lieu de ${playlist.channels.length}) : ancienne liste gardée.`);
  }
  if (!stored) saveLiveSelection(playlist.id, { categoryIds: selected.map(c => c.category_id), format });
  return { ...playlist, channels, groups, totalChannelsBeforeDedup: channels.length };
}
