import { useEffect, useMemo, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Search,
  Link as LinkIcon,
  Sparkles,
  HelpCircle,
  X,
  Radio,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AudioPlaybackState,
  LinkResolutionResult,
  PodcastEpisode,
  PodcastFeed,
  PodcastProgress,
  PodcastSearchResult,
} from '@/types/podcast';
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
import {
  DEFAULT_PODCAST_SUGGESTIONS,
  PODCAST_GENRES,
  resolvePodcastLink,
  searchPodcasts,
} from '@/utils/podcastSearch';

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

  // Gestion des 3 modes d'ajout : Recherche (défaut) / Coller un lien / Flux RSS direct
  const [addTab, setAddTab] = useState<'search' | 'link' | 'rss'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('Tous');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PodcastSearchResult[]>(DEFAULT_PODCAST_SUGGESTIONS);
  const [subscribingUrl, setSubscribingUrl] = useState<string | null>(null);

  // Coller un lien
  const [linkInput, setLinkInput] = useState('');
  const [isResolvingLink, setIsResolvingLink] = useState(false);
  const [resolvedLink, setResolvedLink] = useState<LinkResolutionResult | null>(null);

  // Flux RSS direct (option avancée)
  const [rssInput, setRssInput] = useState('');
  const [addingRss, setAddingRss] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Recherche automatique avec temporisation (debounce 350 ms)
  const searchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setIsSearching(false);
      if (selectedGenre === 'Tous') {
        setSearchResults(DEFAULT_PODCAST_SUGGESTIONS);
      } else {
        setSearchResults(DEFAULT_PODCAST_SUGGESTIONS.filter(s => s.genre === selectedGenre));
      }
      return;
    }

    setIsSearching(true);
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const results = await searchPodcasts(trimmed, { signal: controller.signal, limit: 16 });
        if (!controller.signal.aborted) {
          setSearchResults(results);
          setIsSearching(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, selectedGenre]);

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

  const episodes = useMemo(
    () => (selectedFeed ? readEpisodesForFeed(selectedFeed.url) : []),
    [selectedFeed, feeds]
  );

  const handleSubscribePodcast = async (feedUrl: string) => {
    if (!feedUrl) return;
    setSubscribingUrl(feedUrl);
    setErrorMsg(null);
    try {
      const { feed, episodes: parsedEpisodes } = await fetchPodcastFeed(feedUrl);
      saveSubscribedPodcast(feed, parsedEpisodes);
      setSelectedFeedUrl(feed.url);
      toast.success(`Abonné à ${feed.title} (${parsedEpisodes.length} épisodes)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Impossible de récupérer ce podcast.';
      toast.error(msg);
    } finally {
      setSubscribingUrl(null);
    }
  };

  const handleResolveLink = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = linkInput.trim();
    if (!trimmed) return;
    setIsResolvingLink(true);
    setResolvedLink(null);
    try {
      const result = await resolvePodcastLink(trimmed);
      setResolvedLink(result);
      if (!result.resolved) {
        if (result.warning) toast.warning(result.warning);
        else if (result.error) toast.error(result.error);
      }
    } catch {
      toast.error('Impossible d’analyser ce lien.');
    } finally {
      setIsResolvingLink(false);
    }
  };

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rssInput.trim();
    if (!trimmed) return;
    setAddingRss(true);
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
      setAddingRss(false);
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
      {/* En-tête et découverte / ajout de podcasts */}
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
            Trouvez vos émissions par leur nom, collez le lien d’une plateforme ou ajoutez un flux RSS. La progression et la vitesse sont mémorisées sur cet appareil.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={addTab} onValueChange={v => setAddTab(v as 'search' | 'link' | 'rss')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList className="bg-neutral-900 border border-neutral-800 p-1">
                <TabsTrigger value="search" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs gap-1.5 min-h-9">
                  <Search className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Rechercher un podcast</span>
                </TabsTrigger>
                <TabsTrigger value="link" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs gap-1.5 min-h-9">
                  <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Coller un lien</span>
                </TabsTrigger>
                <TabsTrigger value="rss" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs gap-1.5 min-h-9">
                  <Rss className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Flux RSS direct</span>
                </TabsTrigger>
              </TabsList>

              <button
                type="button"
                onClick={() => setShowHelp(v => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors py-1 px-2 rounded-md hover:bg-neutral-900"
                aria-expanded={showHelp}
              >
                <HelpCircle className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span>Je ne trouve pas mon podcast ?</span>
              </button>
            </div>

            {/* Volet d'aide pratique */}
            {showHelp && (
              <div className="mt-3 p-3.5 rounded-xl bg-neutral-900/90 border border-neutral-800 text-xs text-neutral-300 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                    Comment retrouver n’importe quelle émission dans CedPlay :
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowHelp(false)}
                    className="text-neutral-400 hover:text-white p-1"
                    aria-label="Fermer l'aide"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <ul className="list-disc list-inside space-y-1 text-neutral-400">
                  <li>
                    <strong className="text-white">Recherche par nom :</strong> tapez le titre complet ou le producteur (ex. <em>Affaires sensibles</em>, <em>France Inter</em>, <em>Transfert</em>, <em>HugoDécrypte</em>). Les annuaires publics Apple Podcasts et Gpodder sont interrogés instantanément.
                  </li>
                  <li>
                    <strong className="text-white">Lien d’émission :</strong> copiez l’adresse de l’émission depuis Apple Podcasts, Radio France ou son site officiel, et collez-la dans l’onglet <em>Coller un lien</em>.
                  </li>
                  <li>
                    <strong className="text-white">Émissions Spotify :</strong> le lien Spotify permet d’identifier l’émission. Chez Spotify, le créateur doit avoir activé la distribution externe de son flux RSS pour permettre une lecture hors de l'application officielle.
                  </li>
                  <li>
                    <strong className="text-white">Podcasts privés / abonnements :</strong> utilisez l'onglet <em>Flux RSS direct</em> pour coller votre adresse privée (ex. Patreon, flux réservé aux membres).
                  </li>
                </ul>
              </div>
            )}

            {/* Onglet 1 : Recherche par nom / mot-clé & Suggestions */}
            <TabsContent value="search" className="space-y-4 mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <Input
                    type="search"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Rechercher par nom (ex. Affaires sensibles, histoire, actu...)"
                    aria-label="Rechercher un podcast par nom"
                    className="pl-9 pr-9 min-h-11 bg-neutral-900 border-neutral-800 text-white"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                      aria-label="Effacer la recherche"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {isSearching && (
                  <div className="flex items-center gap-1.5 text-xs text-neutral-400 px-2 py-1">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                    <span>Recherche…</span>
                  </div>
                )}
              </div>

              {/* Filtres de genres pour les suggestions de démarrage */}
              {!searchQuery.trim() && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Catégories suggérées">
                  <span className="text-xs text-neutral-400 mr-1">Suggestions :</span>
                  {PODCAST_GENRES.map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setSelectedGenre(g)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        selectedGenre === g
                          ? 'bg-primary/20 border-primary text-primary font-medium'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}

              {/* Grille de résultats ou suggestions */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[380px] overflow-y-auto pr-1"
                data-testid="podcast-search-results"
              >
                {searchResults.map(podcast => {
                  const isSubscribed = feeds.some(f => f.url === podcast.feedUrl);
                  const isSubscribing = subscribingUrl === podcast.feedUrl;

                  return (
                    <div
                      key={podcast.id}
                      className="flex items-start gap-3 p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 transition-colors"
                    >
                      {podcast.artworkUrl ? (
                        <img
                          src={podcast.artworkUrl}
                          alt=""
                          className="h-16 w-16 rounded-lg object-cover flex-shrink-0 bg-neutral-800"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-lg bg-neutral-800 flex items-center justify-center flex-shrink-0 text-neutral-500">
                          <Radio className="h-7 w-7" aria-hidden="true" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1 flex flex-col justify-between h-full">
                        <div>
                          <p className="text-sm font-semibold text-white truncate" title={podcast.title}>
                            {podcast.title}
                          </p>
                          <p className="text-xs text-neutral-400 truncate" title={podcast.author}>
                            {podcast.author || 'Producteur non précisé'}
                          </p>
                          {podcast.genre && (
                            <Badge variant="outline" className="mt-1 text-[10px] py-0 px-1.5 border-neutral-800 text-neutral-400">
                              {podcast.genre}
                            </Badge>
                          )}
                        </div>

                        <div className="mt-2 flex items-center justify-between">
                          {isSubscribed ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Abonné
                            </span>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={isSubscribing || !podcast.feedUrl}
                              onClick={() => void handleSubscribePodcast(podcast.feedUrl)}
                              className="h-8 text-xs px-2.5 font-medium"
                              aria-label={`S'abonner à ${podcast.title}`}
                            >
                              {isSubscribing ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />
                                  Ajout…
                                </>
                              ) : (
                                <>
                                  <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
                                  S’abonner
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {searchResults.length === 0 && !isSearching && (
                  <div className="col-span-full py-8 text-center text-sm text-neutral-400 space-y-2">
                    <p>Aucun podcast trouvé pour « {searchQuery} ».</p>
                    <p className="text-xs text-neutral-500">
                      Vérifiez l’orthographe ou essayez l’onglet <em>Coller un lien</em> pour insérer directement l’adresse de l’émission.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Onglet 2 : Coller un lien */}
            <TabsContent value="link" className="space-y-4 mt-3">
              <form onSubmit={e => void handleResolveLink(e)} className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[240px]">
                  <LinkIcon className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <Input
                    type="url"
                    value={linkInput}
                    onChange={e => setLinkInput(e.target.value)}
                    placeholder="https://podcasts.apple.com/... ou https://open.spotify.com/show/..."
                    aria-label="Coller le lien de l’émission"
                    className="pl-9 min-h-11 bg-neutral-900 border-neutral-800 text-white"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isResolvingLink || !linkInput.trim()}
                  className="min-h-11 px-4"
                >
                  {isResolvingLink ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                      Analyse…
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-1.5" aria-hidden="true" />
                      Analyser le lien
                    </>
                  )}
                </Button>
              </form>

              <div className="flex flex-wrap gap-1.5 text-[11px] text-neutral-400">
                <span>Liens pris en charge :</span>
                <span className="text-neutral-300">Apple Podcasts · Radio France · Spotify (si flux externe activé) · Sites officiels & blogs</span>
              </div>

              {/* Aperçu de confirmation de l'émission résolue */}
              {resolvedLink && resolvedLink.resolved && resolvedLink.podcast && (
                <div className="p-4 rounded-xl bg-neutral-900 border border-primary/40 space-y-3">
                  <div className="flex items-start gap-3">
                    {resolvedLink.podcast.artworkUrl ? (
                      <img
                        src={resolvedLink.podcast.artworkUrl}
                        alt=""
                        className="h-16 w-16 rounded-lg object-cover flex-shrink-0 bg-neutral-800"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-lg bg-neutral-800 flex items-center justify-center flex-shrink-0 text-neutral-500">
                        <Radio className="h-7 w-7" aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <Badge variant="outline" className="text-[10px] mb-1 border-primary/40 text-primary">
                        Émission trouvée
                      </Badge>
                      <h4 className="text-base font-semibold text-white truncate">
                        {resolvedLink.podcast.title}
                      </h4>
                      {resolvedLink.podcast.author && (
                        <p className="text-xs text-neutral-400 truncate">
                          {resolvedLink.podcast.author}
                        </p>
                      )}
                    </div>
                  </div>

                  {resolvedLink.warning && (
                    <p className="text-xs text-amber-300 bg-amber-950/40 p-2.5 rounded-lg border border-amber-900/50">
                      {resolvedLink.warning}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    {feeds.some(f => f.url === resolvedLink.feedUrl) ? (
                      <Badge className="bg-green-950 border-green-800 text-green-300 py-1.5 px-3 text-xs">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        Déjà dans vos abonnements
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        disabled={subscribingUrl === resolvedLink.feedUrl || !resolvedLink.feedUrl}
                        onClick={() => void handleSubscribePodcast(resolvedLink.feedUrl!)}
                        className="min-h-10 px-4"
                      >
                        {subscribingUrl === resolvedLink.feedUrl ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                            Abonnement en cours…
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                            Confirmer l’abonnement
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {resolvedLink && !resolvedLink.resolved && (
                <div role="alert" className="p-3.5 rounded-xl bg-red-950/30 border border-red-900/50 text-xs text-red-300 space-y-1">
                  <p className="font-semibold">{resolvedLink.warning || resolvedLink.error || 'Impossible de trouver le flux RSS de ce lien.'}</p>
                  <p className="text-neutral-400">
                    Si cette émission possède une adresse de flux RSS directe ou privée (Patreon, club privé), utilisez l'onglet <em>Flux RSS direct</em>.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Onglet 3 : Flux RSS direct (Option avancée) */}
            <TabsContent value="rss" className="space-y-3 mt-3">
              <p className="text-xs text-neutral-400">
                Option avancée : collez directement une adresse RSS (ex. flux privé Patreon, émission sur serveur personnel ou URL XML spécifique).
              </p>
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
                  disabled={addingRss || !rssInput.trim()}
                  className="min-h-11 px-4"
                >
                  {addingRss ? (
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
            </TabsContent>
          </Tabs>
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
