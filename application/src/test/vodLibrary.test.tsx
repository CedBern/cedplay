import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VodLibrary } from '@/components/VodLibrary';
import { clearVodCategoryCache } from '@/utils/vodPosterCache';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ request: vi.fn(), openVod: vi.fn(), getPlayHistory: vi.fn(), pushPlayHistory: vi.fn() }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => ({ server: 'https://provider.test', username: 'u', password: 'p' }),
  catalogRequest: mocks.request,
}));
vi.mock('@/utils/idb', async () => ({
  ...await vi.importActual<typeof import('@/utils/idb')>('@/utils/idb'),
  getPlayHistory: (...args: unknown[]) => mocks.getPlayHistory(...args),
  pushPlayHistory: (...args: unknown[]) => mocks.pushPlayHistory(...args),
}));
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: { isAvailable: () => true, openVod: mocks.openVod } }));
const playlist: PlaylistInfo = { id: 'test', name: 'Test', channels: [], groups: [] };
beforeEach(() => {
  vi.clearAllMocks();
  clearVodCategoryCache();
  localStorage.clear();
  mocks.getPlayHistory.mockResolvedValue([]);
  mocks.pushPlayHistory.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('ignore une ancienne réponse de catégorie arrivée après le changement de sélection', async () => {
  let resolveA!: (data: unknown) => void;
  mocks.request.mockImplementation((_a, action, params) => {
    if (action === 'get_vod_categories') return Promise.resolve([{ category_id: '1', category_name: 'A' }, { category_id: '2', category_name: 'B' }]);
    if (params.category_id === '1') return new Promise(resolve => { resolveA = resolve; });
    return Promise.resolve([{ stream_id: 2, name: 'Film B', container_extension: 'mp4' }]);
  });
  render(<VodLibrary playlist={playlist} kind="movie" />);
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.anything(), 'get_vod_streams', { category_id: '1' }, expect.anything()));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Catégorie VOD' }), '2');
  await screen.findByRole('button', { name: 'Film B' });
  await act(async () => resolveA([{ stream_id: 1, name: 'Ancien Film A' }]));
  expect(screen.queryByRole('button', { name: 'Ancien Film A' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Film B' })).toBeVisible();
});

it('ouvre le bon épisode de la saison choisie dans le chemin séries', async () => {
  mocks.request.mockImplementation((_a, action) => Promise.resolve(action === 'get_series_categories'
    ? [{ category_id: '1', category_name: 'France' }]
    : action === 'get_series' ? [{ series_id: 10, name: 'Ma série' }]
      : { info: { plot: 'Une histoire' }, episodes: { 1: [{ id: 100, title: 'Pilote', episode_num: 1, container_extension: 'mp4' }], 2: [{ id: 200, title: 'Retour', episode_num: 1, container_extension: 'mkv' }] } }));
  mocks.openVod.mockResolvedValue(true);
  render(<VodLibrary playlist={playlist} kind="series" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Ma série' }));
  await screen.findByRole('combobox', { name: 'Saison' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Saison' }), '2');
  expect(screen.queryByText('1. Pilote')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Regarder' }));
  expect(mocks.openVod).toHaveBeenCalledWith('https://provider.test/series/u/p/200.mkv', 'Retour', 'test:series:200', false);
});

it('permet de relancer un catalogue après un échec réseau', async () => {
  mocks.request.mockRejectedValueOnce(new Error('Catalogue indisponible')).mockImplementation((_a, action) => Promise.resolve(action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'A' }] : []));
  render(<VodLibrary playlist={playlist} kind="movie" />);
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByText('Aucun titre dans cette sélection.');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('ouvre la fiche exacte de Ma liste même hors de la catégorie affichée', async () => {
  mocks.request.mockImplementation((_a, action) => Promise.resolve(action === 'get_vod_categories'
    ? [{ category_id: '1', category_name: 'A' }]
    : action === 'get_vod_streams' ? [{ stream_id: 1, name: 'Autre film' }]
    : { info: { plot: 'Fiche exacte' }, movie_data: { container_extension: 'mp4' } }));
  render(<VodLibrary playlist={playlist} kind="movie" resumeRequest={{ nonce: 1, kind: 'movie', mode: 'details', item: { id: '42', kind: 'movie', name: 'Mon film enregistré', playlistId: 'test', addedAt: 0 } }} />);
  await screen.findByRole('dialog');
  expect(await screen.findByText('Fiche exacte')).toBeVisible();
  expect(mocks.request).toHaveBeenCalledWith(expect.anything(), 'get_vod_info', { vod_id: '42' }, expect.anything());
  expect(mocks.openVod).not.toHaveBeenCalled();
});

it('reprend l’épisode précis en saison 2 sans dépendre de la catégorie par défaut', async () => {
  mocks.request.mockImplementation((_a, action) => Promise.resolve(action === 'get_series_categories'
    ? [{ category_id: '1', category_name: 'A' }]
    : action === 'get_series' ? [{ series_id: 10, name: 'Ma série' }]
    : { episodes: { 1: [{ id: 100, title: 'Pilote', episode_num: 1, container_extension: 'mp4' }], 2: [{ id: 200, title: 'Retour', episode_num: 1, container_extension: 'mkv' }, { id: 201, title: 'Suite', episode_num: 2, container_extension: 'mp4' }] } }));
  mocks.openVod.mockResolvedValue(true);
  const handled = vi.fn();
  render(<VodLibrary playlist={playlist} kind="series" resumeRequest={{ nonce: 2, kind: 'series', id: '200', seriesId: '10', name: 'Ma série' }} onResumeHandled={handled} />);
  await waitFor(() => expect(mocks.openVod).toHaveBeenCalledWith('https://provider.test/series/u/p/200.mkv', 'Retour', 'test:series:200', false, undefined,
    expect.objectContaining({ index: 0, ids: ['test:series:200', 'test:series:201'] })));
  expect(handled).toHaveBeenCalledTimes(1);
});

it('ne lance pas un film si la réponse de reprise arrive après fermeture du catalogue', async () => {
  let resolveInfo!: (data: unknown) => void;
  mocks.request.mockImplementation((_a, action) => action === 'get_vod_info'
    ? new Promise(resolve => { resolveInfo = resolve; })
    : Promise.resolve(action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'A' }] : []));
  const { unmount } = render(<VodLibrary playlist={playlist} kind="movie" resumeRequest={{ nonce: 7, kind: 'movie', id: '42', name: 'Film' }} />);
  await waitFor(() => expect(resolveInfo).toBeDefined());
  unmount();
  await act(async () => resolveInfo({ movie_data: { container_extension: 'mp4' } }));
  expect(mocks.openVod).not.toHaveBeenCalled();
});
