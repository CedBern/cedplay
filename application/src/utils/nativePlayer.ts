import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { toast } from 'sonner';
import { isPlaybackDelegated, setPlaybackDelegated } from './playbackOwnership';
import { readVodProgress, saveVodProgress } from './xtreamCatalog';
import { updateVodHistoryProgress, pushPlayHistory } from './idb';
import type { Channel } from '@/types/channel';
import type { EPGData } from '@/types/epg';
import { getActiveUserAgent } from './userAgent';

interface NativeStream { url: string; title: string }
/** Bilan d'une session du lecteur natif : interruptions, images perdues, erreurs (aucune URL). */
export interface PlaybackStats {
  durationMs?: number;
  zaps?: number;
  rebuffers?: number;
  rebufferMs?: number;
  droppedFrames?: number;
  errors?: number;
  lastErrorCode?: string;
}
interface VodResult { positionMs: number; durationMs: number; completed?: boolean | undefined; mediaId?: string; progress?: { mediaId: string; positionMs: number; durationMs: number; completed?: boolean }[]; stats?: PlaybackStats | undefined }

export interface LocalFolder { uri: string; name: string }
export interface LocalMedia {
  uri: string;
  name: string;
  size: number;
  lastModified: number;
  subtitleUri?: string;
}

export interface ScheduledRecording {
  id: string;
  url: string;
  title: string;
  startTimeMs: number;
  durationMs: number;
}

interface NativePlayerPluginType {
  open(options: { url: string; title?: string | undefined; tvUi?: boolean | undefined; channelUrls?: string[] | undefined; channelTitles?: string[] | undefined; channelIndex?: number | undefined; channelGroups?: string[] | undefined; channelEpg?: NativeProgram[][] | undefined; channelNumbers?: string[] | undefined; channelTotal?: number | undefined; channelLogos?: string[] | undefined; listKey?: string | undefined; listIndex?: number | undefined; windowStart?: number | undefined }): Promise<{ channelUrl?: string | undefined; jumpNumber?: string | undefined; stats?: PlaybackStats | undefined }>;
  openExternal(options: { url: string; title?: string | undefined }): Promise<void>;
  openWeb(options: { url: string; title?: string | undefined }): Promise<void>;
  openMosaic(options: { streams: NativeStream[] }): Promise<void>;
  openVod(options: { url: string; title: string; tvUi?: boolean | undefined; mediaId: string; startPositionMs: number; restart: boolean; subtitleUrl?: string | undefined; subtitleContent?: string | undefined; channelUrls?: string[] | undefined; channelTitles?: string[] | undefined; episodeIds?: string[] | undefined; channelIndex?: number | undefined }): Promise<VodResult>;
  pickFolder(): Promise<{ uri: string; name: string } | null>;
  listFolders(): Promise<{ folders: LocalFolder[] }>;
  scanLibrary(options: { uri?: string }): Promise<{ files: LocalMedia[]; count: number; truncated: boolean }>;
  removeFolder(options: { uri: string }): Promise<void>;
  playLocal(options: { uri: string; title: string; subtitleUri?: string; tvUi?: boolean }): Promise<{ positionMs: number; durationMs: number; completed?: boolean }>;
  pickRecordingsFolder(): Promise<{ uri: string; name: string } | null>;
  getRecordingsFolder(): Promise<{ uri: string; name: string } | null>;
  listRecordings(): Promise<{ files: LocalMedia[] }>;
  deleteRecording(options: { uri: string }): Promise<void>;
  scheduleRecording(options: { url: string; title: string; startTimeMs: number; durationMs: number; userAgent: string }): Promise<{ id: string }>;
  listScheduledRecordings(): Promise<{ schedules: ScheduledRecording[] }>;
  cancelScheduledRecording(options: { id: string }): Promise<void>;
  setChannelShortcuts(options: { items: { id: string; name: string }[] }): Promise<void>;
  isTelevision(): Promise<{ tv: boolean }>;
  setPlayerOptions(options: NativePlayerOptions): Promise<void>;
  setZapList(options: { key: string; data: string; count: number }): Promise<void>;
  setHomeFavorites(options: { items: { id: string; name: string; logo?: string | undefined }[] }): Promise<void>;
  addWatchNext(options: { id: string; name: string; logo?: string | undefined }): Promise<void>;
  showPreview(options: PreviewRequest): Promise<void>;
  stopPreview(): Promise<void>;
  hidePreview(): Promise<void>;
  addListener(event: 'previewState', listener: (data: { state: PreviewState }) => void): Promise<PluginListenerHandle>;
}

