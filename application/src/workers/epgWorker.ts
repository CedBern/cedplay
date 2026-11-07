// Worker dédié au parsing XMLTV : les gros guides (plusieurs Mo) sont analysés
// hors du thread principal pour ne jamais geler l'interface.
// Messages reçus : { type: 'parse', xml: string | string[], channels: Channel[], options?: EPGBuildOptions }
// Réponses : { type: 'result', data: EPGData } | { type: 'error', message: string }

import { parseXmltv, buildMergedEPGData, type EPGBuildOptions } from '@/utils/epgXmltv';
import type { Channel } from '@/types/channel';

interface ParseMessage { type: 'parse'; xml: string | string[]; channels: Channel[]; options?: EPGBuildOptions }

self.onmessage = (ev: MessageEvent<ParseMessage>) => {
  const data = ev.data;
  if (!data || data.type !== 'parse') return;
  try {
    const xmls = Array.isArray(data.xml) ? data.xml : [data.xml];
    const parsed = buildMergedEPGData(xmls.map(parseXmltv), data.channels, data.options ?? {});
    (self as unknown as Worker).postMessage({ type: 'result', data: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'error', message });
  }
};
