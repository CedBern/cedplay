// Worker dédié au parsing XMLTV : les gros guides (plusieurs Mo) sont analysés
// hors du thread principal pour ne jamais geler l'interface.
// Messages reçus : { type: 'parse', xml: string | string[], channels: EpgChannelRef[], options?: EPGBuildOptions }
// Réponses : { type: 'result', data: PackedEPGData } | { type: 'error', message: string }

import { parseXmltv, buildMergedEPGData, type EPGBuildOptions, type EpgChannelRef } from '@/utils/epgXmltv';
import { packEPGData } from '@/utils/epgPacked';

interface ParseMessage { type: 'parse'; xml: string | string[]; channels: EpgChannelRef[]; options?: EPGBuildOptions }

self.onmessage = (ev: MessageEvent<ParseMessage>) => {
  const data = ev.data;
  if (!data || data.type !== 'parse') return;
  try {
    const xmls = Array.isArray(data.xml) ? data.xml : [data.xml];
    const options = data.options ?? {};
    const parsed = buildMergedEPGData(xmls.map(part => parseXmltv(part, options)), data.channels, options);
    const packed = packEPGData(parsed);
    (self as unknown as Worker).postMessage({ type: 'result', data: packed },
      Object.values(packed.channels).map(rows => rows.buffer));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'error', message });
  }
};
