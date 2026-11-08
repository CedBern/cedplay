import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => ({ server: 'https://provider.test', username: 'u', password: 'p' }),
  catalogRequest: mocks.request,
}));

import { useAdultVodCategories } from '@/hooks/useAdultVodCategories';
import { clearParentalVodRegistry } from '@/utils/parentalVod';

const playlist: PlaylistInfo = { id: 'liste-hook', name: 'Test', channels: [], groups: [] };

beforeEach(() => {
  clearParentalVodRegistry();
  vi.clearAllMocks();
});

it('ne filtre rien quand le contrôle parental est inactif', () => {
  const { result } = renderHook(() => useAdultVodCategories(playlist, false));
  expect(result.current.ready).toBe(true);
  expect(result.current.isAdult('movie', '9')).toBe(false);
  expect(result.current.isAdult('series', undefined)).toBe(false);
  expect(mocks.request).not.toHaveBeenCalled();
});

it('verrouille les titres des catégories adultes une fois les catégories lues', async () => {
  mocks.request.mockResolvedValue([
    { category_id: '9', category_name: 'Porno' },
    { category_id: '1', category_name: 'France' },
  ]);
  const { result } = renderHook(() => useAdultVodCategories(playlist, true));

  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.isAdult('movie', '9')).toBe(true);
  expect(result.current.isAdult('movie', '1')).toBe(false);
  expect(result.current.isAdult('movie', undefined)).toBe(false);
});

it('reste fermé quand les catégories ne peuvent pas être lues', async () => {
  mocks.request.mockRejectedValue(new Error('Catalogue indisponible'));
  const { result } = renderHook(() => useAdultVodCategories(playlist, true));

  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  await waitFor(() => expect(result.current.isAdult('movie', '1')).toBe(true));
});
