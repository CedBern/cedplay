import { useEffect, useMemo, useState } from 'react';
import { ChannelLogo } from '@/components/ChannelLogo';
import { HeroCarousel, type HeroItem } from '@/components/HeroCarousel';
import { getPlayHistory, historyScope, getVodWatchlistFromDB, getFavoritesFromDB, manageContinueEntry, type PlayHistoryEntry, type VodWatchlistItem } from '@/utils/idb';
import { getCurrentProgram, getUpcomingProgram } from '@/utils/epgXmltv';
import type { EPGData } from '@/types/epg';
import { safeImage } from '@/utils/xtreamCatalog';
import { toast } from 'sonner';
import type { Channel, PlaylistInfo } from '@/types/channel';
import type { PodcastProgress } from '@/types/podcast';
import { AudioBridge } from '@/utils/nativePlayer';
import { onPodcastStorageChange, readAllEpisodeProgress } from '@/utils/podcastStorage';
import { formatEpisodeLength } from '@/utils/podcastFormat';
import { useAdultVodCategories } from '@/hooks/useAdultVodCategories';
import { Bookmark, Check, Clock, Film, Headphones, Heart, MonitorPlay, Play, Tv, X } from 'lucide-react';

interface ContinuePanelProps {
  playlist: PlaylistInfo;
  onChannelSelect: (channel: Channel) => void;
  onOpenVod: (kind: 'movie' | 'series', item?: VodWatchlistItem) => void;
  /** Reprend réellement la lecture d'un titre en cours (ou ouvre la série). */
  onResumeVod?: ((entry: { kind: 'movie' | 'series'; id: string; name?: string | undefined; seriesId?: string | undefined }) => void) | undefined;
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
}

const hhmm = (d: Date) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Favoris affichés sur l'accueil ; la liste complète reste dans Direct › Favoris. */
const MAX_FAVORITES = 12;

const MAX_ITEMS = 10;
/** Seuil sous lequel on considère qu'un titre n'a pas réellement été lancé. */
const RESUME_THRESHOLD_MS = 60_000;