/** Réglages du lecteur Android, gardés par Android pour le lecteur, l'aperçu, la mosaïque et les enregistrements. */
export interface NativePlayerOptions {
  userAgent: string;
  buffer: 'small' | 'normal' | 'large' | 'max';
  decoder: 'hardware' | 'software';
  afr: boolean;
}

/** Cadre de l'aperçu, en pixels CSS de la page. */
export interface PreviewRequest { url: string; x: number; y: number; width: number; height: number; radius: number; dpr: number }
export type PreviewState = 'loading' | 'playing' | 'error';

const NativePlayer = registerPlugin<NativePlayerPluginType>('NativePlayer');

function isAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativePlayer');
}

/** Programme transmis au lecteur Android : [début ms, fin ms, titre]. */
export type NativeProgram = [number, number, string];
export interface NativeZapContext {
  urls: string[]; titles: string[]; index: number; groups?: string[]; epg?: NativeProgram[][]; numbers?: string[]; total?: number; logos?: string[];
  /** Début de la fenêtre dans la liste complète. */
  start?: number;
  /** Liste complète déjà transmise au lecteur Android (zapping sur toutes les chaînes). */
  listKey?: string;
  listIndex?: number;
}

/** Liste complète transmise au lecteur Android : une fois par changement de liste, pas à chaque ouverture. */
let syncedZapList: { channels: Channel[]; key: string } | null = null;
let zapListSync: Promise<void> | null = null;
const tsvField = (value: string | undefined) => (value ?? '').replace(/[\t\r\n]+/g, ' ');

/** Contenu de zaplist.tsv : « url, nom, groupe, numéro » par ligne. */
export function zapListData(channels: Channel[]): string {
  const numbers = channelNumbering(channels).numbers;
  return channels.map((c, i) => `${tsvField(c.url)}\t${tsvField(c.name)}\t${tsvField(c.group)}\t${numbers[i] ?? ''}`).join('\n');
}

export function syncNativeZapList(channels: Channel[]): Promise<void> {
  if (!isAvailable() || !channels.length) return Promise.resolve();
  if (syncedZapList?.channels === channels) return zapListSync ?? Promise.resolve();
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  syncedZapList = null;
  const run = NativePlayer.setZapList({ key, data: zapListData(channels), count: channels.length })
    .then(() => { syncedZapList = { channels, key }; })
    .catch(() => { /* le lecteur garde la fenêtre de 300 chaînes */ });
  zapListSync = run;
  return run;
}

/** « 007 » et « 7 » désignent la même chaîne ; tout ce qui n'est pas un nombre est ignoré. */
function normalizeNumber(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return /^\d{1,9}$/.test(trimmed) ? String(Number(trimmed)) : '';
}

interface ChannelNumbering { numbers: string[]; byNumber: Map<string, number> }
const numberingCache = new WeakMap<Channel[], ChannelNumbering>();

/**
 * Numérotation d'une liste, calculée une seule fois sur la liste complète pour que
 * lecteur Android et page désignent toujours la même chaîne, quelle que soit la
 * fenêtre de chaînes transmise au lecteur :
 * - tvg-chno numérique d'abord : la première chaîne qui le porte le garde, les doublons non ;
 * - sinon la position (1 = première), si ce numéro n'est pas déjà pris par un tvg-chno.
 * Chaque numéro désigne donc une seule chaîne ; une chaîne peut rester sans numéro.
 */
