import { NativePlayerBridge, AudioBridge, buildNativeZap, setNativeEpg, findChannelByNumber, syncNativeZapList } from '@/utils/nativePlayer';
import { findExistingPlaylist, reconcilePlaylist } from '@/utils/playlistIdentity';
import { getXtreamAccount, saveXtreamAccount } from '@/utils/xtreamCatalog';
import { canRefreshPlaylist, downloadXtreamLive, isXtreamLiveImport, readLiveSelection, saveLiveSelection } from '@/utils/xtreamLive';
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { MainNavigation, navSectionFor, type NavSection } from '@/components/MainNavigation';
import { MorePanel, type MoreDestination } from '@/components/MorePanel';
import { GroupManagerDialog, FavoritesOrganizerDialog, loadHiddenGroups, saveHiddenGroups } from '@/components/ListOrganizers';
import { BrandMark } from '@/components/BrandMark';
import { loadHiddenChannels, saveHiddenChannels } from '@/utils/streamCheck';
import { applyCustomization, loadCustomization, saveCustomization, EMPTY_CUSTOMIZATION, type ChannelEdit, type ListCustomization } from '@/utils/channelCustomization';
import { loadFavoriteLists, FAVORITE_LISTS_EVENT, type FavoriteList } from '@/utils/favoriteLists';
import { ChannelEditorDialog } from '@/components/ChannelEditor';
import { fetchTextWithUserAgent, playlistUserAgent, setActiveUserAgent } from '@/utils/userAgent';
import { Capacitor } from '@capacitor/core';
import { useTvMode } from '@/hooks/useTvMode';
import { MosaicPicker } from '@/components/MosaicPicker';
import type { VodResumeRequest } from '@/components/VodLibrary';
import { ParentalPinDialog } from '@/components/ParentalPinDialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MiniAudioPlayer } from '@/components/MiniAudioPlayer';
import { LazyBackupPanel, LazyChannelHealthDialog, LazyChannelList, LazyContinuePanel, LazyEPGGrid, LazyGlobalSearchDialog, LazyMoviesPanel, LazyPlaylistLoader, LazyPlaylistManager, LazyPodcastsPanel, LazyRecordings, LazyReplayPanel, LazySettingsPanel, LazyStreamingPanel, LazyTvLiveScreen, LazyVideoPlayer, LazyVodLibrary, LazyXtreamLoginDialog, LazyStalkerLoginDialog, PanelFallback } from '@/components/lazyScreens';
import { downloadStalkerPlaylist, stalkerAvailable } from '@/utils/stalker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload, List, Play, Maximize2, X, Download, ArrowLeft, LayoutGrid, ChevronDown, Grid2X2, CircleDot, Search, Loader2 } from 'lucide-react';
import { Channel, PlaylistInfo } from '@/types/channel';
import { getPlaylistsFromDB, getPlaylistFromDB, savePlaylistToDB, getLastChannelForPlaylist, setLastChannelForPlaylist, getMeta, setMeta, type VodWatchlistItem } from '@/utils/idb';
import { downloadPlaylist, downloadPlaylistAdvanced } from '@/utils/m3uExport';
import { AppSettings, StorageManager } from '@/utils/storage';
import { toast } from 'sonner';
import { getFavoritesFromDB, pushPlayHistory } from '@/utils/idb';
import { useEPG } from '@/hooks/useEPG';
import { CORSProxy } from '@/utils/corsProxy';
import { parseM3UInWorker } from '@/utils/parseWorker';
import { adultGroupNames } from '@/utils/parentalControl';
import { maybeUpgradePin } from '@/utils/pinHash';
import { popDueReminders } from '@/utils/reminders';
import { loadCatchupIndex, streamIdOf, catchupUrl, type CatchupIndex } from '@/utils/catchup';
import { hasM3UCatchup, m3uCatchupDays, m3uCatchupUrl } from '@/utils/m3uCatchup';
import { applySeriesRules } from '@/utils/recordingRules';
import { EpgSettingsDialog } from '@/components/EpgSettingsDialog';
import type { EPGProgram } from '@/types/epg';
import { isPlaybackDelegated } from '@/utils/playbackOwnership';
/** Date de la dernière actualisation réussie d'une liste par adresse (manuelle, automatique ou import). */
const playlistRefreshedKey = (playlistId: string) => `playlistRefreshedAt:${playlistId}`;
// Dynamic telemetry import helper
let telemetryLoggerPromise: Promise<typeof import('@/utils/telemetry/logger')> | undefined;
function getTelemetryLogger() { if (!telemetryLoggerPromise) telemetryLoggerPromise = import('@/utils/telemetry/logger'); return telemetryLoggerPromise; }

