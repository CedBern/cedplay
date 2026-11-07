import type { PodcastEpisode, PodcastFeed, PodcastProgress } from '@/types/podcast';

const FEEDS_KEY = 'cedplay_podcast_feeds_v1';
const EPISODES_KEY = 'cedplay_podcast_episodes_v1';
const PROGRESS_KEY = 'cedplay_podcast_progress_v1';
const LAST_ACTIVE_KEY = 'cedplay_podcast_last_active_v1';

const changeListeners = new Set<() => void>();

function notifyChange(): void {
  changeListeners.forEach(fn => {
    try { fn(); } catch { /* ignore listener error */ }
  });
}

export function onPodcastStorageChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

export function clampPodcastSpeed(speed: number | undefined | null): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return 1.0;
  return Math.round(Math.max(0.5, Math.min(3.0, speed)) * 100) / 100;
}

export function readPodcastFeeds(): PodcastFeed[] {
  try {
    const raw = localStorage.getItem(FEEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writePodcastFeeds(feeds: PodcastFeed[]): void {
  try {
    localStorage.setItem(FEEDS_KEY, JSON.stringify(feeds));
    notifyChange();
  } catch { /* quota */ }
}

export function readPodcastEpisodesByFeed(): Record<string, PodcastEpisode[]> {
  try {
    const raw = localStorage.getItem(EPISODES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readEpisodesForFeed(feedUrl: string): PodcastEpisode[] {
  const map = readPodcastEpisodesByFeed();
  return map[feedUrl] ?? [];
}

export function saveSubscribedPodcast(feed: PodcastFeed, episodes: PodcastEpisode[]): void {
  const existing = readPodcastFeeds();
  const idx = existing.findIndex(f => f.url === feed.url);
  const nextFeeds = [...existing];
  if (idx >= 0) {
    nextFeeds[idx] = { ...existing[idx]!, ...feed, addedAt: existing[idx]!.addedAt };
  } else {
    nextFeeds.unshift(feed);
  }
  const byFeed = readPodcastEpisodesByFeed();
  byFeed[feed.url] = episodes.slice(0, 200);
  try {
    localStorage.setItem(FEEDS_KEY, JSON.stringify(nextFeeds));
    localStorage.setItem(EPISODES_KEY, JSON.stringify(byFeed));
    notifyChange();
  } catch { /* quota */ }
}

export function removeSubscribedPodcast(feedUrl: string): void {
  const nextFeeds = readPodcastFeeds().filter(f => f.url !== feedUrl);
  const byFeed = readPodcastEpisodesByFeed();
  delete byFeed[feedUrl];
  try {
    localStorage.setItem(FEEDS_KEY, JSON.stringify(nextFeeds));
    localStorage.setItem(EPISODES_KEY, JSON.stringify(byFeed));
    notifyChange();
  } catch { /* quota */ }
}

export function readAllEpisodeProgress(): Record<string, PodcastProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getEpisodeProgress(episodeId: string): PodcastProgress | null {
  if (!episodeId) return null;
  const all = readAllEpisodeProgress();
  return all[episodeId] ?? null;
}

export function getLastActiveEpisodeProgress(): PodcastProgress | null {
  const all = readAllEpisodeProgress();
  const lastId = localStorage.getItem(LAST_ACTIVE_KEY);
  if (lastId && all[lastId] && !all[lastId]!.completed) {
    return all[lastId]!;
  }
  const entries = Object.values(all)
    .filter(p => !p.completed && p.positionMs > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return entries[0] ?? null;
}

export function saveEpisodeProgress(
  entry: {
    episodeId: string;
    feedUrl?: string;
    audioUrl?: string;
    title?: string;
    podcastTitle?: string;
    artworkUrl?: string;
    positionMs: number;
    durationMs: number;
    speed: number;
  },
  now = Date.now()
): PodcastProgress | null {
  if (!entry.episodeId) return null;
  const all = readAllEpisodeProgress();
  const prev = all[entry.episodeId];
  const safePos = Math.max(0, Math.round(entry.positionMs || 0));
  const safeDur = Math.max(0, Math.round(entry.durationMs || prev?.durationMs || 0));
  const safeSpeed = clampPodcastSpeed(entry.speed ?? prev?.speed ?? 1.0);
  const completed = safeDur > 0 && safePos >= safeDur - 15_000 && safePos > 5_000;

  const updated: PodcastProgress = {
    episodeId: entry.episodeId,
    feedUrl: entry.feedUrl || prev?.feedUrl || '',
    audioUrl: entry.audioUrl || prev?.audioUrl || '',
    title: entry.title || prev?.title || '',
    podcastTitle: entry.podcastTitle || prev?.podcastTitle || '',
    ...((entry.artworkUrl ?? prev?.artworkUrl) ? { artworkUrl: entry.artworkUrl ?? prev?.artworkUrl } : {}),
    positionMs: completed ? safeDur : safePos,
    durationMs: safeDur,
    speed: safeSpeed,
    completed,
    updatedAt: now,
  };

  all[entry.episodeId] = updated;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    localStorage.setItem(LAST_ACTIVE_KEY, entry.episodeId);
    notifyChange();
  } catch { /* quota */ }
  return updated;
}

export function mergeNativeEpisodeProgress(entries: PodcastProgress[]): void {
  if (!entries.length) return;
  const all = readAllEpisodeProgress();
  let changed = false;
  let newestId: string | null = null;
  let newestTs = 0;

  for (const item of entries) {
    if (!item?.episodeId) continue;
    const local = all[item.episodeId];
    const itemTs = item.updatedAt || 0;
    if (!local || itemTs >= (local.updatedAt || 0)) {
      all[item.episodeId] = {
        episodeId: item.episodeId,
        feedUrl: item.feedUrl || local?.feedUrl || '',
        audioUrl: item.audioUrl || local?.audioUrl || '',
        title: item.title || local?.title || '',
        podcastTitle: item.podcastTitle || local?.podcastTitle || '',
        ...((item.artworkUrl || local?.artworkUrl) ? { artworkUrl: item.artworkUrl || local?.artworkUrl } : {}),
        positionMs: Math.max(0, Math.round(item.positionMs || 0)),
        durationMs: Math.max(0, Math.round(item.durationMs || local?.durationMs || 0)),
        speed: clampPodcastSpeed(item.speed ?? local?.speed ?? 1.0),
        completed: Boolean(item.completed),
        updatedAt: itemTs || Date.now(),
      };
      changed = true;
    }
    if (itemTs > newestTs) {
      newestTs = itemTs;
      newestId = item.episodeId;
    }
  }

  if (changed) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
      if (newestId) localStorage.setItem(LAST_ACTIVE_KEY, newestId);
      notifyChange();
    } catch { /* quota */ }
  }
}

export function clearPodcastStorageForTests(): void {
  localStorage.removeItem(FEEDS_KEY);
  localStorage.removeItem(EPISODES_KEY);
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(LAST_ACTIVE_KEY);
  notifyChange();
}