export function channelNumbering(channels: Channel[]): ChannelNumbering {
  const cached = numberingCache.get(channels);
  if (cached) return cached;
  const numbers = new Array<string>(channels.length).fill('');
  const byNumber = new Map<string, number>();
  channels.forEach((c, i) => {
    const chno = normalizeNumber(c.chno);
    if (chno && !byNumber.has(chno)) { byNumber.set(chno, i); numbers[i] = chno; }
  });
  channels.forEach((_, i) => {
    if (numbers[i]) return;
    const position = String(i + 1);
    if (!byNumber.has(position)) { byNumber.set(position, i); numbers[i] = position; }
  });
  const result = { numbers, byNumber };
  numberingCache.set(channels, result);
  return result;
}

/** Chaîne correspondant à un numéro saisi, selon la même numérotation que le lecteur Android. */
export function findChannelByNumber(channels: Channel[], number: string): Channel | null {
  const typed = normalizeNumber(number);
  if (!typed) return null;
  const index = channelNumbering(channels).byNumber.get(typed);
  return index === undefined ? null : channels[index] ?? null;
}

const MAX_ZAP_WINDOW = 300;
/** Programmes à venir transmis par chaîne : de quoi tenir le bandeau plusieurs heures. */
const MAX_PROGRAMS_PER_CHANNEL = 6;

/** Journalise le bilan d'une session du lecteur natif (diagnostic local, sans identifiants). */
function recordNativeStats(stats: PlaybackStats | undefined | null): void {
  if (!stats || typeof stats !== 'object') return;
  void import('@/utils/telemetry/logger').then(m => {
    m.globalTelemetryLogger.log('native-session', {
      ...(typeof stats.durationMs === 'number' ? { durationMs: stats.durationMs } : {}),
      ...(typeof stats.zaps === 'number' ? { zaps: stats.zaps } : {}),
      ...(typeof stats.rebuffers === 'number' ? { rebuffers: stats.rebuffers } : {}),
      ...(typeof stats.rebufferMs === 'number' ? { rebufferMs: stats.rebufferMs } : {}),
      ...(typeof stats.droppedFrames === 'number' ? { droppedFrames: stats.droppedFrames } : {}),
      ...(typeof stats.errors === 'number' ? { errors: stats.errors } : {}),
      ...(stats.lastErrorCode ? { lastErrorCode: stats.lastErrorCode } : {}),
    });
  }).catch(() => { /* télémétrie indisponible */ });
}

/** Guide en mémoire, tenu à jour par l'écran principal, pour le bandeau du lecteur Android. */
let nativeEpg: EPGData | null = null;
export function setNativeEpg(data: EPGData | null | undefined): void { nativeEpg = data ?? null; }
/** Guide chargé (diagnostic mémoire). */
export function getLoadedEpg(): EPGData | null { return nativeEpg; }

function upcomingPrograms(channel: Channel, epg: EPGData, now: number): NativeProgram[] {
  const programs = epg[channel.id];
  if (!programs?.length) return [];
  const out: NativeProgram[] = [];
  for (const p of programs) {
    const end = new Date(p.endTime).getTime();
    if (end <= now) continue;
    out.push([new Date(p.startTime).getTime(), end, p.title]);
    if (out.length >= MAX_PROGRAMS_PER_CHANNEL) break;
  }
  return out;
}