export function IPTVPlayer() {
  const [currentPlaylist, setCurrentPlaylist] = useState<PlaylistInfo | null>(null);
  // Liste affichée à l'instant présent, lue par les traitements asynchrones (actualisation).
  const currentPlaylistRef = useRef(currentPlaylist);
  currentPlaylistRef.current = currentPlaylist;
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  // L'application s'ouvre sur l'Accueil : reprise, favoris en direct, Ma liste.
  const [activeTab, setActiveTab] = useState('continue');
  const [channelView, setChannelView] = useState<'list' | 'grid'>('list');
  const [tabBeforeLists, setTabBeforeLists] = useState('channels');
  const [lastVodTab, setLastVodTab] = useState<'movies' | 'series'>('movies');
  useEffect(() => { if (activeTab === 'movies' || activeTab === 'series') setLastVodTab(activeTab); }, [activeTab]);
  const [allPlaylists, setAllPlaylists] = useState<PlaylistInfo[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [xtreamOpen, setXtreamOpen] = useState(false);
  const [stalkerOpen, setStalkerOpen] = useState(false);
  // Initialisateur paresseux : `getSettings()` lit localStorage + JSON.parse — une seule
  // fois au montage, pas à chaque rendu du composant racine.
  const [appSettings, setAppSettings] = useState<AppSettings>(() => StorageManager.getCachedSettings());
  /** Téléviseur / box : écran Direct en colonnes pour la télécommande. */
  const tvMode = useTvMode(appSettings.interfaceMode);
  /** Aperçu vidéo : mode choisi dans les réglages (automatique au survol, manuel, désactivé). */
  const previewMode = appSettings.tvPreviewMode ?? (appSettings.tvPreview === false ? 'off' : 'auto');
  const previewEnabled = previewMode !== 'off' && NativePlayerBridge.isAvailable();
  // Accès contextuels (mosaïque / enregistrements) ouverts depuis une chaîne ou l'en-tête.
  const [mosaicChannel, setMosaicChannel] = useState<Channel | null>(null);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [recordingsChannel, setRecordingsChannel] = useState<Channel | null>(null);
  // Réglages du guide (sources, association d'une chaîne, décalage).
  const [guideSettings, setGuideSettings] = useState<{ channel: Channel | null } | null>(null);
  // Demande de reprise depuis « Continuer » (voir VodLibrary).
  const [vodResumeRequest, setVodResumeRequest] = useState<VodResumeRequest | null>(null);
  const openSavedVod = (kind: 'movie' | 'series', item?: VodWatchlistItem) => {
    setActiveTab(kind === 'movie' ? 'movies' : 'series');
    setVodResumeRequest(item ? { nonce: Date.now(), kind, id: item.id, name: item.name, item, mode: 'details' } : null);
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [openingChannel, setOpeningChannel] = useState<string | null>(null);
  const nativeOpening = useRef(false);
  const [pendingNativeNumber, setPendingNativeNumber] = useState<string | null>(null);
  const webPlayerSection = useRef<HTMLDivElement>(null);
  /** Une chaîne a été lancée dans le lecteur web : il reste actif (plein ou mini) jusqu'à sa fermeture. */
  const [webSession, setWebSession] = useState(false);
  useEffect(() => {
    void AudioBridge?.syncFromNative?.();
    if (!AudioBridge?.onAudioTakeover) return;
    return AudioBridge.onAudioTakeover(() => setWebSession(false));
  }, []);
  // En-tête : verre dépoli dès que la page défile.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // TV : l'en-tête se replie quand la télécommande entre dans le catalogue (Films, Séries)
  // et revient dès que le focus le rejoint (Haut depuis la première rangée).
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (!tvMode) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Fiche, menu ou dialogue ouverts par-dessus : l'écran dessous ne bouge pas.
      if (!target || target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const hide = root.classList.contains('remote-navigation') && !!target.closest('[data-tv-vod]');
      if (hide === root.classList.contains('tv-chrome-hidden')) return;
      if (hide) root.style.setProperty('--tv-header-shift', `${Math.max(0, Math.round(headerRef.current?.getBoundingClientRect().bottom ?? 0))}px`);
      root.classList.toggle('tv-chrome-hidden', hide);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => { document.removeEventListener('focusin', onFocusIn); root.classList.remove('tv-chrome-hidden'); };
  }, [tvMode]);
  // Sortie du catalogue sans passage du focus par l'en-tête (Retour) : il réapparaît.
  useEffect(() => {
    if (activeTab !== 'movies' && activeTab !== 'series') document.documentElement.classList.remove('tv-chrome-hidden');
  }, [activeTab]);
  useEffect(() => {
    if (activeTab === 'player') webPlayerSection.current?.scrollIntoView({ block: 'start' });
  }, [activeTab, currentChannel?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  // Apply theme root class
  useEffect(() => {
    const root = document.documentElement;
    if (appSettings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [appSettings.theme]);

  // Load preferences before deciding whether to restore a saved list.
  // Démarrage : seule la dernière liste utilisée est lue (getPlaylistFromDB) ; les autres
  // le seront à la demande (écran « Mes listes », repli ci-dessous) pour alléger l'ouverture.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settings, lastPlaylistId] = await Promise.all([StorageManager.loadSettingsAsync(), getMeta<string>('lastPlaylistId')]);
        if (cancelled) return;
        setAppSettings(settings);
        let playlist: PlaylistInfo | undefined;
        if (lastPlaylistId) {
          try { playlist = await getPlaylistFromDB(lastPlaylistId); } catch { /* repli : tout relire */ }
        }
        if (!playlist) {
          const saved = await getPlaylistsFromDB();
          if (cancelled) return;
          setAllPlaylists(saved);
          const name = StorageManager.getLastPlaylist();
          playlist = saved.find(p => p.id === lastPlaylistId) || saved.find(p => p.name === name) || saved[0];
        }
        if (playlist && settings.autoLoadLastPlaylist !== false) {
          setCurrentPlaylist(playlist);
          const lastId = await getLastChannelForPlaylist(playlist.id);
          const last = lastId ? playlist.channels.find(c => c.id === lastId) || null : null;
          if (!cancelled && lastId) setCurrentChannel(last);
          // Démarrage sur la dernière chaîne : même chemin qu'un raccourci Android (contrôle parental compris).
          // Un raccourci déjà reçu garde la priorité.
          if (!cancelled && last && settings.startOnLastChannel) setLaunchChannelId(current => current ?? last.id);
        } else setActiveTab('loader');
      } catch { if (!cancelled) toast.error('Impossible de restaurer les données enregistrées.'); }
      finally { if (!cancelled) setLoadingInitial(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // « Mes listes » et l'écran d'accueil sans liste affichent toutes les listes :
  // elles sont lues à la demande (une seule fois), pas au démarrage.
  const allPlaylistsLoaded = useRef(false);
  useEffect(() => {
    if (loadingInitial || allPlaylistsLoaded.current) return;
    if (currentPlaylist && activeTab !== 'loader') return;
    allPlaylistsLoaded.current = true;
    getPlaylistsFromDB().then(saved => setAllPlaylists(saved)).catch(() => { allPlaylistsLoaded.current = false; });
  }, [loadingInitial, currentPlaylist, activeTab]);

  const exportAdvanced = async (options: Parameters<typeof downloadPlaylistAdvanced>[2]) => {
    if (!currentPlaylist) return;
    try { downloadPlaylistAdvanced(currentPlaylist, await getFavoritesFromDB(), options); }
    catch { toast.error('Export impossible.'); }
  };

  const handlePlaylistLoaded = async (playlist: PlaylistInfo, options?: { silentToast?: boolean }) => {
    // Réimport d'une source connue : on remplace la liste existante (même id)
    // pour conserver favoris, variantes préférées et lien Xtream.
    let updated = false;
    try {
      const saved = await getPlaylistsFromDB();
      const existing = findExistingPlaylist(saved, playlist);
      if (existing) {
        // Compte et choix Xtream sont rangés sous l'id de la nouvelle liste : à lire avant
        // que reconcilePlaylist() ne lui rende l'id de l'ancienne.
        const linkedAccount = getXtreamAccount(playlist);
        const liveSelection = readLiveSelection(playlist.id);
        playlist = reconcilePlaylist(existing, playlist);
        if (linkedAccount) saveXtreamAccount(existing.id, linkedAccount);
        if (liveSelection) saveLiveSelection(existing.id, liveSelection);
        updated = true;
      }
    } catch { /* la déduplication est optionnelle */ }
    setCurrentPlaylist(playlist);
    setCurrentChannel(null);
    try {
      await savePlaylistToDB(playlist);
      const refreshed = await getPlaylistsFromDB();
      setAllPlaylists(refreshed);
      StorageManager.setLastPlaylist(playlist.name);
      await setMeta('lastPlaylistId', playlist.id);
      // Liste fraîchement téléchargée : pas de nouvelle actualisation automatique tout de suite.
      if (canRefreshPlaylist(playlist)) void setMeta(playlistRefreshedKey(playlist.id), Date.now()).catch(() => {});
      // Attempt restore last channel for this (if previously existed under same id, usually new id though)
      try {
        const lastChannelId = await getLastChannelForPlaylist(playlist.id);
        if (lastChannelId) {
          const ch = playlist.channels.find(c => c.id === lastChannelId);
          if (ch) setCurrentChannel(ch);
        }
  } catch (e) { console.warn('Restore last channel after load failed', e); }
    } catch (e) {
      console.error('Failed to save playlist to DB', e);
      toast.error('Enregistrement de la liste impossible');
    }
    setActiveTab('channels');
    if (!options?.silentToast) {
      toast.success(updated
        ? `Liste mise à jour : ${playlist.channels.length} chaînes`
        : `Liste chargée : ${playlist.channels.length} chaînes`);
    }
  };

  // Groupes masqués par l'utilisateur (par liste) : absents de la liste, du guide et du zapping.
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [favoritesOrganizerOpen, setFavoritesOrganizerOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHiddenGroups([]);
    if (currentPlaylist) void loadHiddenGroups(currentPlaylist.id).then(g => { if (!cancelled) setHiddenGroups(g); });
    return () => { cancelled = true; };
  }, [currentPlaylist?.id]);
  const updateHiddenGroups = (next: string[]) => {
    setHiddenGroups(next);
    if (currentPlaylist) void saveHiddenGroups(currentPlaylist.id, next).catch(() => toast.error('Impossible d’enregistrer les groupes masqués.'));
  };
  // Chaînes masquées après la vérification des liens.
  const [hiddenChannels, setHiddenChannels] = useState<string[]>([]);
  const [healthOpen, setHealthOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHiddenChannels([]);
    if (currentPlaylist) void loadHiddenChannels(currentPlaylist.id).then(ids => { if (!cancelled) setHiddenChannels(ids); });
    return () => { cancelled = true; };
  }, [currentPlaylist?.id]);
  const updateHiddenChannels = (next: string[]) => {
    setHiddenChannels(next);
    if (currentPlaylist) void saveHiddenChannels(currentPlaylist.id, next).catch(() => toast.error('Impossible d’enregistrer les chaînes masquées.'));
  };
  // Personnalisation (nom, logo, numéro, ordre des groupes et des chaînes), par liste.
  const [customization, setCustomization] = useState<ListCustomization>(EMPTY_CUSTOMIZATION);
  useEffect(() => {
    let cancelled = false;
    setCustomization(EMPTY_CUSTOMIZATION);
    if (currentPlaylist) void loadCustomization(currentPlaylist.id).then(c => { if (!cancelled) setCustomization(c); });
    return () => { cancelled = true; };
  }, [currentPlaylist?.id]);
  const updateCustomization = useCallback((next: ListCustomization) => {
    setCustomization(next);
    const id = currentPlaylistRef.current?.id;
    if (id) void saveCustomization(id, next).catch(() => toast.error('Impossible d’enregistrer l’organisation de la liste.'));
  }, []);
  const customizedGroups = useMemo(
    () => (currentPlaylist ? applyCustomization(currentPlaylist.groups, customization) : []),
    [currentPlaylist, customization],
  );
  const customGroupOrder = !!customization.groupOrder?.length;
  const visibleGroups = useMemo(() => {
    if (!currentPlaylist) return [];
    if (!hiddenGroups.length && !hiddenChannels.length) return customizedGroups;
    const hidden = new Set(hiddenGroups);
    const hiddenIds = new Set(hiddenChannels);
    return customizedGroups
      .filter(g => !hidden.has(g.name))
      .map(g => (hiddenIds.size ? { ...g, channels: g.channels.filter(c => !hiddenIds.has(c.id)) } : g))
      .filter(g => g.channels.length > 0);
  }, [currentPlaylist, customizedGroups, hiddenGroups, hiddenChannels]);
  // Modifier une chaîne : le formulaire part de la chaîne d'origine.
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const openChannelEditor = useCallback((channel: Channel) => {
    const original = currentPlaylistRef.current?.channels.find(c => c.id === channel.id || c.variants?.some(v => v.id === channel.id));
    setEditingChannel(original ?? channel);
  }, []);
  const saveChannelEdit = (channel: Channel, edit: ChannelEdit | null) => {
    const edits = { ...customization.edits };
    if (edit) edits[channel.id] = edit; else delete edits[channel.id];
    updateCustomization({ ...customization, edits });
  };
  // Listes de favoris supplémentaires (Sport, Enfants…).
  const [favoriteLists, setFavoriteLists] = useState<FavoriteList[]>([]);
  useEffect(() => {
    const reload = () => { void loadFavoriteLists().then(setFavoriteLists); };
    reload();
    window.addEventListener(FAVORITE_LISTS_EVENT, reload);
    return () => window.removeEventListener(FAVORITE_LISTS_EVENT, reload);
  }, []);

  // Favoris (ordre choisi) : les numéros 1, 2, 3… lancent les favoris correspondants.
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  useEffect(() => {
    const reload = () => { void getFavoritesFromDB().then(setFavoriteIds).catch(() => {}); };
    reload();
    window.addEventListener('favorites-updated', reload);
    return () => window.removeEventListener('favorites-updated', reload);
  }, [currentPlaylist?.id]);

  // Réglages du lecteur Android : User-Agent de la liste ouverte, mémoire tampon, décodage, AFR.
  const activeUserAgent = playlistUserAgent(currentPlaylist);
  useEffect(() => {
    setActiveUserAgent(activeUserAgent);
    void NativePlayerBridge.setPlayerOptions({
      userAgent: activeUserAgent,
      buffer: appSettings.playerBuffer ?? 'normal',
      decoder: appSettings.playerDecoder ?? 'hardware',
      afr: appSettings.playerAfr === true,
    });
  }, [activeUserAgent, appSettings.playerBuffer, appSettings.playerDecoder, appSettings.playerAfr]);

  // Raccourcis Android (appui long sur l'icône) : les 4 premiers favoris de la liste.
  useEffect(() => {
    if (!currentPlaylist || !NativePlayerBridge.isAvailable()) return;
    // Chaînes personnalisées : le nom et le logo choisis apparaissent aussi hors de l'application.
    const byId = new Map(customizedGroups.flatMap(g => g.channels).map(c => [c.id, c]));
    const favorites = favoriteIds.map(id => byId.get(id)).filter((c): c is Channel => Boolean(c));
    void NativePlayerBridge.setChannelShortcuts(favorites.slice(0, 4).map(c => ({ id: c.id, name: c.name })));
    // Android TV : rangée Favoris de l'écran d'accueil, au calme (écriture dans le lanceur).
    const t = window.setTimeout(() => {
      void NativePlayerBridge.setHomeFavorites(favorites.slice(0, 30).map(c => ({ id: c.id, name: c.name, ...(c.logo ? { logo: c.logo } : {}) })));
    }, 3000);
    return () => window.clearTimeout(t);
  }, [currentPlaylist, customizedGroups, favoriteIds]);

  // Liste ordonnée des chaînes (zapping) et guide des programmes.
  const orderedChannels = useMemo(() => visibleGroups.flatMap(g => g.channels), [visibleGroups]);

  // Contrôle parental : groupes adultes verrouillés tant qu'un code n'a pas été saisi.
  const [parentalUnlocked, setParentalUnlocked] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const parentalLockedGroups = useMemo(
    () => (appSettings.parentalControlEnabled && currentPlaylist ? adultGroupNames(currentPlaylist.groups) : []),
    [appSettings.parentalControlEnabled, currentPlaylist],
  );
  useEffect(() => { setParentalUnlocked(false); setPinOpen(false); }, [currentPlaylist?.id]);
  useEffect(() => { setParentalUnlocked(false); setPinOpen(false); }, [appSettings.parentalControlEnabled, appSettings.parentalPin]);
  useEffect(() => {
    if (!parentalUnlocked && currentChannel && parentalLockedGroups.includes(currentChannel.group || '')) {
      setCurrentChannel(null);
      setActiveTab('channels');
    }
  }, [currentChannel, parentalLockedGroups, parentalUnlocked]);
  // Chaînes jouables : les groupes verrouillés sont exclus du zapping, du
  // lecteur natif, de la mosaïque et du guide tant que le code n'est pas saisi.
  const playableChannels = useMemo(
    () => (parentalLockedGroups.length && !parentalUnlocked
      ? orderedChannels.filter(c => !parentalLockedGroups.includes(c.group || ''))
      : orderedChannels),
    [orderedChannels, parentalLockedGroups, parentalUnlocked],
  );

  // Liste complète pour le zapping Android : transmise au calme, une fois par changement de liste.
  useEffect(() => {
    if (!NativePlayerBridge.isAvailable() || !playableChannels.length) return;
    const t = window.setTimeout(() => { void syncNativeZapList(playableChannels); }, 1500);
    return () => window.clearTimeout(t);
  }, [playableChannels]);

  const handleWebChannelSelect = useCallback((channel: Channel) => {
    void AudioBridge?.pauseForVideo?.();
    setWebSession(true);
    // Contrôle parental : toute sélection d'une chaîne adulte passe par le code.
    if (!parentalUnlocked && parentalLockedGroups.includes(channel.group || '')) {
      setPinOpen(true);
      return;
    }
    setCurrentChannel(channel);
    setActiveTab('player');
    if (currentPlaylist) {
      setLastChannelForPlaylist(currentPlaylist.id, channel.id).catch(e => console.warn('Persist last channel failed', e));
    }
  // Record play history asynchronously (fire and forget)
  pushPlayHistory({ channelId: channel.id, ts: Date.now(), kind: 'live' }).catch(e => console.warn('Play history push failed', e));
    toast.info(`Chaîne sélectionnée : ${channel.name}`);
  }, [currentPlaylist, parentalUnlocked, parentalLockedGroups]);

  const openNativeChannel = useCallback(async (channel: Channel) => {
    const playlist = currentPlaylist;
    if (!playlist) return;
    if (!parentalUnlocked && parentalLockedGroups.includes(channel.group || '')) {
      setPinOpen(true);
      return;
    }
    if (nativeOpening.current) return;
    nativeOpening.current = true;
    // La lecture passe au lecteur Android : le lecteur web (et son mini-lecteur) s'arrête.
    setWebSession(false);
    setOpeningChannel(channel.name);
    let dismissSpinner: number | undefined;
    try {
      // Laisser peindre l'accusé de réception avant la préparation du zapping.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      const remember = (selected: Channel) => {
        setCurrentChannel(selected);
        void NativePlayerBridge.addWatchNext(selected);
        void setLastChannelForPlaylist(playlist.id, selected.id).catch(() => {});
        void pushPlayHistory({ channelId: selected.id, ts: Date.now(), kind: 'live' }).catch(() => {});
      };
      dismissSpinner = window.setTimeout(() => setOpeningChannel(null), 800);
      const opened = await NativePlayerBridge.open(channel.url, channel.name, buildNativeZap(playableChannels, channel), url => {
        const match = playableChannels.find(c => c.url === url || c.variants?.some(v => v.url === url));
        const variant = match?.variants?.find(v => v.url === url);
        remember(variant || match || channel);
        setActiveTab('channels');
      }, number => setPendingNativeNumber(number));
      if (opened) setActiveTab('channels');
    } finally {
      window.clearTimeout(dismissSpinner);
      nativeOpening.current = false;
      setOpeningChannel(null);
    }
  }, [currentPlaylist, playableChannels, parentalUnlocked, parentalLockedGroups]);
  // Numéro tapé dans le lecteur Android hors des chaînes qu'il connaît : relance sur la bonne chaîne.
  useEffect(() => {
    if (!pendingNativeNumber) return;
    setPendingNativeNumber(null);
    const target = findChannelByNumber(playableChannels, pendingNativeNumber);
    if (target) void openNativeChannel(target);
    else toast.error(`Aucune chaîne n° ${pendingNativeNumber}`);
  }, [pendingNativeNumber, playableChannels, openNativeChannel]);
  const handleChannelSelect = useCallback((channel: Channel) => {
    if (NativePlayerBridge.isAvailable()) void openNativeChannel(channel);
    else handleWebChannelSelect(channel);
  }, [openNativeChannel, handleWebChannelSelect]);
  // Handlers stables pour les listes de chaînes : des fonctions inline recréées à chaque rendu
  // court-circuiteraient la mémoïsation des cartes (re-rendu complet à chaque zap ou frappe).
  const handleNativeChannelSelect = useCallback((channel: Channel) => { void openNativeChannel(channel); }, [openNativeChannel]);
  const handleRecordRequest = useCallback((channel: Channel) => { setRecordingsChannel(channel); setRecordingsOpen(true); }, []);

  // Chaque tuile de la mosaïque ouvre un flux chez le fournisseur : on coupe le
  // lecteur web d'abord, sinon il garde sa connexion ouverte pendant la mosaïque.
  const openMosaicPicker = useCallback((channel: Channel) => {
    setWebSession(false);
    setMosaicChannel(channel);
  }, []);

  // Raccourci Android : lecteuriptv://channel?id=… lance la chaîne demandée.
  const [launchChannelId, setLaunchChannelId] = useState<string | null>(null);
  useEffect(() => {
    if (!NativePlayerBridge.isAvailable()) return;
    let disposed = false;
    const parse = (url?: string | null) => {
      if (disposed || !url) return;
      try {
        const u = new URL(url);
        if (u.protocol === 'lecteuriptv:' && u.searchParams.get('id')) setLaunchChannelId(u.searchParams.get('id'));
      } catch { /* adresse étrangère */ }
    };
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(async ({ App: CapApp }) => {
      if (disposed) return;
      parse((await CapApp.getLaunchUrl())?.url);
      if (disposed) return;
      const listener = await CapApp.addListener('appUrlOpen', ({ url }) => parse(url));
      if (disposed) void listener.remove();
      else remove = () => { void listener.remove(); };
    }).catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, []);
  useEffect(() => {
    if (!launchChannelId || !currentPlaylist) return;
    // Chaîne personnalisée (nom, logo, numéro) : celle que montrent la liste et le lecteur.
    let channel: Channel | undefined;
    for (const g of customizedGroups) { channel = g.channels.find(c => c.id === launchChannelId || c.variants?.some(v => v.id === launchChannelId)); if (channel) break; }
    setLaunchChannelId(null);
    if (channel) handleChannelSelect(channel.variants?.find(v => v.id === launchChannelId) || channel);
  }, [launchChannelId, currentPlaylist, customizedGroups, handleChannelSelect]);

  // Bouton retour Android : sous-écran → rubrique parente → Accueil, puis sortie.
  useEffect(() => {
    const onBack = (event: Event) => {
      // Écran TV : l'aperçu et la liste reviennent d'abord aux catégories, le guide à la liste.
      const tvBack = new Event('tv-live-back', { cancelable: true });
      window.dispatchEvent(tvBack);
      if (tvBack.defaultPrevented) { event.preventDefault(); return; }
      // Écran catalogue TV : la fiche éclair revient à la grille, la grille aux catégories.
      const tvVodBack = new Event('tv-vod-back', { cancelable: true });
      window.dispatchEvent(tvVodBack);
      if (tvVodBack.defaultPrevented) { event.preventDefault(); return; }
      if (tvMode && activeTab === 'channels' && channelView === 'grid') { event.preventDefault(); setChannelView('list'); return; }
      const parent: Record<string, string> = { replay: 'more', streaming: 'more', player: 'channels', loader: tabBeforeLists };
      const target = parent[activeTab] ?? (activeTab !== 'continue' ? 'continue' : null);
      if (!target || !currentPlaylist) return;
      event.preventDefault();
      setActiveTab(target);
    };
    window.addEventListener('iptv-back', onBack);
    return () => window.removeEventListener('iptv-back', onBack);
  }, [activeTab, tabBeforeLists, currentPlaylist, tvMode, channelView]);
  const currentChannelIndex = useMemo(
    () => (currentChannel ? playableChannels.findIndex(c => c.id === currentChannel.id) : -1),
    [currentChannel, playableChannels],
  );
  const zap = useCallback((delta: number) => {
    if (!currentChannel || playableChannels.length < 2) return;
    const idx = playableChannels.findIndex(c => c.id === currentChannel.id);
    if (idx < 0) return;
    const next = playableChannels[(idx + delta + playableChannels.length) % playableChannels.length];
    if (next) handleChannelSelect(next);
  }, [currentChannel, playableChannels, handleChannelSelect]);
  // Zapping stable (préc./suiv.) : évite de re-rendre le lecteur à chaque état parent.
  const onNextChannel = useMemo(() => (currentChannelIndex >= 0 ? () => zap(1) : undefined), [currentChannelIndex, zap]);
  const onPrevChannel = useMemo(() => (currentChannelIndex >= 0 ? () => zap(-1) : undefined), [currentChannelIndex, zap]);
  // Zapping numérique (saisie des chiffres dans le lecteur) : même résolution que la box,
  // numérotation canonique partagée (chno/num fournisseur d'abord, sinon position).
  const zapToNumber = useCallback((number: number) => {
    const list = playableChannels;
    if (!list.length || !Number.isFinite(number) || number <= 0) return;
    const target = findChannelByNumber(list, String(number));
    if (target && target.id !== currentChannel?.id) handleChannelSelect(target);
    else if (!target) toast.error(`Aucune chaîne n° ${number}`);
  }, [playableChannels, currentChannel, handleChannelSelect]);
  const epg = useEPG(currentPlaylist, appSettings);
  const epgData = epg.data;

  // Catch-up Xtream : chaînes avec archives et lecture d'une émission passée.
  const [catchupIndex, setCatchupIndex] = useState<CatchupIndex | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCatchupIndex(null);
    if (currentPlaylist) void loadCatchupIndex(currentPlaylist).then(index => { if (!cancelled) setCatchupIndex(index); });
    return () => { cancelled = true; };
  }, [currentPlaylist]);
  // Replay M3U standard (catchup, catchup-source, catchup-days) en plus de l'archive Xtream.
  const hasM3UReplay = useMemo(() => !!currentPlaylist?.channels.some(hasM3UCatchup), [currentPlaylist]);
  const hasCatchup = hasM3UReplay || (!!catchupIndex && Object.keys(catchupIndex.archiveDays).length > 0);
  const xtreamCatchupDays = useCallback((channel: Channel) => {
    const id = catchupIndex ? streamIdOf(channel) : null;
    return id ? catchupIndex!.archiveDays[id] ?? 0 : 0;
  }, [catchupIndex]);
  const catchupDays = useCallback((channel: Channel) => Math.max(xtreamCatchupDays(channel), m3uCatchupDays(channel)), [xtreamCatchupDays]);
  const playCatchup = useCallback((channel: Channel, program: EPGProgram) => {
    if (!currentPlaylist) return;
    if (!parentalUnlocked && parentalLockedGroups.includes(channel.group || '')) { setPinOpen(true); return; }
    const start = new Date(program.startTime);
    const end = new Date(program.endTime);
    const account = getXtreamAccount(currentPlaylist);
    const streamId = streamIdOf(channel);
    const url = account && streamId && catchupIndex && xtreamCatchupDays(channel) > 0
      ? catchupUrl(account, streamId, start, end, catchupIndex.timezone)
      : m3uCatchupUrl(channel, start, end);
    if (!url) { toast.error('Replay indisponible pour cette chaîne.'); return; }
    const title = `${channel.name} · ${program.title}`;
    // Deux abonnements peuvent utiliser le même numéro de flux : leurs
    // positions de reprise doivent rester indépendantes.
    const mediaId = `${currentPlaylist.id}:catchup:${streamId ?? channel.id}:${start.getTime()}`;
    if (NativePlayerBridge.isAvailable()) { void NativePlayerBridge.openVod(url, title, mediaId); return; }
    setCurrentChannel({ id: mediaId, name: title, url, ...(channel.logo ? { logo: channel.logo } : {}), ...(channel.group ? { group: channel.group } : {}) });
    setWebSession(true);
    setActiveTab('player');
  }, [currentPlaylist, catchupIndex, xtreamCatchupDays, parentalUnlocked, parentalLockedGroups]);
  // Le lecteur Android affiche le guide : il lit cette copie au moment du lancement.
  useEffect(() => { setNativeEpg(epgData); }, [epgData]);
  const nativeZap = useMemo(
    () => (currentChannel && currentChannelIndex >= 0 ? buildNativeZap(playableChannels, currentChannel, undefined, epgData ?? null) : undefined),
    [currentChannel, currentChannelIndex, playableChannels, epgData],
  );

  // Séries suivies : chaque mise à jour du guide programme leurs prochaines diffusions (Android).
  useEffect(() => {
    if (!currentPlaylist || !epgData || !NativePlayerBridge.isAvailable()) return;
    let cancelled = false;
    void applySeriesRules(currentPlaylist.id, currentPlaylist.channels, epgData).then(added => {
      if (!cancelled && added) toast.success(`${added} enregistrement${added > 1 ? 's' : ''} de série programmé${added > 1 ? 's' : ''}.`);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentPlaylist, epgData]);

  // Rappels EPG : contrôle périodique et notification dans l'application
  // (les rappels sont déclenchés tant que l'app est ouverte).
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void popDueReminders(Date.now()).then(due => {
        if (cancelled || !due.length) return;
        for (const reminder of due) {
          toast.info(`« ${reminder.title} » commence sur ${reminder.channelName}.`, { duration: 8000 });
        }
      });
    };
    check();
    const id = window.setInterval(check, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  /** Rafraîchit une liste (M3U par adresse ou connexion Xtream) en conservant son identité (favoris, variantes, lien Xtream). */
  const refreshPlaylist = async (pl: PlaylistInfo, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    const account = pl.url ? null : isXtreamLiveImport(pl) ? getXtreamAccount(pl) : null;
    if (!pl.url && !account && !pl.stalker) { if (!silent) toast.error('Cette liste ne peut pas être rafraîchie automatiquement. Réimporte-la depuis Mes listes.'); return; }
    const toastId = silent ? undefined : toast.loading('Mise à jour de la liste…');
    const toastOptions = toastId !== undefined ? { id: toastId } : {};
    try {
      let fresh: PlaylistInfo;
      if (pl.url) {
        // User-Agent propre à la liste : requête native (la page ne peut pas le changer).
        const content = pl.userAgent && Capacitor.isNativePlatform()
          ? await fetchTextWithUserAgent(pl.url, playlistUserAgent(pl))
          : await CORSProxy.fetchWithProxy(pl.url);
        if (!content.includes('#EXTINF:') || content.trim().startsWith('<')) {
          throw new Error('Le serveur ne renvoie plus une liste M3U.');
        }
        const host = (() => { try { return new URL(pl.url!).hostname; } catch { return 'liste'; } })();
        fresh = { ...(await parseM3UInWorker(content, `Liste — ${host}`, () => {})), url: pl.url };
      } else if (pl.stalker) {
        fresh = await downloadStalkerPlaylist(pl.stalker, pl.name);
      } else {
        fresh = await downloadXtreamLive(pl, account!);
      }
      // Pendant le téléchargement, la liste a pu être modifiée (favoris), supprimée ou
      // quittée : on repart de sa version enregistrée et on ne touche à l'écran que si
      // elle est toujours la liste affichée.
      const stored = await getPlaylistFromDB(pl.id);
      if (!stored) return;
      const updated = reconcilePlaylist(stored, fresh);
      await savePlaylistToDB(updated);
      setAllPlaylists(prev => prev.map(p => p.id === pl.id ? updated : p));
      if (currentPlaylistRef.current?.id === pl.id) {
        setCurrentPlaylist(current => current?.id === pl.id ? updated : current);
        setCurrentChannel(current => current ? updated.channels.find(c => c.id === current.id) || null : null);
      }
      void setMeta(playlistRefreshedKey(pl.id), Date.now()).catch(() => {});
      if (!silent) toast.success(`Liste mise à jour : ${updated.channels.length} chaînes.`, toastOptions);
    } catch (e) {
      if (silent) { console.warn('Actualisation automatique de la liste impossible', e); return; }
      const message = e instanceof Error && (e.message.includes('M3U') || e.message.includes('Xtream') || e.message.includes('fournisseur')) ? e.message : 'Mise à jour impossible (réseau ou serveur).';
      toast.error(message, toastOptions);
    }
  };

  // Actualisation automatique de la liste par adresse (réglage, 24 h par défaut), comme au
  // démarrage d'une box : premier contrôle 20 s après l'ouverture, puis toutes les 30 min,
  // jamais pendant une lecture déléguée au lecteur Android (bande passante et connexions).
  const refreshPlaylistRef = useRef(refreshPlaylist);
  refreshPlaylistRef.current = refreshPlaylist;
  const refreshHours = appSettings.playlistRefreshHours ?? 24;
  const refreshPlaylistId = currentPlaylist && canRefreshPlaylist(currentPlaylist) ? currentPlaylist.id : null;
  useEffect(() => {
    if (loadingInitial || !refreshPlaylistId || refreshHours <= 0) return;
    let cancelled = false;
    let running = false;
    const check = async () => {
      const playlist = currentPlaylistRef.current;
      if (cancelled || running || isPlaybackDelegated() || playlist?.id !== refreshPlaylistId) return;
      const last = await getMeta<number>(playlistRefreshedKey(playlist.id)).catch(() => undefined);
      if (cancelled || (typeof last === 'number' && Date.now() - last < refreshHours * 3_600_000)) return;
      running = true;
      try { await refreshPlaylistRef.current(playlist, { silent: true }); } finally { running = false; }
    };
    const first = window.setTimeout(() => void check(), 20_000);
    const timer = window.setInterval(() => void check(), 30 * 60_000);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [loadingInitial, refreshPlaylistId, refreshHours]);

  const navigate = (section: NavSection) => {
    if (section === 'movies' || section === 'series') setActiveTab(section);
    else if (section === 'vod') setActiveTab(current => (current === 'movies' || current === 'series' ? current : lastVodTab));
    else setActiveTab(section);
  };
  const openMore = (destination: MoreDestination) => {
    if (destination === 'xtream') setXtreamOpen(true);
    else if (destination === 'replay' || destination === 'streaming') setActiveTab(destination);
    else if (destination === 'recordings') { setRecordingsChannel(null); setRecordingsOpen(true); }
    else if (destination === 'settings') setSettingsOpen(true);
    else if (destination === 'health') setHealthOpen(true);
    else handleLoadNewPlaylist();
  };

  const handleLoadNewPlaylist = () => {
    if (activeTab !== 'loader') setTabBeforeLists(activeTab);
    setActiveTab('loader');
  };

  /** Bascule instantanée vers une liste déjà en mémoire (sans rechargement). */
  const openPlaylist = async (pl: PlaylistInfo) => {
    setCurrentPlaylist(pl);
    setCurrentChannel(null);
    StorageManager.setLastPlaylist(pl.name);
    await setMeta('lastPlaylistId', pl.id);
    setActiveTab('channels');
    try {
      const lastChannelId = await getLastChannelForPlaylist(pl.id);
      if (lastChannelId) {
        const ch = pl.channels.find(c => c.id === lastChannelId);
        if (ch) setCurrentChannel(ch);
      }
    } catch (e) { console.warn('Restore last channel on switch failed', e); }
  };

  const refreshAfterRestore = async () => {
    const [saved, settings] = await Promise.all([getPlaylistsFromDB(), StorageManager.loadSettingsAsync(true)]);
    setAllPlaylists(saved);
    setAppSettings(settings);
    setCurrentPlaylist(null);
    setCurrentChannel(null);
    setActiveTab('loader');
  };

  if (loadingInitial && !currentPlaylist) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-center space-y-4">
          <BrandMark className="mx-auto h-20 w-20" />
          <p className="text-2xl font-semibold">Ced<span className="text-primary">Play</span></p>
          <div className="animate-pulse text-xl font-semibold">Chargement des listes…</div>
        </div>
      </div>
    );
  }

  if (!currentPlaylist) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-4 flex items-center justify-center gap-3">
              <BrandMark className="h-14 w-14" />
              CedPlay
            </h1>
            <p className="text-neutral-300 text-lg">
              Direct, films et séries. Tes listes et tes favoris au même endroit.
            </p>
          </div>

          <div className="flex justify-center mb-6"><Suspense fallback={<PanelFallback className="h-16 w-64" />}><LazyBackupPanel onRestored={refreshAfterRestore} /></Suspense></div>
          {allPlaylists.length > 0 && <div className="mb-6">
            <Suspense fallback={<PanelFallback className="h-64" />}><LazyPlaylistManager playlists={allPlaylists}
              onSelect={playlist => { setCurrentPlaylist(playlist); setCurrentChannel(null); setActiveTab('channels'); StorageManager.setLastPlaylist(playlist.name); void setMeta('lastPlaylistId', playlist.id).catch(() => {}); }}
              onDeleted={() => { void getPlaylistsFromDB().then(setAllPlaylists); }}
              onMutate={updated => setAllPlaylists(prev => prev.map(p => p.id === updated.id ? updated : p))}
            /></Suspense>
          </div>}
          <div className="flex justify-center">
            <Suspense fallback={<PanelFallback className="h-16 w-64" />}><LazyPlaylistLoader onPlaylistLoaded={handlePlaylistLoaded} /></Suspense>
          </div>

          <div className="mt-12 text-center">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              <Card className="bg-neutral-950 border-neutral-900">
                <CardContent className="p-6 text-center">
                  <Upload className="h-8 w-8 mx-auto mb-3 text-primary" />
                  <h3 className="text-white font-semibold mb-2">Importer une liste</h3>
                  <p className="text-neutral-400 text-sm">Fichiers M3U et M3U8</p>
                </CardContent>
              </Card>
              
              <Card className="bg-neutral-950 border-neutral-900">
                <CardContent className="p-6 text-center">
                  <List className="h-8 w-8 mx-auto mb-3 text-primary" />
                  <h3 className="text-white font-semibold mb-2">Retrouver tes chaînes</h3>
                  <p className="text-neutral-400 text-sm">Groupes, recherche et favoris</p>
                </CardContent>
              </Card>
              
              <Card className="bg-neutral-950 border-neutral-900">
                <CardContent className="p-6 text-center">
                  <Play className="h-8 w-8 mx-auto mb-3 text-primary" />
                  <h3 className="text-white font-semibold mb-2">Lecture vidéo</h3>
                  <p className="text-neutral-400 text-sm">Flux HLS et formats compatibles avec le navigateur</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // En-tête : sur TV, une seule ligne (logo, rubriques, liste, recherche) — repliable.
  const appHeader = (<header ref={headerRef} data-app-header className={`sticky top-0 z-30 -mx-2 mb-3 flex items-center justify-between ${tvMode ? 'gap-4' : 'gap-2'} border-b px-2 py-2 transition-[background-color,border-color] duration-300 sm:-mx-4 sm:px-4 ${scrolled ? 'glass border-white/5' : 'border-transparent'}`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <h1 className="text-lg sm:text-2xl font-semibold tracking-tight text-white flex items-center gap-2 shrink-0">
          <BrandMark className="h-8 w-8 sm:h-9 sm:w-9" />
          {/* « Play » prend l'orange du triangle du logo, qui est aussi le bouton lecture. */}
          <span>Ced<span className="text-[#FF5A36]">Play</span></span>
        </h1>
        {tvMode && <MainNavigation tv onNavigate={navigate} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={tvMode ? 'ghost' : 'outline'} size="sm" className={tvMode ? 'tv-chip ml-auto h-10 min-w-0 gap-1.5 rounded-full px-3.5 text-[14px] font-normal text-muted-foreground' : 'min-h-11 min-w-0 border-neutral-800 text-white hover:bg-neutral-900 px-3 gap-1.5'} title={currentPlaylist.name} aria-label="Changer de liste">
              <span className={`truncate ${tvMode ? 'max-w-[180px]' : 'max-w-[200px] sm:max-w-[240px]'}`}>{currentPlaylist.name}</span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 max-h-[70vh] overflow-y-auto">
            <DropdownMenuLabel>Changer de liste</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={currentPlaylist.id} onValueChange={(id) => {
              const pl = allPlaylists.find(p => p.id === id);
              if (pl && pl.id !== currentPlaylist.id) void openPlaylist(pl);
            }}>
              {allPlaylists.map(pl => (
                <DropdownMenuRadioItem key={pl.id} value={pl.id}>
                  <span className="truncate flex-1">{pl.name}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground shrink-0">{pl.channels.length}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setXtreamOpen(true)}>Ajouter un compte Xtream</DropdownMenuItem>
            {stalkerAvailable() && <DropdownMenuItem onSelect={() => setStalkerOpen(true)}>Ajouter un portail MAC (Stalker)</DropdownMenuItem>}
            <DropdownMenuItem onSelect={handleLoadNewPlaylist}>Gérer et importer les listes</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {currentPlaylist.totalChannelsBeforeDedup && currentPlaylist.totalChannelsBeforeDedup > currentPlaylist.channels.length && (
          <Badge variant="outline" className="hidden sm:inline-flex border-neutral-800 text-amber-300 text-xs shrink-0">
            {currentPlaylist.channels.length}/{currentPlaylist.totalChannelsBeforeDedup}
          </Badge>
        )}
      </div>
      
      <div className="flex items-center justify-end gap-1.5 shrink-0">
        {/* TV : la connexion Xtream reste dans le menu de la liste, l'en-tête garde une seule ligne. */}
        {!tvMode && <Button variant="outline" size="sm" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900" onClick={() => setXtreamOpen(true)} aria-label="Connexion Xtream">Xtream</Button>}
        {tvMode ? <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)} className="tv-chip h-10 w-10 rounded-full p-0 text-muted-foreground" aria-label="Recherche unifiée" title="Recherche unifiée">
          <Search aria-hidden="true" className="h-[18px] w-[18px]" />
        </Button> : <Button 
          variant="outline" 
          size="sm"
          onClick={() => setSearchOpen(true)}
          className="border-neutral-800 text-white hover:bg-neutral-900 h-11 w-11 p-0 sm:w-auto sm:px-3.5 text-sm"
          aria-label="Recherche unifiée"
          title="Recherche unifiée (Ctrl+K)"
        >
          <Search aria-hidden="true" className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Recherche</span>
        </Button>}
      </div>
    </header>
  );

  return (
    <div className={`min-h-screen bg-background pt-[env(safe-area-inset-top)] ${webSession && activeTab !== 'player' ? 'pb-[calc(320px+env(safe-area-inset-bottom))] sm:pb-[calc(260px+env(safe-area-inset-bottom))]' : 'pb-[calc(84px+env(safe-area-inset-bottom))] sm:pb-[env(safe-area-inset-bottom)]'}`}>
      {openingChannel && <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
        <div className="flex max-w-sm items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-950 p-5 text-white">
          <Loader2 aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin" />
          <div className="min-w-0"><p className="font-medium">Ouverture du lecteur…</p><p className="truncate text-sm text-neutral-300">{openingChannel}</p></div>
        </div>
      </div>}
      <div className="app-shell container mx-auto p-2 sm:p-4">

        {/* Main Content */}
        {!tvMode && appHeader}
        <Tabs activationMode="manual" value={navSectionFor(activeTab, tvMode)} onValueChange={value => navigate(value as NavSection)} className="space-y-4">
          {tvMode ? appHeader : <MainNavigation onNavigate={navigate} />}

          <TabsContent value="continue" className="screen-enter"><Suspense fallback={<PanelFallback className="h-72" />}><LazyContinuePanel playlist={currentPlaylist} epgData={epgData} onBrowseLive={() => setActiveTab('channels')} onChannelSelect={handleChannelSelect} onOpenVod={openSavedVod} onResumeVod={req => { setActiveTab(req.kind === 'movie' ? 'movies' : 'series'); setVodResumeRequest({ ...req, nonce: Date.now() }); }} lockedGroups={parentalLockedGroups} unlocked={parentalUnlocked} /></Suspense></TabsContent>
          <TabsContent value="podcasts" className="screen-enter"><Suspense fallback={<PanelFallback className="h-72" />}><LazyPodcastsPanel tvMode={tvMode} /></Suspense></TabsContent>
          <TabsContent value={tvMode ? (activeTab === 'series' ? 'series' : 'movies') : 'vod'} className="screen-enter space-y-4">
            {!tvMode && <div role="group" aria-label="Type de contenu" className="inline-flex rounded-full border border-neutral-900 bg-card p-1">
              {(['movies', 'series'] as const).map(kind => <button
                key={kind}
                type="button"
                aria-pressed={activeTab === kind}
                onClick={() => setActiveTab(kind)}
                className={`min-h-10 rounded-full px-5 text-sm font-medium transition-colors ${activeTab === kind ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
              >{kind === 'movies' ? 'Films' : 'Séries'}</button>)}
            </div>}
            {activeTab === 'movies' && <div key="movies" className="screen-enter"><Suspense fallback={<PanelFallback className="h-72" />}><LazyMoviesPanel playlist={currentPlaylist} tmdbApiKey={appSettings.tmdbApiKey ?? null} resumeRequest={vodResumeRequest?.kind === 'movie' ? vodResumeRequest : undefined} onResumeHandled={() => setVodResumeRequest(null)} tvMode={tvMode} onSearch={() => setSearchOpen(true)} /></Suspense></div>}
            {activeTab === 'series' && <div key="series" className="screen-enter"><Suspense fallback={<PanelFallback className="h-72" />}><LazyVodLibrary key={`${currentPlaylist.id}:series`} playlist={currentPlaylist} kind="series" tmdbApiKey={appSettings.tmdbApiKey} resumeRequest={vodResumeRequest?.kind === 'series' ? vodResumeRequest : undefined} onResumeHandled={() => setVodResumeRequest(null)} tvMode={tvMode} onSearch={() => setSearchOpen(true)} /></Suspense></div>}
          </TabsContent>
          <TabsContent value="more" className="screen-enter space-y-4">
            {activeTab === 'more' && <div className="screen-enter"><MorePanel onOpen={openMore} /></div>}
            {(activeTab === 'replay' || activeTab === 'streaming') && <div key={activeTab} className="screen-enter space-y-4">
              <div className="flex items-center gap-3 text-foreground">
                <Button variant="outline" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900" onClick={() => setActiveTab('more')}><ArrowLeft aria-hidden="true" className="h-4 w-4 mr-2" />Plus</Button>
                <h2 className="text-xl font-semibold">{activeTab === 'replay' ? 'Replay' : 'Streaming'}</h2>
              </div>
              {activeTab === 'replay' ? <Suspense fallback={<PanelFallback className="h-72" />}><LazyReplayPanel playlist={currentPlaylist} epgData={epgData} /></Suspense> : <Suspense fallback={<PanelFallback className="h-72" />}><LazyStreamingPanel /></Suspense>}
            </div>}
          </TabsContent>

          <TabsContent value="channels" className="screen-enter space-y-4">
            {activeTab === 'channels' && tvMode && channelView === 'list' && <ErrorBoundary>
              <Suspense fallback={<PanelFallback className="h-[60vh]" />}>
              <LazyTvLiveScreen
                playlistId={currentPlaylist.id}
                groups={visibleGroups}
                zapList={playableChannels}
                favoriteIds={favoriteIds}
                epgData={epgData}
                currentChannel={currentChannel}
                lockedGroups={parentalLockedGroups}
                unlocked={parentalUnlocked}
                onPlay={handleChannelSelect}
                onLockedGroupSelect={() => setPinOpen(true)}
                onSearch={() => setSearchOpen(true)}
                onGuide={() => setChannelView('grid')}
                onMosaic={openMosaicPicker}
                onRecord={handleRecordRequest}
                preview={previewEnabled}
                previewMode={previewMode}
                onEdit={openChannelEditor}
                onOrganize={() => setGroupManagerOpen(true)}
                favoriteLists={favoriteLists}
                customGroupOrder={customGroupOrder}
              />
              </Suspense>
            </ErrorBoundary>}
            {activeTab === 'channels' && !(tvMode && channelView === 'list') &&
            <Card className={`live-channel-panel ${channelView === 'list' ? 'live-channel-list-panel' : ''} bg-neutral-950 border-neutral-900 rounded-[20px] flex flex-col min-h-0`}>
              <CardHeader className="live-view-toolbar shrink-0 flex-row flex-wrap items-center justify-end gap-3 px-4 py-3 space-y-0">
                <div className="flex w-full sm:w-auto items-center gap-1.5 shrink-0">
                  <Button variant={channelView === 'list' ? 'default' : 'outline'} size="sm" className={`min-h-11 ${channelView === 'list' ? '' : 'border-neutral-800 text-white hover:bg-neutral-900'}`} aria-pressed={channelView === 'list'} title="Vue liste" onClick={() => setChannelView('list')}><List aria-hidden="true" className="h-4 w-4 mr-1.5" />Liste</Button>
                  <Button variant={channelView === 'grid' ? 'default' : 'outline'} size="sm" className={`min-h-11 ${channelView === 'grid' ? '' : 'border-neutral-800 text-white hover:bg-neutral-900'}`} aria-pressed={channelView === 'grid'} title="Grille des programmes (guide TV)" onClick={() => setChannelView('grid')}><LayoutGrid aria-hidden="true" className="h-4 w-4 mr-1.5" />Grille</Button>
                  {currentChannel && <Button variant="outline" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900 shrink-0" onClick={() => { void AudioBridge?.pauseForVideo?.(); setWebSession(true); setActiveTab('player'); }} title={currentChannel.name}><Play aria-hidden="true" className="h-4 w-4 mr-2" />Lecteur</Button>}
                </div>
              </CardHeader>
              <CardContent className="live-view-content flex-1 min-h-0 pb-6">
                <ErrorBoundary>
                  {channelView === 'list' ? (
                    <Suspense fallback={<PanelFallback className="h-72" />}><LazyChannelList
                      playlistId={currentPlaylist.id}
                      groups={visibleGroups}
                      onChannelSelect={handleChannelSelect}
                      onNativeChannelSelect={handleNativeChannelSelect}
                      {...(currentChannel ? { currentChannel } : {})}
                      keyboardNavigationEnabled={appSettings.keyboardNavigation}
                      epgData={epgData}
                      lockedGroups={parentalLockedGroups}
                      unlocked={parentalUnlocked}
                      onLockedGroupSelect={() => setPinOpen(true)}
                      onMosaic={openMosaicPicker}
                      onRecord={handleRecordRequest}
                      onManageGroups={() => setGroupManagerOpen(true)}
                      onOrganizeFavorites={() => setFavoritesOrganizerOpen(true)}
                      onEditChannel={openChannelEditor}
                      favoriteLists={favoriteLists}
                      customGroupOrder={customGroupOrder}
                    /></Suspense>
                  ) : (
                    <Suspense fallback={<PanelFallback className="h-72" />}><LazyEPGGrid
                      channels={orderedChannels}
                      epgData={epgData}
                      guideState={epg}
                      onRetry={epg.retry}
                      onConfigure={() => setSettingsOpen(true)}
                      {...(currentChannel ? { currentChannel } : {})}
                      onSelectChannel={handleChannelSelect}
                      lockedGroups={parentalLockedGroups}
                      unlocked={parentalUnlocked}
                      {...(hasCatchup ? { catchupDays, onCatchup: playCatchup } : {})}
                      playlistId={currentPlaylist.id}
                      tvMode={tvMode}
                      preview={previewEnabled}
                      previewMode={previewMode}
                      onGuideSettings={channel => setGuideSettings({ channel: channel ?? null })}
                    /></Suspense>
                  )}
                </ErrorBoundary>
              </CardContent>
            </Card>}


          </TabsContent>

          {activeTab === 'loader' && <section aria-label="Gestion des listes" className="space-y-4">
            <div className="flex items-center gap-3 text-white"><Button variant="outline" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900" onClick={() => setActiveTab(tabBeforeLists)}><ArrowLeft aria-hidden="true" className="h-4 w-4 mr-2" />Retour</Button><h2 className="text-xl font-semibold">Mes listes</h2></div>
            <div className="flex flex-wrap items-center gap-2">
              <Suspense fallback={null}><LazyBackupPanel onRestored={refreshAfterRestore} showLabel className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900" /></Suspense>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900"><Download aria-hidden="true" className="h-4 w-4 mr-2" />Exporter</Button></DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                  <DropdownMenuLabel>Exporter la liste active</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => downloadPlaylist(currentPlaylist)}>Liste M3U</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void exportAdvanced({ includeQuality: true })}>Avec les qualités</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportAdvanced({ includeQuality: true, includeFavorites: true })}>Qualités et favoris</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportAdvanced({ includeQuality: true, includeFavorites: true, includeVariants: true, annotateVariants: true })}>Avec toutes les variantes</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportAdvanced({ includeQuality: true, includeFavorites: true, onlyFavorites: true })}>Favoris uniquement</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="order-2 md:order-1">
                <Suspense fallback={<PanelFallback className="h-64" />}><LazyPlaylistManager
                  playlists={allPlaylists}
                  currentId={currentPlaylist?.id}
                  onSelect={async (pl) => {
                    await openPlaylist(pl);
                    toast.success(`Liste ouverte : ${pl.name}`);
                  }}
                  onRefresh={refreshPlaylist}
                  onDeleted={async () => {
                    const refreshed = await getPlaylistsFromDB();
                    setAllPlaylists(refreshed);
                    if (currentPlaylist && !refreshed.find(p => p.id === currentPlaylist.id)) {
                      setCurrentChannel(null);
                      setCurrentPlaylist(refreshed[0] || null);
                      if (refreshed[0]) {
                        try {
                          const lastChannelId = await getLastChannelForPlaylist(refreshed[0].id);
                          if (lastChannelId) {
                            const ch = refreshed[0].channels.find(c => c.id === lastChannelId);
                            if (ch) setCurrentChannel(ch);
                          }
                        } catch (e) { console.warn('Restore last channel after delete failed', e); }
                      }
                    }
                  }}
                  onMutate={(updated) => {
                    setAllPlaylists(prev => prev.map(p => p.id === updated.id ? updated : p));
                    if (currentPlaylist && currentPlaylist.id === updated.id) {
                      setCurrentPlaylist(updated);
                    }
                  }}
                /></Suspense>
              </div>
              <div className="order-1 md:order-2">
                <Suspense fallback={<PanelFallback className="h-16" />}><LazyPlaylistLoader onPlaylistLoaded={(pl) => handlePlaylistLoaded(pl)} /></Suspense>
              </div>
            </div>
          </section>}
        </Tabs>

        {/* Lecteur web : reste monté quand on change d'onglet et devient un mini-lecteur. */}
        {webSession && currentChannel && <section aria-label="Lecteur" className={activeTab === 'player' ? 'mt-4 space-y-4' : ''}>
          {activeTab === 'player' && <div className="flex items-center gap-3 text-white min-w-0"><Button variant="outline" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900 shrink-0" onClick={() => setActiveTab('channels')}><ArrowLeft aria-hidden="true" className="h-4 w-4 mr-2" />Chaînes</Button><span className="truncate text-sm text-neutral-300">{currentChannel?.name}</span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {currentChannel && <Button variant="outline" size="sm" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900" aria-label="Mosaïque" onClick={() => openMosaicPicker(currentChannel)}><Grid2X2 aria-hidden="true" className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Mosaïque</span></Button>}
                {currentChannel && <Button variant="outline" size="sm" className="min-h-11 border-neutral-800 text-white hover:bg-neutral-900" aria-label="Enregistrer" onClick={() => { setRecordingsChannel(currentChannel); setRecordingsOpen(true); }}><CircleDot aria-hidden="true" className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Enregistrer</span></Button>}
              </div>
            </div>}
          <div ref={webPlayerSection} className={activeTab === 'player' ? 'grid grid-cols-1 lg:grid-cols-3 gap-6 lg:h-[calc(100dvh-200px)]' : ''}>
            <div className={activeTab === 'player' ? 'lg:col-span-2' : 'glass screen-enter fixed right-3 bottom-[calc(92px+env(safe-area-inset-bottom))] sm:bottom-4 z-30 w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/10'}>
              {activeTab !== 'player' && <div className="flex items-center gap-2 px-3 py-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" aria-hidden="true" />
                <button type="button" onClick={() => setActiveTab('player')} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-foreground hover:text-primary" title="Agrandir le lecteur">{currentChannel.name}</button>
                <button type="button" onClick={() => setActiveTab('player')} aria-label="Agrandir le lecteur" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"><Maximize2 className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" onClick={() => setWebSession(false)} aria-label="Fermer le mini-lecteur" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>}
                <ErrorBoundary>
                  <Suspense fallback={<PanelFallback className="aspect-video" />}>
                  <LazyVideoPlayer
                    {...(currentChannel ? { channel: currentChannel } : {})}
                    className={activeTab === 'player' ? 'w-full lg:h-full' : 'w-full'}
                    autoplay={appSettings.autoplay}
                    keyboardNavigation={appSettings.keyboardNavigation && activeTab === 'player'}
                    onNextChannel={onNextChannel}
                    onPrevChannel={onPrevChannel}
                    onZapToNumber={zapToNumber}
                    onNativePlay={channel => { void openNativeChannel(channel); }}
                    nativeZap={nativeZap}
                    mini={activeTab !== 'player'}
                  />
                  </Suspense>
                </ErrorBoundary>
            </div>
            {activeTab === 'player' && <>
              {/* Liste des chaînes Sidebar */}
              <div>
                <Card className="bg-neutral-950 border-neutral-900 rounded-[20px] h-full flex flex-col min-h-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-white text-[13px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Chaînes</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 pb-6">
                    <ErrorBoundary>
                      <Suspense fallback={<PanelFallback className="h-72" />}>
                      <LazyChannelList
                        playlistId={currentPlaylist.id}
                        groups={visibleGroups}
                        onChannelSelect={handleChannelSelect}
                      onNativeChannelSelect={channel => { void openNativeChannel(channel); }}
                        {...(currentChannel ? { currentChannel } : {})}
                        keyboardNavigationEnabled={false}
                        epgData={epgData}
                        lockedGroups={parentalLockedGroups}
                        unlocked={parentalUnlocked}
                        onLockedGroupSelect={() => setPinOpen(true)}
                        onMosaic={openMosaicPicker}
                        onRecord={channel => { setRecordingsChannel(channel); setRecordingsOpen(true); }}
                        favoriteLists={favoriteLists}
                        customGroupOrder={customGroupOrder}
                      />
                      </Suspense>
                    </ErrorBoundary>
                  </CardContent>
                </Card>
              </div>
            </>}
          </div>
        </section>}
      </div>
      {settingsOpen && <Suspense fallback={null}><LazySettingsPanel
        open
        onOpenChange={setSettingsOpen}
        currentSettings={appSettings}
        onSettingsChange={(s) => {
          setAppSettings(s);
          // Bascule de persistance de la télémétrie (sans dialogue bloquant).
          getTelemetryLogger().then(m => {
            const logger = m.globalTelemetryLogger;
            if (s.telemetryPersistence === false && logger.isPersisting()) {
              logger.disablePersistence();
              toast.info('Persistance de la télémétrie désactivée.');
            } else if (s.telemetryPersistence !== false && !logger.isPersisting()) {
              logger.enablePersistence();
            }
          }).catch(()=>{});
        }}
      /></Suspense>}
      <ParentalPinDialog
        open={pinOpen}
        pin={appSettings.parentalPin ?? ''}
        onOpenChange={setPinOpen}
        onUnlock={() => { setParentalUnlocked(true); void maybeUpgradePin(appSettings.parentalPin, p => StorageManager.saveSettings(p)); }}
      />

      {/* Mosaïque — accès contextuel depuis une chaîne */}
      <Dialog open={mosaicChannel !== null} onOpenChange={open => { if (!open) setMosaicChannel(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto border-neutral-800 bg-neutral-950 text-white">
          <DialogHeader>
            <DialogTitle>Mosaïque</DialogTitle>
          </DialogHeader>
          {currentPlaylist && mosaicChannel && <MosaicPicker key={mosaicChannel.id} playlist={currentPlaylist} initialChannel={mosaicChannel} lockedGroups={parentalLockedGroups} unlocked={parentalUnlocked} />}
        </DialogContent>
      </Dialog>

      {xtreamOpen && <Suspense fallback={null}><LazyXtreamLoginDialog open onOpenChange={setXtreamOpen} hideTrigger onPlaylistLoaded={handlePlaylistLoaded} /></Suspense>}
      {stalkerOpen && <Suspense fallback={null}><LazyStalkerLoginDialog open onOpenChange={setStalkerOpen} hideTrigger onPlaylistLoaded={handlePlaylistLoaded} /></Suspense>}
      {/* Recherche globale unifiée */}
      {currentPlaylist && <GroupManagerDialog
        open={groupManagerOpen}
        onOpenChange={setGroupManagerOpen}
        groups={customizedGroups}
        hidden={hiddenGroups}
        onChange={updateHiddenGroups}
        custom={customization}
        onCustomChange={updateCustomization}
        hiddenChannelIds={hiddenChannels}
        onUnhideChannels={ids => { const drop = new Set(ids); updateHiddenChannels(hiddenChannels.filter(id => !drop.has(id))); }}
      />}
      <ChannelEditorDialog
        channel={editingChannel}
        edit={editingChannel ? customization.edits[editingChannel.id] : undefined}
        onOpenChange={open => { if (!open) setEditingChannel(null); }}
        onSave={edit => { if (editingChannel) saveChannelEdit(editingChannel, edit); }}
        onHide={channel => { updateHiddenChannels([...new Set([...hiddenChannels, channel.id])]); toast.success(`« ${channel.name} » masquée. Réaffiche-la depuis « Organiser la liste ».`); }}
      />
      {currentPlaylist && healthOpen && <Suspense fallback={null}><LazyChannelHealthDialog
        key={currentPlaylist.id}
        open
        onOpenChange={setHealthOpen}
        visibleChannels={orderedChannels}
        favoriteIds={favoriteIds}
        hiddenChannelIds={hiddenChannels}
        onHide={ids => { updateHiddenChannels([...new Set([...hiddenChannels, ...ids])]); toast.success(`${ids.length} chaîne${ids.length > 1 ? 's' : ''} masquée${ids.length > 1 ? 's' : ''}.`); }}
        onShowAll={() => { updateHiddenChannels([]); toast.success('Toutes les chaînes sont à nouveau affichées.'); }}
      /></Suspense>}
      {currentPlaylist && <FavoritesOrganizerDialog open={favoritesOrganizerOpen} onOpenChange={setFavoritesOrganizerOpen} channels={customizedGroups.flatMap(g => g.channels)} />}
      {searchOpen && <Suspense fallback={null}><LazyGlobalSearchDialog
        open
        onOpenChange={setSearchOpen}
        playlist={currentPlaylist}
        onSelectChannel={handleChannelSelect}
        onSelectTab={setActiveTab}
        onSelectVod={item => openSavedVod(item.kind, item)}
        lockedGroups={parentalLockedGroups}
        unlocked={parentalUnlocked}
        onLockedChannelSelect={() => setPinOpen(true)}
      /></Suspense>}

      {/* Enregistrements (DVR) — accès contextuel ou depuis l'en-tête */}
      {currentPlaylist && guideSettings && <EpgSettingsDialog
        open
        onOpenChange={open => { if (!open) setGuideSettings(null); }}
        playlist={currentPlaylist}
        settings={appSettings}
        epgData={epgData}
        initialChannel={guideSettings.channel}
      />}
      <Dialog open={recordingsOpen} onOpenChange={setRecordingsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto border-neutral-800 bg-neutral-950 text-white">
          <DialogHeader>
            <DialogTitle>Enregistrements</DialogTitle>
          </DialogHeader>
          {currentPlaylist && <Suspense fallback={<PanelFallback className="h-64" />}><LazyRecordings channels={playableChannels} initialChannel={recordingsChannel && playableChannels.some(c => c.id === recordingsChannel.id) ? recordingsChannel : undefined} /></Suspense>}
        </DialogContent>
      </Dialog>
      <MiniAudioPlayer tv={tvMode} onOpenPodcasts={() => setActiveTab('podcasts')} />
    </div>
  );
}
