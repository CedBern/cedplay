import { Bookmark, BookmarkCheck, HardDrive, ListVideo, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TvVodScreen, storedVodPosition } from '@/components/TvVodScreen';
import { TvSeriesFiche } from '@/components/TvSeriesFiche';
import { TvStarter, type TvStarterAction } from '@/components/TvStarter';
import { VodPoster } from '@/components/VodPoster';
import type { PlaylistInfo } from '@/types/channel';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { getPlaybackUrl } from '@/hooks/useVideoPlayer';
import { onPlaybackDelegated } from '@/utils/playbackOwnership';
import { catalogRequest, getXtreamAccount, parseCatalog, parseCategories, parseDetails, readVodProgress, saveVodProgress, vodUrl, type CatalogCategory, type CatalogDetails, type CatalogItem } from '@/utils/xtreamCatalog';
import { getPlayHistory, getExternalWatches, getLocalLibraryWorks, pushPlayHistory, updateVodHistoryProgress, historyScope, getVodWatchlistFromDB, toggleVodWatchlist, type PlayHistoryEntry, type VodWatchlistItem } from '@/utils/idb';
import { localLibraryWatches, LOCAL_SEED_LIMIT, type LocalWork } from '@/utils/localLibrary';
import { recommendForHistory } from '@/utils/recommendations';
import { attachUsageMeter } from '@/utils/usageJournal';
import { saveForYouSnapshot } from '@/utils/discover';
import { enrichRecommendations, type TasteEnrichment } from '@/utils/tasteEnrichment';
import { externalSeeds, externalSummary } from '@/utils/externalWatch';
import { ExternalWatchDialog } from '@/components/ExternalWatchDialog';
import { normalizeTitle, normalizeForCompare } from '@/utils/titleNormalize';
import { normalizeWatchRegion } from '@/data/watchRegions';
import { maybeScrobbleTrakt } from '@/utils/trakt';
import { TmdbPanel } from '@/components/TmdbPanel';
import { SubtitleSelector, type ReadySubtitle } from '@/components/SubtitleSelector';
import { PlatformLogo } from '@/components/PlatformLogo';
import { matchStreamingPlatformOrNetwork } from '@/utils/platformLogos';
import { StorageManager } from '@/utils/storage';
import { isAdultGroupName } from '@/utils/parentalControl';
import { rememberVodCategories } from '@/utils/parentalVod';
import { toast } from 'sonner';

import { categoryCatalogCache } from '@/utils/vodPosterCache';

