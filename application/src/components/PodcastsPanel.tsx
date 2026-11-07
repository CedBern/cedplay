import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronDown, Headphones, Link2, Loader2, Pause, Play, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AudioPlaybackState, PodcastEpisode, PodcastFeed, PodcastProgress, PodcastSearchResult } from '@/types/podcast';
import { fetchPodcastFeed } from '@/utils/podcastFetcher';
import {
  onPodcastStorageChange,
  readAllEpisodeProgress,
  readEpisodesForFeed,
  readPodcastFeeds,
  removeSubscribedPodcast,
  saveSubscribedPodcast,
} from '@/utils/podcastStorage';
import { AudioBridge } from '@/utils/nativePlayer';
import { formatEpisodeDate, formatEpisodeLength } from '@/utils/podcastFormat';
import { DEFAULT_PODCAST_SUGGESTIONS, resolvePodcastLink, searchPodcasts } from '@/utils/podcastSearch';

function Artwork({ src, className }: { src?: string | undefined; className: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${className} object-cover bg-secondary`} />;
  }
  return (
    <span className={`${className} flex items-center justify-center bg-secondary text-muted-foreground`}>
      <Headphones className="h-1/3 w-1/3" aria-hidden="true" />
    </span>
  );
}

/** Même flux malgré http/https, majuscules ou barre finale. */
function feedKey(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

const RING_RADIUS = 18;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Bouton rond de lecture : Pause pour l'épisode qui joue, Lecture sinon. Un épisode entamé
 * porte un anneau de progression — c'est lui qui dit « Reprendre », sans texte en plus.
 */
function PlayDisc({ playing, current, percent, label }: { playing: boolean; current: boolean; percent: number | null; label: string }) {
  return (
    <span
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
        current ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground group-hover:bg-white/10'
      }`}
      {...(percent !== null
        ? { role: 'progressbar', 'aria-label': label, 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 }
        : { 'aria-hidden': true })}
    >
      {percent !== null && (
        <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="20" cy="20" r={RING_RADIUS} fill="none" strokeWidth="2.5" className={current ? 'stroke-black/20' : 'stroke-white/10'} />
          <circle
            cx="20"
            cy="20"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - percent / 100)}
            className={current ? 'stroke-primary-foreground' : 'stroke-primary'}
          />
        </svg>
      )}
      {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="ml-0.5 h-4 w-4" aria-hidden="true" />}
    </span>
  );
}

export interface PodcastsPanelProps {
  tvMode?: boolean;
}

/**
 * Écouter : les émissions suivies en pochettes, puis les épisodes de l'émission choisie.
 * Une ligne d'épisode = titre + une seule ligne d'infos (date · durée ou reste) ; toute la
 * ligne lance, reprend ou met en pause. Le résumé reste à portée : chevron sur téléphone,
 * affiché sous le titre de la ligne sélectionnée sur TV. Les commandes fines (±15/30 s,
 * vitesse) vivent dans le mini-lecteur, visible sur tous les écrans.
 *
 * Ajouter = chercher un nom → reconnaître la pochette → s'abonner. Sans saisie, des
 * suggestions (utile à la télécommande). Lien Apple / Spotify / site ou RSS en recours.
 */
