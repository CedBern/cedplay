import { describe, expect, it, vi } from 'vitest';
import { M3UParser } from '@/utils/m3uParser';
import { fillCatchupTemplate, hasM3UCatchup, m3uCatchupDays, m3uCatchupUrl } from '@/utils/m3uCatchup';
import { buildEPGData, buildMergedEPGData, listXmltvChannels, parseXmltv } from '@/utils/epgXmltv';
import { searchPrograms } from '@/utils/epgSearch';
import { findScheduled, recordingWindow, seriesKey } from '@/utils/recordingRules';
import type { Channel } from '@/types/channel';

vi.mock('@/utils/nativePlayer', () => ({ RecordingsBridge: { isAvailable: () => false } }));

const start = new Date(Date.UTC(2026, 10, 6, 20, 0, 0));
const end = new Date(Date.UTC(2026, 10, 6, 21, 30, 0));
const now = new Date(Date.UTC(2026, 10, 7, 9, 0, 0));
const s = (d: Date) => Math.floor(d.getTime() / 1000);
const ch = (over: Partial<Channel>): Channel => ({ id: 'c', name: 'Chaîne', url: 'http://h.test/live/u/p/42.ts', ...over });

describe('liste M3U : en-tête et attributs du replay', () => {
  const m3u = [
    '#EXTM3U url-tvg="http://epg.test/a.xml.gz,http://epg.test/b.xml" catchup="shift" catchup-days="3" tvg-shift="+1"',
    '#EXTINF:-1 tvg-id="tf1.fr" catchup="default" catchup-source="http://h.test/arch/{utc}-{duration}.ts" catchup-days="7" tvg-logo="http://l.test/x.png",TF1',
    'http://h.test/tf1.ts',
    '#EXTINF:-1 tvg-id="m6.fr" tvg-shift="-2",M6',
    'http://h.test/m6.ts',
    '#EXTINF:-1 tvg-id="arte.fr" catchup="disabled",Arte',
    'http://h.test/arte.ts',
  ].join('\n');

  it('lit les guides de l’en-tête et applique ses valeurs par défaut aux chaînes', () => {
    const playlist = M3UParser.parseM3U(m3u, 'Test');
    expect(playlist.epgUrls).toEqual(['http://epg.test/a.xml.gz', 'http://epg.test/b.xml']);
    const [tf1, m6, arte] = ['tf1.fr', 'm6.fr', 'arte.fr'].map(id => playlist.channels.find(c => c.tvgId === id)!);
    expect(tf1).toMatchObject({ catchup: 'default', catchupSource: 'http://h.test/arch/{utc}-{duration}.ts', catchupDays: 7, tvgShift: 1, logo: 'http://l.test/x.png' });
    expect(m6).toMatchObject({ catchup: 'shift', catchupDays: 3, tvgShift: -2 });
    expect(arte.catchup).toBeUndefined();
  });

  it('ne confond pas catchup et catchup-source, ni logo et tvg-logo', async () => {
    const playlist = await M3UParser.parseM3UWithProgress('#EXTM3U\n#EXTINF:-1 catchup-source="?a=1" logo="http://l.test/b.png" catchup="append",X\nhttp://h.test/x.m3u8', 'T');
    expect(playlist.channels[0]).toMatchObject({ catchup: 'append', catchupSource: '?a=1', logo: 'http://l.test/b.png', catchupDays: 5 });
  });
});

