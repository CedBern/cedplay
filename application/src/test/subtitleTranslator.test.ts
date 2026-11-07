import { describe, expect, it, vi } from 'vitest';
import {
  parseTimestamp,
  formatTimestampSrt,
  formatTimestampVtt,
  parseSrt,
  cuesToSrt,
  cuesToVtt,
  shiftCues,
  translateCues,
  translateSrt,
} from '@/utils/subtitleTranslator';

describe('subtitleTranslator - Timestamp & Format', () => {
  it('convertit les chaînes de temps en millisecondes et inversement', () => {
    expect(parseTimestamp('00:01:23,456')).toBe(83456);
    expect(parseTimestamp('01:00:00.500')).toBe(3600500);
    expect(parseTimestamp('02:15,100')).toBe(135100);

    expect(formatTimestampSrt(83456)).toBe('00:01:23,456');
    expect(formatTimestampVtt(83456)).toBe('00:01:23.456');
  });

  it('découpe proprement un contenu SRT en répliques', () => {
    const srt = `1
00:00:10,000 --> 00:00:13,500
Bonjour à tous.
Bienvenue sur le lecteur.

2
00:00:14,000 --> 00:00:16,000
Deuxième réplique.`;

    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0].id).toBe(1);
    expect(cues[0].startMs).toBe(10000);
    expect(cues[0].endMs).toBe(13500);
    expect(cues[0].text).toBe('Bonjour à tous.\nBienvenue sur le lecteur.');

    expect(cues[1].id).toBe(2);
    expect(cues[1].text).toBe('Deuxième réplique.');
  });

  it('génère un WebVTT valide avec entête et séparateurs points', () => {
    const cues = [
      {
        id: 1,
        startMs: 1500,
        endMs: 3800,
        startTime: '00:00:01,500',
        endTime: '00:00:03,800',
        text: 'Sous-titre test',
      },
    ];
    const vtt = cuesToVtt(cues);
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:01.500 --> 00:00:03.800');
    expect(vtt).toContain('Sous-titre test');
  });

  it('reconstruit une chaîne SRT à partir des répliques avec cuesToSrt', () => {
    const cues = [
      { id: 1, startMs: 1000, endMs: 2500, startTime: '00:00:01,000', endTime: '00:00:02,500', text: 'Ligne 1' },
    ];
    const srt = cuesToSrt(cues);
    expect(srt).toContain('1\n00:00:01,000 --> 00:00:02,500\nLigne 1');
  });

  it('traduit une chaîne SRT complète avec translateSrt', async () => {
    const rawSrt = '1\n00:00:01,000 --> 00:00:02,000\nHello';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[['Bonjour', 'Hello']]],
    });
    vi.stubGlobal('fetch', mockFetch);
    const res = await translateSrt(rawSrt, 'fr');
    expect(res.cueCount).toBe(1);
    expect(res.srt).toContain('Bonjour');
    expect(res.vtt).toContain('WEBVTT');
    vi.unstubAllGlobals();
  });

  it('décale les répliques dans le temps avec shiftCues sans valeurs négatives', () => {
    const cues = [
      {
        id: 1,
        startMs: 2000,
        endMs: 4000,
        startTime: '00:00:02,000',
        endTime: '00:00:04,000',
        text: 'Test',
      },
    ];

    const shiftedPlus = shiftCues(cues, 1500);
    expect(shiftedPlus[0].startMs).toBe(3500);
    expect(shiftedPlus[0].endMs).toBe(5500);

    const shiftedMinus = shiftCues(cues, -5000);
    expect(shiftedMinus[0].startMs).toBe(0);
    expect(shiftedMinus[0].endMs).toBeGreaterThan(0);
  });
});

describe('subtitleTranslator - Traduction par lots', () => {
  it('traduit les répliques en préservant le nombre de blocs et la synchro', async () => {
    const cues = [
      {
        id: 1,
        startMs: 1000,
        endMs: 3000,
        startTime: '00:00:01,000',
        endTime: '00:00:03,000',
        text: 'Hello world',
      },
      {
        id: 2,
        startMs: 3500,
        endMs: 5000,
        startTime: '00:00:03,500',
        endTime: '00:00:05,000',
        text: 'Goodbye',
      },
    ];

    // Mock fetch pour simuler le retour de l'API de traduction
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [['Bonjour le monde ___¶___ Au revoir', 'Hello world ___¶___ Goodbye']],
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const progressValues: number[] = [];
    const translated = await translateCues(cues, 'fr', {
      onProgress: (p) => progressValues.push(p),
      batchSize: 10,
    });

    expect(translated).toHaveLength(2);
    expect(translated[0].text).toContain('Bonjour le monde');
    expect(translated[1].text).toContain('Au revoir');
    expect(progressValues).toContain(100);

    vi.unstubAllGlobals();
  });
});
