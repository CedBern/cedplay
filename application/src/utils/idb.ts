import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { PlaylistInfo } from '../types/channel';
import { Backup, createBackup, rebuildPlaylist, playlistSignature, type LocalBackup } from './backup';
import { readMyPlatforms, writeMyPlatforms } from './myPlatforms';
import { mergeExternalWatches } from './externalWatch';
import { v5 as uuidv5 } from 'uuid';

const DB_NAME = 'IPTVPlayerDB';
const DB_VERSION = 2; // bumped to add meta store
const PLAYLIST_STORE_NAME = 'playlists';
const META_STORE_NAME = 'meta';

interface IPTVPlayerDB extends DBSchema {
  [PLAYLIST_STORE_NAME]: {
    key: string;
    value: PlaylistInfo;
  };
  [META_STORE_NAME]: {
    key: string; // meta key
    value: unknown;  // generic value (favorites, settings, lastChannel, etc.)
  };
}

let dbPromise: Promise<IDBPDatabase<IPTVPlayerDB>> | undefined;

/** Un autre onglet peut garder l'ancienne version ouverte : sans borne, `openDB`
 *  reste en attente pour toujours et l'écran de chargement ne rend jamais la main. */
const DB_OPEN_TIMEOUT_MS = 10_000;

function getDb(): Promise<IDBPDatabase<IPTVPlayerDB>> {
  if (dbPromise) return dbPromise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opening = openDB<IPTVPlayerDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains(PLAYLIST_STORE_NAME)) {
        db.createObjectStore(PLAYLIST_STORE_NAME, { keyPath: 'id' });
      }
      if (oldVersion < 2 && !db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
      }
    },
    // Un autre onglet détient la version précédente : la migration attend qu'il se
    // ferme. Le délai ci-dessous évite d'attendre indéfiniment.
    blocked() { /* l'ouverture reste en attente, bornée par DB_OPEN_TIMEOUT_MS */ },
    // Cet onglet empêche un autre de migrer : ne pas fermer la base en cours d'usage,
    // l'autre onglet réessaiera quand cette page sera fermée.
    blocking() { /* rien à faire : la fermeture n'est pas sûre en pleine écriture */ },
    // Connexion perdue (stockage évincé, onglet restauré) : la prochaine lecture
    // doit rouvrir au lieu de réutiliser un handle mort.
    terminated() { dbPromise = undefined; },
  }).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Base de données locale indisponible (ouverture bloquée).')), DB_OPEN_TIMEOUT_MS);
  });
  // Un échec (VersionError après un retour à une version antérieure, quota, mode
  // privé) ne doit jamais être mémorisé pour toute la session.
  dbPromise = Promise.race([opening, timeout]).catch(error => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

export async function savePlaylistToDB(playlist: PlaylistInfo): Promise<void> {
  const db = await getDb();
  await db.put(PLAYLIST_STORE_NAME, playlist);
}

export async function getPlaylistsFromDB(): Promise<PlaylistInfo[]> {
  const db = await getDb();
  return db.getAll(PLAYLIST_STORE_NAME);
}

export async function getPlaylistFromDB(id: string): Promise<PlaylistInfo | undefined> {
  const db = await getDb();
  return db.get(PLAYLIST_STORE_NAME, id);
}

/**
 * Clés `meta` qui n'ont de sens que pour une liste donnée. Sans purge à la suppression,
 * les guides XML (plusieurs Mo chacun) et les index de replay restaient indéfiniment,
 * jusqu'à saturer le quota et faire échouer les écritures de favoris et de réglages.
 */
const PLAYLIST_META_KEYS = [
  'catchupIndex', 'channelFilters', 'epgConfig', 'hiddenGroups', 'hiddenChannels',
  'listCustomization', 'mosaicLayouts', 'playlistRefreshedAt',
] as const;

function metaKeyBelongsToPlaylist(key: string, playlistId: string): boolean {
  if (key === `epgCache_${playlistId}` || key.startsWith(`epgCache_${playlistId}_`)) return true;
  if (key === `epgParsed_v2_${playlistId}`) return true;
  const separator = key.lastIndexOf(':');
  return separator > 0 && key.slice(separator + 1) === playlistId
    && (PLAYLIST_META_KEYS as readonly string[]).includes(key.slice(0, separator));
}

export async function deletePlaylistFromDB(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PLAYLIST_STORE_NAME, META_STORE_NAME], 'readwrite');
  await tx.objectStore(PLAYLIST_STORE_NAME).delete(id);
  const meta = tx.objectStore(META_STORE_NAME);
  for (const key of await meta.getAllKeys()) {
    if (metaKeyBelongsToPlaylist(String(key), id)) await meta.delete(key);
  }
  await tx.done;
}

