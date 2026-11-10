import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalSearchDialog } from '@/components/GlobalSearchDialog';
import { searchCatalogSource, invalidateSearchCatalog } from '@/utils/catalogSearch';
import { clearVodCategoryCache } from '@/utils/vodPosterCache';
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
beforeEach(async () => { vi.clearAllMocks(); localStorage.clear(); invalidateSearchCatalog(mocks.account); clearVodCategoryCache(); await setMeta('vod_watchlist', []); });
afterEach(cleanup);

/** Fournisseur simulé : deux catégories, une par type, et un titre par catégorie. */
function provider({ movieName = 'Les Misérables (2019)', seriesName = 'Les Misérables', failSeries = false } = {}) {
  mocks.request.mockImplementation((_account, action) => {
    if (action === 'get_vod_categories') return Promise.resolve([{ category_id: '1', category_name: 'Films' }, { category_id: '2', category_name: 'Classiques' }]);
    if (action === 'get_series_categories') return failSeries ? Promise.reject(new Error('offline')) : Promise.resolve([{ category_id: '1', category_name: 'Séries' }]);
    if (action === 'get_vod_streams') return Promise.resolve([{ stream_id: 42, name: movieName, container_extension: 'mp4' }]);
    if (action === 'get_series') return Promise.resolve([{ series_id: 42, name: seriesName, cover: 'https://example.test/serie.jpg' }]);
    return Promise.resolve([]);
  });
}

it('trouve films et séries hors Ma liste, sans accents, par catégorie, et ouvre le titre exact', async () => {
  provider();
  render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'miserables');
  const film = await screen.findByRole('button', { name: /Les Misérables \(2019\)/ });
  expect(await screen.findByRole('button', { name: 'Les Misérables Série Voir' })).toBeTruthy();
  await userEvent.click(film);
  expect(props.onSelectVod).toHaveBeenCalledWith(expect.objectContaining({ id: '42', kind: 'movie', playlistId: 'p', extension: 'mp4' }));
  // La recherche interroge les catégories, jamais le catalogue entier.
  expect(mocks.request).toHaveBeenCalledWith(expect.anything(), 'get_vod_categories', {}, expect.anything());
  expect(mocks.request).toHaveBeenCalledWith(expect.anything(), 'get_vod_streams', { category_id: '1' }, expect.anything());
  const full = mocks.request.mock.calls.filter(call => call[1] === 'get_vod_streams' && Object.keys(call[2] ?? {}).length === 0);
  expect(full).toHaveLength(0);
});

it('laisse les résultats en place quand la fiche d’un film s’ouvre par-dessus', async () => {
  provider();
  render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'miserables');
  await userEvent.click(await screen.findByRole('button', { name: /Les Misérables \(2019\)/ }));
  // La fiche remplace l'écran, pas la recherche : la refermer doit ramener aux résultats.
  expect(props.onSelectVod).toHaveBeenCalled();
  expect(props.onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('miserables');
});

it('conserve les films accessibles si les séries échouent, sans masquer les résultats', async () => {
  provider({ movieName: 'Film trouvé', failSeries: true });
  render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'trouve');
  expect(await screen.findByRole('button', { name: /Film trouvé/ })).toBeTruthy();
  // Un film trouvé reste affiché : la panne des séries ne doit pas envahir l'écran.
  expect(screen.queryByRole('alert')).toBeNull();
});

it('signale une panne de catalogue quand aucun résultat n’est trouvé', async () => {
  provider({ movieName: 'Autre film', failSeries: true });
  render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'introuvable');
  expect(await screen.findByRole('alert')).toHaveTextContent('séries indisponible');
});

it('ignore une réponse de catégorie arrivée après le changement de liste', async () => {
  let resolveFirstItems!: (data: unknown) => void;
  mocks.request.mockImplementation((_account, action) => {
    if (action === 'get_vod_categories') return Promise.resolve([{ category_id: '1', category_name: 'Films' }]);
    if (action === 'get_series_categories') return Promise.resolve([]);
    if (action === 'get_vod_streams') return new Promise(resolve => { resolveFirstItems = resolve; });
    return Promise.resolve([]);
  });
  const { rerender } = render(<GlobalSearchDialog {...props} />);
  await userEvent.type(screen.getByRole('textbox'), 'ancien');
  await waitFor(() => expect(resolveFirstItems).toBeTypeOf('function'));
  rerender(<GlobalSearchDialog {...props} playlist={{ ...playlist, id: 'autre' }} />);
  await act(async () => resolveFirstItems([{ stream_id: 8, name: 'Ancien titre' }]));
  expect(screen.queryByRole('button', { name: /Ancien titre/ })).toBeNull();
});

it('réutilise les catégories déjà chargées pour la même liste et sépare les listes', async () => {
  provider();
  const signal = new AbortController().signal;
  await searchCatalogSource(mocks.account, 'p', 'movie', { signal, query: 'miserables' });
  const itemCalls = () => mocks.request.mock.calls.filter(call => call[1] === 'get_vod_streams').length;
  const afterFirst = itemCalls();
  await searchCatalogSource(mocks.account, 'p', 'movie', { signal, query: 'miserables' });
  expect(itemCalls()).toBe(afterFirst);
  await searchCatalogSource(mocks.account, 'autre', 'movie', { signal, query: 'miserables' });
  expect(itemCalls()).toBeGreaterThan(afterFirst);
});

it('ne stocke pas une réponse arrivée après l’annulation', async () => {
  const controller = new AbortController();
  mocks.request.mockImplementation((_account, action) => {
    if (action === 'get_vod_categories') return Promise.resolve([{ category_id: '1', category_name: 'Films' }]);
    if (action === 'get_series_categories') return Promise.resolve([]);
    if (action === 'get_vod_streams') {
      // Le fournisseur répond après l'annulation : la réponse ne doit pas être indexée.
      controller.abort();
      return Promise.resolve([{ stream_id: 1, name: 'Ancien' }]);
    }
    return Promise.resolve([]);
  });
  await expect(searchCatalogSource(mocks.account, 'p', 'movie', { signal: controller.signal, query: 'ancien' })).rejects.toThrow();
});

it('recharge une catégorie après dix minutes', async () => {
  provider();
  const signal = new AbortController().signal;
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    await searchCatalogSource(mocks.account, 'p', 'movie', { signal, query: 'miserables' });
    const first = mocks.request.mock.calls.filter(call => call[1] === 'get_vod_streams').length;
    clock.mockReturnValue(now + 600001);
    await searchCatalogSource(mocks.account, 'p', 'movie', { signal, query: 'miserables' });
    expect(mocks.request.mock.calls.filter(call => call[1] === 'get_vod_streams').length).toBeGreaterThan(first);
  } finally { clock.mockRestore(); }
});

it('sur TV, Retour quitte la saisie avant de fermer la recherche', async () => {
  render(<GlobalSearchDialog {...props} tvMode />);
  const input = await screen.findByRole('textbox', { name: 'Rechercher' });
  expect(input).toHaveAttribute('readonly');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).not.toHaveAttribute('readonly');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(props.onOpenChange).not.toHaveBeenCalled();
  expect(input).toHaveAttribute('readonly');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(props.onOpenChange).toHaveBeenCalledWith(false);
});
