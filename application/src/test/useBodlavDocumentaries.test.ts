import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useBodlavDocumentaries } from '@/hooks/useBodlavDocumentaries';
import * as bodlav from '@/utils/bodlav';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('ne charge pas désactivé, invalide au filtre/verrou et ignore une réponse tardive', async () => {
  const requests: { signal: AbortSignal; resolve: (items: bodlav.BodlavDocumentary[]) => void }[] = [];
  vi.spyOn(bodlav, 'loadBodlavDocumentaries').mockImplementation(signal => new Promise(resolve => { requests.push({ signal, resolve }); }));
  const view = renderHook(({ enabled, context }) => useBodlavDocumentaries(enabled, context), { initialProps: { enabled: false, context: 'all:locked' } });
  expect(requests).toHaveLength(0);
  view.rerender({ enabled: true, context: 'all:unlocked' });
  expect(requests).toHaveLength(1);
  view.rerender({ enabled: true, context: 'movies:unlocked' });
  expect(requests[0]!.signal.aborted).toBe(true);
  await act(async () => requests[0]!.resolve([{ id: 'old', title: 'Ancien', url: 'https://bodlav.com/old/b/bodlav/1' }]));
  expect(view.result.current).toEqual([]);
  await act(async () => requests[1]!.resolve([{ id: '2', title: 'Courant', url: 'https://bodlav.com/new/b/bodlav/2' }]));
  await waitFor(() => expect(view.result.current[0]?.title).toBe('Courant'));
  view.rerender({ enabled: false, context: 'movies:locked' });
  expect(view.result.current).toEqual([]); expect(requests[1]!.signal.aborted).toBe(true);
  view.rerender({ enabled: true, context: 'all:unlocked' }); view.unmount();
  expect(requests[2]!.signal.aborted).toBe(true);
});