export function buildNativeZap(channels: Channel[], selected: Channel, maxWindow = MAX_ZAP_WINDOW, epg: EPGData | null = nativeEpg): NativeZapContext {
  let index = channels.findIndex(c => c.id === selected.id || c.variants?.some(v => v.id === selected.id));
  const ordered = [...channels];
  if (index < 0) { index = ordered.length; ordered.push(selected); }
  else ordered[index] = selected;

  let start = 0;
  let end = ordered.length;
  if (ordered.length > maxWindow) {
    const half = Math.floor(maxWindow / 2);
    start = Math.max(0, index - half);
    end = Math.min(ordered.length, start + maxWindow);
    if (end - start < maxWindow) start = Math.max(0, end - maxWindow);
  }

  const windowSlice = ordered.slice(start, end);
  const allNumbers = channelNumbering(channels).numbers;
  const zap: NativeZapContext = {
    urls: windowSlice.map(c => c.url),
    titles: windowSlice.map(c => c.name),
    index: index - start,
    start,
    // Chaîne choisie absente de la liste (ajoutée en fin) : pas de numéro, la page ne la retrouverait pas.
    numbers: windowSlice.map((_, i) => allNumbers[start + i] ?? ''),
    total: ordered.length,
  };
  if (windowSlice.some(c => c.group)) zap.groups = windowSlice.map(c => c.group || '');
  if (windowSlice.some(c => c.logo)) zap.logos = windowSlice.map(c => c.logo || '');
  // Chaîne trouvée dans une liste déjà transmise : le lecteur peut zapper sur toute la liste.
  if (syncedZapList?.channels === channels && index < channels.length) { zap.listKey = syncedZapList.key; zap.listIndex = index; }
  if (epg) {
    const now = Date.now();
    // La chaîne choisie peut être une variante : son guide est rangé sous l'id de la chaîne de base.
    const base = channels[index];
    zap.epg = windowSlice.map((c, i) => {
      const own = upcomingPrograms(c, epg, now);
      return own.length || i !== zap.index || !base ? own : upcomingPrograms(base, epg, now);
    });
  }
  return zap;
}

/** Interface télécommande en cours (réglage Affichage › Interface, ou détection TV) :
 *  le lecteur natif l'adopte pour ses commandes (bandeau en rangées au lieu de la barre tactile). */
function isTvUi(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('tv-mode');
}

async function openPlayer(method: 'open' | 'openExternal', url: string, title?: string, zap?: NativeZapContext, onReturned?: (url: string) => void, onJump?: (number: string) => void): Promise<boolean> {
  if (!isAvailable() || isPlaybackDelegated()) return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    toast.error('Adresse de flux invalide : une URL HTTP ou HTTPS est nécessaire.');
    return false;
  }
  setPlaybackDelegated(true);
  try {
    // The Android plugin resolves when the activity closes, not when it opens.
    const result = await NativePlayer[method]({
      url, title,
      ...(method === 'open' ? { tvUi: isTvUi() } : {}),
      ...(zap && zap.urls.length === zap.titles.length && zap.index >= 0 && zap.index < zap.urls.length
        ? {
          channelUrls: zap.urls, channelTitles: zap.titles, channelIndex: zap.index,
          ...(zap.groups?.length === zap.urls.length ? { channelGroups: zap.groups } : {}),
          ...(zap.epg?.length === zap.urls.length ? { channelEpg: zap.epg } : {}),
          ...(zap.numbers?.length === zap.urls.length ? { channelNumbers: zap.numbers, channelTotal: zap.total ?? zap.urls.length } : {}),
          ...(zap.logos?.length === zap.urls.length ? { channelLogos: zap.logos } : {}),
          ...(zap.listKey && zap.listIndex !== undefined && zap.start !== undefined ? { listKey: zap.listKey, listIndex: zap.listIndex, windowStart: zap.start } : {}),
        }
        : {}),
    });
    if (result && 'stats' in result && result.stats) recordNativeStats(result.stats);
    // Avec la liste complète, la dernière chaîne regardée peut être hors de la fenêtre transmise.
    if (result && 'channelUrl' in result && typeof result.channelUrl === 'string' && (zap?.urls.includes(result.channelUrl) || zap?.listKey)) onReturned?.(result.channelUrl);
    // Numéro tapé hors du contexte transmis : la page relance le lecteur sur cette chaîne,
    // une fois celui-ci refermé (le verrou de lecture déléguée est levé dans finally).
    const jump = result && 'jumpNumber' in result ? result.jumpNumber : undefined;
    if (onJump && typeof jump === 'string' && /^\d{1,9}$/.test(jump)) window.setTimeout(() => onJump(jump), 0);
    return true;
  } catch {
    toast.error(method === 'open'
      ? 'Impossible d’ouvrir le lecteur Android. Réessaie ou choisis un lecteur externe.'
      : 'Impossible d’ouvrir un lecteur externe. Vérifie qu’un lecteur comme VLC est installé.');
    return false;
  } finally {
    // Web playback remains stopped; resuming it requires a user action.
    setPlaybackDelegated(false);
  }
}

