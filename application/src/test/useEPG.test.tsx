import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useEPG } from '@/hooks/useEPG';
import { EPGGrid } from '@/components/EPGGrid';
import { StorageManager } from '@/utils/storage';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ source: vi.fn() }));
vi.mock('@/utils/epg', () => ({
  fetchEPGSource: mocks.source,
  getParsedEPGCache: async () => null,
  saveParsedEPGCache: async () => {},
}));
const playlist: PlaylistInfo = { id: 'p', name: 'Test', channels: [], groups: [] };
const settings = StorageManager.getSettings();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('sort du chargement sans source et après une erreur, puis permet de réessayer', async () => {
  mocks.source.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('private URL')).mockResolvedValueOnce({ xml: '<tv/>', fetchedAt: 10, stale: false });
  const { result } = renderHook(() => useEPG(playlist, settings));
  await waitFor(() => expect(result.current.status).toBe('absent'));
  const view = render(<EPGGrid channels={[]} epgData={result.current.data} guideState={result.current} onSelectChannel={() => {}} />);
  expect(screen.getByText('Aucune source de guide configurée.')).toBeVisible();
  expect(screen.queryByText('Chargement du guide des programmes…')).toBeNull();
  view.unmount();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe('error'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(mocks.source).toHaveBeenLastCalledWith(playlist, settings, true);
});

it('ignore une réponse tardive de l’ancienne liste et signale un cache périmé', async () => {
  let finish!: (value: unknown) => void;
  mocks.source.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ xml: '<tv/>', fetchedAt: 20, stale: true });
  const { result, rerender } = renderHook(({ value }) => useEPG(value, settings), { initialProps: { value: playlist } });
  rerender({ value: { ...playlist, id: 'autre' } });
  await waitFor(() => expect(result.current.status).toBe('stale'));
  await act(async () => finish({ xml: '<tv/>', fetchedAt: 1, stale: false }));
  expect(result.current.fetchedAt).toBe(20);
});

it('garde les commandes de date même si la journée est vide', () => {
  render(<EPGGrid channels={[]} epgData={{}} onSelectChannel={() => {}} />);
  expect(screen.getByRole('button', { name: 'Jour précédent' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Jour suivant' })).toBeVisible();
});
