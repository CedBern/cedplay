import { z } from 'zod';
import type { PlaylistInfo } from '@/types/channel';
import {
  getMeta,
  getPlayHistory,
  getPlaylistsFromDB,
  getVodWatchlistFromDB,
  getVodWatchlistTombstonesFromDB,
  historyScope,
  prunePlayHistory,
  pruneWatchlistTombstones,
  replaceVodPlayHistory,
  saveVodWatchlistToDB,
  saveVodWatchlistTombstonesToDB,
  setMeta,
  watchlistItemKey,
  type PlayHistoryEntry,
  type VodWatchlistItem,
} from '@/utils/idb';
import { getXtreamAccount, type XtreamAccount } from '@/utils/xtreamCatalog';

export const SYNC_FORMAT = 'cedplay-sync' as const;
export const SYNC_VERSION = 1 as const;
const SYNC_DEVICE_ID_KEY = 'sync_device_id';
const VOD_PROGRESS_PREFIX = 'vod_progress_';

export interface SyncVodProgressEntry {
  positionMs: number;
  durationMs: number;
  updatedAt: number;
}

export interface SyncPayload {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_VERSION;
  deviceId: string;
  exportedAt: number;
  vodHistory: PlayHistoryEntry[];
  vodProgress: Record<string, SyncVodProgressEntry>;
  watchlist: VodWatchlistItem[];
  watchlistTombstones: Record<string, number>;
  /** Empreintes non sensibles des abonnements par playlistId local, pour traduire les IDs entre appareils. */
  playlistSources?: Record<string, string>;
}

const playHistoryEntrySchema = z.object({
  channelId: z.string().min(1).max(300),
  ts: z.number().finite().nonnegative(),
  kind: z.literal('vod'),
  name: z.string().max(400).optional(),
  categoryId: z.string().max(120).optional(),
  year: z.string().max(16).optional(),
  playlistId: z.string().max(120).optional(),
  mediaKind: z.enum(['movie', 'series']).optional(),
  seriesId: z.string().max(120).optional(),
  poster: z.string().max(1000).optional(),
  episodeName: z.string().max(400).optional(),
  hiddenFromContinue: z.boolean().optional(),
  hiddenAt: z.number().finite().nonnegative().optional(),
  status: z.enum(['started', 'completed']).optional(),
  positionMs: z.number().finite().nonnegative().optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  tmdbId: z.number().int().positive().optional(),
  episodeTmdbId: z.number().int().positive().optional(),
  originChannelId: z.string().max(300).optional(),
  season: z.number().int().nonnegative().optional(),
  episode: z.number().int().nonnegative().optional(),
  platform: z.string().max(80).optional(),
}).strict();

const vodProgressEntrySchema = z.object({
  positionMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
}).strict();

const watchlistItemSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().max(400),
  kind: z.enum(['movie', 'series']),
  poster: z.string().max(1000).optional(),
  rating: z.string().max(32).optional(),
  categoryId: z.string().max(120).optional(),
  playlistId: z.string().min(1).max(120),
  addedAt: z.number().finite().nonnegative(),
  extension: z.string().max(32).optional(),
  tmdbId: z.number().int().positive().optional(),
}).strict();

const syncPayloadSchema = z.object({
  format: z.literal(SYNC_FORMAT),
  version: z.literal(SYNC_VERSION),
  deviceId: z.string().min(1).max(128),
  exportedAt: z.number().finite().nonnegative(),
  vodHistory: z.array(playHistoryEntrySchema).max(1500),
  vodProgress: z.record(z.string().min(1).max(300), vodProgressEntrySchema),
  watchlist: z.array(watchlistItemSchema).max(1500),
  watchlistTombstones: z.record(z.string().min(1).max(320), z.number().finite().nonnegative()),
  playlistSources: z.record(z.string().min(1).max(120), z.string().min(1).max(160)).optional(),
}).strict();

function checkDepth(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('Charge de synchronisation trop imbriquée.');
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) checkDepth(item, depth + 1);
  }
}

