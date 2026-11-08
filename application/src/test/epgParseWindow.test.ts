import { expect, it } from 'vitest';
import { parseXmltv } from '@/utils/epgXmltv';

const programme = (start: string, stop: string, title: string) =>
  `<programme channel="a" start="${start} +0000" stop="${stop} +0000"><title>${title}</title></programme>`;

const xml = `<tv>
  <channel id="a"><display-name>A</display-name></channel>
  ${programme('20200101120000', '20200101130000', 'Ancien')}
  ${programme('20261108120000', '20261108130000', 'Dans la fenêtre')}
  ${programme('20270101120000', '20270101130000', 'Lointain')}
</tv>`;

it('applique la fenêtre temporelle pendant la boucle d’analyse', () => {
  const from = Date.UTC(2026, 10, 7, 12);
  const until = Date.UTC(2026, 10, 9, 12);
  const parsed = parseXmltv(xml, { keepFromMs: from, keepUntilMs: until });
  // Les chaînes restent disponibles même quand leurs programmes sont hors fenêtre.
  expect(parsed.channels).toEqual([{ id: 'a', displayNames: ['A'] }]);
  expect(parsed.programmes.map(p => p.title)).toEqual(['Dans la fenêtre']);
});

it('conserve toute la fenêtre large de 48 h qui couvre les décalages', () => {
  // Un programme juste avant la borne peut entrer dans la fenêtre après tvg-shift.
  const from = Date.UTC(2026, 10, 7, 12);
  const until = Date.UTC(2026, 10, 9, 12);
  const shifted = `<tv>${programme('20261106130000', '20261106140000', 'Décalé')}</tv>`;
  expect(parseXmltv(shifted, { keepFromMs: from, keepUntilMs: until }).programmes).toHaveLength(1);
});

it('sans fenêtre, tous les programmes restent analysés', () => {
  expect(parseXmltv(xml).programmes).toHaveLength(3);
});
