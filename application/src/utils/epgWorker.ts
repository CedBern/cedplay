import type { Channel } from '@/types/channel';
import type { EPGData } from '@/types/epg';
import { parseXmltv, buildEPGData } from '@/utils/epgXmltv';

// Worker singleton : ne pas recréer un worker à chaque parse.
let worker: Worker | null = null;
function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/epgWorker.ts', import.meta.url), { type: 'module' });
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

/**
 * Parse l'XMLTV hors du thread principal, avec repli transparent sur le fil
 * principal si le worker est indisponible (WebView ancien, tests) ou bloqué.
 */
export function parseEPGInWorker(xml: string, channels: Channel[]): Promise<EPGData> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const fallback = () => {
      try { resolve(buildEPGData(parseXmltv(xml), channels)); }
      catch (e) { reject(e instanceof Error ? e : new Error('Guide illisible.')); }
    };
    if (!w) { fallback(); return; }
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; data?: EPGData; message?: string };
      if (msg?.type === 'result' && msg.data) {
        clearTimeout(timeout);
        w.removeEventListener('message', onMessage);
        resolve(msg.data);
      } else if (msg?.type === 'error') {
        clearTimeout(timeout);
        w.removeEventListener('message', onMessage);
        fallback();
      }
    };
    const timeout = window.setTimeout(() => {
      // Worker bloqué : repli de dernier recours sur le fil principal.
      w.removeEventListener('message', onMessage);
      fallback();
    }, 60_000);
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'parse', xml, channels });
  });
}