export function parseSyncPayload(input: string | unknown): SyncPayload {
  const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  checkDepth(raw);
  const parsed = syncPayloadSchema.parse(raw);
  if (Object.keys(parsed.vodProgress).length > 3000 || Object.keys(parsed.watchlistTombstones).length > 3000) {
    throw new Error('Charge de synchronisation trop volumineuse.');
  }
  return parsed as SyncPayload;
}

export async function getOrCreateSyncDeviceId(): Promise<string> {
  const existing = await getMeta<string>(SYNC_DEVICE_ID_KEY);
  if (typeof existing === 'string' && existing.length >= 8) return existing;
  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `ced-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await setMeta(SYNC_DEVICE_ID_KEY, generated);
  return generated;
}

function readLocalVodProgress(): Record<string, SyncVodProgressEntry> {
  const result: Record<string, SyncVodProgressEntry> = {};
  if (typeof localStorage === 'undefined') return result;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(VOD_PROGRESS_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<SyncVodProgressEntry>;
      if (
        typeof parsed?.positionMs === 'number' &&
        Number.isFinite(parsed.positionMs) &&
        parsed.positionMs >= 0 &&
        typeof parsed?.durationMs === 'number' &&
        Number.isFinite(parsed.durationMs) &&
        parsed.durationMs >= 0
      ) {
        const updatedAt =
          typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) && parsed.updatedAt >= 0
            ? parsed.updatedAt
            : 0;
        result[key.slice(VOD_PROGRESS_PREFIX.length)] = {
          positionMs: parsed.positionMs,
          durationMs: parsed.durationMs,
          updatedAt,
        };
      }
    } catch {
      /* entrée locale corrompue ignorée */
    }
  }
  return result;
}

function pickPreferredHistoryEntry(a: PlayHistoryEntry, b: PlayHistoryEntry): PlayHistoryEntry {
  const effectiveA = Math.max(a.ts, a.hiddenAt ?? 0);
  const effectiveB = Math.max(b.ts, b.hiddenAt ?? 0);
  if (effectiveA !== effectiveB) return effectiveA > effectiveB ? a : b;
  if (a.status !== b.status) return a.status === 'completed' ? a : b;
  const posA = a.positionMs ?? -1;
  const posB = b.positionMs ?? -1;
  if (posA !== posB) return posA > posB ? a : b;
  if (Boolean(a.hiddenFromContinue) !== Boolean(b.hiddenFromContinue)) {
    return a.hiddenFromContinue ? a : b;
  }
  return a;
}

export function mergeVodHistory(local: PlayHistoryEntry[], remote: PlayHistoryEntry[]): PlayHistoryEntry[] {
  const byId = new Map<string, PlayHistoryEntry>();
  for (const raw of [...local, ...remote]) {
    if (!raw || raw.kind !== 'vod' || !raw.channelId) continue;
    const entry = historyScope(raw);
    const prev = byId.get(entry.channelId);
    if (!prev) {
      byId.set(entry.channelId, entry);
      continue;
    }
    const winner = pickPreferredHistoryEntry(prev, entry);
    const loser = winner === prev ? entry : prev;
    // Conserve les métadonnées descriptives manquantes sur le gagnant (poster, tmdbId...)
    byId.set(entry.channelId, {
      ...loser,
      ...winner,
    });
  }
  return prunePlayHistory([...byId.values()]);
}

export function mergeVodProgress(
  local: Record<string, SyncVodProgressEntry>,
  remote: Record<string, SyncVodProgressEntry>,
  mergedHistory: PlayHistoryEntry[],
): Record<string, SyncVodProgressEntry> {
  const merged: Record<string, SyncVodProgressEntry> = {};
  const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const historyByKey = new Map<string, PlayHistoryEntry>();
  for (const h of mergedHistory) {
    if (h.channelId.startsWith('vod:')) historyByKey.set(h.channelId.slice(4), h);
  }

  for (const key of allKeys) {
    const a = local[key];
    const b = remote[key];
    let winner: SyncVodProgressEntry;
    if (a && !b) winner = a;
    else if (b && !a) winner = b;
    else if (a && b) {
      if (a.updatedAt !== b.updatedAt) winner = a.updatedAt > b.updatedAt ? a : b;
      else winner = a.positionMs >= b.positionMs ? a : b;
    } else continue;

    const matchingHistory = historyByKey.get(key);
    if (matchingHistory?.status === 'completed' && matchingHistory.ts >= winner.updatedAt) {
      continue;
    }
    merged[key] = winner;
  }
  return merged;
}

export function mergeWatchlist(
  localItems: VodWatchlistItem[],
  localTombstones: Record<string, number>,
  remoteItems: VodWatchlistItem[],
  remoteTombstones: Record<string, number>,
  now = Date.now(),
): { watchlist: VodWatchlistItem[]; watchlistTombstones: Record<string, number> } {
  const latestItemByKey = new Map<string, VodWatchlistItem>();
  for (const item of [...localItems, ...remoteItems]) {
    const key = watchlistItemKey(item);
    const prev = latestItemByKey.get(key);
    if (!prev || item.addedAt > prev.addedAt) latestItemByKey.set(key, item);
  }

  const maxDelByKey = new Map<string, number>();
  for (const [key, ts] of [...Object.entries(localTombstones), ...Object.entries(remoteTombstones)]) {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    const prev = maxDelByKey.get(key);
    if (prev === undefined || ts > prev) maxDelByKey.set(key, ts);
  }

  const allKeys = new Set([...latestItemByKey.keys(), ...maxDelByKey.keys()]);
  const watchlist: VodWatchlistItem[] = [];
  const rawTombstones: Record<string, number> = {};

  for (const key of allKeys) {
    const item = latestItemByKey.get(key);
    const delTs = maxDelByKey.get(key);
    if (delTs !== undefined && (!item || delTs >= item.addedAt)) {
      rawTombstones[key] = delTs;
    } else if (item) {
      watchlist.push(item);
    }
  }

  watchlist.sort((a, b) => b.addedAt - a.addedAt);
  return {
    watchlist,
    watchlistTombstones: pruneWatchlistTombstones(rawTombstones, now),
  };
}

export async function computeXtreamProviderKey(account: XtreamAccount): Promise<string> {
  let normalizedServer = account.server.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(account.server);
    normalizedServer = `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    /* conserver la chaîne normalisée si URL non standard */
  }
  const canonical = `${normalizedServer}\0${account.username.trim()}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    return `xtream:${hex}`;
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0;
  }
  return `xtream:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function buildLocalPlaylistSources(playlists?: PlaylistInfo[]): Promise<Record<string, string>> {
  const list = playlists ?? (await getPlaylistsFromDB().catch(() => [] as PlaylistInfo[]));
  const sources: Record<string, string> = {};
  for (const playlist of list) {
    const account = getXtreamAccount(playlist);
    if (!account) continue;
    sources[playlist.id] = await computeXtreamProviderKey(account);
  }
  return sources;
}