describe('replay M3U : adresses', () => {
  it('remplace les variables du modèle', () => {
    const url = fillCatchupTemplate('x?s={utc}&e=${end}&n={lutc}&d={duration}&m={duration:60}&o={offset:1}&f={utc:Y-m-d}', start, end, now);
    expect(url).toBe(`x?s=${s(start)}&e=${s(end)}&n=${s(now)}&d=5400&m=90&o=${s(now) - s(start)}&f=${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`);
  });

  it('gère default, append, shift, flussonic et xc', () => {
    expect(m3uCatchupUrl(ch({ catchup: 'default', catchupSource: 'http://h.test/a/{utc}.ts', catchupDays: 2 }), start, end, now)).toBe(`http://h.test/a/${s(start)}.ts`);
    expect(m3uCatchupUrl(ch({ url: 'http://h.test/live.m3u8?t=1', catchup: 'append', catchupSource: '&from={utc}', catchupDays: 2 }), start, end, now)).toBe(`http://h.test/live.m3u8?t=1&from=${s(start)}`);
    expect(m3uCatchupUrl(ch({ url: 'http://h.test/live.ts', catchup: 'shift', catchupDays: 2 }), start, end, now)).toBe(`http://h.test/live.ts?utc=${s(start)}&lutc=${s(now)}`);
    expect(m3uCatchupUrl(ch({ url: 'http://f.test/tf1/index.m3u8?token=a', catchup: 'flussonic', catchupDays: 2 }), start, end, now)).toBe(`http://f.test/tf1/index-${s(start)}-5400.m3u8?token=a`);
    expect(m3uCatchupUrl(ch({ url: 'http://f.test/tf1/mpegts', catchup: 'fs', catchupDays: 2 }), start, end, now)).toBe(`http://f.test/tf1/archive-${s(start)}-5400.ts`);
    const xc = m3uCatchupUrl(ch({ catchup: 'xc', catchupDays: 2 }), start, end, now)!;
    expect(xc).toMatch(/^http:\/\/h\.test\/timeshift\/u\/p\/90\/\d{4}-\d{2}-\d{2}:\d{2}-\d{2}\/42\.ts$/);
  });

  it('ignore une chaîne sans modèle exploitable', () => {
    const channel = ch({ catchup: 'default', catchupDays: 3 });
    expect(hasM3UCatchup(channel)).toBe(false);
    expect(m3uCatchupDays(channel)).toBe(0);
    expect(m3uCatchupUrl(channel, start, end, now)).toBeNull();
    expect(m3uCatchupDays(ch({ catchup: 'shift', catchupDays: 4 }))).toBe(4);
  });
});

const xmlA = `<tv><channel id="tf1"><display-name>TF1</display-name></channel>
<programme channel="tf1" start="20261106200000 +0000" stop="20261106210000 +0000"><title>Journal</title></programme></tv>`;
const xmlB = `<tv><channel id="tf1.b"><display-name>TF1</display-name></channel><channel id="m6.b"><display-name>M6 HD</display-name></channel>
<programme channel="tf1.b" start="20261106200000 +0000" stop="20261106203000 +0000"><title>Autre</title></programme>
<programme channel="m6.b" start="20261106200000 +0000" stop="20261106220000 +0000"><title>Film &amp; Co</title><desc>Un film policier.</desc></programme></tv>`;

describe('guide : fusion, association et décalage', () => {
  const tf1 = ch({ id: 'tf1', name: 'TF1', tvgId: 'tf1' });
  const m6 = ch({ id: 'm6', name: 'M6' });

  it('fusionne : la première source qui a des programmes l’emporte', () => {
    const data = buildMergedEPGData([parseXmltv(xmlA), parseXmltv(xmlB)], [tf1, m6]);
    expect(data.tf1.map(p => p.title)).toEqual(['Journal']);
    expect(data.m6).toBeUndefined(); // « M6 » ≠ « M6 HD » : pas d'association automatique
  });

  it('applique l’association manuelle et le décalage (tvg-shift, réglage de la chaîne, réglage de la liste)', () => {
    const data = buildMergedEPGData([parseXmltv(xmlA), parseXmltv(xmlB)], [{ ...tf1, tvgShift: 1 }, m6], {
      overrides: { m6: { xmltvId: 'm6.b', shift: -1 } }, offsetHours: 0.5,
    });
    expect(data.m6[0].title).toBe('Film & Co');
    expect(data.m6[0].startTime.toISOString()).toBe('2026-11-06T19:30:00.000Z');
    expect(data.tf1[0].startTime.toISOString()).toBe('2026-11-06T21:30:00.000Z');
  });

  it('une association manuelle absente d’une source ne retombe pas sur l’automatique', () => {
    const data = buildEPGData(parseXmltv(xmlA), [tf1], { overrides: { tf1: { xmltvId: 'inconnu' } } });
    expect(data.tf1).toBeUndefined();
  });

  it('liste les chaînes d’un guide pour le choix manuel', () => {
    expect(listXmltvChannels(xmlB)).toEqual([{ id: 'tf1.b', displayNames: ['TF1'] }, { id: 'm6.b', displayNames: ['M6 HD'] }]);
  });
});

