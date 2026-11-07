import type { EPGData } from '@/types/epg';

export interface EpgMemoryStats {
  channels: number;
  programmes: number;
  /** Estimation de la place du guide dans la mémoire de la page, en octets. */
  estimatedBytes: number;
}

/**
 * Estimation grossière mais stable : chaque programme coûte un objet, deux dates et ses
 * textes (2 octets par caractère dans le moteur JavaScript). Sert à comparer sur la box.
 */
export function epgMemoryStats(data: EPGData | null | undefined): EpgMemoryStats {
  let channels = 0, programmes = 0, bytes = 0;
  if (!data) return { channels, programmes, estimatedBytes: 0 };
  for (const list of Object.values(data)) {
    if (!list?.length) continue;
    channels++;
    for (const p of list) {
      programmes++;
      bytes += 160 + 2 * ((p.id?.length ?? 0) + (p.title?.length ?? 0) + (p.description?.length ?? 0) + (p.category?.length ?? 0));
    }
  }
  return { channels, programmes, estimatedBytes: bytes };
}

/** Mémoire JavaScript utilisée et limite (WebView Chrome seulement), en octets. */
export function jsHeap(): { used: number; limit: number } | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
  return memory?.usedJSHeapSize ? { used: memory.usedJSHeapSize, limit: memory.jsHeapSizeLimit ?? 0 } : null;
}

export const megabytes = (bytes: number) => `${(bytes / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
