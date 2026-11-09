import type { EPGData, EPGProgram } from '@/types/epg';

const FORMAT = 'cedplay-epg-packed';
const STRIDE = 8;

/** Les textes partagés ne traversent le worker ou IndexedDB qu'une seule fois. */
export interface PackedEPGData {
  format: typeof FORMAT;
  version: 1;
  strings: string[];
  channels: Record<string, Float64Array>;
}

export function packEPGData(data: EPGData): PackedEPGData {
  const strings: string[] = [];
  const indices = new Map<string, number>();
  const intern = (value: string): number => {
    const saved = indices.get(value);
    if (saved !== undefined) return saved;
    const index = strings.length;
    indices.set(value, index);
    strings.push(value);
    return index;
  };
  const optional = (value: string | undefined) => value === undefined ? -1 : intern(value);
  const channels: Record<string, Float64Array> = Object.create(null);
  for (const [channelId, programmes] of Object.entries(data)) {
    const rows = new Float64Array(programmes.length * STRIDE);
    for (let i = 0; i < programmes.length; i++) {
      const p = programmes[i];
      const offset = i * STRIDE;
      const start = p.startTime.getTime();
      rows[offset] = start;
      rows[offset + 1] = p.endTime.getTime();
      rows[offset + 2] = intern(p.title);
      rows[offset + 3] = optional(p.description);
      rows[offset + 4] = optional(p.category);
      rows[offset + 5] = p.id === `${channelId}_${start}` ? -1 : intern(p.id);
      rows[offset + 6] = p.channelId === channelId ? -1 : intern(p.channelId);
      rows[offset + 7] = optional(p.rating);
    }
    channels[channelId] = rows;
  }
  return { format: FORMAT, version: 1, strings, channels };
}

export function unpackEPGData(value: unknown): EPGData {
  const invalid = () => new Error('Cache du guide illisible.');
  if (!value || typeof value !== 'object') throw invalid();
  const packed = value as Partial<PackedEPGData>;
  if (packed.format !== FORMAT || packed.version !== 1 || !Array.isArray(packed.strings)
      || !packed.strings.every(text => typeof text === 'string')
      || !packed.channels || typeof packed.channels !== 'object' || Array.isArray(packed.channels)) throw invalid();
  const strings = packed.strings;
  const text = (index: number): string => {
    if (!Number.isInteger(index) || index < 0 || index >= strings.length) throw invalid();
    return strings[index];
  };
  // Les consommateurs du guide lisent les dates ; leurs calculs modifient des copies.
  const dates = new Map<number, Date>();
  const date = (epoch: number): Date => {
    if (!Number.isFinite(epoch) || Math.abs(epoch) > 8_640_000_000_000_000) throw invalid();
    let saved = dates.get(epoch);
    if (!saved) { saved = new Date(epoch); dates.set(epoch, saved); }
    return saved;
  };
  const data: EPGData = {};
  for (const [channelId, rows] of Object.entries(packed.channels)) {
    if (!ArrayBuffer.isView(rows) || Object.prototype.toString.call(rows) !== '[object Float64Array]'
        || rows.length % STRIDE !== 0) throw invalid();
    const programmes = new Array<EPGProgram>(rows.length / STRIDE);
    for (let offset = 0, i = 0; offset < rows.length; offset += STRIDE, i++) {
      // Pas de spread conditionnel : un million d'émissions sur la box, trois objets
      // temporaires par émission coûtaient des secondes au démarrage du guide.
      const program: EPGProgram = {
        id: rows[offset + 5] === -1 ? `${channelId}_${rows[offset]}` : text(rows[offset + 5]),
        channelId: rows[offset + 6] === -1 ? channelId : text(rows[offset + 6]),
        title: text(rows[offset + 2]),
        startTime: date(rows[offset]),
        endTime: date(rows[offset + 1]),
      };
      const description = rows[offset + 3];
      if (description !== -1) program.description = text(description);
      const category = rows[offset + 4];
      if (category !== -1) program.category = text(category);
      const rating = rows[offset + 7];
      if (rating !== -1) program.rating = text(rating);
      programmes[i] = program;
    }
    Object.defineProperty(data, channelId, { value: programmes, enumerable: true, writable: true, configurable: true });
  }
  return data;
}
