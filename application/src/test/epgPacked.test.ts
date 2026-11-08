import { expect, it } from 'vitest';
import { packEPGData, unpackEPGData } from '@/utils/epgPacked';
import { buildMergedEPGData, parseXmltv } from '@/utils/epgXmltv';
import type { Channel } from '@/types/channel';

it('préserve les associations, les sources, les décalages et la fenêtre du parser existant', () => {
  const xml = `<tv><channel id="a"><display-name>Émission A</display-name></channel>
    <programme channel="a" start="20261108080000 +0100" stop="20261108090000 +0100"><title>Ancien</title></programme>
    <programme channel="a" start="20261108120000 +0100" stop="20261108130000 +0100"><title><![CDATA[Titre &amp; détails]]></title><desc>Résumé partagé</desc><category>Info</category></programme></tv>`;
  const secondary = `<tv><programme channel="manual" start="20261108110000 +0000" stop="20261108120000 +0000"><title>Autre source</title></programme></tv>`;
  const channels: Channel[] = [
    { id: 'direct', name: 'Direct', tvgId: 'a', url: 'https://example.test/a' },
    { id: 'name', name: 'FR: Emission A', url: 'https://example.test/b' },
    { id: 'shift', name: 'Décalée', tvgId: 'a', tvgShift: 1, url: 'https://example.test/c' },
    { id: 'override', name: 'Forcée', tvgId: 'a', url: 'https://example.test/d' },
  ];
  const data = buildMergedEPGData([parseXmltv(xml), parseXmltv(secondary)], channels, {
    overrides: { override: { xmltvId: 'manual', shift: -1 } }, offsetHours: 1,
    keepFromMs: Date.UTC(2026, 10, 8, 10), keepUntilMs: Date.UTC(2026, 10, 8, 15),
  });
  const decoded = unpackEPGData(structuredClone(packEPGData(data)));
  expect(decoded).toEqual(data);
  expect(decoded.direct).toHaveLength(1);
  expect(decoded.name[0].title).toBe('Titre & détails');
  expect(decoded.override[0].title).toBe('Autre source');
  expect(decoded.shift[0].startTime.getTime() - decoded.direct[0].startTime.getTime()).toBe(3_600_000);
});

it('ne répète pas les textes dans le message cloné et réutilise les dates identiques', () => {
  const start = Date.UTC(2026, 10, 8);
  const data = { a: Array.from({ length: 100 }, (_, i) => ({
    id: `a_${start + i * 1000}`, channelId: 'a', title: 'Titre', description: 'Résumé'.repeat(100),
    startTime: new Date(start + i * 1000), endTime: new Date(start + (i + 1) * 1000),
  })) };
  const packed = packEPGData(data);
  expect(packed.strings).toEqual(['Titre', 'Résumé'.repeat(100)]);
  const transfer = Object.values(packed.channels).map(rows => rows.buffer);
  const received = structuredClone(packed, { transfer });
  expect(packed.channels.a.byteLength).toBe(0);
  const decoded = unpackEPGData(received);
  expect(decoded).toEqual(data);
  expect(decoded.a[0].endTime).toBe(decoded.a[1].startTime);
});

it('refuse les versions, tailles, indices et dates corrompus au lieu de produire un faux guide', () => {
  expect(() => unpackEPGData({ format: 'cedplay-epg-packed', version: 2, strings: [], channels: {} })).toThrow();
  expect(() => unpackEPGData({ format: 'cedplay-epg-packed', version: 1, strings: [], channels: { a: new Float64Array(1) } })).toThrow();
  const corrupt = (index: number, value: number) => {
    const packed = packEPGData({ a: [{ id: 'a_0', channelId: 'a', title: 'Titre', startTime: new Date(0), endTime: new Date(1000) }] });
    packed.channels.a[index] = value;
    return packed;
  };
  expect(() => unpackEPGData(corrupt(2, 100))).toThrow();
  expect(() => unpackEPGData(corrupt(3, -2))).toThrow();
  expect(() => unpackEPGData(corrupt(0, Infinity))).toThrow();
});
