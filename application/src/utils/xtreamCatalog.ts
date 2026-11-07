import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { PlaylistInfo } from '@/types/channel';
import { getProxyBase } from '@/utils/proxy';
import { getActiveUserAgent } from '@/utils/userAgent';

export interface XtreamAccount { server: string; username: string; password: string }
export interface CatalogCategory { id: string; name: string }
export interface CatalogItem { id: string; name: string; poster: string; categoryId: string; extension: string; rating: string; tmdbId?: number }
export interface Episode { id: string; name: string; season: string; number: number; extension: string; plot: string }
export interface CatalogDetails { plot: string; cast: string; director: string; releaseDate: string; duration: string; extension: string; episodes: Episode[]; tmdbId?: number }
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const str = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const extension = (value: unknown): string => /^[a-z0-9]{1,8}$/i.test(str(value)) ? str(value).toLowerCase() : '';
const identifier = (value: unknown): string => /^\d+$/.test(str(value)) ? str(value) : '';
export function safeImage(value: unknown): string {
  try { const url = new URL(str(value)); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function validAccount(value: unknown): XtreamAccount | null {
  const v = object(value);
  try {
    const url = new URL(str(v.server));
    if (!['http:', 'https:'].includes(url.protocol) || !str(v.username) || !str(v.password)) return null;
    return { server: url.href.replace(/\/+$/, ''), username: str(v.username), password: str(v.password) };
  } catch { return null; }
}
export function saveXtreamAccount(playlistId: string, account: XtreamAccount) {
  localStorage.setItem(`xtream_account_${playlistId}`, JSON.stringify(account));
}

// Cache mémoire par identité d'objet de liste : getXtreamAccount scanne toutes
// les URLs des chaînes, inutile de le refaire à chaque appel (EPG, VOD, Replay…).
// Un nouvel objet (réimport, contenu modifié) est ré-évalué, un même objet est réutilisé.
const accountCache = new WeakMap<PlaylistInfo, XtreamAccount | null>();

export function getXtreamAccount(playlist: PlaylistInfo): XtreamAccount | null {
  if (accountCache.has(playlist)) return accountCache.get(playlist)!;
  let result: XtreamAccount | null = null;
  try {
    const linked = validAccount(JSON.parse(localStorage.getItem(`xtream_account_${playlist.id}`) || 'null'));
    if (linked) result = linked;
    else {
      const legacy = validAccount({ server: localStorage.getItem('xtream_last_server'), username: localStorage.getItem('xtream_last_user'), password: localStorage.getItem('xtream_last_pass') });
      // Only attach the old global login to the matching playlist and live URL.
      if (legacy && playlist.name === `Xtream: ${legacy.username}` && playlist.channels.some(c => {
        try { const u = new URL(c.url); return u.origin === new URL(legacy.server).origin && u.pathname.startsWith(`/live/${encodeURIComponent(legacy.username)}/${encodeURIComponent(legacy.password)}/`); } catch { return false; }
      })) result = legacy;
      else {
        // Restored playlists already contain Xtream live paths, even without the login form's storage.
        // Require a single account across all recognized paths; mixed-source lists stay unlinked.
        const inferred = new Map<string, XtreamAccount>();
        for (const channel of playlist.channels) {
          try {
            const url = new URL(channel.url);
            const match = url.pathname.match(/^(.*)\/live\/([^/]+)\/([^/]+)\/\d+\.(?:ts|m3u8)$/i);
            if (!match || !['http:', 'https:'].includes(url.protocol)) continue;
            const candidate = { server: url.origin + match[1], username: decodeURIComponent(match[2]), password: decodeURIComponent(match[3]) };
            inferred.set(JSON.stringify(candidate), candidate);
            if (inferred.size > 1) break;
          } catch { /* non-Xtream URL */ }
        }
        if (inferred.size === 1) result = [...inferred.values()][0];
      }
    }
  } catch { /* unavailable local storage */ }
  accountCache.set(playlist, result);
  return result;
}

// ── Limites d'abonnement (lectures simultanées) ─────────────────────────────
// La mosaïque ouvre un flux par chaîne : les panneaux Xtream refusent les flux
// au-delà de max_connections. L'API renvoie ces compteurs dans user_info
// (appel sans action, déjà autorisé par le relais). Stocké dans une clé dédiée,
// hors du compte et des sauvegardes : après une restauration, la mosaïque relit
// simplement la valeur. 0 signifie « illimité / non renseigné » chez la plupart
// des panneaux : traité comme inconnu pour ne jamais avertir à tort.
export interface XtreamLimits { maxConnections: number | null; activeCons: number | null; fetchedAt: number }

const limitsKey = (playlistId: string) => `cedplay.xtreamLimits:${playlistId}`;
const positiveInt = (value: unknown): number | null => {
  const n = Number(str(value));
  return Number.isInteger(n) && n > 0 ? n : null;
};

function validLimits(value: unknown): XtreamLimits | null {
  const v = object(value);
  if (typeof v.fetchedAt !== 'number' || !Number.isFinite(v.fetchedAt)) return null;
  return { maxConnections: v.maxConnections === null ? null : positiveInt(v.maxConnections), activeCons: v.activeCons === null ? null : positiveInt(v.activeCons), fetchedAt: v.fetchedAt };
}

export function readCachedLimits(playlistId: string): XtreamLimits | null {
  try { return validLimits(JSON.parse(localStorage.getItem(limitsKey(playlistId)) || 'null')); } catch { return null; }
}

export async function fetchXtreamLimits(playlistId: string, account: XtreamAccount): Promise<XtreamLimits> {
  const info = object(object(await catalogRequest(account, '')).user_info);
  const limits: XtreamLimits = { maxConnections: positiveInt(info.max_connections), activeCons: positiveInt(info.active_cons), fetchedAt: Date.now() };
  try { localStorage.setItem(limitsKey(playlistId), JSON.stringify(limits)); } catch { /* stockage indisponible : valeur valable pour cette session */ }
  return limits;
}

export async function catalogRequest(account: XtreamAccount, action: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<unknown> {
  // action vide : informations du compte et du serveur (fuseau horaire).
  const query = new URLSearchParams({ username: account.username, password: account.password, ...(action ? { action } : {}), ...params });
  let data: unknown;
  try {
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({ url: `${account.server}/player_api.php?${query}`, headers: { 'User-Agent': getActiveUserAgent() }, responseType: 'json', connectTimeout: 15000, readTimeout: 30000 });
      if (response.status < 200 || response.status >= 300) throw new Error();
      data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    } else {
      query.set('server', account.server);
      const response = await fetch(`${getProxyBase()}/xtream/catalog?${query}`, { ...(signal ? { signal } : {}) });
      if (!response.ok) throw new Error();
      data = await response.json();
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (object(object(data).user_info).auth === 0 || object(data).error) throw new Error();
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    // Never surface a transport exception containing the account URL.
    throw new Error('Catalogue indisponible. Vérifie ta connexion et l’accès VOD de ton compte.');
  }
}
export function parseCategories(data: unknown): CatalogCategory[] {
  if (!Array.isArray(data)) throw new Error('Le fournisseur n’a pas renvoyé de catégories.');
  return data.map(object).filter(v => identifier(v.category_id)).map(v => ({ id: str(v.category_id), name: str(v.category_name) || 'Sans catégorie' }));
}
export function parseCatalog(data: unknown, kind: 'movie' | 'series'): CatalogItem[] {
  if (!Array.isArray(data)) throw new Error('Le fournisseur n’a pas renvoyé de titres.');
  return data.map(object).filter(v => identifier(kind === 'movie' ? v.stream_id : v.series_id)).map(v => ({
    id: str(kind === 'movie' ? v.stream_id : v.series_id), name: str(v.name) || 'Sans titre',
    poster: safeImage(v.stream_icon || v.cover), categoryId: str(v.category_id), extension: extension(v.container_extension), rating: str(v.rating),
    ...(identifier(v.tmdb_id) && Number(v.tmdb_id) > 0 ? { tmdbId: Number(v.tmdb_id) } : {}),
  }));
}
export function parseDetails(data: unknown): CatalogDetails {
  const root = object(data), info = object(root.info), movie = object(root.movie_data);
  const episodes: Episode[] = [];
  for (const [season, values] of Object.entries(object(root.episodes))) {
    if (!Array.isArray(values)) continue;
    for (const raw of values) {
      const v = object(raw);
      if (!identifier(v.id)) continue;
      episodes.push({ id: str(v.id), name: str(v.title) || `Épisode ${str(v.episode_num)}`, season: str(v.season) || season, number: Number(v.episode_num) || 0, extension: extension(v.container_extension), plot: str(object(v.info).plot) });
    }
  }
  episodes.sort((a, b) => Number(a.season) - Number(b.season) || a.number - b.number);
  const tmdbId = Number(identifier(info.tmdb_id || info.tmdb));
  return { plot: str(info.plot || info.description), cast: str(info.cast || info.actors), director: str(info.director), releaseDate: str(info.releasedate || info.releaseDate || info.release_date), duration: str(info.duration), extension: extension(movie.container_extension), episodes, ...(tmdbId > 0 ? { tmdbId } : {}) };
}
export function vodUrl(account: XtreamAccount, kind: 'movie' | 'series', id: string, ext: string): string {
  if (!identifier(id) || !extension(ext)) throw new Error('Format de lecture absent chez le fournisseur.');
  return `${account.server}/${kind}/${encodeURIComponent(account.username)}/${encodeURIComponent(account.password)}/${id}.${extension(ext)}`;
}

export interface VodProgress { positionMs: number; durationMs: number; updatedAt: number }
export function readVodProgress(key: string): VodProgress | null {
  try {
    const p = JSON.parse(localStorage.getItem(`vod_progress_${key}`) || 'null') as VodProgress | null;
    return p && Number.isFinite(p.positionMs) && p.positionMs > 0 && Number.isFinite(p.durationMs) ? p : null;
  } catch { return null; }
}
export function saveVodProgress(key: string, positionMs: number, durationMs: number) {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || positionMs < 0) return;
  try {
    if (positionMs < 10000 || (durationMs > 0 && durationMs - positionMs < 30000)) localStorage.removeItem(`vod_progress_${key}`);
    else localStorage.setItem(`vod_progress_${key}`, JSON.stringify({ positionMs, durationMs: Math.max(0, durationMs), updatedAt: Date.now() }));
  } catch { /* playback must remain available if storage is full */ }
}
