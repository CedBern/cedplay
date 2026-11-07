export interface PodcastSearchResult {
  id: string;
  title: string;
  author: string;
  feedUrl: string;
  artworkUrl: string;
  description?: string | undefined;
  genre?: string | undefined;
  episodeCount?: number | undefined;
  source: 'apple' | 'gpodder' | 'direct' | 'suggestion';
}

export interface LinkResolutionResult {
  kind: 'feed' | 'apple' | 'spotify' | 'web';
  resolved: boolean;
  feedUrl?: string | undefined;
  podcast?: PodcastSearchResult | undefined;
  warning?: string | undefined;
  error?: string | undefined;
}

export interface PodcastFeed {
  url: string;
  title: string;
  description: string;
  artworkUrl?: string;
  siteUrl?: string;
  addedAt: number;
  lastFetchedAt: number;
}

export interface PodcastEpisode {
  id: string;
  feedUrl: string;
  podcastTitle: string;
  title: string;
  audioUrl: string;
  pubDate?: string;
  publishedAt: number;
  durationMs: number;
  description?: string;
  artworkUrl?: string;
}

export interface PodcastProgress {
  episodeId: string;
  feedUrl: string;
  audioUrl: string;
  title: string;
  podcastTitle: string;
  artworkUrl?: string;
  positionMs: number;
  durationMs: number;
  speed: number;
  completed: boolean;
  updatedAt: number;
}

export interface AudioPlaybackState {
  active: boolean;
  playing: boolean;
  episodeId: string | null;
  feedUrl: string;
  audioUrl: string;
  title: string;
  podcastTitle: string;
  artworkUrl: string;
  positionMs: number;
  durationMs: number;
  speed: number;
}
