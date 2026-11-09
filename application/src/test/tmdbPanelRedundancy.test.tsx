import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TmdbPanel } from '@/components/TmdbPanel';
import type { TmdbDetails } from '@/utils/tmdb';
import type { CatalogItem } from '@/utils/xtreamCatalog';

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

const panel = (
  provided?: { overview?: boolean; director?: boolean; cast?: boolean },
  catalogItems: CatalogItem[] = [],
  onOpenItem: (item: CatalogItem) => void = () => {},
) => render(
  <TmdbPanel
    name="Film fictif"
    year="2026"
    kind="movie"
    apiKey="cle"
    tmdbId={1}
    region="MX"
    providerIds={[]}
    catalogItems={catalogItems}
    onOpenItem={onOpenItem}
    provided={provided}
  />,
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

it('ouvre un film similaire dans la fiche, sans quitter l’application', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  mocks.fetchTmdbDetails.mockImplementation(async (id: number) => (id === 2
    ? { ...details, id: 2, title: 'Recommandé fictif', overview: 'Synopsis du recommandé', similar: [] }
    : details));
  panel({ overview: true, director: true, cast: true });
  await screen.findByText('Recommandé fictif');
  await userEvent.click(screen.getByRole('button', { name: /Recommandé fictif/ }));

  expect(await screen.findByText('Synopsis du recommandé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Revenir à Film fictif/ })).toBeInTheDocument();
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});

it('ouvre directement le film similaire déjà présent dans la playlist', async () => {
  const opened: CatalogItem[] = [];
  const item: CatalogItem = {
    id: '42', name: 'Recommandé fictif (2010)', poster: '', categoryId: 'cat', extension: 'mp4', rating: '7',
  };
  panel({}, [item], (found) => { opened.push(found); });
  expect(await screen.findByText('Dans ta playlist')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Recommandé fictif/ }));
  expect(opened).toEqual([item]);
});