function WebVodPlayer({
  url,
  title,
  mediaId,
  restart,
  subtitleVtt,
  onEnded,
  name,
  mediaKind,
  episodeName,
  season,
  episode,
  tmdbId,
  year,
}: {
  url: string;
  title: string;
  mediaId: string;
  restart: boolean;
  subtitleVtt?: string | undefined;
  onEnded?: (() => void) | undefined;
  name?: string | undefined;
  mediaKind?: 'movie' | 'series' | undefined;
  episodeName?: string | undefined;
  season?: number | undefined;
  episode?: number | undefined;
  tmdbId?: number | undefined;
  year?: string | undefined;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // Référence mutable : le callback d'enchaînement ne doit pas relancer l'effet
  // d'attachement du flux (il ne dépend que de l'URL et du média).
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const titleRef = useRef(title);
  titleRef.current = title;
  const metaRef = useRef({ name, mediaKind, episodeName, season, episode, tmdbId, year });
  metaRef.current = { name, mediaKind, episodeName, season, episode, tmdbId, year };
  // Session de scrobble stable et date de début de lecture
  const sessionIdRef = useRef(`web:${mediaId}:${Date.now()}`);
  const startedAtRef = useRef(Date.now());
  useEffect(() => {
    const video = ref.current;
    if (!video || !subtitleVtt) return;
    const blob = new Blob([subtitleVtt], { type: 'text/vtt;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = 'Français';
    track.srclang = 'fr';
    track.src = blobUrl;
    track.default = true;
    video.appendChild(track);
    return () => {
      URL.revokeObjectURL(blobUrl);
      track.remove();
    };
  }, [subtitleVtt]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let cancelled = false;
    let engine: { destroy(): void } | undefined;

    let watchedMs = 0;
    let lastPlayingAt: number | null = null;
    const flushPlaying = () => {
      if (lastPlayingAt !== null) {
        const now = performance.now();
        watchedMs += Math.max(0, now - lastPlayingAt);
        // Ne continue la mesure que si le flux produit activement des images (ni pause, ni fin, données suffisantes)
        lastPlayingAt = (!video.paused && !video.ended && video.readyState >= 3) ? now : null;
      }
    };
    const onPlaying = () => {
      if (lastPlayingAt !== null) {
        watchedMs += Math.max(0, performance.now() - lastPlayingAt);
      }
      lastPlayingAt = performance.now();
    };
    const onStopOrBuffering = () => {
      if (lastPlayingAt !== null) {
        watchedMs += Math.max(0, performance.now() - lastPlayingAt);
        lastPlayingAt = null;
      }
    };

    const save = (isClosed = false) => {
      flushPlaying();
      // Seul l'événement DOM 'playing' atteste de la lecture active : ne jamais redémarrer le compteur ici
      // pendant les périodes d'attente/chargement (où video.paused reste faux).
      const position = video.currentTime * 1000, duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
      saveVodProgress(mediaId, position, duration);
      void updateVodHistoryProgress(mediaId, position, duration, video.ended).catch(() => {});
      const m = metaRef.current;
      const isSeries = m.mediaKind === 'series' || mediaId.includes(':series:');
      const workName = m.name || (isSeries ? undefined : titleRef.current) || titleRef.current;
      const effectiveWatchedMs = video.ended ? Math.max(5000, Math.round(watchedMs)) : Math.round(watchedMs);

      void maybeScrobbleTrakt(
        {
          channelId: `vod:${mediaId}`,
          name: workName,
          mediaKind: isSeries ? 'series' : 'movie',
          ...(isSeries ? { episodeName: m.episodeName || titleRef.current } : {}),
          ...(m.season !== undefined ? { season: m.season } : {}),
          ...(m.episode !== undefined ? { episode: m.episode } : {}),
          ...(m.tmdbId ? { tmdbId: m.tmdbId } : {}),
          ...(m.year ? { year: m.year } : {}),
          ts: startedAtRef.current,
        },
        position,
        duration,
        video.ended,
        StorageManager.getCachedSettings(),
        sessionIdRef.current,
        undefined,
        isClosed,
        effectiveWatchedMs,
      ).catch(() => {});
    };
    const ended = () => { onStopOrBuffering(); save(false); onEndedRef.current?.(); };
    const stop = () => { onStopOrBuffering(); save(true); cancelled = true; engine?.destroy(); video.pause(); video.removeAttribute('src'); video.load(); };
    const unsubscribe = onPlaybackDelegated(stop);
    // Reprise fiable en HLS : duration vaut Infinity tant que les segments ne sont
    // pas indexés — on réessaie à chaque durationchange jusqu'à ce qu'elle soit connue.
    let seekTarget: number | null = null;
    const applyPosition = () => {
      if (seekTarget === null || !Number.isFinite(video.duration) || video.duration <= 0) return;
      video.currentTime = Math.min(seekTarget / 1000, Math.max(0, video.duration - 1));
      seekTarget = null;
    };
    const metadata = () => { seekTarget = restart ? 0 : readVodProgress(mediaId)?.positionMs || 0; applyPosition(); };
    const onPause = () => { onStopOrBuffering(); save(false); };
    video.addEventListener('loadedmetadata', metadata);
    video.addEventListener('durationchange', applyPosition);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', ended);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onStopOrBuffering);
    video.addEventListener('seeking', onStopOrBuffering);
    video.addEventListener('stalled', onStopOrBuffering);
    video.addEventListener('emptied', onStopOrBuffering);
    video.addEventListener('error', onStopOrBuffering);
    const timer = window.setInterval(() => { save(false); }, 15_000);
    const detachUsage = attachUsageMeter(video, 'vod');
    const start = async () => {
      const playbackUrl = getPlaybackUrl(url);
      if (new URL(url).pathname.toLowerCase().endsWith('.m3u8') && !video.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) { toast.error('Format indisponible dans ce navigateur. Essaie sur Android.'); return; }
        const hls = new Hls(); engine = hls; hls.loadSource(playbackUrl); hls.attachMedia(video);
      } else video.src = playbackUrl;
      void video.play().catch(() => {});
    };
    void start().catch(() => toast.error('Lecture indisponible dans ce navigateur.'));
    return () => {
      clearInterval(timer);
      detachUsage();
      unsubscribe();
      video.removeEventListener('loadedmetadata', metadata);
      video.removeEventListener('durationchange', applyPosition);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', ended);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onStopOrBuffering);
      video.removeEventListener('seeking', onStopOrBuffering);
      video.removeEventListener('stalled', onStopOrBuffering);
      video.removeEventListener('emptied', onStopOrBuffering);
      video.removeEventListener('error', onStopOrBuffering);
      stop();
    };
  }, [url, mediaId, restart]);
  return <div className="space-y-2"><p>{title}</p><video ref={ref} controls playsInline className="w-full max-h-[65vh] bg-black" onError={() => toast.error('Ce format ne peut pas être lu ici. Essaie le lecteur Android.')} /></div>;
}

export interface VodResumeRequest {
  nonce: number;
  kind: 'movie' | 'series';
  id?: string | undefined;
  name?: string | undefined;
  seriesId?: string | undefined;
  mode?: 'details' | undefined;
  item?: VodWatchlistItem | undefined;
}

export interface VodLibraryProps {
  playlist: PlaylistInfo;
  kind: 'movie' | 'series';
  tmdbApiKey?: string | undefined;
  resumeRequest?: VodResumeRequest | undefined;
  onResumeHandled?: (() => void) | undefined;
  /** Rendu télécommande (3 colonnes) au lieu de la mise en page mobile. */
  tvMode?: boolean | undefined;
  onSearch?: (() => void) | undefined;
  /** TV, films : ouvrir la bibliothèque USB/SD depuis la colonne de gauche. */
  onShowLocal?: (() => void) | undefined;
  /** TV, liste sans abonnement : ouvrir la connexion Xtream depuis l'écran vide. */
  onConnect?: (() => void) | undefined;
  /** Contrôle parental actif : les catégories adultes du catalogue sont masquées. */
  parentalEnabled?: boolean | undefined;
  /** Code parental saisi pour la session. */
  parentalUnlocked?: boolean | undefined;
  onCloseDetails?: (() => void) | undefined;
}

export function VodLibrary({ playlist, kind, tmdbApiKey, resumeRequest, onResumeHandled, tvMode = false, onSearch, onShowLocal, onConnect, parentalEnabled = false, parentalUnlocked = false, onCloseDetails }: VodLibraryProps) {
  const account = useMemo(() => getXtreamAccount(playlist), [playlist]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  // Verdict du filtre parental : « idle »/« loading » = catégories pas encore
  // connues, « error » = échec réseau. Un ensemble vide ne vaut pas « aucune
  // catégorie adulte ».
  const [categoriesStatus, setCategoriesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [category, setCategory] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [details, setDetails] = useState<CatalogDetails | null>(null);
  const [detailError, setDetailError] = useState('');
  // Titre TMDB ouvert depuis une rangée (absent du catalogue) : il remplace la fiche
  // du titre sélectionné, dont le synopsis fournisseur et les actions ne le concernent pas.
  const [tmdbTitle, setTmdbTitle] = useState<{ filmKey: string; title: string; year: string } | null>(null);
  useEffect(() => { setTmdbTitle(null); }, [selected]);
  const shownTitle = selected && tmdbTitle?.filmKey === selected.id ? tmdbTitle : null;
  const [season, setSeason] = useState('');
  const [subtitleEpisodeId, setSubtitleEpisodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<{
    url: string;
    title: string;
    mediaId: string;
    restart: boolean;
    subtitleVtt?: string | undefined;
    name?: string | undefined;
    mediaKind?: 'movie' | 'series' | undefined;
    episodeName?: string | undefined;
    season?: number | undefined;
    episode?: number | undefined;
    tmdbId?: number | undefined;
    year?: string | undefined;
  } | null>(null);
  // Enchaînement web : prochain épisode de la saison, proposé à la fin de la
  // lecture (miroir web du zapContext natif). ctx reporte l'identité de la
  // série dans l'historique même après fermeture de la fiche.
  const [queueNext, setQueueNext] = useState<{ id: string; ext: string; title: string; name: string; ctx?: { name?: string; poster?: string; seriesId?: string; categoryId?: string } } | null>(null);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void StorageManager.loadSettingsAsync().then(s => { if (!cancelled) setAutoNextEnabled(s.autoNextEpisode !== false); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Contrôle parental : même règle de nom que les groupes du direct, appliquée aux
  // catégories du catalogue (films et séries). Le registre de session alimente la
  // recherche globale et « Continuer », qui ne chargent pas ces catégories.
  const hideAdult = parentalEnabled && !parentalUnlocked;
  // Lu dans la requête de catégories sans la relancer quand le code est saisi.
  const hideAdultRef = useRef(hideAdult);
  hideAdultRef.current = hideAdult;
  const adultCategoryIds = useMemo(
    () => new Set(categories.filter(c => isAdultGroupName(c.name)).map(c => c.id)),
    [categories],
  );
  const visibleCategories = useMemo(
    () => hideAdult ? categories.filter(c => !adultCategoryIds.has(c.id)) : categories,
    [hideAdult, categories, adultCategoryIds],
  );
  const visibleItems = useMemo(
    () => hideAdult ? items.filter(item => !adultCategoryIds.has(item.categoryId)) : items,
    [hideAdult, items, adultCategoryIds],
  );
  useEffect(() => {
    if (hideAdult && category && adultCategoryIds.has(category)) setCategory('');
  }, [hideAdult, category, adultCategoryIds]);
  useEffect(() => {
    if (hideAdult && selected && adultCategoryIds.has(selected.categoryId)) setSelected(null);
  }, [hideAdult, selected, adultCategoryIds]);
  const [currentSub, setCurrentSub] = useState<ReadySubtitle | null>(null);
  const [vodHistory, setVodHistory] = useState<Awaited<ReturnType<typeof getPlayHistory>>>([]);
  const [allMovies, setAllMovies] = useState<CatalogItem[]>([]);
  const [watchlist, setWatchlist] = useState<VodWatchlistItem[]>([]);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  // TV : « Pour toi » est une entrée de la colonne de gauche, comme Ma Liste.
  const [showForYou, setShowForYou] = useState(false);
  // Mobile : rail toujours affiché. TV : calcul seulement quand l'entrée est ouverte
  // (le classement parcourt tout le catalogue et l'enrichissement interroge TMDB).
  const recsWanted = !tvMode || showForYou;
  const handledRequest = useRef<number | null>(null);
  const pendingResume = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVodWatchlistFromDB().then(wl => { if (!cancelled) setWatchlist(wl); }).catch(() => {});
    const update = () => { void getVodWatchlistFromDB().then(wl => { if (!cancelled) setWatchlist(wl); }).catch(() => {}); };
    window.addEventListener('vod-watchlist-updated', update);
    return () => { cancelled = true; window.removeEventListener('vod-watchlist-updated', update); };
  }, []);

  const watchlistForKind = useMemo(() => {
    return watchlist.filter(w => w.playlistId === playlist.id && w.kind === kind);
  }, [watchlist, playlist.id, kind]);

  const visibleWatchlist = useMemo(
    // Échec de lecture des catégories : impossible de dire quels titres enregistrés
    // sont adultes, donc aucun n'est exposé (contrairement à l'attente en cours, où
    // la liste reste visible mais la lecture est refusée plus bas).
    () => (hideAdult && categoriesStatus === 'error' ? [] : hideAdult ? watchlistForKind.filter(w => !adultCategoryIds.has(w.categoryId ?? '')) : watchlistForKind),
    [hideAdult, categoriesStatus, watchlistForKind, adultCategoryIds],
  );

  const watchlistIds = useMemo(() => {
    return new Set(visibleWatchlist.map(w => w.id));
  }, [visibleWatchlist]);

  const [historyRevision, setHistoryRevision] = useState(0);
  // Dernier ensemble d'œuvres qualifiées vu par « Pour toi » (voir l'effet d'historique) :
  // un tick de progression qui ne change pas cet ensemble ne doit pas replacer l'état.
  const historySignatureRef = useRef('');
  useEffect(() => {
    const update = () => setHistoryRevision(r => r + 1);
    window.addEventListener('vod-history-updated', update);
    return () => window.removeEventListener('vod-history-updated', update);
  }, []);
  // Libellés de reprise : la fiche éclair les affiche à chaque déplacement de grille —
  // lecture localStorage mise en cache par titre, invalidée quand l'historique bouge
  // ou au retour de lecture (focus rendu à la fenêtre).
  const progressCache = useRef(new Map<string, { label: string; saved: boolean }>());
  useEffect(() => {
    const invalidate = () => progressCache.current.clear();
    window.addEventListener('vod-history-updated', invalidate);
    window.addEventListener('focus', invalidate);
    return () => {
      window.removeEventListener('vod-history-updated', invalidate);
      window.removeEventListener('focus', invalidate);
    };
  }, []);
  // « Vu ailleurs » : visionnages importés (Netflix, Prime, YouTube…), restés hors
  // de l'historique de lecture. Déclaré avant l'effet ci-dessous : des films vus
  // ailleurs suffisent à amorcer le chargement du catalogue complet.
  const [externalWatches, setExternalWatches] = useState<PlayHistoryEntry[]>([]);

  // Bibliothèque locale (USB/SD) : index enregistré par LocalLibrary après chaque
  // analyse. Il nourrit « Pour toi » sans relancer le scan natif depuis le catalogue.
  const [localWorks, setLocalWorks] = useState<LocalWork[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getLocalLibraryWorks()
        .then(works => { if (!cancelled) setLocalWorks(works); })
        .catch(() => {});
    };
    load();
    window.addEventListener('local-library-updated', load);
    return () => { cancelled = true; window.removeEventListener('local-library-updated', load); };
  }, []);

  // Historique de lecture : léger (IndexedDB), il n'entraîne plus le téléchargement
  // du catalogue complet. Le pool des recommandations est construit au fil des
  // catégories consultées et conservé dans `categoryCatalogCache`.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void getPlayHistory().then(h => {
      if (cancelled) return;
      const signature = h.map(historyScope)
        .filter(e => e.kind === 'vod' && e.playlistId === playlist.id && e.mediaKind === kind && !!e.name && (e.status === 'completed' || (e.positionMs || 0) >= 60000))
        .map(e => `${e.channelId}:${e.status}`)
        .sort()
        .join('|');
      if (signature !== historySignatureRef.current) {
        historySignatureRef.current = signature;
        setVodHistory(h);
      }
    }).catch(() => {});
    // Reprise immédiate du pool déjà consulté pendant cette session.
    const prefix = `${playlist.id}:${account.server}:${kind}:`;
    const seen = new Set<string>();
    const merged: CatalogItem[] = [];
    for (const [key, value] of categoryCatalogCache) {
      if (!key.startsWith(prefix)) continue;
      for (const item of value.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
      }
    }
    if (merged.length) setAllMovies(merged);
    return () => { cancelled = true; };
  }, [account, kind, playlist.id, reload, historyRevision]);

  const visibleAllMovies = useMemo(
    () => hideAdult ? allMovies.filter(item => !adultCategoryIds.has(item.categoryId)) : allMovies,
    [hideAdult, allMovies, adultCategoryIds],
  );
  // « Vu ailleurs » : rechargés dès que le dialogue ou l'événement dédié les modifie.
  const reloadExternal = useCallback(async () => {
    try {
      const next = await getExternalWatches();
      // Le dialogue et l'événement « external-watches-updated » déclenchent tous deux
      // un rechargement : ne pas recréer le tableau quand rien n'a changé évite un
      // second passage d'enrichissement TMDB.
      setExternalWatches(previous => previous.length === next.length &&
        previous.every((entry, index) => entry.channelId === next[index].channelId && entry.ts === next[index].ts)
        ? previous
        : next);
    } catch { /* import facultatif */ }
  }, []);
  useEffect(() => {
    void reloadExternal();
    const update = () => { void reloadExternal(); };
    window.addEventListener('external-watches-updated', update);
    return () => window.removeEventListener('external-watches-updated', update);
  }, [reloadExternal]);
  // Œuvres vues ailleurs que le catalogue propose aussi : elles amorcent le classement
  // local (catégorie + titre) sans réseau. Les œuvres de la bibliothèque locale suivent
  // le même chemin : posséder un titre au catalogue vaut un visionnage, par type.
  const seeds = useMemo(
    () => (recsWanted
      ? externalSeeds([...localLibraryWatches(localWorks.filter(work => work.kind === kind).slice(0, LOCAL_SEED_LIMIT)), ...externalWatches], visibleAllMovies, playlist.id, kind)
      : []),
    [recsWanted, localWorks, externalWatches, visibleAllMovies, playlist.id, kind],
  );
  const rankingHistory = useMemo(() => {
    if (!seeds.length) return vodHistory;
    const known = new Set(vodHistory.map(entry => entry.channelId));
    return [...vodHistory, ...seeds.filter(seed => !known.has(seed.channelId))];
  }, [vodHistory, seeds]);
  // Classement local immédiat (catégorie + titre). Le pool de 40 laisse au profil de
  // goût la possibilité de promouvoir un titre qui n'était pas dans les 12 premiers.
  const baseRecommendations = useMemo(
    () => (recsWanted ? recommendForHistory(rankingHistory, visibleAllMovies, { limit: 40, playlistId: playlist.id, kind }) : []),
    [recsWanted, rankingHistory, visibleAllMovies, playlist.id, kind],
  );
  // Résolution TMDB bornée (derniers films vus + meilleurs candidats), en arrière-plan :
  // le rail reste affiché pendant l'enrichissement et retombe sur le classement local
  // sans clé TMDB ou hors réseau. Historique et catalogue passent par une référence pour
  // ne pas relancer les requêtes à chaque tick de progression de lecture.
  const tasteInputsRef = useRef({ history: vodHistory, movies: visibleAllMovies });
  // Synchronisation déclarée avant l'effet d'enrichissement : elle s'exécute en premier
  // dans le même cycle, sans écrire de référence pendant le rendu.
  useEffect(() => { tasteInputsRef.current = { history: vodHistory, movies: visibleAllMovies }; });
  const [taste, setTaste] = useState<TasteEnrichment | null>(null);
  useEffect(() => {
    const apiKey = tmdbApiKey?.trim();
    // TV : aucune requête TMDB tant que « Pour toi » n'est pas ouvert.
    if (!recsWanted || !apiKey || baseRecommendations.length === 0) { setTaste(null); return; }
    let cancelled = false;
    const { history, movies } = tasteInputsRef.current;
    void enrichRecommendations({
      kind, history, movies, candidates: baseRecommendations.map(entry => entry.item), playlistId: playlist.id, apiKey,
      external: externalWatches,
      local: localWorks,
    })
      .then(result => { if (!cancelled) setTaste(result); })
      .catch(() => { if (!cancelled) setTaste(null); });
    return () => { cancelled = true; };
  }, [baseRecommendations, tmdbApiKey, playlist.id, recsWanted, externalWatches, localWorks, kind]);
  const recommendations = useMemo(() => {
    if (!recsWanted) return [];
    const usable = taste && taste.playlistId === playlist.id && taste.profile.sampleSize > 0 ? taste : null;
    return recommendForHistory(rankingHistory, visibleAllMovies, {
      // TV : quatre rangées de cinq affiches.
      limit: tvMode ? 20 : 12,
      pool: 40,
      playlistId: playlist.id,
      kind,
      ...(usable ? { profile: usable.profile, detailsByItemId: usable.detailsByItemId } : {}),
    });
  }, [recsWanted, tvMode, rankingHistory, visibleAllMovies, playlist.id, taste, kind]);
  // Découvrir affiche « Pour toi » sans recharger le catalogue : on y mémorise le dernier calcul.
  useEffect(() => {
    if (!recsWanted || visibleAllMovies.length === 0) return;
    saveForYouSnapshot(playlist.id, recommendations.map(({ item, reasons, sourceId }) => ({
      id: item.id,
      name: item.name,
      availability: 'library',
      ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
      ...(item.poster ? { poster: item.poster } : {}),
      ...(item.categoryId ? { categoryId: item.categoryId } : {}),
      ...(reasons[0] ? { reason: reasons[0] } : {}),
      ...(sourceId ? { sourceId } : {}),
    })), kind);
  }, [recsWanted, visibleAllMovies.length, recommendations, playlist.id, kind]);
  // TV : première justification affichée dans la fiche éclair de l'affiche surlignée.
  const forYouReasons = useMemo(
    () => new Map(recommendations.flatMap(({ item, reasons }) => (reasons[0] ? [[item.id, reasons[0]] as const] : []))),
    [recommendations],
  );
  // Œuvres vues ici (au moins une minute ou terminées), importées ou possédées sur
  // USB/SD : sans elles, rien à suggérer. Le seuil s'applique au même type que le rail.
  const hasTasteSeed = useMemo(
    () => localWorks.some(w => w.kind === kind) || externalWatches.some(e => (e.mediaKind ?? 'movie') === kind) || vodHistory.map(historyScope).some(e => e.kind === 'vod' && e.playlistId === playlist.id && e.mediaKind === kind && (e.status === 'completed' || (e.positionMs || 0) >= 60000)),
    [localWorks, externalWatches, vodHistory, playlist.id, kind],
  );
  const forYouEmptyText = !hasTasteSeed
    ? `Aucun ${kind === 'movie' ? 'film' : 'épisode'} vu pour l’instant : lance ${kind === 'movie' ? 'un film' : 'une série'}, les suggestions apparaîtront ici.`
    : visibleAllMovies.length === 0
      ? 'Préparation des suggestions…'
      : 'Aucun titre du catalogue ne correspond encore à tes visionnages.';

  useEffect(() => {
    if (!account) return;
    const controller = new AbortController(); setError(''); setLoading(true); setCategory(null); setItems([]); setCategories([]); setCategoriesStatus('loading');
    void catalogRequest(account, kind === 'movie' ? 'get_vod_categories' : 'get_series_categories', {}, controller.signal)
      .then(parseCategories).then(rawValues => {
        // Une catégorie « test » du fournisseur n'apporte rien : elle encombre la
        // colonne TV et peut être vide. Les autres catégories restent intactes.
        const values = rawValues.filter(c => !/^test\b/i.test(c.name.trim()));
        if (controller.signal.aborted) return;
        setCategories(values);
        setCategoriesStatus('ready');
        // Enregistré seulement après une lecture réussie : une liste vide au montage ne doit
        // pas faire croire à la recherche globale qu'aucune catégorie n'est adulte.
        rememberVodCategories(playlist.id, kind, values);
        // Contrôle parental : la catégorie par défaut ne doit jamais être une catégorie verrouillée.
        const selectable = hideAdultRef.current ? values.filter(c => !isAdultGroupName(c.name)) : values;
        // Mode TV : retrouver la catégorie de la dernière visite si le catalogue la connaît encore.
        // Une ancienne valeur « toutes les catégories » est ignorée : elle déclenchait le
        // téléchargement complet du catalogue, qui figeait la box pendant plusieurs minutes.
        const fallback = selectable.find(c => /^FR\b|FRANCE/i.test(c.name))?.id || selectable[0]?.id || '';
        const stored = tvMode ? storedVodPosition(playlist.id, kind)?.category ?? null : null;
        setCategory(stored !== null && stored !== '' && selectable.some(c => c.id === stored) ? stored : fallback);
      })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setCategoriesStatus('error'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account, kind, reload, tvMode, playlist.id]);
  useEffect(() => {
    if (!account || category === null || category === '') return;
    const cacheKey = `${playlist.id}:${account.server}:${kind}:${category}`;
    const cached = categoryCatalogCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
      setItems(cached.items); setLoading(false); setError(''); setLimit(60); setSearch('');
      return;
    }
    const controller = new AbortController(); setLoading(true); setError(''); setItems([]); setLimit(60); setSearch('');
    void catalogRequest(account, kind === 'movie' ? 'get_vod_streams' : 'get_series', category ? { category_id: category } : {}, controller.signal)
      .then(data => parseCatalog(data, kind)).then(values => {
        if (!controller.signal.aborted) {
          categoryCatalogCache.set(cacheKey, { fetchedAt: Date.now(), items: values });
          while (categoryCatalogCache.size > 20) categoryCatalogCache.delete(categoryCatalogCache.keys().next().value!);
          setItems(values);
          // Pool des recommandations : ce qui a déjà été parcouru, sans jamais demander
          // les dizaines de milliers de titres du fournisseur en une seule requête.
          setAllMovies(previous => {
            if (!previous.length) return values;
            const known = new Set(previous.map(item => item.id));
            const added = values.filter(item => !known.has(item.id));
            return added.length ? [...previous, ...added] : previous;
          });
        }
      })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account, category, kind, playlist.id, reload]);
  useEffect(() => {
    setCurrentSub(null); setSubtitleEpisodeId(null);
    setDetails(null); setDetailError(''); setSeason('');
    if (!account || !selected) return;
    const controller = new AbortController();
    void catalogRequest(account, kind === 'movie' ? 'get_vod_info' : 'get_series_info', kind === 'movie' ? { vod_id: selected.id } : { series_id: selected.id }, controller.signal)
      .then(parseDetails).then(value => { if (!controller.signal.aborted) { setDetails(value); setSeason(value.episodes[0]?.season || ''); } })
      .catch(e => { if (!controller.signal.aborted) setDetailError(e.message); });
    return () => controller.abort();
  }, [account, selected, kind]);
  // TV : les épisodes d'une série (ou le bouton Regarder d'un film sans format annoncé
  // dans le catalogue) arrivent après l'ouverture de la fiche ; le focus y entre alors,
  // sauf si l'utilisateur a déjà commencé à naviguer. Le repère de navigation est la
  // première touche/pression après l'ouverture — pas l'élément focalisé : à l'ouverture,
  // le moteur global redirige lui-même le conteneur vers le premier contrôle de la fiche.
  const ficheNavSinceOpen = useRef(false);
  const ficheFocusPlaced = useRef(false);
  const lastSelected = useRef<CatalogItem | null>(null);
  useEffect(() => {
    if (lastSelected.current === selected) return;
    lastSelected.current = selected;
    ficheNavSinceOpen.current = false;
    ficheFocusPlaced.current = false;
    if (!selected) return;
    const mark = () => { ficheNavSinceOpen.current = true; };
    window.addEventListener('keydown', mark, { capture: true, once: true });
    window.addEventListener('pointerdown', mark, { capture: true, once: true });
    return () => {
      window.removeEventListener('keydown', mark, { capture: true });
      window.removeEventListener('pointerdown', mark, { capture: true });
    };
  }, [selected]);
  useEffect(() => {
    if (!tvMode || !selected || !details || ficheNavSinceOpen.current || ficheFocusPlaced.current) return;
    const el = document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]')?.querySelector<HTMLElement>('[data-remote-start]');
    if (!el || (el instanceof HTMLButtonElement && el.disabled)) return;
    ficheFocusPlaced.current = true;
    el.focus();
  }, [tvMode, selected, details]);
  // TV : le panneau de sous-titres s'ouvre depuis les options de l'épisode ; le focus
  // y entre pour régler la piste sans chercher la zone du regard.
  useEffect(() => {
    if (!tvMode || !subtitleEpisodeId) return;
    const root = document.querySelector<HTMLElement>('[role="dialog"][data-state="open"] [data-tv-subtitles]');
    const first = root?.querySelector<HTMLElement>('button, input, select');
    first?.focus();
  }, [tvMode, subtitleEpisodeId]);

  const baseItems = useMemo(() => {
    if (tvMode && showForYou) return recommendations.map(r => r.item);
    if (!showWatchlistOnly) return visibleItems;
    return visibleWatchlist.map(w => ({
      id: w.id,
      name: w.name,
      poster: w.poster ?? '',
      rating: w.rating ?? '',
      categoryId: w.categoryId ?? '',
      extension: w.extension ?? '',
    }));
  }, [tvMode, showForYou, recommendations, showWatchlistOnly, visibleItems, visibleWatchlist]);
  // TV : l'affiche mémorisée peut se trouver au-delà de la première page (60 titres) ;
  // la limite est étendue dès ce rendu — synchronisée avec le catalogue — pour que la
  // demande de restauration de TvVodScreen trouve sa cible au premier affichage.
  const [restoredItemId] = useState(() => (tvMode ? storedVodPosition(playlist.id, kind)?.itemId : undefined));
  const tvLimit = useMemo(() => {
    if (!restoredItemId) return limit;
    const index = baseItems.findIndex(item => item.id === restoredItemId);
    if (index < 0) return limit;
    return Math.max(limit, Math.ceil((index + 1) / 60) * 60);
  }, [restoredItemId, baseItems, limit]);
  // Index de recherche : nom en minuscules pré-calculé une fois par catalogue,
  // requête débouncée — la saisie reste fluide même avec des milliers de titres.
  const searchIndex = useMemo(
    () => baseItems.map(item => ({ item, lower: item.name.toLocaleLowerCase() })),
    [baseItems],
  );
  const debouncedSearch = useDebounce(search, 150);
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLocaleLowerCase();
    if (!q) return searchIndex.map(({ item }) => item);
    return searchIndex.filter(({ lower }) => lower.includes(q)).map(({ item }) => item);
  }, [searchIndex, debouncedSearch]);
  const mediaKey = (id: string) => `${playlist.id}:${kind}:${id}`;
  // Reprise lue une seule fois par titre et partagée par le libellé ET le bouton « Depuis le
  // début » : la fiche interroge le film et chaque épisode de la saison à chaque rendu.
  const cachedProgress = useCallback((id: string): { label: string; saved: boolean } => {
    const cache = progressCache.current;
    const cached = cache.get(id);
    if (cached) return cached;
    const saved = readVodProgress(mediaKey(id));
    const entry = { label: saved ? `Reprendre à ${Math.floor(saved.positionMs / 60000)} min` : 'Regarder', saved: !!saved };
    cache.set(id, entry);
    return entry;
    // mediaKey ne dépend que de playlist.id et kind, stables pour la vie du composant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const progressLabel = useCallback((id: string) => cachedProgress(id).label, [cachedProgress]);
  const play = async (id: string, ext: string, title: string, restart = false, ctx?: { name?: string; poster?: string; seriesId?: string; categoryId?: string }) => {
    if (!account || busy) return;
    // Contrôle parental : tant que les catégories ne sont pas lues, le verdict d'un
    // titre enregistré (ou repris) est inconnu — la lecture est refusée plutôt que
    // laissée passer. Le catalogue relancé restaurera la liste et la lecture.
    if (hideAdult && categoriesStatus !== 'ready') {
      toast.error('Contrôle parental : vérification du catalogue en cours. Réessaie dans un instant.');
      return;
    }
    try {
      const url = vodUrl(account, kind, id, ext), key = mediaKey(id);
      // Historique de lecture (recommandations « Pour toi ») : titre de la série pour un épisode.
      // ctx reporte la série d'un épisode lancé automatiquement (la fiche est fermée).
      const seriesRef = ctx || (selected ? { name: selected.name, poster: selected.poster, seriesId: selected.id, categoryId: selected.categoryId } : undefined);
      const entryName = kind === 'series' && seriesRef?.name ? seriesRef.name : title;
      const entryYear = normalizeTitle(entryName).year;
      const entryTmdbId = selected?.tmdbId || details?.tmdbId;

      // Prochain épisode de la saison (chemin natif et web partagent ce calcul).
      const seasonEpisodes = (kind === 'series' && details?.episodes)
        ? details.episodes.filter(e => e.season === season && e.extension)
        : [];
      const episodeIdx = seasonEpisodes.findIndex(e => e.id === id);
      const currentEpisode = kind === 'series' && episodeIdx >= 0 ? seasonEpisodes[episodeIdx] : undefined;
      const parsedSeason = parseInt(season, 10);
      const currentSeasonNum = kind === 'series' ? (Number.isNaN(parsedSeason) ? (currentEpisode?.season ? parseInt(currentEpisode.season, 10) || undefined : undefined) : parsedSeason) : undefined;
      const currentEpisodeNum = currentEpisode?.number;

      await pushPlayHistory({
        channelId: `vod:${playlist.id}:${kind}:${id}`,
        ts: Date.now(),
        kind: 'vod', playlistId: playlist.id, mediaKind: kind, status: 'started',
        name: entryName,
        ...(seriesRef?.poster ? { poster: seriesRef.poster } : {}),
        ...(kind === 'series' ? { episodeName: title } : {}),
        ...(kind === 'series' && seriesRef?.seriesId ? { seriesId: seriesRef.seriesId } : {}),
        ...(seriesRef?.categoryId ? { categoryId: seriesRef.categoryId } : {}),
        ...(entryYear ? { year: entryYear } : {}),
        ...(entryTmdbId ? { tmdbId: entryTmdbId } : {}),
        ...(currentSeasonNum !== undefined ? { season: currentSeasonNum } : {}),
        ...(currentEpisodeNum !== undefined ? { episode: currentEpisodeNum } : {}),
      }).catch(() => { /* l'historique ne doit jamais bloquer la lecture */ });
      const nextEpisode = (kind === 'series' && episodeIdx >= 0 && episodeIdx + 1 < seasonEpisodes.length)
        ? seasonEpisodes[episodeIdx + 1]
        : undefined;
      if (NativePlayerBridge.isAvailable()) {
        setBusy(true);
        const eligibleSub = kind === 'movie' || subtitleEpisodeId === id ? currentSub : null;
        const subOpt = eligibleSub?.url || eligibleSub?.srtContent ? {
          ...(eligibleSub.url ? { url: eligibleSub.url } : {}),
          ...(eligibleSub.srtContent ? { content: eligibleSub.srtContent } : {}),
        } : undefined;
        const zapContext = (kind === 'series' && seasonEpisodes.length > 1 && episodeIdx >= 0) ? {
          urls: seasonEpisodes.map(e => vodUrl(account, 'series', e.id, e.extension)),
          titles: seasonEpisodes.map(e => `${e.number}. ${e.name}`),
          ids: seasonEpisodes.map(e => mediaKey(e.id)),
          index: episodeIdx,
          history: seasonEpisodes.map(e => {
            const epSeasonNum = parseInt(e.season, 10) || undefined;
            return {
              mediaId: mediaKey(e.id),
              name: selected?.name || e.name,
              seriesId: selected?.id,
              poster: selected?.poster,
              episodeName: e.name,
              ...(epSeasonNum !== undefined ? { season: epSeasonNum } : {}),
              ...(e.number !== undefined ? { episode: e.number } : {}),
              ...(entryTmdbId ? { tmdbId: entryTmdbId } : {}),
              ...(entryYear ? { year: entryYear } : {}),
            };
          }),
        } : undefined;
        // Suivre l'épisode joué pour la recherche de sous-titres (saison + épisode).
        if (subOpt || zapContext) {
          await NativePlayerBridge.openVod(url, title, key, restart, subOpt, zapContext);
        } else {
          await NativePlayerBridge.openVod(url, title, key, restart);
        }
      } else {
        setSelected(null);
        setPlaying({
          url,
          title,
          mediaId: key,
          restart,
          name: entryName,
          mediaKind: kind,
          ...(kind === 'series' ? { episodeName: title } : {}),
          ...(currentSeasonNum !== undefined ? { season: currentSeasonNum } : {}),
          ...(currentEpisodeNum !== undefined ? { episode: currentEpisodeNum } : {}),
          ...(entryTmdbId ? { tmdbId: entryTmdbId } : {}),
          ...(entryYear ? { year: entryYear } : {}),
          ...(currentSub?.vttContent && (kind === 'movie' || subtitleEpisodeId === id) ? { subtitleVtt: currentSub.vttContent } : {}),
        });
        setQueueNext(nextEpisode ? {
          id: nextEpisode.id,
          ext: nextEpisode.extension,
          title: `${nextEpisode.number}. ${nextEpisode.name}`,
          name: nextEpisode.name,
          ...(seriesRef ? {
            ctx: {
              ...(seriesRef.name ? { name: seriesRef.name } : {}),
              ...(seriesRef.poster ? { poster: seriesRef.poster } : {}),
              ...(seriesRef.seriesId ? { seriesId: seriesRef.seriesId } : {}),
              ...(seriesRef.categoryId ? { categoryId: seriesRef.categoryId } : {}),
            },
          } : {}),
        } : null);
        setAutoNextCountdown(null);
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Lecture indisponible.'); }
    finally { setBusy(false); }
  };

  // Fin de lecture web : si un épisode suit et que le réglage l'autorise,
  // compte à rebours de 5 s avant de l'enchaîner (annulable).
  const handleWebEnded = () => {
    if (autoNextEnabled && queueNext) setAutoNextCountdown(5);
  };
  useEffect(() => {
    if (autoNextCountdown === null || !queueNext) return;
    if (autoNextCountdown <= 0) {
      const next = queueNext;
      setAutoNextCountdown(null);
      setQueueNext(null);
      void play(next.id, next.ext, next.name, false, next.ctx);
      return;
    }
    const timer = window.setTimeout(() => setAutoNextCountdown(current => (current === null ? null : current - 1)), 1000);
    return () => window.clearTimeout(timer);
    // play lit le catalogue courant ; il n'est pas une dépendance stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNextCountdown, queueNext]);

  // Reprise depuis « Continuer » : ouvre directement la lecture du titre en cours.
  useEffect(() => {
    if (!account || !resumeRequest || resumeRequest.kind !== kind || handledRequest.current === resumeRequest.nonce) return;
    const controller = new AbortController();
    const consume = () => { handledRequest.current = resumeRequest.nonce; onResumeHandled?.(); };
    if (resumeRequest.mode === 'details' && resumeRequest.item) {
      const item = resumeRequest.item;
      setSelected({ id: item.id, name: item.name, poster: item.poster || '', categoryId: item.categoryId || '', extension: item.extension || '', rating: item.rating || '' });
      consume();
      return;
    }
    if (kind === 'movie' && resumeRequest.id) {
      void catalogRequest(account, 'get_vod_info', { vod_id: resumeRequest.id }, controller.signal)
        .then(parseDetails)
        .then(details => {
          if (controller.signal.aborted) return;
          consume();
          if (details.extension) {
            void play(resumeRequest.id!, details.extension, resumeRequest.name || 'Vidéo', false);
          } else toast.error('Le fournisseur n’a pas indiqué de format de lecture.');
        })
        .catch(() => { if (!controller.signal.aborted) { consume(); toast.error('Impossible de retrouver ce film. Réessaie depuis son catalogue.'); } });
    }
    if (kind === 'series' && resumeRequest.name) {
      // L'id de l'historique désigne un épisode ; le catalogue attend l'id de la série.
      void catalogRequest(account, 'get_series', {}, controller.signal).then(data => {
        if (controller.signal.aborted) return;
        const catalog = parseCatalog(data, 'series');
        const matches = resumeRequest.seriesId
          ? catalog.filter(item => item.id === resumeRequest.seriesId)
          : catalog.filter(item => normalizeForCompare(item.name) === normalizeForCompare(resumeRequest.name || ''));
        if (matches.length !== 1) throw new Error();
        pendingResume.current = resumeRequest.id || null;
        setSelected(matches[0]);
        consume();
      }).catch(() => { if (!controller.signal.aborted) { consume(); toast.error('Impossible de retrouver cette série sans ambiguïté. Ouvre sa fiche dans le catalogue.'); } });
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, kind, resumeRequest]);

  useEffect(() => {
    const episode = details?.episodes.find(e => e.id === pendingResume.current);
    if (!episode) return;
    pendingResume.current = null;
    setSeason(episode.season);
    // Le contexte et les sous-titres de la bonne saison sont prêts au prochain rendu.
    setResumeEpisode(episode.id);
  }, [details]);
  const [resumeEpisode, setResumeEpisode] = useState<string | null>(null);
  useEffect(() => {
    if (!resumeEpisode || !details) return;
    const episode = details.episodes.find(e => e.id === resumeEpisode);
    setResumeEpisode(null);
    if (episode?.extension) void play(episode.id, episode.extension, episode.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeEpisode, season, details]);
  // Fin de lecture web : la fiche a été fermée pour jouer, Radix n'a plus d'élément
  // d'origine vers lequel restaurer le focus — il revient à la cible itinérante de
  // l'écran catalogue (cellule surlignée de la grille).
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (playing) { wasPlaying.current = true; return; }
    if (!tvMode || !wasPlaying.current) return;
    wasPlaying.current = false;
    requestAnimationFrame(() => {
      const screen = document.querySelector<HTMLElement>('[data-tv-vod]');
      if (!screen) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && screen.contains(active)) return;
      screen.querySelector<HTMLElement>('[data-tv-item][tabindex="0"]')?.focus();
    });
  }, [playing, tvMode]);

  // Réglages (sous-titres) : la clé locale `iptv_settings` n'est plus écrite depuis la
  // migration vers IndexedDB — partir du cache puis charger les vrais réglages au montage.
  const [settings, setSettings] = useState(() => StorageManager.getCachedSettings());
  useEffect(() => {
    let cancelled = false;
    void StorageManager.loadSettingsAsync().then(s => { if (!cancelled) setSettings(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Mode TV : actions de l'écran télécommande (TvVodScreen) ; fiches et lecture restent partagées.
  const handleSelectCategory = useCallback((id: string) => { if (!id) return; setCategory(id); setShowWatchlistOnly(false); setShowForYou(false); }, []);
  const toggleWatchlistOnly = useCallback(() => { setShowForYou(false); setShowWatchlistOnly(v => !v); }, []);
  const toggleForYou = useCallback(() => { setShowWatchlistOnly(false); setShowForYou(v => !v); }, []);
  const handleRefresh = useCallback(() => { categoryCatalogCache.clear(); setAllMovies([]); setReload(v => v + 1); }, []);
  // « Afficher davantage » étend la limite EFFECTIVE : après une restauration au-delà
  // de 60 titres (affiche mémorisée au titre 85 ⇒ 120 affichés), la limite de base est
  // déjà dépassée et « +60 » depuis elle ne montrerait rien de plus.
  const handleLoadMore = useCallback(() => setLimit(v => Math.max(v, tvLimit) + 60), [tvLimit]);
  // Fiche série TV (TvSeriesFiche) : ajout/retrait de Ma Liste sans rouvrir le catalogue.
  const toggleWatchlistItem = useCallback(async (item: CatalogItem) => {
    const added = await toggleVodWatchlist({
      id: item.id,
      name: item.name,
      kind,
      playlistId: playlist.id,
      ...(item.poster ? { poster: item.poster } : {}),
      ...(item.rating ? { rating: item.rating } : {}),
      ...(item.categoryId ? { categoryId: item.categoryId } : {}),
      ...(item.extension ? { extension: item.extension } : {}),
      ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
    });
    toast.success(added ? 'Ajouté à Ma Liste' : 'Retiré de Ma Liste');
  }, [kind, playlist.id]);
  if (!account && tvMode) {
    const actions: TvStarterAction[] = [
      ...(onConnect ? [{ key: 'connect', label: 'Connecter un abonnement', hint: 'Serveur, identifiant et mot de passe de ton fournisseur', Icon: ListVideo, onSelect: onConnect }] : []),
      ...(onShowLocal ? [{ key: 'local', label: 'Lire une clé USB ou une carte SD', hint: 'Tes propres films, sans abonnement', Icon: HardDrive, onSelect: onShowLocal }] : []),
    ];
    return <TvStarter
      eyebrow="Pas encore de catalogue"
      title={kind === 'movie' ? 'Les films viennent de ton abonnement' : 'Les séries viennent de ton abonnement'}
      text={`Aucun catalogue de films ou séries associé à la liste « ${playlist.name} ». Connecte un abonnement Xtream pour voir ici ${kind === 'movie' ? 'ses films' : 'ses séries'}.`}
      actions={actions}
    />;
  }
  if (!account) return <section className="space-y-3 text-white"><h2 className="text-xl font-semibold">{kind === 'movie' ? 'Films' : 'Séries'}</h2><p className="text-neutral-300">Pour accéder au catalogue, importe ta liste depuis « Ajouter » → « Connexion Xtream ». Les identifiants doivent correspondre à la liste active.</p></section>;
  // Fiche série TV : détails en haut, puis saison / épisodes / options pilotés par
  // TvSeriesFiche (une seule règle Haut-Bas-Gauche-Droite). Le reste de la fiche
  // partagée garde sa mise en page mobile.
  const tvSeriesFiche = tvMode && kind === 'series' && !shownTitle;
  const ficheDialog = <Dialog open={!!selected} onOpenChange={open => { if (!open) { setSelected(null); onCloseDetails?.(); } }}><DialogContent
    onOpenAutoFocus={e => {
      // Mode TV : le focus entre par le bouton principal (lecture), pas par la croix de
      // fermeture. S'il n'existe pas encore (épisodes en cours de chargement), le
      // conteneur porte le focus ; l'effet de chargement le placera à leur arrivée.
      if (!tvMode) return;
      e.preventDefault();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]');
      const el = dialog?.querySelector<HTMLElement>('[data-remote-start]');
      if (el && !(el instanceof HTMLButtonElement && el.disabled)) { ficheFocusPlaced.current = true; el.focus(); return; }
      dialog?.focus();
    }}
    onCloseAutoFocus={e => {
      // TV : refermer la fiche rend la main à l'affiche ouverte dans la grille,
      // pas aux rubriques du haut — sinon il faut redescendre à chaque titre.
      if (!tvMode) return;
      const el = document.querySelector<HTMLElement>('[data-tv-vod] [data-tv-item][tabindex="0"]');
      if (!el) return;
      e.preventDefault();
      el.focus();
    }}
    // grid-cols-1 = minmax(0, 1fr) : sans lui, la rangée « Films similaires » (cartes
    // non rétrécissables) élargit la colonne implicite et pousse toute la fiche hors écran.
    className={tvSeriesFiche
      ? 'flex h-[90dvh] max-h-[90dvh] flex-col gap-3 overflow-hidden bg-neutral-950 text-white border-neutral-900 p-4 sm:p-6 sm:max-w-3xl'
      : 'grid-cols-1 bg-neutral-950 text-white border-neutral-900 max-h-[90dvh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 sm:max-w-2xl'}><DialogHeader><DialogTitle className="flex items-center gap-2">{selected && !shownTitle && matchStreamingPlatformOrNetwork(selected.name) && <PlatformLogo platformId={matchStreamingPlatformOrNetwork(selected.name)} size="sm" className="h-5 w-5 rounded" />}<span className="truncate">{shownTitle ? shownTitle.title : selected?.name}</span></DialogTitle><DialogDescription>{shownTitle ? 'Titre recommandé, absent de ta playlist' : kind === 'movie' ? 'Fiche du film et lecture' : 'Saisons et épisodes'}</DialogDescription></DialogHeader>
    {selected && !shownTitle && forYouReasons.get(selected.id) && <p className="text-xs text-primary">{forYouReasons.get(selected.id)}</p>}
    {tvSeriesFiche && selected ? <>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm text-neutral-300">
        {details && <p>{[details.releaseDate, details.duration].filter(Boolean).join(' · ')}</p>}
        {details?.plot?.trim() ? <p className="whitespace-pre-line">{details.plot}</p> : !details && !detailError && <p role="status">Chargement de la fiche…</p>}
        {detailError && <p role="alert" className="text-amber-300">{detailError}</p>}
        {details?.director && <p>Réalisation : {details.director}</p>}
        {details?.cast && <p>Avec : {details.cast}</p>}
        <TmdbPanel
          compact
          name={selected.name}
          year={details?.releaseDate.match(/\d{4}/)?.[0] || normalizeTitle(selected.name).year}
          tmdbId={details?.tmdbId || selected.tmdbId}
          sheetKey={selected.id}
          onActiveChange={setTmdbTitle}
          kind={kind}
          apiKey={tmdbApiKey}
          region={normalizeWatchRegion(settings.watchRegion)}
          providerIds={settings.watchProviderIds ?? []}
          catalogItems={allMovies.length > 0 ? allMovies : items}
          onOpenItem={setSelected}
          provided={details || detailError
            ? { overview: !!details?.plot?.trim(), director: !!details?.director?.trim(), cast: !!details?.cast?.trim() }
            : { overview: true, director: true, cast: true }}
        />
        {settings.subtitlesEnabled !== false && subtitleEpisodeId && (
          <div data-tv-subtitles className="rounded-lg border border-neutral-800 p-2">
            <SubtitleSelector
              key={`${selected.id}:${subtitleEpisodeId || 'movie'}`}
              mediaTitle={selected.name}
              year={details?.releaseDate.match(/\d{4}/)?.[0] || normalizeTitle(selected.name).year}
              kind={kind}
              season={season ? parseInt(season, 10) : undefined}
              episode={details?.episodes.find(e => e.id === subtitleEpisodeId)?.number}
              mediaKey={mediaKey(subtitleEpisodeId || selected.id)}
              autoTranslate={settings.subtitleAutoTranslate !== false}
              apiKeys={{
                openSubtitlesApiKey: settings.openSubtitlesApiKey ?? '',
                deeplApiKey: settings.deeplApiKey ?? '',
                subdlApiKey: settings.subdlApiKey ?? '',
              }}
              targetLang={settings.subtitlePreferredLang || 'fr'}
              onSubtitleReady={setCurrentSub}
            />
          </div>
        )}
      </div>
      {details && details.episodes.length > 0
        ? <div className="h-[46%] min-h-[240px] shrink-0">
          <TvSeriesFiche
            episodes={details.episodes}
            season={season}
            onSeasonChange={setSeason}
            watchlisted={watchlistIds.has(selected.id)}
            onToggleWatchlist={() => void toggleWatchlistItem(selected)}
            subtitlesEnabled={settings.subtitlesEnabled !== false}
            subtitleEpisodeId={subtitleEpisodeId}
            onSubtitles={episode => { setCurrentSub(null); setSubtitleEpisodeId(episode.id); }}
            onPlay={(episode, restart) => { if (episode.extension) void play(episode.id, episode.extension, episode.name, restart); }}
            progress={cachedProgress}
            busy={busy}
          />
        </div>
        : <p className="text-sm text-muted-foreground">{details ? 'Aucun épisode fourni pour cette série.' : detailError ? '' : 'Chargement des épisodes…'}</p>}
    </> : <>
    {selected && !shownTitle && (
      <div className="flex items-center gap-2 pt-1 pb-1">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const wlTmdbId = selected.tmdbId || details?.tmdbId;
            const added = await toggleVodWatchlist({
              id: selected.id,
              name: selected.name,
              kind,
              playlistId: playlist.id,
              ...(selected.poster ? { poster: selected.poster } : {}),
              ...(selected.rating ? { rating: selected.rating } : {}),
              ...(selected.categoryId ? { categoryId: selected.categoryId } : {}),
              ...(selected.extension ? { extension: selected.extension } : {}),
              ...(wlTmdbId ? { tmdbId: wlTmdbId } : {}),
            });
            toast.success(added ? 'Ajouté à Ma Liste' : 'Retiré de Ma Liste');
          }}
          className="border-neutral-800 text-white hover:bg-neutral-900"
        >
          {watchlistIds.has(selected.id) ? (
            <>
              <BookmarkCheck className="h-4 w-4 mr-1.5 text-primary" />
              Dans ma liste
            </>
          ) : (
            <>
              <Bookmark className="h-4 w-4 mr-1.5" />
              Ajouter à ma liste
            </>
          )}
        </Button>
      </div>
    )}
    {!details && !detailError && !shownTitle && <p role="status">Chargement de la fiche…</p>}
    {detailError && !shownTitle && <p role="alert" className="text-amber-300">{detailError}</p>}
    {details && !shownTitle && <div className="space-y-3 text-sm text-neutral-300"><p>{[details.releaseDate, details.duration].filter(Boolean).join(' · ')}</p>{details.plot?.trim() ? <p className="whitespace-pre-line">{details.plot}</p> : !tmdbApiKey?.trim() && <p>Synopsis non fourni.</p>}{details.director && <p>Réalisation : {details.director}</p>}{details.cast && <p>Avec : {details.cast}</p>}</div>}
    {selected && (
      <TmdbPanel
        name={selected.name}
        year={details?.releaseDate.match(/\d{4}/)?.[0] || normalizeTitle(selected.name).year}
        tmdbId={details?.tmdbId || selected.tmdbId}
        sheetKey={selected.id}
        onActiveChange={setTmdbTitle}
        kind={kind}
        apiKey={tmdbApiKey}
        region={normalizeWatchRegion(settings.watchRegion)}
        providerIds={settings.watchProviderIds ?? []}
        catalogItems={allMovies.length > 0 ? allMovies : items}
        onOpenItem={setSelected}
        // Tant que la fiche du fournisseur n'est pas arrivée, on la suppose complète :
        // évite d'afficher le synopsis TMDB puis de le retirer une fraction de seconde après.
        provided={details || detailError
          ? { overview: !!details?.plot?.trim(), director: !!details?.director?.trim(), cast: !!details?.cast?.trim() }
          : { overview: true, director: true, cast: true }}
      />
    )}
    {selected && !shownTitle && settings.subtitlesEnabled !== false && (kind === 'movie' || subtitleEpisodeId) && (
      <SubtitleSelector
        key={`${selected.id}:${subtitleEpisodeId || 'movie'}`}
        mediaTitle={selected.name}
        year={details?.releaseDate.match(/\d{4}/)?.[0] || normalizeTitle(selected.name).year}
        kind={kind}
        season={season ? parseInt(season, 10) : undefined}
        episode={details?.episodes.find(e => e.id === subtitleEpisodeId)?.number}
        mediaKey={mediaKey(subtitleEpisodeId || selected.id)}
        autoTranslate={settings.subtitleAutoTranslate !== false}
        apiKeys={{
          openSubtitlesApiKey: settings.openSubtitlesApiKey ?? '',
          deeplApiKey: settings.deeplApiKey ?? '',
          subdlApiKey: settings.subdlApiKey ?? '',
        }}
        targetLang={settings.subtitlePreferredLang || 'fr'}
        onSubtitleReady={setCurrentSub}
      />
    )}
    {kind === 'movie' && selected && !shownTitle && <div className="flex flex-wrap gap-2"><Button data-remote-start disabled={busy || !(details?.extension || selected.extension)} onClick={() => void play(selected.id, details?.extension || selected.extension, selected.name)}>{progressLabel(selected.id)}</Button>{cachedProgress(selected.id).saved && <Button variant="secondary" disabled={busy} onClick={() => void play(selected.id, details?.extension || selected.extension, selected.name, true)}>Depuis le début</Button>}</div>}
    {kind === 'movie' && details && !shownTitle && !details.extension && !selected?.extension && <p className="text-amber-300">Le fournisseur n’a pas indiqué de format de lecture.</p>}
    {kind === 'series' && details && !shownTitle && <div className="space-y-3">
      {details.episodes.length === 0 ? <p>Aucun épisode fourni pour cette série.</p> : <><select aria-label="Saison" className="w-full bg-neutral-900 p-3 rounded-md" value={season} onChange={e => setSeason(e.target.value)}>{[...new Set(details.episodes.map(e => e.season))].map(s => <option key={s} value={s}>Saison {s}</option>)}</select><div className="space-y-2">{details.episodes.filter(e => e.season === season).map((e, idx) => <div key={e.id} className="bg-white/5 rounded-lg p-3 space-y-2"><p>{e.number}. {e.name}</p>{e.plot && <p className="text-xs text-neutral-400 line-clamp-3">{e.plot}</p>}<div className="flex flex-wrap gap-2">{settings.subtitlesEnabled !== false && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCurrentSub(null); setSubtitleEpisodeId(e.id); }}>Sous-titres épisode {e.number}</Button>}<Button size="sm" disabled={busy || !e.extension} {...(idx === 0 ? { 'data-remote-start': true } : {})} onClick={() => void play(e.id, e.extension, e.name)}>{progressLabel(e.id)}</Button>{cachedProgress(e.id).saved && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void play(e.id, e.extension, e.name, true)}>Depuis le début</Button>}</div>{!e.extension && <p className="text-xs text-amber-300">Format non fourni.</p>}</div>)}</div></>}
    </div>}
    </>}
  </DialogContent></Dialog>;
  const playingDialog = <Dialog open={!!playing} onOpenChange={open => { if (!open) { setPlaying(null); setQueueNext(null); setAutoNextCountdown(null); onCloseDetails?.(); } }}><DialogContent className="bg-neutral-950 text-white sm:max-w-4xl"><DialogHeader><DialogTitle>Lecture</DialogTitle><DialogDescription>Pause, déplacement et reprise de lecture.</DialogDescription></DialogHeader>{playing && <div className="relative">
    {autoNextCountdown !== null && queueNext && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center" data-testid="next-episode-overlay">
      <p className="text-sm">Épisode suivant : <span className="font-semibold">{queueNext.title}</span> dans {autoNextCountdown} s</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setAutoNextCountdown(0)}>Lire maintenant</Button>
        <Button size="sm" variant="outline" onClick={() => setAutoNextCountdown(null)}>Annuler</Button>
      </div>
    </div>}
    <WebVodPlayer key={playing.url} {...playing} onEnded={handleWebEnded} />
  </div>}</DialogContent></Dialog>;
  // Mode TV : l'écran télécommande remplace la mise en page mobile ; fiches et lecture restent partagées.
  if (tvMode) return <section>
    <TvVodScreen
      kind={kind}
      playlistId={playlist.id}
      categories={visibleCategories}
      category={category}
      onSelectCategory={handleSelectCategory}
      items={baseItems.slice(0, tvLimit)}
      loading={showForYou ? false : loading}
      error={showForYou ? '' : error}
      onRetry={handleRefresh}
      hasMore={baseItems.length > tvLimit}
      onLoadMore={handleLoadMore}
      showWatchlistOnly={showWatchlistOnly}
      onToggleWatchlistOnly={toggleWatchlistOnly}
      showForYou={showForYou}
      onToggleForYou={toggleForYou}
      forYouEmptyText={forYouEmptyText}
      watchlistCount={visibleWatchlist.length}
      watchlistIds={watchlistIds}
      onOpen={setSelected}
      onRefresh={handleRefresh}
      onSearch={onSearch}
      onShowLocal={onShowLocal}
      progress={cachedProgress}
    />
    {ficheDialog}
    {playingDialog}
  </section>;
  return <section className="text-white space-y-4">
    {!tvMode && <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[17px] font-semibold tracking-tight text-foreground">Pour toi, d'après tes visionnages</h3>
        <ExternalWatchDialog watches={externalWatches} onChanged={reloadExternal} />
      </div>
      {(() => {
        const sameKindExternal = externalWatches.filter(entry => (entry.mediaKind ?? 'movie') === kind);
        const sameKindLocal = localWorks.filter(work => work.kind === kind);
        if (!sameKindExternal.length && !sameKindLocal.length) return null;
        return <p className="text-[11px] leading-tight text-neutral-500">
          {[
            sameKindExternal.length > 0 ? externalSummary(sameKindExternal) : '',
            sameKindLocal.length > 0 ? `${sameKindLocal.length} titre${sameKindLocal.length > 1 ? 's' : ''} de ta bibliothèque USB/SD` : '',
          ].filter(Boolean).join(' · ')}
          {taste && taste.playlistId === playlist.id && taste.externalSampleSize + taste.localSampleSize > 0
            ? ` · ${taste.externalSampleSize + taste.localSampleSize} fiche(s) TMDB ajoutée(s) au profil`
            : ''}
        </p>;
      })()}
      {recommendations.length > 0
        ? <div className="rail flex snap-x gap-3 overflow-x-auto pb-1">
          {recommendations.map(({ item, reasons }) => <button key={item.id} onClick={() => setSelected(item)} className="poster press w-28 shrink-0 snap-start text-left rounded-xl overflow-hidden bg-card border border-neutral-900" title={reasons.length ? `${item.name} — ${reasons.join(' · ')}` : item.name}>
            <div className="relative aspect-[2/3] overflow-hidden bg-neutral-900 flex items-center justify-center"><VodPoster src={item.poster} kind={kind} /></div>
            <div className="p-1.5"><p className="text-[11px] leading-tight line-clamp-2">{item.name}</p>{item.rating && <p className="text-[10px] text-neutral-400">★ {item.rating}</p>}{reasons[0] && <p className="text-[10px] leading-tight text-neutral-500 line-clamp-1">{reasons[0]}</p>}</div>
          </button>)}
        </div>
        : <p className="text-xs text-neutral-400">{forYouEmptyText}</p>}
    </div>}
    {/* Une seule ligne, même sur téléphone : catégorie, Ma Liste, Actualiser. */}
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <select aria-label="Catégorie VOD" className="bg-neutral-900 p-3 rounded-md w-full" value={category || ''} onChange={e => { if (!e.target.value) return; setCategory(e.target.value); setShowWatchlistOnly(false); }}>{visibleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <Button
        variant={showWatchlistOnly ? 'default' : 'outline'}
        onClick={toggleWatchlistOnly}
        aria-label={`Ma Liste (${visibleWatchlist.length})`}
        className={`min-h-11 shrink-0 px-3 ${showWatchlistOnly ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : 'border-neutral-800 text-white hover:bg-neutral-900'}`}
        aria-pressed={showWatchlistOnly}
        title="Afficher uniquement les titres de Ma Liste"
      >
        {showWatchlistOnly ? <BookmarkCheck className="h-4 w-4 sm:mr-1.5 text-primary" /> : <Bookmark className="h-4 w-4 sm:mr-1.5" />}
        <span className="hidden sm:inline">Ma Liste&nbsp;</span><span className="ml-1 sm:ml-0 tabular-nums">{visibleWatchlist.length}</span>
      </Button>
      <Button variant="outline" size="icon" onClick={handleRefresh} disabled={loading} aria-label="Actualiser le catalogue" title="Actualiser le catalogue" className="h-11 w-11 shrink-0 border-neutral-800 text-white hover:bg-neutral-900">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
      </Button>
    </div>
    {category && (() => {
      const selectedCat = visibleCategories.find(c => c.id === category);
      const matched = selectedCat ? matchStreamingPlatformOrNetwork(selectedCat.name) : null;
      if (!matched) return null;
      return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-neutral-800">
          <PlatformLogo platformId={matched} size="sm" className="h-6 w-6 rounded" />
          <span className="text-xs text-neutral-300 font-medium">Contenu {selectedCat?.name}</span>
        </div>
      );
    })()}
    <Input aria-label="Rechercher un titre" placeholder="Rechercher dans cette catégorie…" value={search} onChange={e => { setSearch(e.target.value); setLimit(60); }} />
    {loading && <p role="status">Chargement du catalogue…</p>}
    {error && <div role="alert" className="space-y-2 text-amber-300"><p>{error}</p><Button variant="secondary" onClick={() => setReload(v => v + 1)}>Réessayer</Button></div>}
    {!loading && !error && <p className="text-sm text-neutral-400">{filtered.length ? `${filtered.length} titres` : 'Aucun titre dans cette sélection.'}</p>}
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">{filtered.slice(0, limit).map(item => <button key={item.id} onClick={() => setSelected(item)} className="poster press text-left rounded-xl overflow-hidden bg-card border border-neutral-900 focus-visible:outline-none focus-visible:ring-2 ring-primary">
      <div className="relative aspect-[2/3] overflow-hidden bg-neutral-900 flex items-center justify-center"><VodPoster src={item.poster} kind={kind} />{watchlistIds.has(item.id) && <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-1 z-10" title="Dans ma liste"><Bookmark className="h-3 w-3 fill-current" /></div>}</div>
      <div className="p-2"><p className="text-xs sm:text-sm line-clamp-2">{item.name}</p>{item.rating && <p className="text-xs text-neutral-400">★ {item.rating}</p>}</div>
    </button>)}</div>
    {filtered.length > limit && <Button variant="secondary" onClick={() => setLimit(v => v + 60)}>Afficher davantage</Button>}
    {ficheDialog}
    {playingDialog}
  </section>;
}
