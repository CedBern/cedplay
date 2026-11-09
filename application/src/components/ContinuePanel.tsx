import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChannelLogo } from '@/components/ChannelLogo';
import { getPlayHistory, getVodWatchlistFromDB, getFavoritesFromDB, manageContinueEntry, type PlayHistoryEntry, type VodWatchlistItem } from '@/utils/idb';
import { getCurrentProgram, getUpcomingProgram } from '@/utils/epgXmltv';
import type { EPGData } from '@/types/epg';
import { safeImage } from '@/utils/xtreamCatalog';
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
  type DiscoverFilter, type DiscoverRowId, type EpisodeSuggestion, type ResumeItem,
} from '@/utils/discover';
import { DEFAULT_FAMILY_ORDER, familyOrder, readUsageJournal, type DiscoverFamily } from '@/utils/usageJournal';
import { Bookmark, Check, Clock, Film, Headphones, Heart, Info, MonitorPlay, Play, RefreshCw, Sparkles, Tv, X } from 'lucide-react';

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
  onBrowseLive?: (() => void) | undefined;
  tvMode?: boolean | undefined;
}

const hhmm = (d: Date) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Favoris affichés sur l'accueil ; la liste complète reste dans Direct › Favoris. */
const MAX_FAVORITES = 12;

const FILTERS: { value: DiscoverFilter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'movies', label: 'Films' },
  { value: 'series', label: 'Séries' },
  { value: 'podcasts', label: 'Podcasts' },
];

const ROW_TITLES: Record<DiscoverRowId, string> = {
  resume: 'Reprendre',
  'live-now': 'Mes chaînes en ce moment',
  'recent-channels': 'Chaînes récentes',
  'for-you': 'Pour toi',
  'my-list': 'Ma liste',
  'new-episodes': 'Nouveaux épisodes',
  'to-listen': 'À écouter',
};

/** Fiche éclair TV : ce que montre la carte sous le focus. */
interface Peek {
  eyebrow: string;
  title: string;
  meta?: string | undefined;
  hints: string;
}