/** Both stores are read from a single consistent snapshot. */
export async function exportBackupFromDB(): Promise<Backup> {
  const db = await getDb();
  const tx = db.transaction([PLAYLIST_STORE_NAME, META_STORE_NAME], 'readonly');
  const [playlists, meta] = await Promise.all([
    tx.objectStore(PLAYLIST_STORE_NAME).getAll(), tx.objectStore(META_STORE_NAME).getAll(),
  ]);
  await tx.done;
  // Les gros caches régénérables (XMLTV brut/parsé, traductions) n'ont pas leur
  // place dans une sauvegarde : ils sont re-téléchargés à la demande. Le registre
  // des notifications programmées décrit l'état de CET appareil : le restaurer
  // ailleurs ferait croire que des notifications y sont déjà posées.
  const kept = (meta as { key: string; value: unknown }[]).filter(entry =>
    !entry.key.startsWith('epgCache_') && !entry.key.startsWith('epgParsed_') && !entry.key.startsWith('sub_') &&
    entry.key !== 'epgRemindersScheduled');
  // Les positions VOD et comptes Xtream vivent dans localStorage : on les exporte
  // aussi, sinon la reprise de lecture et les identifiants seraient perdus.
  const local: LocalBackup = {};
  const vodProgress: Record<string, { positionMs: number; durationMs: number }> = {};
  const xtreamAccounts: Record<string, { server: string; username: string; password: string }> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      try {
        if (key.startsWith('vod_progress_')) {
          const parsed = JSON.parse(localStorage.getItem(key) || 'null') as { positionMs?: number; durationMs?: number } | null;
          if (parsed && Number.isFinite(parsed.positionMs) && Number.isFinite(parsed.durationMs)) {
            vodProgress[key.slice('vod_progress_'.length)] = { positionMs: parsed.positionMs!, durationMs: parsed.durationMs! };
          }
        } else if (key.startsWith('xtream_account_')) {
          const parsed = JSON.parse(localStorage.getItem(key) || 'null') as { server?: string; username?: string; password?: string } | null;
          if (parsed && typeof parsed.server === 'string' && typeof parsed.username === 'string' && typeof parsed.password === 'string') {
            xtreamAccounts[key.slice('xtream_account_'.length)] = { server: parsed.server, username: parsed.username, password: parsed.password };
          }
        }
      } catch { /* entrée illisible : ignorée */ }
    }
    const lastPlaylist = localStorage.getItem('iptv_last_playlist');
    if (typeof lastPlaylist === 'string' && lastPlaylist) local.lastPlaylist = lastPlaylist;
    const myPlatforms = readMyPlatforms();
    if (myPlatforms.length) local.myPlatforms = myPlatforms;
  } catch { /* localStorage indisponible */ }
  if (Object.keys(vodProgress).length) local.vodProgress = vodProgress;
  if (Object.keys(xtreamAccounts).length) local.xtreamAccounts = xtreamAccounts;
  return createBackup(playlists, kept, Object.keys(local).length ? local : undefined);
}

