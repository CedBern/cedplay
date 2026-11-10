import { EPGProgram } from '@/types/epg';

/** Échelle de la grille : pixels par minute. */
export const PX_PER_MINUTE = 3;
/** Largeur d'une heure (px) et d'une journée complète (px). */
export const HOUR_WIDTH = PX_PER_MINUTE * 60;
export const DAY_WIDTH = HOUR_WIDTH * 24;
/** Colonne des noms de chaînes (px). */
export const CHANNEL_COL_WIDTH = 200;

export interface DayBounds {
  start: Date;
  end: Date;
}

/** Bornes d'une journée : minuit local → minuit local suivant. */
export function dayBounds(date: Date): DayBounds {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Position et largeur (px) d'un programme dans une journée.
 * Retourne null s'il est entièrement hors de la journée (programmes à cheval tronqués aux bornes).
 */
export function layoutProgram(program: EPGProgram, day: DayBounds): { left: number; width: number } | null {
  const start = Math.max(program.startTime.getTime(), day.start.getTime());
  const end = Math.min(program.endTime.getTime(), day.end.getTime());
  if (end <= start) return null;
  const left = ((start - day.start.getTime()) / 60000) * PX_PER_MINUTE;
  const width = ((end - start) / 60000) * PX_PER_MINUTE;
  return { left, width: Math.max(width, 2) };
}

/** Une étiquette par heure, du début à la fin de la plage (00:00 → 24:00 pour une journée). */
export function buildHourTicks(range: DayBounds): Date[] {
  const ticks: Date[] = [];
  const t = new Date(range.start);
  t.setMinutes(0, 0, 0);
  if (t < range.start) t.setHours(t.getHours() + 1);
  while (t.getTime() <= range.end.getTime()) {
    ticks.push(new Date(t));
    t.setHours(t.getHours() + 1);
  }
  return ticks;
}

/**
 * Nettoie les programmes d'une chaîne pour la grille : tri, doublons retirés
 * (même début) et chevauchements coupés au début du programme suivant, pour
 * que les cadres se suivent sans se superposer.
 */
export function normalizePrograms(programs: EPGProgram[]): EPGProgram[] {
  // Le parseur livre déjà chaque chaîne triée par début : sans doublon ni chevauchement,
  // renvoyer la liste telle quelle évite une copie et un tri O(n log n) par chaîne
  // (des milliers de chaînes à l'ouverture du guide sur la box).
  let clean = true;
  for (let i = 1; i < programs.length; i++) {
    const prev = programs[i - 1];
    const cur = programs[i];
    if (cur.startTime.getTime() <= prev.startTime.getTime()
      || prev.endTime.getTime() > cur.startTime.getTime()) { clean = false; break; }
  }
  if (clean) return programs;
  const sorted = [...programs].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const out: EPGProgram[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.startTime.getTime() === p.startTime.getTime()) {
      // Doublon : on garde la version la plus longue.
      if (p.endTime > prev.endTime) out[out.length - 1] = p;
      continue;
    }
    if (prev && prev.endTime > p.startTime) out[out.length - 1] = { ...prev, endTime: p.startTime };
    out.push(p);
  }
  return out;
}

/** Vrai si au moins une émission chevauche [start, end] (liste triée par début). */
export function hasProgramInRange(programs: EPGProgram[], start: Date, end: Date): boolean {
  let lo = 0;
  let hi = programs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (programs[mid].startTime.getTime() <= start.getTime()) lo = mid + 1;
    else hi = mid;
  }
  const after = programs[lo];
  if (after && after.startTime < end) return true;
  const before = programs[lo - 1];
  return !!before && before.endTime > start;
}

/**
 * Indices [début, fin) des émissions qui chevauchent [startMs, endMs], par dichotomie
 * (liste triée par début, sans chevauchement — voir normalizePrograms). Remplace le
 * balayage linéaire de chaque ligne à chaque défilement de la grille : au plus une
 * émission est en cours à startMs (la précédente du premier début qui le dépasse), puis
 * on avance jusqu'au premier début >= endMs.
 */
export function programsInRange(programs: EPGProgram[], startMs: number, endMs: number): { start: number; end: number } {
  let lo = 0;
  let hi = programs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (programs[mid].startTime.getTime() <= startMs) lo = mid + 1;
    else hi = mid;
  }
  // programs[lo - 1] commence à ou avant startMs : il chevauche s'il finit après.
  const start = lo > 0 && programs[lo - 1].endTime.getTime() > startMs ? lo - 1 : lo;
  let a = lo;
  let b = programs.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (programs[mid].startTime.getTime() < endMs) a = mid + 1;
    else b = mid;
  }
  return { start, end: a };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Plage continue de la grille : de minuit aujourd'hui (ou plus tôt si l'archive
 * le permet) jusqu'à la fin des programmes connus, une semaine au plus.
 */
export function guideRange(now: Date, earliest: number | null, latest: number | null, pastDays = 0): DayBounds {
  const today = dayBounds(now);
  const minStart = today.start.getTime() - Math.max(0, pastDays) * DAY_MS;
  const start = new Date(Math.max(minStart, Math.min(today.start.getTime(), earliest ?? today.start.getTime())));
  start.setHours(0, 0, 0, 0);
  const maxEnd = today.start.getTime() + 7 * DAY_MS;
  const end = new Date(Math.min(maxEnd, Math.max(today.end.getTime(), latest ?? 0)));
  if (end.getHours() || end.getMinutes() || end.getSeconds() || end.getMilliseconds()) {
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

/** Largeur (px) d'une plage de temps. */
export function rangeWidth(range: DayBounds): number {
  return ((range.end.getTime() - range.start.getTime()) / 60000) * PX_PER_MINUTE;
}

/** Offset (px) de l'instant présent dans la journée, ou null s'il est hors de la journée affichée. */
export function nowOffsetInDay(now: Date, day: DayBounds): number | null {
  const t = now.getTime();
  if (t < day.start.getTime() || t >= day.end.getTime()) return null;
  return ((t - day.start.getTime()) / 60000) * PX_PER_MINUTE;
}