const dayLabel = (ms: number) => {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

/** Une rangée : composant de module, pour que le focus télécommande survive aux re-rendus. */
function DiscoverRow({ id, title, children, action, caption, tvMode }: { id: DiscoverRowId; title: string; children: ReactNode; action?: ReactNode; caption?: string | undefined; tvMode: boolean }) {
  return (
    <section aria-label={title} data-discover-row={id}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${tvMode ? 'text-[21px]' : 'text-[17px]'} font-semibold tracking-tight text-foreground`}>{title}</h2>
          {caption && <p className={`${tvMode ? 'text-[15px]' : 'text-[12px]'} text-muted-foreground`}>{caption}</p>}
        </div>
        {action}
      </div>
      <div data-discover-rail className="rail -mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-2 px-2 py-1.5 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {children}
      </div>
    </section>
  );
}

export function ContinuePanel({ playlist, onChannelSelect, onOpenVod, onResumeVod, onOpenPodcasts, lockedGroups, unlocked, parentalEnabled, epgData, onBrowseLive, tvMode = false }: ContinuePanelProps) {
  const adultVod = useAdultVodCategories(playlist, parentalEnabled === true && !unlocked);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [watchlist, setWatchlist] = useState<VodWatchlistItem[]>([]);
  const [podcastProgress, setPodcastProgress] = useState<Record<string, PodcastProgress>>(() => readAllEpisodeProgress());
  const [feeds, setFeeds] = useState<PodcastFeed[]>(() => readPodcastFeeds());
  const [episodesByFeed, setEpisodesByFeed] = useState<Record<string, PodcastEpisode[]>>(() => readPodcastEpisodesByFeed());
  const [forYouSnapshot] = useState(() => readForYouSnapshot(playlist.id));
  // Ordre des familles : calculé une fois à l'ouverture, puis figé jusqu'à la prochaine.
  const [families, setFamilies] = useState<DiscoverFamily[] | null>(null);
  const [filter, setFilter] = useState<DiscoverFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);
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
    ])
      .then(([entries, wl]) => {
        if (!cancelled) {
          setHistory(entries);
          setWatchlist(wl);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    const handleWatchlistUpdate = () => {
      void getVodWatchlistFromDB().then(wl => { if (!cancelled) setWatchlist(wl); });
    };
    window.addEventListener('vod-watchlist-updated', handleWatchlistUpdate);
    const handleHistoryUpdate = () => {
      void getPlayHistory().then(entries => { if (!cancelled) setHistory(entries); }).catch(() => {});
    };
    window.addEventListener('vod-history-updated', handleHistoryUpdate);
    const handleFavoritesUpdate = () => {
      void getFavoritesFromDB().then(ids => { if (!cancelled) setFavoriteIds(ids); }).catch(() => {});
    };
    handleFavoritesUpdate();
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
      window.removeEventListener('favorites-updated', handleFavoritesUpdate);
      window.removeEventListener('vod-watchlist-updated', handleWatchlistUpdate);
      window.removeEventListener('vod-history-updated', handleHistoryUpdate);
    };
  }, [playlist.id]);

  // Index de toutes les chaînes jouables (base + variantes) de la liste active.
  const channelById = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const group of playlist.groups) {
      for (const channel of group.channels) {
        map.set(channel.id, channel);
        for (const variant of channel.variants || []) map.set(variant.id, variant);
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
  const myList = useMemo(
    () => watchlistItems.filter(i => filter === 'all' || (filter === 'movies' && i.kind === 'movie') || (filter === 'series' && i.kind === 'series')).slice(0, MAX_MY_LIST),
    [watchlistItems, filter],
  );

  const forYou = useMemo(() => {
    if (filter !== 'all' && filter !== 'movies') return [];
    const resumeIds = new Set(resume.flatMap(r => (r.kind === 'vod' ? [vodItemId(r.entry)] : [])));
    return forYouItems(forYouSnapshot.filter(i => !adultVod.isAdult('movie', i.categoryId)), resumeIds, watchlistItems);
  }, [filter, resume, forYouSnapshot, watchlistItems, adultVod]);

  const fresh = useMemo(() => newEpisodes(feeds, episodesByFeed, podcastProgress, Date.now()), [feeds, episodesByFeed, podcastProgress]);
  const toListen = useMemo(
    () => episodesToListen(feeds, episodesByFeed, podcastProgress, new Set(fresh.map(s => s.episode.id))),
    [feeds, episodesByFeed, podcastProgress, fresh],
  );
  const showSelection = feeds.length === 0;

  const nonEmpty = useMemo(() => {
    const set = new Set<DiscoverRowId>();
    if (resume.length) set.add('resume');
    if (favoriteChannels.length) set.add('live-now');
    if (recentLive.length) set.add('recent-channels');
    if (forYou.length) set.add('for-you');
    if (myList.length) set.add('my-list');
    if (fresh.length) set.add('new-episodes');
    if (toListen.length || showSelection) set.add('to-listen');
    return set;
  }, [resume, favoriteChannels, recentLive, forYou, myList, fresh, toListen, showSelection]);

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
      if (report.failed && !report.refreshed) toast.error('Actualisation impossible. Les épisodes déjà connus restent affichés.');
      else toast.success('Émissions à jour');
    } finally { setRefreshing(false); }
  };

  // Retour sur TV : d'abord la 1re carte de la rangée, puis les filtres, puis le menu.
  const onBack = useCallback((event: Event) => {
    if (!tvMode) return;
    const root = rootRef.current;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root || !active || !root.contains(active)) return;
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

  if (loading || families === null) {
    return <p role="status" className="text-sm text-neutral-400">Chargement de Découvrir…</p>;
  }

  const onlyEmptySelection = rows.length === 1 && rows[0] === 'to-listen' && showSelection && filter === 'all'
    && favoriteChannels.length === 0 && recentLive.length === 0 && resume.length === 0 && watchlistItems.length === 0;

  const posterW = tvMode ? 'w-[168px]' : 'w-[38%] sm:w-[160px]';
  const squareW = tvMode ? 'w-[200px]' : 'w-[36%] sm:w-[150px]';
  const wideW = tvMode ? 'w-[300px]' : 'w-[78%] sm:w-[300px]';
  const cardFocus = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-background';
  const peekProps = (p: Peek) => (tvMode ? { onFocus: () => setPeek(p) } : {});

  const selectionTitle = (id: DiscoverRowId) => (id === 'to-listen' && showSelection ? 'Sélection CedPlay' : ROW_TITLES[id]);

  const renderResume = (item: ResumeItem) => {
    if (item.kind === 'podcast') {
      const prog = item.progress;
      const percent = prog.durationMs > 0 ? Math.min(100, Math.max(0, Math.round((prog.positionMs / prog.durationMs) * 100))) : null;
      const left = prog.durationMs > prog.positionMs ? `Reste ${formatEpisodeLength(prog.durationMs - prog.positionMs)}` : '';
      return (
        <article key={item.key} className={`${wideW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card`}>
          <button type="button" data-discover-card onClick={() => resumePodcast(prog)} aria-label={`Reprendre ${prog.title}`} {...peekProps({ eyebrow: 'Podcast · Reprendre', title: prog.title, meta: [prog.podcastTitle, left].filter(Boolean).join(' · '), hints: 'OK Reprendre l’écoute · ▼ Émission' })}
            className={`press flex w-full items-center gap-3 p-3 text-left ${cardFocus}`}>
            {prog.artworkUrl
              ? <img src={prog.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${tvMode ? 'h-20 w-20' : 'h-14 w-14'} shrink-0 rounded-xl bg-secondary object-cover`} />
              : <span className={`flex ${tvMode ? 'h-20 w-20' : 'h-14 w-14'} shrink-0 items-center justify-center rounded-xl bg-secondary text-[#5CC8B5]`}><Headphones className="h-6 w-6" aria-hidden="true" /></span>}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#5CC8B5]"><Headphones className="h-3.5 w-3.5" aria-hidden="true" />Écouter</span>
              <span className="block truncate text-[12px] text-muted-foreground">{prog.podcastTitle}</span>
              <span className={`block truncate ${tvMode ? 'text-[16px]' : 'text-[14px]'} font-semibold text-foreground`}>{prog.title}</span>
              {left && <span className="block text-[12px] text-muted-foreground">{left}</span>}
            </span>
          </button>
          {percent !== null && <span className="block h-1 w-full bg-neutral-800"><span className="block h-full bg-[#5CC8B5]" style={{ width: `${percent}%` }} /></span>}
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
    return <article key={item.key} className={`poster ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card`}>
      <button type="button" data-discover-card onClick={() => resumeVod(entry)} {...peekProps({ eyebrow: `${kindLabel} · Reprendre`, title: entry.name || 'Sans titre', meta: [entry.episodeName, percent !== null ? `${remaining} min restantes` : null].filter(Boolean).join(' · ') || undefined, hints: 'OK Reprendre · ▼ Fiche, Vu, Retirer' })}
        className={`press w-full text-left ${cardFocus}`}>
        <div className="relative flex aspect-[2/3] items-center justify-center overflow-hidden bg-neutral-900">
          {entry.mediaKind === 'series' ? <MonitorPlay className="h-8 w-8 text-primary" aria-hidden="true" /> : <Film className="h-8 w-8 text-primary" aria-hidden="true" />}
          {poster && <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
          <span className="absolute bottom-2 right-2 rounded-full bg-black/75 p-2"><Play className="h-4 w-4" aria-hidden="true" /></span>
        </div>
        <div className="p-2">
          <p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2`}>{entry.name || 'Sans titre'}</p>
          {entry.episodeName && <p className="mt-1 truncate text-[11px] text-neutral-400">{entry.episodeName}</p>}
          <p className="mt-1 text-[11px] text-neutral-400">{kindLabel} · Reprendre à {Math.max(1, Math.floor((entry.positionMs || 0) / 60000))} min</p>
          {percent !== null && <><div role="progressbar" aria-label={`Progression de ${entry.name || 'ce titre'}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-700"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div><p className="mt-1 text-[11px] text-neutral-400">{percent} % · {remaining} min restantes</p></>}
        </div>
      </button>
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
      {...peekProps({ eyebrow: `En direct · ${channel.name}`, title: current?.title || channel.name, meta: current ? `${hhmm(current.startTime)} – ${hhmm(current.endTime)}${upcoming ? ` · Ensuite ${hhmm(upcoming.startTime)} ${upcoming.title}` : ''}` : line, hints: 'OK Regarder · le guide est dans le lecteur' })}
      className={`press relative ${wideW} flex shrink-0 snap-start items-center gap-3 overflow-hidden rounded-2xl border border-neutral-900 bg-card p-3 text-left hover:bg-accent/60 ${tvMode ? 'min-h-[120px]' : 'min-h-[72px]'} ${cardFocus}`}
    >
      <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${tvMode ? 'text-[18px]' : 'text-[15px]'} font-medium text-foreground`}>{channel.name}</span>
        <span className={`block truncate ${tvMode ? 'text-[16px]' : 'text-[13px]'} text-muted-foreground`}>{line}</span>
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
      <button type="button" data-discover-card onClick={() => playEpisode(s)} aria-label={`Écouter ${s.episode.title}, ${s.feed.title}`} {...peekProps({ eyebrow: `Podcast · ${kindLabel}`, title: s.episode.title, meta: [s.feed.title, meta].filter(Boolean).join(' · '), hints: 'OK Écouter · ▼ Émission' })}
        className={`press w-full text-left ${cardFocus}`}>
        <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-secondary text-[#5CC8B5]">
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
      case 'resume':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode}>{resume.map(renderResume)}</DiscoverRow>;
      case 'live-now':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="Tes chaînes favorites et leur programme">{favoriteChannels.map(renderChannelNow)}</DiscoverRow>;
      case 'recent-channels':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode}>{recentLive.map(channel => (
          <button key={channel.id} type="button" data-discover-card onClick={() => onChannelSelect(channel)} {...peekProps({ eyebrow: 'Chaîne récente', title: channel.name, meta: channel.group, hints: 'OK Regarder' })}
            className={`press flex shrink-0 snap-start items-center gap-3 rounded-full border border-neutral-900 bg-card py-2 pl-2 pr-4 text-left hover:bg-accent/60 ${cardFocus}`}>
            <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
            <span className={`${tvMode ? 'text-[16px]' : 'text-xs'} max-w-[12rem] truncate`}>{channel.name}</span>
          </button>
        ))}</DiscoverRow>;
      case 'for-you':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption="D’après tes visionnages, dans ta playlist">{forYou.map(item => (
          <button key={item.id} type="button" data-discover-card onClick={() => onOpenVod('movie', { id: item.id, name: item.name, kind: 'movie', playlistId: playlist.id, addedAt: 0, ...(item.poster ? { poster: item.poster } : {}), ...(item.categoryId ? { categoryId: item.categoryId } : {}) })}
            {...peekProps({ eyebrow: 'Film · Pour toi', title: item.name, meta: item.reason, hints: 'OK Fiche du film' })}
            className={`poster press ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
            <div className="relative flex aspect-[2/3] items-center justify-center overflow-hidden bg-neutral-900">
              <Film className="h-8 w-8 text-primary" aria-hidden="true" />
              {safeImage(item.poster) && <img src={safeImage(item.poster)} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            </div>
            <div className="p-2">
              <p className={`${tvMode ? 'text-[15px]' : 'text-xs'} line-clamp-2`}>{item.name}</p>
              {item.reason && <p className="mt-1 line-clamp-2 text-[11px] text-neutral-400">{item.reason}</p>}
            </div>
          </button>
        ))}</DiscoverRow>;
      case 'my-list':
        return <DiscoverRow key={id} id={id} title={selectionTitle(id)} tvMode={tvMode} caption={`${watchlistItems.length} titre${watchlistItems.length > 1 ? 's' : ''} gardé${watchlistItems.length > 1 ? 's' : ''}`}>{myList.map(item => (
          <button key={`${item.kind}:${item.id}`} type="button" data-discover-card onClick={() => onOpenVod(item.kind, item)}
            {...peekProps({ eyebrow: `${item.kind === 'series' ? 'Série' : 'Film'} · Ma liste`, title: item.name, meta: item.rating ? `★ ${item.rating}` : undefined, hints: 'OK Fiche, saisons, Retirer de Ma liste' })}
            className={`poster press ${posterW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
            <div className="flex aspect-[2/3] items-center justify-center overflow-hidden bg-neutral-900">
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
            <button key={s.id} type="button" data-discover-card onClick={() => onOpenPodcasts?.()} {...peekProps({ eyebrow: 'Sélection CedPlay', title: s.title, meta: [s.author, s.genre].filter(Boolean).join(' · '), hints: 'OK Voir dans Podcasts' })}
              className={`press ${squareW} shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left ${cardFocus}`}>
              <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-secondary text-[#5CC8B5]">
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

  return (
    <div ref={rootRef} className="space-y-6">
      <div className={`sticky top-0 z-20 -mx-2 flex flex-wrap items-center gap-2 bg-background/95 px-2 py-2 backdrop-blur ${tvMode ? '' : 'sm:mx-0 sm:px-0'}`}>
        <div role="group" aria-label="Type de contenu" className="inline-flex rounded-full border border-neutral-900 bg-card p-1">
          {FILTERS.map(f => (
            <button key={f.value} type="button" data-discover-filter aria-pressed={filter === f.value} onClick={() => { setFilter(f.value); setPeek(null); }}
              {...(f.value === 'all' && rows.length === 0 ? { 'data-remote-start': true } : {})}
              className={`${tvMode ? 'min-h-11 px-5 text-[17px]' : 'min-h-10 px-4 text-sm'} rounded-full font-medium transition-colors ${filter === f.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {tvMode && peek && <section aria-label="Contenu sélectionné" aria-live="polite" className="min-h-[132px] max-w-3xl space-y-1.5">
        <p className="text-[14px] font-semibold uppercase tracking-wide text-[#FF8A6E]">{peek.eyebrow}</p>
        <p className="text-[34px] font-semibold leading-tight tracking-tight text-foreground">{peek.title}</p>
        {peek.meta && <p className="text-[17px] text-muted-foreground">{peek.meta}</p>}
        <p className="text-[16px] text-muted-foreground">{peek.hints}</p>
      </section>}

      {onlyEmptySelection && <div className="py-6 text-center">
        <Clock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-neutral-300">Rien à reprendre pour le moment.</p>
        <p className="mt-1 text-sm text-neutral-500">Lance une chaîne, ajoute des favoris (<Heart className="inline h-3.5 w-3.5" aria-label="cœur" />) ou un titre à Ma liste (<Bookmark className="inline h-3.5 w-3.5" aria-label="signet" />).</p>
        {onBrowseLive && <button type="button" data-remote-start onClick={onBrowseLive} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Tv className="h-4 w-4" aria-hidden="true" />Voir les chaînes en direct</button>}
      </div>}

      {rows.map(renderRow)}

      {rows.length === 0 && <div className="py-12 text-center">
        <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-neutral-300">Rien à proposer dans {FILTERS.find(f => f.value === filter)?.label} pour le moment.</p>
        <p className="mt-1 text-sm text-neutral-500">Les rangées apparaissent dès qu’un contenu y a sa place.</p>
      </div>}
    </div>
  );
}
