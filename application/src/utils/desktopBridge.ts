import { Capacitor } from '@capacitor/core';
import type { Channel } from '@/types/channel';
import type {
  LocalFolder,
  LocalMedia,
  NativePlayerOptions,
  NativeStream,
  NativeZapContext,
  PreviewRequest,
  PreviewState,
  ScheduledRecording,
} from '@/utils/nativePlayer';

declare global {
  interface Window {
    __CEDPLAY_DESKTOP__?: boolean;
  }
}

export interface DesktopHttpRequest {
  url: string;
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  responseType?: 'text' | 'json' | 'base64';
  timeoutMs?: number;
  gunzip?: boolean;
}

export interface DesktopHttpResponse<T = unknown> {
  status: number;
  url: string;
  headers: Record<string, string>;
  data: T;
}

export interface DesktopPreviewOverlay {
  url: string;
  title?: string | undefined;
  rect: { x: number; y: number; width: number; height: number };
}

export interface DesktopLiveSession {
  url: string;
  title?: string | undefined;
  zap?: NativeZapContext | undefined;
  onReturned?: ((url: string) => void) | undefined;
  onJump?: ((num: string) => void) | undefined;
  resolve: (ok: boolean) => void;
}

export interface DesktopVodSession {
  url: string;
  title: string;
  mediaId: string;
  localUri?: string | undefined;
  restart?: boolean | undefined;
  startPositionMs: number;
  durationHintSec?: number | undefined;
  subtitle?: { url?: string | undefined; content?: string | undefined } | undefined;
  zap?: {
    urls: string[];
    titles: string[];
    ids?: string[] | undefined;
    episodeStartPositions?: number[] | undefined;
    index: number;
    history?: {
      mediaId: string;
      name: string;
      seriesId?: string | undefined;
      poster?: string | undefined;
      episodeName?: string | undefined;
      season?: number | undefined;
      episode?: number | undefined;
      tmdbId?: number | undefined;
      year?: string | undefined;
    }[];
  } | undefined;
  resolve: (result: {
    mediaId: string;
    positionMs: number;
    durationMs: number;
    completed?: boolean;
    playedMs?: number;
    progress?: { mediaId: string; positionMs: number; durationMs: number; completed?: boolean; playedMs?: number }[];
  } | null) => void;
}

export interface DesktopMosaicSession {
  streams: NativeStream[];
  resolve: (ok: boolean) => void;
}

export interface ActiveDvrRecording {
  id: string;
  title: string;
  url: string;
  uri: string;
  fileName: string;
  startedAt: number;
  durationMs: number;
}

export interface DesktopUiSnapshot {
  preview: DesktopPreviewOverlay | null;
  liveSession: DesktopLiveSession | null;
  vodSession: DesktopVodSession | null;
  mosaicSession: DesktopMosaicSession | null;
  activeRecordings: ActiveDvrRecording[];
}

let testRuntimeOverride: boolean | null = null;

export function setDesktopRuntimeForTests(value: boolean | null): void {
  testRuntimeOverride = value;
}

export function isDesktopRuntime(): boolean {
  if (testRuntimeOverride !== null) return testRuntimeOverride;
  if (typeof window === 'undefined') return false;
  if (window.__CEDPLAY_DESKTOP__ === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('desktop') === '1';
  } catch {
    return false;
  }
}

export function isNativeOrDesktop(): boolean {
  return Capacitor.isNativePlatform() || isDesktopRuntime();
}

