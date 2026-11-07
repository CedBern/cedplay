import { getMeta, setMeta } from '@/utils/idb';

/**
 * Réglages du guide propres à une liste : sources XMLTV ajoutées à la main,
 * décalage horaire global et associations manuelles chaîne ↔ guide.
 */
export interface EpgChannelOverride {
  /** Identifiant de la chaîne dans le guide XMLTV (association manuelle). */
  xmltvId?: string;
  /** Décalage en heures, remplace le tvg-shift de la liste. */
  shift?: number;
}

export interface EpgConfig {
  extraUrls: string[];
  offsetHours: number;
  channels: Record<string, EpgChannelOverride>;
}

export const EPG_CONFIG_EVENT = 'epg-config-updated';
const key = (playlistId: string) => `epgConfig:${playlistId}`;

export const emptyEpgConfig = (): EpgConfig => ({ extraUrls: [], offsetHours: 0, channels: {} });

/** Adresse http(s) valide, ou null. */
export function normalizeEpgUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

const clampShift = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 24 ? Math.round(n * 4) / 4 : undefined;
};

function sanitize(raw: unknown): EpgConfig {
  const config = emptyEpgConfig();
  if (!raw || typeof raw !== 'object') return config;
  const value = raw as Partial<EpgConfig>;
  if (Array.isArray(value.extraUrls)) {
    config.extraUrls = [...new Set(value.extraUrls.map(u => (typeof u === 'string' ? normalizeEpgUrl(u) : null)).filter((u): u is string => !!u))].slice(0, 10);
  }
  config.offsetHours = clampShift(value.offsetHours) ?? 0;
  if (value.channels && typeof value.channels === 'object') {
    for (const [channelId, override] of Object.entries(value.channels)) {
      if (!override || typeof override !== 'object') continue;
      const entry: EpgChannelOverride = {};
      if (typeof override.xmltvId === 'string' && override.xmltvId.trim()) entry.xmltvId = override.xmltvId.trim().slice(0, 300);
      const shift = clampShift(override.shift);
      if (shift !== undefined && override.shift !== undefined) entry.shift = shift;
      if (entry.xmltvId !== undefined || entry.shift !== undefined) config.channels[channelId] = entry;
    }
  }
  return config;
}

export async function getEpgConfig(playlistId: string): Promise<EpgConfig> {
  try { return sanitize(await getMeta<EpgConfig>(key(playlistId))); } catch { return emptyEpgConfig(); }
}

export async function saveEpgConfig(playlistId: string, config: EpgConfig): Promise<EpgConfig> {
  const clean = sanitize(config);
  await setMeta(key(playlistId), clean);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EPG_CONFIG_EVENT, { detail: { playlistId } }));
  return clean;
}

/** Empreinte des réglages qui changent le résultat du guide (cache du guide analysé). */
export function epgConfigSignature(config: EpgConfig): string {
  const channels = Object.keys(config.channels).sort().map(id => `${id}=${config.channels[id].xmltvId ?? ''}/${config.channels[id].shift ?? ''}`);
  return `${config.offsetHours}|${channels.join(',')}`;
}
