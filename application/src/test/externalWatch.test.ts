import { describe, it, expect } from 'vitest';
import {
  cleanWatchTitle, externalSeeds, externalSummary, MAX_EXTERNAL_SEEDS, mergeExternalWatches,
  parseWatchDate, parseWatchImport, platformLabel, splitCsvRows, watchPlatformId,
} from '@/utils/externalWatch';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { CatalogItem } from '@/utils/xtreamCatalog';

const DAY = 24 * 3600 * 1000;

const item = (id: string, name: string, categoryId = '12', tmdbId?: number): CatalogItem => ({
  id, name, categoryId, poster: '', extension: 'mp4', rating: '',
  ...(tmdbId ? { tmdbId } : {}),
});

const watch = (name: string, ts: number, over: Partial<PlayHistoryEntry> = {}): PlayHistoryEntry => ({
  channelId: `elsewhere:netflix:movie:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  ts, kind: 'vod', mediaKind: 'movie', name, status: 'completed', platform: 'netflix',
  ...over,
});

describe('parseWatchDate', () => {
  it('lit l’ISO, l’américain, l’européen non ambigu et l’année seule', () => {
    expect(parseWatchDate('2023-04-12')).toBe(Date.UTC(2023, 3, 12, 12));
    expect(parseWatchDate('4/12/23')).toBe(Date.UTC(2023, 3, 12, 12));
    expect(parseWatchDate('25/12/2023')).toBe(Date.UTC(2023, 11, 25, 12));
    expect(parseWatchDate('2010')).toBe(Date.UTC(2010, 6, 1, 12));
    expect(parseWatchDate('pas une date')).toBeNull();
    expect(parseWatchDate('45/45/2023')).toBeNull();
  });

  it('refuse une date ISO impossible au lieu de la décaler', () => {
    expect(parseWatchDate('2023-02-31')).toBeNull();
    expect(parseWatchDate('2023-04-31')).toBeNull();
  });

  it('lit le pointé comme JJ.MM.AAAA (contrat documenté)', () => {
    expect(parseWatchDate('05.04.2023')).toBe(Date.UTC(2023, 3, 5, 12));
    expect(parseWatchDate('31.12.2023')).toBe(Date.UTC(2023, 11, 31, 12));
    expect(parseWatchDate('31.12.23')).toBe(Date.UTC(2023, 11, 31, 12));
  });
});

describe('cleanWatchTitle', () => {
  it('retire le préfixe Takeout, les tags de qualité et l’épisode', () => {
    expect(cleanWatchTitle('Watched Inception')).toEqual({ title: 'Inception', series: false });
    expect(cleanWatchTitle('A regardé Le Fabuleux Destin d’Amélie Poulain')).toEqual({ title: 'Le Fabuleux Destin d’Amélie Poulain', series: false });
    expect(cleanWatchTitle('Les Évadés FRENCH 1080p')).toEqual({ title: 'Les Évadés', series: false });
    expect(cleanWatchTitle('The Office: Season 1: Episode 1')).toEqual({ title: 'The Office', series: true });
    expect(cleanWatchTitle('The Crown: Saison 3')).toEqual({ title: 'The Crown', series: true });
  });
});

describe('splitCsvRows', () => {
  it('gère guillemets, virgules internes et CRLF', () => {
    const rows = splitCsvRows('Title,Date\r\n"Hello, My Name Is Doris",5/1/22\r\n"Un ""titre"" cité",6/2/22');
    expect(rows).toEqual([
      ['Title', 'Date'],
      ['Hello, My Name Is Doris', '5/1/22'],
      ['Un "titre" cité', '6/2/22'],
    ]);
  });
});

describe('parseWatchImport — CSV', () => {
  it('lit un export Netflix (Title,Date) et signale la plateforme', () => {
    const result = parseWatchImport('Title,Date\r\n"Inception",4/12/23\r\n"Les Évadés",5/1/22', { platform: 'netflix' });
    expect(result.format).toBe('csv');
    expect(result.entries.map(entry => entry.name)).toEqual(['Inception', 'Les Évadés']);
    expect(result.entries[0]).toMatchObject({ platform: 'netflix', mediaKind: 'movie', status: 'completed', kind: 'vod' });
    expect(result.entries[0].channelId).toMatch(/^elsewhere:netflix:movie:/);
  });

  it('ramène un épisode Netflix à sa série', () => {
    const result = parseWatchImport('Title,Date\n"The Office: Season 1: Episode 1",1/2/22', { platform: 'netflix' });
    expect(result.entries[0]).toMatchObject({ name: 'The Office', mediaKind: 'series' });
  });

  it('accepte un CSV sans en-tête reconnu (deux colonnes)', () => {
    const result = parseWatchImport('Inception,2023-04-12');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('Inception');
  });

  it('lit un CSV générique pointé-virgule avec années, plateformes et identifiant TMDB', () => {
    const csv = [
      'Titre;Année;Date;Plateforme;tmdb_id;Type',
      'Inception;2010;2023-04-12;Prime Video;27205;film',
      'The Bear;2022;2023-05-01;Disney+;136315;serie',
    ].join('\n');
    const result = parseWatchImport(csv);
    const inception = result.entries.find(entry => entry.name === 'Inception');
    expect(inception).toMatchObject({ year: '2010', platform: 'prime', tmdbId: 27205, mediaKind: 'movie' });
    // Le plus récent d'abord.
    expect(result.entries.map(entry => entry.name)).toEqual(['The Bear', 'Inception']);
    expect(result.entries[0]).toMatchObject({ mediaKind: 'series' });
  });

  it('compte les lignes sans date exploitable au lieu de les inventer', () => {
    const result = parseWatchImport('Title,Date\nInception,unknown\nLes Évadés,2023-01-02');
    expect(result.entries).toHaveLength(1);
    expect(result.undated).toBe(1);
  });

  it('rejette un fichier vide ou sans aucun visionnage', () => {
    expect(() => parseWatchImport('   ')).toThrow(/vide/);
    expect(() => parseWatchImport('Title,Date\nInception,unknown')).toThrow(/Aucune date/);
  });
});

describe('parseWatchImport — JSON', () => {
  it('lit un Takeout YouTube et ignore musique et publicités', () => {
    const takeout = JSON.stringify([
      { header: 'YouTube', title: 'Watched Inception', titleUrl: 'https://youtu.be/x', time: '2023-04-12T10:00:00.000Z' },
      { header: 'YouTube Music', title: 'Watched Une chanson', time: '2023-04-11T10:00:00.000Z' },
      { header: 'YouTube', title: 'Watched une pub', time: '2023-04-10T10:00:00.000Z', details: [{ name: 'From Google Ads' }] },
    ]);
    const result = parseWatchImport(takeout);
    expect(result.format).toBe('json');
    expect(result.entries.map(entry => entry.name)).toEqual(['Inception']);
    expect(result.entries[0]).toMatchObject({ platform: 'youtube' });
  });

  it('lit un JSON générique avec watchedAt et tmdbId', () => {
    const payload = JSON.stringify({ items: [
      { title: 'Interstellar', year: 2014, watchedAt: '2023-03-01', platform: 'Prime Video', tmdbId: 157336 },
    ] });
    const result = parseWatchImport(payload);
    expect(result.entries[0]).toMatchObject({ name: 'Interstellar', year: '2014', platform: 'prime', tmdbId: 157336 });
  });

  it('fusionne les doublons internes en gardant le visionnage le plus récent', () => {
    const payload = JSON.stringify([
      { title: 'Dune', date: '2022-01-01', platform: 'netflix' },
      { title: 'Dune', date: '2023-06-01', platform: 'prime' },
    ]);
    const result = parseWatchImport(payload);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].platform).toBe('prime');
    expect(result.duplicates).toBe(1);
  });

  it('fusionne dès le parseur une même série dont le type est tantôt inféré, tantôt explicite', () => {
    const result = parseWatchImport(JSON.stringify([
      { title: 'The Office: Season 1: Episode 1', date: '2023-04-12' },
      { title: 'The Office', type: 'series', date: '2024-04-12' },
    ]));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ name: 'The Office', mediaKind: 'series' });
    expect(result.duplicates).toBe(1);
  });

  it('refuse un JSON illisible', () => {
    expect(() => parseWatchImport('[{"title":')).toThrow(/illisible/);
  });
});

describe('mergeExternalWatches', () => {
  it('dédoublonne entre plateformes et garde le visionnage le plus récent', () => {
    const merged = mergeExternalWatches(
      [watch('Inception', 1000, { platform: 'netflix' })],
      [watch('Inception', 5000, { platform: 'prime' }), watch('Dune', 2000, { platform: 'prime' })],
    );
    expect(merged.map(entry => entry.name)).toEqual(['Inception', 'Dune']);
    expect(merged[0].platform).toBe('prime');
    expect(merged[0].ts).toBe(5000);
  });

  it('plafonne le total aux visionnages les plus récents', () => {
    const many = Array.from({ length: 5 }, (_, index) => watch(`Film ${index}`, 1000 + index * DAY));
    expect(mergeExternalWatches([], many, 3).map(entry => entry.name)).toEqual(['Film 4', 'Film 3', 'Film 2']);
  });
});

describe('externalSeeds', () => {
  const catalogue = [
    item('1', 'Inception', '12', 27205),
    item('2', 'Dune', '12'),
    item('3', 'Fargo', '12'),
    item('4', 'Fargo (1996)', '12'),
  ];

  it('joint par identifiant TMDB puis par titre exact', () => {
    const seeds = externalSeeds([
      watch('Un titre traduit', 3000, { tmdbId: 27205 }),
      watch('Dune', 2000),
    ], catalogue, 'liste');
    expect(seeds.map(seed => seed.channelId)).toEqual(['vod:liste:movie:1', 'vod:liste:movie:2']);
    expect(seeds[0]).toMatchObject({ status: 'completed', mediaKind: 'movie', categoryId: '12', tmdbId: 27205 });
  });

  it('ignore les séries et les titres ambigus', () => {
    const seeds = externalSeeds([
      watch('The Office', 3000, { mediaKind: 'series' }),
      watch('Fargo', 2000),
    ], catalogue, 'liste');
    expect(seeds).toEqual([]);
  });

  it('retrouve un troisième homonyme identifiable par son année', () => {
    const homonymes = [item('1', 'Film (1970)'), item('2', 'Film (1990)'), item('3', 'Film (2020)')];
    const seeds = externalSeeds([watch('Film', 1000, { year: '2020' })], homonymes, 'liste');
    expect(seeds.map(seed => seed.channelId)).toEqual(['vod:liste:movie:3']);
  });

  it('privilégie un titre unique et borne le nombre d’amorces', () => {
    const many = Array.from({ length: MAX_EXTERNAL_SEEDS + 10 }, (_, index) => watch(`Inconnu ${index}`, 1000 + index));
    expect(externalSeeds([...many, watch('Dune', 9000)], [item('2', 'Dune')], 'liste')).toHaveLength(1);
  });
});

describe('externalSummary', () => {
  it('résume volume, films et plateformes', () => {
    const summary = externalSummary([
      watch('Inception', 1000, { platform: 'netflix' }),
      watch('Dune', 2000, { platform: 'netflix' }),
      watch('The Office', 3000, { platform: 'netflix', mediaKind: 'series' }),
    ]);
    expect(summary).toBe('3 visionnages ailleurs (2 films) · Netflix 3');
  });

  it('reconnaît le libellé commercial écrit dans la colonne plateforme', () => {
    const result = parseWatchImport('Title,Date,Platform\nInception,2023-04-12,Prime Video');
    expect(externalSummary(result.entries)).toContain('Prime Video 1');
  });

  it('regroupe un ancien libellé et son identifiant sur la même plateforme', () => {
    const summary = externalSummary([
      watch('Inception', 1000, { platform: 'prime video' }),
      watch('Dune', 2000, { platform: 'prime' }),
    ]);
    expect(summary).toBe('2 visionnages ailleurs (2 films) · Prime Video 2');
  });
});

describe('watchPlatformId', () => {
  it('ramène identifiants et libellés au même identifiant', () => {
    expect(watchPlatformId('Prime Video')).toBe('prime');
    expect(watchPlatformId('Amazon Prime Video')).toBe('prime');
    expect(watchPlatformId('Amazon Prime')).toBe('prime');
    expect(watchPlatformId('Disney+')).toBe('disney');
    expect(watchPlatformId('HBO Max')).toBe('hbo');
    expect(watchPlatformId('YouTube Premium')).toBe('youtube');
    expect(watchPlatformId('netflix')).toBe('netflix');
    expect(watchPlatformId('')).toBeUndefined();
  });

  it('laisse intact un libellé inconnu plutôt que de l’inventer', () => {
    expect(watchPlatformId('MyCinema')).toBe('mycinema');
    expect(platformLabel('mycinema')).toBe('Autre');
    expect(platformLabel('prime video')).toBe('Prime Video');
  });
});
