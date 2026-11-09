/**
 * Journal d'usage local de Découvrir : par jour, le temps de lecture effective de chaque
 * famille. Rien ne quitte l'appareil. Sur Android, le lecteur natif tient son propre journal
 * (mesuré sur isPlaying d'ExoPlayer, voir UsageJournal.java) ; dans le navigateur, les
 * éléments <video>/<audio> sont mesurés ici. Les deux se cumulent : ils ne mesurent jamais
 * la même lecture.
 */
export type UsageFamily = 'live' | 'vod' | 'audio';
export type DiscoverFamily = 'direct' | 'video' | 'podcasts';

export interface UsageDay {
  /** Jour local AAAA-MM-JJ. */
  day: string;
  live: number;
  vod: number;
  audio: number;
}

export const USAGE_KEEP_DAYS = 14;
/** Seuil d'un jour « qualifié » pour une famille : 2 minutes de lecture effective. */
export const QUALIFIED_MS = 2 * 60_000;
/** Jours distincts qualifiés nécessaires avant d'abandonner l'ordre par défaut. */
export const MIN_QUALIFIED_DAYS = 3;
export const DEFAULT_FAMILY_ORDER: readonly DiscoverFamily[] = ['direct', 'video', 'podcasts'];

const STORAGE_KEY = 'cedplay_usage_journal_v1';
const FAMILY_INDEX: Record<UsageFamily, number> = { live: 0, vod: 1, audio: 2 };
const DISCOVER_OF: Record<UsageFamily, DiscoverFamily> = { live: 'direct', vod: 'video', audio: 'podcasts' };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Premier jour gardé : aujourd'hui compris, 14 jours au total. */
export function oldestKeptDay(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - (USAGE_KEEP_DAYS - 1));
  return dayKey(d);
}

/** Format partagé avec Android : « jour|direct|vod|audio » séparés par des points-virgules. */
export function decodeUsage(encoded: string | null | undefined): UsageDay[] {
  if (!encoded) return [];
  const out: UsageDay[] = [];
  for (const row of encoded.split(';')) {
    const parts = row.split('|');
    if (parts.length !== 4 || !DAY_RE.test(parts[0])) continue;
    const values = parts.slice(1).map(Number);
    if (values.some(v => !Number.isFinite(v))) continue;
    out.push({ day: parts[0], live: Math.max(0, values[0]), vod: Math.max(0, values[1]), audio: Math.max(0, values[2]) });
  }
  return out;
}

export function encodeUsage(days: UsageDay[]): string {
  return [...days]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map(d => `${d.day}|${Math.round(d.live)}|${Math.round(d.vod)}|${Math.round(d.audio)}`)
    .join(';');
}

