// Tests de « Où regarder » : offres TMDB affichées et ouverture de l'app officielle.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WatchAvailability } from '@/utils/watchAvailability';

const mocks = vi.hoisted(() => ({
  available: true,
  fetch: vi.fn<(id: number, kind: string, apiKey: string, region?: string) => Promise<WatchAvailability | null>>(),
  openWeb: vi.fn(async () => {}),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: { isAvailable: () => mocks.available, openWeb: mocks.openWeb } }));
vi.mock('@/utils/tmdb', () => ({ fetchWatchProviders: mocks.fetch }));

import { WatchProviders } from '@/components/WatchProviders';

const availability: WatchAvailability = {
  region: 'FR',
  link: 'https://www.themoviedb.org/movie/27205/watch?locale=FR',
  offers: [
    { providerId: 8, name: 'Netflix', displayName: 'Netflix', logoPath: '/netflix.png', kind: 'flatrate', displayPriority: 1, platformId: 'netflix', distributedBy: null },
    { providerId: 3, name: 'Google Play Movies', displayName: 'Google Play Movies', logoPath: null, kind: 'rent', displayPriority: 2, platformId: null, distributedBy: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.available = true;
  mocks.fetch.mockResolvedValue(availability);
});
afterEach(cleanup);

const renderPanel = () => render(<WatchProviders tmdbId={27205} kind="movie" title="Inception" apiKey="clé" region="FR" />);

it('affiche les offres et ouvre l’app officielle sur la recherche du titre', async () => {
  renderPanel();
  expect(await screen.findByTestId('watch-providers')).toBeTruthy();
  expect(mocks.fetch).toHaveBeenCalledWith(27205, 'movie', 'clé', 'FR');

  await userEvent.click(screen.getByRole('button', { name: /Netflix/ }));
  expect(mocks.openWeb).toHaveBeenCalledWith(
    'https://www.netflix.com/search?q=Inception',
    'Netflix',
    ['com.netflix.mediaclient', 'com.netflix.ninja'],
    true,
  );
});

it('attribue les données à JustWatch via TMDB', async () => {
  renderPanel();
  await screen.findByTestId('watch-providers');
  expect(screen.getByText(/JustWatch via TMDB/)).toBeTruthy();
});

it('conserve le nom complet d’une offre distribuée et ouvre le distributeur', async () => {
  mocks.fetch.mockResolvedValue({
    region: 'FR',
    link: 'https://www.themoviedb.org/movie/27205/watch?locale=FR',
    offers: [{
      providerId: 1825, name: 'HBO Max Amazon Channel', displayName: 'HBO Max Amazon Channel',
      logoPath: null, kind: 'flatrate', displayPriority: 1, platformId: 'primevideo', distributedBy: 'Prime Video',
    }],
  });
  renderPanel();
  await screen.findByTestId('watch-providers');
  expect(screen.getByText('HBO Max Amazon Channel')).toBeTruthy();
  expect(screen.getByText(/via Prime Video/)).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: /HBO Max Amazon Channel/ }));
  expect(mocks.openWeb).toHaveBeenCalledWith(
    'https://www.primevideo.com/search/ref=atv_nb_sr?phrase=Inception',
    'HBO Max Amazon Channel',
    ['com.amazon.avod.thirdpartyclient', 'com.amazon.amazonvideo.livingroom'],
    true,
  );
});

it('ouvre la page TMDB pour un fournisseur sans app connue', async () => {
  renderPanel();
  await screen.findByTestId('watch-providers');
  await userEvent.click(screen.getByRole('button', { name: /Google Play Movies/ }));
  expect(mocks.openWeb).toHaveBeenCalledWith(
    'https://www.themoviedb.org/movie/27205/watch?locale=FR',
    'Google Play Movies',
    undefined,
    true,
  );
});

it('retombe sur le navigateur hors Android', async () => {
  mocks.available = false;
  const open = vi.spyOn(window, 'open').mockReturnValue({ opener: null } as unknown as Window);
  renderPanel();
  await screen.findByTestId('watch-providers');
  await userEvent.click(screen.getByRole('button', { name: /Netflix/ }));
  expect(open).toHaveBeenCalledWith('https://www.netflix.com/search?q=Inception', '_blank');
  open.mockRestore();
});

it('ne demande rien sans clé TMDB', async () => {
  render(<WatchProviders tmdbId={27205} kind="movie" title="Inception" apiKey="" region="MX" />);
  await waitFor(() => expect(mocks.fetch).not.toHaveBeenCalled());
  expect(screen.queryByTestId('watch-providers')).toBeNull();
});

it('annonce l’absence d’offre légale en France', async () => {
  mocks.fetch.mockResolvedValue({ region: 'FR', link: 'https://www.themoviedb.org/movie/27205/watch', offers: [] });
  renderPanel();
  expect(await screen.findByText(/Aucune offre légale répertoriée en France/)).toBeTruthy();
  expect(screen.getByText(/JustWatch via TMDB/)).toBeTruthy();
});

it('affiche les offres du Mexique quand le pays est réglé sur MX', async () => {
  mocks.fetch.mockResolvedValue({
    region: 'MX',
    link: 'https://www.themoviedb.org/movie/27205/watch?locale=MX',
    offers: [{
      providerId: 457, name: 'VIX', displayName: 'ViX', logoPath: null,
      kind: 'flatrate', displayPriority: 1, platformId: 'vix', distributedBy: null,
    }],
  });
  render(<WatchProviders tmdbId={27205} kind="movie" title="Inception" apiKey="clé" region="MX" />);
  expect(await screen.findByText('Où regarder au Mexique')).toBeTruthy();
  expect(mocks.fetch).toHaveBeenCalledWith(27205, 'movie', 'clé', 'MX');

  await userEvent.click(screen.getByRole('button', { name: /ViX/ }));
  expect(mocks.openWeb).toHaveBeenCalledWith('https://vix.com', 'ViX', undefined, true);
});

it('reste silencieux si TMDB ne répond pas', async () => {
  mocks.fetch.mockRejectedValue(new Error('réseau'));
  renderPanel();
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  expect(screen.queryByTestId('watch-providers')).toBeNull();
  expect(screen.queryByText(/Aucune offre légale/)).toBeNull();
});