describe('recherche dans le guide', () => {
  const channels = [ch({ id: 'a', name: 'A' }), ch({ id: 'b', name: 'B' })];
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const epg = {
    a: [
      { id: '1', channelId: 'a', title: 'Le Journal', startTime: at(-30), endTime: at(-29) },
      { id: '2', channelId: 'a', title: 'Le Journal', startTime: at(2), endTime: at(3) },
    ],
    b: [{ id: '3', channelId: 'b', title: 'Météo', description: 'Avant le journal', startTime: at(-0.5), endTime: at(0.5) }],
  };

  it('classe en cours, à venir, puis passé rejouable, sans accents ni casse', () => {
    expect(searchPrograms(epg, channels, 'JOURNAL', { now }).map(r => `${r.when}:${r.program.id}`)).toEqual(['now:3', 'upcoming:2']);
    expect(searchPrograms(epg, channels, 'journal', { now, catchupDays: c => (c.id === 'a' ? 2 : 0) }).map(r => r.program.id)).toEqual(['3', '2', '1']);
    expect(searchPrograms(epg, channels, 'meteo', { now })[0].program.id).toBe('3');
    expect(searchPrograms(epg, channels, ' ', { now })).toEqual([]);
  });
});

describe('enregistrement depuis le guide', () => {
  const program = { id: 'p', channelId: 'c', title: 'Série', startTime: new Date(10 * 3_600_000), endTime: new Date(11 * 3_600_000) };

  it('ajoute les marges et démarre au plus tôt quelques secondes après maintenant', () => {
    expect(recordingWindow(program, { marginBeforeMin: 2, marginAfterMin: 5 }, 0)).toEqual({ startTimeMs: 10 * 3_600_000 - 120_000, durationMs: 3_600_000 + 420_000 });
    const nowMid = 10.5 * 3_600_000;
    expect(recordingWindow(program, { marginBeforeMin: 2, marginAfterMin: 0 }, nowMid)).toEqual({ startTimeMs: nowMid + 5000, durationMs: 1_800_000 - 5000 });
    expect(recordingWindow(program, { marginBeforeMin: 0, marginAfterMin: 0 }, 11 * 3_600_000)).toBeNull();
  });

  it('retrouve une programmation existante (marges comprises, même flux ou variante)', () => {
    const channel = ch({ url: 'http://h.test/a.ts', variants: [ch({ id: 'v', url: 'http://h.test/a.m3u8' })] });
    const scheduled = [{ id: 's', url: 'http://h.test/a.m3u8', title: 'x', startTimeMs: program.startTime.getTime() - 120_000, durationMs: 3_900_000 }];
    expect(findScheduled(scheduled, channel, program)?.id).toBe('s');
    expect(findScheduled(scheduled, ch({ url: 'http://h.test/b.ts' }), program)).toBeUndefined();
    expect(findScheduled([{ ...scheduled[0], startTimeMs: program.startTime.getTime() + 3_600_000 }], channel, program)).toBeUndefined();
  });

  it('compare les titres de série sans casse ni accents', () => {
    expect(seriesKey('  Les Feux de l’Amour ')).toBe(seriesKey('les feux  de l’amour'));
    expect(seriesKey('Été')).toBe('ete');
  });
});
