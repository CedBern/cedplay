import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TvVodScreen, storedVodPosition } from '@/components/TvVodScreen';
import { VodPoster } from '@/components/VodPoster';
import type { PlaylistInfo } from '@/types/channel';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { getPlaybackUrl } from '@/hooks/useVideoPlayer';
import { onPlaybackDelegated } from '@/utils/playbackOwnership';
import { catalogRequest, getXtreamAccount, parseCatalog, parseCategories, parseDetails, readVodProgress, saveVodProgress, vodUrl, type CatalogCategory, type CatalogDetails, type CatalogItem } from '@/utils/xtreamCatalog';
import { getPlayHistory, getExternalWatches, pushPlayHistory, updateVodHistoryProgress, historyScope, getVodWatchlistFromDB, toggleVodWatchlist, type PlayHistoryEntry, type VodWatchlistItem } from '@/utils/idb';
import { recommendForHistory } from '@/utils/recommendations';
import { enrichRecommendations, type TasteEnrichment } from '@/utils/tasteEnrichment';
import { externalSeeds, externalSummary } from '@/utils/externalWatch';
import { ExternalWatchDialog } from '@/components/ExternalWatchDialog';
import { normalizeTitle, normalizeForCompare } from '@/utils/titleNormalize';
import { TmdbPanel } from '@/components/TmdbPanel';
import { SubtitleSelector, type ReadySubtitle } from '@/components/SubtitleSelector';
import { PlatformLogo } from '@/components/PlatformLogo';
import { matchStreamingPlatformOrNetwork } from '@/utils/platformLogos';
import { StorageManager } from '@/utils/storage';
import { isAdultGroupName } from '@/utils/parentalControl';
import { rememberVodCategories } from '@/utils/parentalVod';
import { toast } from 'sonner';

import { categoryCatalogCache } from '@/utils/vodPosterCache';

const fullCatalogCache = new Map<string, { fetchedAt: number; items: CatalogItem[] }>();

