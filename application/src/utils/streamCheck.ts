import { Capacitor, registerPlugin } from '@capacitor/core';
import { getProxyBase } from '@/utils/proxy';
import { getMeta, setMeta } from '@/utils/idb';

/** Résultat du test d'une adresse de flux. */
export interface ProbeResult { ok: boolean; status: number }

interface ProbePlugin { probeStreams(options: { urls: string[] }): Promise<{ results: ProbeResult[] }> }
const NativeProbe = registerPlugin<ProbePlugin>('NativePlayer');

const BATCH = 24;
const WEB_CONCURRENCY = 6;
const WEB_TIMEOUT_MS = 8000;

async function probeWeb(url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
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

async function probeBatch(urls: string[]): Promise<ProbeResult[]> {
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativePlayer')) {
    const { results } = await NativeProbe.probeStreams({ urls });
    return urls.map((_, i) => results[i] ?? { ok: false, status: 0 });
  }
  const out: ProbeResult[] = new Array(urls.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(WEB_CONCURRENCY, urls.length) }, async () => {
    while (next < urls.length) {
      const i = next++;
      out[i] = await probeWeb(urls[i]);
    }
  }));
  return out;
}

/**
 * Teste une liste d'adresses par lots. `onProgress` reçoit le nombre testé ;
 * `signal` permet d'arrêter entre deux lots.
 */
export async function probeStreams(urls: string[], onProgress?: (done: number, results: ProbeResult[]) => void, signal?: AbortSignal): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (let i = 0; i < urls.length; i += BATCH) {
    if (signal?.aborted) break;
    const batch = await probeBatch(urls.slice(i, i + BATCH)).catch(() => urls.slice(i, i + BATCH).map(() => ({ ok: false, status: 0 })));
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
