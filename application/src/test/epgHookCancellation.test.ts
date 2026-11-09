import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEPG } from '@/hooks/useEPG';
import type { AppSettings } from '@/utils/storage';

const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('@/utils/epg', () => ({
  fetchEPGSource: async () => ({ xml: '<tv/>', fetchedAt: 1, url: 'https://example.test/guide' }),
  getSecondaryEPGUrls: () => [], fetchSecondaryEPGSources: async () => [],
  getParsedEPGCache: async () => null, saveParsedEPGCache: vi.fn(),
  getEPGUrl: () => null, isEPGCacheFresh: async () => false, peekParsedEPGCache: async () => null,
}));
vi.mock('@/utils/epgConfig', () => ({
  getEpgConfig: async () => ({ channels: {}, extraUrls: [], offsetHours: 0 }),
  epgConfigSignature: () => '', EPG_CONFIG_EVENT: 'epg-config-updated',
}));
vi.mock('@/utils/epgWorker', () => ({ parseEPGInWorker: mocks.parse }));

it('annule le parsing de la liste quittée puis démarre une nouvelle analyse indépendante', async () => {
  mocks.parse.mockImplementation((_xml: unknown, _channels: unknown, _options: unknown, signal: AbortSignal) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Annulé', 'AbortError')), { once: true })));
  const playlist = { id: 'first', name: 'Première', channels: [], groups: [] };
  const { rerender, unmount } = renderHook(({ list }) => useEPG(list, { epgUrl: '' } as AppSettings), { initialProps: { list: playlist } });
  await waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
  const firstSignal = mocks.parse.mock.calls[0][3] as AbortSignal;
  expect(firstSignal.aborted).toBe(false);
  rerender({ list: { ...playlist, id: 'second' } });
  await waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(2));
  expect(firstSignal.aborted).toBe(true);
  const secondSignal = mocks.parse.mock.calls[1][3] as AbortSignal;
  expect(secondSignal.aborted).toBe(false);
  unmount();
  expect(secondSignal.aborted).toBe(true);
});
