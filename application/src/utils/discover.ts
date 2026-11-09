import type { PlayHistoryEntry, VodWatchlistItem } from '@/utils/idb';
import type { PodcastEpisode, PodcastFeed, PodcastProgress } from '@/types/podcast';
import type { DiscoverFamily } from '@/utils/usageJournal';

/**
 * Découvrir : quelles rangées montrer, dans quel ordre, avec quels contenus.
 * Fonctions pures ; l'écran se contente d'afficher le résultat.
 */
export type DiscoverFilter = 'all' | 'movies' | 'series' | 'podcasts';
export type DiscoverRowId = 'resume' | 'live-now' | 'recent-channels' | 'for-you' | 'my-list' | 'new-episodes' | 'to-listen';

/** Rangées de chaque famille, dans leur ordre interne. Reprendre n'appartient à aucune famille. */
export const FAMILY_ROWS: Record<DiscoverFamily, DiscoverRowId[]> = {
  direct: ['live-now', 'recent-channels'],
  video: ['for-you', 'my-list'],
  podcasts: ['new-episodes', 'to-listen'],
};

const FILTER_FAMILIES: Record<DiscoverFilter, DiscoverFamily[]> = {
  all: ['direct', 'video', 'podcasts'],
  movies: ['video'],
  series: ['video'],
  podcasts: ['podcasts'],
};

export const MAX_RESUME = 10;
export const MAX_NEW_EPISODES = 10;
export const MAX_TO_LISTEN = 10;
export const MAX_FOR_YOU = 12;
export const MAX_MY_LIST = 12;
export const MAX_RECENT_CHANNELS = 8;
/** Émission jamais écoutée : ses épisodes des 14 derniers jours sont « nouveaux ». */
export const NEW_EPISODE_WINDOW_MS = 14 * 24 * 3600 * 1000;
/** Sous ce seuil, un film ou un épisode n'a pas vraiment été commencé. */
export const RESUME_THRESHOLD_MS = 60_000;

/**
 * Ordre des rangées : Reprendre en tête, puis la 1re rangée non vide de chaque famille
 * (dans l'ordre des familles), puis les autres rangées regroupées par famille.
 * Les rangées vides disparaissent ; Direct n'existe que dans Tout.
 */
export function orderRows(nonEmpty: ReadonlySet<DiscoverRowId>, familyOrder: readonly DiscoverFamily[], filter: DiscoverFilter): DiscoverRowId[] {
  const allowed = new Set(FILTER_FAMILIES[filter]);
  const families = familyOrder.filter(f => allowed.has(f));
  const rows: DiscoverRowId[] = [];
  if (nonEmpty.has('resume')) rows.push('resume');
  const rest: DiscoverRowId[] = [];
  for (const family of families) {
    const present = FAMILY_ROWS[family].filter(r => nonEmpty.has(r));
    if (present.length) {
      rows.push(present[0]);
      rest.push(...present.slice(1));
    }
  }
  return [...rows, ...rest];
}

export type ResumeItem =
  | { kind: 'vod'; key: string; ts: number; entry: PlayHistoryEntry }
  | { kind: 'podcast'; key: string; ts: number; progress: PodcastProgress };

/**
 * Reprendre : films et épisodes commencés (au moins 1 min), non terminés, non retirés,
 * et épisodes de podcast en cours, du plus récent au plus ancien.
 */
export function resumeItems(
  vodHistory: PlayHistoryEntry[],
  podcastProgress: Record<string, PodcastProgress>,
  filter: DiscoverFilter,
  isHidden: (entry: PlayHistoryEntry) => boolean = () => false,
): ResumeItem[] {
  const items: ResumeItem[] = [];
  if (filter !== 'podcasts') {
    const seen = new Set<string>();
    for (const entry of vodHistory) {
      if (entry.kind !== 'vod' || seen.has(entry.channelId)) continue;
      if (entry.status === 'completed' || entry.hiddenFromContinue) continue;
      if ((entry.positionMs || 0) < RESUME_THRESHOLD_MS) continue;
      const kind = entry.mediaKind === 'series' ? 'series' : 'movie';
      if (filter === 'movies' && kind !== 'movie') continue;
      if (filter === 'series' && kind !== 'series') continue;
      if (isHidden(entry)) continue;
      seen.add(entry.channelId);
      items.push({ kind: 'vod', key: entry.channelId, ts: entry.ts, entry });
    }
  }
  if (filter === 'all' || filter === 'podcasts') {
    for (const p of Object.values(podcastProgress)) {
      if (p.completed || !(p.positionMs > 0) || !p.audioUrl) continue;
      items.push({ kind: 'podcast', key: `pod:${p.episodeId}`, ts: p.updatedAt || 0, progress: p });
    }
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, MAX_RESUME);
}

