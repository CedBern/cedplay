import { EPGProgram, EPGData } from '@/types/epg';
import { Channel } from '@/types/channel';
import type { EpgChannelOverride } from '@/utils/epgConfig';

/** Associations manuelles et décalages appliqués en construisant le guide. */
export interface EPGBuildOptions {
  overrides?: Record<string, EpgChannelOverride> | undefined;
  /** Décalage global de la liste, en heures, ajouté à celui de chaque chaîne. */
  offsetHours?: number | undefined;
  /** Programmes gardés : ceux qui finissent après keepFromMs et commencent avant keepUntilMs (mémoire des grosses listes). */
  keepFromMs?: number | undefined;
  keepUntilMs?: number | undefined;
}

export interface XmltvChannel {
  id: string;
  displayNames: string[];
}

export interface XmltvProgramme {
  channel: string;
  start: Date;
  stop: Date;
  title: string;
  description?: string;
  category?: string;
}

export interface XmltvParsed {
  channels: XmltvChannel[];
  programmes: XmltvProgramme[];
}

/** Parse une date XMLTV (« 20261103120000 +0100 » ou ISO 8601). */
export function parseXmltvDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s+([+-])(\d{2})(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, s, sign, tzh, tzm] = m;
    const tzMinutes = tzh ? (parseInt(tzh, 10) * 60 + parseInt(tzm, 10)) * (sign === '-' ? -1 : 1) : 0;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - tzMinutes * 60000);
  }
  const iso = Date.parse(raw);
  return Number.isNaN(iso) ? null : new Date(iso);
}

function unescapeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripCdata(text: string): string {
  if (!text.includes('<![CDATA[')) return text;
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Parse un fichier XMLTV complet sans dépendre de DOMParser (qui est absent des Web Workers).
 * Fonctionne à haute performance (100k+ programmes analysés en quelques centaines de millisecondes).
 */
export function parseXmltv(xml: string): XmltvParsed {
  if (!xml || (!xml.includes('<tv') && !xml.includes('<programme'))) {
    throw new Error('Fichier XMLTV invalide.');
  }

  const channels: XmltvChannel[] = [];
  const channelRegex = /<channel\s+([^>]*?)>([\s\S]*?)<\/channel>/gi;
  let m: RegExpExecArray | null;
  while ((m = channelRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const idMatch = attrs.match(/\bid="([^"]+)"/i) || attrs.match(/\bid='([^']+)'/i);
    if (!idMatch) continue;
    const id = idMatch[1];
    const displayNames: string[] = [];
    const dnRegex = /<display-name[^>]*>([\s\S]*?)<\/display-name>/gi;
    let dnm: RegExpExecArray | null;
    while ((dnm = dnRegex.exec(body)) !== null) {
      const clean = unescapeXml(stripCdata(dnm[1])).trim();
      if (clean) displayNames.push(clean);
    }
    channels.push({ id, displayNames });
  }

  const programmes: XmltvProgramme[] = [];
  const progRegex = /<programme\s+([^>]*?)>([\s\S]*?)<\/programme>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = progRegex.exec(xml)) !== null) {
    const attrs = pm[1];
    const body = pm[2];
    const chMatch = attrs.match(/\bchannel="([^"]+)"/i) || attrs.match(/\bchannel='([^']+)'/i);
    const startMatch = attrs.match(/\bstart="([^"]+)"/i) || attrs.match(/\bstart='([^']+)'/i);
    const stopMatch = attrs.match(/\bstop="([^"]+)"/i) || attrs.match(/\bstop='([^']+)'/i);
    if (!chMatch || !startMatch || !stopMatch) continue;

    const start = parseXmltvDate(startMatch[1]);
    const stop = parseXmltvDate(stopMatch[1]);
    if (!start || !stop || stop <= start) continue;

    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    const title = unescapeXml(stripCdata(titleMatch[1])).trim();
    if (!title) continue;

    const descMatch = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
    const description = descMatch ? unescapeXml(stripCdata(descMatch[1])).trim() : undefined;

    const catMatch = body.match(/<category[^>]*>([\s\S]*?)<\/category>/i);
    const category = catMatch ? unescapeXml(stripCdata(catMatch[1])).trim() : undefined;

    programmes.push({
      channel: chMatch[1],
      start,
      stop,
      title,
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
    });
  }

  return { channels, programmes };
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const stripPrefix = (s: string) => s.replace(/^(?:[a-z]{2,3}\s*[:|-]\s*|\([a-z]{2,3}\)\s*|\|\s*[a-z0-9]+\s*\|\s*)/i, '').trim();

/**
 * Associe les programmes XMLTV aux chaînes : association manuelle d'abord, sinon par
 * tvg-id puis par nom. Applique le décalage horaire (tvg-shift, réglages du guide).
 */
