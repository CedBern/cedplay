import { afterEach, expect, it, vi } from 'vitest';
import { unpackEPGData } from '@/utils/epgPacked';
import { buildMergedEPGData, parseXmltv } from '@/utils/epgXmltv';

afterEach(() => vi.unstubAllGlobals());

it('le worker réel émet le format compact et transfère ses buffers sans perdre le guide', async () => {
  const surface = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn() };
  vi.stubGlobal('self', surface);
  await import('@/workers/epgWorker');
  const xml = '<tv><programme channel="a" start="20261108110000 +0000" stop="20261108120000 +0000"><title>Titre partagé</title><desc>Résumé partagé</desc></programme></tv>';
  const channels = [{ id: 'a1', name: 'A1', tvgId: 'a' }, { id: 'a2', name: 'A2', tvgId: 'a' }];
  surface.onmessage?.({ data: { type: 'parse', xml: [xml], channels, options: {} } } as MessageEvent);
  expect(surface.postMessage).toHaveBeenCalledOnce();
  const [message, buffers] = surface.postMessage.mock.calls[0];
  expect(message.type).toBe('result');
  expect(message.data.strings).toEqual(['Titre partagé', 'Résumé partagé']);
  expect(buffers).toEqual(Object.values(message.data.channels).map(rows => (rows as Float64Array).buffer));
  expect(unpackEPGData(message.data)).toEqual(buildMergedEPGData([parseXmltv(xml)], channels));
});
