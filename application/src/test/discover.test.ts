import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  episodesToListen, forYouItems, newEpisodes, orderRows, readForYouSnapshot, resumeItems, saveForYouSnapshot,
  type DiscoverRowId,
} from '@/utils/discover';
import { refreshPodcastFeeds } from '@/utils/podcastRefresh';
import { clearPodcastStorageForTests, readEpisodesForFeed, readPodcastFeeds, saveSubscribedPodcast } from '@/utils/podcastStorage';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { PodcastEpisode, PodcastFeed, PodcastProgress } from '@/types/podcast';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 8, 20);
const all = (...ids: DiscoverRowId[]) => new Set<DiscoverRowId>(ids);

const feed = (url: string, title = url): PodcastFeed => ({ url, title, description: '', addedAt: 0, lastFetchedAt: 0 });
const ep = (id: string, feedUrl: string, publishedAt: number): PodcastEpisode => ({ id, feedUrl, podcastTitle: feedUrl, title: id, audioUrl: `https://x/${id}.mp3`, publishedAt, durationMs: 1_800_000 });
const prog = (episodeId: string, feedUrl: string, over: Partial<PodcastProgress> = {}): PodcastProgress => ({
  episodeId, feedUrl, audioUrl: `https://x/${episodeId}.mp3`, title: episodeId, podcastTitle: feedUrl, positionMs: 0, durationMs: 1_800_000, speed: 1, completed: false, updatedAt: NOW - DAY, ...over,
});
const vod = (id: string, over: Partial<PlayHistoryEntry> = {}): PlayHistoryEntry => ({
  channelId: `vod:pl:movie:${id}`, ts: NOW, kind: 'vod', name: id, playlistId: 'pl', mediaKind: 'movie', status: 'started', positionMs: 600_000, durationMs: 6_000_000, ...over,
} as PlayHistoryEntry);

describe('ordre des rangées de Découvrir', () => {
  it('met Reprendre en tête, puis une rangée par famille, puis le reste groupé par famille', () => {
    const rows = orderRows(all('resume', 'live-now', 'recent-channels', 'for-you', 'my-list', 'new-episodes', 'to-listen'), ['direct', 'video', 'podcasts'], 'all');
    expect(rows).toEqual(['resume', 'live-now', 'for-you', 'new-episodes', 'recent-channels', 'my-list', 'to-listen']);
  });

  it('suit l’ordre des familles venu de l’usage', () => {
    const rows = orderRows(all('live-now', 'for-you', 'my-list', 'to-listen'), ['video', 'direct', 'podcasts'], 'all');
    expect(rows).toEqual(['for-you', 'live-now', 'to-listen', 'my-list']);
  });

  it('masque les rangées vides et réserve Direct au filtre Tout', () => {
    expect(orderRows(all('live-now', 'my-list'), ['direct', 'video', 'podcasts'], 'movies')).toEqual(['my-list']);
    expect(orderRows(all('live-now', 'my-list', 'to-listen'), ['direct', 'video', 'podcasts'], 'podcasts')).toEqual(['to-listen']);
    expect(orderRows(all(), ['direct', 'video', 'podcasts'], 'all')).toEqual([]);
  });
});

describe('Reprendre', () => {
  it('mélange films et podcasts du plus récent au plus ancien, sans terminé ni retiré', () => {
    const items = resumeItems(
      [vod('a', { ts: NOW - 3 * DAY }), vod('fini', { status: 'completed' }), vod('retire', { hiddenFromContinue: true }), vod('survol', { positionMs: 5_000 })],
      { e1: prog('e1', 'f', { positionMs: 60_000, updatedAt: NOW - DAY }), e2: prog('e2', 'f', { positionMs: 60_000, completed: true }) },
      'all',
    );
    expect(items.map(i => i.key)).toEqual(['pod:e1', 'vod:pl:movie:a']);
  });

  it('ne garde que le type du filtre', () => {
    const history = [vod('film'), vod('serie', { channelId: 'vod:pl:series:9', mediaKind: 'series' })];
    const progress = { e1: prog('e1', 'f', { positionMs: 60_000 }) };
    expect(resumeItems(history, progress, 'series').map(i => i.key)).toEqual(['vod:pl:series:9']);
    expect(resumeItems(history, progress, 'podcasts').map(i => i.key)).toEqual(['pod:e1']);
  });
});

