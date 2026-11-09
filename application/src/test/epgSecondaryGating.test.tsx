import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PlaylistInfo } from '@/types/channel';
import type { EPGProgram } from '@/types/epg';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), secondary: vi.fn() }));
vi.mock('@/utils/epgWorker', () => ({ parseEPGInWorker: mocks.parse }));
vi.mock('@/utils/epg', () => ({
  fetchEPGSource: async () => ({ xml: '<tv>principal</tv>', fetchedAt: 100, stale: false, url: 'https://p/x.xml' }),
  getSecondaryEPGUrls: () => ['https://s/x.xml'],
  fetchSecondaryEPGSources: mocks.secondary,
  getParsedEPGCache: async () => null,
  getEPGUrl: () => null,
  isEPGCacheFresh: async () => false,
  peekParsedEPGCache: async () => null,
  saveParsedEPGCache: async () => {},
}));

import { useEPG } from '@/hooks/useEPG';
import { StorageManager } from '@/utils/storage';

const playlist: PlaylistInfo = {
  id: 'gating', name: 'Test', groups: [],
  channels: [{ id: 'c1', name: 'Chaîne 1', url: 'https://stream.test/1.m3u8' }],
};
const program: EPGProgram = { id: 'c1_1', channelId: 'c1', title: 'Journal', startTime: new Date(0), endTime: new Date(1000) };
const settings = StorageManager.getSettings();

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('ne parse pas les guides complémentaires quand la source principale couvre tout', async () => {
  mocks.parse.mockResolvedValue({ c1: [program] });
  mocks.secondary.mockResolvedValue([{ xml: '<tv>secondaire</tv>', fetchedAt: 101, stale: false, url: 'https://s/x.xml' }]);
  const { result } = renderHook(() => useEPG(playlist, settings));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(mocks.parse).toHaveBeenCalledTimes(1);
  expect(mocks.parse.mock.calls[0][0]).toBe('<tv>principal</tv>');
  expect(result.current.data?.c1).toEqual([program]);
});

it('ne parse que les chaînes restées sans programme dans les sources secondaires', async () => {
  mocks.parse.mockResolvedValueOnce({}).mockResolvedValueOnce({ c1: [program] });
  mocks.secondary.mockResolvedValue([{ xml: '<tv>secondaire</tv>', fetchedAt: 101, stale: false, url: 'https://s/x.xml' }]);
  const { result } = renderHook(() => useEPG(playlist, settings));
  await waitFor(() => expect(result.current.data?.c1).toEqual([program]));
  expect(mocks.parse).toHaveBeenCalledTimes(2);
  expect(mocks.parse.mock.calls[1][0]).toEqual(['<tv>secondaire</tv>']);
  expect(mocks.parse.mock.calls[1][1]).toEqual([playlist.channels[0]]);
});