/** Additive restore: preserve existing lists/settings and commit all changes atomically. */
export async function restoreBackupToDB(backup: Backup): Promise<{ added: number; skipped: number }> {
  const db = await getDb();
  const tx = db.transaction([PLAYLIST_STORE_NAME, META_STORE_NAME], 'readwrite');
  try {
    const playlists = tx.objectStore(PLAYLIST_STORE_NAME);
    const meta = tx.objectStore(META_STORE_NAME);
    const existing = new Map((await playlists.getAll()).map(p => [p.id, p]));
    const remapped = new Map<string, string>();
    let added = 0;
    let skipped = 0;
    for (const saved of backup.playlists) {
      const restored = rebuildPlaylist(saved);
      const previous = existing.get(saved.id);
      if (previous && playlistSignature(createBackup([previous], []).playlists[0]) === playlistSignature(saved)) {
        skipped++;
        continue;
      }
      if (previous) {
        const signature = playlistSignature(saved);
        let attempt = 0;
        do {
          restored.id = uuidv5(`${saved.id}\0${signature}\0${attempt++}`, uuidv5.URL);
        } while (existing.has(restored.id) && playlistSignature({ ...createBackup([existing.get(restored.id)!], []).playlists[0], id: saved.id }) !== signature);
        remapped.set(saved.id, restored.id);
        if (existing.has(restored.id)) { skipped++; continue; }
      }
      await playlists.put(restored);
      existing.set(restored.id, restored);
      added++;
    }
    // Les dispositions de mosaïque locales suivent leur liste reidentifiée,
    // même si la sauvegarde n'en contenait aucune pour elle : fusion par nom,
    // dispositions déjà en place prioritaires.
    for (const [oldId, newId] of remapped) {
      const sourceKey = `mosaicLayouts:${oldId}`;
      const source = await meta.get(sourceKey) as { value: unknown } | undefined;
      if (!Array.isArray(source?.value)) continue;
      const targetKey = `mosaicLayouts:${newId}`;
      const target = await meta.get(targetKey) as { value: unknown } | undefined;
      const local = Array.isArray(target?.value) ? (target!.value as Array<{ name?: unknown }>) : [];
      const names = new Set(local.map(l => typeof l?.name === 'string' ? l.name.toLocaleLowerCase() : ''));
      const incoming = (source!.value as Array<{ name?: unknown }>).filter(l => typeof l?.name === 'string' && !names.has(l.name.toLocaleLowerCase()));
      await meta.put({ key: targetKey, value: [...local, ...incoming] });
      await meta.delete(sourceKey);
    }
    for (const entry of backup.meta) {
      let key = entry.key;
      if (key.startsWith('lastChannel_')) {
        const replacement = remapped.get(key.slice('lastChannel_'.length));
        if (replacement) key = `lastChannel_${replacement}`;
      }
      // État propre à un appareil (notifications déjà posées) : jamais restauré,
      // même présent dans une ancienne sauvegarde — sinon les rappels ne se
      // programment plus ici.
      if (key === 'epgRemindersScheduled') continue;
      // Les dispositions de mosaïque suivent leur liste si la restauration lui
      // attribue un nouvel identifiant.
      if (key.startsWith('mosaicLayouts:')) {
        const replacement = remapped.get(key.slice('mosaicLayouts:'.length));
        if (replacement) key = `mosaicLayouts:${replacement}`;
      }
      const previous = await meta.get(key) as { key: string; value: unknown } | undefined;
      let value = entry.value;
      if (key === 'playHistory' && Array.isArray(value)) value = value.map((raw: PlayHistoryEntry) => {
        const scoped = historyScope(raw), oldId = scoped.playlistId || '';
        const target = remapped.get(oldId);
        return target ? { ...scoped, playlistId: target, channelId: scoped.channelId.replace(`vod:${oldId}:`, `vod:${target}:`) } : scoped;
      });
      if (key === 'vod_watchlist' && Array.isArray(value)) value = value.map((item: VodWatchlistItem) => ({ ...item, playlistId: remapped.get(item.playlistId) || item.playlistId }));
      if (key === 'lastPlaylistId' && typeof value === 'string') value = remapped.get(value) || value;
      if (key === 'favorites') {
        value = [...new Set([...(Array.isArray(previous?.value) ? previous.value : []), ...(value as string[])])];
      } else if (key === 'playHistory' && previous) {
        const entries = [...(Array.isArray(previous.value) ? previous.value : []), ...(value as PlayHistoryEntry[])];
        const latest = new Map<string, PlayHistoryEntry>();
        for (const item of entries.sort((a, b) => b.ts - a.ts)) if (!latest.has(item.channelId)) latest.set(item.channelId, item);
        value = prunePlayHistory([...latest.values()]);
      } else if (key === 'externalWatches') {
        // Fusion par identité éditoriale (type + titre + année), la plus récente
        // l'emporte — même règle que l'import : une œuvre vue sur deux plateformes
        // ne se duplique pas et réimporter une sauvegarde ne rajoute rien.
        const local = Array.isArray(previous?.value) ? previous!.value as PlayHistoryEntry[] : [];
        const incoming = Array.isArray(value) ? value as PlayHistoryEntry[] : [];
        value = mergeExternalWatches(local, incoming);
      } else if (key === 'vod_watchlist' && previous) {
        // Fusion par identité (id + liste + type), la liste locale reste prioritaire.
        const local = Array.isArray(previous.value) ? previous.value as VodWatchlistItem[] : [];
        const incoming = Array.isArray(value) ? value as VodWatchlistItem[] : [];
        const seen = new Set(local.map(w => `${w.playlistId}:${w.kind}:${w.id}`));
        value = [...local, ...incoming.filter(w => !seen.has(`${w.playlistId}:${w.kind}:${w.id}`))];
      } else if (key === 'settings' && previous) {
        // Réglages additifs : les valeurs locales l'emportent, la sauvegarde complète les manques.
        const localSettings = (typeof previous.value === 'object' && previous.value !== null) ? previous.value as Record<string, unknown> : {};
        const incoming = (typeof value === 'object' && value !== null) ? value as Record<string, unknown> : {};
        value = { ...incoming, ...localSettings };
      } else if (key.startsWith('mosaicLayouts:')) {
        // Fusion par nom, les dispositions locales restent prioritaires (même
        // règle que la liste VOD) ; la lecture revalide et plafonne le total
        // (sanitize de mosaicLayouts.ts).
        const local = Array.isArray(previous?.value) ? (previous!.value as Array<{ name?: unknown }>) : [];
        const incoming = Array.isArray(value) ? (value as Array<{ name?: unknown }>) : [];
        const names = new Set(local.map(l => typeof l?.name === 'string' ? l.name.toLocaleLowerCase() : ''));
        value = [...local, ...incoming.filter(l => typeof l?.name === 'string' && !names.has(l.name.toLocaleLowerCase()))];
      } else if (previous) continue;
      await meta.put({ key, value });
    }
    // Ne pas modifier localStorage si la transaction des listes échoue.
    await tx.done;
    // Données locales additives, après validation atomique de la base.
    try {
      if (backup.local?.vodProgress) {
        for (const [sourceKey, progress] of Object.entries(backup.local.vodProgress)) {
          const sourcePlaylist = [...remapped.keys()].find(id => sourceKey.startsWith(`${id}:`));
          const key = sourcePlaylist ? `${remapped.get(sourcePlaylist)}${sourceKey.slice(sourcePlaylist.length)}` : sourceKey;
          if (!localStorage.getItem(`vod_progress_${key}`)) {
            localStorage.setItem(`vod_progress_${key}`, JSON.stringify({ ...progress, updatedAt: Date.now() }));
          }
        }
      }
      if (backup.local?.xtreamAccounts) {
        for (const [sourceId, account] of Object.entries(backup.local.xtreamAccounts)) {
          const playlistId = remapped.get(sourceId) || sourceId;
          if (!localStorage.getItem(`xtream_account_${playlistId}`)) {
            localStorage.setItem(`xtream_account_${playlistId}`, JSON.stringify(account));
          }
        }
      }
      if (backup.local?.lastPlaylist && !localStorage.getItem('iptv_last_playlist')) {
        localStorage.setItem('iptv_last_playlist', backup.local.lastPlaylist);
      }
      if (backup.local?.myPlatforms?.length) {
        // Additif, comme le reste : on ajoute aux plateformes déjà choisies sur cet appareil.
        const current = readMyPlatforms();
        writeMyPlatforms([...current, ...backup.local.myPlatforms.filter(id => !current.includes(id))]);
      }
    } catch { /* localStorage indisponible : la restauration IDB reste valide */ }
    return { added, skipped };
  } catch (error) {
    try { tx.abort(); } catch { /* transaction already aborted */ }
    await tx.done.catch(() => {});
    throw error;
  }
}