export function PodcastsPanel({ tvMode = false }: PodcastsPanelProps) {
  const [feeds, setFeeds] = useState<PodcastFeed[]>(() => readPodcastFeeds());
  const [selectedFeedUrl, setSelectedFeedUrl] = useState<string | null>(() => readPodcastFeeds()[0]?.url ?? null);
  const [progressMap, setProgressMap] = useState<Record<string, PodcastProgress>>(() => readAllEpisodeProgress());
  const [audioState, setAudioState] = useState<AudioPlaybackState>(() => AudioBridge.getState());
  const [formOpen, setFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PodcastSearchResult[]>(DEFAULT_PODCAST_SUGGESTIONS);
  const [searching, setSearching] = useState(false);
  const [subscribingUrl, setSubscribingUrl] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [confirmDeleteUrl, setConfirmDeleteUrl] = useState<string | null>(null);
  const [openDetailsId, setOpenDetailsId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Quand le bouton pressé disparaît (suppression, abonnement), le focus va à une cible
  // connue : la télécommande ne doit pas se retrouver dans le vide.
  const pendingFocusRef = useRef<{ feedUrl: string } | 'input' | null>(null);
  const listId = useId();

  useEffect(() => {
    void AudioBridge.syncFromNative();
    const unsubStorage = onPodcastStorageChange(() => {
      const nextFeeds = readPodcastFeeds();
      setFeeds(nextFeeds);
      setProgressMap(readAllEpisodeProgress());
      setSelectedFeedUrl(curr => {
        if (curr && nextFeeds.some(f => f.url === curr)) return curr;
        return nextFeeds[0]?.url ?? null;
      });
    });
    // La table de progression n'est relue qu'au changement d'épisode : les ticks de
    // position (~4×/s) ne doivent ni la relire ni re-rendre la liste des épisodes.
    let progressEpisodeId: string | null = null;
    const unsubAudio = AudioBridge.subscribe(state => {
      setAudioState(state);
      if (state.episodeId !== progressEpisodeId) {
        progressEpisodeId = state.episodeId;
        setProgressMap(readAllEpisodeProgress());
      }
    });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void AudioBridge.syncFromNative();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubStorage();
      unsubAudio();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Recherche au fil de la frappe (350 ms), la requête précédente est abandonnée.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearching(false);
      setSearchResults(DEFAULT_PODCAST_SUGGESTIONS);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchPodcasts(trimmed, { signal: controller.signal, limit: 16 });
        if (!controller.signal.aborted) setSearchResults(results.filter(r => r.feedUrl));
      } catch {
        if (!controller.signal.aborted) setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const selectedFeed = useMemo(
    () => feeds.find(f => f.url === selectedFeedUrl) ?? feeds[0] ?? null,
    [feeds, selectedFeedUrl]
  );

  // `feeds` change à chaque enregistrement (ajout, actualisation) : la liste est relue.
  const episodes = useMemo(
    () => (selectedFeed ? readEpisodesForFeed(selectedFeed.url) : []),
    [selectedFeed]
  );

  const subscribedKeys = useMemo(() => new Set(feeds.map(f => feedKey(f.url))), [feeds]);

  const showForm = feeds.length === 0 || formOpen;
  useEffect(() => {
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);
  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

  // La demande de confirmation retombe seule, et dès qu'on change d'émission.
  useEffect(() => {
    if (!confirmDeleteUrl) return;
    const timer = window.setTimeout(() => setConfirmDeleteUrl(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDeleteUrl]);
  useEffect(() => {
    setConfirmDeleteUrl(null);
    setOpenDetailsId(null);
  }, [selectedFeedUrl]);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    if (target === 'input') {
      inputRef.current?.focus();
      return;
    }
    const buttons = panelRef.current?.querySelectorAll<HTMLElement>('[data-feed-url]') ?? [];
    Array.from(buttons).find(el => el.dataset.feedUrl === target.feedUrl)?.focus();
  }, [feeds, formOpen]);

  const closeForm = () => {
    setFormOpen(false);
    setSearchQuery('');
    setLinkOpen(false);
    setLinkInput('');
    setAddMsg(null);
  };

  const subscribe = async (feedUrl: string) => {
    if (subscribingUrl) return;
    setSubscribingUrl(feedUrl);
    setAddMsg(null);
    try {
      const { feed, episodes: parsedEpisodes } = await fetchPodcastFeed(feedUrl);
      pendingFocusRef.current = { feedUrl: feed.url };
      saveSubscribedPodcast(feed, parsedEpisodes);
      setSelectedFeedUrl(feed.url);
      closeForm();
      toast.success(`${feed.title} ajouté`);
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : 'Impossible de charger ce podcast.');
    } finally {
      setSubscribingUrl(null);
    }
  };

  const openSubscribed = (feedUrl: string) => {
    const feed = feeds.find(f => feedKey(f.url) === feedKey(feedUrl));
    if (!feed) return;
    pendingFocusRef.current = { feedUrl: feed.url };
    setSelectedFeedUrl(feed.url);
    closeForm();
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = linkInput.trim();
    if (!trimmed) return;
    setResolvingLink(true);
    setAddMsg(null);
    try {
      const result = await resolvePodcastLink(trimmed);
      if (result.resolved && result.feedUrl) {
        await subscribe(result.feedUrl);
      } else {
        setAddMsg(result.warning || result.error || 'Aucun podcast trouvé à cette adresse.');
      }
    } catch {
      setAddMsg('Impossible d’analyser ce lien.');
    } finally {
      setResolvingLink(false);
    }
  };

  const handleRefreshFeed = async (feed: PodcastFeed) => {
    // Pas de `disabled` pendant l'actualisation : un bouton désactivé perd le focus.
    if (refreshingUrl) return;
    setRefreshingUrl(feed.url);
    try {
      const { feed: updatedFeed, episodes: parsedEpisodes } = await fetchPodcastFeed(feed.url);
      saveSubscribedPodcast(updatedFeed, parsedEpisodes);
      toast.success(`${updatedFeed.title} à jour`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Actualisation impossible.');
    } finally {
      setRefreshingUrl(null);
    }
  };

  const handleRemoveFeed = (feed: PodcastFeed) => {
    if (confirmDeleteUrl !== feed.url) {
      setConfirmDeleteUrl(feed.url);
      return;
    }
    const idx = feeds.findIndex(f => f.url === feed.url);
    const next = feeds[idx + 1] ?? feeds[idx - 1] ?? null;
    setConfirmDeleteUrl(null);
    pendingFocusRef.current = next ? { feedUrl: next.url } : 'input';
    if (next) setSelectedFeedUrl(next.url);
    removeSubscribedPodcast(feed.url);
    toast.info(`${feed.title} retiré`);
  };

  const handleEpisodePlayToggle = async (episode: PodcastEpisode) => {
    if (audioState.active && audioState.episodeId === episode.id) {
      await AudioBridge.togglePlayPause();
      return;
    }
    await AudioBridge.playEpisode(episode);
  };

  // Télécommande : sélection claire, l'orange reste un accent.
  const tvFocus = tvMode
    ? 'focus-visible:bg-foreground focus-visible:text-background [&:focus-visible_.meta]:text-background/70'
    : '';
  const plainFocus = tvMode ? tvFocus : 'focus-visible:ring-2 focus-visible:ring-primary';

  const trimmedQuery = searchQuery.trim();
  const addPanel = showForm && (
    <div className="space-y-3 text-left">
      <form role="search" onSubmit={e => e.preventDefault()} className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={inputRef}
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Nom d’un podcast"
          aria-label="Rechercher un podcast"
          enterKeyHint="search"
          className="min-h-11 rounded-full border-transparent bg-secondary pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
        />
        {searching ? (
          <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Recherche en cours" />
        ) : searchQuery && (
          <button
            type="button"
            onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>

      <h3 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {trimmedQuery ? 'Résultats' : 'Suggestions'}
      </h3>
      {trimmedQuery && !searching && searchResults.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Aucun podcast trouvé.</p>
      ) : (
        <ul
          data-testid="podcast-search-results"
          aria-label={trimmedQuery ? 'Résultats de recherche' : 'Suggestions de podcasts'}
          className={`grid gap-x-3 gap-y-4 ${tvMode ? 'grid-cols-4 xl:grid-cols-5' : 'grid-cols-3 sm:grid-cols-4'}`}
        >
          {searchResults.map(result => {
            const subscribed = subscribedKeys.has(feedKey(result.feedUrl));
            const pending = subscribingUrl === result.feedUrl;
            return (
              <li key={result.id || result.feedUrl}>
                <button
                  type="button"
                  onClick={() => (subscribed ? openSubscribed(result.feedUrl) : void subscribe(result.feedUrl))}
                  aria-label={subscribed ? `${result.title}, déjà suivi` : `S'abonner à ${result.title}`}
                  aria-busy={pending || undefined}
                  className={`group w-full space-y-1.5 rounded-2xl p-1 text-left transition-colors focus-visible:outline-none ${plainFocus}`}
                >
                  <span className="relative block">
                    <Artwork src={result.artworkUrl} className="block aspect-square w-full rounded-xl" />
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full shadow-lg ${
                        subscribed ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : subscribed ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </span>
                  <span className="block px-0.5">
                    <span className="line-clamp-2 text-[13px] font-medium leading-snug">{result.title}</span>
                    {result.author && <span className="meta block truncate text-[11px] text-muted-foreground">{result.author}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2 pt-1">
        <button
          type="button"
          onClick={() => { setLinkOpen(open => !open); setAddMsg(null); }}
          aria-expanded={linkOpen}
          className={`flex items-center gap-2 rounded-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none ${plainFocus}`}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Introuvable ? Coller un lien
        </button>
        {linkOpen && (
          <form onSubmit={e => void handleLinkSubmit(e)} className="flex items-center gap-2">
            <Input
              ref={linkInputRef}
              type="text"
              inputMode="url"
              value={linkInput}
              onChange={e => setLinkInput(e.target.value)}
              placeholder="Lien Apple, Spotify, site ou RSS"
              aria-label="Lien ou adresse RSS du podcast"
              className="min-h-11 flex-1 rounded-full border-transparent bg-secondary px-4"
            />
            <Button type="submit" disabled={resolvingLink || !linkInput.trim()} aria-label="Ajouter depuis ce lien" className="min-h-11 rounded-full px-4">
              {resolvingLink ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Ajouter'}
            </Button>
          </form>
        )}
      </div>
      {addMsg && <p role="alert" className="px-1 text-xs text-red-400">{addMsg}</p>}
    </div>
  );

  if (feeds.length === 0) {
    return (
      <div
        ref={panelRef}
        className={`mx-auto space-y-5 py-8 ${tvMode ? 'max-w-4xl' : 'max-w-xl'} ${audioState.active ? 'pb-24' : ''}`}
        data-podcasts-panel
        data-tv-mode={tvMode ? 'true' : 'false'}
      >
        <div className="space-y-1 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-primary">
            <Headphones className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold">Aucun podcast</h2>
          <p className="text-sm text-muted-foreground">Cherche une émission par son nom.</p>
        </div>
        {addPanel}
      </div>
    );
  }

  const refreshing = selectedFeed ? refreshingUrl === selectedFeed.url : false;
  const confirming = selectedFeed ? confirmDeleteUrl === selectedFeed.url : false;
  // TV : les actions portent leur mot (personne ne survole à la télécommande). Téléphone :
  // icônes seules, sauf la confirmation de suppression qui doit se lire.
  const headerAction = `h-10 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none ${tvFocus}`;

  const feedHeader = selectedFeed && (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1 px-2">
        <h2 className="truncate text-lg font-semibold leading-tight">{selectedFeed.title}</h2>
        <p className="text-xs text-muted-foreground">{episodes.length} épisode{episodes.length > 1 ? 's' : ''}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size={tvMode ? 'sm' : 'icon'}
        onClick={() => void handleRefreshFeed(selectedFeed)}
        aria-disabled={refreshing}
        aria-label={refreshing ? `Actualisation de ${selectedFeed.title}…` : `Actualiser ${selectedFeed.title}`}
        className={`${headerAction} ${tvMode ? 'gap-2 px-3' : 'w-10'}`}
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        {tvMode && <span>{refreshing ? 'Actualisation…' : 'Actualiser'}</span>}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size={tvMode || confirming ? 'sm' : 'icon'}
        onClick={() => handleRemoveFeed(selectedFeed)}
        aria-label={confirming ? `Confirmer la suppression de ${selectedFeed.title}` : `Supprimer ${selectedFeed.title}`}
        className={`${headerAction} ${tvMode || confirming ? 'gap-2 px-3' : 'w-10'} ${confirming ? 'bg-red-500/15 text-red-300 hover:text-red-200' : 'hover:text-red-400'}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        {(tvMode || confirming) && <span>{confirming ? 'Confirmer ?' : 'Supprimer'}</span>}
      </Button>
    </div>
  );

  const episodeList = (
    <ul className="divide-y divide-white/5" aria-label="Épisodes">
      {episodes.map((episode, index) => {
        const isCurrent = audioState.active && audioState.episodeId === episode.id;
        const isPlaying = isCurrent && audioState.playing;
        const prog = progressMap[episode.id];
        const posMs = isCurrent ? audioState.positionMs : (prog?.positionMs ?? 0);
        const durMs = (isCurrent && audioState.durationMs > 0)
          ? audioState.durationMs
          : (prog?.durationMs || episode.durationMs || 0);
        const completed = Boolean(prog?.completed) && !isCurrent;
        const percent = durMs > 0 ? Math.min(100, Math.max(0, Math.round((posMs / durMs) * 100))) : 0;
        const hasResume = !completed && posMs > 0;
        const status = completed
          ? 'Écouté'
          : hasResume && durMs > 0
            ? `Reste ${formatEpisodeLength(durMs - posMs)}`
            : durMs > 0 ? formatEpisodeLength(durMs) : '';
        const meta = [formatEpisodeDate(episode.pubDate, episode.publishedAt), status].filter(Boolean).join(' · ');
        const action = isPlaying ? 'Pause' : hasResume ? 'Reprendre' : 'Écouter';
        const description = episode.description?.trim() ?? '';
        const detailsOpen = !tvMode && openDetailsId === episode.id;
        const detailsId = `${listId}-details-${index}`;

        return (
          <li key={episode.id} data-episode-id={episode.id}>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => void handleEpisodePlayToggle(episode)}
                aria-label={`${action} ${episode.title}`}
                aria-current={isCurrent ? 'true' : undefined}
                className={`group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none ${plainFocus}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`line-clamp-2 text-[15px] font-medium leading-snug ${completed ? 'opacity-60' : isCurrent ? 'text-primary' : ''}`}>
                    {episode.title}
                  </span>
                  {meta && (
                    <span className="meta mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      {completed && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                      {meta}
                    </span>
                  )}
                  {/* TV : le résumé s'ouvre sous la ligne sélectionnée, sans arrêt de focus en plus. */}
                  {tvMode && description && (
                    <span className="meta mt-2 hidden text-[13px] leading-relaxed text-muted-foreground group-focus-visible:line-clamp-3">
                      {description}
                    </span>
                  )}
                </span>
                <PlayDisc
                  playing={isPlaying}
                  current={isCurrent}
                  percent={hasResume && durMs > 0 ? percent : null}
                  label={`Progression de ${episode.title}`}
                />
              </button>
              {!tvMode && description && (
                <button
                  type="button"
                  onClick={() => setOpenDetailsId(id => (id === episode.id ? null : episode.id))}
                  aria-expanded={detailsOpen}
                  aria-controls={detailsId}
                  aria-label={`Détails de ${episode.title}`}
                  className="ml-0.5 flex h-10 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              )}
            </div>
            {detailsOpen && (
              <p id={detailsId} className="whitespace-pre-line px-2 pb-4 pr-10 text-[13px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );

  const addToggle = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => (formOpen ? closeForm() : setFormOpen(true))}
      aria-expanded={formOpen}
      aria-label={formOpen ? 'Fermer l’ajout de podcast' : 'Ajouter un podcast'}
      className={`h-9 gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground ${tvFocus}`}
    >
      {formOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
      {formOpen ? 'Fermer' : 'Ajouter'}
    </Button>
  );

  const sectionTitle = (
    <div className="flex items-center justify-between">
      <h2 className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Mes émissions</h2>
      {addToggle}
    </div>
  );

  if (tvMode) {
    // TV : la recherche prend la colonne de droite, assez large pour une grille de pochettes.
    return (
      <div ref={panelRef} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-8 pb-24" data-podcasts-panel data-tv-mode="true">
        <section aria-label="Mes émissions" className="space-y-3">
          {sectionTitle}
          <div className="space-y-1">
            {feeds.map(feed => {
              const active = !formOpen && selectedFeed?.url === feed.url;
              return (
                <button
                  key={feed.url}
                  type="button"
                  data-feed-url={feed.url}
                  aria-pressed={active}
                  onClick={() => { setSelectedFeedUrl(feed.url); if (formOpen) closeForm(); }}
                  className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors focus-visible:outline-none ${tvFocus} ${
                    active ? 'bg-white/[0.06] shadow-[inset_3px_0_0_hsl(var(--primary))]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <Artwork src={feed.artworkUrl} className="h-12 w-12 shrink-0 rounded-lg" />
                  <span className={`min-w-0 flex-1 truncate text-[15px] font-medium ${active ? '' : 'meta text-muted-foreground'}`}>{feed.title}</span>
                </button>
              );
            })}
          </div>
        </section>
        {formOpen ? (
          <section aria-label="Ajouter un podcast">{addPanel}</section>
        ) : (
          <section aria-label="Épisodes de l’émission" className="space-y-2">
            {feedHeader}
            {episodeList}
          </section>
        )}
      </div>
    );
  }

  return (
    <div ref={panelRef} className={`space-y-5 ${audioState.active ? 'pb-20' : ''}`} data-podcasts-panel data-tv-mode="false">
      <section aria-label="Mes émissions" className="space-y-3">
        {sectionTitle}
        {addPanel}
        {!formOpen && (
          <div className="-mx-2 flex snap-x gap-3 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {feeds.map(feed => {
              const active = selectedFeed?.url === feed.url;
              return (
                <button
                  key={feed.url}
                  type="button"
                  data-feed-url={feed.url}
                  aria-pressed={active}
                  onClick={() => setSelectedFeedUrl(feed.url)}
                  className="press w-[84px] shrink-0 snap-start space-y-1.5 pt-1 text-left focus-visible:outline-none"
                >
                  <Artwork
                    src={feed.artworkUrl}
                    className={`block h-[84px] w-[84px] rounded-2xl transition-[box-shadow,opacity] ${
                      active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'opacity-60'
                    }`}
                  />
                  <span className={`block truncate text-xs ${active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{feed.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {!formOpen && (
        <section aria-label="Épisodes de l’émission" className="space-y-1">
          {feedHeader}
          {episodeList}
        </section>
      )}
    </div>
  );
}
