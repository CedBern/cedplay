import type { Channel } from '@/types/channel';
import type { EPGData } from '@/types/epg';
import { parseXmltv, buildMergedEPGData, type EPGBuildOptions, type EpgChannelRef } from '@/utils/epgXmltv';
import { unpackEPGData } from '@/utils/epgPacked';

/**
 * Parse l'XMLTV hors du thread principal, avec repli transparent sur le fil
 * principal si le worker est indisponible (WebView ancien, tests) ou bloqué.
 * Plusieurs guides sont fusionnés dans l'ordre donné (le premier l'emporte).
 */
export function parseEPGInWorker(xml: string | string[], channels: Channel[], options: EPGBuildOptions = {}, signal?: AbortSignal): Promise<EPGData> {
  const aborted = () => new DOMException('Analyse du guide annulée.', 'AbortError');
  if (signal?.aborted) return Promise.reject(aborted());
  const xmls = Array.isArray(xml) ? xml : [xml];
  const refs: EpgChannelRef[] = channels.map(({ id, name, tvgId, tvgName, tvgShift }) => ({
    id, name,
    ...(tvgId === undefined ? {} : { tvgId }),
    ...(tvgName === undefined ? {} : { tvgName }),
    ...(tvgShift === undefined ? {} : { tvgShift }),
  }));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    const fallback = () => {
      if (signal?.aborted) { reject(aborted()); return; }
      try { resolve(buildMergedEPGData(xmls.map(parseXmltv), refs, options)); }
      catch (e) { reject(e instanceof Error ? e : new Error('Guide illisible.')); }
    };
    try {
      worker = new Worker(new URL('../workers/epgWorker.ts', import.meta.url), { type: 'module' });
    } catch { fallback(); return; }
    // Un worker par analyse : le XML et les objets intermédiaires sont libérés
    // dès le résultat, y compris si deux listes lancent des analyses simultanées.
    let settled = false;
    const cleanup = () => {
      settled = true;
      window.clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      if (settled) return;
      cleanup();
      reject(aborted());
    };
    const fail = () => {
      if (settled) return;
      cleanup();
      fallback();
    };
    const timeout = window.setTimeout(fail, 60_000);
    worker.onmessage = (ev: MessageEvent) => {
      if (settled) return;
      const msg = ev.data as { type?: string; data?: unknown } | null;
      if (msg?.type === 'result') {
        // Libérer le worker avant de reconstruire le guide évite de garder
        // ses dates et son XML pendant la reconstruction sur la page.
        cleanup();
        try { resolve(unpackEPGData(msg.data)); } catch { fallback(); }
      } else if (msg?.type === 'error') fail();
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    signal?.addEventListener('abort', onAbort, { once: true });
    try { worker.postMessage({ type: 'parse', xml: xmls, channels: refs, options }); }
    catch { fail(); }
  });
}
