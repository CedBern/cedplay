// Worker dédié au parsing XMLTV : les gros guides (plusieurs Mo) sont analysés
// hors du thread principal pour ne jamais geler l'interface.
// Messages reçus : { type: 'parse', xml: string, channels: Channel[] }
// Réponses : { type: 'result', data: EPGData } | { type: 'error', message: string }

import { parseXmltv, buildEPGData } from '@/utils/epgXmltv';
import type { Channel } from '@/types/channel';

interface ParseMessage { type: 'parse'; xml: string; channels: Channel[]; }

self.onmessage = (ev: MessageEvent<ParseMessage>) => {
  const data = ev.data;
  if (!data || data.type !== 'parse') return;
  try {
    const parsed = buildEPGData(parseXmltv(data.xml), data.channels);
    (self as unknown as Worker).postMessage({ type: 'result', data: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'error', message });
  }
};
