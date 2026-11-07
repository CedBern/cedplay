import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalSearchDialog } from '@/components/GlobalSearchDialog';
import { searchCatalogSource, invalidateSearchCatalog } from '@/utils/catalogSearch';
import { setMeta } from '@/utils/idb';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ request: vi.fn(), account: { server: 'https://provider.test', username: 'test', password: 'test' } }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => mocks.account,
  catalogRequest: mocks.request,
}));
const playlist: PlaylistInfo = { id: 'p', name: 'Liste', channels: [], groups: [] };
const props = { open: true, playlist, onOpenChange: vi.fn(), onSelectChannel: vi.fn(), onSelectTab: vi.fn(), onSelectVod: vi.fn() };
beforeEach(async () => { vi.clearAllMocks(); invalidateSearchCatalog(mocks.account); await setMeta('vod_watchlist', []); });
afterEach(cleanup);

it('trouve films et séries hors Ma liste, sans accents, et ouvre le titre exact', async () => {
  mocks.request.mockImplementation((_account, action) => Promise.resolve(action === 'get_series'
    ? [{ series_id: 42, name: 'Les Misérables', cover: 'https://example.test/serie.jpg' }]
    : [{ stream_id: 42, name: 'Les Misérables (2019)', container_extension: 'mp4' }]));
  render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'miserables');
  const film = await screen.findByRole('button', { name: /Les Misérables \(2019\)/ });
  expect(await screen.findByRole('button', { name: 'Les Misérables Série Voir' })).toBeTruthy();
  await userEvent.click(film);
  expect(props.onSelectVod).toHaveBeenCalledWith(expect.objectContaining({ id: '42', kind: 'movie', playlistId: 'p', extension: 'mp4' }));
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

it('conserve les films accessibles si les séries échouent et permet de réessayer', async () => {
  mocks.request.mockImplementation((_account, action) => action === 'get_series' ? Promise.reject(new Error('offline')) : Promise.resolve([{ stream_id: 1, name: 'Film trouvé' }]));
  render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'trouve');
  expect(await screen.findByRole('button', { name: /Film trouvé/ })).toBeTruthy();
  expect(await screen.findByRole('alert')).toHaveTextContent('séries indisponible');
  mocks.request.mockResolvedValue([]);
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer les catalogues' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(mocks.request).toHaveBeenCalledTimes(4);
});

it('ignore les réponses du catalogue d’une ancienne liste', async () => {
  let resolve!: (data: unknown) => void;
  mocks.request.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { rerender } = render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'ancien');
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  mocks.request.mockResolvedValue([]);
  rerender(<GlobalSearchDialog {...props} playlist={{ ...playlist, id: 'autre' }} />);
  await act(async () => resolve([{ series_id: 8, name: 'Ancien titre' }]));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(screen.queryByRole('button', { name: /Ancien titre/ })).toBeNull();
});

it('réutilise le cache avec la bonne liste et sépare les comptes', async () => {
  mocks.request.mockResolvedValue([{ stream_id: 1, name: 'Film' }]);
  const signal = new AbortController().signal;
  await searchCatalogSource(mocks.account, 'p', 'movie', signal);
  expect((await searchCatalogSource(mocks.account, 'autre', 'movie', signal))[0].playlistId).toBe('autre');
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await searchCatalogSource({ ...mocks.account, username: 'autre' }, 'p', 'movie', signal);
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

it('ne stocke pas une réponse arrivée après l’annulation et recharge après dix minutes', async () => {
  const controller = new AbortController();
  mocks.request.mockImplementationOnce(async () => { controller.abort(); return [{ stream_id: 1, name: 'Ancien' }]; }).mockResolvedValue([{ stream_id: 2, name: 'Film' }]);
  await expect(searchCatalogSource(mocks.account, 'p', 'movie', controller.signal)).rejects.toThrow();
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    await searchCatalogSource(mocks.account, 'p', 'movie', new AbortController().signal);
    clock.mockReturnValue(now + 600001);
    await searchCatalogSource(mocks.account, 'p', 'movie', new AbortController().signal);
    expect(mocks.request).toHaveBeenCalledTimes(3);
  } finally { clock.mockRestore(); }
});
