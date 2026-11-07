import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Headphones,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rss,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AudioPlaybackState, PodcastEpisode, PodcastFeed, PodcastProgress } from '@/types/podcast';
import { fetchPodcastFeed } from '@/utils/podcastFetcher';
import {
  clampPodcastSpeed,
  onPodcastStorageChange,
  readAllEpisodeProgress,
  readEpisodesForFeed,
  readPodcastFeeds,
  removeSubscribedPodcast,
  saveSubscribedPodcast,
} from '@/utils/podcastStorage';
import { AudioBridge } from '@/utils/nativePlayer';

const SPEED_OPTIONS = [0.8, 1, 1.25, 1.5, 1.75, 2] as const;

export function formatAudioTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPubDate(pubDate?: string, publishedAt?: number): string {
  const ts = publishedAt || (pubDate ? Date.parse(pubDate) : 0);
  if (!ts || !Number.isFinite(ts)) return '';
  try {
    return new Date(ts).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export interface PodcastsPanelProps {
  tvMode?: boolean;
}

export function PodcastsPanel({ tvMode = false }: PodcastsPanelProps) {
  const [feeds, setFeeds] = useState<PodcastFeed[]>(() => readPodcastFeeds());
  const [selectedFeedUrl, setSelectedFeedUrl] = useState<string | null>(() => readPodcastFeeds()[0]?.url ?? null);
  const [progressMap, setProgressMap] = useState<Record<string, PodcastProgress>>(() => readAllEpisodeProgress());
  const [audioState, setAudioState] = useState<AudioPlaybackState>(() => AudioBridge.getState());
  const [rssInput, setRssInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    const unsubAudio = AudioBridge.subscribe(state => {
      setAudioState(state);
      setProgressMap(readAllEpisodeProgress());
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

  const episodes = useMemo(
    () => (selectedFeed ? readEpisodesForFeed(selectedFeed.url) : []),
    [selectedFeed, feeds]
  );

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
      toast.success(`Podcast ajouté : ${feed.title} (${parsedEpisodes.length} épisodes)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Impossible d’ajouter ce flux RSS.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setAdding(false);
    }
  };

  const handleRefreshFeed = async (feed: PodcastFeed) => {
    setRefreshingUrl(feed.url);
    try {
      const { feed: updatedFeed, episodes: parsedEpisodes } = await fetchPodcastFeed(feed.url);
      saveSubscribedPodcast(updatedFeed, parsedEpisodes);
      toast.success(`Flux actualisé : ${updatedFeed.title}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Actualisation impossible.');
    } finally {
      setRefreshingUrl(null);
    }
  };

  const handleRemoveFeed = (feed: PodcastFeed) => {
    removeSubscribedPodcast(feed.url);
    toast.info(`Abonnement retiré : ${feed.title}`);
  };

  const handleEpisodePlayToggle = async (episode: PodcastEpisode) => {
    if (audioState.active && audioState.episodeId === episode.id) {
      await AudioBridge.togglePlayPause();
      return;
    }
    await AudioBridge.playEpisode(episode);
  };

  return (
    <div className="space-y-6" data-podcasts-panel data-tv-mode={tvMode ? 'true' : 'false'}>
      {/* En-tête et formulaire d'ajout par flux RSS */}
      <Card className="bg-neutral-950 border-neutral-900 rounded-[20px]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2.5 text-xl font-semibold text-white">
              <Headphones className="h-5 w-5 text-primary" aria-hidden="true" />
              <span>Écouter · Podcasts</span>
            </CardTitle>
            <Badge variant="outline" className="border-neutral-800 text-neutral-300 text-xs">
              Lecture écran éteint & reprise par épisode
            </Badge>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Ajoute un podcast via son adresse RSS pour récupérer ses épisodes publiés. La position d’écoute et la vitesse choisie sont mémorisées pour chaque épisode sur cet appareil (sans synchronisation de l’historique d’une application tierce).
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={e => void handleAddFeed(e)} className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Rss className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <Input
                type="url"
                value={rssInput}
                onChange={e => setRssInput(e.target.value)}
                placeholder="https://radiofrance-podcast.net/podcast09/rss_14312.xml"
                aria-label="Adresse RSS du podcast"
                className="pl-9 min-h-11 bg-neutral-900 border-neutral-800 text-white"
              />
            </div>
            <Button
              type="submit"
              disabled={adding || !rssInput.trim()}
              className="min-h-11 px-4"
            >
              {adding ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  Ajout…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                  Ajouter le flux RSS
                </>
              )}
            </Button>
          </form>
          {errorMsg && (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {errorMsg}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Bandeau de contrôle rapide de l'épisode actif */}
      {audioState.active && audioState.episodeId && (
        <Card aria-label="Lecture podcast en cours" className="bg-neutral-950 border-primary/40 rounded-[20px]">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-primary truncate">
                  {audioState.podcastTitle || 'Podcast en cours'}
                </p>
                <p className="text-sm font-semibold text-white truncate" data-testid="active-audio-title">
                  {audioState.title}
                </p>
                <p className="text-xs text-neutral-400 font-mono mt-0.5" data-testid="active-audio-time">
                  {formatAudioTime(audioState.positionMs)}
                  {audioState.durationMs > 0 ? ` / ${formatAudioTime(audioState.durationMs)}` : ''}
                  {' · '}
                  <span data-testid="active-audio-speed">{audioState.speed}×</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void AudioBridge.seekBy(-15_000)}
                  aria-label="Reculer de 15 secondes"
                  className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900"
                >
                  <RotateCcw className="h-4 w-4 mr-1" aria-hidden="true" />
                  -15s
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void AudioBridge.togglePlayPause()}
                  aria-label={audioState.playing ? 'Mettre en pause le podcast' : 'Reprendre le podcast'}
                  className="min-h-11 px-4"
                >
                  {audioState.playing ? (
                    <>
                      <Pause className="h-4 w-4 mr-1.5" aria-hidden="true" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-1.5" aria-hidden="true" />
                      Lecture
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void AudioBridge.seekBy(30_000)}
                  aria-label="Avancer de 30 secondes"
                  className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900"
                >
                  <RotateCw className="h-4 w-4 mr-1" aria-hidden="true" />
                  +30s
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1" role="group" aria-label="Vitesse de lecture">
              <span className="text-xs text-neutral-400 mr-1">Vitesse :</span>
              {SPEED_OPTIONS.map(s => {
                const isSelected = Math.abs(audioState.speed - s) < 0.03;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => void AudioBridge.setSpeed(s)}
                    className={`min-h-9 px-2.5 rounded-full text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    {s}×
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Liste des abonnements et épisodes — adaptation selon tvMode (useTvMode) */}
      {feeds.length === 0 ? (
        <div className="text-center py-12 rounded-[20px] border border-neutral-900 bg-neutral-950/60 p-6">
          <Headphones className="h-12 w-12 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
          <p className="text-neutral-200 font-medium">Aucun podcast enregistré</p>
          <p className="text-sm text-neutral-400 mt-1 max-w-md mx-auto">
            Colle l’adresse du flux RSS d’une émission ci-dessus pour accéder à ses épisodes et les écouter en arrière-plan.
          </p>
        </div>
      ) : (
        <div className={tvMode ? 'grid grid-cols-3 gap-6 items-start' : 'space-y-6'}>
          {/* Colonne / Rail des émissions suivies */}
          <Card className="bg-neutral-950 border-neutral-900 rounded-[20px]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
                Mes émissions ({feeds.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {feeds.map(feed => {
                const active = selectedFeed?.url === feed.url;
                return (
                  <div
                    key={feed.url}
                    className={`flex items-center gap-2 rounded-xl border p-2 transition-colors ${
                      active
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-neutral-900 bg-neutral-900/40 hover:bg-neutral-900'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedFeedUrl(feed.url)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg p-1"
                    >
                      {feed.artworkUrl ? (
                        <img
                          src={feed.artworkUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-11 w-11 shrink-0 rounded-lg object-cover bg-neutral-800"
                        />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-primary">
                          <Headphones className="h-5 w-5" aria-hidden="true" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">
                          {feed.title}
                        </span>
                        {feed.description && (
                          <span className="block truncate text-xs text-neutral-400">
                            {feed.description}
                          </span>
                        )}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRefreshFeed(feed)}
                      disabled={refreshingUrl === feed.url}
                      aria-label={`Actualiser ${feed.title}`}
                      className="h-9 w-9 p-0 text-neutral-400 hover:text-white"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${refreshingUrl === feed.url ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFeed(feed)}
                      aria-label={`Supprimer ${feed.title}`}
                      className="h-9 w-9 p-0 text-neutral-400 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Liste des épisodes de l'émission sélectionnée */}
          {selectedFeed && (
            <Card className={tvMode ? 'col-span-2 bg-neutral-950 border-neutral-900 rounded-[20px]' : 'bg-neutral-950 border-neutral-900 rounded-[20px]'}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold text-white">
                  {selectedFeed.title}
                </CardTitle>
                {selectedFeed.description && (
                  <p className="text-xs text-neutral-400 line-clamp-2">{selectedFeed.description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-2.5">
                {episodes.map(episode => {
                  const isCurrent = audioState.active && audioState.episodeId === episode.id;
                  const isPlaying = isCurrent && audioState.playing;
                  const prog = progressMap[episode.id];
                  const posMs = isCurrent ? audioState.positionMs : (prog?.positionMs ?? 0);
                  const durMs = (isCurrent && audioState.durationMs > 0)
                    ? audioState.durationMs
                    : (prog?.durationMs || episode.durationMs || 0);
                  const savedSpeed = clampPodcastSpeed(isCurrent ? audioState.speed : (prog?.speed ?? 1.0));
                  const completed = Boolean(prog?.completed) && !isPlaying;
                  const percent = durMs > 0 ? Math.min(100, Math.max(0, Math.round((posMs / durMs) * 100))) : 0;
                  const hasResume = !completed && posMs > 0;
                  const dateLabel = formatPubDate(episode.pubDate, episode.publishedAt);

                  return (
                    <article
                      key={episode.id}
                      data-episode-id={episode.id}
                      className={`rounded-2xl border p-3.5 transition-colors ${
                        isCurrent
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-neutral-900 bg-card hover:bg-accent/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-white leading-snug">
                            {episode.title}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                            {dateLabel && <span>{dateLabel}</span>}
                            {durMs > 0 && <span>· {formatAudioTime(durMs)}</span>}
                            {savedSpeed !== 1 && (
                              <Badge variant="outline" className="border-primary/40 text-primary text-[11px] px-1.5 py-0">
                                {savedSpeed}×
                              </Badge>
                            )}
                            {completed && (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                Terminé
                              </span>
                            )}
                            {hasResume && (
                              <span className="text-amber-300 font-medium">
                                Reprendre à {formatAudioTime(posMs)}
                              </span>
                            )}
                          </div>
                          {episode.description && (
                            <p className="mt-1.5 text-xs text-neutral-400 line-clamp-2">
                              {episode.description}
                            </p>
                          )}
                          {hasResume && durMs > 0 && (
                            <div
                              role="progressbar"
                              aria-label={`Progression de ${episode.title}`}
                              aria-valuenow={percent}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
                            >
                              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={isPlaying ? 'default' : 'outline'}
                          onClick={() => void handleEpisodePlayToggle(episode)}
                          aria-label={
                            isPlaying
                              ? `Pause ${episode.title}`
                              : hasResume
                                ? `Reprendre ${episode.title}`
                                : `Écouter ${episode.title}`
                          }
                          className={`min-h-11 shrink-0 px-3.5 ${
                            isPlaying ? '' : 'border-neutral-800 text-white hover:bg-neutral-900'
                          }`}
                        >
                          {isPlaying ? (
                            <>
                              <Pause className="h-4 w-4 mr-1.5" aria-hidden="true" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-1.5" aria-hidden="true" />
                              {hasResume ? 'Reprendre' : 'Écouter'}
                            </>
                          )}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
