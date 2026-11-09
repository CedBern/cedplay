import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/tmdb')>();
  return { ...actual, searchTmdb: vi.fn(), fetchTmdbDetails: vi.fn() };
});

import { enrichRecommendations, recentWatchedMovies, sampleExternalWatches, EXTERNAL_SAMPLE, TASTE_SAMPLE } from '@/utils/tasteEnrichment';
import { matchTaste } from '@/utils/tasteProfile';
import { fetchTmdbDetails, searchTmdb, TmdbAuthenticationError, type TmdbDetails } from '@/utils/tmdb';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { CatalogItem } from '@/utils/xtreamCatalog';

const now = 1_700_000_000_000;
const searchMock = vi.mocked(searchTmdb);
const detailsMock = vi.mocked(fetchTmdbDetails);

const details = (id: number, over: Partial<TmdbDetails> = {}): TmdbDetails => ({
  id,
  title: `Film ${id}`,
  overview: '',
  releaseDate: '2010-05-01',
  runtime: 120,
  genres: [],
  voteAverage: 0,
  voteCount: 0,
  revenue: 0,
  posterPath: null,
  cast: [],
  similar: [],
  reviews: [],
  ...over,
});

const item = (id: string, name: string, tmdbId?: number): CatalogItem => ({
  id, name, categoryId: '12', poster: '', extension: 'mp4', rating: '',
  ...(tmdbId ? { tmdbId } : {}),
});

const entry = (id: string, name: string, ts = now): PlayHistoryEntry => ({
  channelId: `vod:1:movie:${id}`, ts, status: 'completed', kind: 'vod', playlistId: '1', mediaKind: 'movie', name,
});

