import { TvStarter, type TvStarterAction } from '@/components/TvStarter';
import { TvDiscoverHero, type TvDiscoverSelection } from '@/components/TvDiscoverHero';
import { HeroCarousel, type HeroItem } from '@/components/HeroCarousel';
import { PlatformLogo } from '@/components/PlatformLogo';
import { useBodlavDocumentaries } from '@/hooks/useBodlavDocumentaries';
import { bodlavDocumentaryUrl, type BodlavDocumentary } from '@/utils/bodlav';
import { useOfficialDocumentaries } from '@/hooks/useOfficialDocumentaries';
import { OFFICIAL_DOCUMENTARY_SOURCES, officialDocumentaryUrl, type OfficialDocumentarySource } from '@/utils/officialDocumentaries';
import { useDiscoverSeries } from '@/hooks/useDiscoverSeries';
import { useDiscoverRecommendations } from '@/hooks/useDiscoverRecommendations';
import { feedHomeRecommendations } from '@/utils/discoverRecommendations';
import { readMyPlatforms } from '@/utils/myPlatforms';
import { streamingPlatforms, type StreamingPlatform } from '@/data/streamingPlatforms';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { focusRemote } from '@/utils/remoteNavigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChannelLogo } from '@/components/ChannelLogo';
import { getPlayHistory, getExternalWatches, getVodWatchlistFromDB, getFavoritesFromDB, manageContinueEntry, type PlayHistoryEntry, type VodWatchlistItem } from '@/utils/idb';
import { getCurrentProgram, getUpcomingProgram } from '@/utils/epgXmltv';
import type { EPGData } from '@/types/epg';
import { getXtreamAccount, safeImage } from '@/utils/xtreamCatalog';
import { toast } from 'sonner';
import type { Channel, PlaylistInfo } from '@/types/channel';
import type { PodcastEpisode, PodcastFeed, PodcastProgress } from '@/types/podcast';
import { AudioBridge, nativeUsageJournal } from '@/utils/nativePlayer';
import { onPodcastStorageChange, readAllEpisodeProgress, readPodcastEpisodesByFeed, readPodcastFeeds } from '@/utils/podcastStorage';
import { formatEpisodeLength } from '@/utils/podcastFormat';
import { DEFAULT_PODCAST_SUGGESTIONS } from '@/utils/podcastSearch';
import { refreshPodcastFeeds } from '@/utils/podcastRefresh';
import { useAdultVodCategories } from '@/hooks/useAdultVodCategories';
import {
  episodesToListen, forYouItems, MAX_MY_LIST, MAX_RECENT_CHANNELS, newEpisodes, orderRows, readForYouSnapshot, resumeItems, vodItemId,
  type DiscoverFilter, type DiscoverRowId, type EpisodeSuggestion, type ForYouSnapshotItem, type ResumeItem,
} from '@/utils/discover';
import { DEFAULT_FAMILY_ORDER, familyOrder, readUsageJournal, type DiscoverFamily } from '@/utils/usageJournal';
import { Bookmark, Check, Clock, Film, Headphones, Heart, Info, ListVideo, MonitorPlay, Play, RefreshCw, Sparkles, Tv, X } from 'lucide-react';

interface ContinuePanelProps {
  playlist: PlaylistInfo;
  onChannelSelect: (channel: Channel) => void;
  onOpenVod: (kind: 'movie' | 'series', item?: VodWatchlistItem) => void;
  /** Reprend réellement la lecture d'un titre en cours (ou ouvre la série). */
  onResumeVod?: ((entry: { kind: 'movie' | 'series'; id: string; name?: string | undefined; seriesId?: string | undefined }) => void) | undefined;
  /** Ouvre l'onglet Podcasts, sur une émission si elle est donnée. */
  onOpenPodcasts?: ((feedUrl?: string) => void) | undefined;
  /** Groupes adultes verrouillés (contrôle parental) : leurs chaînes sont masquées. */
  lockedGroups?: string[] | undefined;
  /** true quand le code parental a été saisi pour cette session. */
  unlocked?: boolean | undefined;
  /** Contrôle parental actif : les titres VOD des catégories adultes sont masqués. */
  parentalEnabled?: boolean | undefined;
  /** Guide des programmes : « en ce moment » sur les chaînes favorites. */
  epgData?: EPGData | null | undefined;
  /** Accueil vide : ouvrir la liste des chaînes. */
  onConnect?: (() => void) | undefined;
  onBrowseLive?: (() => void) | undefined;
  /** Clé TMDB pour enrichir les recommandations depuis l'accueil. */
  tmdbApiKey?: string | null | undefined;
  /** Ouvrir la recherche globale pré-remplie pour un titre à découvrir ailleurs. */
  onSearchTitle?: ((query: string) => void) | undefined;
  tvMode?: boolean | undefined;
}

/** Le greffon @tailwindcss/aspect-ratio neutralise les classes aspect-* : ratios posés en style. */
const SQUARE = { aspectRatio: '1 / 1' } as const;
const POSTER = { aspectRatio: '2 / 3' } as const;

const hhmm = (d: Date) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Favoris affichés sur l'accueil ; la liste complète reste dans Direct › Favoris. */
const MAX_FAVORITES = 12;
/** Bandeau du téléphone : quatre titres au plus, tous avec leur vraie affiche. */
const MAX_HERO_ITEMS = 4;

function openDiscoverPlatform(platform: StreamingPlatform) {
  if (NativePlayerBridge.isAvailable()) {
    void NativePlayerBridge.openWeb(platform.url, platform.name, platform.androidPackages, true)
      .catch(() => toast.error(`Impossible d’ouvrir ${platform.name}.`));
  } else {
    const tab = window.open(platform.url, '_blank');
    if (tab) tab.opener = null;
    else toast.error(`Impossible d’ouvrir ${platform.name} (bloqueur de fenêtres).`);
  }
}

function openBodlavDocumentary(item: BodlavDocumentary) {
  const url = bodlavDocumentaryUrl(item.url);
  if (!url) return;
  if (NativePlayerBridge.isAvailable()) {
    void NativePlayerBridge.openWeb(url, item.title);
  } else {
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    if (tab) tab.opener = null;
  }
}

function openOfficialDocumentary(source: OfficialDocumentarySource, value: string, title: string) {
  const url = officialDocumentaryUrl(source, value);
  if (!url) return;
  if (NativePlayerBridge.isAvailable()) void NativePlayerBridge.openWeb(url, title);
  else {
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    if (tab) tab.opener = null;
  }
}

function discoverRecommendations(playlistId: string) {
  const movies = readForYouSnapshot(playlistId);
  const series = readForYouSnapshot(playlistId, 'series');
  return Array.from({ length: Math.max(movies.length, series.length) }, (_, i) => [movies[i], series[i]]).flat().filter(i => i !== undefined);
}

const FILTERS: { value: DiscoverFilter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'movies', label: 'Films' },
  { value: 'series', label: 'Séries' },
  { value: 'podcasts', label: 'Podcasts' },
];

const ROW_TITLES: Record<DiscoverRowId, string> = {
  'next-series': 'Épisodes suivants',
  'because-watched': 'Parce que tu as regardé',
  platforms: 'Mes plateformes',
  'bodlav-documentaries': 'Documentaires Bodlav',
  'tv5-documentaries': 'Documentaires TV5MONDEplus',
  'imago-documentaries': 'Documentaires ImagoTV',
  resume: 'Reprendre',
  'resume-podcasts': 'Reprendre les podcasts',
  'live-now': 'Mes chaînes en ce moment',
  'recent-channels': 'Chaînes récentes',
  'for-you': 'Pour toi',
  'my-list': 'Ma liste',
  'new-episodes': 'Nouveaux épisodes',
  'to-listen': 'À écouter',
};