// --- Meta (favorites, settings, lastChannel) helpers ---
export async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE_NAME, { key, value });
}

/** Écrit plusieurs clés dans UNE transaction (6 écritures = 1 transaction au lieu de 6). */
export async function setMetaMany(entries: Array<{ key: string; value: unknown }>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(META_STORE_NAME, 'readwrite');
  for (const { key, value } of entries) {
    void tx.store.put({ key, value });
  }
  await tx.done;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const raw = await db.get(META_STORE_NAME, key) as { key: string; value: unknown } | undefined;
  return (raw?.value as T) ?? undefined;
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await getDb();
  try { await db.delete(META_STORE_NAME, key); } catch {/* ignore */}
}

// Favorites
const FAVORITES_KEY = 'favorites';
export async function getFavoritesFromDB(): Promise<string[]> {
  const favs = await getMeta<string[]>(FAVORITES_KEY);
  return Array.isArray(favs) ? favs : [];
}
export async function saveFavoritesToDB(favorites: string[]): Promise<void> {
  await setMeta(FAVORITES_KEY, favorites);
}

// Settings
const SETTINGS_KEY = 'settings';
const SEARCH_MODE_KEY = 'searchMode';
const PLAY_HISTORY_KEY = 'playHistory';
const TELEMETRY_EVENTS_KEY = 'telemetryEvents';
export interface PersistedSettings {
  volume: number;
  autoplay: boolean;
  theme: 'light' | 'dark';
  keyboardNavigation: boolean;
  compactModeDefault?: boolean;
  virtualizationEnabledDefault?: boolean;
  telemetryPersistence?: boolean;
  __version?: number;
}
const SETTINGS_CHANGELOG_KEY = 'settingsChangelog';
const SETTINGS_MIGRATION_STATS_KEY = 'settingsMigrationStats';
export interface SettingsChangeLogEntry { ts: number; changes: Record<string, unknown>; fromVersion?: number; toVersion?: number; reason?: 'user' | 'migration' | 'reset' }
export interface SettingsMigrationStats { migrations: number; lastMigrationTs?: number }
export async function getSettingsFromDB(): Promise<PersistedSettings | undefined> {
  return getMeta<PersistedSettings>(SETTINGS_KEY);
}
export async function saveSettingsToDB(settings: PersistedSettings): Promise<void> {
  await setMeta(SETTINGS_KEY, settings);
}