function WebVodPlayer({ url, title, mediaId, restart, subtitleVtt, onEnded }: { url: string; title: string; mediaId: string; restart: boolean; subtitleVtt?: string; onEnded?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Référence mutable : le callback d'enchaînement ne doit pas relancer l'effet
  // d'attachement du flux (il ne dépend que de l'URL et du média).
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
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
    const save = () => {
      const position = video.currentTime * 1000, duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
      saveVodProgress(mediaId, position, duration);
      void updateVodHistoryProgress(mediaId, position, duration, video.ended).catch(() => {});
    };
    const ended = () => { save(); onEndedRef.current?.(); };
    const stop = () => { save(); cancelled = true; engine?.destroy(); video.pause(); video.removeAttribute('src'); video.load(); };
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
    video.addEventListener('loadedmetadata', metadata);
    video.addEventListener('durationchange', applyPosition);
    video.addEventListener('pause', save);
    video.addEventListener('ended', ended);
    const timer = window.setInterval(save, 15_000);
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
    return () => { clearInterval(timer); unsubscribe(); video.removeEventListener('loadedmetadata', metadata); video.removeEventListener('durationchange', applyPosition); video.removeEventListener('pause', save); video.removeEventListener('ended', ended); stop(); };
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
  /** Contrôle parental actif : les catégories adultes du catalogue sont masquées. */
  parentalEnabled?: boolean | undefined;
  /** Code parental saisi pour la session. */
  parentalUnlocked?: boolean | undefined;
}

export function VodLibrary({ playlist, kind, tmdbApiKey, resumeRequest, onResumeHandled, tvMode = false, onSearch, onShowLocal, parentalEnabled = false, parentalUnlocked = false }: VodLibraryProps) {
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
  const [season, setSeason] = useState('');
  const [subtitleEpisodeId, setSubtitleEpisodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<{ url: string; title: string; mediaId: string; restart: boolean; subtitleVtt?: string } | null>(null);
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
  const handledRequest = useRef<number | null>(null);
  const pendingResume = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVodWatchlistFromDB().then(wl => { if (!cancelled) setWatchlist(wl); }).catch(() => {});
    const update = () => { void getVodWatchlistFromDB().then(wl => { if (!cancelled) setWatchlist(wl); }); };
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
  const catalogCacheKey = JSON.stringify([playlist.id, account]);
  // « Vu ailleurs » : visionnages importés (Netflix, Prime, YouTube…), restés hors
  // de l'historique de lecture. Déclaré avant l'effet ci-dessous : des films vus
  // ailleurs suffisent à amorcer le chargement du catalogue complet.
  const [externalWatches, setExternalWatches] = useState<PlayHistoryEntry[]>([]);

  // Historique de lecture + catalogue complet : le catalogue entier n'est chargé
  // que si des films ont déjà été regardés (recommandations « Pour toi ») ou si
  // des visionnages importés peuvent amorcer le rail.
  useEffect(() => {
    if (!account || kind !== 'movie') return;
    let cancelled = false;
    void getPlayHistory().then(async (h) => {
      if (cancelled) return;
      // « Pour toi » ne dépend que des œuvres qualifiées (terminées ou ≥ 1 min, avec un
      // titre) : le tick de progression d'une lecture en cours (position avancée) ne
      // change pas cet ensemble — ne pas replacer l'historique ni rescorcer le catalogue.
      const signature = h.map(historyScope)
        .filter(e => e.kind === 'vod' && e.playlistId === playlist.id && e.mediaKind === 'movie' && !!e.name && (e.status === 'completed' || (e.positionMs || 0) >= 60000))
        .map(e => `${e.channelId}:${e.status}`)
        .sort()
        .join('|');
      if (signature !== historySignatureRef.current) {
        historySignatureRef.current = signature;
        setVodHistory(h);
      }
      // Les visionnages importés n'étant pas dans l'historique de lecture, ils
      // doivent aussi déclencher le chargement : sans catalogue, aucune amorce.
      if (!externalWatches.some(e => e.mediaKind !== 'series') && !h.map(historyScope).some(e => e.kind === 'vod' && e.playlistId === playlist.id && e.mediaKind === 'movie' && (e.status === 'completed' || (e.positionMs || 0) >= 60000))) return;
      const cached = fullCatalogCache.get(catalogCacheKey);
      if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) { setAllMovies(cached.items); return; }
      try {
        const data = await catalogRequest(account, 'get_vod_streams', {});
        if (cancelled) return;
        const values = parseCatalog(data, 'movie');
        fullCatalogCache.set(catalogCacheKey, { fetchedAt: Date.now(), items: values });
        while (fullCatalogCache.size > 3) fullCatalogCache.delete(fullCatalogCache.keys().next().value!);
        setAllMovies(values);
      } catch { /* recommandations optionnelles */ }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [account, kind, playlist.id, catalogCacheKey, reload, historyRevision, externalWatches]);

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
  // Films vus ailleurs que le catalogue propose aussi : ils amorcent le classement
  // local (catégorie + titre) sans réseau. Sans eux, un profil venu de Netflix ne
  // produirait aucun rail tant qu'aucun film n'a été lancé dans CedPlay.
  const seeds = useMemo(
    () => (kind === 'movie' && !tvMode ? externalSeeds(externalWatches, visibleAllMovies, playlist.id) : []),
    [kind, tvMode, externalWatches, visibleAllMovies, playlist.id],
  );
  const rankingHistory = useMemo(() => {
    if (!seeds.length) return vodHistory;
    const known = new Set(vodHistory.map(entry => entry.channelId));
    return [...vodHistory, ...seeds.filter(seed => !known.has(seed.channelId))];
  }, [vodHistory, seeds]);
  // Classement local immédiat (catégorie + titre). Le pool de 40 laisse au profil de
  // goût la possibilité de promouvoir un titre qui n'était pas dans les 12 premiers.
  // En mode télécommande, TvVodScreen n'affiche pas ce rail : aucun calcul.
  const baseRecommendations = useMemo(
    () => (kind === 'movie' && !tvMode ? recommendForHistory(rankingHistory, visibleAllMovies, { limit: 40, playlistId: playlist.id }) : []),
    [kind, tvMode, rankingHistory, visibleAllMovies, playlist.id],
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
    // Le rail « Pour toi » n'existe pas en mode télécommande : aucune requête TMDB.
    if (tvMode || !apiKey || baseRecommendations.length === 0) { setTaste(null); return; }
    let cancelled = false;
    const { history, movies } = tasteInputsRef.current;
    void enrichRecommendations({
      history, movies, candidates: baseRecommendations.map(entry => entry.item), playlistId: playlist.id, apiKey,
      external: externalWatches,
    })
      .then(result => { if (!cancelled) setTaste(result); })
      .catch(() => { if (!cancelled) setTaste(null); });
    return () => { cancelled = true; };
  }, [baseRecommendations, tmdbApiKey, playlist.id, tvMode, externalWatches]);
  const recommendations = useMemo(() => {
    if (kind !== 'movie' || tvMode) return [];
    const usable = taste && taste.playlistId === playlist.id && taste.profile.sampleSize > 0 ? taste : null;
    return recommendForHistory(rankingHistory, visibleAllMovies, {
      limit: 12,
      pool: 40,
      playlistId: playlist.id,
      ...(usable ? { profile: usable.profile, detailsByItemId: usable.detailsByItemId } : {}),
    });
  }, [kind, tvMode, rankingHistory, visibleAllMovies, playlist.id, taste]);

  useEffect(() => {
    if (!account) return;
    const controller = new AbortController(); setError(''); setLoading(true); setCategory(null); setItems([]); setCategories([]); setCategoriesStatus('loading');
    void catalogRequest(account, kind === 'movie' ? 'get_vod_categories' : 'get_series_categories', {}, controller.signal)
      .then(parseCategories).then(values => {
        if (controller.signal.aborted) return;
        setCategories(values);
        setCategoriesStatus('ready');
        // Enregistré seulement après une lecture réussie : une liste vide au montage ne doit
        // pas faire croire à la recherche globale qu'aucune catégorie n'est adulte.
        rememberVodCategories(playlist.id, kind, values);
        // Contrôle parental : la catégorie par défaut ne doit jamais être une catégorie verrouillée.
        const selectable = hideAdultRef.current ? values.filter(c => !isAdultGroupName(c.name)) : values;
        // Mode TV : retrouver la catégorie de la dernière visite si le catalogue la connaît encore.
        const fallback = selectable.find(c => /^FR\b|FRANCE/i.test(c.name))?.id || selectable[0]?.id || '';
        const stored = tvMode ? storedVodPosition(playlist.id, kind)?.category ?? null : null;
        setCategory(stored !== null && (stored === '' || selectable.some(c => c.id === stored)) ? stored : fallback);
      })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setCategoriesStatus('error'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account, kind, reload, tvMode, playlist.id]);
  useEffect(() => {
    if (!account || category === null) return;
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

  const baseItems = useMemo(() => {
    if (!showWatchlistOnly) return visibleItems;
    return visibleWatchlist.map(w => ({
      id: w.id,
      name: w.name,
      poster: w.poster ?? '',
      rating: w.rating ?? '',
      categoryId: w.categoryId ?? '',
      extension: w.extension ?? '',
    }));
  }, [showWatchlistOnly, visibleItems, visibleWatchlist]);
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
      }).catch(() => { /* l'historique ne doit jamais bloquer la lecture */ });
      // Prochain épisode de la saison (chemin natif et web partagent ce calcul).
      const seasonEpisodes = (kind === 'series' && details?.episodes)
        ? details.episodes.filter(e => e.season === season && e.extension)
        : [];
      const episodeIdx = seasonEpisodes.findIndex(e => e.id === id);
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
          history: seasonEpisodes.map(e => ({ mediaId: mediaKey(e.id), name: selected?.name || e.name, seriesId: selected?.id, poster: selected?.poster, episodeName: e.name })),
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
  const handleSelectCategory = useCallback((id: string) => { setCategory(id); setShowWatchlistOnly(false); }, []);
  const handleRefresh = useCallback(() => { fullCatalogCache.delete(catalogCacheKey); categoryCatalogCache.clear(); setAllMovies([]); setReload(v => v + 1); }, [catalogCacheKey]);
  // « Afficher davantage » étend la limite EFFECTIVE : après une restauration au-delà
  // de 60 titres (affiche mémorisée au titre 85 ⇒ 120 affichés), la limite de base est
  // déjà dépassée et « +60 » depuis elle ne montrerait rien de plus.
  const handleLoadMore = useCallback(() => setLimit(v => Math.max(v, tvLimit) + 60), [tvLimit]);
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
    });
    toast.success(added ? 'Ajouté à Ma Liste' : 'Retiré de Ma Liste');
  }, [kind, playlist.id]);
  const playItem = (item: CatalogItem) => { if (item.extension) void play(item.id, item.extension, item.name); };
  if (!account) return <section className="space-y-3 text-white"><h2 className="text-xl font-semibold">{kind === 'movie' ? 'Films' : 'Séries'}</h2><p className="text-neutral-300">Pour accéder au catalogue, importe ta liste depuis « Ajouter » → « Connexion Xtream ». Les identifiants doivent correspondre à la liste active.</p></section>;
  const ficheDialog = <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent
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
    className="bg-neutral-950 text-white border-neutral-900 max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2">{selected && matchStreamingPlatformOrNetwork(selected.name) && <PlatformLogo platformId={matchStreamingPlatformOrNetwork(selected.name)} size="sm" className="h-5 w-5 rounded" />}<span className="truncate">{selected?.name}</span></DialogTitle><DialogDescription>{kind === 'movie' ? 'Fiche du film et lecture' : 'Saisons et épisodes'}</DialogDescription></DialogHeader>
    {selected && (
      <div className="flex items-center gap-2 pt-1 pb-1">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const added = await toggleVodWatchlist({
              id: selected.id,
              name: selected.name,
              kind,
              playlistId: playlist.id,
              ...(selected.poster ? { poster: selected.poster } : {}),
              ...(selected.rating ? { rating: selected.rating } : {}),
              ...(selected.categoryId ? { categoryId: selected.categoryId } : {}),
              ...(selected.extension ? { extension: selected.extension } : {}),
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
    {!details && !detailError && <p role="status">Chargement de la fiche…</p>}
    {detailError && <p role="alert" className="text-amber-300">{detailError}</p>}
    {details && <div className="space-y-3 text-sm text-neutral-300"><p>{[details.releaseDate, details.duration].filter(Boolean).join(' · ')}</p><p className="whitespace-pre-line">{details.plot || 'Synopsis non fourni.'}</p>{details.director && <p>Réalisation : {details.director}</p>}{details.cast && <p>Avec : {details.cast}</p>}</div>}
    {selected && (
      <TmdbPanel
        name={selected.name}
        year={details?.releaseDate.match(/\d{4}/)?.[0] || normalizeTitle(selected.name).year}
        tmdbId={details?.tmdbId || selected.tmdbId}
        kind={kind}
        apiKey={tmdbApiKey}
        catalogItems={kind === 'movie' && allMovies.length > 0 ? allMovies : items}
        onOpenItem={setSelected}
      />
    )}
    {selected && settings.subtitlesEnabled !== false && (kind === 'movie' || subtitleEpisodeId) && (
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
    {kind === 'movie' && selected && <div className="flex flex-wrap gap-2"><Button data-remote-start disabled={busy || !(details?.extension || selected.extension)} onClick={() => void play(selected.id, details?.extension || selected.extension, selected.name)}>{progressLabel(selected.id)}</Button>{cachedProgress(selected.id).saved && <Button variant="secondary" disabled={busy} onClick={() => void play(selected.id, details?.extension || selected.extension, selected.name, true)}>Depuis le début</Button>}</div>}
    {kind === 'movie' && details && !details.extension && !selected?.extension && <p className="text-amber-300">Le fournisseur n’a pas indiqué de format de lecture.</p>}
    {kind === 'series' && details && <div className="space-y-3">
      {details.episodes.length === 0 ? <p>Aucun épisode fourni pour cette série.</p> : <><select aria-label="Saison" className="w-full bg-neutral-900 p-3 rounded-md" value={season} onChange={e => setSeason(e.target.value)}>{[...new Set(details.episodes.map(e => e.season))].map(s => <option key={s} value={s}>Saison {s}</option>)}</select><div className="space-y-2">{details.episodes.filter(e => e.season === season).map((e, idx) => <div key={e.id} className="bg-white/5 rounded-lg p-3 space-y-2"><p>{e.number}. {e.name}</p>{e.plot && <p className="text-xs text-neutral-400 line-clamp-3">{e.plot}</p>}<div className="flex flex-wrap gap-2">{settings.subtitlesEnabled !== false && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCurrentSub(null); setSubtitleEpisodeId(e.id); }}>Sous-titres épisode {e.number}</Button>}<Button size="sm" disabled={busy || !e.extension} {...(idx === 0 ? { 'data-remote-start': true } : {})} onClick={() => void play(e.id, e.extension, e.name)}>{progressLabel(e.id)}</Button>{cachedProgress(e.id).saved && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void play(e.id, e.extension, e.name, true)}>Depuis le début</Button>}</div>{!e.extension && <p className="text-xs text-amber-300">Format non fourni.</p>}</div>)}</div></>}
    </div>}
  </DialogContent></Dialog>;
  const playingDialog = <Dialog open={!!playing} onOpenChange={open => { if (!open) { setPlaying(null); setQueueNext(null); setAutoNextCountdown(null); } }}><DialogContent className="bg-neutral-950 text-white sm:max-w-4xl"><DialogHeader><DialogTitle>Lecture</DialogTitle><DialogDescription>Pause, déplacement et reprise de lecture.</DialogDescription></DialogHeader>{playing && <div className="relative">
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
      loading={loading}
      error={error}
      onRetry={handleRefresh}
      hasMore={baseItems.length > tvLimit}
      onLoadMore={handleLoadMore}
      showWatchlistOnly={showWatchlistOnly}
      onToggleWatchlistOnly={() => setShowWatchlistOnly(v => !v)}
      watchlistCount={visibleWatchlist.length}
      watchlistIds={watchlistIds}
      onToggleWatchlistItem={toggleWatchlistItem}
      onOpen={setSelected}
      onPlay={kind === 'movie' ? playItem : undefined}
      onRefresh={handleRefresh}
      onSearch={onSearch}
      onShowLocal={onShowLocal}
      progressLabel={progressLabel}
    />
    {ficheDialog}
    {playingDialog}
  </section>;
  return <section className="text-white space-y-4">
    <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-semibold">{kind === 'movie' ? 'Films' : 'Séries'}</h2><Button variant="secondary" size="sm" onClick={handleRefresh} disabled={loading}>Actualiser</Button></div>
    {kind === 'movie' && !tvMode && <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[17px] font-semibold tracking-tight text-foreground">Pour toi, d'après tes visionnages</h3>
        <ExternalWatchDialog watches={externalWatches} onChanged={reloadExternal} />
      </div>
      {externalWatches.length > 0 && <p className="text-[11px] leading-tight text-neutral-500">
        {externalSummary(externalWatches)}
        {taste && taste.playlistId === playlist.id && taste.externalSampleSize > 0
          ? ` · ${taste.externalSampleSize} fiche(s) TMDB ajoutée(s) au profil`
          : ''}
      </p>}
      {recommendations.length > 0
        ? <div className="rail flex snap-x gap-3 overflow-x-auto pb-1">
          {recommendations.map(({ item, reasons }) => <button key={item.id} onClick={() => setSelected(item)} className="poster press w-28 shrink-0 snap-start text-left rounded-xl overflow-hidden bg-card border border-neutral-900" title={reasons.length ? `${item.name} — ${reasons.join(' · ')}` : item.name}>
            <div className="relative aspect-[2/3] overflow-hidden bg-neutral-900 flex items-center justify-center"><VodPoster src={item.poster} kind="movie" /></div>
            <div className="p-1.5"><p className="text-[11px] leading-tight line-clamp-2">{item.name}</p>{item.rating && <p className="text-[10px] text-neutral-400">★ {item.rating}</p>}{reasons[0] && <p className="text-[10px] leading-tight text-neutral-500 line-clamp-1">{reasons[0]}</p>}</div>
          </button>)}
        </div>
        : <p className="text-xs text-neutral-400">{externalWatches.length > 0
          ? 'Aucun titre du catalogue ne correspond encore à ces visionnages. Importe l’historique d’une autre plateforme ou lance un film ici.'
          : 'Aucun film vu pour l’instant : lance un film ici ou importe ton historique Netflix, Prime Video, YouTube…'}</p>}
    </div>}
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      <div className="flex-1 min-w-0">
        <select aria-label="Catégorie VOD" className="bg-neutral-900 p-3 rounded-md w-full" value={category || ''} onChange={e => { setCategory(e.target.value); setShowWatchlistOnly(false); }}><option value="">Toutes les catégories</option>{visibleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <Button
        variant={showWatchlistOnly ? 'default' : 'outline'}
        onClick={() => setShowWatchlistOnly(v => !v)}
        className={`min-h-11 shrink-0 ${showWatchlistOnly ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : 'border-neutral-800 text-white hover:bg-neutral-900'}`}
        aria-pressed={showWatchlistOnly}
        title="Afficher uniquement les titres de Ma Liste"
      >
        {showWatchlistOnly ? <BookmarkCheck className="h-4 w-4 mr-1.5 text-primary" /> : <Bookmark className="h-4 w-4 mr-1.5" />}
        Ma Liste ({visibleWatchlist.length})
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
