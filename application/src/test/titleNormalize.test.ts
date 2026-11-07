import { describe, it, expect } from 'vitest';
import { normalizeForCompare, extractYear, stripQualityTags, normalizeTitle, titleSimilarity } from '@/utils/titleNormalize';

describe('normalizeForCompare', () => {
  it('retire les accents et la ponctuation', () => {
    expect(normalizeForCompare('Les Évadés !')).toBe('les evades');
    expect(normalizeForCompare('Là-haut, 3D')).toBe('la haut 3d');
  });
});

describe('extractYear', () => {
  it('trouve l’année entre parenthèses ou en fin de titre', () => {
    expect(extractYear('Film (2023) FRENCH HD')).toBe('2023');
    expect(extractYear('Film 1998')).toBe('1998');
    expect(extractYear('1917')).toBe('');
    expect(extractYear('Film sans année')).toBe('');
  });
});

describe('stripQualityTags + normalizeTitle', () => {
  it('retire les balises de qualité et l’année', () => {
    expect(stripQualityTags('Les Tuche 3 (2023) FRENCH 1080p WEB-DL')).toBe('Les Tuche 3');
    expect(stripQualityTags('Film 4K UHD TRUEFRENCH BluRay')).toBe('Film');
  });

  it('fournit titre propre + année pour TMDB', () => {
    expect(normalizeTitle('Avatar 2 (2022) MULTI 2160p')).toEqual({ title: 'Avatar 2', year: '2022' });
    expect(normalizeTitle('Intouchables FRENCH')).toEqual({ title: 'Intouchables', year: '' });
  });
});

describe('titleSimilarity', () => {
  it('compare par mots partagés', () => {
    expect(titleSimilarity('fast and furious 8', 'fast and furious 7')).toBeGreaterThan(0.5);
    expect(titleSimilarity('les tuche 3', 'les tuche 4')).toBeGreaterThan(0.5);
    expect(titleSimilarity('avatar', 'titanic')).toBe(0);
    expect(titleSimilarity('de', 'du')).toBe(0); // mots vides ignorés
  });
});

it('préserve les titres numériques et les sous-titres significatifs', () => {
  expect(normalizeTitle('1917 FRENCH HD')).toEqual({ title: '1917', year: '' });
  expect(normalizeTitle('2012 (2009) 1080p')).toEqual({ title: '2012', year: '2009' });
  expect(normalizeTitle('2001 : L’Odyssée de l’espace')).toEqual({ title: '2001 : L’Odyssée de l’espace', year: '' });
  expect(normalizeTitle('Birdman (The Unexpected Virtue of Ignorance) [HD]')).toEqual({ title: 'Birdman (The Unexpected Virtue of Ignorance)', year: '' });
});