export interface LocalCatalogRemapIndex {
  localPlaylistIds: Set<string>;
  playlistByProviderKey: Map<string, string>;
  tmdbMovieTargets: Map<number, { playlistId: string; id: string; channelId: string }>;
  tmdbEpisodeTargets: Map<string, { playlistId: string; id: string; channelId: string; seriesId?: string }>;
  tmdbSeriesTargets: Map<number, { playlistId: string; id: string }>;
}

export async function buildLocalCatalogRemapIndex(options?: {
  playlists?: PlaylistInfo[];
  playlistSources?: Record<string, string>;
  vodHistory?: PlayHistoryEntry[];
  watchlist?: VodWatchlistItem[];
}): Promise<LocalCatalogRemapIndex> {
  const [playlists, history, watchlist] = await Promise.all([
    options?.playlists ? Promise.resolve(options.playlists) : getPlaylistsFromDB().catch(() => [] as PlaylistInfo[]),
    options?.vodHistory ? Promise.resolve(options.vodHistory) : getPlayHistory().catch(() => [] as PlayHistoryEntry[]),
    options?.watchlist ? Promise.resolve(options.watchlist) : getVodWatchlistFromDB().catch(() => [] as VodWatchlistItem[]),
  ]);
  const sources = options?.playlistSources ?? (await buildLocalPlaylistSources(playlists));

  const localPlaylistIds = new Set<string>(playlists.map(p => p.id));
  const playlistByProviderKey = new Map<string, string>();
  for (const [pid, key] of Object.entries(sources)) {
    if (!playlistByProviderKey.has(key)) playlistByProviderKey.set(key, pid);
  }

  const tmdbMovieTargets = new Map<number, { playlistId: string; id: string; channelId: string }>();
  const tmdbEpisodeTargets = new Map<string, { playlistId: string; id: string; channelId: string; seriesId?: string }>();
  const tmdbSeriesTargets = new Map<number, { playlistId: string; id: string }>();

  for (const raw of history) {
    if (raw.kind !== 'vod') continue;
    const entry = historyScope(raw);
    const tmdbId = entry.tmdbId;
    if (!tmdbId) continue;
    const match = entry.channelId.match(/^vod:([^:]+):(movie|series):([^:]+)$/);
    if (!match) continue;
    const [, pid, kind, id] = match;
    if (localPlaylistIds.size > 0 && !localPlaylistIds.has(pid)) continue;
    if (kind === 'movie') {
      if (!tmdbMovieTargets.has(tmdbId)) {
        tmdbMovieTargets.set(tmdbId, { playlistId: pid, id, channelId: entry.channelId });
      }
    } else if (kind === 'series') {
      if (entry.season !== undefined && entry.episode !== undefined) {
        const epKey = `${tmdbId}:s${entry.season}:e${entry.episode}`;
        if (!tmdbEpisodeTargets.has(epKey)) {
          tmdbEpisodeTargets.set(epKey, {
            playlistId: pid,
            id,
            channelId: entry.channelId,
            ...(entry.seriesId ? { seriesId: entry.seriesId } : {}),
          });
        }
      }
      if (entry.seriesId && !tmdbSeriesTargets.has(tmdbId)) {
        tmdbSeriesTargets.set(tmdbId, { playlistId: pid, id: entry.seriesId });
      }
    }
  }

  for (const item of watchlist) {
    if (!item.tmdbId) continue;
    if (localPlaylistIds.size > 0 && !localPlaylistIds.has(item.playlistId)) continue;
    if (item.kind === 'movie' && !tmdbMovieTargets.has(item.tmdbId)) {
      tmdbMovieTargets.set(item.tmdbId, {
        playlistId: item.playlistId,
        id: item.id,
        channelId: `vod:${item.playlistId}:movie:${item.id}`,
      });
    } else if (item.kind === 'series' && !tmdbSeriesTargets.has(item.tmdbId)) {
      tmdbSeriesTargets.set(item.tmdbId, { playlistId: item.playlistId, id: item.id });
    }
  }

  return {
    localPlaylistIds,
    playlistByProviderKey,
    tmdbMovieTargets,
    tmdbEpisodeTargets,
    tmdbSeriesTargets,
  };
}

