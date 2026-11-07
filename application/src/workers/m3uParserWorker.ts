// Dedicated worker for large M3U parsing to keep main thread responsive.
// Receives messages: { type: 'parse', content: string, playlistName: string }
// Emits progress: { type: 'progress', percent, channelsParsed }
// Emits result: { type: 'result', playlist }
// Emits error: { type: 'error', message }

import { M3UParser } from '@/utils/m3uParser';
import type { PlaylistInfo } from '@/types/channel';

interface ParseMessage { type: 'parse'; content: string; playlistName: string; }
interface ProgressMessage { type: 'progress'; percent: number; channelsParsed: number; }
interface ResultMessage { type: 'result'; playlist: PlaylistInfo; }
interface ErrorMessage { type: 'error'; message: string; }

type Incoming = ParseMessage;
self.onmessage = async (ev: MessageEvent<Incoming>) => {
  const data = ev.data;
  if (!data || data.type !== 'parse') return;
  try {
    const playlist = await M3UParser.parseM3UWithProgress(
  data.content,
  data.playlistName,
      (percent, channelsParsed) => {
        const msg: ProgressMessage = { type: 'progress', percent, channelsParsed };
        (self as unknown as Worker).postMessage(msg);
      },
      750 // slightly bigger batch in worker, reduces message spam
    );
  (self as unknown as Worker).postMessage({ type: 'result', playlist } satisfies ResultMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
  (self as unknown as Worker).postMessage({ type: 'error', message } satisfies ErrorMessage);
  }
};
