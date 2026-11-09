// Bibliothèque locale (USB/SD) → amorces de « Pour toi » : un film possédé et
// présent au catalogue se comporte comme un visionnage récent.
import { describe, expect, it } from 'vitest';
import { externalSeeds } from '@/utils/externalWatch';
import { localLibraryWatches, localLibraryWorks } from '@/utils/localLibrary';
import { recommendForHistory } from '@/utils/recommendations';
import type { CatalogItem } from '@/utils/xtreamCatalog';

const now = 1_700_000_000_000;

const item = (id: string, name: string, categoryId = '12'): CatalogItem => ({
  id, name, categoryId, poster: '', extension: 'mp4', rating: '',
});

const catalogue = [
  item('1', 'Inception'),
  item('2', 'Interstellar'),
  item('3', 'Une comédie', '25'),
];

describe('bibliothèque locale → « Pour toi »', () => {
  it('un film USB présent au catalogue amorce le rail comme un visionnage', () => {
    const works = localLibraryWorks([{ name: 'Inception.2010.1080p.mkv', lastModified: 1 }]);
    expect(works).toEqual([{ title: 'Inception', year: '2010', kind: 'movie', lastModified: 1 }]);

    const seeds = externalSeeds(localLibraryWatches(works, now), catalogue, 'liste');
    expect(seeds.map(seed => seed.channelId)).toEqual(['vod:liste:movie:1']);

    const recs = recommendForHistory(seeds, catalogue, { playlistId: 'liste', nowMs: now });
    expect(recs.map(rec => rec.item.id)).toEqual(['2']);
    expect(recs[0]?.reasons).toEqual(['Même catégorie que « Inception »']);
  });

  it('une série locale ne peut pas amorcer un rail de films', () => {
    const works = localLibraryWorks([{ name: 'Breaking.Bad.S01E01.mkv', lastModified: 1 }]);
    expect(works[0]?.kind).toBe('series');
    expect(externalSeeds(localLibraryWatches(works, now), catalogue, 'liste')).toEqual([]);
  });
});