export const NativePlayerBridge = {
  isAvailable,
  /** true sur un téléviseur ou une box Android TV ; null si la question ne peut pas être posée. */
  async isTelevision(): Promise<boolean | null> {
    if (!isAvailable()) return null;
    try { return (await NativePlayer.isTelevision()).tv === true; } catch { return null; }
  },
  /** Aperçu vidéo de l'écran Direct TV, posé par Android au-dessus du cadre donné. */
  async showPreview(request: PreviewRequest): Promise<boolean> {
    if (!isAvailable() || isPlaybackDelegated()) return false;
    try { await NativePlayer.showPreview(request); return true; } catch { return false; }
  },
  /** Coupe le flux de l'aperçu (la connexion au fournisseur se libère) en gardant le lecteur prêt. */
  async stopPreview(): Promise<void> {
    if (!isAvailable()) return;
    try { await NativePlayer.stopPreview(); } catch { /* rien à arrêter */ }
  },
  async hidePreview(): Promise<void> {
    if (!isAvailable()) return;
    try { await NativePlayer.hidePreview(); } catch { /* rien à fermer */ }
  },
  /** État de l'aperçu (chargement, image affichée, erreur). Renvoie la fonction de désabonnement. */
  onPreviewState(listener: (state: PreviewState) => void): () => void {
    if (!isAvailable()) return () => {};
    let handle: PluginListenerHandle | null = null;
    let removed = false;
    void NativePlayer.addListener('previewState', data => listener(data.state)).then(h => {
      if (removed) void h.remove(); else handle = h;
    }).catch(() => {});
    return () => { removed = true; void handle?.remove(); };
  },
  /** Transmet les réglages du lecteur (User-Agent de la liste, mémoire tampon, décodage, AFR). */
  async setPlayerOptions(options: NativePlayerOptions): Promise<void> {
    if (!isAvailable()) return;
    try { await NativePlayer.setPlayerOptions(options); } catch { /* ancienne version native : réglages par défaut */ }
  },
  /** Android TV : rangée Favoris de l'écran d'accueil (30 au plus). */
  async setHomeFavorites(items: { id: string; name: string; logo?: string | undefined }[]): Promise<void> {
    if (!isAvailable()) return;
    try { await NativePlayer.setHomeFavorites({ items: items.slice(0, 30) }); } catch { /* lanceur sans rangées */ }
  },
  /** Android TV : dernière chaîne regardée dans « À suivre ». */
  async addWatchNext(channel: { id: string; name: string; logo?: string | undefined }): Promise<void> {
    if (!isAvailable()) return;
    try { await NativePlayer.addWatchNext({ id: channel.id, name: channel.name, ...(channel.logo ? { logo: channel.logo } : {}) }); } catch { /* lanceur sans rangée À suivre */ }
  },
  /** Raccourcis de l'icône Android (appui long) : 4 favoris au plus. */
  async setChannelShortcuts(items: { id: string; name: string }[]): Promise<void> {
    if (!isAvailable()) return;
    try { await NativePlayer.setChannelShortcuts({ items: items.slice(0, 4) }); } catch { /* lanceur sans raccourcis */ }
  },
  async openMosaic(streams: NativeStream[]): Promise<boolean> {
    if (!isAvailable() || isPlaybackDelegated()) return false;
    if (streams.length < 2 || streams.length > 8 || new Set(streams.map(s => s.url)).size !== streams.length || streams.some(s => {
      try { return !['http:', 'https:'].includes(new URL(s.url).protocol); } catch { return true; }
    })) { toast.error('Choisis de 2 à 8 flux HTTP distincts pour la mosaïque.'); return false; }
    setPlaybackDelegated(true);
    try { await NativePlayer.openMosaic({ streams }); return true; }
    catch { toast.error('Impossible d’ouvrir la mosaïque Android.'); return false; }
    finally { setPlaybackDelegated(false); }
  },
  async openVod(
    url: string,
    title: string,
    mediaId: string,
    restart = false,
    subtitle?: { url?: string | undefined; content?: string | undefined } | undefined,
    zap?: { urls: string[]; titles: string[]; ids?: string[] | undefined; index: number; history?: { mediaId: string; name: string; seriesId?: string | undefined; poster?: string | undefined; episodeName?: string | undefined }[] } | undefined
  ): Promise<boolean> {
    if (!isAvailable() || isPlaybackDelegated()) return false;
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { toast.error('Adresse de vidéo invalide.'); return false; }
    setPlaybackDelegated(true);
    try {
      const result = await NativePlayer.openVod({
        url,
        title,
        tvUi: isTvUi(),
        mediaId,
        startPositionMs: restart ? 0 : readVodProgress(mediaId)?.positionMs || 0,
        restart,
        ...(subtitle?.url ? { subtitleUrl: subtitle.url } : {}),
        ...(subtitle?.content ? { subtitleContent: subtitle.content } : {}),
        ...(zap && zap.urls.length > 0 ? {
          channelUrls: zap.urls,
          channelTitles: zap.titles,
          episodeIds: zap.ids,
          channelIndex: zap.index,
        } : {}),
      });
      if (result) {
        const allowed = new Set([mediaId, ...(zap?.ids || [])]);
        const entries = result.progress?.length ? result.progress : [{ ...result, mediaId: result.mediaId || mediaId }];
        for (const entry of entries) {
          if (!allowed.has(entry.mediaId) || !Number.isFinite(entry.positionMs) || !Number.isFinite(entry.durationMs)) continue;
          const metadata = zap?.history?.find(h => h.mediaId === entry.mediaId);
          if (metadata && entry.mediaId !== mediaId) {
            await pushPlayHistory({ channelId: `vod:${entry.mediaId}`, ts: Date.now(), kind: 'vod', name: metadata.name, ...(metadata.seriesId ? { seriesId: metadata.seriesId } : {}), ...(metadata.poster ? { poster: metadata.poster } : {}), ...(metadata.episodeName ? { episodeName: metadata.episodeName } : {}) }).catch(() => {});
          }
          saveVodProgress(entry.mediaId, entry.positionMs, entry.durationMs);
          await updateVodHistoryProgress(entry.mediaId, entry.positionMs, entry.durationMs, entry.completed).catch(() => {});
        }
      }
      if (result?.stats) recordNativeStats(result.stats);
      return true;
    } catch { toast.error('Impossible d’ouvrir cette vidéo sur Android.'); return false; }
    finally { setPlaybackDelegated(false); }
  },
  async open(url: string, title?: string, zap?: NativeZapContext, onReturned?: (url: string) => void, onJump?: (number: string) => void): Promise<boolean> {
    return openPlayer('open', url, title, zap, onReturned, onJump);
  },
  async openExternal(url: string, title?: string): Promise<boolean> {
    return openPlayer('openExternal', url, title);
  },
  async openWeb(url: string, title?: string): Promise<boolean> {
    if (!isAvailable() || isPlaybackDelegated()) return false;
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { toast.error('Adresse de lien invalide.'); return false; }
    try { await NativePlayer.openWeb({ url, title }); return true; }
    catch { toast.error('Impossible d’ouvrir le lien sur Android.'); return false; }
  }
};

