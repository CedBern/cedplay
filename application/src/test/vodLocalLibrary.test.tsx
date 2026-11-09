// Le catalogue ne relance jamais le scan USB/SD : il lit l'index enregistré par
// LocalLibrary et s'en sert pour amorcer « Pour toi ».
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { VodLibrary } from '@/components/VodLibrary';
import { clearVodCategoryCache } from '@/utils/vodPosterCache';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ request: vi.fn(), getLocalWorks: vi.fn() }));

vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => ({ server: 'https://provider.test', username: 'u', password: 'p' }),
  catalogRequest: mocks.request,
}));
vi.mock('@/utils/idb', async () => ({
  ...await vi.importActual<typeof import('@/utils/idb')>('@/utils/idb'),
  getPlayHistory: async () => [],
  pushPlayHistory: async () => {},
  getVodWatchlistFromDB: async () => [],
  getExternalWatches: async () => [],
  getLocalLibraryWorks: mocks.getLocalWorks,
}));
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: { isAvailable: () => true, openVod: vi.fn() } }));

const playlist: PlaylistInfo = { id: 'test', name: 'Test', channels: [], groups: [] };

beforeEach(() => {
  vi.clearAllMocks();
  clearVodCategoryCache();
  localStorage.clear();
  mocks.getLocalWorks.mockResolvedValue([{ title: 'Inception', year: '2010', kind: 'movie', lastModified: 1 }]);
  mocks.request.mockImplementation((_account, action, params) => Promise.resolve(
    action === 'get_vod_categories'
      ? [{ category_id: '1', category_name: 'Films' }, { category_id: '2', category_name: 'Comédie' }]
      : params?.category_id === '2'
        ? [{ stream_id: 3, name: 'Une comédie', category_id: '2', container_extension: 'mp4' }]
        : [
          { stream_id: 1, name: 'Inception', category_id: '1', container_extension: 'mp4' },
          { stream_id: 2, name: 'Interstellar', category_id: '1', container_extension: 'mp4' },
        ],
  ));
});
afterEach(cleanup);

it('un film de la bibliothèque USB/SD amorce « Pour toi » sans historique', async () => {
  render(<VodLibrary playlist={playlist} kind="movie" />);

  // L'index local déclenche le chargement du catalogue complet, puis l'amorce.
  expect(await screen.findByText('Même catégorie que « Inception »')).toBeVisible();
  expect(await screen.findByText(/1 titre de ta bibliothèque USB\/SD/)).toBeVisible();

  await waitFor(() => {
    const full = mocks.request.mock.calls.filter(call => call[1] === 'get_vod_streams' && Object.keys(call[2] ?? {}).length === 0);
    expect(full).toHaveLength(0);
    expect(mocks.request).toHaveBeenCalledWith(expect.anything(), 'get_vod_streams', { category_id: '1' }, expect.anything());
  });
});