export async function desktopHttp<T = unknown>(req: DesktopHttpRequest): Promise<DesktopHttpResponse<T>> {
  const response = await fetch('/api/desktop/http', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`);
  }
  return payload as DesktopHttpResponse<T>;
}

export function desktopProxyUrl(targetUrl: string, ua?: string, ref?: string): string {
  if (!/^https?:\/\//i.test(targetUrl)) return targetUrl;
  const params = new URLSearchParams({ url: targetUrl });
  if (ua?.trim()) params.set('ua', ua.trim());
  if (ref?.trim()) params.set('ref', ref.trim());
  return `/api/desktop/proxy?${params.toString()}`;
}

export function desktopTransmuxUrl(
  source: string,
  options: { startSec?: number; videoCodec?: 'copy' | 'h264'; live?: boolean; ua?: string; audioTrack?: number } = {},
): string {
  const params = new URLSearchParams({ url: source });
  if (options.startSec && options.startSec > 0) params.set('start', String(Math.floor(options.startSec)));
  if (options.videoCodec === 'h264') params.set('video', 'h264');
  if (options.live) params.set('live', '1');
  if (options.ua?.trim()) params.set('ua', options.ua.trim());
  if (Number.isInteger(options.audioTrack) && options.audioTrack! >= 0) params.set('audioTrack', String(options.audioTrack));
  return `/api/desktop/transmux?${params.toString()}`;
}

export function desktopLocalFileUrl(uri: string): string {
  return `/api/desktop/local/file?uri=${encodeURIComponent(uri)}`;
}

export function desktopSubtitleVttUrl(uriOrUrl: string): string {
  return `/api/desktop/subtitle?uri=${encodeURIComponent(uriOrUrl)}`;
}

export function needsFfmpegTransmux(urlOrName: string): boolean {
  const clean = urlOrName.split('?')[0].split('#')[0].toLowerCase();
  return /\.(mkv|avi|wmv|flv|divx|m2ts|ts|mpg|mpeg|vob)$/i.test(clean);
}

export async function probeMediaDurationAndCodecs(source: string): Promise<{
  durationSec: number;
  videoCodec: string;
  audioCodec: string;
  audioTracks: { id: number; label: string }[];
  subtitleTracks: { id: number; label: string }[];
}> {
  try {
    const res = await fetch(`/api/desktop/probe-media?url=${encodeURIComponent(source)}`);
    if (!res.ok) return { durationSec: 0, videoCodec: '', audioCodec: '', audioTracks: [], subtitleTracks: [] };
    const data = await res.json();
    return {
      durationSec: Number(data.durationSec) || 0,
      videoCodec: String(data.videoCodec || ''),
      audioCodec: String(data.audioCodec || ''),
      audioTracks: Array.isArray(data.audioTracks)
        ? data.audioTracks.filter((track: { id?: unknown; label?: unknown }) => Number.isInteger(track?.id) && Number(track.id) >= 0 && typeof track.label === 'string')
        : [],
      subtitleTracks: Array.isArray(data.subtitleTracks)
        ? data.subtitleTracks.filter((track: { id?: unknown; label?: unknown }) => Number.isInteger(track?.id) && Number(track.id) >= 0 && typeof track.label === 'string')
        : [],
    };
  } catch {
    return { durationSec: 0, videoCodec: '', audioCodec: '', audioTracks: [], subtitleTracks: [] };
  }
}

export async function desktopApiPost<T = unknown>(endpoint: string, body: unknown = {}): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Erreur serveur (${res.status})`);
  }
  return data as T;
}

