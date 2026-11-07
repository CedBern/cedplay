import { describe, it, expect } from 'vitest';
import { recommendForHistory } from '@/utils/recommendations';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { CatalogItem } from '@/utils/xtreamCatalog';

const item = (id: string, name: string, categoryId: string): CatalogItem => ({
  id, name, categoryId, poster: '', extension: 'mp4', rating: '',
});

const now = 1_700_000_000_000;
const watched = (name: string, categoryId: string, ts = now): PlayHistoryEntry => ({
  channelId: `vod:1:movie:${name}`, ts, status: 'completed', kind: 'vod', name, categoryId,
});

describe('recommendForHistory', () => {
  it('ne recommande rien sans historique VOD', () => {
    expect(recommendForHistory([], [item('1', 'Film A', '12')], { playlistId: '1', nowMs: now })).toEqual([]);
    expect(recommendForHistory([{ channelId: 'ch1', ts: now }], [item('1', 'Film A', '12')], { playlistId: '1', nowMs: now })).toEqual([]);
  });

  it('classe par catégorie et similarité de titre, exclut le reste', () => {
    const items = [
      item('1', 'Fast and Furious 8', '12'),
      item('2', 'Fast and Furious 7', '12'),
      item('3', 'Fast X', '12'),
      item('4', 'Titanic', '99'),
    ];
    const history = [watched('Fast and Furious 10', '12')];
    const recs = recommendForHistory(history, items, { playlistId: '1', nowMs: now });
    expect(recs.map((r) => r.item.id)).toEqual(['1', '2', '3']);
    expect(recs[0].score).toBeGreaterThan(recs[2].score);
    // Titanic : autre catégorie et aucun mot commun → non recommandé
  });

  it('exclut le film terminé par son identité fournisseur', () => {
    const items = [item('1', 'Les Évadés FRENCH HD', '12'), item('2', 'Autre film', '12')];
    const recs = recommendForHistory([{ ...watched('Les évadés', '12'), channelId: 'vod:1:movie:1' }], items, { playlistId: '1', nowMs: now });
    expect(recs.map((r) => r.item.id)).toEqual(['2']);
  });

  it('pondère par la fraîcheur : un visionnage ancien pèse moins', () => {
    const items = [item('1', 'Fast and Furious 8', '12')];
    const recent = recommendForHistory([watched('Fast and Furious 10', '12', now)], items, { playlistId: '1', nowMs: now });
    const old = recommendForHistory([watched('Fast and Furious 10', '12', now - 60 * 24 * 3600 * 1000)], items, { playlistId: '1', nowMs: now });
    expect(recent[0].score).toBeGreaterThan(old[0].score);
  });

  it('respecte la limite demandée', () => {
    const items = Array.from({ length: 20 }, (_, i) => item(String(i), `Saga épisode ${i}`, '12'));
    const recs = recommendForHistory([watched('Saga origine', '12')], items, { playlistId: '1', nowMs: now, limit: 5 });
    expect(recs).toHaveLength(5);
  });
});

it('ignore séries, autres listes et simples tentatives de lancement', () => {
  const values = [item('1', 'Film inconnu', '7')];
  for (const entry of [
    { ...watched('Autre film', '7'), channelId: 'vod:autre:movie:42' },
    { ...watched('Une série', '7'), channelId: 'vod:1:series:42' },
    { ...watched('Un essai', '7'), status: 'started' as const, positionMs: 5000 },
  ]) expect(recommendForHistory([entry], values, { playlistId: '1', nowMs: now })).toEqual([]);
});

it('ne considère pas un remake ou un film commencé comme terminé', () => {
  const values = [item('1', 'Dune', '7'), item('2', 'Dune', '7')];
  const recs = recommendForHistory([{ ...watched('Dune', '7'), channelId: 'vod:1:movie:1' }], values, { playlistId: '1', nowMs: now });
  expect(recs.map(r => r.item.id)).toEqual(['2']);
  expect(recommendForHistory([{ ...watched('Dune', '7'), channelId: 'vod:1:movie:1', status: 'started', positionMs: 90000 }], values, { playlistId: '1', nowMs: now }).map(r => r.item.id)).toEqual(['1', '2']);
});
