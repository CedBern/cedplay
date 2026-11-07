import { M3UParser } from '@/utils/m3uParser';
import type { PlaylistInfo } from '@/types/channel';

/** Parse dans un Web Worker pour ne jamais bloquer l'interface sur les très grandes listes.
 *  Repli transparent sur le fil principal si le worker est indisponible (WebView ancien, tests). */
export function parseM3UInWorker(content: string, playlistName: string, onProgress: (percent: number) => void): Promise<PlaylistInfo> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../workers/m3uParserWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    if (!worker) {
      void M3UParser.parseM3UWithProgress(content, playlistName, (p) => onProgress(p)).then(resolve, reject);
      return;
    }
    const timeout = window.setTimeout(() => {
      worker?.terminate();
      reject(new Error('L’analyse de la liste prend trop de temps.'));
    }, 180000);
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; percent?: number; playlist?: PlaylistInfo; message?: string };
      if (msg?.type === 'progress' && typeof msg.percent === 'number') onProgress(msg.percent);
      else if (msg?.type === 'result') { clearTimeout(timeout); worker?.terminate(); resolve(msg.playlist as PlaylistInfo); }
      else if (msg?.type === 'error') { clearTimeout(timeout); worker?.terminate(); reject(new Error(msg.message || 'Analyse impossible.')); }
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker?.terminate();
      // Dernier recours : analyse sur le fil principal
      void M3UParser.parseM3UWithProgress(content, playlistName, (p) => onProgress(p)).then(resolve, reject);
    };
    worker.postMessage({ type: 'parse', content, playlistName });
  });
}
