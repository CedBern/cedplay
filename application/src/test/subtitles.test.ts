import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeSubtitleLang,
  sortTracksByPriority,
  type SubtitleTrack,
  lookupImdbId, downloadSubtitleText,
} from '@/utils/subtitles';
afterEach(() => vi.unstubAllGlobals());

it('refuse le premier film Cinemeta si seul le titre d’une suite correspond', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ metas: [{ id: 'tt12345', name: 'Matrix 2', releaseInfo: '2003' }] }) }));
  expect(await lookupImdbId('Matrix', '2003')).toBeNull();
});

it('obtient le lien OpenSubtitles par POST puis télécharge sans transmettre la clé au CDN', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ link: 'https://dl.opensubtitles.com/file.srt' }) })
    .mockResolvedValueOnce({ ok: true, text: async () => '1\n00:00:01,000 --> 00:00:02,000\nBonjour' });
  vi.stubGlobal('fetch', fetcher);
  expect(await downloadSubtitleText('https://api.opensubtitles.com/api/v1/download/42', { openSubtitlesApiKey: 'test-key' })).toContain('Bonjour');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ file_id: 42 }), headers: { 'Api-Key': 'test-key' } });
  expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Api-Key');
});

describe('subtitles - Normalisation et priorité des langues', () => {
  it('normalise les variantes de français, anglais et espagnol mexicain/latino', () => {
    expect(normalizeSubtitleLang('fre')).toEqual({ lang: 'fr', label: 'Français' });
    expect(normalizeSubtitleLang('fra')).toEqual({ lang: 'fr', label: 'Français' });
    expect(normalizeSubtitleLang('fr')).toEqual({ lang: 'fr', label: 'Français' });

    expect(normalizeSubtitleLang('eng')).toEqual({ lang: 'en', label: 'Anglais' });
    expect(normalizeSubtitleLang('en')).toEqual({ lang: 'en', label: 'Anglais' });

    expect(normalizeSubtitleLang('spa')).toEqual({ lang: 'es', label: 'Espagnol (Mexique / Latam)' });
    expect(normalizeSubtitleLang('es-mx')).toEqual({ lang: 'es', label: 'Espagnol (Mexique / Latam)' });
    expect(normalizeSubtitleLang('es-419')).toEqual({ lang: 'es', label: 'Espagnol (Mexique / Latam)' });

    expect(normalizeSubtitleLang('ita')).toEqual({ lang: 'other', label: 'ITA' });
  });

  it('trie strictement les pistes : Français en tête, puis Anglais et Espagnol mexicain, autres en fin', () => {
    const tracks: SubtitleTrack[] = [
      { id: '1', name: 'Italian Sub', lang: 'other', langCode: 'ita', langLabel: 'ITA', url: '', format: 'srt' },
      { id: '2', name: 'Spanish Latin Sub', lang: 'es', langCode: 'es-419', langLabel: 'Espagnol (Mexique / Latam)', url: '', format: 'srt' },
      { id: '3', name: 'English Sub', lang: 'en', langCode: 'eng', langLabel: 'Anglais', url: '', format: 'srt' },
      { id: '4', name: 'French Native Sub', lang: 'fr', langCode: 'fre', langLabel: 'Français', url: '', format: 'srt' },
    ];

    const sorted = sortTracksByPriority(tracks);

    expect(sorted.map((t) => t.lang)).toEqual(['fr', 'en', 'es', 'other']);
    expect(sorted[0].name).toBe('French Native Sub');
    expect(sorted[1].name).toBe('English Sub');
    expect(sorted[2].name).toBe('Spanish Latin Sub');
  });

  it('place un sous-titre traduit en français avant un sous-titre français distant non vérifié', () => {
    const tracks: SubtitleTrack[] = [
      { id: '1', name: 'French Remote', lang: 'fr', langCode: 'fre', langLabel: 'Français', url: '', format: 'srt' },
      { id: '2', name: 'French Translated Local', lang: 'fr', langCode: 'fr', langLabel: 'Français', url: '', format: 'srt', isTranslated: true },
    ];

    const sorted = sortTracksByPriority(tracks);
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
  });
});
