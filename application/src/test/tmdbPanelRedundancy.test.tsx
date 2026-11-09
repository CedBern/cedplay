import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TmdbPanel } from '@/components/TmdbPanel';
import type { TmdbDetails } from '@/utils/tmdb';

const details: TmdbDetails = {
  id: 1, title: 'Film fictif', overview: 'Synopsis TMDB', releaseDate: '2026-03-09', runtime: 84, genres: ['Documentaire'],
  voteAverage: 7, voteCount: 1, revenue: 0, posterPath: null, director: 'Réalisatrice TMDB', cast: [{ name: 'Acteur TMDB' }],
  similar: [{ id: 2, title: 'Recommandé fictif', releaseDate: '2010-01-01', posterPath: null, voteAverage: 7.5 }], reviews: [],
};
const mocks = vi.hoisted(() => ({ fetchTmdbDetails: vi.fn() }));
vi.mock('@/utils/tmdb', async () => ({
  ...await vi.importActual<typeof import('@/utils/tmdb')>('@/utils/tmdb'),
  fetchTmdbDetails: mocks.fetchTmdbDetails,
}));
vi.mock('@/components/WatchProviders', () => ({ WatchProviders: () => null }));
beforeEach(() => { mocks.fetchTmdbDetails.mockResolvedValue(details); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const panel = (provided?: { overview?: boolean; director?: boolean; cast?: boolean }) => render(
  <TmdbPanel name="Film fictif" year="2026" kind="movie" apiKey="cle" tmdbId={1} catalogItems={[]} onOpenItem={() => {}} provided={provided} />,
);

it('ne répète pas synopsis, réalisation et casting déjà fournis par le service IPTV', async () => {
  panel({ overview: true, director: true, cast: true });
  await screen.findByText('Recommandé fictif');
  expect(screen.getByText(/7\.0\/10/)).toBeInTheDocument();
  expect(screen.queryByText('Synopsis TMDB')).toBeNull();
  expect(screen.queryByText(/Réalisatrice TMDB/)).toBeNull();
  expect(screen.queryByText(/Acteur TMDB/)).toBeNull();
  expect(screen.queryByText('Synopsis non fourni.')).toBeNull();
});

it('sert de repli quand le service IPTV ne fournit rien', async () => {
  panel({ overview: false, director: false, cast: false });
  await screen.findByText('Recommandé fictif');
  expect(screen.getByText('Synopsis TMDB')).toBeInTheDocument();
  expect(screen.getByText('Réalisation : Réalisatrice TMDB')).toBeInTheDocument();
  expect(screen.getByText('Avec : Acteur TMDB')).toBeInTheDocument();
  expect(screen.queryByText('Synopsis non fourni.')).toBeNull();
});

it('signale l’absence de synopsis quand TMDB n’en a pas non plus', async () => {
  mocks.fetchTmdbDetails.mockResolvedValue({ ...details, overview: '' });
  panel({ overview: false });
  await screen.findByText('Recommandé fictif');
  expect(screen.getByText('Synopsis non fourni.')).toBeInTheDocument();
});

it('signale l’absence de synopsis quand TMDB échoue', async () => {
  mocks.fetchTmdbDetails.mockRejectedValue(new Error('réseau'));
  panel({ overview: false });
  await screen.findByText('Fiche TMDB indisponible (réseau ou clé invalide).');
  expect(screen.getByText('Synopsis non fourni.')).toBeInTheDocument();
});

it('ne signale rien tant que la fiche du fournisseur est supposée complète', async () => {
  mocks.fetchTmdbDetails.mockRejectedValue(new Error('réseau'));
  panel({ overview: true });
  await screen.findByText('Fiche TMDB indisponible (réseau ou clé invalide).');
  expect(screen.queryByText('Synopsis non fourni.')).toBeNull();
});
