import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VodLibrary } from '@/components/VodLibrary';
import { StorageManager } from '@/utils/storage';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ request: vi.fn(), pushPlayHistory: vi.fn() }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => ({ server: 'https://provider.test', username: 'u', password: 'p' }),
  catalogRequest: mocks.request,
}));
vi.mock('@/utils/idb', async () => ({
  ...await vi.importActual<typeof import('@/utils/idb')>('@/utils/idb'),
  getPlayHistory: vi.fn(async () => []),
  pushPlayHistory: (...args: unknown[]) => mocks.pushPlayHistory(...args),
}));
// Chemin web : la mosaïque/le lecteur natif ne sont pas disponibles.
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: { isAvailable: () => false } }));

const playlist: PlaylistInfo = { id: 'test', name: 'Test', channels: [], groups: [] };
const catalogue = (_account: unknown, action: string) => Promise.resolve(
  action === 'get_series_categories' ? [{ category_id: '1', category_name: 'A' }]
    : action === 'get_series' ? [{ series_id: 10, name: 'Ma série' }]
      : { episodes: { 1: [
        { id: 100, title: 'Pilote', episode_num: 1, container_extension: 'mp4' },
        { id: 200, title: 'Retour', episode_num: 2, container_extension: 'mp4' },
      ] } },
);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.request.mockImplementation(catalogue);
  mocks.pushPlayHistory.mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Ouvre la fiche de « Ma série » et lance le premier épisode (chemin web). */
async function lancerPilote(user: ReturnType<typeof userEvent.setup>) {
  render(<VodLibrary playlist={playlist} kind="series" />);
  await user.click(await screen.findByRole('button', { name: 'Ma série' }));
  await screen.findByRole('combobox', { name: 'Saison' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Saison' }), '1');
  const regarder = await screen.findAllByRole('button', { name: 'Regarder' });
  await user.click(regarder[0]);
  await screen.findByText('Pilote');
}

it('propose l’épisode suivant à la fin et l’enchaîne immédiatement sur demande', async () => {
  const user = userEvent.setup();
  await lancerPilote(user);
  // Le lecteur web est monté ; la lecture se termine.
  await act(async () => { fireEvent(document.querySelector('video')!, new Event('ended')); });
  const overlay = await screen.findByTestId('next-episode-overlay');
  expect(overlay).toHaveTextContent('2. Retour');
  // Annulation possible…
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByTestId('next-episode-overlay')).toBeNull();
  // …puis relance et enchaînement immédiat.
  await act(async () => { fireEvent(document.querySelector('video')!, new Event('ended')); });
  await user.click(await screen.findByRole('button', { name: 'Lire maintenant' }));
  await screen.findByText('Retour');
  // L'épisode lancé automatiquement garde l'identité de la série dans l'historique.
  expect(mocks.pushPlayHistory).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Ma série', episodeName: 'Retour', seriesId: '10', status: 'started',
  }));
  // Dernier épisode de la saison : plus rien à proposer.
  await act(async () => { fireEvent(document.querySelector('video')!, new Event('ended')); });
  expect(screen.queryByTestId('next-episode-overlay')).toBeNull();
});

it('enchaîne tout seul à la fin du compte à rebours', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await lancerPilote(user);
  await act(async () => { fireEvent(document.querySelector('video')!, new Event('ended')); });
  await screen.findByTestId('next-episode-overlay');
  // Chaque tick replanifie le suivant via un re-rendu React : on avance et on
  // laisse React rejouer l'effet entre chaque seconde simulée.
  for (let tick = 0; tick < 6; tick++) {
    await act(async () => { vi.advanceTimersByTime(1_100); });
  }
  await screen.findByText('Retour');
  expect(screen.queryByTestId('next-episode-overlay')).toBeNull();
});

it('n’enchaîne rien quand le réglage autoNextEpisode est désactivé', async () => {
  const spy = vi.spyOn(StorageManager, 'loadSettingsAsync')
    .mockResolvedValue({ ...StorageManager.getSettings(), autoNextEpisode: false });
  try {
    const user = userEvent.setup();
    await lancerPilote(user);
    await act(async () => { fireEvent(document.querySelector('video')!, new Event('ended')); });
    await waitFor(() => expect(mocks.pushPlayHistory).toHaveBeenCalled());
    expect(screen.queryByTestId('next-episode-overlay')).toBeNull();
  } finally { spy.mockRestore(); }
});
