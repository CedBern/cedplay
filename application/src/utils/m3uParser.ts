import { Channel, ChannelGroup, PlaylistInfo } from '@/types/channel';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

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

    const qualityRegexes: Array<[RegExp, Channel['quality']]> = [
      [/\b(2160p|4k|uhd)\b/i, '4K'],
      [/\b(1080p|full ?hd|fhd)\b/i, 'FHD'],
      [/\b(720p|hd)\b/i, 'HD'],
      [/\b(480p|sd)\b/i, 'SD']
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('#EXTINF:')) {
        // Parse EXTINF line
        const duration = this.extractDuration(line);
        const metadata = this.extractMetadata(line);
  const name = this.sanitizeName(this.extractName(line));
        
        let quality: Channel['quality'] | undefined;
        for (const [re, q] of qualityRegexes) {
          if (re.test(name)) { quality = q; break; }
        }

        const baseChannel: Partial<Channel> = {
          id: `channel_${++channelId}`,
          name: name || `Channel ${channelId}`,
          duration: duration,
          logo: metadata.tvgLogo || metadata.logo,
          group: metadata.groupTitle || metadata.group,
          tvgId: metadata.tvgId,
          tvgName: metadata.tvgName,
          ...(metadata.chno ? { chno: metadata.chno } : {}),
          isFavorite: false
        };
        if (quality) baseChannel.quality = quality;
        currentChannel = baseChannel;
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
  return this.finalizePlaylist(deduped, playlistName, totalBefore);
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
    const rawLines = content.split('\n');
    const lines = rawLines.map(l => l.trim()).filter(l => l);
    const totalLines = lines.length;
    const channels: Channel[] = [];
    let currentChannel: Partial<Channel> = {};
    let channelId = 0;
    
    const qualityRegexes: Array<[RegExp, Channel['quality']]> = [
      [/\b(2160p|4k|uhd)\b/i, '4K'],
      [/\b(1080p|full ?hd|fhd)\b/i, 'FHD'],
      [/\b(720p|hd)\b/i, 'HD'],
      [/\b(480p|sd)\b/i, 'SD']
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXTINF:')) {
        const duration = this.extractDuration(line);
        const metadata = this.extractMetadata(line);
  const name = this.sanitizeName(this.extractName(line));
        let quality: Channel['quality'] | undefined;
        for (const [re, q] of qualityRegexes) { if (re.test(name)) { quality = q; break; } }
        const baseChannel: Partial<Channel> = {
          id: `channel_${++channelId}`,
          name: name || `Channel ${channelId}`,
          duration: duration,
          logo: metadata.tvgLogo || metadata.logo,
          group: metadata.groupTitle || metadata.group,
          tvgId: metadata.tvgId,
          tvgName: metadata.tvgName,
          ...(metadata.chno ? { chno: metadata.chno } : {}),
          isFavorite: false
        };
        if (quality) baseChannel.quality = quality;
        currentChannel = baseChannel;
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
    const playlist = this.finalizePlaylist(this.deduplicateChannels(channels), playlistName, totalBefore);
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

  private static finalizePlaylist(channels: Channel[], playlistName: string, totalBefore: number): PlaylistInfo {
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
      totalChannelsBeforeDedup: totalBefore
    };
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
    
    // Common patterns to match
    const patterns = [
      /tvg-id="([^"]*)"/g,
      /tvg-name="([^"]*)"/g,
      /tvg-logo="([^"]*)"/g,
      /tvg-chno="([^"]*)"/g,
      /group-title="([^"]*)"/g,
      /(?:^|\s)logo="([^"]*)"/g,
      /(?:^|\s)group="([^"]*)"/g
    ];
    
    const keys = ['tvgId', 'tvgName', 'tvgLogo', 'chno', 'groupTitle', 'logo', 'group'];
    
    patterns.forEach((pattern, index) => {
      const matches = [...attributesSection.matchAll(pattern)];
      if (matches.length > 0) {
        metadata[keys[index]] = matches[0][1];
      }
    });
    
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
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const result = this.parseM3U(content, file.name);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  static async parseFromFileWithProgress(file: File, onProgress?: (percent: number, channelsParsed: number) => void): Promise<PlaylistInfo> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          const result = await this.parseM3UWithProgress(content, file.name, onProgress);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
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