export function remapSyncPayloadToLocal(remote: SyncPayload, index: LocalCatalogRemapIndex): SyncPayload {
  const resolvePlaylistId = (remotePid: string | undefined): string | undefined => {
    if (!remotePid) return undefined;
    if (index.localPlaylistIds.has(remotePid)) return remotePid;
    const providerKey = remote.playlistSources?.[remotePid];
    if (providerKey) return index.playlistByProviderKey.get(providerKey);
    return undefined;
  };

  const progressKeyMap = new Map<string, string>();
  const watchlistKeyMap = new Map<string, string>();

  const vodHistory: PlayHistoryEntry[] = remote.vodHistory.map(raw => {
    const entry = historyScope(raw);
    const match = entry.channelId.match(/^vod:([^:]+):(movie|series):([^:]+)$/);
    if (!match) return entry;
    const [, remotePid, kind, id] = match;
    const oldProgressKey = `${remotePid}:${kind}:${id}`;
    const mappedPid = resolvePlaylistId(remotePid);
    if (mappedPid) {
      if (mappedPid !== remotePid) {
        progressKeyMap.set(oldProgressKey, `${mappedPid}:${kind}:${id}`);
        return {
          ...entry,
          channelId: `vod:${mappedPid}:${kind}:${id}`,
          playlistId: mappedPid,
        };
      }
      return entry;
    }

    if (entry.tmdbId) {
      if (kind === 'movie') {
        const target = index.tmdbMovieTargets.get(entry.tmdbId);
        if (target) {
          progressKeyMap.set(oldProgressKey, `${target.playlistId}:movie:${target.id}`);
          return {
            ...entry,
            channelId: target.channelId,
            playlistId: target.playlistId,
          };
        }
      } else if (kind === 'series' && entry.season !== undefined && entry.episode !== undefined) {
        const target = index.tmdbEpisodeTargets.get(`${entry.tmdbId}:s${entry.season}:e${entry.episode}`);
        if (target) {
          progressKeyMap.set(oldProgressKey, `${target.playlistId}:series:${target.id}`);
          return {
            ...entry,
            channelId: target.channelId,
            playlistId: target.playlistId,
            ...(target.seriesId ? { seriesId: target.seriesId } : {}),
          };
        }
      }
    }
    return entry;
  });

  const vodProgress: Record<string, SyncVodProgressEntry> = {};
  for (const [rawKey, entry] of Object.entries(remote.vodProgress)) {
    let targetKey = progressKeyMap.get(rawKey) ?? rawKey;
    if (targetKey === rawKey) {
      const m = rawKey.match(/^([^:]+):(movie|series):([^:]+)$/);
      if (m) {
        const mappedPid = resolvePlaylistId(m[1]);
        if (mappedPid && mappedPid !== m[1]) {
          targetKey = `${mappedPid}:${m[2]}:${m[3]}`;
        }
      }
    }
    const prev = vodProgress[targetKey];
    if (!prev || entry.updatedAt > prev.updatedAt || (entry.updatedAt === prev.updatedAt && entry.positionMs > prev.positionMs)) {
      vodProgress[targetKey] = entry;
    }
  }

  const watchlist: VodWatchlistItem[] = remote.watchlist.map(item => {
    const oldKey = watchlistItemKey(item);
    const mappedPid = resolvePlaylistId(item.playlistId);
    if (mappedPid) {
      if (mappedPid !== item.playlistId) {
        watchlistKeyMap.set(oldKey, `${mappedPid}:${item.kind}:${item.id}`);
        return { ...item, playlistId: mappedPid };
      }
      return item;
    }
    if (item.tmdbId) {
      const target = item.kind === 'movie'
        ? index.tmdbMovieTargets.get(item.tmdbId)
        : index.tmdbSeriesTargets.get(item.tmdbId);
      if (target) {
        watchlistKeyMap.set(oldKey, `${target.playlistId}:${item.kind}:${target.id}`);
        return {
          ...item,
          playlistId: target.playlistId,
          id: target.id,
        };
      }
    }
    return item;
  });

  const watchlistTombstones: Record<string, number> = {};
  for (const [rawKey, ts] of Object.entries(remote.watchlistTombstones)) {
    let targetKey = watchlistKeyMap.get(rawKey) ?? rawKey;
    if (targetKey === rawKey) {
      const m = rawKey.match(/^([^:]+):(movie|series):([^:]+)$/);
      if (m) {
        const mappedPid = resolvePlaylistId(m[1]);
        if (mappedPid && mappedPid !== m[1]) {
          targetKey = `${mappedPid}:${m[2]}:${m[3]}`;
        }
      }
    }
    const prev = watchlistTombstones[targetKey];
    if (prev === undefined || ts > prev) {
      watchlistTombstones[targetKey] = ts;
    }
  }

  return {
    ...remote,
    vodHistory,
    vodProgress,
    watchlist,
    watchlistTombstones,
  };
}

