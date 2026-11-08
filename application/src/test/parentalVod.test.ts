import { beforeEach, expect, it, vi } from 'vitest';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  catalogRequest: mocks.request,
}));

import { clearParentalVodRegistry, ensureAdultVodCategoryIds, hasKnownAdultVodCategories, isAdultVodCategory, knownAdultVodCategoryIds, rememberVodCategories } from '@/utils/parentalVod';

const playlist: PlaylistInfo = { id: 'liste-parentale', name: 'Test', channels: [], groups: [] };
const account = { server: 'https://provider.test', username: 'u', password: 'p' };

beforeEach(() => {
  clearParentalVodRegistry();
  vi.clearAllMocks();
});

it('classe les catégories adultes par nom et ne les demande qu’une fois', async () => {
  mocks.request.mockResolvedValue([{ category_id: '9', category_name: 'Adults 18+' }, { category_id: '1', category_name: 'France' }]);

  const ids = await ensureAdultVodCategoryIds(playlist, 'movie', account);
  expect([...ids]).toEqual(['9']);
  expect(mocks.request).toHaveBeenCalledWith(account, 'get_vod_categories', {}, undefined);

  const again = await ensureAdultVodCategoryIds(playlist, 'movie', account);
  expect(again).toBe(ids);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it('sépare les identifiants de films et de séries', async () => {
  mocks.request.mockImplementation((_account, action) => Promise.resolve(action === 'get_vod_categories'
    ? [{ category_id: '9', category_name: 'XXX' }]
    : [{ category_id: '90', category_name: 'Erotique' }]));

  const movies = await ensureAdultVodCategoryIds(playlist, 'movie', account);
  const series = await ensureAdultVodCategoryIds(playlist, 'series', account);

  expect([...movies]).toEqual(['9']);
  expect([...series]).toEqual(['90']);
  expect(isAdultVodCategory(movies, '90')).toBe(false);
  expect(mocks.request).toHaveBeenLastCalledWith(account, 'get_series_categories', {}, undefined);
});

it('réutilise le registre alimenté par l’écran du catalogue sans requête', async () => {
  rememberVodCategories(playlist.id, 'movie', [
    { id: '9', name: 'Pour adultes' },
    { id: '1', name: 'France' },
  ]);

  expect(hasKnownAdultVodCategories(playlist.id, 'movie')).toBe(true);
  expect([...knownAdultVodCategoryIds(playlist.id, 'movie')]).toEqual(['9']);
  await ensureAdultVodCategoryIds(playlist, 'movie', account);
  expect(mocks.request).not.toHaveBeenCalled();
});

it('ne filtre rien sans compte Xtream', async () => {
  const ids = await ensureAdultVodCategoryIds(playlist, 'movie', null);
  expect(ids.size).toBe(0);
  expect(mocks.request).not.toHaveBeenCalled();
});
