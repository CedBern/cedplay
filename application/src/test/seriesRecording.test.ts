import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ScheduledRecording } from '@/utils/nativePlayer';

const store = new Map<string, unknown>();
const scheduled: ScheduledRecording[] = [];
vi.mock('@/utils/idb', () => ({
  getMeta: async (key: string) => store.get(key),
  setMeta: async (key: string, value: unknown) => { store.set(key, structuredClone(value)); },
}));
vi.mock('@/utils/nativePlayer', () => ({
  RecordingsBridge: {
    isAvailable: () => true,
    listScheduled: async () => scheduled.map(s => ({ ...s })),
    schedule: vi.fn(async (url: string, title: string, startTimeMs: number, durationMs: number) => {
      scheduled.push({ id: `s${scheduled.length + 1}`, url, title, startTimeMs, durationMs });
      return true;
    }),
  },
}));

const { addSeriesRule, applySeriesRules, findScheduled } = await import('@/utils/recordingRules');

const H = 3_600_000;
const day = Date.UTC(2026, 10, 9);
const channel = { id: 'c', name: 'Chaîne', url: 'http://h.test/c.m3u8' };
const episode = (id: string, fromH: number, toH: number) => ({ id, channelId: 'c', title: 'La Série', startTime: new Date(day + fromH * H), endTime: new Date(day + toH * H) });

// `recordingWindow` cale le départ sur l'horloge réelle : sans horloge figée, cette
// émission du 9 novembre 2026 devenait « déjà commencée » dès 10 h UTC et le test
// tombait tous les jours à la même heure.
let clock: ReturnType<typeof vi.spyOn>;
beforeEach(() => { store.clear(); scheduled.length = 0; clock = vi.spyOn(Date, 'now').mockReturnValue(day); });
afterEach(() => { clock.mockRestore(); });

it('programme chaque épisode consécutif jusqu’à sa fin, marges comprises', async () => {
  // 10 h – 10 h 30 puis 10 h 30 – 11 h, marges 2 min avant et 5 min après.
  const first = episode('1', 10, 10.5);
  const second = episode('2', 10.5, 11);
  await addSeriesRule('pl', channel, 'La Série');
  const added = await applySeriesRules('pl', [channel], { c: [first, second] }, day);
  expect(added).toBe(2);
  const ends = scheduled.map(s => (s.startTimeMs + s.durationMs - day) / 60_000);
  expect(ends).toEqual([10 * 60 + 35, 11 * 60 + 5]);
  // Le premier créneau (fin 10 h 35) ne compte pas comme l'enregistrement du second.
  expect(findScheduled([scheduled[0]], channel, second, day)).toBeUndefined();
  expect(findScheduled(scheduled, channel, second, day)?.id).toBe('s2');
  // Une seconde passe ne reprogramme rien.
  expect(await applySeriesRules('pl', [channel], { c: [first, second] }, day)).toBe(0);
});

it('reconnaît un enregistrement lancé en cours de diffusion', () => {
  const live = episode('3', 10, 11);
  const now = day + 10.25 * H;
  const slot = { id: 'm', url: channel.url, title: 'x', startTimeMs: now + 5000, durationMs: 0.75 * H + 300_000 };
  expect(findScheduled([slot], channel, live, now + 60_000)?.id).toBe('m');
  // Le même créneau ne vaut pas pour une émission future qu'il ne couvre qu'en partie.
  expect(findScheduled([slot], channel, live, day)).toBeUndefined();
});
