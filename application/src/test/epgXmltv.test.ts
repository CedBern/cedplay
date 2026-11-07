import { describe, it, expect } from 'vitest';
import { parseXmltvDate, parseXmltv, buildEPGData, getCurrentProgram, getUpcomingProgram } from '@/utils/epgXmltv';
import type { Channel } from '@/types/channel';

describe('parseXmltvDate', () => {
  it('accepts the XMLTV format with timezone offset', () => {
    const d = parseXmltvDate('20261103120000 +0100');
    expect(d).not.toBeNull();
    expect(d!.getUTCHours()).toBe(11); // 12:00 +0100 -> 11:00 UTC
  });
  it('accepts the XMLTV format without offset (UTC)', () => {
    const d = parseXmltvDate('20261103120000 +0000');
    expect(d!.getUTCHours()).toBe(12);
  });
  it('accepts ISO 8601', () => {
    const d = parseXmltvDate('2026-11-03T12:00:00Z');
    expect(d!.getUTCHours()).toBe(12);
  });
  it('rejects garbage', () => {
    expect(parseXmltvDate('not a date')).toBeNull();
  });
});

describe('parseXmltv + buildEPGData', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="tf1.fr"><display-name>TF1</display-name></channel>
  <programme start="${isoMinutesAgo(60)}" stop="${isoMinutesAhead(30)}" channel="tf1.fr">
    <title lang="fr">Journal</title>
    <desc>Les infos de midi.</desc>
    <category>News</category>
  </programme>
  <programme start="${isoMinutesAhead(30)}" stop="${isoMinutesAhead(90)}" channel="tf1.fr">
    <title lang="fr">Film</title>
  </programme>
</tv>`;

  it('associe les programmes par tvg-id puis par nom', () => {
    const parsed = parseXmltv(xml);
    expect(parsed.channels).toHaveLength(1);
    expect(parsed.programmes).toHaveLength(2);
    const channels: Channel[] = [{ id: 'c1', name: 'TF1', url: 'https://example.test/tf1.m3u8', tvgId: 'tf1.fr' }];
    const data = buildEPGData(parsed, channels);
    expect(data['c1']).toHaveLength(2);
    expect(data['c1'][0].title).toBe('Journal');
    expect(data['c1'][0].description).toBe('Les infos de midi.');
    expect(data['c1'][0].category).toBe('News');
  });

  it('associe par nom quand tvg-id manque', () => {
    const parsed = parseXmltv(xml);
    const channels: Channel[] = [{ id: 'c2', name: 'TF1', url: 'https://example.test/tf1.m3u8' }];
    const data = buildEPGData(parsed, channels);
    expect(data['c2']).toHaveLength(2);
  });

  it('associe par nom avec préfixe pays (ex: FR: TF1 HD -> TF1 HD)', () => {
    const parsed = parseXmltv(xml);
    const channels: Channel[] = [{ id: 'c-fr', name: 'FR: TF1', url: 'https://example.test/tf1.m3u8' }];
    const data = buildEPGData(parsed, channels);
    expect(data['c-fr']).toHaveLength(2);
  });

  it('gère le CDATA et les entités XML dans les titres et descriptions', () => {
    const cdataXml = `<tv>
      <channel id="m6"><display-name><![CDATA[M6 HD]]></display-name></channel>
      <programme start="${isoMinutesAgo(20)}" stop="${isoMinutesAhead(40)}" channel="m6">
        <title><![CDATA[Ça peut vous arriver &amp; plus]]></title>
        <desc>Émission d&#39;aide &lt;direct&gt;.</desc>
        <category>Info</category>
      </programme>
    </tv>`;
    const parsed = parseXmltv(cdataXml);
    expect(parsed.programmes[0].title).toBe('Ça peut vous arriver & plus');
    expect(parsed.programmes[0].description).toBe("Émission d'aide <direct>.");
    const data = buildEPGData(parsed, [{ id: 'm6-id', name: 'FR: M6 HD', url: 'https://example.test/m6.m3u8' }]);
    expect(data['m6-id']).toHaveLength(1);
    expect(data['m6-id'][0].title).toBe('Ça peut vous arriver & plus');
  });

  it('ignore les chaînes sans correspondance', () => {
    const parsed = parseXmltv(xml);
    const channels: Channel[] = [{ id: 'c3', name: 'Inconnue', url: 'https://example.test/x.m3u8' }];
    expect(buildEPGData(parsed, channels)).toEqual({});
  });
});

describe('now/next', () => {
  it('trouve le programme en cours et le suivant', () => {
    const parsed = parseXmltv(`<tv>
      <channel id="a"><display-name>A</display-name></channel>
      <programme start="${isoMinutesAgo(30)}" stop="${isoMinutesAhead(30)}" channel="a"><title>Actuel</title></programme>
      <programme start="${isoMinutesAhead(30)}" stop="${isoMinutesAhead(90)}" channel="a"><title>Suivant</title></programme>
    </tv>`);
    const data = buildEPGData(parsed, [{ id: 'c', name: 'A', url: 'https://example.test/a.m3u8' }]);
    expect(getCurrentProgram('c', data)?.title).toBe('Actuel');
    expect(getUpcomingProgram('c', data)?.title).toBe('Suivant');
  });
});

function isoMinutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60000).toISOString();
}
function isoMinutesAhead(mins: number): string {
  return new Date(Date.now() + mins * 60000).toISOString();
}

it('conserve le programme actuel, le passé et les journées suivantes dans un guide long', () => {
  const now = Date.now();
  const programmes = Array.from({ length: 400 }, (_, i) => ({ channel: 'a', start: new Date(now + (i - 100) * 3600000), stop: new Date(now + (i - 99) * 3600000), title: `Programme ${i}` }));
  const data = buildEPGData({ channels: [{ id: 'a', displayNames: ['A'] }], programmes }, [{ id: 'c', name: 'A', url: 'https://example.test/a' }]);
  expect(data.c).toHaveLength(400);
  expect(getCurrentProgram('c', data)?.title).toBe('Programme 100');
  expect(data.c.some(p => p.startTime.getTime() < now - 86400000)).toBe(true);
});