// Search mode (precise | fuzzy)
export async function saveSearchMode(mode: 'precise' | 'fuzzy'): Promise<void> {
  await setMeta(SEARCH_MODE_KEY, mode);
}
export async function getSearchMode(): Promise<'precise' | 'fuzzy' | undefined> {
  return getMeta<'precise' | 'fuzzy'>(SEARCH_MODE_KEY);
}

// Play history (store array of {channelId, ts} limited to last 50)
export interface PlayHistoryEntry {
  channelId: string;
  ts: number;
  kind?: 'live' | 'vod'; // 'vod' = film/série du catalogue Xtream
  name?: string; // titre VOD (pour les recommandations)
  categoryId?: string; // catégorie VOD (pour les recommandations)
  year?: string; // année du titre VOD
  playlistId?: string;
  mediaKind?: 'movie' | 'series';
  seriesId?: string;
  poster?: string;
  episodeName?: string;
  hiddenFromContinue?: boolean;
  status?: 'started' | 'completed';
  positionMs?: number;
  durationMs?: number;
  /** Identifiant TMDB : clé de jointure entre catalogue, « Vu ailleurs » et profil de goût. */
  tmdbId?: number;
  /** Plateforme d'origine (netflix, prime, youtube…) pour un visionnage hors CedPlay. */
  platform?: string;
}
/** Migration sans perte de l'historique 1.4 : l'identité VOD contient déjà sa liste et son type. */
export function historyScope(entry: PlayHistoryEntry): PlayHistoryEntry {
  const match = entry.kind === 'vod' ? entry.channelId.match(/^vod:(.+):(movie|series):([^:]+)$/) : null;
  return match ? { ...entry, playlistId: entry.playlistId || match[1], mediaKind: entry.mediaKind || match[2] as 'movie' | 'series' } : entry;
}

export function prunePlayHistory(entries: PlayHistoryEntry[]): PlayHistoryEntry[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  return entries.map(historyScope).sort((a, b) => b.ts - a.ts).filter(entry => {
    if (seen.has(entry.channelId)) return false;
    seen.add(entry.channelId);
    const bucket = entry.kind === 'vod' ? `vod:${entry.playlistId || 'legacy'}:${entry.mediaKind || 'unknown'}` : 'live';
    const count = counts.get(bucket) || 0;
    counts.set(bucket, count + 1);
    return count < (entry.kind === 'vod' ? 200 : 50);
  });
}