const dayLabel = (ms: number) => {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

function focusDiscoverMenu(root: HTMLElement): boolean {
  const panel = root.closest('[role="tabpanel"]');
  const tab = document.getElementById(panel?.getAttribute('aria-labelledby') ?? '');
  if (!tab) return false;
  focusRemote(tab);
  return true;
}

/** Une rangée : composant de module, pour que le focus télécommande survive aux re-rendus. */
function DiscoverRow({ id, title, children, action, caption, tvMode }: { id: DiscoverRowId; title: string; children: ReactNode; action?: ReactNode; caption?: string | undefined; tvMode: boolean }) {
  return (
    <section aria-label={title} data-discover-row={id}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${tvMode ? 'text-[18px]' : 'text-[17px]'} font-semibold tracking-tight text-foreground`}>{title}</h2>
          {caption && <p className={`${tvMode ? 'text-[13px]' : 'text-[12px]'} text-muted-foreground`}>{caption}</p>}
        </div>
        {action}
      </div>
      <div data-discover-rail className="rail -mx-2 flex items-start snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-2 px-2 py-1.5 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {children}
      </div>
    </section>
  );
}

export function ContinuePanel({ playlist, onChannelSelect, onOpenVod, onResumeVod, onOpenPodcasts, lockedGroups, unlocked, parentalEnabled, epgData, onBrowseLive, onConnect, tmdbApiKey, onSearchTitle, tvMode = false }: ContinuePanelProps) {
  const adultVod = useAdultVodCategories(playlist, parentalEnabled === true && !unlocked);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [watchlist, setWatchlist] = useState<VodWatchlistItem[]>([]);
  const [podcastProgress, setPodcastProgress] = useState<Record<string, PodcastProgress>>(() => readAllEpisodeProgress());
  const [feeds, setFeeds] = useState<PodcastFeed[]>(() => readPodcastFeeds());
  const [episodesByFeed, setEpisodesByFeed] = useState<Record<string, PodcastEpisode[]>>(() => readPodcastEpisodesByFeed());
  const [snapshot, setSnapshot] = useState(() => ({ playlistId: playlist.id, items: discoverRecommendations(playlist.id) }));
  useEffect(() => {
    const update = () => setSnapshot({ playlistId: playlist.id, items: discoverRecommendations(playlist.id) });
    update();
    window.addEventListener('for-you-updated', update);
    return () => window.removeEventListener('for-you-updated', update);
  }, [playlist.id]);
  const forYouSnapshot = useMemo(() => snapshot.playlistId === playlist.id ? snapshot.items : discoverRecommendations(playlist.id), [snapshot, playlist.id]);
  // Ordre des familles : calculé une fois à l'ouverture, puis figé jusqu'à la prochaine.
  const [families, setFamilies] = useState<DiscoverFamily[] | null>(null);
  const [filter, setFilter] = useState<DiscoverFilter>('all');
  const bodlavEnabled = (filter === 'all' || filter === 'movies') && !(parentalEnabled && !unlocked);
  const bodlav = useBodlavDocumentaries(bodlavEnabled, `${playlist.id}:${filter}:${parentalEnabled === true}:${unlocked === true}`);
  const documentaries = bodlavEnabled ? bodlav : [];
  const officialContext = `${playlist.id}:${filter}:${parentalEnabled === true}:${unlocked === true}`;
  const tv5Documentaries = useOfficialDocumentaries('tv5mondeplus', bodlavEnabled, officialContext);
  const imagoDocumentaries = useOfficialDocumentaries('imagotv', bodlavEnabled, officialContext);
  const [platformIds, setPlatformIds] = useState(readMyPlatforms);
  useEffect(() => {
    const update = () => setPlatformIds(readMyPlatforms());
    window.addEventListener('my-platforms-updated', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('my-platforms-updated', update); window.removeEventListener('storage', update); };
  }, []);
  const platforms = filter === 'all' && !(parentalEnabled && !unlocked)
    ? streamingPlatforms.filter(p => platformIds.includes(p.id)) : [];
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [externalWatches, setExternalWatches] = useState<PlayHistoryEntry[]>([]);
  const [peek, setPeek] = useState<TvDiscoverSelection | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void readUsageJournal(nativeUsageJournal)
      .then(days => { if (!cancelled) setFamilies(familyOrder(days, new Date())); })
      .catch(() => { if (!cancelled) setFamilies([...DEFAULT_FAMILY_ORDER]); });
    // Flux suivis relus en arrière-plan (au plus toutes les 6 h) ; le cache reste en cas d'échec.
    void refreshPodcastFeeds().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      getPlayHistory().catch(() => [] as PlayHistoryEntry[]),
      getVodWatchlistFromDB().catch(() => [] as VodWatchlistItem[]),
      getFavoritesFromDB().catch(() => [] as string[]),
      getExternalWatches().catch(() => [] as PlayHistoryEntry[]),
    ])
      .then(([entries, wl, favs, ext]) => {
        if (!cancelled) {
          setHistory(entries);
          setWatchlist(wl);
          setFavoriteIds(favs);
          setExternalWatches(ext);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    const handleExternalUpdate = () => {
      void getExternalWatches().then(ext => { if (!cancelled) setExternalWatches(ext); }).catch(() => {});
    };
    window.addEventListener('external-watches-updated', handleExternalUpdate);
    const handleWatchlistUpdate = () => {
      void getVodWatchlistFromDB().then(wl => { if (!cancelled) setWatchlist(wl); }).catch(() => {});
    };
    window.addEventListener('vod-watchlist-updated', handleWatchlistUpdate);
    const handleHistoryUpdate = () => {
      void getPlayHistory().then(entries => { if (!cancelled) setHistory(entries); }).catch(() => {});
    };
    window.addEventListener('vod-history-updated', handleHistoryUpdate);
    const handleFavoritesUpdate = () => {
      void getFavoritesFromDB().then(ids => { if (!cancelled) setFavoriteIds(ids); }).catch(() => {});
    };
    window.addEventListener('favorites-updated', handleFavoritesUpdate);
    const unsubPodcast = onPodcastStorageChange(() => {
      if (cancelled) return;
      setPodcastProgress(readAllEpisodeProgress());
      setFeeds(readPodcastFeeds());
      setEpisodesByFeed(readPodcastEpisodesByFeed());
    });
    // Le programme « en ce moment » change : rafraîchir chaque minute.
    const ticker = window.setInterval(() => setTick(t => t + 1), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(ticker);
      unsubPodcast();
      window.removeEventListener('external-watches-updated', handleExternalUpdate);
      window.removeEventListener('favorites-updated', handleFavoritesUpdate);
      window.removeEventListener('vod-watchlist-updated', handleWatchlistUpdate);
      window.removeEventListener('vod-history-updated', handleHistoryUpdate);
    };
  }, [playlist.id]);

  // Index de toutes les chaînes jouables (base + variantes) de la liste active.
  const channelById = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const channel of playlist.channels || []) {
      map.set(channel.id, channel);
      for (const variant of channel.variants || []) map.set(variant.id, variant);
    }
    for (const group of playlist.groups || []) {
      for (const channel of group.channels) {
        if (!map.has(channel.id)) map.set(channel.id, channel);
        for (const variant of channel.variants || []) {
          if (!map.has(variant.id)) map.set(variant.id, variant);
        }
      }
    }
    return map;
  }, [playlist]);

  const favoriteChannels = useMemo(() => {
    const locked = lockedGroups && !unlocked ? new Set(lockedGroups) : null;
    const result: Channel[] = [];
    for (const id of favoriteIds) {
      const channel = channelById.get(id);
      if (!channel || (locked && locked.has(channel.group || ''))) continue;
      result.push(channel);
      if (result.length >= MAX_FAVORITES) break;
    }
    return result;
  }, [favoriteIds, channelById, lockedGroups, unlocked]);

  const recentLive = useMemo(() => {
    const seen = new Set<string>(favoriteChannels.map(c => c.id));
    const locked = lockedGroups && !unlocked ? new Set(lockedGroups) : null;
    const result: Channel[] = [];
    for (const entry of history) {
      if (entry.kind === 'vod') continue;
      if (seen.has(entry.channelId)) continue;
      seen.add(entry.channelId);
      const channel = channelById.get(entry.channelId);
      if (!channel) continue;
      // Contrôle parental : les chaînes adultes n'apparaissent pas tant que le
      // code n'a pas été saisi (même chemin que la liste des chaînes).
      if (locked && locked.has(channel.group || '')) continue;
      result.push(channel);
      if (result.length >= MAX_RECENT_CHANNELS) break;
    }
    return result;
  }, [history, channelById, lockedGroups, unlocked, favoriteChannels]);

  const playlistVodHistory = useMemo(
    () => history.filter(e => e.kind === 'vod').map(e => ({ ...e, ...(e.playlistId ? {} : { playlistId: e.channelId.split(':')[1] }) })).filter(e => e.playlistId === playlist.id),
    [history, playlist.id],
  );

  const resume = useMemo(
    () => resumeItems(playlistVodHistory, podcastProgress, filter, e => adultVod.isAdult(e.mediaKind === 'series' ? 'series' : 'movie', e.categoryId)),
    [playlistVodHistory, podcastProgress, filter, adultVod],
  );

  const watchlistItems = useMemo(() => watchlist.filter(item => item.playlistId === playlist.id && !adultVod.isAdult(item.kind, item.categoryId)), [watchlist, playlist.id, adultVod]);
  const podcastResume = useMemo(() => {
    if (filter !== 'all') return [];
    const subscribed = new Set(feeds.map(feed => feed.url));
    const progress = Object.fromEntries(Object.entries(podcastProgress).filter(([, item]) => subscribed.has(item.feedUrl)));
    return resumeItems([], progress, 'podcasts');
  }, [filter, feeds, podcastProgress]);
  const myList = useMemo(
    () => watchlistItems.filter(i => filter === 'all' || (filter === 'movies' && i.kind === 'movie') || (filter === 'series' && i.kind === 'series')).slice(0, MAX_MY_LIST),
    [watchlistItems, filter],
  );

  const forYou = useMemo(() => {
    if (filter === 'podcasts') return [];
    const resumeIds = new Set(resume.flatMap(r => (r.kind === 'vod' ? [`${r.entry.mediaKind ?? 'movie'}:${vodItemId(r.entry)}`] : [])));
    return forYouItems(forYouSnapshot.filter(i => (filter === 'all' || (filter === 'series' ? i.kind === 'series' : i.kind !== 'series')) && !adultVod.isAdult(i.kind ?? 'movie', i.categoryId)), resumeIds, watchlistItems);
  }, [filter, resume, forYouSnapshot, watchlistItems, adultVod]);

  const fresh = useMemo(() => newEpisodes(feeds, episodesByFeed, podcastProgress, Date.now()), [feeds, episodesByFeed, podcastProgress]);
  const nextSeries = useDiscoverSeries(playlist, playlistVodHistory, adultVod, filter === 'all' || filter === 'series');
  useDiscoverRecommendations(playlist, history, adultVod, filter === 'all' || filter === 'movies' || filter === 'series', externalWatches, tmdbApiKey);
  const because = useMemo(() => {
    // 1. Source locale de la playlist
    const localSource = [...playlistVodHistory].sort((a, b) => b.ts - a.ts).find(entry =>
      entry.name && (entry.status === 'completed' || (entry.positionMs ?? 0) >= 60000)
      && !adultVod.isAdult(entry.mediaKind ?? 'movie', entry.categoryId)
      && forYou.some(item => item.sourceId === entry.channelId));
    if (localSource) {
      return { source: localSource, items: forYou.filter(item => item.sourceId === localSource.channelId) };
    }
    // 2. Source issue de « Vu ailleurs » (Trakt / synchro externe)
    const extSource = [...externalWatches].sort((a, b) => b.ts - a.ts).find(entry =>
      entry.name && forYou.some(item => item.sourceId === entry.channelId));
    if (extSource) {
      return { source: extSource, items: forYou.filter(item => item.sourceId === extSource.channelId) };
    }
    return null;
  }, [playlistVodHistory, externalWatches, forYou, adultVod]);
  const otherForYou = forYou.filter(item => !because?.items.includes(item));
  const toListen = useMemo(
    () => episodesToListen(feeds, episodesByFeed, podcastProgress, new Set(fresh.map(s => s.episode.id))),
    [feeds, episodesByFeed, podcastProgress, fresh],
  );
  // La sélection d'émissions par défaut n'apparaît que si l'utilisateur filtre sur « Podcasts », jamais sur l'accueil « Tout »
  const showSelection = feeds.length === 0 && filter === 'podcasts';

  const nonEmpty = useMemo(() => {
    const set = new Set<DiscoverRowId>();
    if (recentLive.length) set.add('recent-channels');
    if (favoriteChannels.length) set.add('live-now');
    if (resume.length) set.add('resume');
    if (podcastResume.length) set.add('resume-podcasts');
    if (forYou.some(item => !because?.items.includes(item))) set.add('for-you');
    if (because?.items.length) set.add('because-watched');
    if (nextSeries.length) set.add('next-series');
    if (platforms.length) set.add('platforms');
    if (documentaries.length) set.add('bodlav-documentaries');
    if (bodlavEnabled) { set.add('tv5-documentaries'); set.add('imago-documentaries'); }
    if (myList.length) set.add('my-list');
    if (fresh.length) set.add('new-episodes');
    if (toListen.length || showSelection) set.add('to-listen');
    return set;
  }, [resume, podcastResume, favoriteChannels, recentLive, forYou, because, nextSeries, platforms.length, documentaries.length, bodlavEnabled, myList, fresh, toListen, showSelection]);

  const rows = useMemo(() => orderRows(nonEmpty, families ?? DEFAULT_FAMILY_ORDER, filter), [nonEmpty, families, filter]);

  const resumePodcast = (prog: PodcastProgress) => {
    void AudioBridge.playEpisode({
      id: prog.episodeId,
      feedUrl: prog.feedUrl,
      audioUrl: prog.audioUrl,
      title: prog.title || 'Épisode',
      podcastTitle: prog.podcastTitle || 'Podcast',
      durationMs: prog.durationMs,
      ...(prog.artworkUrl ? { artworkUrl: prog.artworkUrl } : {}),
    });
  };
  const playEpisode = (s: EpisodeSuggestion) => {
    void AudioBridge.playEpisode({
      id: s.episode.id,
      feedUrl: s.feed.url,
      audioUrl: s.episode.audioUrl,
      title: s.episode.title,
      podcastTitle: s.episode.podcastTitle || s.feed.title,
      durationMs: s.episode.durationMs,
      ...((s.episode.artworkUrl || s.feed.artworkUrl) ? { artworkUrl: s.episode.artworkUrl || s.feed.artworkUrl } : {}),
    });
  };

  const resumeVod = (entry: PlayHistoryEntry) => {
    // `vod:<playlistId>:<kind>:<id>` → reprendre ce titre précis.
    const match = entry.channelId.match(/^vod:([^:]+):(movie|series):([^:]+)$/);
    if (match && onResumeVod) onResumeVod({ kind: match[2] as 'movie' | 'series', id: match[3], name: entry.name, seriesId: entry.seriesId });
    else onOpenVod(entry.mediaKind === 'series' ? 'series' : 'movie');
  };
  const openVodDetails = (entry: PlayHistoryEntry) => {
    const kind = entry.mediaKind === 'series' ? 'series' : 'movie';
    const poster = posterOf(entry);
    onOpenVod(kind, {
      id: vodItemId(entry),
      name: entry.name || 'Sans titre',
      kind,
      playlistId: playlist.id,
      addedAt: entry.ts,
      ...(poster ? { poster } : {}),
      ...(entry.categoryId ? { categoryId: entry.categoryId } : {}),
    });
  };
  const posterOf = (entry: PlayHistoryEntry) => safeImage(entry.poster) || safeImage(watchlistItems.find(w => w.id === vodItemId(entry) && w.kind === entry.mediaKind)?.poster);

  const manageEntry = async (entry: PlayHistoryEntry, action: 'hide' | 'completed') => {
    try {
      await manageContinueEntry(entry.channelId, action);
      setHistory(await getPlayHistory());
      toast.success(action === 'hide' ? 'Retiré de Reprendre. La position de lecture est conservée.' : 'Marqué comme vu.');
    } catch { toast.error('Impossible de mettre à jour ce titre. Réessaie.'); }
  };

  const refreshNow = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const report = await refreshPodcastFeeds({ force: true });
      const account = getXtreamAccount(playlist);
      if (account) {
        await Promise.allSettled([
          feedHomeRecommendations({ account, playlist, kind: 'movie', history, adult: adultVod }),
          feedHomeRecommendations({ account, playlist, kind: 'series', history, adult: adultVod }),
        ]);
      }
      if (report.failed && !report.refreshed) toast.error('Actualisation impossible. Les épisodes déjà connus restent affichés.');
      else toast.success('Émissions et suggestions à jour');
    } finally { setRefreshing(false); }
  };

  // Retour sur TV : d'abord la 1re carte de la rangée, puis les filtres, puis le menu.
  const onBack = useCallback((event: Event) => {
    if (!tvMode) return;
    const root = rootRef.current;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root || !active || !root.contains(active)) return;
    if (active.matches('[data-discover-filter]')) {
      if (focusDiscoverMenu(root)) event.preventDefault();
      return;
    }
    const rail = active.closest<HTMLElement>('[data-discover-rail]');
    if (rail) {
      const first = rail.querySelector<HTMLElement>('[data-discover-card]');
      if (first && first !== active && !first.contains(active)) { first.focus(); event.preventDefault(); return; }
      root.querySelector<HTMLElement>('[data-discover-filter][aria-pressed="true"]')?.focus();
      event.preventDefault();
    }
  }, [tvMode]);
  useEffect(() => {
    window.addEventListener('iptv-back', onBack);
    return () => window.removeEventListener('iptv-back', onBack);
  }, [onBack]);

  // L'accueil possède ses rangées : les flèches ne doivent jamais choisir un bouton
  // du menu à partir de coordonnées (rangées horizontales, filtres et actions imbriquées).
  const onDiscoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!tvMode || !event.key.startsWith('Arrow') || event.altKey || event.ctrlKey || event.metaKey) return;
    const root = rootRef.current;
    const target = event.target instanceof HTMLElement ? event.target.closest('button') : null;
    if (!root || !target) return;
    const filters = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-discover-filter]'));
    const selectedFilter = filters.find(b => b.getAttribute('aria-pressed') === 'true') ?? filters[0];
    const rowElements = Array.from(root.querySelectorAll<HTMLElement>('[data-discover-row]'));
    const cards = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLButtonElement>('[data-discover-card]:not(:disabled)'));
    const move = (next?: HTMLElement) => {
      event.preventDefault(); event.stopPropagation();
      if (next) focusRemote(next);
    };
    if (target.hasAttribute('data-discover-filter')) {
      const index = filters.indexOf(target);
      if (event.key === 'ArrowUp') { move(); focusDiscoverMenu(root); }
      else if (event.key === 'ArrowDown') move(rowElements[0] ? cards(rowElements[0])[0] : undefined);
      else if (event.key === 'ArrowLeft' && index === 0) { move(); focusDiscoverMenu(root); }
      else move(filters[index + (event.key === 'ArrowRight' ? 1 : -1)]);
      return;
    }
    const row = target.closest<HTMLElement>('[data-discover-row]');
    if (!row) { move(event.key === 'ArrowUp' ? selectedFilter : undefined); return; }
    const rowCards = cards(row);
    const article = target.closest('article');
    const primary = article?.querySelector<HTMLButtonElement>('[data-discover-card]');
    const actions = article ? Array.from(article.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(b => b !== primary) : [];
    const actionIndex = actions.indexOf(target);
    const cardIndex = Math.max(0, rowCards.indexOf(primary ?? target));
    if (actionIndex >= 0) {
      if (event.key === 'ArrowUp') { move(primary ?? undefined); return; }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        move(actions[actionIndex + (event.key === 'ArrowRight' ? 1 : -1)]); return;
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (event.key === 'ArrowLeft' && cardIndex === 0) { move(); focusDiscoverMenu(root); return; }
      move(rowCards[cardIndex + (event.key === 'ArrowRight' ? 1 : -1)]); return;
    } else if (event.key === 'ArrowDown' && primary === target && actions.length) {
      move(actions[0]); return;
    } else if (event.key === 'ArrowDown' && !rowCards.includes(target) && !article) {
      move(rowCards[0]); return;
    }
    const nextRow = rowElements[rowElements.indexOf(row) + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!nextRow) { move(event.key === 'ArrowUp' ? selectedFilter : undefined); return; }
    const nextCards = cards(nextRow);
    move(nextCards[Math.min(cardIndex, nextCards.length - 1)]);
  };

  if (loading || families === null) {
    return <p role="status" className="text-sm text-neutral-400">Chargement de Découvrir…</p>;
  }

  const posterW = tvMode ? 'w-[132px]' : 'w-[38%] sm:w-[160px]';
  const squareW = tvMode ? 'w-[136px]' : 'w-[36%] sm:w-[150px]';
  const wideW = tvMode ? 'w-[224px]' : 'w-[78%] sm:w-[300px]';
  const cardFocus = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-background';
  // Le registre est local au rendu : un filtre ou un verrouillage ne peut conserver une ancienne fiche.
  const visibleSelections = new Map<string, TvDiscoverSelection>();
  const peekProps = (id: string, selection: Omit<TvDiscoverSelection, 'key'>) => {
    if (!tvMode) return {};
    const key = `${playlist.id}:${filter}:${id}`;
    const current = { ...selection, key };
    // Les cartes sont rendues dans l'ordre des rangées : la première est le point d'entrée
    // depuis le rail, pour reprendre un titre sans passer par les filtres.
    const entry = visibleSelections.size === 0;
    visibleSelections.set(key, current);
    return { onFocus: () => setPeek(current), ...(entry ? { 'data-remote-entry': '' } : {}) };
  };

  // Les deux rangées de reprise partagent le même gabarit compact.
  const resumeBody = `press flex w-full ${tvMode ? 'h-[84px]' : 'h-[112px]'} items-center gap-3 overflow-hidden p-3 text-left ${cardFocus}`;

  const selectionTitle = (id: DiscoverRowId) => (id === 'to-listen' && showSelection ? 'Sélection CedPlay' : ROW_TITLES[id]);

  const renderResume = (item: ResumeItem) => {
    if (item.kind === 'podcast') {
      const prog = item.progress;
      const percent = prog.durationMs > 0 ? Math.min(100, Math.max(0, Math.round((prog.positionMs / prog.durationMs) * 100))) : null;
      const left = prog.durationMs > prog.positionMs ? `Reste ${formatEpisodeLength(prog.durationMs - prog.positionMs)}` : '';
      return (
        <article key={item.key} data-discover-resume className={`${wideW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card`}>
          <button type="button" data-discover-card onClick={() => resumePodcast(prog)} aria-label={`Reprendre ${prog.title}`} {...peekProps(item.key, { image: safeImage(prog.artworkUrl), imageLayout: 'square', eyebrow: 'Podcast · Reprendre', title: prog.title, meta: [prog.podcastTitle, left].filter(Boolean).join(' · '), hints: 'OK Reprendre l’écoute · ▼ Émission' })}
            className={resumeBody}>
            {prog.artworkUrl
              ? <img src={prog.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${tvMode ? 'h-12 w-12' : 'h-16 w-16'} shrink-0 rounded-xl bg-secondary object-cover`} />
              : <span className={`flex ${tvMode ? 'h-12 w-12' : 'h-16 w-16'} shrink-0 items-center justify-center rounded-xl bg-secondary text-[#5CC8B5]`}><Headphones className="h-6 w-6" aria-hidden="true" /></span>}
            <span className="min-w-0 flex-1">
              <span data-discover-kind className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#5CC8B5]"><Headphones className="h-3.5 w-3.5" aria-hidden="true" />Écouter</span>
              <span className="block truncate text-[12px] text-muted-foreground">{prog.podcastTitle}</span>
              <span className={`block truncate ${tvMode ? 'text-[16px]' : 'text-[14px]'} font-semibold text-foreground`}>{prog.title}</span>
              {left && <span className="block text-[12px] text-muted-foreground">{left}</span>}
            </span>
          </button>
          <span className="block h-1 w-full bg-neutral-800"><span className="block h-full bg-[#5CC8B5]" style={{ width: `${percent ?? 0}%` }} /></span>
          {onOpenPodcasts && <div className="flex border-t border-neutral-800">
            <button type="button" onClick={() => onOpenPodcasts(prog.feedUrl)} aria-label={`Voir l’émission ${prog.podcastTitle}`} className="flex min-h-11 flex-1 items-center justify-center gap-1 px-2 text-xs text-neutral-300 hover:bg-white/10"><Info className="h-3.5 w-3.5" aria-hidden="true" />Émission</button>
          </div>}
        </article>
      );
    }
    const entry = item.entry;
    const poster = posterOf(entry);
    const percent = entry.durationMs && entry.durationMs > 0 ? Math.min(100, Math.max(0, Math.round((entry.positionMs || 0) / entry.durationMs * 100))) : null;
    const remaining = Math.max(0, Math.ceil(((entry.durationMs || 0) - (entry.positionMs || 0)) / 60000));
    const kindLabel = entry.mediaKind === 'series' ? 'Série' : 'Film';
    return <article key={item.key} data-discover-resume className={`${wideW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card`}>
      <button type="button" data-discover-card aria-label={`Reprendre ${entry.name || 'ce titre'}`} onClick={() => resumeVod(entry)} {...peekProps(item.key, { image: poster, imageLayout: 'poster', eyebrow: `${kindLabel} · Reprendre`, title: entry.name || 'Sans titre', meta: [entry.episodeName, percent !== null ? `${remaining} min restantes` : null].filter(Boolean).join(' · ') || undefined, hints: 'OK Reprendre' })}
        className={resumeBody}>
        <span style={{ width: tvMode ? 40 : 48, height: tvMode ? 60 : 72 }} className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-900">
          {entry.mediaKind === 'series' ? <MonitorPlay className="h-6 w-6 text-primary" aria-hidden="true" /> : <Film className="h-6 w-6 text-primary" aria-hidden="true" />}
          {poster && <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span data-discover-kind className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary"><Play className="h-3.5 w-3.5" aria-hidden="true" />Regarder</span>
          <span className={`block line-clamp-2 ${tvMode ? 'text-[16px]' : 'text-[14px]'} font-semibold leading-tight text-foreground`}>{entry.name || 'Sans titre'}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{entry.episodeName || `${kindLabel} · Reprendre à ${Math.max(1, Math.floor((entry.positionMs || 0) / 60000))} min`}</span>
          {percent !== null && <span data-discover-progress-copy className="block text-[12px] text-muted-foreground">{percent} % · {remaining} min restantes</span>}
        </span>
      </button>
      <div role={percent !== null ? 'progressbar' : undefined} aria-label={percent !== null ? `Progression de ${entry.name || 'ce titre'}` : undefined} aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100} className="h-1 w-full bg-neutral-800"><div className="h-full bg-primary" style={{ width: `${percent ?? 0}%` }} /></div>
      <div className="grid grid-cols-3 border-t border-neutral-800">
        <button type="button" aria-label={`Fiche de ${entry.name || 'ce titre'}`} onClick={() => openVodDetails(entry)} className="flex min-h-11 min-w-0 items-center justify-center gap-1 px-1 py-2 text-xs text-neutral-300 hover:bg-white/10"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Fiche</button>
        <button type="button" aria-label={`Marquer ${entry.name || 'ce titre'} comme vu`} onClick={() => { void manageEntry(entry, 'completed'); }} className="flex min-h-11 min-w-0 items-center justify-center gap-1 px-1 py-2 text-xs text-neutral-300 hover:bg-white/10"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Vu</button>
        <button type="button" aria-label={`Retirer ${entry.name || 'ce titre'} de Reprendre`} onClick={() => { void manageEntry(entry, 'hide'); }} className="flex min-h-11 min-w-0 items-center justify-center gap-1 px-1 py-2 text-xs text-neutral-300 hover:bg-white/10"><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Retirer</button>
      </div>
    </article>;
  };

  const renderChannelNow = (channel: Channel) => {
    const now = new Date();
    const current = epgData ? getCurrentProgram(channel.id, epgData, now) : null;
    const upcoming = epgData ? getUpcomingProgram(channel.id, epgData, now) : null;
    const start = current ? new Date(current.startTime).getTime() : 0;
    const end = current ? new Date(current.endTime).getTime() : 0;
    const percent = current && end > start ? Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100)) : null;
    const line = current ? current.title : upcoming ? `Ensuite ${hhmm(upcoming.startTime)} · ${upcoming.title}` : 'Programme non renseigné';
    return <button
      key={channel.id}
      type="button"
      data-discover-card
      onClick={() => onChannelSelect(channel)}
      {...peekProps(`live:${channel.id}`, { image: safeImage(channel.logo), imageLayout: 'logo', channelName: channel.name, description: current?.description, eyebrow: `En direct · ${channel.name}`, title: current?.title || channel.name, meta: current ? `${hhmm(current.startTime)} – ${hhmm(current.endTime)}${upcoming ? ` · Ensuite ${hhmm(upcoming.startTime)} ${upcoming.title}` : ''}` : line, hints: 'OK Regarder · le guide est dans le lecteur' })}
      className={`press relative ${wideW} flex shrink-0 snap-start items-center gap-3 overflow-hidden rounded-2xl border border-neutral-900 bg-card p-3 text-left hover:bg-accent/60 ${tvMode ? 'min-h-[94px]' : 'min-h-[72px]'} ${cardFocus}`}
    >
      <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${tvMode ? 'text-[16px]' : 'text-[15px]'} font-medium text-foreground`}>{channel.name}</span>
        <span className={`block truncate ${tvMode ? 'text-[13px]' : 'text-[13px]'} text-muted-foreground`}>{line}</span>
        {percent !== null && current && <span className="mt-1.5 flex items-center gap-2">
          <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-neutral-800"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>
          <time className="font-mono text-[11px] text-neutral-500">{hhmm(current.endTime)}</time>
        </span>}
      </span>
    </button>;
  };

  const renderEpisode = (s: EpisodeSuggestion, kindLabel: string) => {
    const art = s.episode.artworkUrl || s.feed.artworkUrl;
    const meta = [dayLabel(s.episode.publishedAt), s.episode.durationMs ? formatEpisodeLength(s.episode.durationMs) : ''].filter(Boolean).join(' · ');
    return <article key={s.episode.id} className={`${squareW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card`}>
      <button type="button" data-discover-card onClick={() => playEpisode(s)} aria-label={`Écouter ${s.episode.title}, ${s.feed.title}`} {...peekProps(`episode:${s.episode.id}`, { image: safeImage(art), imageLayout: 'square', eyebrow: `Podcast · ${kindLabel}`, title: s.episode.title, meta: [s.feed.title, meta].filter(Boolean).join(' · '), hints: 'OK Écouter · ▼ Émission' })}
        className={`press w-full text-left ${cardFocus}`}>
        <div style={SQUARE} className="relative flex items-center justify-center overflow-hidden bg-secondary text-[#5CC8B5]">
          <Headphones className="h-8 w-8" aria-hidden="true" />
          {art && <img src={art} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
        </div>
        <div className="p-2">
          <p className="truncate text-[11px] text-muted-foreground">{s.feed.title}</p>
          <p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2 font-medium`}>{s.episode.title}</p>
          <p className="mt-1 text-[11px] text-neutral-400">{meta || s.reason}</p>
        </div>
      </button>
      {onOpenPodcasts && <button type="button" onClick={() => onOpenPodcasts(s.feed.url)} aria-label={`Voir l’émission ${s.feed.title}`} className="flex min-h-11 w-full items-center justify-center gap-1 border-t border-neutral-800 px-2 text-xs text-neutral-300 hover:bg-white/10"><Info className="h-3.5 w-3.5" aria-hidden="true" />Émission</button>}
    </article>;
  };

  const renderRow = (id: DiscoverRowId) => {
    switch (id) {
      case 'tv5-documentaries':
      case 'imago-documentaries': {
        const source = id === 'tv5-documentaries' ? 'tv5mondeplus' : 'imagotv';
        const config = OFFICIAL_DOCUMENTARY_SOURCES[source];
        const items = source === 'tv5mondeplus' ? tv5Documentaries : imagoDocumentaries;
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption={`À découvrir sur ${config.name} · ouvrir le site officiel`}>
          {items.map(item => <button key={item.id} type="button" data-discover-card onClick={() => openOfficialDocumentary(source, item.url, item.title)} aria-label={`Ouvrir ${item.title} sur ${config.name}`}
            {...peekProps(`${source}:${item.id}`, { image: item.image, imageLayout: 'poster', title: item.title, eyebrow: `Documentaire · ${config.name}`, meta: item.year ?? config.name, hints: `OK Ouvrir la fiche sur ${config.name}` })}
            className={`poster press ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
            <div style={POSTER} className="relative flex items-center justify-center overflow-hidden bg-neutral-900">
              <Film className="h-8 w-8 text-primary" aria-hidden="true" />
              {item.image && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            </div>
            <div className="p-2"><p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2`}>{item.title}</p><p className="mt-1 text-[11px] text-neutral-400">{[item.year, config.name].filter(Boolean).join(' · ')}</p></div>
          </button>)}
          <button type="button" data-discover-card onClick={() => openOfficialDocumentary(source, config.url, config.name)} aria-label={`Tous les documentaires sur ${config.name}`}
            {...peekProps(`${source}:catalogue`, { imageLayout: 'poster', title: 'Tous les documentaires', eyebrow: config.name, meta: 'Parcourir la rubrique officielle', hints: `OK Ouvrir ${config.name}` })}
            className={`poster press ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
            <div style={POSTER} className="flex items-center justify-center bg-neutral-900"><Film className="h-10 w-10 text-primary" aria-hidden="true" /></div>
            <div className="p-2"><p className={`${tvMode ? 'text-[15px]' : 'text-xs'}`}>Tous les documentaires</p><p className="mt-1 text-[11px] text-neutral-400">{config.name}</p></div>
          </button>
        </DiscoverRow>;
      }
      case 'bodlav-documentaries':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="À découvrir sur Bodlav · ouvrir la fiche sur le site">{documentaries.map(item => (
          <button key={item.id} type="button" data-discover-card onClick={() => openBodlavDocumentary(item)} aria-label={`Ouvrir ${item.title} sur Bodlav`}
            {...peekProps(`bodlav:${item.id}`, { image: item.image, imageLayout: 'poster', title: item.title, eyebrow: 'Documentaire · Bodlav', meta: [item.year, item.language].filter(Boolean).join(' · '), hints: 'OK Ouvrir la fiche sur Bodlav' })}
            className={`poster press ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
            <div style={POSTER} className="relative flex items-center justify-center overflow-hidden bg-neutral-900">
              <Film className="h-8 w-8 text-primary" aria-hidden="true" />
              {item.image && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            </div>
            <div className="p-2">
              <p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2`}>{item.title}</p>
              <p className="mt-1 text-[11px] text-neutral-400">{[item.year, item.language, 'Bodlav'].filter(Boolean).join(' · ')}</p>
            </div>
          </button>
        ))}</DiscoverRow>;
      case 'platforms':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="Ouvrir l’application ou le site officiel">{platforms.map(platform => (
          <button key={platform.id} type="button" data-discover-card onClick={() => openDiscoverPlatform(platform)}
            {...peekProps(`platform:${platform.id}`, { imageLayout: 'logo', channelName: platform.name, title: platform.name, eyebrow: 'Mes plateformes', meta: platform.note, hints: 'OK Ouvrir l’application officielle' })}
            className={`press ${squareW} shrink-0 rounded-xl bg-card p-3 text-left ${cardFocus}`}>
            <PlatformLogo platformId={platform.id} name={platform.name} className="h-16 w-full rounded-lg" />
            <span className="mt-2 block text-sm font-medium">{platform.name}</span>
          </button>
        ))}</DiscoverRow>;
      case 'next-series':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="Disponibles chez ton fournisseur, après un épisode terminé">{nextSeries.map(({ seed, episode }) => (
          <button key={`${seed.seriesId}:${episode.id}`} type="button" data-discover-card
            onClick={() => onResumeVod ? onResumeVod({ kind: 'series', id: episode.id, seriesId: seed.seriesId, name: seed.name }) : openVodDetails(seed)}
            {...peekProps(`next:${seed.seriesId}:${episode.id}`, { image: posterOf(seed), imageLayout: 'poster', title: seed.name || 'Série', eyebrow: 'Épisode suivant', meta: `S${episode.season} · E${episode.number} · ${episode.name}`, hints: onResumeVod ? 'OK Regarder' : 'OK Fiche de la série' })}
            className={`press ${wideW} shrink-0 rounded-xl bg-card p-3 text-left ${cardFocus}`}>
            <span className="block truncate font-medium">{seed.name}</span>
            <span className="mt-1 block text-sm text-muted-foreground">S{episode.season} · E{episode.number}</span>
            <span className="mt-1 block truncate text-sm">{episode.name}</span>
          </button>
        ))}</DiscoverRow>;
      case 'resume':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode}>{resume.map(renderResume)}</DiscoverRow>;
      case 'resume-podcasts':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode}>{podcastResume.map(renderResume)}</DiscoverRow>;
      case 'live-now':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="Tes chaînes favorites et leur programme">{favoriteChannels.map(renderChannelNow)}</DiscoverRow>;
      case 'recent-channels':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode}>{recentLive.map(channel => (
          <button key={channel.id} type="button" data-discover-card onClick={() => onChannelSelect(channel)} {...peekProps(`recent:${channel.id}`, { image: safeImage(channel.logo), imageLayout: 'logo', channelName: channel.name, eyebrow: 'Chaîne récente', title: channel.name, meta: channel.group, hints: 'OK Regarder' })}
            className={`press flex shrink-0 snap-start items-center gap-3 rounded-full border border-neutral-900 bg-card py-2 pl-2 pr-4 text-left hover:bg-accent/60 ${cardFocus}`}>
            <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
            <span className={`${tvMode ? 'text-[16px]' : 'text-xs'} max-w-[12rem] truncate`}>{channel.name}</span>
          </button>
        ))}</DiscoverRow>;
      case 'because-watched':
      case 'for-you': {
        const items = id === 'because-watched' ? because?.items ?? [] : otherForYou;
        const hasLibrary = items.some(item => item.availability !== 'discover');
        const hasDiscover = items.some(item => item.availability === 'discover');
        const rowCaption = hasLibrary && hasDiscover
          ? 'D’après tes visionnages · bibliothèque et découvertes ailleurs'
          : hasDiscover
            ? 'D’après tes visionnages · à découvrir ailleurs'
            : 'D’après tes visionnages · disponibles dans ta bibliothèque';
        return <DiscoverRow key={id} id={id} title={id === 'because-watched' ? `Parce que tu as regardé « ${because?.source.name} »` : selectionTitle(id)} tvMode={tvMode} caption={rowCaption}>{items.map(item => {
          const isDiscover = item.availability === 'discover';
          const kind = item.kind ?? 'movie';
          const kindLabel = kind === 'series' ? 'Série' : 'Film';
          const openItem = () => {
            if (isDiscover) {
              if (onSearchTitle) onSearchTitle(item.name);
              else toast.info(`« ${item.name} » est conseillé hors de ta bibliothèque actuelle.`);
              return;
            }
            onOpenVod(kind, { id: item.id, name: item.name, kind, playlistId: playlist.id, addedAt: 0, ...(item.poster ? { poster: item.poster } : {}), ...(item.categoryId ? { categoryId: item.categoryId } : {}) });
          };
          return <button key={item.id} type="button" data-discover-card onClick={openItem}
            {...peekProps(`for-you:${kind}:${item.id}`, {
              image: safeImage(item.poster),
              imageLayout: 'poster',
              eyebrow: `${kindLabel} · ${isDiscover ? 'À découvrir' : 'Bibliothèque'}`,
              title: item.name,
              meta: item.reason,
              hints: isDiscover ? (onSearchTitle ? 'OK Rechercher dans le catalogue' : 'OK À découvrir ailleurs') : 'OK Fiche du film',
            })}
            className={`poster press ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
            <div style={POSTER} className="relative flex items-center justify-center overflow-hidden bg-neutral-900">
              <Film className="h-8 w-8 text-primary" aria-hidden="true" />
              {safeImage(item.poster) && <img src={safeImage(item.poster)} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
              <span className={`absolute left-1.5 top-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm ${isDiscover ? 'border-amber-400/30 bg-neutral-950/85 text-amber-200' : 'border-emerald-400/30 bg-neutral-950/85 text-emerald-300'}`}>
                {isDiscover ? 'À découvrir' : 'Bibliothèque'}
              </span>
            </div>
            <div className="p-2">
              <p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2`}>{item.name}</p>
              {item.reason && <p className="mt-1 line-clamp-2 text-[11px] text-neutral-400">{item.reason}</p>}
            </div>
          </button>;
        })}</DiscoverRow>;
      }
      case 'my-list':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption={`${watchlistItems.length} titre${watchlistItems.length > 1 ? 's' : ''} gardé${watchlistItems.length > 1 ? 's' : ''}`}>{myList.map(item => (
          <button key={`${item.kind}:${item.id}`} type="button" data-discover-card onClick={() => onOpenVod(item.kind, item)}
            {...peekProps(`my-list:${item.kind}:${item.id}`, { image: safeImage(item.poster), imageLayout: 'poster', eyebrow: `${item.kind === 'series' ? 'Série' : 'Film'} · Ma liste`, title: item.name, meta: item.rating ? `★ ${item.rating}` : undefined, hints: 'OK Fiche, saisons, Retirer de Ma liste' })}
            className={`poster press ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
            <div style={POSTER} className="flex items-center justify-center overflow-hidden bg-neutral-900">
              {item.poster ? <img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                : item.kind === 'series' ? <MonitorPlay className="h-8 w-8 text-primary" aria-hidden="true" /> : <Film className="h-8 w-8 text-primary" aria-hidden="true" />}
            </div>
            <div className="p-2">
              <p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2`}>{item.name}</p>
              <p className="mt-1 text-[11px] text-neutral-400">{item.kind === 'series' ? 'Série' : 'Film'}{item.rating ? ` · ★ ${item.rating}` : ''}</p>
            </div>
          </button>
        ))}</DiscoverRow>;
      case 'new-episodes':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="Des émissions que tu suis"
          action={<button type="button" onClick={() => { void refreshNow(); }} aria-label={refreshing ? 'Actualisation des émissions…' : 'Actualiser les émissions maintenant'}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full border border-neutral-800 px-3 text-xs text-neutral-300 hover:bg-white/10">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />{tvMode && <span>{refreshing ? 'Actualisation…' : 'Actualiser'}</span>}
          </button>}>{fresh.map(s => renderEpisode(s, 'Nouvel épisode'))}</DiscoverRow>;
      case 'to-listen':
        if (showSelection) {
          return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="Émissions à écouter · pas encore personnalisée, la même pour tout le monde">{DEFAULT_PODCAST_SUGGESTIONS.slice(0, 10).map(s => (
            <button key={s.id} type="button" data-discover-card onClick={() => onOpenPodcasts?.()} {...peekProps(`selection:${s.id}`, { image: safeImage(s.artworkUrl), imageLayout: 'square', eyebrow: 'Sélection CedPlay', title: s.title, meta: [s.author, s.genre].filter(Boolean).join(' · '), hints: 'OK Voir dans Podcasts' })}
              className={`press ${squareW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
              <div style={SQUARE} className="relative flex items-center justify-center overflow-hidden bg-secondary text-[#5CC8B5]">
                <Headphones className="h-8 w-8" aria-hidden="true" />
                <img src={s.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
              </div>
              <div className="p-2">
                <p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2 font-medium`}>{s.title}</p>
                <p className="mt-1 truncate text-[11px] text-neutral-400">{s.genre || s.author}</p>
              </div>
            </button>
          ))}</DiscoverRow>;
        }
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="Épisodes pas encore écoutés">{toListen.map(s => renderEpisode(s, 'À écouter'))}</DiscoverRow>;
    }
  };

  // TV, rien à reprendre ni à proposer : l'accueil devient un point de départ, pas une page vide.
  const hasDiscoverContent = rows.some(id => id !== 'tv5-documentaries' && id !== 'imago-documentaries') || tv5Documentaries.length > 0 || imagoDocumentaries.length > 0;
  const firstRun = tvMode && filter === 'all' && !hasDiscoverContent;
  const starterActions: TvStarterAction[] = firstRun ? [
    ...(onBrowseLive ? [{ key: 'live', label: 'Regarder le direct', hint: `${playlist.channels.length.toLocaleString('fr-FR')} chaînes prêtes dans « ${playlist.name} »`, Icon: Tv, onSelect: onBrowseLive }] : []),
    ...(onConnect && !getXtreamAccount(playlist) ? [{ key: 'connect', label: 'Connecter un abonnement', hint: 'Les chaînes, films et séries de ton fournisseur', Icon: ListVideo, onSelect: onConnect }] : []),
    ...(onOpenPodcasts ? [{ key: 'podcasts', label: 'Écouter un podcast', hint: 'Affaires sensibles, Transfert, L’Heure du Monde…', Icon: Headphones, onSelect: () => onOpenPodcasts() }] : []),
  ] : [];
  const renderedRows = rows.map(renderRow);
  const heroSelection = (peek && visibleSelections.get(peek.key)) || visibleSelections.values().next().value;
  const cardEntry = visibleSelections.size > 0;

  // Téléphone : un bandeau à faire glisser, d'abord ce qui est en cours, puis « Pour toi ».
  const forYouHero = (item: ForYouSnapshotItem): HeroItem => {
    const kind = item.kind ?? 'movie';
    const isDiscover = item.availability === 'discover';
    return {
      key: `for-you:${kind}:${item.id}`,
      eyebrow: `${kind === 'series' ? 'Série' : 'Film'} · ${isDiscover ? 'À découvrir' : 'Bibliothèque'}`,
      title: item.name,
      meta: item.reason,
      image: safeImage(item.poster),
      actionLabel: isDiscover ? (onSearchTitle ? 'Rechercher' : 'À découvrir') : 'Voir la fiche',
      onPlay: () => {
        if (isDiscover) {
          if (onSearchTitle) onSearchTitle(item.name);
          else toast.info(`« ${item.name} » est conseillé hors de ta bibliothèque actuelle.`);
          return;
        }
        onOpenVod(kind, { id: item.id, name: item.name, kind, playlistId: playlist.id, addedAt: 0, ...(item.poster ? { poster: item.poster } : {}), ...(item.categoryId ? { categoryId: item.categoryId } : {}) });
      },
    };
  };
  const heroItems: HeroItem[] = tvMode || filter === 'podcasts' ? [] : [
    ...resume.flatMap((item): HeroItem[] => {
      if (item.kind !== 'vod') return [];
      const entry = item.entry;
      const percent = entry.durationMs && entry.durationMs > 0 ? Math.min(100, Math.max(0, Math.round((entry.positionMs || 0) / entry.durationMs * 100))) : null;
      const remaining = Math.max(0, Math.ceil(((entry.durationMs || 0) - (entry.positionMs || 0)) / 60000));
      return [{
        key: item.key,
        eyebrow: `${entry.mediaKind === 'series' ? 'Série' : 'Film'} · Reprendre`,
        title: entry.name || 'Sans titre',
        meta: [entry.episodeName, percent !== null ? `${remaining} min restantes` : null].filter(Boolean).join(' · ') || undefined,
        image: posterOf(entry),
        progress: percent,
        actionLabel: 'Reprendre',
        onPlay: () => resumeVod(entry),
        detailsLabel: `Fiche de ${entry.name || 'ce titre'}`,
        onDetails: () => openVodDetails(entry),
      }];
    }).filter(item => item.image).slice(0, 2),
    ...forYou.map(forYouHero),
  ].filter(item => item.image).slice(0, MAX_HERO_ITEMS);

  return (
    <div ref={rootRef} data-discover-tv={tvMode ? '' : undefined} data-discover-has-hero={tvMode && heroSelection ? '' : undefined} data-discover-screen data-remote-self={tvMode ? '' : undefined} onKeyDown={onDiscoverKeyDown} className={tvMode ? 'space-y-3' : 'space-y-6'}>
      <div data-discover-filters className={`${tvMode ? '' : 'sticky top-0'} z-20 -mx-2 flex items-center bg-background/95 px-2 py-2 backdrop-blur ${tvMode ? 'gap-4' : 'flex-wrap gap-2 sm:mx-0 sm:px-0'}`}>
        <div role="group" aria-label="Type de contenu" className="inline-flex shrink-0 rounded-full border border-neutral-900 bg-card p-1">
          {FILTERS.map(f => (
            <button key={f.value} type="button" data-discover-filter data-remote-entry={tvMode && !cardEntry && filter === f.value ? '' : undefined} aria-pressed={filter === f.value} onClick={() => { setFilter(f.value); setPeek(null); }}
              {...(f.value === 'all' && rows.length === 0 && !firstRun ? { 'data-remote-start': true } : {})}
              className={`${tvMode ? 'min-h-9 px-4 text-[15px]' : 'min-h-10 px-4 text-sm'} rounded-full font-medium transition-colors ${filter === f.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {tvMode && heroSelection && <TvDiscoverHero selection={heroSelection} />}
      {heroItems.length > 0 && <HeroCarousel items={heroItems} />}

      {firstRun && <TvStarter discover title="Par où commencer ?" text="Retrouve ici tes chaînes récentes, tes films à reprendre et tes podcasts." actions={starterActions} />}
      {!hasDiscoverContent && filter === 'all' && !tvMode && <div className="py-6 text-center">
        <Clock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-neutral-300">Rien à reprendre pour le moment.</p>
        <p className="mt-1 text-sm text-neutral-500">Lance une chaîne, ajoute des favoris (<Heart className="inline h-3.5 w-3.5" aria-label="cœur" />) ou un titre à Ma liste (<Bookmark className="inline h-3.5 w-3.5" aria-label="signet" />).</p>
        {onBrowseLive && <button type="button" data-remote-start onClick={onBrowseLive} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Tv className="h-4 w-4" aria-hidden="true" />Voir les chaînes en direct</button>}
      </div>}

      {renderedRows}

      {rows.length === 0 && filter !== 'all' && <div className="py-12 text-center">
        <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-neutral-300">Rien à proposer dans {FILTERS.find(f => f.value === filter)?.label} pour le moment.</p>
        <p className="mt-1 text-sm text-neutral-500">Les rangées apparaissent dès qu’un contenu y a sa place.</p>
      </div>}
    </div>
  );
}
