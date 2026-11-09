import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addUsage,
  attachUsageMeter,
  clearUsageJournal,
  decodeUsage,
  encodeUsage,
  familyOrder,
  mergeUsage,
  readUsageJournal,
  type UsageDay,
} from '@/utils/usageJournal';

const NOW = new Date(2026, 10, 8, 20, 0, 0);
const MIN = 60_000;
const day = (d: string, live = 0, vod = 0, audio = 0): UsageDay => ({ day: d, live, vod, audio });

describe('journal d’usage de Découvrir', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('garde l’ordre par défaut tant qu’il n’y a pas 3 jours distincts qualifiés', () => {
    const days = [day('2026-11-07', 0, 0, 30 * MIN), day('2026-11-08', 0, 0, 30 * MIN)];
    expect(familyOrder(days, NOW)).toEqual(['direct', 'video', 'podcasts']);
  });

  it('ne compte pas un jour sous 2 minutes de lecture effective', () => {
    const days = [
      day('2026-11-05', 0, 0, 3 * MIN),
      day('2026-11-06', 0, 0, 3 * MIN),
      day('2026-11-07', 0, 0, 1.9 * MIN),
    ];
    expect(familyOrder(days, NOW)).toEqual(['direct', 'video', 'podcasts']);
  });

  it('classe par jours d’usage une fois 3 jours qualifiés, l’ordre par défaut départage', () => {
    const days = [
      day('2026-11-05', 0, 5 * MIN, 3 * MIN),
      day('2026-11-06', 0, 0, 3 * MIN),
      day('2026-11-07', 0, 4 * MIN, 3 * MIN),
    ];
    // Podcasts 3 jours, vidéo 2 jours, direct 0.
    expect(familyOrder(days, NOW)).toEqual(['podcasts', 'video', 'direct']);
    const tie = [day('2026-11-05', 3 * MIN, 0, 3 * MIN), day('2026-11-06', 3 * MIN, 0, 3 * MIN), day('2026-11-07', 0, 3 * MIN, 0)];
    expect(familyOrder(tie, NOW)).toEqual(['direct', 'podcasts', 'video']);
  });

  it('ignore les jours de plus de 14 jours et les supprime à l’écriture', () => {
    const old = [day('2026-10-20', 9 * MIN), day('2026-10-21', 9 * MIN), day('2026-10-22', 9 * MIN)];
    expect(familyOrder(old, NOW)).toEqual(['direct', 'video', 'podcasts']);
    const next = addUsage([...old, day('2026-10-26', 1)], 'vod', 5 * MIN, NOW);
    expect(next.map(d => d.day)).toEqual(['2026-10-26', '2026-11-08']);
  });

  it('lit le format partagé avec Android et additionne les deux journaux', () => {
    const native = decodeUsage('2026-11-08|120000|0|0;abîmé;2026-11-07|x|0|0');
    expect(native).toEqual([day('2026-11-08', 120_000)]);
    const merged = mergeUsage([day('2026-11-08', 1000, 0, 5)], native);
    expect(encodeUsage(merged)).toBe('2026-11-08|121000|0|5');
  });

  it('réunit le journal du navigateur et celui d’Android, et s’efface entièrement', async () => {
    localStorage.setItem('cedplay_usage_journal_v1', '2026-11-08|0|0|1000');
    const clear = vi.fn(async () => {});
    const native = { read: async () => '2026-11-08|0|0|2000', clear };
    expect(await readUsageJournal(native)).toEqual([day('2026-11-08', 0, 0, 3000)]);
    await clearUsageJournal(native);
    expect(clear).toHaveBeenCalledOnce();
    expect(await readUsageJournal(null)).toEqual([]);
  });

  it('ne mesure que la lecture effective : ni pause, ni attente, ni saut', () => {
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const media = document.createElement('video');
    const detach = attachUsageMeter(media, 'vod');
    media.dispatchEvent(new Event('playing'));
    t = 60_000;
    media.dispatchEvent(new Event('seeking')); // saut : la mesure s’arrête
    t = 61_000;
    media.dispatchEvent(new Event('playing'));
    t = 91_000;
    media.dispatchEvent(new Event('waiting')); // chargement
    t = 200_000;
    media.dispatchEvent(new Event('playing'));
    t = 230_000;
    media.dispatchEvent(new Event('pause'));
    t = 900_000; // longue pause : rien
    detach();
    const stored = decodeUsage(localStorage.getItem('cedplay_usage_journal_v1'));
    expect(stored).toHaveLength(1);
    expect(stored[0].vod).toBe(60_000 + 30_000 + 30_000);
  });
});
