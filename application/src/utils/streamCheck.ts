import { Capacitor, registerPlugin } from '@capacitor/core';
import { getProxyBase } from '@/utils/proxy';
import { getMeta, setMeta } from '@/utils/idb';
import { desktopProbeStreams, isDesktopRuntime } from '@/utils/desktopBridge';

/** Résultat du test d'une adresse de flux. */
export interface ProbeResult { ok: boolean; status: number }

/** Enregistrement persistant de l'état d'une chaîne. */
export interface ChannelHealthRecord {
  channelId: string;
  url: string;
  ok: boolean;
  status: number;
  checkedAt: number;
}

export interface ProbeOptions {
  timeoutMs?: number;
  maxPerHost?: number;
}

interface ProbePlugin { probeStreams(options: { urls: string[] }): Promise<{ results: ProbeResult[] }> }
const NativeProbe = registerPlugin<ProbePlugin>('NativePlayer');

const BATCH = 24;
const WEB_CONCURRENCY = 6;
const WEB_MAX_PER_HOST = 2;
const WEB_TIMEOUT_MS = 6000;

function getHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return 'unknown';
  }
}

async function probeWeb(url: string, timeoutMs = WEB_TIMEOUT_MS): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getProxyBase()}/proxy?url=${encodeURIComponent(url)}`, {
      headers: { Range: 'bytes=0-4095' }, signal: controller.signal, referrerPolicy: 'no-referrer',
    });
    if (!response.ok || !response.body) return { ok: false, status: response.status };
    const reader = response.body.getReader();
    const first = await reader.read();
    void reader.cancel().catch(() => {});
    const bytes = first.value;
    if (!bytes || !bytes.length) return { ok: false, status: response.status };
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 16)).trim();
    return { ok: !head.startsWith('<'), status: response.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    window.clearTimeout(timer);
    controller.abort();
  }
}

async function probeBatchWeb(
  urls: string[],
  timeoutMs = WEB_TIMEOUT_MS,
  maxConcurrency = WEB_CONCURRENCY,
  maxPerHost = WEB_MAX_PER_HOST,
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = new Array(urls.length);
  const activeHosts = new Map<string, number>();
  let activeCount = 0;
  let remaining = urls.length;
  let queuePointer = 0;

  if (urls.length === 0) return [];

  return new Promise<ProbeResult[]>((resolve) => {
    const tryDispatch = () => {
      while (activeCount < maxConcurrency) {
        let nextIdx = -1;
        for (let i = queuePointer; i < urls.length; i++) {
          if (out[i] !== undefined) continue;
          const host = getHost(urls[i]);
          const currentForHost = activeHosts.get(host) ?? 0;
          if (currentForHost < maxPerHost) {
            nextIdx = i;
            break;
          }
        }

        if (nextIdx === -1) break;

        const idx = nextIdx;
        const url = urls[idx];
        const host = getHost(url);

        activeHosts.set(host, (activeHosts.get(host) ?? 0) + 1);
        activeCount++;
        if (idx === queuePointer) queuePointer++;

        probeWeb(url, timeoutMs)
          .then((res) => {
            out[idx] = res;
          })
          .catch(() => {
            out[idx] = { ok: false, status: 0 };
          })
          .finally(() => {
            const currentForHost = activeHosts.get(host) ?? 1;
            if (currentForHost <= 1) activeHosts.delete(host);
            else activeHosts.set(host, currentForHost - 1);
            activeCount--;
            remaining--;
            if (remaining === 0) {
              resolve(out);
            } else {
              tryDispatch();
            }
          });
      }
    };

    tryDispatch();
  });
}

async function probeBatch(urls: string[], options?: ProbeOptions): Promise<ProbeResult[]> {
  if (isDesktopRuntime()) {
    const results = await desktopProbeStreams(urls);
    return urls.map((_, i) => results[i] ?? { ok: false, status: 0 });
  }
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativePlayer')) {
    const { results } = await NativeProbe.probeStreams({ urls });
    return urls.map((_, i) => results[i] ?? { ok: false, status: 0 });
  }
  return probeBatchWeb(urls, options?.timeoutMs ?? WEB_TIMEOUT_MS, WEB_CONCURRENCY, options?.maxPerHost ?? WEB_MAX_PER_HOST);
}

/**
 * Teste une liste d'adresses par lots. `onProgress` reçoit le nombre testé ;
 * `signal` permet d'arrêter entre deux lots.
 */
export async function probeStreams(
  urls: string[],
  onProgress?: (done: number, results: ProbeResult[]) => void,
  signal?: AbortSignal,
  options?: ProbeOptions,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (let i = 0; i < urls.length; i += BATCH) {
    if (signal?.aborted) break;
    const batch = await probeBatch(urls.slice(i, i + BATCH), options).catch(() => urls.slice(i, i + BATCH).map(() => ({ ok: false, status: 0 })));
    results.push(...batch);
    onProgress?.(results.length, results);
  }
  return results;
}

export function describeFailure(result: ProbeResult): string {
  if (result.status === 0) return 'Ne répond pas';
  if (result.status === 401 || result.status === 403) return `Accès refusé (${result.status})`;
  if (result.status === 404 || result.status === 410) return `Introuvable (${result.status})`;
  if (result.status >= 500) return `Erreur du serveur (${result.status})`;
  return result.status >= 200 && result.status < 300 ? 'Réponse vide' : `Erreur ${result.status}`;
}

// ── Santé des chaînes enregistrée (par liste) ──────────────────────

const channelHealthKey = (playlistId: string) => `channelHealth:${playlistId}`;

export async function loadChannelHealth(playlistId: string): Promise<Record<string, ChannelHealthRecord>> {
  try {
    const saved = await getMeta<unknown>(channelHealthKey(playlistId));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const map = saved as Record<string, unknown>;
    const clean: Record<string, ChannelHealthRecord> = {};
    for (const [id, rec] of Object.entries(map)) {
      if (rec && typeof rec === 'object' && 'url' in rec && typeof (rec as ChannelHealthRecord).url === 'string') {
        const r = rec as ChannelHealthRecord;
        clean[id] = {
          channelId: id,
          url: r.url,
          ok: Boolean(r.ok),
          status: typeof r.status === 'number' ? r.status : 0,
          checkedAt: typeof r.checkedAt === 'number' ? r.checkedAt : Date.now(),
        };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export async function saveChannelHealth(playlistId: string, healthMap: Record<string, ChannelHealthRecord>): Promise<void> {
  try {
    await setMeta(channelHealthKey(playlistId), healthMap);
  } catch {
    // IndexedDB indisponible
  }
}

export async function clearChannelHealth(playlistId: string): Promise<void> {
  try {
    await setMeta(channelHealthKey(playlistId), {});
  } catch {
    // IndexedDB indisponible
  }
}

// ── Chaînes masquées (par liste) ──────────────────────────────────

const hiddenChannelsKey = (playlistId: string) => `hiddenChannels:${playlistId}`;

export async function loadHiddenChannels(playlistId: string): Promise<string[]> {
  try {
    const saved = await getMeta<unknown>(hiddenChannelsKey(playlistId));
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export async function saveHiddenChannels(playlistId: string, ids: string[]): Promise<void> {
  await setMeta(hiddenChannelsKey(playlistId), ids);
}
