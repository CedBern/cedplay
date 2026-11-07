import { describe, expect, it } from 'vitest';
import { formatFileSize, parseLocalFilename } from '@/utils/localLibrary';

describe('parseLocalFilename', () => {
  it('extrait le titre et l’année entre parenthèses', () => {
    expect(parseLocalFilename('Inception (2010).mkv')).toEqual({ title: 'Inception', year: '2010' });
    expect(parseLocalFilename('Les Tuche 3 (2018) 2160p.mkv')).toEqual({ title: 'Les Tuche 3', year: '2018' });
  });

  it('retire les balises de qualité et les séparateurs « release »', () => {
    expect(parseLocalFilename('Les.Tuche.3.Liberte.2018.2160p.mkv')).toEqual({ title: 'Les Tuche 3 Liberte', year: '2018' });
    expect(parseLocalFilename('Film sans année.mp4')).toEqual({ title: 'Film sans année', year: '' });
  });
});

describe('formatFileSize', () => {
  it('renvoie une chaîne vide pour une taille nulle', () => {
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(-1)).toBe('');
  });

  it('convertit en unités lisibles', () => {
    expect(formatFileSize(500)).toBe('500 o');
    expect(formatFileSize(1024)).toBe('1.0 Ko');
    expect(formatFileSize(2_000_000)).toBe('1.9 Mo');
    expect(formatFileSize(5 * 1024 ** 3)).toBe('5.0 Go');
  });
});
