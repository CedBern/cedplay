import type { Channel } from '@/types/channel';

export const CHANNEL_QUALITIES = ['4K', 'FHD', 'HD', 'SD'] as const;

/** Indication du fournisseur, pas une mesure du flux. Une qualité inconnue reste inconnue. */
export function channelQuality(channel: Pick<Channel, 'name' | 'quality'>): Channel['quality'] {
  if (channel.quality) return channel.quality === 'UHD' ? '4K' : channel.quality;
  const patterns = [
    [/\b(?:2160p?|4k|uhd)\b/i, '4K'],
    [/\b(?:1080p?|full\s?hd|fhd)\b/i, 'FHD'],
    [/\b(?:720p?|hd)\b/i, 'HD'],
    [/\b(?:480p?|576p?|sd)\b/i, 'SD'],
  ] as const;
  return patterns.find(([pattern]) => pattern.test(channel.name))?.[1];
}

/** Conserve l'identité (favoris/guide), mais ouvre le flux de la qualité choisie. */
export function selectChannelQuality(channel: Channel, quality: string): Channel | null {
  if (quality === 'all') return channel;
  if (channelQuality(channel) === quality) return channel;
  const match = channel.variants?.find(v => channelQuality(v) === quality);
  if (!match) return null;
  const primary: Channel = { ...channel };
  delete primary.variants;
  return { ...channel, url: match.url, quality: channelQuality(match)!, variants: [primary, ...(channel.variants ?? []).filter(v => v !== match)] };
}