export function ContinuePanel({ playlist, onChannelSelect, onOpenVod, onResumeVod, lockedGroups, unlocked, parentalEnabled, epgData, onBrowseLive }: ContinuePanelProps) {
  const adultVod = useAdultVodCategories(playlist, parentalEnabled === true && !unlocked);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [watchlist, setWatchlist] = useState<VodWatchlistItem[]>([]);
  const [podcastProgress, setPodcastProgress] = useState<Record<string, PodcastProgress>>(() => readAllEpisodeProgress());
  const [loading, setLoading] = useState(true);

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
      if (!cancelled) setPodcastProgress(readAllEpisodeProgress());
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

  const recentLive = useMemo(() => {
    const seen = new Set<string>();
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
      if (result.length >= MAX_ITEMS) break;
    }
    return result;
  }, [history, channelById, lockedGroups, unlocked]);

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

  const inProgressVod = useMemo(() => {
    const seen = new Set<string>();
    const result: PlayHistoryEntry[] = [];
    for (const raw of history) {
      if (raw.kind !== 'vod') continue;
      const entry = historyScope(raw);
      if (entry.playlistId !== playlist.id) continue;
      if (entry.status === 'completed' || entry.hiddenFromContinue) continue;
      if ((entry.positionMs || 0) < RESUME_THRESHOLD_MS) continue;
      if (adultVod.isAdult(entry.mediaKind === 'series' ? 'series' : 'movie', entry.categoryId)) continue;
      if (seen.has(entry.channelId)) continue;
      seen.add(entry.channelId);
      result.push(entry);
      if (result.length >= MAX_ITEMS) break;
    }
    return result;
  }, [history, playlist.id, adultVod]);

  const watchlistItems = useMemo(() => {
    return watchlist.filter(item => item.playlistId === playlist.id && !adultVod.isAdult(item.kind, item.categoryId));
  }, [watchlist, playlist.id, adultVod]);

  const inProgressPodcasts = useMemo(() => {
    return Object.values(podcastProgress)
      .filter(p => !p.completed && p.positionMs > 0 && p.audioUrl)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 6);
  }, [podcastProgress]);

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

  const resume = (entry: PlayHistoryEntry) => {
    // `vod:<playlistId>:<kind>:<id>` → reprendre ce titre précis.
    const match = entry.channelId.match(/^vod:([^:]+):(movie|series):([^:]+)$/);
    if (match && onResumeVod) onResumeVod({ kind: match[2] as 'movie' | 'series', id: match[3], name: entry.name, seriesId: entry.seriesId });
    else onOpenVod(entry.mediaKind === 'series' ? 'series' : 'movie');
  };
  const posterOf = (entry: PlayHistoryEntry) => safeImage(entry.poster) || safeImage(watchlistItems.find(w => w.id === (entry.seriesId || entry.channelId.split(':').at(-1)) && w.kind === entry.mediaKind)?.poster);

  // Bandeau « À la une » : titres en cours, puis le direct de mes chaînes, sinon Ma Liste.
  const heroItems: HeroItem[] = [];
  for (const entry of inProgressVod.slice(0, 3)) {
    const remaining = entry.durationMs ? Math.max(0, Math.ceil(((entry.durationMs || 0) - (entry.positionMs || 0)) / 60000)) : null;
    heroItems.push({
      key: entry.channelId,
      eyebrow: entry.mediaKind === 'series' ? 'Reprendre la série' : 'Reprendre le film',
      title: entry.name || 'Sans titre',
      meta: [entry.episodeName, remaining !== null ? `${remaining} min restantes` : null].filter(Boolean).join(' · ') || undefined,
      image: posterOf(entry) || undefined,
      progress: entry.durationMs ? Math.min(100, ((entry.positionMs || 0) / entry.durationMs) * 100) : null,
      actionLabel: 'Reprendre',
      onPlay: () => resume(entry),
    });
  }
  for (const channel of favoriteChannels.slice(0, Math.max(0, 5 - heroItems.length))) {
    const now = new Date();
    const current = epgData ? getCurrentProgram(channel.id, epgData, now) : null;
    const start = current ? new Date(current.startTime).getTime() : 0;
    const end = current ? new Date(current.endTime).getTime() : 0;
    heroItems.push({
      key: `live:${channel.id}`,
      eyebrow: current ? `En direct · ${channel.name}` : 'En direct',
      live: true,
      title: current?.title || channel.name,
      meta: current ? `${hhmm(current.startTime)} – ${hhmm(current.endTime)}` : channel.group,
      logo: channel.logo,
      badge: channel.logo ? undefined : <span className="block origin-center scale-[2.4]"><ChannelLogo src={null} name={channel.name} /></span>,
      progress: current && end > start ? Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100)) : null,
      actionLabel: 'Regarder',
      onPlay: () => onChannelSelect(channel),
    });
  }
  if (!heroItems.length) {
    for (const item of watchlistItems.filter(w => w.poster).slice(0, 3)) {
      heroItems.push({
        key: `wl:${item.kind}:${item.id}`,
        eyebrow: 'Dans Ma Liste',
        title: item.name,
        meta: [item.kind === 'series' ? 'Série' : 'Film', item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(' · '),
        image: item.poster,
        actionLabel: 'Voir',
        onPlay: () => onOpenVod(item.kind, item),
      });
    }
  }

  const manageEntry = async (entry: PlayHistoryEntry, action: 'hide' | 'completed') => {
    try {
      await manageContinueEntry(entry.channelId, action);
      setHistory(await getPlayHistory());
      toast.success(action === 'hide' ? 'Retiré de Continuer. La position de lecture est conservée.' : 'Marqué comme vu.');
    } catch { toast.error('Impossible de mettre à jour ce titre. Réessaie.'); }
  };

  if (loading) {
    return <p role="status" className="text-sm text-neutral-400">Chargement de la reprise…</p>;
  }

  if (favoriteChannels.length === 0 && recentLive.length === 0 && inProgressVod.length === 0 && watchlistItems.length === 0 && inProgressPodcasts.length === 0) {
    return (
      <div className="text-center py-16">
        <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-neutral-300">Rien à reprendre pour le moment.</p>
        <p className="text-sm text-neutral-500 mt-1">Lance une chaîne, ajoute des favoris (♥) ou un titre à Ma Liste.</p>
        {onBrowseLive && <button type="button" data-remote-start onClick={onBrowseLive} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Tv className="h-4 w-4" aria-hidden="true" />Voir les chaînes en direct</button>}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <HeroCarousel items={heroItems} />
      {favoriteChannels.length > 0 && (
        <section aria-label="Mes chaînes en ce moment">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
            <Heart className="h-4 w-4 fill-current text-primary" aria-hidden="true" /> En ce moment sur mes chaînes
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {favoriteChannels.map(channel => {
              const now = new Date();
              const current = epgData ? getCurrentProgram(channel.id, epgData, now) : null;
              const upcoming = epgData ? getUpcomingProgram(channel.id, epgData, now) : null;
              const start = current ? new Date(current.startTime).getTime() : 0;
              const end = current ? new Date(current.endTime).getTime() : 0;
              const percent = current && end > start ? Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100)) : null;
              return <button
                key={channel.id}
                type="button"
                onClick={() => onChannelSelect(channel)}
                className="press flex min-h-[72px] items-center gap-3 rounded-2xl border border-neutral-900 bg-card p-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">{channel.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {current ? current.title : upcoming ? `Ensuite ${hhmm(upcoming.startTime)} · ${upcoming.title}` : channel.group || 'Direct'}
                  </span>
                  {percent !== null && current && <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-neutral-800"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>
                    <time className="font-mono text-[11px] text-neutral-500">{hhmm(current.endTime)}</time>
                  </span>}
                </span>
              </button>;
            })}
          </div>
        </section>
      )}

      {inProgressPodcasts.length > 0 && (
        <section aria-label="Podcasts en cours">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
            <Headphones className="h-4 w-4 text-primary" aria-hidden="true" /> Reprendre l’écoute
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {inProgressPodcasts.map(prog => {
              const percent = prog.durationMs > 0
                ? Math.min(100, Math.max(0, Math.round((prog.positionMs / prog.durationMs) * 100)))
                : null;
              const left = prog.durationMs > prog.positionMs ? `Reste ${formatEpisodeLength(prog.durationMs - prog.positionMs)}` : '';
              return (
                <button
                  key={prog.episodeId}
                  type="button"
                  onClick={() => resumePodcast(prog)}
                  aria-label={`Reprendre ${prog.title}`}
                  className="press flex min-h-[72px] items-center gap-3 rounded-2xl border border-neutral-900 bg-card p-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {prog.artworkUrl ? (
                    <img src={prog.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-xl bg-secondary object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                      <Headphones className="h-5 w-5" aria-hidden="true" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-foreground">{prog.title}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {[prog.podcastTitle, left].filter(Boolean).join(' · ')}
                    </span>
                    {percent !== null && (
                      <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-800">
                        <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {inProgressVod.length > 0 && (
        <section aria-label="Films et séries en cours">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
            <Play className="h-4 w-4" aria-hidden="true" /> Reprendre la lecture
          </h2>
          <div className="rail -mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-2 px-2 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
            {inProgressVod.map(entry => {
              const poster = posterOf(entry);
              const percent = entry.durationMs && entry.durationMs > 0 ? Math.min(100, Math.max(0, Math.round((entry.positionMs || 0) / entry.durationMs * 100))) : null;
              return <article key={entry.channelId} className="poster w-[42%] shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card sm:w-[180px]">
              <button
                key={entry.channelId}
                type="button"
                onClick={() => resume(entry)}
                className="press w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="relative aspect-[2/3] overflow-hidden bg-neutral-900 flex items-center justify-center">
                  {entry.mediaKind === 'series'
                    ? <MonitorPlay className="h-8 w-8 text-primary" aria-hidden="true" />
                    : <Film className="h-8 w-8 text-primary" aria-hidden="true" />}
                  {poster && <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
                  <span className="absolute bottom-2 right-2 p-2 rounded-full bg-black/75"><Play className="h-4 w-4" aria-hidden="true" /></span>
                </div>
                <div className="p-2">
                  <p className="text-xs line-clamp-2">{entry.name || 'Sans titre'}</p>
                  {entry.episodeName && <p className="text-[11px] text-neutral-400 truncate mt-1">{entry.episodeName}</p>}
                  <p className="text-[11px] text-neutral-400 mt-1">
                    {entry.mediaKind === 'series' ? 'Série' : 'Film'} · Reprendre à {Math.max(1, Math.floor((entry.positionMs || 0) / 60000))} min
                  </p>
                  {percent !== null && <><div role="progressbar" aria-label={`Progression de ${entry.name || 'ce titre'}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 bg-neutral-700 rounded-full overflow-hidden mt-2"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div><p className="text-[11px] text-neutral-400 mt-1">{percent} % · {Math.max(0, Math.ceil(((entry.durationMs || 0) - (entry.positionMs || 0)) / 60000))} min restantes</p></>}
                </div>
              </button>
              <div className="flex border-t border-neutral-800">
                <button type="button" aria-label={`Marquer ${entry.name || 'ce titre'} comme vu`} onClick={() => { void manageEntry(entry, 'completed'); }} className="flex-1 min-w-0 min-h-11 px-2 py-2 text-xs text-neutral-300 hover:bg-white/10 flex items-center justify-center gap-1"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Vu</button>
                <button type="button" aria-label={`Retirer ${entry.name || 'ce titre'} de Continuer`} onClick={() => { void manageEntry(entry, 'hide'); }} className="flex-1 min-w-0 min-h-11 px-2 py-2 text-xs text-neutral-300 hover:bg-white/10 flex items-center justify-center gap-1"><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Retirer</button>
              </div>
              </article>;
            })}
          </div>
        </section>
      )}

      {watchlistItems.length > 0 && (
        <section aria-label="Ma Liste VOD">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
            <Bookmark className="h-4 w-4 text-primary fill-primary/20" aria-hidden="true" /> Ma Liste ({watchlistItems.length})
          </h2>
          <div className="rail -mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-2 px-2 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
            {watchlistItems.map(item => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                onClick={() => onOpenVod(item.kind, item)}
                className="poster press w-[42%] shrink-0 snap-start overflow-hidden rounded-2xl border border-neutral-900 bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-[180px]"
              >
                <div className="aspect-[2/3] overflow-hidden bg-neutral-900 flex items-center justify-center">
                  {item.poster ? (
                    <img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : item.kind === 'series' ? (
                    <MonitorPlay className="h-8 w-8 text-primary" aria-hidden="true" />
                  ) : (
                    <Film className="h-8 w-8 text-primary" aria-hidden="true" />
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs line-clamp-2">{item.name}</p>
                  <p className="text-[11px] text-neutral-400 mt-1">
                    {item.kind === 'series' ? 'Série' : 'Film'}{item.rating ? ` · ★ ${item.rating}` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {recentLive.length > 0 && (
        <section aria-label="Chaînes récentes">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
            <Tv className="h-4 w-4" aria-hidden="true" /> Chaînes récentes
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {recentLive.map(channel => (
              <button
                key={channel.id}
                type="button"
                onClick={() => onChannelSelect(channel)}
                className="press flex items-center gap-3 rounded-2xl border border-neutral-900 bg-card p-2.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
                <span className="text-xs line-clamp-2 min-w-0">{channel.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