describe('podcasts : terminé au niveau de l’épisode', () => {
  const feeds = [feed('f1'), feed('f2')];

  it('propose les épisodes parus après la dernière écoute, et 14 jours pour une émission jamais écoutée', () => {
    const byFeed = {
      f1: [ep('f1-new', 'f1', NOW - 1 * DAY), ep('f1-old', 'f1', NOW - 5 * DAY)],
      f2: [ep('f2-recent', 'f2', NOW - 10 * DAY), ep('f2-ancien', 'f2', NOW - 20 * DAY)],
    };
    // Dernière écoute de f1 il y a 3 jours.
    const progress = { x: prog('x', 'f1', { completed: true, updatedAt: NOW - 3 * DAY }) };
    expect(newEpisodes(feeds, byFeed, progress, NOW).map(s => s.episode.id)).toEqual(['f1-new', 'f2-recent']);
  });

  it('un épisode terminé n’est plus suggéré mais l’émission continue de proposer les autres', () => {
    const byFeed = { f1: [ep('a', 'f1', NOW - DAY), ep('b', 'f1', NOW - 2 * DAY), ep('c', 'f1', NOW - 30 * DAY)] };
    const progress = { a: prog('a', 'f1', { completed: true, updatedAt: NOW - 3 * DAY }) };
    const fresh = newEpisodes([feed('f1')], byFeed, progress, NOW);
    expect(fresh.map(s => s.episode.id)).toEqual(['b']);
    const later = episodesToListen([feed('f1')], byFeed, progress, new Set(fresh.map(s => s.episode.id)));
    expect(later.map(s => s.episode.id)).toEqual(['c']);
  });

  it('À écouter alterne les émissions pour ne pas en montrer une seule', () => {
    const byFeed = {
      f1: [ep('a1', 'f1', 5), ep('a2', 'f1', 4), ep('a3', 'f1', 3)],
      f2: [ep('b1', 'f2', 5)],
    };
    expect(episodesToListen(feeds, byFeed, {}, new Set()).map(s => s.episode.id)).toEqual(['a1', 'b1', 'a2', 'a3']);
  });
});

describe('Pour toi', () => {
  afterEach(() => localStorage.clear());

  it('ne répète ni un titre en cours ni un titre déjà dans Ma liste', () => {
    const snapshot = [{ id: '1', name: 'Un' }, { id: '2', name: 'Deux' }, { id: '3', name: 'Trois' }];
    const kept = forYouItems(snapshot, new Set(['1']), [{ id: '2', name: 'Deux', kind: 'movie', playlistId: 'pl', addedAt: 0 }]);
    expect(kept.map(i => i.id)).toEqual(['3']);
  });

  it('relit le dernier calcul mémorisé par Films, par playlist', () => {
    saveForYouSnapshot('pl', [{ id: '1', name: 'Un', reason: 'Même genre que Dune' }]);
    expect(readForYouSnapshot('pl')).toEqual([{ id: '1', name: 'Un', reason: 'Même genre que Dune' }]);
    expect(readForYouSnapshot('autre')).toEqual([]);
  });
});

describe('actualisation des émissions', () => {
  afterEach(() => { clearPodcastStorageForTests(); vi.restoreAllMocks(); });

  it('relit seulement les flux de plus de 6 h et garde le cache quand un flux échoue', async () => {
    saveSubscribedPodcast({ ...feed('ok'), lastFetchedAt: NOW - 7 * 3600_000 }, [ep('vieux', 'ok', 1)]);
    saveSubscribedPodcast({ ...feed('ko'), lastFetchedAt: NOW - 7 * 3600_000 }, [ep('garde', 'ko', 1)]);
    saveSubscribedPodcast({ ...feed('frais'), lastFetchedAt: NOW - 3600_000 }, [ep('frais1', 'frais', 1)]);
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'ko') throw new Error('hors ligne');
      return { feed: { ...feed(url), title: 'À jour' }, episodes: [ep('neuf', url, 2)] };
    });
    const report = await refreshPodcastFeeds({ nowMs: NOW, fetcher });
    expect(fetcher.mock.calls.map(c => c[0]).sort()).toEqual(['ko', 'ok']);
    expect(report).toEqual({ refreshed: 1, failed: 1 });
    expect(readEpisodesForFeed('ok').map(e => e.id)).toEqual(['neuf']);
    expect(readEpisodesForFeed('ko').map(e => e.id)).toEqual(['garde']);
    expect(readPodcastFeeds().find(f => f.url === 'ok')?.lastFetchedAt).toBe(NOW);
  });

  it('l’actualisation manuelle relit aussi les flux récents', async () => {
    saveSubscribedPodcast({ ...feed('frais'), lastFetchedAt: NOW - 60_000 }, []);
    const fetcher = vi.fn(async (url: string) => ({ feed: feed(url), episodes: [] }));
    await refreshPodcastFeeds({ nowMs: NOW, fetcher, force: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