export async function pushPlayHistory(entry: PlayHistoryEntry): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(META_STORE_NAME, 'readwrite');
  const saved = await tx.store.get(PLAY_HISTORY_KEY) as { value: PlayHistoryEntry[] } | undefined;
  const previous = entry.kind === 'vod' ? saved?.value?.find(e => e.channelId === entry.channelId) : undefined;
  await tx.store.put({ key: PLAY_HISTORY_KEY, value: prunePlayHistory([{ ...previous, hiddenFromContinue: false, ...entry }, ...(saved?.value || [])]) });
  await tx.done;
}
export async function getPlayHistory(): Promise<PlayHistoryEntry[]> {
  return prunePlayHistory((await getMeta<PlayHistoryEntry[]>(PLAY_HISTORY_KEY)) || []);
}

// « Vu ailleurs » : films et séries vus sur d'autres plateformes. Conservés à part
// de l'historique de lecture — ils n'ont aucun flux à reprendre dans CedPlay et ne
// doivent jamais apparaître dans « Reprendre ».
const EXTERNAL_WATCHES_KEY = 'externalWatches';
/** Un import Netflix peut contenir des années de visionnages : on garde les plus récents. */
export const MAX_EXTERNAL_WATCHES = 500;

export async function getExternalWatches(): Promise<PlayHistoryEntry[]> {
  const saved = await getMeta<PlayHistoryEntry[]>(EXTERNAL_WATCHES_KEY);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(entry => entry && typeof entry.channelId === 'string' && typeof entry.ts === 'number' && typeof entry.name === 'string')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_EXTERNAL_WATCHES);
}

export async function saveExternalWatches(entries: PlayHistoryEntry[]): Promise<void> {
  const capped = entries
    .filter(entry => entry && typeof entry.channelId === 'string' && typeof entry.ts === 'number')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_EXTERNAL_WATCHES);
  await setMeta(EXTERNAL_WATCHES_KEY, capped);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('external-watches-updated'));
}

export async function clearExternalWatches(): Promise<void> {
  await saveExternalWatches([]);
}

/** Retirer masque seulement la carte, sans effacer l'historique ni la reprise. */
export async function manageContinueEntry(channelId: string, action: 'hide' | 'completed'): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(META_STORE_NAME, 'readwrite');
  const saved = await tx.store.get(PLAY_HISTORY_KEY) as { value: PlayHistoryEntry[] } | undefined;
  const entries = saved?.value || [];
  const entry = entries.find(e => e.kind === 'vod' && e.channelId === channelId);
  if (entry) {
    if (action === 'hide') entry.hiddenFromContinue = true;
    else { entry.status = 'completed'; entry.ts = Date.now(); }
    await tx.store.put({ key: PLAY_HISTORY_KEY, value: prunePlayHistory(entries) });
  }
  await tx.done;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vod-history-updated'));
}

export async function updateVodHistoryProgress(mediaId: string, positionMs: number, durationMs: number, ended = false): Promise<void> {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || positionMs < 0) return;
  const db = await getDb();
  const tx = db.transaction(META_STORE_NAME, 'readwrite');
  const saved = await tx.store.get(PLAY_HISTORY_KEY) as { value: PlayHistoryEntry[] } | undefined;
  const entries = saved?.value || [];
  const entry = entries.find(e => e.channelId === `vod:${mediaId}`);
  if (entry) {
    const completed = ended || (durationMs > 0 && durationMs - positionMs < 30000);
    const prevPosition = entry.positionMs ?? 0;
    const prevStatus = entry.status;
    Object.assign(entry, { positionMs, durationMs, status: completed ? 'completed' : 'started', ts: Date.now() });
    await tx.store.put({ key: PLAY_HISTORY_KEY, value: prunePlayHistory(entries) });
    // Ne pas réveiller les écouteurs « Pour toi » à chaque tick : seulement si la
    // position a réellement avancé (≥ 4 s) ou si l'état a changé.
    const changed = Math.abs(prevPosition - positionMs) > 4000 || prevStatus !== entry.status;
    if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event('vod-history-updated'));
  }
  await tx.done;
}

// Telemetry events persistence (lightweight). We store an array of events (already truncated by logger max size)
// Types are not imported here to keep the idb utility lightweight; caller casts appropriately.
export async function saveTelemetryEventsToDB(events: unknown[]): Promise<void> {
  await setMeta(TELEMETRY_EVENTS_KEY, events);
}
export async function getTelemetryEventsFromDB<T = unknown>(): Promise<T[] | undefined> {
  const evs = await getMeta<T[]>(TELEMETRY_EVENTS_KEY);
  return evs;
}

