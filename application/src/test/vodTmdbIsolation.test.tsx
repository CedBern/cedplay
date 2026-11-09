import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { VodLibrary } from '@/components/VodLibrary';
import { clearVodCategoryCache } from '@/utils/vodPosterCache';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ request: vi.fn(), openVod: vi.fn(), fetch: vi.fn() }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => ({ server: 'https://provider.test', username: 'u', password: 'p' }),
  catalogRequest: mocks.request,
}));
vi.mock('@/utils/idb', async () => ({
  ...await vi.importActual<typeof import('@/utils/idb')>('@/utils/idb'),
  getMeta: async () => undefined,
  setMeta: vi.fn(),
  getPlayHistory: async () => [],
  pushPlayHistory: async () => {},
  getVodWatchlistFromDB: async () => [],
  getSettingsFromDB: async () => undefined,
  saveSettingsToDB: vi.fn(),
}));
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: { isAvailable: () => true, openVod: mocks.openVod } }));
vi.mock('@/components/SubtitleSelector', () => ({ SubtitleSelector: () => null }));

const playlist: PlaylistInfo = { id: 'tmdb-isolation', name: 'Liste fictive', channels: [], groups: [] };

beforeEach(() => {
  vi.clearAllMocks();
  clearVodCategoryCache();
  localStorage.clear();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.openVod.mockResolvedValue(true);
  mocks.request.mockImplementation((_account, action) => Promise.resolve(
    action.endsWith('_categories') ? [{ category_id: '1', category_name: 'Familial' }]
      : action === 'get_vod_streams' ? [{ stream_id: 10, name: 'Film fictif', container_extension: 'mp4', category_id: '1', tmdb_id: 42 }]
        : action === 'get_series' ? [{ series_id: 20, name: 'Série fictive', category_id: '1', tmdb_id: 43 }]
          : { info: { plot: 'Synopsis du fournisseur' }, movie_data: { container_extension: 'mp4' }, episodes: { 1: [{ id: 200, title: 'Pilote fictif', episode_num: 1, container_extension: 'mp4' }] } },
  ));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['movie', 'series'] as const)('une clé TMDB refusée ne masque ni ne bloque le catalogue %s', async kind => {
  mocks.fetch.mockResolvedValue({ ok: false, status: 401 });
  const name = kind === 'movie' ? 'Film fictif' : 'Série fictive';
  const view = render(<VodLibrary playlist={playlist} kind={kind} parentalEnabled />);
  await screen.findByRole('button', { name });
  const catalogCalls = mocks.request.mock.calls.length;
  view.rerender(<VodLibrary playlist={playlist} kind={kind} parentalEnabled tmdbApiKey="cle-fictive-refusee" />);
  expect(mocks.request).toHaveBeenCalledTimes(catalogCalls);
  fireEvent.click(screen.getByRole('button', { name }));
  await screen.findByText('Clé ou jeton TMDB refusé. Vérifie la valeur dans Réglages › Films et séries.');
  expect(screen.getByText('Synopsis du fournisseur')).toBeVisible();
  expect(screen.getByRole('button', { name, hidden: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Regarder' }));
  await waitFor(() => expect(mocks.openVod).toHaveBeenCalledWith(
    kind === 'movie' ? 'https://provider.test/movie/u/p/10.mp4' : 'https://provider.test/series/u/p/200.mp4',
    kind === 'movie' ? name : 'Pilote fictif',
    kind === 'movie' ? 'tmdb-isolation:movie:10' : 'tmdb-isolation:series:200', false,
  ));
});

it('un échec réseau TMDB reste limité à la fiche enrichie sur TV', async () => {
  mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  render(<VodLibrary playlist={playlist} kind="movie" tmdbApiKey="cle-fictive" tvMode parentalEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: /Film fictif/ }));
  await screen.findByText('Fiche TMDB indisponible (réseau ou clé invalide).');
  expect(screen.getByText('Synopsis du fournisseur')).toBeVisible();
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Regarder' }));
  await waitFor(() => expect(mocks.openVod).toHaveBeenCalled());
});

it('un titre similaire absent du catalogue isole sa fiche des actions du fournisseur', async () => {
  const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
  mocks.fetch.mockImplementation(async (input: string) => {
    const url = new URL(String(input));
    if (url.pathname === '/3/movie/42') {
      return json({
        id: 42, title: 'Film fictif', overview: 'Synopsis TMDB du film fictif', release_date: '2026-03-09',
        runtime: 84, genres: [{ id: 28, name: 'Action' }], vote_average: 7, vote_count: 10,
        credits: { cast: [], crew: [] }, reviews: { results: [] },
        recommendations: {
          results: [{ id: 999, title: 'Recommandé TMDB', release_date: '2010-05-01', poster_path: null, vote_average: 7.5 }],
        },
      });
    }
    if (url.pathname === '/3/movie/999') {
      return json({
        id: 999, title: 'Recommandé TMDB', overview: 'Synopsis TMDB du recommandé', release_date: '2010-05-01',
        runtime: 90, genres: [], vote_average: 7.5, vote_count: 5,
        credits: { cast: [], crew: [] }, reviews: { results: [] }, recommendations: { results: [] },
      });
    }
    return json({ id: 0, results: {} });
  });

  render(<VodLibrary playlist={playlist} kind="movie" tmdbApiKey="cle-fictive" parentalEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: 'Film fictif' }));

  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('Synopsis du fournisseur')).toBeVisible();
  fireEvent.click(await within(dialog).findByRole('button', { name: /Recommandé TMDB/ }));

  // La fiche entière suit B : titre, synopsis TMDB, et plus aucune action de A.
  expect(await within(dialog).findByText('Synopsis TMDB du recommandé')).toBeVisible();
  expect(within(dialog).getByRole('heading', { name: 'Recommandé TMDB' })).toBeInTheDocument();
  expect(within(dialog).queryByText('Synopsis du fournisseur')).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Ajouter à ma liste' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Regarder' })).toBeNull();

  // Retour : la fiche du fournisseur et ses actions reviennent avec A.
  fireEvent.click(within(dialog).getByRole('button', { name: /Revenir à Film fictif/ }));
  expect(await within(dialog).findByText('Synopsis du fournisseur')).toBeVisible();
  expect(within(dialog).getByRole('heading', { name: 'Film fictif' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Regarder' })).toBeInTheDocument();
});
