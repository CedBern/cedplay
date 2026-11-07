export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  /** Numéro de chaîne M3U (tvg-chno) : sert au zapping numérique. */
  chno?: string;
  duration?: number;
  isFavorite?: boolean;
  quality?: '4K' | 'UHD' | 'FHD' | 'HD' | 'SD';
  /** Suppressed duplicate variants (lower or alternative quality streams) */
  variants?: Channel[];
}

export interface ChannelGroup {
  name: string;
  channels: Channel[];
}

export interface PlaylistInfo {
  id: string;
  name: string;
  url?: string;
  channels: Channel[];
  groups: ChannelGroup[];
  totalChannelsBeforeDedup?: number;
}