/** Pont vers la bibliothèque locale (USB / disque dur / carte SD) côté Android. */
export const LocalLibraryBridge = {
  isAvailable,

  async pickFolder(): Promise<LocalFolder | null> {
    if (!isAvailable()) { toast.error('Bibliothèque locale disponible uniquement sur Android.'); return null; }
    try {
      const result = await NativePlayer.pickFolder();
      return result ?? null;
    } catch { toast.error('Impossible d’ouvrir le sélecteur de dossier.'); return null; }
  },

  async listFolders(): Promise<LocalFolder[]> {
    if (!isAvailable()) return [];
    try {
      const result = await NativePlayer.listFolders();
      return Array.isArray(result.folders) ? result.folders : [];
    } catch { return []; }
  },

  async scanLibrary(uri?: string): Promise<{ files: LocalMedia[]; truncated: boolean } | null> {
    if (!isAvailable()) return null;
    try {
      const result = await NativePlayer.scanLibrary(uri ? { uri } : {});
      return { files: Array.isArray(result.files) ? result.files : [], truncated: !!result.truncated };
    } catch { toast.error('Analyse du dossier impossible.'); return null; }
  },

  async removeFolder(uri: string): Promise<boolean> {
    if (!isAvailable()) return false;
    try { await NativePlayer.removeFolder({ uri }); return true; }
    catch { toast.error('Impossible de retirer ce dossier.'); return false; }
  },

  async playLocal(uri: string, title: string, subtitleUri?: string): Promise<{ positionMs: number; durationMs: number; completed?: boolean } | null> {
    if (!isAvailable() || isPlaybackDelegated()) return null;
    setPlaybackDelegated(true);
    try {
      return await NativePlayer.playLocal({ uri, title, tvUi: isTvUi(), ...(subtitleUri ? { subtitleUri } : {}) });
    } catch { toast.error('Impossible de lire ce fichier.'); return null; }
    finally { setPlaybackDelegated(false); }
  },
};

