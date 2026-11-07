import { PlaylistInfo, Channel } from '@/types/channel';

// Convert a playlist back to M3U format (basic EXTINF reconstruction)
export function playlistToM3U(playlist: PlaylistInfo): string {
  const lines: string[] = ['#EXTM3U'];
  for (const ch of playlist.channels) {
    const attrs: string[] = [];
    if (ch.tvgId) attrs.push(`tvg-id="${ch.tvgId}"`);
    if (ch.tvgName) attrs.push(`tvg-name="${ch.tvgName}"`);
    if (ch.logo) attrs.push(`tvg-logo="${ch.logo}"`);
    if (ch.group) attrs.push(`group-title="${ch.group}"`);
    const meta = attrs.length ? ' ' + attrs.join(' ') : '';
    const duration = typeof ch.duration === 'number' ? ch.duration : -1;
    lines.push(`#EXTINF:${duration}${meta},${ch.name}`);
    if (ch.url) lines.push(ch.url);
  }
  return lines.join('\n');
}

// Advanced export options
export interface AdvancedExportOptions {
  includeQuality?: boolean;
  includeFavorites?: boolean; // adds favorite="true"
  includeVariants?: boolean;  // export suppressed variants
  annotateVariants?: boolean; // add variant-of, variant-index attributes
  onlyFavorites?: boolean;    // export only favorite channels (main + any variants that are favorite)
}

function buildExtinf(channel: Channel, options: AdvancedExportOptions, favoritesSet: Set<string>, parent?: Channel, variantIndex?: number): string[] {
  const attrs: string[] = [];
  if (channel.tvgId) attrs.push(`tvg-id="${channel.tvgId}"`);
  if (channel.tvgName) attrs.push(`tvg-name="${channel.tvgName}"`);
  if (channel.logo) attrs.push(`tvg-logo="${channel.logo}"`);
  if (channel.group) attrs.push(`group-title="${channel.group}"`);
  if (options.includeQuality && channel.quality) attrs.push(`quality="${channel.quality}"`);
  if (options.includeFavorites && favoritesSet.has(channel.id)) attrs.push('favorite="true"');
  if (options.includeVariants && options.annotateVariants && parent && parent.id !== channel.id) {
    attrs.push(`variant-of="${parent.id}"`);
    if (typeof variantIndex === 'number') attrs.push(`variant-index="${variantIndex}"`);
  }
  const duration = typeof channel.duration === 'number' ? channel.duration : -1;
  const meta = attrs.length ? ' ' + attrs.join(' ') : '';
  return [
    `#EXTINF:${duration}${meta},${channel.name}`,
    channel.url
  ];
}

export function playlistToM3UAdvanced(playlist: PlaylistInfo, favorites: string[], options: AdvancedExportOptions = {}): string {
  const lines: string[] = ['#EXTM3U'];
  const favoritesSet = new Set(favorites);
  for (const ch of playlist.channels) {
    const includeMain = !options.onlyFavorites || favoritesSet.has(ch.id);
    if (includeMain) {
      lines.push(...buildExtinf(ch, options, favoritesSet));
    }
    if (options.includeVariants && ch.variants?.length) {
      ch.variants.forEach((v, i) => {
        if (options.onlyFavorites && !favoritesSet.has(v.id)) return;
        lines.push(...buildExtinf(v, options, favoritesSet, ch, i));
      });
    }
  }
  return lines.join('\n');
}

export function downloadPlaylistAdvanced(playlist: PlaylistInfo, favorites: string[], options: AdvancedExportOptions) {
  const content = playlistToM3UAdvanced(playlist, favorites, options);
  const blob = new Blob([content], { type: 'audio/x-mpegurl' });
  const a = document.createElement('a');
  const suffixParts = [] as string[];
  if (options.includeQuality) suffixParts.push('quality');
  if (options.includeFavorites) suffixParts.push('fav');
  if (options.includeVariants) suffixParts.push('variants');
  if (options.onlyFavorites) suffixParts.push('onlyFav');
  const suffix = suffixParts.length ? '-' + suffixParts.join('_') : '';
  a.href = URL.createObjectURL(blob);
  a.download = `${playlist.name.replace(/[^a-z0-9_-]+/gi,'_')}${suffix}.m3u`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function downloadPlaylist(playlist: PlaylistInfo) {
  const content = playlistToM3U(playlist);
  const blob = new Blob([content], { type: 'audio/x-mpegurl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${playlist.name.replace(/[^a-z0-9_-]+/gi,'_')}.m3u`; 
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