export async function desktopApiGet<T = unknown>(endpoint: string): Promise<T> {
  const res = await fetch(endpoint);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Erreur serveur (${res.status})`);
  }
  return data as T;
}

// ── Bus réactif UI Desktop (remplace les activités Android en fenêtre native) ──

let uiSnapshot: DesktopUiSnapshot = {
  preview: null,
  liveSession: null,
  vodSession: null,
  mosaicSession: null,
  activeRecordings: [],
};

const uiListeners = new Set<(snapshot: DesktopUiSnapshot) => void>();
const previewStateListeners = new Set<(state: PreviewState) => void>();

function notifyUi(): void {
  const snap = { ...uiSnapshot };
  for (const listener of uiListeners) listener(snap);
}

export function getDesktopUiSnapshot(): DesktopUiSnapshot {
  return uiSnapshot;
}

export function subscribeDesktopUi(listener: (snapshot: DesktopUiSnapshot) => void): () => void {
  uiListeners.add(listener);
  listener(uiSnapshot);
  ensureEventSource();
  if (isDesktopRuntime()) void refreshDesktopActiveRecordings();
  return () => { uiListeners.delete(listener); };
}

export function emitDesktopPreviewState(state: PreviewState): void {
  for (const listener of previewStateListeners) listener(state);
}

export function onDesktopPreviewState(listener: (state: PreviewState) => void): () => void {
  previewStateListeners.add(listener);
  return () => { previewStateListeners.delete(listener); };
}

export function showDesktopPreview(req: PreviewRequest): boolean {
  uiSnapshot = {
    ...uiSnapshot,
    preview: {
      url: req.url,
      title: req.title,
      rect: { x: req.x, y: req.y, width: req.width, height: req.height },
    },
  };
  notifyUi();
  return true;
}

export function stopDesktopPreview(): void {
  if (!uiSnapshot.preview) return;
  uiSnapshot = { ...uiSnapshot, preview: null };
  notifyUi();
}

export function openDesktopLiveSession(
  url: string,
  title?: string,
  zap?: NativeZapContext,
  onReturned?: (returnedUrl: string) => void,
  onJump?: (num: string) => void,
): Promise<boolean> {
  if (uiSnapshot.liveSession) {
    uiSnapshot.liveSession.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    uiSnapshot = {
      ...uiSnapshot,
      preview: null,
      liveSession: { url, title, zap, onReturned, onJump, resolve },
    };
    notifyUi();
  });
}

export function closeDesktopLiveSession(lastChannelUrl?: string, jumpNumber?: string): void {
  const active = uiSnapshot.liveSession;
  if (!active) return;
  uiSnapshot = { ...uiSnapshot, liveSession: null };
  notifyUi();
  if (lastChannelUrl && active.onReturned) active.onReturned(lastChannelUrl);
  if (jumpNumber && active.onJump) window.setTimeout(() => active.onJump?.(jumpNumber), 0);
  active.resolve(true);
}

export function openDesktopVodSession(params: Omit<DesktopVodSession, 'resolve'>): DesktopVodSession['resolve'] extends (v: infer R) => void ? Promise<R> : never {
  if (uiSnapshot.vodSession) {
    uiSnapshot.vodSession.resolve(null);
  }
  return new Promise((resolve) => {
    uiSnapshot = {
      ...uiSnapshot,
      preview: null,
      vodSession: { ...params, resolve },
    };
    notifyUi();
  }) as ReturnType<typeof openDesktopVodSession>;
}

export function closeDesktopVodSession(result: Parameters<DesktopVodSession['resolve']>[0] = null): void {
  const active = uiSnapshot.vodSession;
  if (!active) return;
  uiSnapshot = { ...uiSnapshot, vodSession: null };
  notifyUi();
  active.resolve(result);
}

export function openDesktopMosaicSession(streams: NativeStream[]): Promise<boolean> {
  if (uiSnapshot.mosaicSession) {
    uiSnapshot.mosaicSession.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    uiSnapshot = {
      ...uiSnapshot,
      preview: null,
      mosaicSession: { streams, resolve },
    };
    notifyUi();
  });
}

export function closeDesktopMosaicSession(): void {
  const active = uiSnapshot.mosaicSession;
  if (!active) return;
  uiSnapshot = { ...uiSnapshot, mosaicSession: null };
  notifyUi();
  active.resolve(true);
}

// ── SSE Desktop Events (Pairing, LAN Sync, DVR) ───────────────────────────────

type DesktopEventListener = (data: unknown) => void;
const sseListeners = new Map<string, Set<DesktopEventListener>>();
let eventSource: EventSource | null = null;

function ensureEventSource(): void {
  if (eventSource || typeof EventSource === 'undefined' || !isDesktopRuntime()) return;
  try {
    eventSource = new EventSource('/api/desktop/events');
    for (const eventName of ['pairingCredentials', 'lanSyncRequest', 'recordingStarted', 'recordingStopped', 'reminderTriggered']) {
      eventSource.addEventListener(eventName, (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent).data);
          if (eventName === 'recordingStarted' || eventName === 'recordingStopped') {
            void refreshDesktopActiveRecordings();
          }
          const listeners = sseListeners.get(eventName);
          if (listeners) for (const fn of listeners) fn(parsed);
        } catch {
          /* ignore malformed event */
        }
      });
    }
  } catch {
    eventSource = null;
  }
}

export function onDesktopServerEvent<T = unknown>(eventName: string, listener: (data: T) => void): () => void {
  ensureEventSource();
  let set = sseListeners.get(eventName);
  if (!set) {
    set = new Set();
    sseListeners.set(eventName, set);
  }
  const wrapped = listener as DesktopEventListener;
  set.add(wrapped);
  return () => {
    set?.delete(wrapped);
  };
}

// ── Bridges concrètes Desktop (Local, DVR, Pairing, LAN Sync, Probe, Options) ─

export async function refreshDesktopActiveRecordings(): Promise<ActiveDvrRecording[]> {
  if (!isDesktopRuntime()) return [];
  try {
    const res = await desktopApiGet<{ recordings: ActiveDvrRecording[] }>('/api/desktop/recordings/active');
    const recordings = Array.isArray(res.recordings) ? res.recordings : [];
    uiSnapshot = { ...uiSnapshot, activeRecordings: recordings };
    notifyUi();
    return recordings;
  } catch {
    return [];
  }
}

export async function startDesktopRecording(url: string, title: string, userAgent?: string): Promise<ActiveDvrRecording | null> {
  try {
    const res = await desktopApiPost<{ recording: ActiveDvrRecording }>('/api/desktop/recordings/start', { url, title, userAgent });
    await refreshDesktopActiveRecordings();
    return res.recording;
  } catch {
    return null;
  }
}

export async function stopDesktopRecording(id: string): Promise<boolean> {
  try {
    await desktopApiPost('/api/desktop/recordings/stop', { id });
    await refreshDesktopActiveRecordings();
    return true;
  } catch {
    return false;
  }
}

export const DesktopLocalBridge = {
  pickFolder: () => desktopApiPost<{ folder: LocalFolder | null }>('/api/desktop/local/pick', {}).then((r) => r.folder),
  listFolders: () => desktopApiGet<{ folders: LocalFolder[] }>('/api/desktop/local/folders').then((r) => r.folders),
  scanLibrary: (uri?: string) => desktopApiPost<{ files: LocalMedia[]; truncated: boolean }>('/api/desktop/local/scan', uri ? { uri } : {}),
  removeFolder: (uri: string) => desktopApiPost<{ ok: boolean }>('/api/desktop/local/remove', { uri }).then((r) => r.ok),
};

export const DesktopRecordingsBridge = {
  pickFolder: () => desktopApiPost<{ folder: { uri: string; name: string } | null }>('/api/desktop/recordings/pick-folder', {}).then((r) => r.folder),
  getFolder: () => desktopApiGet<{ folder: { uri: string; name: string } | null }>('/api/desktop/recordings/folder').then((r) => r.folder),
  list: () => desktopApiGet<{ files: LocalMedia[] }>('/api/desktop/recordings/list').then((r) => r.files),
  remove: (uri: string) => desktopApiPost<{ ok: boolean }>('/api/desktop/recordings/delete', { uri }).then((r) => r.ok),
  schedule: (params: { url: string; title: string; startTimeMs: number; durationMs: number; userAgent?: string }) =>
    desktopApiPost<{ schedule: ScheduledRecording }>('/api/desktop/recordings/schedule', params).then(() => true),
  listScheduled: () => desktopApiGet<{ schedules: ScheduledRecording[] }>('/api/desktop/recordings/schedules').then((r) => r.schedules),
  cancelScheduled: (id: string) => desktopApiPost<{ ok: boolean }>('/api/desktop/recordings/cancel', { id }).then((r) => r.ok),
};

export async function desktopProbeStreams(urls: string[]): Promise<{ ok: boolean; status: number }[]> {
  const res = await desktopApiPost<{ results: { ok: boolean; status: number }[] }>('/api/desktop/probe-streams', { urls });
  return Array.isArray(res.results) ? res.results : [];
}

export async function desktopSetPlayerOptions(options: NativePlayerOptions): Promise<void> {
  await desktopApiPost('/api/desktop/player-options', options).catch(() => {});
}

export interface DesktopReminderItem {
  id: string;
  channelId: string;
  channelName: string;
  title: string;
  startTime: number;
}

export async function syncDesktopReminders(reminders: DesktopReminderItem[]): Promise<void> {
  if (!isDesktopRuntime()) return;
  await desktopApiPost('/api/desktop/reminders/sync', { reminders }).catch(() => {});
}

export async function desktopOpenExternal(url: string): Promise<boolean> {
  try {
    await desktopApiPost('/api/desktop/open-external', { url });
    return true;
  } catch {
    return false;
  }
}

export function toggleDesktopFullscreen(): void {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    void document.exitFullscreen?.().catch(() => {});
  }
}

export function findChannelNameForRecordings(channels: Channel[], url: string): string {
  return channels.find((c) => c.url === url)?.name || 'Direct';
}

const STALKER_MARKER = '#cedplay-stalker=';

export async function resolveDesktopPlayableUrl(rawUrl: string): Promise<string> {
  const idx = rawUrl.indexOf(STALKER_MARKER);
  if (idx < 0) return rawUrl;
  const encoded = rawUrl.slice(idx + STALKER_MARKER.length);
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4);
    const jsonText = new TextDecoder().decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0)));
    const payload = JSON.parse(jsonText) as { p?: string; m?: string; c?: string };
    if (!payload.p || !payload.m || !payload.c) return rawUrl;
    const res = await desktopApiPost<{ url: string }>('/api/desktop/stalker-resolve', {
      portalUrl: payload.p,
      mac: payload.m,
      cmd: payload.c,
    });
    return res.url || rawUrl;
  } catch {
    return rawUrl;
  }
}
