import { Channel, ChannelGroup, PlaylistInfo } from '@/types/channel';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { assertImportSize, decodeImportText } from '@/utils/textImport';

/** Valeurs de l'en-tête #EXTM3U appliquées aux chaînes qui ne les précisent pas. */
interface M3UHeader {
  epgUrls?: string[];
  catchup?: string;
  catchupSource?: string;
  catchupDays?: number;
  tvgShift?: number;
}

/**
 * Attributs M3U reconnus (la première occurrence l'emporte). Le lookbehind évite que
 * « catchup » attrape « catchup-source » ou que « logo » attrape « tvg-logo ».
 */
const ATTRIBUTE_PATTERNS: Array<[string, RegExp]> = ([
  ['tvg-id', 'tvgId'], ['tvg-name', 'tvgName'], ['tvg-logo', 'tvgLogo'], ['tvg-chno', 'chno'],
  ['group-title', 'groupTitle'], ['logo', 'logo'], ['group', 'group'], ['tvg-shift', 'tvgShift'],
  ['catchup', 'catchup'], ['catchup-type', 'catchupType'], ['catchup-source', 'catchupSource'],
  ['catchup-days', 'catchupDays'], ['timeshift', 'timeshift'], ['tvg-rec', 'tvgRec'],
  ['url-tvg', 'urlTvg'], ['x-tvg-url', 'xTvgUrl'], ['tvg-url', 'tvgUrl'],
] as const).map(([attr, key]) => [key, new RegExp(`(?<![\\w-])${attr}="([^"]*)"`, 'i')]);

/** Jours d'archive retenus quand la liste active le replay sans préciser de durée. */
const DEFAULT_CATCHUP_DAYS = 5;

const QUALITY_REGEXES: Array<[RegExp, Channel['quality']]> = [
  [/\b(2160p|4k|uhd)\b/i, '4K'],
  [/\b(1080p|full ?hd|fhd)\b/i, 'FHD'],
  [/\b(720p|hd)\b/i, 'HD'],
  [/\b(480p|sd)\b/i, 'SD']
];

function parseDays(raw: string | undefined): number | undefined {
  const days = raw === undefined ? NaN : parseInt(raw, 10);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 30) : undefined;
}

/** tvg-shift en heures (« +1 », « -2.5 ») ; borné à ±24 h. */
function parseShift(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const shift = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(shift) && Math.abs(shift) <= 24 ? shift : undefined;
}

