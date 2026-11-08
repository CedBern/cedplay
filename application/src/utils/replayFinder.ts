import type { Channel } from '@/types/channel';
import type { EPGData, EPGProgram } from '@/types/epg';
import { replayChannels, type ReplayChannel } from '@/data/replayChannels';
import { isInArchive } from '@/utils/catchup';

/**
 * Replay de la liste IPTV : retrouve, dans le guide déjà chargé, les émissions passées
 * encore dans la fenêtre d'archive du fournisseur. Rien n'est demandé au réseau.
 */

export interface ReplayItem {
  channel: Channel;
  program: EPGProgram;
}

export interface RecentReplayItem extends ReplayItem {
  replayChannel: ReplayChannel;
}

/** Minuscules, sans accents ni ponctuation : sert aux comparaisons de titres et de noms. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

/**
 * Nom de chaîne sans préfixe de pays ni mention de qualité :
 * « FR: TF1 HD » → « tf1 », « |FR| France 2 FHD » → « france 2 », « TF1.fr » → « tf1 ».
 */
export function channelKey(name: string): string {
  const withoutPrefix = name.replace(/^\s*[[(|]?\s*(?:fr|fra|be|ch|ca)\s*[\])|:-]\s*/i, '');
  return normalizeText(withoutPrefix)
    .replace(/\b(?:fhd|uhd|hd|sd|4k|hevc|h265|h264|1080p?|720p?|50fps|backup)\b/g, ' ')
    .replace(/\s+fr$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const replayChannelByKey: Map<string, ReplayChannel> = (() => {
  const map = new Map<string, ReplayChannel>();
  for (const channel of replayChannels) {
    for (const marker of [channel.name, ...channel.epgNames]) {
      const key = channelKey(marker);
      if (key && !map.has(key)) map.set(key, channel);
    }
  }
  return map;
})();

/** Chaîne de replay officielle correspondant à une chaîne de la liste (nom, tvg-name ou tvg-id). */
export function matchReplayChannel(channel: Channel): ReplayChannel | null {
  for (const marker of [channel.name, channel.tvgName, channel.tvgId]) {
    if (!marker) continue;
    const found = replayChannelByKey.get(channelKey(marker));
    if (found) return found;
  }
  return null;
}

const MINUTE = 60_000;

/** Fuseau de diffusion des chaînes de replay officiel (toutes françaises). */
export const BROADCAST_TIME_ZONE = 'Europe/Paris';

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
const zoneOffsets = new Map<string, number>();
const HOUR = 3_600_000;

/** Décalage (minutes) d'un fuseau à un instant donné ; changement d'heure compris. */
function zoneOffsetMinutes(timeZone: string, time: number): number {
  // Le décalage ne change qu'à heure pile : un calcul Intl par heure UTC suffit.
  const bucket = Math.floor(time / HOUR);
  const cacheKey = `${timeZone}|${bucket}`;
  const cached = zoneOffsets.get(cacheKey);
  if (cached !== undefined) return cached;
  let format = zoneFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    zoneFormatters.set(timeZone, format);
  }
  const at = bucket * HOUR;
  const parts = format.formatToParts(at);
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const wall = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour') % 24, value('minute'));
  const offset = Math.round((wall - at) / 60_000);
  zoneOffsets.set(cacheKey, offset);
  return offset;
}

/** Heure décimale (21.5 pour 21:30) dans un fuseau donné, indépendante de celui de l'appareil. */
export function hourInTimeZone(date: Date, timeZone: string): number {
  const time = date.getTime();
  const minutes = Math.floor(time / 60_000) + zoneOffsetMinutes(timeZone, time);
  return (((minutes % 1440) + 1440) % 1440) / 60;
}

/**
 * Soirées récentes des grandes chaînes rejouables dans l'app : émissions terminées,
 * commencées entre 18 h et 23 h à l'heure de diffusion (Paris, quel que soit le fuseau
 * du téléphone), d'au moins 40 minutes, les plus récentes d'abord.
 * Une chaîne présente en plusieurs qualités ne compte qu'une fois.
 */
export function recentReplays(
  channels: Channel[],
  epgData: EPGData | undefined,
  catchupDays: (channel: Channel) => number,
  now: number = Date.now(),
  limit = 20,
): RecentReplayItem[] {
  if (!epgData) return [];
  const seen = new Set<string>();
  const items: RecentReplayItem[] = [];
  for (const channel of channels) {
    const programs = epgData[channel.id];
    if (!programs?.length) continue;
    const replayChannel = matchReplayChannel(channel);
    if (!replayChannel) continue;
    const days = catchupDays(channel);
    if (days <= 0) continue;
    for (const program of programs) {
      const start = program.startTime.getTime();
      const end = program.endTime.getTime();
      if (end > now || end - start < 40 * MINUTE || !isInArchive(program.startTime, days, now)) continue;
      const hour = hourInTimeZone(program.startTime, BROADCAST_TIME_ZONE);
      if (hour < 18 || hour > 23) continue;
      const key = `${replayChannel.id}|${start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ channel, program, replayChannel });
    }
  }
  items.sort((a, b) => b.program.startTime.getTime() - a.program.startTime.getTime());
  return items.slice(0, limit);
}

const normalizedTitles = new WeakMap<EPGProgram, string>();
const titleOf = (program: EPGProgram) => {
  let title = normalizedTitles.get(program);
  if (title === undefined) {
    title = normalizeText(program.title);
    normalizedTitles.set(program, title);
  }
  return title;
};

/** Émissions passées (ou en cours) rejouables dont le titre contient la recherche. */
export function searchReplays(
  channels: Channel[],
  epgData: EPGData | undefined,
  catchupDays: (channel: Channel) => number,
  query: string,
  now: number = Date.now(),
  limit = 30,
): ReplayItem[] {
  const needle = normalizeText(query);
  if (!epgData || needle.length < 2) return [];
  const seen = new Set<string>();
  const items: ReplayItem[] = [];
  for (const channel of channels) {
    const programs = epgData[channel.id];
    if (!programs?.length) continue;
    const days = catchupDays(channel);
    if (days <= 0) continue;
    const key = channelKey(channel.name);
    for (const program of programs) {
      if (!isInArchive(program.startTime, days, now) || !titleOf(program).includes(needle)) continue;
      const id = `${key}|${program.startTime.getTime()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ channel, program });
    }
  }
  items.sort((a, b) => b.program.startTime.getTime() - a.program.startTime.getTime());
  return items.slice(0, limit);
}

/** « Aujourd'hui · 21:10 », « Hier · 21:10 », « Mardi 4 nov. · 21:10 ». */
export function formatReplayDate(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Aujourd’hui · ${time}`;
  if (days === 1) return `Hier · ${time}`;
  const day = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`;
}

/** « 1 h 50 », « 45 min ». */
export function formatDuration(program: EPGProgram): string {
  const minutes = Math.round((program.endTime.getTime() - program.startTime.getTime()) / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}
