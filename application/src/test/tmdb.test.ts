import { describe, it, expect } from 'vitest';
import { pickBestMatch, tmdbImageUrl, type TmdbSearchResult } from '@/utils/tmdb';

const result = (id: number, title: string): TmdbSearchResult => ({
  id, title, releaseDate: '2020-01-01', posterPath: null, voteAverage: 7, voteCount: 100,
});

describe('pickBestMatch', () => {
  it('préfère l’égalité exacte normalisée', () => {
    const results = [result(1, 'Les Tuche 3 : Liberté'), result(2, 'Les Tuche 3')];
    expect(pickBestMatch('Les Tuche 3', results)?.id).toBe(2);
  });

  it('refuse un titre seulement partiellement correspondant', () => {
    const results = [result(1, 'Les Tuche 3 : Liberté, Égalité, Fraterniche'), result(2, 'Autre film')];
    expect(pickBestMatch('Les Tuche 3', results)).toBeNull();
  });

  it('rejette les résultats sans rapport', () => {
    const results = [result(1, 'Titanic'), result(2, 'Avatar')];
    expect(pickBestMatch('Fast and Furious', results)).toBeNull();
  });

  it('gère une requête vide et une liste vide', () => {
    expect(pickBestMatch('', [result(1, 'Film')])).toBeNull();
    expect(pickBestMatch('Film', [])).toBeNull();
  });
});

describe('helpers TMDB', () => {
  it('construit l’URL d’image', () => {
    expect(tmdbImageUrl('/abc.jpg', 'w200')).toBe('https://image.tmdb.org/t/p/w200/abc.jpg');
    expect(tmdbImageUrl(null)).toBe('');
  });
});

it('refuse une suite, et distingue les remakes par année', () => {
  expect(pickBestMatch('Avatar', [result(1, 'Avatar 2')])).toBeNull();
  expect(pickBestMatch('Avatar', [result(1, 'Avatar : La Voie de l’eau')])).toBeNull();
  const films = [{ ...result(1, 'Dune'), releaseDate: '1984-12-14' }, { ...result(2, 'Dune'), releaseDate: '2021-09-15' }];
  expect(pickBestMatch('Dune', films)).toBeNull();
  expect(pickBestMatch('Dune', films, '2021')?.id).toBe(2);
  expect(pickBestMatch('Dune', films, '2000')).toBeNull();
});
