import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronDown, Headphones, Loader2, Pause, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AudioPlaybackState, PodcastEpisode, PodcastFeed, PodcastProgress } from '@/types/podcast';
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
 */
export function PodcastsPanel({ tvMode = false }: PodcastsPanelProps) {
  const [feeds, setFeeds] = useState<PodcastFeed[]>(() => readPodcastFeeds());
  const [selectedFeedUrl, setSelectedFeedUrl] = useState<string | null>(() => readPodcastFeeds()[0]?.url ?? null);
  const [progressMap, setProgressMap] = useState<Record<string, PodcastProgress>>(() => readAllEpisodeProgress());
  const [audioState, setAudioState] = useState<AudioPlaybackState>(() => AudioBridge.getState());
  const [rssInput, setRssInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [confirmDeleteUrl, setConfirmDeleteUrl] = useState<string | null>(null);
  const [openDetailsId, setOpenDetailsId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Après une suppression, le focus va à l'émission suivante (ou au champ si plus rien) :
  // le bouton pressé disparaît, la télécommande ne doit pas se retrouver dans le vide.
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

  const selectedFeed = useMemo(
    () => feeds.find(f => f.url === selectedFeedUrl) ?? feeds[0] ?? null,
    [feeds, selectedFeedUrl]
  );

  // `feeds` change à chaque enregistrement (ajout, actualisation) : la liste est relue.
  const episodes = useMemo(
    () => (selectedFeed ? readEpisodesForFeed(selectedFeed.url) : []),
    [selectedFeed]
  );

  const showForm = feeds.length === 0 || formOpen;
  useEffect(() => {
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);

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
  }, [feeds]);

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rssInput.trim();
    if (!trimmed) return;
    setAdding(true);
    setErrorMsg(null);
    try {
      const { feed, episodes: parsedEpisodes } = await fetchPodcastFeed(trimmed);
      saveSubscribedPodcast(feed, parsedEpisodes);
      setSelectedFeedUrl(feed.url);
      setRssInput('');
      setFormOpen(false);
      toast.success(`${feed.title} ajouté`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible d’ajouter ce flux RSS.');
    } finally {
      setAdding(false);
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

  const addForm = showForm && (
    <form onSubmit={e => void handleAddFeed(e)} className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          type="url"
          value={rssInput}
          onChange={e => setRssInput(e.target.value)}
          placeholder="Adresse RSS du podcast"
          aria-label="Adresse RSS du podcast"
          className="min-h-11 flex-1 rounded-full border-transparent bg-secondary px-4"
        />
        <Button type="submit" disabled={adding || !rssInput.trim()} aria-label="Ajouter le podcast" className="min-h-11 rounded-full px-4">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Ajouter'}
        </Button>
      </div>
      {errorMsg && <p role="alert" className="px-1 text-xs text-red-400">{errorMsg}</p>}
    </form>
  );

  if (feeds.length === 0) {
    return (
      <div ref={panelRef} className="mx-auto max-w-md space-y-5 py-10 text-center" data-podcasts-panel data-tv-mode={tvMode ? 'true' : 'false'}>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-primary">
          <Headphones className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Aucun podcast</h2>
          <p className="text-sm text-muted-foreground">Colle l’adresse RSS d’une émission.</p>
        </div>
        {addForm}
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
                className={`group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none ${tvMode ? tvFocus : 'focus-visible:ring-2 focus-visible:ring-primary'}`}
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
      onClick={() => { setFormOpen(open => !open); setErrorMsg(null); }}
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
    return (
      <div ref={panelRef} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-8 pb-24" data-podcasts-panel data-tv-mode="true">
        <section aria-label="Mes émissions" className="space-y-3">
          {sectionTitle}
          {addForm}
          <div className="space-y-1">
            {feeds.map(feed => {
              const active = selectedFeed?.url === feed.url;
              return (
                <button
                  key={feed.url}
                  type="button"
                  data-feed-url={feed.url}
                  aria-pressed={active}
                  onClick={() => setSelectedFeedUrl(feed.url)}
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
        <section aria-label="Épisodes de l’émission" className="space-y-2">
          {feedHeader}
          {episodeList}
        </section>
      </div>
    );
  }

  return (
    <div ref={panelRef} className={`space-y-5 ${audioState.active ? 'pb-20' : ''}`} data-podcasts-panel data-tv-mode="false">
      <section aria-label="Mes émissions" className="space-y-3">
        {sectionTitle}
        {addForm}
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
      </section>
      <section aria-label="Épisodes de l’émission" className="space-y-1">
        {feedHeader}
        {episodeList}
      </section>
    </div>
  );
}