/** Pont vers les enregistrements DVR (flux en direct capturés par le lecteur natif). */
export const RecordingsBridge = {
  isAvailable,

  async pickFolder(): Promise<{ uri: string; name: string } | null> {
    if (!isAvailable()) { toast.error('Enregistrements disponibles uniquement sur Android.'); return null; }
    try {
      const result = await NativePlayer.pickRecordingsFolder();
      return result ?? null;
    } catch { toast.error('Impossible d’ouvrir le sélecteur de dossier.'); return null; }
  },

  async getFolder(): Promise<{ uri: string; name: string } | null> {
    if (!isAvailable()) return null;
    try {
      const result = await NativePlayer.getRecordingsFolder();
      return result ?? null;
    } catch { return null; }
  },

  async list(): Promise<LocalMedia[]> {
    if (!isAvailable()) return [];
    try {
      const result = await NativePlayer.listRecordings();
      return Array.isArray(result.files) ? result.files : [];
    } catch { return []; }
  },

  async remove(uri: string): Promise<boolean> {
    if (!isAvailable()) return false;
    try { await NativePlayer.deleteRecording({ uri }); return true; }
    catch { toast.error('Suppression impossible.'); return false; }
  },

  /** silent : pas de message d'erreur (programmation automatique des séries). */
  async schedule(url: string, title: string, startTimeMs: number, durationMs: number, options: { silent?: boolean } = {}): Promise<boolean> {
    if (!isAvailable()) { if (!options.silent) toast.error('Programmation disponible uniquement sur Android.'); return false; }
    // Figer la liste au moment de la programmation, avant toute attente ou changement de liste.
    const userAgent = getActiveUserAgent();
    try { await NativePlayer.scheduleRecording({ url, title, startTimeMs, durationMs, userAgent }); return true; }
    catch (e) {
      if (!options.silent) toast.error(e instanceof Error && e.message ? e.message : 'Programmation impossible.');
      return false;
    }
  },

  async listScheduled(): Promise<ScheduledRecording[]> {
    if (!isAvailable()) return [];
    try {
      const result = await NativePlayer.listScheduledRecordings();
      return Array.isArray(result.schedules) ? result.schedules : [];
    } catch { return []; }
  },

  async cancelScheduled(id: string): Promise<boolean> {
    if (!isAvailable()) return false;
    try { await NativePlayer.cancelScheduledRecording({ id }); return true; }
    catch { toast.error('Annulation impossible.'); return false; }
  },
};
