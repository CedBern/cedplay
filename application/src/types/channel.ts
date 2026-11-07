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
  /** Décalage du guide en heures (attribut M3U tvg-shift). */
  tvgShift?: number;
  /** Replay M3U : mode (default, append, shift, flussonic, xc…), modèle d'adresse et jours d'archive. */
  catchup?: string;
  catchupSource?: string;
  catchupDays?: number;
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
  /** Guides XMLTV annoncés par l'en-tête de la liste (url-tvg / x-tvg-url). */
  epgUrls?: string[];
  totalChannelsBeforeDedup?: number;
}