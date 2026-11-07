import type { Channel } from '@/types/channel';

/**
 * Replay des listes M3U standard (attributs catchup, catchup-source, catchup-days),
 * selon les conventions reprises par la plupart des lecteurs IPTV :
 *  - default / vod : catchup-source est l'adresse complète, avec des variables ;
 *  - append        : catchup-source est ajouté à l'adresse de la chaîne ;
 *  - shift/archive : ?utc=…&lutc=… ajouté à l'adresse de la chaîne ;
 *  - flussonic/fs  : adresse d'archive Flussonic déduite de l'adresse de la chaîne ;
 *  - xc            : adresse /timeshift/ Xtream déduite de l'adresse de la chaîne.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Formate une date avec les lettres Y m d H M S (heure locale) ; le reste est recopié. */
function formatDate(date: Date, format: string): string {
  const parts: Record<string, string> = {
    Y: String(date.getFullYear()), m: pad(date.getMonth() + 1), d: pad(date.getDate()),
    H: pad(date.getHours()), M: pad(date.getMinutes()), S: pad(date.getSeconds()),
  };
  return format.replace(/[YmdHMS]/g, c => parts[c]);
}

/** Remplace les variables d'un modèle d'adresse de replay. */
export function fillCatchupTemplate(template: string, start: Date, end: Date, now: Date = new Date()): string {
  const duration = Math.max(0, seconds(end) - seconds(start));
  const offset = Math.max(0, seconds(now) - seconds(start));
  const dateOf = (name: string): Date | null => {
    switch (name) {
      case 'utc': case 'start': return start;
      case 'utcend': case 'end': return end;
      case 'lutc': case 'now': case 'timestamp': return now;
      default: return null;
    }
  };
  return template
    // {utc:YmdHMS}, ${start:Y-m-d}… : date formatée.
    .replace(/\$?\{(utc|start|utcend|end|lutc|now|timestamp):([^}]+)\}/g, (_, name: string, format: string) => formatDate(dateOf(name)!, format))
    // {duration:60}, {offset:1} : valeur en secondes divisée par le nombre donné.
    .replace(/\$?\{(duration|offset):(\d+)\}/g, (_, name: string, div: string) => String(Math.floor((name === 'duration' ? duration : offset) / Math.max(1, Number(div)))))
    .replace(/\$?\{(utc|start|utcend|end|lutc|now|timestamp)\}/g, (_, name: string) => String(seconds(dateOf(name)!)))
    .replace(/\$?\{duration\}/g, String(duration))
    .replace(/\$?\{offset\}/g, String(offset))
    .replace(/\{([YmdHMS])\}/g, (_, c: string) => formatDate(start, c));
}

const appendQuery = (url: string, query: string) => url + (url.includes('?') ? '&' : '?') + query;

/** Modèle Flussonic déduit de l'adresse de la chaîne (HLS ou MPEG-TS). */
function flussonicTemplate(url: string): string | null {
  const match = url.match(/^(https?:\/\/[^/]+)\/(.+)\/([^/]*?)(mpegts|\.m3u8)(\?.*)?$/i);
  if (!match) return null;
  const [, host, stream, name, kind, query = ''] = match;
  if (kind.toLowerCase() === 'mpegts') return `${host}/${stream}/archive-{utc}-{duration}.ts${query}`;
  return `${host}/${stream}/${name || 'index'}-{utc}-{duration}.m3u8${query}`;
}

/** Modèle Xtream (/timeshift/) déduit d'une adresse …/live/utilisateur/mot-de-passe/1234.ts. */
function xtreamTemplate(url: string): string | null {
  const match = url.match(/^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.(?:ts|m3u8))?(?:\?.*)?$/i);
  if (!match) return null;
  const [, host, user, pass, id] = match;
  return `${host}/timeshift/${user}/${pass}/{duration:60}/{Y}-{m}-{d}:{H}-{M}/${id}.ts`;
}

/** La chaîne déclare-t-elle un replay M3U utilisable ? */
export function hasM3UCatchup(channel: Channel): boolean {
  return !!channel.catchup && (channel.catchupDays ?? 0) > 0 && catchupTemplate(channel) !== null;
}

/** Jours d'archive annoncés par la liste M3U pour cette chaîne (0 sans replay). */
export function m3uCatchupDays(channel: Channel): number {
  return hasM3UCatchup(channel) ? channel.catchupDays ?? 0 : 0;
}

function catchupTemplate(channel: Channel): string | null {
  const mode = (channel.catchup || '').toLowerCase();
  const source = channel.catchupSource?.trim();
  switch (mode) {
    case 'append':
      return source ? channel.url + source : null;
    case 'shift':
    case 'archive':
    case 'timeshift':
      return appendQuery(channel.url, 'utc={utc}&lutc={lutc}');
    case 'flussonic':
    case 'flussonic-hls':
    case 'flussonic-ts':
    case 'fs':
      return source || flussonicTemplate(channel.url);
    case 'xc':
      return source || xtreamTemplate(channel.url);
    default:
      // default, vod, et modes inconnus : l'adresse vient de catchup-source.
      if (!source) return null;
      // Certaines listes donnent une simple suite de paramètres : on l'ajoute à l'adresse.
      if (source.startsWith('?') || source.startsWith('&')) return source.startsWith('?') && !channel.url.includes('?') ? channel.url + source : appendQuery(channel.url, source.slice(1));
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : null;
  }
}

/** Adresse de lecture d'une émission passée, ou null si la chaîne n'a pas de replay M3U. */
export function m3uCatchupUrl(channel: Channel, start: Date, end: Date, now: Date = new Date()): string | null {
  const template = catchupTemplate(channel);
  if (!template) return null;
  return fillCatchupTemplate(template, start, end, now);
}
