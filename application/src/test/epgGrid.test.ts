import { describe, it, expect } from 'vitest';
import { dayBounds, layoutProgram, buildHourTicks, nowOffsetInDay, normalizePrograms, hasProgramInRange, guideRange, PX_PER_MINUTE } from '@/utils/epgGrid';
import type { EPGProgram } from '@/types/epg';

const program = (start: Date, end: Date): EPGProgram => ({
  id: 'p',
  channelId: 'c',
  title: 'Test',
  startTime: start,
  endTime: end,
});

describe('dayBounds', () => {
  it('encadre la journée en heure locale', () => {
    const d = new Date(2026, 10, 3, 14, 30); // 3 nov. 14:30
    const { start, end } = dayBounds(d);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
    expect(end.getDate()).toBe(4);
  });
});

describe('layoutProgram', () => {
  const day = dayBounds(new Date(2026, 10, 3, 12, 0));

  it('place un programme au milieu de la journée', () => {
    const start = new Date(2026, 10, 3, 10, 0);
    const end = new Date(2026, 10, 3, 11, 30);
    const layout = layoutProgram(program(start, end), day);
    expect(layout).toEqual({ left: 10 * 60 * PX_PER_MINUTE, width: 90 * PX_PER_MINUTE });
  });

  it('tronque un programme qui commence avant minuit', () => {
    const start = new Date(2026, 10, 2, 23, 0);
    const end = new Date(2026, 10, 3, 1, 0);
    const layout = layoutProgram(program(start, end), day);
    expect(layout).toEqual({ left: 0, width: 60 * PX_PER_MINUTE });
  });

  it('tronque un programme qui se termine après minuit', () => {
    const start = new Date(2026, 10, 3, 23, 0);
    const end = new Date(2026, 10, 4, 0, 30);
    const layout = layoutProgram(program(start, end), day);
    expect(layout).toEqual({ left: 23 * 60 * PX_PER_MINUTE, width: 60 * PX_PER_MINUTE });
  });

  it('rejette un programme entièrement hors de la journée', () => {
    const start = new Date(2026, 10, 4, 9, 0);
    const end = new Date(2026, 10, 4, 10, 0);
    expect(layoutProgram(program(start, end), day)).toBeNull();
  });
});

describe('buildHourTicks', () => {
  it('produit 25 graduations de 00:00 à 24:00', () => {
    const day = dayBounds(new Date(2026, 10, 3, 12, 0));
    const ticks = buildHourTicks(day);
    expect(ticks).toHaveLength(25);
    expect(ticks[0].getHours()).toBe(0);
    expect(ticks[24].getTime()).toBe(day.end.getTime());
  });
});

describe('nowOffsetInDay', () => {
  const day = dayBounds(new Date(2026, 10, 3, 12, 0));

  it('donne l’offset en pixels pendant la journée', () => {
    const atNoon = new Date(2026, 10, 3, 12, 0);
    expect(nowOffsetInDay(atNoon, day)).toBe(12 * 60 * PX_PER_MINUTE);
  });

  it('renvoie null hors de la journée', () => {
    expect(nowOffsetInDay(new Date(2026, 10, 2, 12, 0), day)).toBeNull();
    expect(nowOffsetInDay(new Date(2026, 10, 4, 12, 0), day)).toBeNull();
  });
});

describe('normalizePrograms', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m);
  const prog = (id: string, start: Date, end: Date): EPGProgram => ({ id, channelId: 'c', title: id, startTime: start, endTime: end });

  it('trie, retire les doublons et coupe les chevauchements', () => {
    const out = normalizePrograms([
      prog('b', at(10), at(11)),
      prog('a', at(9), at(10, 30)),
      prog('a-bis', at(9), at(10)),
      prog('c', at(11), at(12)),
    ]);
    expect(out.map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].endTime.getTime()).toBe(at(10).getTime());
    expect(out[1].endTime.getTime()).toBe(at(11).getTime());
  });

  it('renvoie la liste déjà propre sans la copier', () => {
    const clean = [prog('a', at(9), at(10)), prog('b', at(10), at(11))];
    expect(normalizePrograms(clean)).toBe(clean);
  });
});

describe('hasProgramInRange', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m);
  const prog = (id: string, start: Date, end: Date): EPGProgram => ({ id, channelId: 'c', title: id, startTime: start, endTime: end });
  const list = [prog('a', at(9), at(10)), prog('b', at(10), at(11)), prog('c', at(11), at(12))];

  it('voit une émission à cheval sur le début de la plage', () => {
    expect(hasProgramInRange(list, at(9, 30), at(9, 45))).toBe(true);
  });

  it('écarte une plage entièrement avant ou après', () => {
    expect(hasProgramInRange(list, at(7), at(8))).toBe(false);
    expect(hasProgramInRange(list, at(13), at(14))).toBe(false);
  });

  it('accepte une plage vide de programmes', () => {
    expect(hasProgramInRange([], at(9), at(10))).toBe(false);
  });
});

describe('guideRange', () => {
  const now = new Date(2026, 10, 3, 21, 30);

  it("va au-delà de minuit quand le guide couvre les jours suivants", () => {
    const range = guideRange(now, new Date(2026, 10, 3, 6).getTime(), new Date(2026, 10, 5, 3).getTime());
    expect(range.start.getTime()).toBe(new Date(2026, 10, 3).getTime());
    expect(range.end.getTime()).toBe(new Date(2026, 10, 6).getTime());
    expect(buildHourTicks(range)).toHaveLength(3 * 24 + 1);
  });

  it("couvre au moins la journée et remonte dans l'archive si demandé", () => {
    const range = guideRange(now, new Date(2026, 9, 25).getTime(), new Date(2026, 10, 3, 22).getTime(), 2);
    expect(range.start.getTime()).toBe(new Date(2026, 10, 1).getTime());
    expect(range.end.getTime()).toBe(new Date(2026, 10, 4).getTime());
  });

  it('se limite à une semaine', () => {
    const range = guideRange(now, null, new Date(2026, 11, 1).getTime());
    expect(range.end.getTime()).toBe(new Date(2026, 10, 10).getTime());
  });
});
