import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useOfficialDocumentaries } from '@/hooks/useOfficialDocumentaries';
import * as official from '@/utils/officialDocumentaries';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('invalide le contexte et la source, annule au verrou et ignore les réponses tardives', async () => {
  const requests: { signal: AbortSignal; resolve: (items: official.OfficialDocumentary[]) => void }[] = [];
  vi.spyOn(official, 'loadOfficialDocumentaries').mockImplementation((_source, signal) => new Promise(resolve => { requests.push({ signal, resolve }); }));
  const view = renderHook(({ source, enabled, context }) => useOfficialDocumentaries(source, enabled, context), { initialProps: { source: 'tv5mondeplus' as official.OfficialDocumentarySource, enabled: false, context: 'a' } });
  expect(requests).toHaveLength(0); view.rerender({ source: 'tv5mondeplus', enabled: true, context: 'a' });
  view.rerender({ source: 'imagotv', enabled: true, context: 'b' }); expect(requests[0]!.signal.aborted).toBe(true);
  const item = { id: '/documentaires/film', title: 'Film', url: 'https://www.imagotv.fr/documentaires/film' };
  await act(async () => requests[0]!.resolve([item])); expect(view.result.current).toEqual([]);
  await act(async () => requests[1]!.resolve([item])); expect(view.result.current).toEqual([item]);
  view.rerender({ source: 'imagotv', enabled: false, context: 'b' }); expect(view.result.current).toEqual([]); expect(requests[1]!.signal.aborted).toBe(true);
  view.rerender({ source: 'imagotv', enabled: true, context: 'c' }); view.unmount(); expect(requests[2]!.signal.aborted).toBe(true);
});