/** Additionne plusieurs journaux (navigateur + Android) jour par jour. */
export function mergeUsage(...journals: UsageDay[][]): UsageDay[] {
  const byDay = new Map<string, UsageDay>();
  for (const journal of journals) {
    for (const entry of journal) {
      const current = byDay.get(entry.day) ?? { day: entry.day, live: 0, vod: 0, audio: 0 };
      current.live += entry.live;
      current.vod += entry.vod;
      current.audio += entry.audio;
      byDay.set(entry.day, current);
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function addUsage(days: UsageDay[], family: UsageFamily, playedMs: number, now: Date): UsageDay[] {
  const today = dayKey(now);
  const oldest = oldestKeptDay(now);
  const next = days.filter(d => d.day >= oldest).map(d => ({ ...d }));
  if (playedMs > 0) {
    let entry = next.find(d => d.day === today);
    if (!entry) { entry = { day: today, live: 0, vod: 0, audio: 0 }; next.push(entry); }
    entry[family] += playedMs;
  }
  return next.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Ordre des familles de Découvrir. Usage = nombre de jours distincts, sur les 14 derniers,
 * où la famille a eu au moins 2 minutes de lecture effective. Tant que le journal compte
 * moins de 3 jours distincts qualifiés (toutes familles confondues), l'ordre par défaut
 * s'applique ; il départage aussi les égalités.
 */
export function familyOrder(days: UsageDay[], now: Date): DiscoverFamily[] {
  const oldest = oldestKeptDay(now);
  const today = dayKey(now);
  const counts: Record<DiscoverFamily, number> = { direct: 0, video: 0, podcasts: 0 };
  const qualifiedDays = new Set<string>();
  for (const entry of days) {
    if (entry.day < oldest || entry.day > today) continue;
    for (const family of Object.keys(FAMILY_INDEX) as UsageFamily[]) {
      if (entry[family] >= QUALIFIED_MS) {
        counts[DISCOVER_OF[family]] += 1;
        qualifiedDays.add(entry.day);
      }
    }
  }
  if (qualifiedDays.size < MIN_QUALIFIED_DAYS) return [...DEFAULT_FAMILY_ORDER];
  return [...DEFAULT_FAMILY_ORDER].sort((a, b) => counts[b] - counts[a] || DEFAULT_FAMILY_ORDER.indexOf(a) - DEFAULT_FAMILY_ORDER.indexOf(b));
}

function readWebUsage(): UsageDay[] {
  try { return decodeUsage(localStorage.getItem(STORAGE_KEY)); } catch { return []; }
}

function writeWebUsage(days: UsageDay[]): void {
  try { localStorage.setItem(STORAGE_KEY, encodeUsage(days)); } catch { /* stockage indisponible : on perd seulement la mesure */ }
}

export function recordWebUsage(family: UsageFamily, playedMs: number, now = new Date()): void {
  if (!(playedMs > 0)) return;
  writeWebUsage(addUsage(readWebUsage(), family, playedMs, now));
}

/** Accès au journal Android, fourni par nativePlayer.ts (évite une dépendance circulaire). */
export interface NativeUsageAccess {
  read(): Promise<string | null>;
  clear(): Promise<void>;
}

export async function readUsageJournal(native?: NativeUsageAccess | null): Promise<UsageDay[]> {
  const web = readWebUsage();
  if (!native) return web;
  try {
    return mergeUsage(web, decodeUsage(await native.read()));
  } catch {
    return web;
  }
}

export async function clearUsageJournal(native?: NativeUsageAccess | null): Promise<void> {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  if (native) {
    try { await native.clear(); } catch { /* ignore */ }
  }
}

/**
 * Mesure la lecture effective d'un élément média du navigateur : le chronomètre tourne
 * entre « playing » et la première pause, attente de données, recherche ou fin. Un saut
 * dans le média n'ajoute donc aucun temps. Rend la fonction de détachement.
 */
export function attachUsageMeter(el: HTMLMediaElement, family: UsageFamily | (() => UsageFamily | null)): () => void {
  let startedAt: number | null = null;
  let startedFamily: UsageFamily | null = null;
  const resolve = () => (typeof family === 'function' ? family() : family);
  const stop = () => {
    if (startedAt === null || startedFamily === null) return;
    const played = performance.now() - startedAt;
    const fam = startedFamily;
    startedAt = null;
    startedFamily = null;
    recordWebUsage(fam, played);
  };
  const start = () => {
    stop();
    const fam = resolve();
    if (!fam) return;
    startedAt = performance.now();
    startedFamily = fam;
  };
  const stopEvents = ['pause', 'waiting', 'seeking', 'ended', 'emptied', 'error', 'stalled'] as const;
  el.addEventListener('playing', start);
  for (const ev of stopEvents) el.addEventListener(ev, stop);
  const onHide = () => { if (document.visibilityState === 'hidden' && startedAt !== null) { const fam = startedFamily; stop(); if (!el.paused && fam) { startedAt = performance.now(); startedFamily = fam; } } };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    stop();
    el.removeEventListener('playing', start);
    for (const ev of stopEvents) el.removeEventListener(ev, stop);
    document.removeEventListener('visibilitychange', onHide);
  };
}