export function buildEPGData(parsed: XmltvParsed, channels: Channel[], options: EPGBuildOptions = {}): EPGData {
  const data: EPGData = {};
  if (!parsed.programmes.length) return data;

  const byXmlId = new Map(parsed.channels.map(c => [c.id, c]));
  const nameIndex = new Map<string, string>(); // display-name normalisé -> xml id
  for (const c of parsed.channels) {
    for (const n of c.displayNames) {
      const normalized = norm(n);
      if (!nameIndex.has(normalized)) nameIndex.set(normalized, c.id);
      const withoutPrefix = norm(stripPrefix(n));
      if (!nameIndex.has(withoutPrefix)) nameIndex.set(withoutPrefix, c.id);
    }
  }

  const programmesByXml = new Map<string, XmltvProgramme[]>();
  for (const p of parsed.programmes) {
    const list = programmesByXml.get(p.channel);
    if (list) list.push(p); else programmesByXml.set(p.channel, [p]);
  }

  for (const channel of channels) {
    let xmlId: string | undefined;
    const override = options.overrides?.[channel.id];
    // 0. Association manuelle : elle seule compte, même si elle n'existe pas dans cette source.
    if (override?.xmltvId) {
      if (programmesByXml.has(override.xmltvId)) xmlId = override.xmltvId;
      else continue;
    }
    // 1. Match par tvgId direct dans les programmes ou dans les chaînes déclarées
    else if (channel.tvgId) {
      if (programmesByXml.has(channel.tvgId)) xmlId = channel.tvgId;
      else if (byXmlId.has(channel.tvgId)) xmlId = channel.tvgId;
    }
    // 2. Match par nom de chaîne ou tvgName (avec et sans préfixe pays ex: FR: TF1 HD -> TF1 HD)
    if (!xmlId) {
      for (const rawName of [channel.tvgName, channel.name].filter((n): n is string => !!n)) {
        const n = norm(rawName);
        let found = nameIndex.get(n) || (programmesByXml.has(rawName) ? rawName : undefined);
        if (!found) {
          const stripped = norm(stripPrefix(rawName));
          found = nameIndex.get(stripped) || (programmesByXml.has(stripped) ? stripped : undefined);
        }
        if (found) { xmlId = found; break; }
      }
    }
    if (!xmlId) continue;
    const shiftMs = ((override?.shift ?? channel.tvgShift ?? 0) + (options.offsetHours ?? 0)) * 3_600_000;
    const keepFrom = options.keepFromMs ?? -Infinity;
    const keepUntil = options.keepUntilMs ?? Infinity;
    const programmes = (programmesByXml.get(xmlId) || [])
      .filter(p => p.stop.getTime() + shiftMs > keepFrom && p.start.getTime() + shiftMs < keepUntil)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map<EPGProgram>(p => {
        const startTime = shiftMs ? new Date(p.start.getTime() + shiftMs) : p.start;
        return {
          id: `${channel.id}_${startTime.getTime()}`,
          channelId: channel.id,
          title: p.title,
          ...(p.description ? { description: p.description } : {}),
          ...(p.category ? { category: p.category } : {}),
          startTime,
          endTime: shiftMs ? new Date(p.stop.getTime() + shiftMs) : p.stop,
        };
      });
    if (programmes.length) data[channel.id] = programmes;
  }
  return data;
}

/**
 * Fusionne plusieurs guides : pour chaque chaîne, la première source (dans l'ordre
 * donné) qui a des programmes l'emporte. Les sources suivantes complètent les autres.
 */
export function buildMergedEPGData(sources: XmltvParsed[], channels: Channel[], options: EPGBuildOptions = {}): EPGData {
  const data: EPGData = {};
  let missing = channels;
  for (const parsed of sources) {
    if (!missing.length) break;
    Object.assign(data, buildEPGData(parsed, missing, options));
    missing = missing.filter(c => !data[c.id]);
  }
  return data;
}

/** Chaînes déclarées par un guide (sans lire les programmes) : liste du choix manuel. */
export function listXmltvChannels(xml: string): XmltvChannel[] {
  const channels: XmltvChannel[] = [];
  const channelRegex = /<channel\s+([^>]*?)>([\s\S]*?)<\/channel>/gi;
  let m: RegExpExecArray | null;
  while ((m = channelRegex.exec(xml)) !== null) {
    const idMatch = m[1].match(/\bid="([^"]+)"/i) || m[1].match(/\bid='([^']+)'/i);
    if (!idMatch) continue;
    const displayNames: string[] = [];
    const dnRegex = /<display-name[^>]*>([\s\S]*?)<\/display-name>/gi;
    let dnm: RegExpExecArray | null;
    while ((dnm = dnRegex.exec(m[2])) !== null) {
      const clean = unescapeXml(stripCdata(dnm[1])).trim();
      if (clean) displayNames.push(clean);
    }
    // Identifiant brut, comme l'attribut channel des programmes auquel il sera comparé.
    channels.push({ id: idMatch[1], displayNames });
  }
  return channels;
}

/** Cherche le programme en cours par dichotomie (les programmes sont triés par début). */
export function getCurrentProgram(channelId: string, epgData: EPGData, now: Date = new Date()): EPGProgram | null {
  const programs = epgData[channelId];
  if (!programs || !programs.length) return null;
  // Dernier programme commencé à ou avant `now`.
  let lo = 0, hi = programs.length - 1, started = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (programs[mid].startTime <= now) { started = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (started < 0) return null;
  const program = programs[started];
  return program.endTime > now ? program : null;
}

/** Cherche le programme suivant par dichotomie (les programmes sont triés par début). */
export function getUpcomingProgram(channelId: string, epgData: EPGData, now: Date = new Date()): EPGProgram | null {
  const programs = epgData[channelId];
  if (!programs || !programs.length) return null;
  let lo = 0, hi = programs.length - 1, next = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (programs[mid].startTime > now) { next = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return next >= 0 ? programs[next] : null;
}

export function getProgramProgress(program: EPGProgram): number {
  const now = new Date();
  const totalDuration = program.endTime.getTime() - program.startTime.getTime();
  const elapsed = now.getTime() - program.startTime.getTime();
  return Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