// Settings change log
export async function pushSettingsChangeLogEntry(entry: SettingsChangeLogEntry): Promise<void> {
  const existing = await getMeta<SettingsChangeLogEntry[]>(SETTINGS_CHANGELOG_KEY) || [];
  const next = [entry, ...existing].slice(0,25);
  await setMeta(SETTINGS_CHANGELOG_KEY, next);
}
export async function getSettingsChangeLog(): Promise<SettingsChangeLogEntry[]> {
  return (await getMeta<SettingsChangeLogEntry[]>(SETTINGS_CHANGELOG_KEY)) || [];
}

// Settings migration stats
export async function updateSettingsMigrationStats(increment: boolean): Promise<void> {
  const stats = (await getMeta<SettingsMigrationStats>(SETTINGS_MIGRATION_STATS_KEY)) || { migrations: 0 };
  if (increment) {
    stats.migrations += 1;
    stats.lastMigrationTs = Date.now();
  }
  await setMeta(SETTINGS_MIGRATION_STATS_KEY, stats);
}
export async function getSettingsMigrationStats(): Promise<SettingsMigrationStats | undefined> {
  return getMeta<SettingsMigrationStats>(SETTINGS_MIGRATION_STATS_KEY);
}

// Last channel per playlist
export async function getLastChannelForPlaylist(playlistId: string): Promise<string | undefined> {
  return getMeta<string>(`lastChannel_${playlistId}`);
}
export async function setLastChannelForPlaylist(playlistId: string, channelId: string): Promise<void> {
  await setMeta(`lastChannel_${playlistId}`, channelId);
}

// Preferred variant per channel (store chosen variant channel id) - if 'primary', treat as base channel
export async function getPreferredVariantForChannel(channelId: string): Promise<string | undefined> {
  return getMeta<string>(`preferredVariant_${channelId}`);
}
export async function setPreferredVariantForChannel(channelId: string, variantChannelId: string | undefined): Promise<void> {
  if (!variantChannelId) {
    // Clear preference by setting undefined
    await setMeta(`preferredVariant_${channelId}`, undefined as unknown as string);
  } else {
    await setMeta(`preferredVariant_${channelId}`, variantChannelId);
  }
}


// --- VOD Watchlist (« Ma Liste ») ---
export interface VodWatchlistItem {
  id: string;
  name: string;
  kind: 'movie' | 'series';
  poster?: string;
  rating?: string;
  categoryId?: string;
  playlistId: string;
  addedAt: number;
  extension?: string;
}

const VOD_WATCHLIST_KEY = 'vod_watchlist';

export async function getVodWatchlistFromDB(): Promise<VodWatchlistItem[]> {
  const list = await getMeta<VodWatchlistItem[]>(VOD_WATCHLIST_KEY);
  return Array.isArray(list) ? list : [];
}

export async function saveVodWatchlistToDB(list: VodWatchlistItem[]): Promise<void> {
  await setMeta(VOD_WATCHLIST_KEY, list);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vod-watchlist-updated'));
}

export async function toggleVodWatchlist(item: Omit<VodWatchlistItem, 'addedAt'>): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction(META_STORE_NAME, 'readwrite');
  const saved = await tx.store.get(VOD_WATCHLIST_KEY) as { value: VodWatchlistItem[] } | undefined;
  const current = Array.isArray(saved?.value) ? saved.value : [];
  const index = current.findIndex(w => w.id === item.id && w.kind === item.kind && w.playlistId === item.playlistId);
  let isAdded: boolean;
  let updated: VodWatchlistItem[];
  if (index >= 0) {
    updated = current.filter((_, i) => i !== index);
    isAdded = false;
  } else {
    const newItem: VodWatchlistItem = {
      id: item.id,
      name: item.name,
      kind: item.kind,
      playlistId: item.playlistId,
      addedAt: Date.now(),
      ...(item.poster ? { poster: item.poster } : {}),
      ...(item.rating ? { rating: item.rating } : {}),
      ...(item.categoryId ? { categoryId: item.categoryId } : {}),
      ...(item.extension ? { extension: item.extension } : {}),
    };
    updated = [newItem, ...current];
    isAdded = true;
  }
  await tx.store.put({ key: VOD_WATCHLIST_KEY, value: updated });
  await tx.done;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vod-watchlist-updated'));
  return isAdded;
}
