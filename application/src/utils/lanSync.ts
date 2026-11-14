import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { getMeta, setMeta } from '@/utils/idb';
import { desktopApiPost, desktopHttp, isDesktopRuntime, onDesktopServerEvent } from '@/utils/desktopBridge';
import {
  applyMergedSyncPayload,
  buildLocalCatalogRemapIndex,
  buildLocalSyncPayload,
  mergeSyncPayloads,
  parseSyncPayload,
  remapSyncPayloadToLocal,
  type SyncPayload,
} from '@/utils/syncPayload';

interface LanSyncPlugin {
  startLanSync(options: { token: string; port?: number }): Promise<{ url: string }>;
  stopLanSync(options: { url?: string }): Promise<void>;
  acknowledgeLanSync(options: { requestId: string; ok: boolean; mergedJson?: string }): Promise<void>;
  addListener(
    event: 'lanSyncRequest',
    listener: (data: { requestId: string; payload: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<LanSyncPlugin>('NativePlayer');

const LAN_TOKEN_KEY = 'sync_lan_token';
const LAN_PEERS_KEY = 'sync_lan_peers';
const LAN_HOST_ENABLED_KEY = 'sync_lan_host_enabled';
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LAN_SYNC_TIMEOUT_MS = 8000;

let localMergeQueue: Promise<unknown> = Promise.resolve();
let clientExchangeQueue: Promise<unknown> = Promise.resolve();

function runQueued<T>(queueRef: 'local' | 'client', task: () => Promise<T>): Promise<T> {
  const prev = queueRef === 'local' ? localMergeQueue : clientExchangeQueue;
  const next = prev.catch(() => undefined).then(task);
  if (queueRef === 'local') localMergeQueue = next;
  else clientExchangeQueue = next;
  return next;
}

let activeHostUrl: string | null = null;

function setActiveHostUrl(url: string | null): void {
  if (activeHostUrl === url) return;
  activeHostUrl = url;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lan-sync-host-url'));
}

export function getCurrentLanHostUrl(): string | null {
  return activeHostUrl;
}

export interface SyncedPeer {
  url: string;
  label?: string;
  deviceId?: string;
  lastSyncedAt?: number;
}

export interface LanSyncSummary {
  url: string;
  changed: boolean;
  vodHistoryCount: number;
  vodProgressCount: number;
  watchlistCount: number;
}

export function lanSyncAvailable(): boolean {
  return isDesktopRuntime() || (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativePlayer'));
}

export function normalizeSyncUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (/^cedplay:\/\/sync\?/i.test(trimmed)) {
    try {
      const deep = new URL(trimmed);
      const inner = deep.searchParams.get('url');
      if (!inner) return null;
      candidate = inner.trim();
    } catch {
      return null;
    }
  }
  if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) return null;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!/^\/sync\/[a-z0-9]{8,32}$/.test(parsed.pathname)) return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export async function getOrCreateLanSyncToken(): Promise<string> {
  const existing = await getMeta<string>(LAN_TOKEN_KEY);
  if (typeof existing === 'string' && /^[a-z0-9]{8,32}$/.test(existing)) return existing;
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let token = '';
  for (const b of bytes) token += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  await setMeta(LAN_TOKEN_KEY, token);
  return token;
}

export async function getLanHostEnabled(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    return (await getMeta<boolean>(LAN_HOST_ENABLED_KEY)) === true;
  } catch {
    return false;
  }
}

export async function setLanHostEnabled(enabled: boolean): Promise<void> {
  await setMeta(LAN_HOST_ENABLED_KEY, enabled);
}

export async function getSyncedPeers(): Promise<SyncedPeer[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const raw = await getMeta<SyncedPeer[]>(LAN_PEERS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(p => p && typeof p.url === 'string' && normalizeSyncUrl(p.url) !== null);
  } catch {
    return [];
  }
}

export async function upsertSyncedPeer(peer: SyncedPeer): Promise<SyncedPeer[]> {
  const url = normalizeSyncUrl(peer.url);
  if (!url) throw new Error('Adresse de synchronisation invalide.');
  const peers = await getSyncedPeers();
  const next = peers.filter(p => p.url !== url);
  next.unshift({ ...peer, url });
  const capped = next.slice(0, 10);
  await setMeta(LAN_PEERS_KEY, capped);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lan-sync-peers-updated'));
  return capped;
}

export async function removeSyncedPeer(url: string): Promise<SyncedPeer[]> {
  const normalized = normalizeSyncUrl(url) ?? url;
  const peers = (await getSyncedPeers()).filter(p => p.url !== normalized);
  await setMeta(LAN_PEERS_KEY, peers);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lan-sync-peers-updated'));
  return peers;
}

export function openLanSyncHost(options: {
  onUrl?: (url: string) => void;
  onSynced?: (summary: LanSyncSummary) => void;
  onError?: (message: string) => void;
}): () => void {
  if (!lanSyncAvailable()) return () => {};
  let closed = false;
  let handle: PluginListenerHandle | null = null;
  let unsubDesktop: (() => void) | null = null;
  let startedUrl: string | null = null;

  const stop = () => {
    if (startedUrl) {
      if (activeHostUrl === startedUrl) setActiveHostUrl(null);
      if (isDesktopRuntime()) {
        void desktopApiPost('/api/desktop/lan-sync/stop', { url: startedUrl }).catch(() => {});
      } else {
        void plugin.stopLanSync({ url: startedUrl }).catch(() => {});
      }
      startedUrl = null;
    }
  };

  void (async () => {
    try {
      const token = await getOrCreateLanSyncToken();
      if (closed) return;

      const handleSyncRequest = async (data: { requestId: string; payload: string }) => {
        if (closed) return;
        try {
          const { merged, applied } = await runQueued('local', async () => {
            const remote = parseSyncPayload(data.payload);
            const local = await buildLocalSyncPayload();
            const remapIndex = await buildLocalCatalogRemapIndex({
              vodHistory: local.vodHistory,
              watchlist: local.watchlist,
            });
            const translatedRemote = remapSyncPayloadToLocal(remote, remapIndex);
            const nextMerged = mergeSyncPayloads(local, translatedRemote);
            const nextApplied = await applyMergedSyncPayload(nextMerged);
            return { merged: nextMerged, applied: nextApplied };
          });
          if (isDesktopRuntime()) {
            await desktopApiPost('/api/desktop/lan-sync/ack', {
              requestId: data.requestId,
              ok: true,
              mergedJson: JSON.stringify(merged),
            });
          } else {
            await plugin.acknowledgeLanSync({
              requestId: data.requestId,
              ok: true,
              mergedJson: JSON.stringify(merged),
            });
          }
          options.onSynced?.({
            url: startedUrl ?? '',
            ...applied,
          });
        } catch {
          if (isDesktopRuntime()) {
            await desktopApiPost('/api/desktop/lan-sync/ack', { requestId: data.requestId, ok: false }).catch(() => {});
          } else {
            await plugin.acknowledgeLanSync({ requestId: data.requestId, ok: false }).catch(() => {});
          }
        }
      };

      if (isDesktopRuntime()) {
        unsubDesktop = onDesktopServerEvent<{ requestId: string; payload: string }>('lanSyncRequest', (data) => {
          void handleSyncRequest(data);
        });
        if (closed) { unsubDesktop(); return; }
        const { url } = await desktopApiPost<{ url: string }>('/api/desktop/lan-sync/start', { token });
        startedUrl = url;
        if (closed) { stop(); return; }
        setActiveHostUrl(url);
        options.onUrl?.(url);
        return;
      }

      const listener = await plugin.addListener('lanSyncRequest', handleSyncRequest);
      if (closed) {
        void listener.remove();
        return;
      }
      handle = listener;
      const { url } = await plugin.startLanSync({ token });
      startedUrl = url;
      if (closed) {
        stop();
        return;
      }
      setActiveHostUrl(url);
      options.onUrl?.(url);
    } catch (err) {
      options.onError?.(err instanceof Error ? err.message : 'Synchronisation locale indisponible');
    }
  })();

  return () => {
    closed = true;
    unsubDesktop?.();
    void handle?.remove();
    stop();
  };
}

async function postSyncJson(url: string, payload: SyncPayload): Promise<SyncPayload> {
  if (isDesktopRuntime()) {
    const response = await desktopHttp<unknown>({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      responseType: 'json',
      timeoutMs: LAN_SYNC_TIMEOUT_MS,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Synchronisation refusée (HTTP ${response.status}).`);
    }
    return parseSyncPayload(response.data);
  }
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { 'Content-Type': 'application/json' },
      data: payload,
      connectTimeout: LAN_SYNC_TIMEOUT_MS,
      readTimeout: LAN_SYNC_TIMEOUT_MS,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Synchronisation refusée (HTTP ${response.status}).`);
    }
    return parseSyncPayload(response.data);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAN_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Synchronisation refusée (HTTP ${response.status}).`);
    }
    return parseSyncPayload(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export async function syncWithPeer(rawUrl: string, label?: string): Promise<LanSyncSummary> {
  const url = normalizeSyncUrl(rawUrl);
  if (!url) throw new Error('Adresse de synchronisation invalide.');
  return runQueued('client', async () => {
    const localSnapshot = await runQueued('local', () => buildLocalSyncPayload());
    const remoteMerged = await postSyncJson(url, localSnapshot);
    const applied = await runQueued('local', async () => {
      const latestLocal = await buildLocalSyncPayload();
      const remapIndex = await buildLocalCatalogRemapIndex({
        vodHistory: latestLocal.vodHistory,
        watchlist: latestLocal.watchlist,
      });
      const translatedRemote = remapSyncPayloadToLocal(remoteMerged, remapIndex);
      const finalMerged = mergeSyncPayloads(latestLocal, translatedRemote);
      return applyMergedSyncPayload(finalMerged);
    });
    await upsertSyncedPeer({
      url,
      ...(label ? { label } : {}),
      lastSyncedAt: Date.now(),
    });
    return {
      url,
      ...applied,
    };
  });
}

let inFlightSyncAll: Promise<{ succeeded: number; failed: number }> | null = null;

export async function syncAllPairedPeers(): Promise<{ succeeded: number; failed: number }> {
  if (inFlightSyncAll) return inFlightSyncAll;
  inFlightSyncAll = (async () => {
    const peers = await getSyncedPeers();
    let succeeded = 0;
    let failed = 0;
    for (const peer of peers) {
      try {
        await syncWithPeer(peer.url, peer.label);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    return { succeeded, failed };
  })().finally(() => {
    inFlightSyncAll = null;
  });
  return inFlightSyncAll;
}
