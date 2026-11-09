import { describe, expect, it } from 'vitest';
import { formatFileSize, localLibraryWorks, parseLocalFilename, parseLocalMediaName } from '@/utils/localLibrary';

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

describe('parseLocalMediaName', () => {
  it('ramène un épisode au titre de la série', () => {
    expect(parseLocalMediaName('Breaking.Bad.S01E02.1080p.mkv'))
      .toEqual({ title: 'Breaking Bad', year: '', kind: 'series' });
    expect(parseLocalMediaName('Kaamelott.1x02.mkv'))
      .toEqual({ title: 'Kaamelott', year: '', kind: 'series' });
    expect(parseLocalMediaName('Ma.Série.Saison.2.mkv'))
      .toEqual({ title: 'Ma Série', year: '', kind: 'series' });
  });

  it('laisse un film intact', () => {
    expect(parseLocalMediaName('Inception (2010).mkv')).toEqual({ title: 'Inception', year: '2010', kind: 'movie' });
  });
});

describe('localLibraryWorks', () => {
  it('dédoublonne les épisodes d’une série et garde la date la plus récente', () => {
    const works = localLibraryWorks([
      { name: 'Breaking.Bad.S01E01.mkv', lastModified: 100 },
      { name: 'Breaking.Bad.S01E02.mkv', lastModified: 200 },
      { name: 'Inception (2010).mkv', lastModified: 50 },
      { name: 'Sans extension', lastModified: 0 },
    ]);
    expect(works.map(work => [work.title, work.kind, work.lastModified])).toEqual([
      ['Breaking Bad', 'series', 200],
      ['Inception', 'movie', 50],
      ['Sans extension', 'movie', 0],
    ]);
  });

  it('borne le nombre d’œuvres indexées', () => {
    const files = Array.from({ length: 5 }, (_, index) => ({ name: `Film ${index}`, lastModified: index }));
    expect(localLibraryWorks(files, 3)).toHaveLength(3);
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