const external = (name: string, ts = now, over: Partial<PlayHistoryEntry> = {}): PlayHistoryEntry => ({
  channelId: `elsewhere:netflix:movie:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  ts, kind: 'vod', mediaKind: 'movie', name, status: 'completed', platform: 'netflix',
  ...over,
});

beforeEach(() => {
  searchMock.mockReset();
  detailsMock.mockReset();
  searchMock.mockResolvedValue([]);
  detailsMock.mockImplementation(async (id: number) => details(id));
});

describe('recentWatchedMovies', () => {
  it('garde les films vus, du plus récent au plus ancien, et borne l’échantillon', () => {
    const history: PlayHistoryEntry[] = [
      entry('1', 'Ancien', now - 10_000),
      entry('2', 'Récent', now),
      { channelId: 'vod:1:series:3', ts: now, kind: 'vod', playlistId: '1', mediaKind: 'series', name: 'Série', status: 'completed' },
      { channelId: 'live:1', ts: now, kind: 'live' },
      { ...entry('4', 'À peine commencé'), status: 'started', positionMs: 5000 },
    ];
    expect(recentWatchedMovies(history, '1').map(e => e.name)).toEqual(['Récent', 'Ancien']);

    const many = Array.from({ length: TASTE_SAMPLE + 5 }, (_, i) => entry(String(i), `Film ${i}`, now - i * 1000));
    expect(recentWatchedMovies(many, '1')).toHaveLength(TASTE_SAMPLE);
  });
});

describe('enrichRecommendations', () => {
  const candidates = [item('7', 'Interstellar'), item('8', 'Titre inconnu de TMDB')];

  it('ne fait aucune requête sans clé TMDB', async () => {
    const result = await enrichRecommendations({
      history: [entry('42', 'Inception')], movies: [item('42', 'Inception', 27205)],
      candidates, playlistId: '1', apiKey: '   ',
    });
    expect(result.sampleSize).toBe(0);
    expect(result.detailsByItemId.size).toBe(0);
    expect(searchMock).not.toHaveBeenCalled();
    expect(detailsMock).not.toHaveBeenCalled();
  });

  it('réutilise l’identifiant TMDB du catalogue pour les films vus, sans recherche', async () => {
    const result = await enrichRecommendations({
      history: [entry('42', 'Inception')], movies: [item('42', 'Inception', 27205)],
      candidates: [item('7', 'Interstellar', 157336)], playlistId: '1', apiKey: 'clé',
    });
    expect(searchMock).not.toHaveBeenCalled();
    expect(detailsMock).toHaveBeenCalledWith(27205, 'movie', 'clé');
    expect(result.sampleSize).toBe(1);
    expect(result.playlistId).toBe('1');
  });

  it('retrouve un film vu par titre exact quand l’identifiant fournisseur manque', async () => {
    searchMock.mockResolvedValue([
      { id: 27205, title: 'Inception', releaseDate: '2010-07-16', posterPath: null, voteAverage: 8.4, voteCount: 100 },
    ]);
    const result = await enrichRecommendations({
      history: [entry('42', 'Inception FRENCH 1080p')], movies: [item('42', 'Inception FRENCH 1080p')],
      candidates: [item('7', 'Interstellar', 157336)], playlistId: '1', apiKey: 'clé',
    });
    expect(searchMock).toHaveBeenCalledWith('Inception', '', 'movie', 'clé');
    expect(detailsMock).toHaveBeenCalledWith(27205, 'movie', 'clé');
    expect(result.profile.sampleSize).toBe(1);
    expect(result.detailsByItemId.has('7')).toBe(true);
  });

  it('abandonne proprement quand aucun titre vu n’est reconnu', async () => {
    searchMock.mockResolvedValue([]);
    const result = await enrichRecommendations({
      history: [entry('42', 'Film introuvable')], movies: [item('42', 'Film introuvable')],
      candidates, playlistId: '1', apiKey: 'clé',
    });
    expect(result.sampleSize).toBe(0);
    expect(result.detailsByItemId.size).toBe(0);
  });

  it('laisse remonter un refus d’authentification pour que l’appelant désactive le profil', async () => {
    detailsMock.mockRejectedValue(new TmdbAuthenticationError());
    await expect(enrichRecommendations({
      history: [entry('42', 'Inception')], movies: [item('42', 'Inception', 27205)],
      candidates, playlistId: '1', apiKey: 'clé-refusée',
    })).rejects.toBeInstanceOf(TmdbAuthenticationError);
  });

  it('ignore une fiche candidate illisible sans perdre les autres', async () => {
    detailsMock.mockImplementation(async (id: number) => {
      if (id === 157336) throw new Error('HTTP 404');
      return details(id);
    });
    const result = await enrichRecommendations({
      history: [entry('42', 'Inception')], movies: [item('42', 'Inception', 27205)],
      candidates: [item('7', 'Candidat cassé', 157336), item('8', 'Candidat sain', 603)],
      playlistId: '1', apiKey: 'clé',
    });
    expect(result.detailsByItemId.has('7')).toBe(false);
    expect(result.detailsByItemId.has('8')).toBe(true);
  });
});

describe('visionnages « Vu ailleurs »', () => {
  it('résout une série importée côté TV et l’ajoute au profil', async () => {
    const result = await enrichRecommendations({
      history: [], movies: [], candidates: [], playlistId: '1', apiKey: 'clé',
      external: [external('The Bear', now, { mediaKind: 'series', tmdbId: 136315 })],
    });
    expect(detailsMock).toHaveBeenCalledWith(136315, 'tv', 'clé');
    expect(result.sampleSize).toBe(1);
    expect(result.externalSampleSize).toBe(1);
  });

  it('ne compte pas deux fois un film vu ici et ailleurs', async () => {
    detailsMock.mockImplementation(async (id: number) => details(id, { title: 'Inception' }));
    const result = await enrichRecommendations({
      history: [entry('42', 'Inception')], movies: [item('42', 'Inception', 27205)],
      candidates: [], playlistId: '1', apiKey: 'clé',
      external: [external('Inception', now, { tmdbId: 999 })],
    });
    expect(result.sampleSize).toBe(1);
    expect(result.externalSampleSize).toBe(0);
  });

  it('partage l’échantillon entre plateformes pour qu’un gros historique YouTube n’écrase pas le reste', () => {
    const youtube = Array.from({ length: 30 }, (_, index) => external(`Vidéo ${index}`, now - index, { platform: 'youtube' }));
    const netflix = [external('Film Netflix', now - 100_000, { platform: 'netflix' })];
    const sample = sampleExternalWatches([...youtube, ...netflix]);
    expect(sample).toHaveLength(EXTERNAL_SAMPLE);
    // Une seule plateforme a beaucoup d'historique : l'autre garde au moins sa place.
    expect(sample.filter(entry => entry.platform === 'netflix')).toHaveLength(1);

    const even = [
      ...Array.from({ length: 10 }, (_, index) => external(`Prime ${index}`, now - index, { platform: 'prime' })),
      ...Array.from({ length: 10 }, (_, index) => external(`YouTube ${index}`, now - index, { platform: 'youtube' })),
    ];
    const fair = sampleExternalWatches(even);
    expect(fair.filter(entry => entry.platform === 'prime')).toHaveLength(EXTERNAL_SAMPLE / 2);
    expect(fair.filter(entry => entry.platform === 'youtube')).toHaveLength(EXTERNAL_SAMPLE / 2);
  });

  it('ignore un visionnage externe sans titre', async () => {
    const result = await enrichRecommendations({
      history: [], movies: [], candidates: [], playlistId: '1', apiKey: 'clé',
      external: [{ ...external('Sans titre'), name: '' }],
    });
    expect(searchMock).not.toHaveBeenCalled();
    expect(detailsMock).not.toHaveBeenCalled();
    expect(result.sampleSize).toBe(0);
  });

  it('conserve deux remakes homonymes d’années distinctes dans le profil', async () => {
    detailsMock.mockImplementation(async (id: number) => details(id, {
      title: 'Suspiria',
      releaseDate: id === 1 ? '1977-02-01' : '2018-10-01',
      genres: [id === 1 ? 'Horreur' : 'Drame'],
    }));
    const result = await enrichRecommendations({
      history: [], movies: [], candidates: [], playlistId: '1', apiKey: 'clé',
      external: [external('Suspiria', now, { tmdbId: 1, year: '1977' }), external('Suspiria', now, { tmdbId: 2, year: '2018' })],
    });
    expect(result.sampleSize).toBe(2);
    expect(result.externalSampleSize).toBe(2);
    expect([...result.profile.genres.keys()].sort()).toEqual(['Drame', 'Horreur']);
  });

  it('conserve un film et une série homonymes comme deux œuvres', async () => {
    detailsMock.mockImplementation(async (id: number, kind) => details(id, {
      title: 'Fargo',
      releaseDate: kind === 'tv' ? '2014-04-01' : '1996-03-01',
    }));
    const result = await enrichRecommendations({
      history: [], movies: [], candidates: [], playlistId: '1', apiKey: 'clé',
      external: [external('Fargo', now, { tmdbId: 275 }), external('Fargo', now, { tmdbId: 60622, mediaKind: 'series' })],
    });
    expect(result.sampleSize).toBe(2);
    expect(result.externalSampleSize).toBe(2);
  });

  it('ne promeut pas un film via l’identifiant numérique d’un similaire de série', async () => {
    detailsMock.mockImplementation(async (id: number, kind) => kind === 'tv'
      ? details(id, {
        title: 'Série vue',
        releaseDate: '2010-01-01',
        similar: [{ id: 700, title: 'Une autre série', releaseDate: '', posterPath: null, voteAverage: 0 }],
      })
      : details(id, { title: 'Un film sans rapport', releaseDate: '1965-01-01' }));
    const candidate = item('c', 'Un film sans rapport', 700);
    const result = await enrichRecommendations({
      history: [], movies: [candidate], candidates: [candidate], playlistId: '1', apiKey: 'clé',
      external: [external('Série vue', now, { tmdbId: 100, mediaKind: 'series' })],
    });
    expect(result.profile.similar.has('tv:700')).toBe(true);
    const match = matchTaste(result.profile, result.detailsByItemId.get('c')!);
    expect(match.score).toBe(0);
    expect(match.reasons).toEqual([]);
  });
});