export function mergeSyncPayloads(local: SyncPayload, remote: SyncPayload, now = Date.now()): SyncPayload {
  const vodHistory = mergeVodHistory(local.vodHistory, remote.vodHistory);
  const vodProgress = mergeVodProgress(local.vodProgress, remote.vodProgress, vodHistory);
  const { watchlist, watchlistTombstones } = mergeWatchlist(
    local.watchlist,
    local.watchlistTombstones,
    remote.watchlist,
    remote.watchlistTombstones,
    now,
  );
  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    deviceId: local.deviceId,
    exportedAt: now,
    vodHistory,
    vodProgress,
    watchlist,
    watchlistTombstones,
    ...(local.playlistSources && Object.keys(local.playlistSources).length > 0
      ? { playlistSources: local.playlistSources }
      : {}),
  };
}

export async function buildLocalSyncPayload(): Promise<SyncPayload> {
  const [deviceId, history, watchlist, watchlistTombstones, playlistSources] = await Promise.all([
    getOrCreateSyncDeviceId(),
    getPlayHistory(),
    getVodWatchlistFromDB(),
    getVodWatchlistTombstonesFromDB(),
    buildLocalPlaylistSources(),
  ]);
  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    deviceId,
    exportedAt: Date.now(),
    vodHistory: history.filter(e => e.kind === 'vod'),
    vodProgress: readLocalVodProgress(),
    watchlist,
    watchlistTombstones,
    ...(Object.keys(playlistSources).length > 0 ? { playlistSources } : {}),
  };
}