export interface EpisodeSuggestion {
  episode: PodcastEpisode;
  feed: PodcastFeed;
  reason: string;
}

function lastListenByFeed(progress: Record<string, PodcastProgress>): Map<string, number> {
  const last = new Map<string, number>();
  for (const p of Object.values(progress)) {
    if (!p.feedUrl) continue;
    last.set(p.feedUrl, Math.max(last.get(p.feedUrl) ?? 0, p.updatedAt || 0));
  }
  return last;
}

/**
 * Nouveaux épisodes des émissions suivies : parus après la dernière écoute de l'émission,
 * ou depuis 14 jours si elle n'a jamais été écoutée. Un épisode commencé est dans Reprendre ;
 * un épisode terminé n'est plus suggéré, mais reste dans l'émission et peut être réécouté.
 */
export function newEpisodes(
  feeds: PodcastFeed[],
  episodesByFeed: Record<string, PodcastEpisode[]>,
  progress: Record<string, PodcastProgress>,
  nowMs: number,
): EpisodeSuggestion[] {
  const lastListen = lastListenByFeed(progress);
  const out: EpisodeSuggestion[] = [];
  for (const feed of feeds) {
    const since = lastListen.get(feed.url) ?? nowMs - NEW_EPISODE_WINDOW_MS;
    for (const episode of episodesByFeed[feed.url] ?? []) {
      if (!(episode.publishedAt > since)) continue;
      const p = progress[episode.id];
      if (p && (p.completed || p.positionMs > 0)) continue;
      out.push({ episode, feed, reason: 'Nouvel épisode' });
    }
  }
  return out.sort((a, b) => b.episode.publishedAt - a.episode.publishedAt).slice(0, MAX_NEW_EPISODES);
}

/**
 * À écouter : épisodes jamais commencés des émissions suivies, hors nouveaux épisodes,
 * un par émission à tour de rôle (le plus récent d'abord) pour varier les émissions.
 */
export function episodesToListen(
  feeds: PodcastFeed[],
  episodesByFeed: Record<string, PodcastEpisode[]>,
  progress: Record<string, PodcastProgress>,
  exclude: ReadonlySet<string>,
): EpisodeSuggestion[] {
  const queues = feeds.map(feed => ({
    feed,
    episodes: (episodesByFeed[feed.url] ?? [])
      .filter(e => !exclude.has(e.id) && !progress[e.id])
      .sort((a, b) => b.publishedAt - a.publishedAt),
  }));
  const out: EpisodeSuggestion[] = [];
  for (let round = 0; out.length < MAX_TO_LISTEN; round++) {
    let added = false;
    for (const q of queues) {
      const episode = q.episodes[round];
      if (!episode) continue;
      out.push({ episode, feed: q.feed, reason: 'Tu suis cette émission' });
      added = true;
      if (out.length >= MAX_TO_LISTEN) break;
    }
    if (!added) break;
  }
  return out;
}

/** Recommandation « Pour toi » mémorisée par Films (le calcul complet y reste). */
export interface ForYouSnapshotItem {
  id: string;
  name: string;
  poster?: string;
  categoryId?: string;
  reason?: string;
}

/** Pour toi : sans ce qui est déjà en cours ou déjà gardé dans Ma liste. */
export function forYouItems(snapshot: ForYouSnapshotItem[], resumeIds: ReadonlySet<string>, myList: VodWatchlistItem[]): ForYouSnapshotItem[] {
  const kept = new Set(myList.filter(i => i.kind === 'movie').map(i => i.id));
  return snapshot.filter(i => !resumeIds.has(i.id) && !kept.has(i.id)).slice(0, MAX_FOR_YOU);
}

/** Identifiant catalogue d'une entrée VOD `vod:<playlist>:<kind>:<id>`. */
export function vodItemId(entry: PlayHistoryEntry): string {
  return entry.seriesId || entry.channelId.split(':').at(-1) || entry.channelId;
}

const FOR_YOU_PREFIX = 'cedplay_foryou_v1_';

export function readForYouSnapshot(playlistId: string): ForYouSnapshotItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FOR_YOU_PREFIX + playlistId) || '[]');
    return Array.isArray(raw) ? raw.filter((i): i is ForYouSnapshotItem => !!i && typeof i.id === 'string' && typeof i.name === 'string') : [];
  } catch { return []; }
}

export function saveForYouSnapshot(playlistId: string, items: ForYouSnapshotItem[]): void {
  try { localStorage.setItem(FOR_YOU_PREFIX + playlistId, JSON.stringify(items.slice(0, MAX_FOR_YOU))); } catch { /* quota */ }
}
