import { describe, it, expect } from 'vitest';
import { recommendForHistory } from '@/utils/recommendations';
import { buildTasteProfile } from '@/utils/tasteProfile';
import { externalSeeds } from '@/utils/externalWatch';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { CatalogItem } from '@/utils/xtreamCatalog';
import type { TmdbDetails } from '@/utils/tmdb';

const now = 1_700_000_000_000;

const item = (id: string, name: string, categoryId: string): CatalogItem => ({
  id, name, categoryId, poster: '', extension: 'mp4', rating: '',
});

const watched = (name: string, categoryId: string, ts = now): PlayHistoryEntry => ({
  channelId: `vod:1:movie:${name}`, ts, status: 'completed', kind: 'vod', name, categoryId,
});

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

const profile = buildTasteProfile([{
  ts: now,
  details: details({
    id: 500,
    title: 'Inception',
    genres: ['Thriller'],
    director: 'Christopher Nolan',
    similar: [{ id: 99, title: 'Interstellar', releaseDate: '2014-11-05', posterPath: null, voteAverage: 8.4 }],
  }),
}], now);

describe('justifications sans TMDB', () => {
  it('explique la similarité de titre par le film vu qui pèse le plus', () => {
    const recs = recommendForHistory(
      [watched('Fast and Furious 10', '12')],
      [item('1', 'Fast and Furious 8', '12')],
      { playlistId: '1', nowMs: now },
    );
    expect(recs[0].reasons[0]).toBe('Proche de « Fast and Furious 10 »');
  });

  it('explique le rapprochement de catégorie seul', () => {
    const recs = recommendForHistory(
      [watched('Film vu', '12')],
      [item('1', 'Titre sans mot commun', '12')],
      { playlistId: '1', nowMs: now },
    );
    expect(recs[0].reasons).toEqual(['Même catégorie que « Film vu »']);
  });

  it('nettoie les tags de qualité dans le libellé', () => {
    const recs = recommendForHistory(
      [watched('Les Évadés FRENCH 1080p', '12')],
      [item('1', 'Les Évadés 2', '12')],
      { playlistId: '1', nowMs: now },
    );
    expect(recs[0].reasons[0]).toBe('Proche de « Les Évadés »');
  });
});

describe('reclassement par le profil de goût', () => {
  const items = [item('1', 'Saga Royale 2', '12'), item('2', 'Film Different', '12')];
  const history = [watched('Saga Royale', '12')];

  it('sans profil, le titre proche garde la tête', () => {
    const recs = recommendForHistory(history, items, { playlistId: '1', nowMs: now });
    expect(recs.map(r => r.item.id)).toEqual(['1', '2']);
  });

  it('fait remonter un candidat expliqué par les genres, la réalisation et les similaires TMDB', () => {
    const detailsByItemId = new Map([
      ['2', details({ id: 99, genres: ['Thriller'], director: 'Christopher Nolan', releaseDate: '2014-11-05' })],
    ]);
    const recs = recommendForHistory(history, items, { playlistId: '1', nowMs: now, profile, detailsByItemId });
    expect(recs[0]?.item.id).toBe('2');
    expect(recs[0]?.reasons[0]).toBe('Proche de « Inception »');
    // La justification locale du second titre est conservée, sans doublon.
    expect(recs[1]?.item.id).toBe('1');
    expect(recs[1]?.reasons[0]).toBe('Proche de « Saga Royale »');
  });

  it('borne les justifications à deux et retombe sur le local si la fiche manque', () => {
    const detailsByItemId = new Map([
      ['2', details({ id: 99, genres: ['Thriller'], director: 'Christopher Nolan', cast: [{ name: 'Tom Hardy' }], releaseDate: '2014-11-05' })],
    ]);
    const recs = recommendForHistory(history, items, { playlistId: '1', nowMs: now, profile, detailsByItemId });
    expect(recs[0]?.reasons.length).toBeLessThanOrEqual(2);
    expect(recs[1]?.reasons).toEqual(['Proche de « Saga Royale »']);
  });

  it('ignore un profil sans fiche et reste déterministe', () => {
    const empty = buildTasteProfile([], now);
    const detailsByItemId = new Map([['1', details({ id: 1 })]]);
    const first = recommendForHistory(history, items, { playlistId: '1', nowMs: now, profile: empty, detailsByItemId });
    const second = recommendForHistory(history, items, { playlistId: '1', nowMs: now, profile: empty, detailsByItemId });
    expect(first.map(r => [r.item.id, r.score])).toEqual(second.map(r => [r.item.id, r.score]));
    expect(first.map(r => r.item.id)).toEqual(['1', '2']);
  });
});

describe('amorces « Vu ailleurs »', () => {
  it('fait apparaître un rail depuis un film vu sur Netflix, sans historique local', () => {
    const catalogue = [item('1', 'Inception', '12'), item('2', 'Interstellar', '12'), item('3', 'Comédie', '25')];
    const seeds = externalSeeds([{
      channelId: 'elsewhere:netflix:movie:inception', ts: now, kind: 'vod', mediaKind: 'movie',
      name: 'Inception', status: 'completed', platform: 'netflix',
    }], catalogue, '1');
    const recs = recommendForHistory(seeds, catalogue, { playlistId: '1', nowMs: now });
    expect(recs.map(rec => rec.item.id)).toEqual(['2']);
    expect(recs[0].reasons).toEqual(['Même catégorie que « Inception »']);
  });
});
