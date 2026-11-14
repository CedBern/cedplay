import type { PlayHistoryEntry, VodWatchlistItem } from '@/utils/idb';
import type { PodcastEpisode, PodcastFeed, PodcastProgress } from '@/types/podcast';
import type { DiscoverFamily } from '@/utils/usageJournal';

/**
 * Découvrir : quelles rangées montrer, dans quel ordre, avec quels contenus.
 * Fonctions pures ; l'écran se contente d'afficher le résultat.
 */
export type DiscoverFilter = 'all' | 'movies' | 'series' | 'podcasts';
export type DiscoverRowId = 'resume' | 'resume-podcasts' | 'live-now' | 'recent-channels' | 'for-you' | 'my-list' | 'new-episodes' | 'to-listen' | 'next-series' | 'because-watched' | 'platforms' | 'bodlav-documentaries' | 'tv5-documentaries' | 'imago-documentaries';

/** Rangées de chaque famille, dans leur ordre interne. Reprendre fait partie de Vidéo (et de Podcasts si filtré). */
export const FAMILY_ROWS: Record<DiscoverFamily, DiscoverRowId[]> = {
  direct: ['recent-channels', 'live-now'],
  video: ['resume', 'next-series', 'because-watched', 'for-you', 'my-list', 'bodlav-documentaries', 'tv5-documentaries', 'imago-documentaries', 'platforms'],
  podcasts: ['resume-podcasts', 'new-episodes', 'to-listen'],
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
 * Ordre des rangées : Reprendre toujours en tête quand un titre est en cours, puis
 * Chaînes récentes et Direct, les films et séries (Pour toi, Ma liste), et les podcasts
 * en fin de page. Les rangées vides disparaissent ; Direct n'existe que dans Tout.
 */
export function orderRows(nonEmpty: ReadonlySet<DiscoverRowId>, familyOrder: readonly DiscoverFamily[], filter: DiscoverFilter): DiscoverRowId[] {
  const allowed = new Set(FILTER_FAMILIES[filter]);
  // Dans Tout : Direct d'abord, puis Vidéo (films et séries), puis Podcasts en dernier
  const families = filter === 'all'
    ? (['direct', 'video', 'podcasts'] as const)
    : familyOrder.filter(f => allowed.has(f));

  const rows: DiscoverRowId[] = [];

  // Reprendre avant de découvrir : ce qui est commencé passe devant tout le reste,
  // dans Tout comme dans l'onglet Podcasts quand un épisode est en cours.
  if ((filter === 'all' || filter === 'podcasts') && nonEmpty.has('resume')) {
    rows.push('resume');
  }

  for (const family of families) {
    const present = FAMILY_ROWS[family].filter(r => nonEmpty.has(r) && (!r.endsWith('-documentaries') || filter === 'all' || filter === 'movies'));
    for (const r of present) {
      if (!rows.includes(r)) rows.push(r);
    }
  }

  return rows;
}

export type ResumeItem =
  | { kind: 'vod'; key: string; ts: number; entry: PlayHistoryEntry }
  | { kind: 'podcast'; key: string; ts: number; progress: PodcastProgress };

/**
 * Reprendre : films et épisodes commencés (au moins 1 min), non terminés, non retirés,
 * et podcasts en cours uniquement pour le filtre Podcasts.
 * Dans Tout, la reprise audio utilise une autre rangée après les vidéos.
 */
export function resumeItems(
  vodHistory: PlayHistoryEntry[],
  podcastProgress: Record<string, PodcastProgress>,
  filter: DiscoverFilter,
  isHidden: (entry: PlayHistoryEntry) => boolean = () => false,
): ResumeItem[] {
  const vodItems: ResumeItem[] = [];
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
      vodItems.push({ kind: 'vod', key: entry.channelId, ts: entry.ts, entry });
    }
  }
  const podItems: ResumeItem[] = [];
  if (filter === 'podcasts') {
    for (const p of Object.values(podcastProgress)) {
      if (p.completed || !(p.positionMs > 0) || !p.audioUrl) continue;
      podItems.push({ kind: 'podcast', key: `pod:${p.episodeId}`, ts: p.updatedAt || 0, progress: p });
    }
  }
  vodItems.sort((a, b) => b.ts - a.ts);
  podItems.sort((a, b) => b.ts - a.ts);

  if (filter === 'podcasts') {
    return podItems.slice(0, MAX_RESUME);
  }
  return vodItems.slice(0, MAX_RESUME);
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

/** Recommandation « Pour toi » mémorisée par Films ou l'accueil. */
export interface ForYouSnapshotItem {
  sourceId?: string;
  kind?: 'movie' | 'series';
  id: string;
  name: string;
  poster?: string;
  categoryId?: string;
  reason?: string;
  /** Disponibilité : présent dans la bibliothèque (playlist/local) ou à découvrir ailleurs (TMDB). */
  availability?: 'library' | 'discover';
  tmdbId?: number;
  year?: string;
}

/** Pour toi : sans ce qui est déjà en cours ou déjà gardé dans Ma liste. */
export function forYouItems(snapshot: ForYouSnapshotItem[], resumeIds: ReadonlySet<string>, myList: VodWatchlistItem[]): ForYouSnapshotItem[] {
  const kept = new Set(myList.map(i => `${i.kind}:${i.id}`));
  return snapshot.filter(i => !resumeIds.has(i.id) && !resumeIds.has(`${i.kind ?? 'movie'}:${i.id}`) && !kept.has(`${i.kind ?? 'movie'}:${i.id}`)).slice(0, MAX_FOR_YOU);
}

/** Identifiant catalogue d'une entrée VOD `vod:<playlist>:<kind>:<id>`. */
export function vodItemId(entry: PlayHistoryEntry): string {
  return entry.seriesId || entry.channelId.split(':').at(-1) || entry.channelId;
}

const FOR_YOU_PREFIX = 'cedplay_foryou_v1_';
const FOR_YOU_SIG_PREFIX = 'cedplay_foryou_sig_v1_';

export function readForYouSnapshot(playlistId: string, kind: 'movie' | 'series' = 'movie'): ForYouSnapshotItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FOR_YOU_PREFIX + playlistId + (kind === 'series' ? '_series' : '')) || '[]');
    return Array.isArray(raw) ? raw.filter((i): i is ForYouSnapshotItem => !!i && typeof i.id === 'string' && typeof i.name === 'string').map(i => kind === 'series' ? { ...i, kind } : i) : [];
  } catch { return []; }
}

export function saveForYouSnapshot(playlistId: string, items: ForYouSnapshotItem[], kind: 'movie' | 'series' = 'movie'): void {
  try {
    localStorage.setItem(FOR_YOU_PREFIX + playlistId + (kind === 'series' ? '_series' : ''), JSON.stringify(items.slice(0, MAX_FOR_YOU)));
    window.dispatchEvent(new Event('for-you-updated'));
  } catch { /* quota */ }
}

export function readForYouSignature(playlistId: string, kind: 'movie' | 'series' = 'movie'): string | undefined {
  try {
    return localStorage.getItem(FOR_YOU_SIG_PREFIX + playlistId + (kind === 'series' ? '_series' : '')) ?? undefined;
  } catch { return undefined; }
}

export function saveForYouSignature(playlistId: string, signature: string, kind: 'movie' | 'series' = 'movie'): void {
  try {
    localStorage.setItem(FOR_YOU_SIG_PREFIX + playlistId + (kind === 'series' ? '_series' : ''), signature);
  } catch { /* quota */ }
}
