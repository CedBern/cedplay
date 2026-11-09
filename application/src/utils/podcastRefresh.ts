import type { PodcastEpisode, PodcastFeed } from '@/types/podcast';
import { fetchPodcastFeed } from '@/utils/podcastFetcher';
import { readPodcastFeeds, saveSubscribedPodcast } from '@/utils/podcastStorage';

/** Les flux suivis sont relus en arrière-plan au plus toutes les 6 heures. */
export const PODCAST_REFRESH_INTERVAL_MS = 6 * 3600 * 1000;
const CONCURRENCY = 2;

let running: Promise<RefreshReport> | null = null;

export interface RefreshReport {
  refreshed: number;
  failed: number;
}

type Fetcher = (url: string) => Promise<{ feed: PodcastFeed; episodes: PodcastEpisode[] }>;

/**
 * Relit les flux suivis. Sans `force`, seuls ceux lus il y a plus de 6 heures.
 * Un flux en échec garde ses épisodes en cache ; un seul passage à la fois.
 */
export function refreshPodcastFeeds(options: { force?: boolean; nowMs?: number; fetcher?: Fetcher } = {}): Promise<RefreshReport> {
  if (running) return running;
  const now = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? fetchPodcastFeed;
  const due = readPodcastFeeds().filter(f => options.force || !(now - (f.lastFetchedAt || 0) < PODCAST_REFRESH_INTERVAL_MS));
  const report: RefreshReport = { refreshed: 0, failed: 0 };
  if (due.length === 0) return Promise.resolve(report);
  const queue = [...due];
  const worker = async () => {
    for (let feed = queue.shift(); feed; feed = queue.shift()) {
      try {
        const { feed: updated, episodes } = await fetcher(feed.url);
        // L'émission a pu être retirée pendant la lecture du flux.
        if (!readPodcastFeeds().some(f => f.url === feed.url)) continue;
        saveSubscribedPodcast({ ...updated, url: feed.url, lastFetchedAt: now }, episodes);
        report.refreshed += 1;
      } catch {
        report.failed += 1;
      }
    }
  };
  running = Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker))
    .then(() => report)
    .finally(() => { running = null; });
  return running;
}