export class M3UParser {
  /** Basic channel name sanitization: trim, remove control chars & simple HTML-like tags */
  private static sanitizeName(raw: string): string {
    if (!raw) return '';
    // Strip control characters except common whitespace
    // Remove control chars (0x00-0x1F,0x7F) manually to avoid lint regex restrictions
    let filtered = '';
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      if ((code >= 0x00 && code <= 0x1F) || code === 0x7F) {
        filtered += ' ';
      } else {
        filtered += raw[i];
      }
    }
    let s = filtered.replace(/\s+/g, ' ').trim();
    // Remove any rudimentary HTML tags to prevent accidental future innerHTML usage issues
    s = s.replace(/<[^>]+>/g, '');
    return s.slice(0, 300); // bound length
  }
  /**
   * Synchronous parse (legacy path) – kept for quick small playlists.
   */
  static parseM3U(content: string, playlistName: string = 'Imported Playlist'): PlaylistInfo {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const channels: Channel[] = [];
    let currentChannel: Partial<Channel> = {};
    let channelId = 0;
    let header: M3UHeader = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('#EXTM3U')) {
        header = this.extractHeader(line);
      } else if (line.startsWith('#EXTINF:')) {
        currentChannel = this.channelFromExtinf(line, ++channelId, header);
      } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://') || line.startsWith('rtsp://')) {
        // This is a stream URL
        if (currentChannel.name) {
          // Fallback quality detection from URL if not already set
          if (!currentChannel.quality) {
            const urlLower = line.toLowerCase();
            if (/2160|\b4k\b|uhd/.test(urlLower)) currentChannel.quality = '4K';
            else if (/1080|fullhd|fhd/.test(urlLower)) currentChannel.quality = 'FHD';
            else if (/720/.test(urlLower)) currentChannel.quality = 'HD';
            else if (/480|sd/.test(urlLower)) currentChannel.quality = 'SD';
          }
          currentChannel.url = line;
          currentChannel.id = uuidv5(`${playlistName}\0${currentChannel.tvgId || currentChannel.name}\0${line}`, uuidv5.URL);
          channels.push(currentChannel as Channel);
          currentChannel = {};
        }
      }
    }

  const totalBefore = channels.length;
  // Reuse progressive variant-aware dedup for consistency
  const deduped = this.deduplicateChannels(channels);
  return this.finalizePlaylist(deduped, playlistName, totalBefore, header.epgUrls);
  }

  /**
   * Progressive async parser with progress callback. Useful for large playlists to avoid blocking the UI.
   * onProgress receives (percent, channelsParsedSoFar).
   */
  static async parseM3UWithProgress(
    content: string,
    playlistName: string = 'Imported Playlist',
    onProgress?: (percent: number, channelsParsed: number) => void,
    batchSize: number = 500
  ): Promise<PlaylistInfo> {
    // File parsing stays offline; URL imports use the explicit URL entry point.
    if (batchSize < 1) throw new Error('Taille de lot invalide.');
    assertImportSize(content.length, 'playlist');
    const rawLines = content.split('\n');
    const lines = rawLines.map(l => l.trim()).filter(l => l);
    const totalLines = lines.length;
    const channels: Channel[] = [];
    let currentChannel: Partial<Channel> = {};
    let channelId = 0;
    let header: M3UHeader = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXTM3U')) {
        header = this.extractHeader(line);
      } else if (line.startsWith('#EXTINF:')) {
        currentChannel = this.channelFromExtinf(line, ++channelId, header);
      } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://') || line.startsWith('rtsp://')) {
        if (currentChannel.name) {
          if (!currentChannel.quality) {
            const urlLower = line.toLowerCase();
            if (/2160|\b4k\b|uhd/.test(urlLower)) currentChannel.quality = '4K';
            else if (/1080|fullhd|fhd/.test(urlLower)) currentChannel.quality = 'FHD';
            else if (/720/.test(urlLower)) currentChannel.quality = 'HD';
            else if (/480|sd/.test(urlLower)) currentChannel.quality = 'SD';
          }
          currentChannel.url = line;
          currentChannel.id = uuidv5(`${playlistName}\0${currentChannel.tvgId || currentChannel.name}\0${line}`, uuidv5.URL);
          channels.push(currentChannel as Channel);
          currentChannel = {};
        }
      }

      // Batch yielding to avoid blocking main thread
      if (i % batchSize === 0 || i === lines.length - 1) {
        const percent = Math.min(100, Math.round(((i + 1) / totalLines) * 100));
        onProgress?.(percent, channels.length);
        // Yield control
        await new Promise(r => setTimeout(r, 0));
      }
    }

    const totalBefore = channels.length;
    // Dedup + finalize
    const playlist = this.finalizePlaylist(this.deduplicateChannels(channels), playlistName, totalBefore, header.epgUrls);
    onProgress?.(100, playlist.channels.length);
    return playlist;
  }

  private static deduplicateChannels(channels: Channel[]): Channel[] {
    const qualityRank: Record<string, number> = { '4K': 5, 'UHD': 5, 'FHD': 4, 'HD': 3, 'SD': 2 };
    const norm = (s?: string) => (s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .normalize('NFC')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim();
    const map = new Map<string, Channel>();
    const seenIds = new Set<string>();
    for (const ch of channels) {
      if (seenIds.has(ch.id)) continue;
      seenIds.add(ch.id);
      const key = ch.tvgId ? `id:${ch.tvgId}` : `name:${ch.group || ''}:${norm(ch.name)}`;
      const existing = map.get(key);
      if (!existing) map.set(key, ch);
      else {
        const existingRank = qualityRank[existing.quality || ''] || 1;
        const newRank = qualityRank[ch.quality || ''] || 1;
        if (newRank > existingRank) {
          // Move existing into variants of new (strip existing.variants)
          const { variants: _drop, ...existingSansVariants } = existing;
          const { variants: _drop2, ...chSansVariants } = ch;
          map.set(key, {
            ...chSansVariants,
            ...(existing.isFavorite ? { isFavorite: true } : {}),
            variants: [...(ch.variants || []), existingSansVariants, ...(existing.variants || [])]
          });
        } else {
          // Append the new one as a variant of existing best
          if (!existing.variants) existing.variants = [];
          const { variants: _drop, ...chSansVariants } = ch;
          existing.variants.push(chSansVariants);
        }
      }
    }
    return Array.from(map.values());
  }

  private static finalizePlaylist(channels: Channel[], playlistName: string, totalBefore: number, epgUrls?: string[]): PlaylistInfo {
    const groupMap = new Map<string, Channel[]>();
    channels.forEach(channel => {
      const groupName = channel.group || 'Ungrouped';
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName)!.push(channel);
    });
    const groups: ChannelGroup[] = Array.from(groupMap.entries()).map(([name, channels]) => ({ name, channels }));
    return {
      id: uuidv4(),
      name: playlistName,
      channels,
      groups,
      ...(epgUrls?.length ? { epgUrls } : {}),
      totalChannelsBeforeDedup: totalBefore
    };
  }

  /** Attributs de l'en-tête #EXTM3U : guides XMLTV et valeurs par défaut du replay et du décalage. */
  private static extractHeader(line: string): M3UHeader {
    const meta = this.extractMetadata(line.replace(/^#EXTM3U/, ''));
    const epgUrls = [meta.urlTvg, meta.xTvgUrl, meta.tvgUrl]
      .filter((v): v is string => !!v)
      .flatMap(v => v.split(','))
      .map(v => v.trim())
      .filter(v => /^https?:\/\//i.test(v));
    const header: M3UHeader = {};
    if (epgUrls.length) header.epgUrls = [...new Set(epgUrls)];
    const catchup = (meta.catchup || meta.catchupType)?.trim();
    if (catchup) header.catchup = catchup.toLowerCase();
    if (meta.catchupSource?.trim()) header.catchupSource = meta.catchupSource.trim();
    const days = parseDays(meta.catchupDays ?? meta.timeshift ?? meta.tvgRec);
    if (days) header.catchupDays = days;
    const shift = parseShift(meta.tvgShift);
    if (shift !== undefined) header.tvgShift = shift;
    return header;
  }

  /** Construit une chaîne à partir d'une ligne #EXTINF (l'adresse arrive à la ligne suivante). */
  private static channelFromExtinf(line: string, index: number, header: M3UHeader): Partial<Channel> {
    const duration = this.extractDuration(line);
    const metadata = this.extractMetadata(line);
    const name = this.sanitizeName(this.extractName(line));
    let quality: Channel['quality'] | undefined;
    for (const [re, q] of QUALITY_REGEXES) { if (re.test(name)) { quality = q; break; } }
    const channel: Partial<Channel> = {
      id: `channel_${index}`,
      name: name || `Channel ${index}`,
      duration: duration,
      logo: metadata.tvgLogo || metadata.logo,
      group: metadata.groupTitle || metadata.group,
      tvgId: metadata.tvgId,
      tvgName: metadata.tvgName,
      ...(metadata.chno ? { chno: metadata.chno } : {}),
      isFavorite: false
    };
    if (quality) channel.quality = quality;
    const shift = parseShift(metadata.tvgShift) ?? header.tvgShift;
    if (shift) channel.tvgShift = shift;
    const ownMode = (metadata.catchup || metadata.catchupType)?.trim().toLowerCase();
    const ownDays = parseDays(metadata.catchupDays ?? metadata.timeshift ?? metadata.tvgRec);
    // Une chaîne qui ne déclare que des jours d'archive hérite du mode de l'en-tête (ou « default »).
    const catchup = ownMode || header.catchup || (ownDays ? 'default' : undefined);
    if (catchup && catchup !== 'disabled' && catchup !== 'none') {
      channel.catchup = catchup;
      const source = metadata.catchupSource?.trim() || header.catchupSource;
      if (source) channel.catchupSource = source;
      channel.catchupDays = ownDays ?? header.catchupDays ?? DEFAULT_CATCHUP_DAYS;
    }
    return channel;
  }

  private static extractDuration(line: string): number {
    const match = line.match(/#EXTINF:\s*(-?\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : -1;
  }

  private static extractName(line: string): string {
    const commaIndex = this.metadataEnd(line);
    if (commaIndex !== -1 && commaIndex < line.length - 1) {
      return line.substring(commaIndex + 1).trim();
    }
    return '';
  }

  private static extractMetadata(line: string): Record<string, string> {
    const metadata: Record<string, string> = {};
    
    // Extract attributes between #EXTINF: and the comma
    const commaIndex = this.metadataEnd(line);
    const attributesSection = commaIndex !== -1 ? line.substring(0, commaIndex) : line;
    
    for (const [key, pattern] of ATTRIBUTE_PATTERNS) {
      const match = attributesSection.match(pattern);
      if (match) metadata[key] = match[1];
    }
    return metadata;
  }

  private static metadataEnd(line: string): number {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ',' && !quoted) return i;
    }
    return -1;
  }

  static async parseFromFile(file: File): Promise<PlaylistInfo> {
    assertImportSize(file.size, 'playlist');
    const content = decodeImportText(new Uint8Array(await file.arrayBuffer()), 'playlist');
    return this.parseM3U(content, file.name);
  }

  static async parseFromFileWithProgress(file: File, onProgress?: (percent: number, channelsParsed: number) => void): Promise<PlaylistInfo> {
    assertImportSize(file.size, 'playlist');
    const content = decodeImportText(new Uint8Array(await file.arrayBuffer()), 'playlist');
    return this.parseM3UWithProgress(content, file.name, onProgress);
  }

  static async parseFromUrl(url: string): Promise<PlaylistInfo> {
    return this.parseFromUrlWithProgress(url);
  }

  static async parseFromUrlWithProgress(url: string, onProgress?: (percent: number, channelsParsed: number) => void): Promise<PlaylistInfo> {
    const { CORSProxy } = await import('./corsProxy');
    const content = await CORSProxy.fetchWithProxy(url);
    if (!content.includes('#EXTINF:') || content.trim().startsWith('<')) {
      throw new Error('Le serveur ne renvoie pas une liste de chaînes M3U.');
    }
    // Keep credentials and paths out of playlist names and logs.
    return this.parseM3UWithProgress(content, `Liste — ${new URL(url).hostname}`, onProgress);
  }
}