export async function applyMergedSyncPayload(merged: SyncPayload): Promise<{
  changed: boolean;
  vodHistoryCount: number;
  vodProgressCount: number;
  watchlistCount: number;
}> {
  const historyChanged = await replaceVodPlayHistory(merged.vodHistory);

  let progressChanged = false;
  if (typeof localStorage !== 'undefined') {
    const currentProgress = readLocalVodProgress();
    const completedByKey = new Map<string, number>();
    for (const h of merged.vodHistory) {
      if (h.status === 'completed' && h.channelId.startsWith('vod:')) {
        completedByKey.set(h.channelId.slice(4), h.ts);
      }
    }
    for (const [key, entry] of Object.entries(merged.vodProgress)) {
      const prev = currentProgress[key];
      if (!prev || entry.updatedAt > prev.updatedAt || entry.positionMs !== prev.positionMs || entry.durationMs !== prev.durationMs) {
        localStorage.setItem(`${VOD_PROGRESS_PREFIX}${key}`, JSON.stringify(entry));
        progressChanged = true;
      }
    }
    for (const [key, prev] of Object.entries(currentProgress)) {
      const completedTs = completedByKey.get(key);
      if (completedTs !== undefined && completedTs >= prev.updatedAt && !merged.vodProgress[key]) {
        localStorage.removeItem(`${VOD_PROGRESS_PREFIX}${key}`);
        progressChanged = true;
      }
    }
  }

  let watchlistChanged = false;
  const [prevWatchlist, prevTombstones] = await Promise.all([
    getVodWatchlistFromDB(),
    getVodWatchlistTombstonesFromDB(),
  ]);
  if (JSON.stringify(prevWatchlist) !== JSON.stringify(merged.watchlist)) {
    await saveVodWatchlistToDB(merged.watchlist);
    watchlistChanged = true;
  }
  if (JSON.stringify(prevTombstones) !== JSON.stringify(merged.watchlistTombstones)) {
    await saveVodWatchlistTombstonesToDB(merged.watchlistTombstones);
    watchlistChanged = true;
  }

  if (historyChanged && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('vod-history-updated'));
  }

  return {
    changed: historyChanged || progressChanged || watchlistChanged,
    vodHistoryCount: merged.vodHistory.length,
    vodProgressCount: Object.keys(merged.vodProgress).length,
    watchlistCount: merged.watchlist.length,
  };
}
