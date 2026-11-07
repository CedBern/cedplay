import { catalogRequest, getXtreamAccount, type XtreamAccount } from '@/utils/xtreamCatalog';
import { getMeta, setMeta } from '@/utils/idb';
import type { Channel, PlaylistInfo } from '@/types/channel';

/**
 * Catch-up Xtream (« tv_archive ») : le fournisseur garde quelques jours d'archives
 * pour certaines chaînes. Une émission passée se lit via l'adresse /timeshift/.
 */
export interface CatchupIndex {
  /** Jours d'archive par identifiant de flux Xtream (stream_id). */
  archiveDays: Record<string, number>;
  /** Fuseau horaire du serveur : l'heure de début de l'adresse s'exprime dans ce fuseau. */
  timezone: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cacheKey = (playlistId: string) => `catchupIndex:${playlistId}`;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});

/** Identifiant de flux d'une chaîne Xtream : …/live/user/pass/1234.ts ou …/user/pass/1234. */
export function streamIdOf(channel: Channel): string | null {
  try {
    const path = new URL(channel.url).pathname;
    const match = path.match(/\/(\d+)(?:\.(?:ts|m3u8))?$/i);
    return match ? match[1] : null;
  } catch { return null; }
}

function validTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

export function parseArchiveStreams(data: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    const v = obj(raw);
    const id = String(v.stream_id ?? '');
    if (!/^\d+$/.test(id)) continue;
    const archive = Number(v.tv_archive) === 1;
    const days = Number(v.tv_archive_duration);
    if (archive) out[id] = Number.isFinite(days) && days > 0 ? Math.min(days, 30) : 1;
  }
  return out;
}

async function fetchIndex(account: XtreamAccount): Promise<CatchupIndex> {
  const [streams, info] = await Promise.all([
    catalogRequest(account, 'get_live_streams'),
    catalogRequest(account, '').catch(() => null),
  ]);
  const timezone = validTimezone(obj(obj(info).server_info).timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { archiveDays: parseArchiveStreams(streams), timezone, fetchedAt: Date.now() };
}

/** Index des chaînes avec archives pour une liste Xtream (cache 12 h). null si la liste n'est pas Xtream. */
export async function loadCatchupIndex(playlist: PlaylistInfo, force = false): Promise<CatchupIndex | null> {
  const account = getXtreamAccount(playlist);
  if (!account) return null;
  const cached = await getMeta<CatchupIndex>(cacheKey(playlist.id)).catch(() => undefined);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  try {
    const fresh = await fetchIndex(account);
    await setMeta(cacheKey(playlist.id), fresh).catch(() => {});
    return fresh;
  } catch {
    return cached ?? null;
  }
}

/** Date au format Xtream « AAAA-MM-JJ:HH-MM » dans le fuseau du serveur. */
export function formatTimeshiftStart(date: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
}

export function catchupUrl(account: XtreamAccount, streamId: string, start: Date, end: Date, timezone: string): string {
  const minutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60_000));
  return `${account.server}/timeshift/${encodeURIComponent(account.username)}/${encodeURIComponent(account.password)}/${minutes}/${formatTimeshiftStart(start, timezone)}/${streamId}.ts`;
}

/** Une émission passée (ou en cours) est-elle encore dans la fenêtre d'archive ? */
export function isInArchive(start: Date, days: number, now = Date.now()): boolean {
  return start.getTime() < now && now - start.getTime() <= days * 24 * 60 * 60 * 1000;
}
