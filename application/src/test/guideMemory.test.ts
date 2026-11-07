import { expect, it } from 'vitest';
import { buildEPGData, type XmltvParsed } from '@/utils/epgXmltv';
import { epgMemoryStats } from '@/utils/epgStats';

const H = 3_600_000;
const now = Date.UTC(2026, 10, 6, 12);
const prog = (fromH: number, toH: number, title: string) => ({ channel: 'tf1', start: new Date(now + fromH * H), stop: new Date(now + toH * H), title });
const parsed: XmltvParsed = {
  channels: [{ id: 'tf1', displayNames: ['TF1'] }],
  programmes: [prog(-24 * 10, -24 * 10 + 1, 'Trop ancien'), prog(-1, 1, 'En cours'), prog(24 * 9, 24 * 9 + 1, 'Dans 9 jours'), prog(24 * 12, 24 * 12 + 1, 'Trop loin')],
};

it('ne garde en mémoire que la fenêtre utile du guide', () => {
  const data = buildEPGData(parsed, [{ id: 'c1', name: 'TF1', url: 'http://h.test/1', tvgId: 'tf1' }], { keepFromMs: now - 8 * 24 * H, keepUntilMs: now + 10 * 24 * H });
  expect(data.c1!.map(p => p.title)).toEqual(['En cours', 'Dans 9 jours']);
  // Sans fenêtre : tout est gardé, comme avant.
  expect(buildEPGData(parsed, [{ id: 'c1', name: 'TF1', url: 'http://h.test/1', tvgId: 'tf1' }]).c1).toHaveLength(4);
});

it('mesure le guide chargé (chaînes, programmes, taille estimée)', () => {
  const data = buildEPGData(parsed, [{ id: 'c1', name: 'TF1', url: 'http://h.test/1', tvgId: 'tf1' }]);
  const stats = epgMemoryStats(data);
  expect(stats.channels).toBe(1);
  expect(stats.programmes).toBe(4);
  expect(stats.estimatedBytes).toBeGreaterThan(4 * 160);
  expect(epgMemoryStats(null)).toEqual({ channels: 0, programmes: 0, estimatedBytes: 0 });
});
