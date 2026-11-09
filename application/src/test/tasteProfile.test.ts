import { describe, it, expect } from 'vitest';
import { buildTasteProfile, decadeOf, matchTaste, TASTE_HALF_LIFE_MS } from '@/utils/tasteProfile';
import type { TmdbDetails } from '@/utils/tmdb';

const now = 1_700_000_000_000;

const details = (over: Partial<TmdbDetails> = {}): TmdbDetails => ({
  id: 1,
  title: 'Film source',
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

describe('decadeOf', () => {
  it('arrondit à la décennie et ignore les dates inexploitables', () => {
    expect(decadeOf('1994-09-12')).toBe('1990');
    expect(decadeOf('2021-01-01')).toBe('2020');
    expect(decadeOf('')).toBe('');
    expect(decadeOf('inconnue')).toBe('');
  });
});

describe('buildTasteProfile', () => {
  it('reste vide sans fiche TMDB exploitable', () => {
    const profile = buildTasteProfile([], now);
    expect(profile.sampleSize).toBe(0);
    expect(profile.genres.size).toBe(0);
    expect(matchTaste(profile, details({ genres: ['Thriller'] }))).toEqual({ score: 0, reasons: [] });
  });

  it('pondère les genres par la fraîcheur du visionnage', () => {
    const profile = buildTasteProfile([
      { ts: now, details: details({ id: 1, genres: ['Thriller'] }) },
      { ts: now - TASTE_HALF_LIFE_MS, details: details({ id: 2, genres: ['Comédie'] }) },
    ], now);
    expect(profile.sampleSize).toBe(2);
    expect(profile.genres.get('Thriller')).toBeCloseTo(1, 5);
    expect(profile.genres.get('Comédie')).toBeCloseTo(0.5, 5);
  });

  it('donne plus de poids au réalisateur qu’à un second rôle', () => {
    const profile = buildTasteProfile([
      {
        ts: now,
        details: details({
          director: 'Denis Villeneuve',
          cast: [{ name: 'Denis Villeneuve' }, { name: 'Timothée Chalamet' }, { name: 'Rebecca Ferguson' }],
        }),
      },
    ], now);
    const director = profile.people.get('Denis Villeneuve') ?? 0;
    const actor = profile.people.get('Timothée Chalamet') ?? 0;
    expect(director).toBeCloseTo(1, 5);
    expect(actor).toBeGreaterThan(0);
    expect(actor).toBeLessThan(director);
  });

  it('mémorise les films similaires avec leur titre d’origine', () => {
    const profile = buildTasteProfile([
      {
        ts: now,
        details: details({
          title: 'Inception',
          similar: [{ id: 27205, title: 'Interstellar', releaseDate: '2014-11-05', posterPath: null, voteAverage: 8.4 }],
        }),
      },
    ], now);
    expect(profile.similar.get('movie:27205')).toBe('Inception');
  });

  it('distingue les espaces de noms film/série dans les similaires', () => {
    const tvProfile = buildTasteProfile([
      {
        ts: now,
        details: details({
          id: 100,
          title: 'Série vue',
          kind: 'tv',
          releaseDate: '2010-01-01',
          similar: [{ id: 700, title: 'Une autre série', releaseDate: '', posterPath: null, voteAverage: 0 }],
        }),
      },
    ], now);
    expect(tvProfile.similar.has('tv:700')).toBe(true);
    expect(tvProfile.similar.has('movie:700')).toBe(false);
  });

  it('ignore une fiche sans identifiant (réponse TMDB vide)', () => {
    const profile = buildTasteProfile([{ ts: now, details: details({ id: 0, genres: ['Thriller'] }) }], now);
    expect(profile.sampleSize).toBe(0);
  });
});

describe('matchTaste', () => {
  const profile = buildTasteProfile([
    {
      ts: now,
      details: details({
        id: 10,
        title: 'Inception',
        genres: ['Thriller', 'Science-Fiction'],
        director: 'Christopher Nolan',
        cast: [{ name: 'Tom Hardy' }],
        releaseDate: '2010-07-16',
        similar: [{ id: 99, title: 'Interstellar', releaseDate: '2014-11-05', posterPath: null, voteAverage: 8.4 }],
      }),
    },
  ], now);

  it('justifie par le genre le plus proche du profil', () => {
    const match = matchTaste(profile, details({ id: 5, genres: ['Thriller'], releaseDate: '2001-01-01' }), 1);
    expect(match.reasons).toEqual(['Genre : Thriller']);
    expect(match.score).toBeGreaterThan(0);
  });

  it('place le rapprochement TMDB « similaire » en tête', () => {
    const match = matchTaste(profile, details({ id: 99, genres: ['Thriller'], director: 'Christopher Nolan' }));
    expect(match.reasons[0]).toBe('Proche de « Inception »');
    expect(match.score).toBeGreaterThan(2);
  });

  it('reconnaît un réalisateur apprécié même absent du casting', () => {
    const match = matchTaste(profile, details({ id: 6, director: 'Christopher Nolan' }), 1);
    expect(match.reasons).toEqual(['Réalisé par Christopher Nolan']);
  });

  it('nomme un comédien apprécié quand le réalisateur est inconnu', () => {
    const match = matchTaste(profile, details({ id: 7, cast: [{ name: 'Tom Hardy' }] }), 1);
    expect(match.reasons).toEqual(['Avec Tom Hardy']);
  });

  it('cite la décennie en dernier recours et respecte la limite', () => {
    const match = matchTaste(profile, details({ id: 8, genres: ['Thriller'], director: 'Christopher Nolan', cast: [{ name: 'Tom Hardy' }], releaseDate: '2015-01-01' }), 3);
    expect(match.reasons).toHaveLength(3);
    expect(match.reasons).toContain('Années 2010');
    expect(matchTaste(profile, details({ id: 9 }), 0).reasons).toEqual([]);
  });

  it('ne promeut pas un film par le seul identifiant numérique d’un similaire TV', () => {
    const tvProfile = buildTasteProfile([
      {
        ts: now,
        details: details({
          id: 100,
          title: 'Série vue',
          kind: 'tv',
          releaseDate: '2010-01-01',
          similar: [{ id: 700, title: 'Une autre série', releaseDate: '', posterPath: null, voteAverage: 0 }],
        }),
      },
    ], now);
    expect(matchTaste(tvProfile, details({ id: 700, title: 'Un film sans rapport', releaseDate: '1965-01-01' }))).toEqual({ score: 0, reasons: [] });
    expect(matchTaste(tvProfile, details({ id: 700, kind: 'tv', title: 'La série correspondante' })).reasons[0]).toBe('Proche de « Série vue »');
  });
});
