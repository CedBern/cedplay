import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChannelLogo } from '@/components/ChannelLogo';
import { PlatformLogo } from '@/components/PlatformLogo';
import { streamingPlatforms } from '@/data/streamingPlatforms';
import { replayChannels, replayPlatforms } from '@/data/replayChannels';
import { getVodWatchlistFromDB, type VodWatchlistItem } from '@/utils/idb';
import { getXtreamAccount } from '@/utils/xtreamCatalog';
import { invalidateSearchCatalog, searchCatalogSource } from '@/utils/catalogSearch';
import { normalizeForCompare } from '@/utils/titleNormalize';
import { useDebounce } from '@/hooks/useDebounce';
import { useAdultVodCategories } from '@/hooks/useAdultVodCategories';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { channelQuality } from '@/utils/channelQuality';
import { clearSearchHistory, forgetSearch, readSearchHistory, rememberSearch } from '@/utils/searchHistory';
import type { Channel, PlaylistInfo } from '@/types/channel';
import { Search, Tv, Film, MonitorPlay, ExternalLink, Play, Lock, History, X } from 'lucide-react';

export interface GlobalSearchDialogProps {
  open: boolean;
  tvMode?: boolean;
  initialQuery?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  onOpenChange: (open: boolean) => void;
  playlist: PlaylistInfo | null;
  onSelectChannel: (channel: Channel) => void;
  onSelectTab: (tab: string) => void;
  onSelectVod?: ((item: VodWatchlistItem) => void) | undefined;
  /** Groupes adultes verrouillés (contrôle parental). */
  lockedGroups?: string[] | undefined;
  unlocked?: boolean | undefined;
  /** Contrôle parental actif : les catégories VOD adultes sont exclues des résultats. */
  parentalEnabled?: boolean | undefined;
  /** Appelé quand l'utilisateur clique sur une chaîne verrouillée (ouvre le code). */
  onLockedChannelSelect?: (() => void) | undefined;
}

export function GlobalSearchDialog({
  open,
  tvMode = false,
  initialQuery,
  onQueryChange,
  onOpenChange,
  playlist,
  onSelectChannel,
  onSelectTab,
  onSelectVod,
  lockedGroups,
  unlocked,
  parentalEnabled,
  onLockedChannelSelect,
}: GlobalSearchDialogProps) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<VodWatchlistItem[]>([]);
  const [catalog, setCatalog] = useState<VodWatchlistItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogProgress, setCatalogProgress] = useState<{ done: number; total: number } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [vodLimit, setVodLimit] = useState(12);

  const updateQuery = useCallback((next: string) => {
    setQuery(next);
    onQueryChange?.(next);
  }, [onQueryChange]);
  const account = useMemo(() => playlist ? getXtreamAccount(playlist) : null, [playlist]);
  // Verrou VOD : les catégories du catalogue ne voyagent pas avec les titres, le hook
  // les résout une fois puis filtre les résultats (fermé tant qu'elles sont inconnues).
  const adultVod = useAdultVodCategories(playlist, parentalEnabled === true && !unlocked);
  const debouncedQuery = useDebounce(query, 250);
  const catalogEnabled = open && debouncedQuery.trim().length >= 2;

  useEffect(() => { setCatalog([]); setCatalogError(''); setRefresh(0); }, [playlist?.id]);
  useEffect(() => { setVodLimit(12); }, [query]);
  useEffect(() => {
    if (!catalogEnabled || !account || !playlist) { setCatalogLoading(false); setCatalogProgress(null); return; }
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError('');
    setCatalog([]);
    setCatalogProgress(null);
    const kinds = ['movie', 'series'] as const;
    // Films puis séries, une seule requête à la fois : le fournisseur VOD coupe
    // les requêtes parallèles, et la box n'aime pas huit téléchargements simultanés.
    void (async () => {
      const failed: (typeof kinds[number])[] = [];
      let hadResults = false;
      for (const kind of kinds) {
        if (controller.signal.aborted) return;
        try {
          const items = await searchCatalogSource(account, playlist.id, kind, {
            signal: controller.signal,
            query: debouncedQuery,
            // Les résultats arrivent catégorie par catégorie : l'utilisateur voit les
            // premières correspondances sans attendre la fin de l'exploration.
            onResults: partial => {
              if (partial.length > 0) hadResults = true;
              if (!controller.signal.aborted) setCatalog(current => [...current.filter(item => item.kind !== kind), ...partial]);
            },
            onProgress: (done, total) => {
              if (!controller.signal.aborted) setCatalogProgress({ done, total });
            },
          });
          if (items.length > 0) hadResults = true;
          if (!controller.signal.aborted) setCatalog(current => [...current.filter(item => item.kind !== kind), ...items]);
        } catch {
          if (controller.signal.aborted) return;
          failed.push(kind);
        }
      }
      if (controller.signal.aborted) return;
      // Une panne des séries ne doit pas masquer des films déjà trouvés.
      if (failed.length && !hadResults) setCatalogError(`Catalogue ${failed.map(kind => kind === 'movie' ? 'films' : 'séries').join(' et ')} indisponible. Les autres résultats restent accessibles.`);
      setCatalogLoading(false);
      setCatalogProgress(null);
    })();
    return () => controller.abort();
  }, [catalogEnabled, account, playlist, refresh, debouncedQuery]);

  useEffect(() => {
    if (open) {
      const q = initialQuery ?? '';
      setQuery(q);
      onQueryChange?.(q);
      setRecent(readSearchHistory());
      void getVodWatchlistFromDB().then(setWatchlist).catch(() => {});
    }
  }, [open, initialQuery, onQueryChange]);

  // Une recherche menée jusqu'à un résultat rejoint l'historique de l'appareil :
  // la rouvrir ne demande plus de la retaper.
  const rememberQuery = () => setRecent(rememberSearch(query));
  const handleOpenChange = (next: boolean) => {
    if (!next) rememberQuery();
    onOpenChange(next);
  };

  const cleanQuery = query.trim().toLowerCase();

  // 1. Chaînes en direct
  const lockedSet = useMemo(() => (lockedGroups && !unlocked ? new Set(lockedGroups) : null), [lockedGroups, unlocked]);
  const matchedChannels = useMemo(() => {
    if (!cleanQuery || !playlist) return [];
    return playlist.channels
      .filter(c => (!lockedSet || !lockedSet.has(c.group || '')) && (c.name.toLowerCase().includes(cleanQuery) || c.group?.toLowerCase().includes(cleanQuery)))
      .slice(0, 8);
  }, [cleanQuery, playlist, lockedSet]);

  // Chaînes verrouillées correspondant à la recherche : signalées par un cadenas.
  const matchedLockedChannels = useMemo(() => {
    if (!cleanQuery || !playlist || !lockedSet) return [];
    return playlist.channels
      .filter(c => lockedSet.has(c.group || '') && (c.name.toLowerCase().includes(cleanQuery) || c.group?.toLowerCase().includes(cleanQuery)))
      .slice(0, 3);
  }, [cleanQuery, playlist, lockedSet]);

  // 2. Plateformes de streaming officielles
  const matchedStreaming = useMemo(() => {
    if (!cleanQuery) return [];
    return streamingPlatforms
      .filter(p =>
        p.name.toLowerCase().includes(cleanQuery) ||
        (p.badge && p.badge.toLowerCase().includes(cleanQuery)) ||
        (p.note && p.note.toLowerCase().includes(cleanQuery))
      )
      .slice(0, 6);
  }, [cleanQuery]);

  // 3. Replay officiel français
  const matchedReplay = useMemo(() => {
    if (!cleanQuery) return [];
    return replayChannels
      .filter(r => r.name.toLowerCase().includes(cleanQuery) || r.platform.toLowerCase().includes(cleanQuery))
      .slice(0, 6);
  }, [cleanQuery]);

  // 4. Catalogue entier du compte actif, complété par les titres enregistrés.
  const vodIndex = useMemo(() => {
    const items = new Map<string, VodWatchlistItem>();
    for (const item of [...watchlist, ...catalog]) {
      if (item.playlistId === playlist?.id) items.set(`${item.kind}:${item.id}`, item);
    }
    return [...items.values()].map(item => ({ item, name: normalizeForCompare(item.name) }));
  }, [catalog, watchlist, playlist?.id]);
  const matchedVod = useMemo(() => {
    if (!cleanQuery) return [];
    const words = normalizeForCompare(cleanQuery).split(' ').filter(Boolean);
    if (!words.length) return [];
    return vodIndex
      .filter(({ item }) => !adultVod.isAdult(item.kind, item.categoryId))
      .filter(({ name }) => words.every(word => name.includes(word)))
      .map(({ item }) => item);
  }, [cleanQuery, vodIndex, adultVod]);

  const hasResults = matchedChannels.length > 0 || matchedLockedChannels.length > 0 || matchedStreaming.length > 0 || matchedReplay.length > 0 || matchedVod.length > 0;
  const firstResultKind = matchedChannels.length > 0 ? 'channel' : matchedLockedChannels.length > 0 ? 'locked' : matchedStreaming.length > 0 ? 'streaming' : matchedReplay.length > 0 ? 'replay' : matchedVod.length > 0 ? 'vod' : null;

  const handleOpenPlatform = (platform: (typeof streamingPlatforms)[number]) => {
    // Application officielle d'abord (accueil si la page n'est pas un App Link), sinon navigateur.
    void NativePlayerBridge.openWeb(platform.url, undefined, platform.androidPackages, true);
    handleOpenChange(false);
  };

  // Page d'un programme de replay : l'app officielle seulement si elle gère l'URL exacte,
  // sinon navigateur — un lancement à l'aveugle perdrait la recherche du programme.
  const handleOpenReplay = (url: string, platformId: string) => {
    const packages = replayPlatforms.find(rp => rp.id === platformId)?.androidPackages;
    void NativePlayerBridge.openWeb(url, undefined, packages);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-remote-self onEscapeKeyDown={event => {
        // Radix écoute Retour/Escape en capture, avant le champ : le premier
        // appui quitte la saisie, le suivant peut fermer la recherche.
        if (tvMode && document.activeElement?.matches('input[data-remote-input]:not([readonly])')) event.preventDefault();
      }} className="grid-cols-1 min-w-0 w-[calc(100%-1.5rem)] bg-neutral-950 text-white border-neutral-800 max-h-[85dvh] overflow-y-auto sm:max-w-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5 text-primary" />
            Recherche unifiée
          </DialogTitle>
          <DialogDescription className="text-xs text-neutral-400">
            Rechercher les chaînes, les films, les séries, les plateformes et le replay de la liste active.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          <Input
            ref={inputRef}
            remoteActivation={tvMode}
            autoFocus
            aria-label="Rechercher"
            placeholder="Chaînes, direct, films, séries, plateformes…"
            value={query}
            onChange={e => updateQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                const target = document.querySelector<HTMLElement>(
                  '[data-search-first-result], [data-recent-search-first], [data-popular-search-first]'
                );
                if (target) {
                  e.preventDefault();
                  target.focus();
                }
              }
            }}
            className="pl-9 bg-neutral-900 border-neutral-800 text-white placeholder:text-neutral-500 min-h-11"
          />
        </div>

        {catalogLoading && <p role="status" className="text-xs text-primary">Recherche dans les catégories films et séries…{catalogProgress ? ` (${catalogProgress.done}/${catalogProgress.total})` : ''}</p>}
        {catalogError && <div role="alert" className="text-xs text-amber-300 space-y-2"><p>{catalogError}</p><button type="button" className="min-h-11 px-3 border border-neutral-700 rounded-lg" onClick={() => { if (account) invalidateSearchCatalog(account); setRefresh(value => value + 1); }}>Réessayer les catalogues</button></div>}
        {open && account && cleanQuery.length === 1 && <p className="text-xs text-neutral-400">Saisis au moins deux caractères pour chercher dans tous les films et séries.</p>}
        {!account && cleanQuery && <p className="text-xs text-neutral-400">Sans compte Xtream lié, la recherche VOD porte sur Ma liste.</p>}
        {cleanQuery.length > 0 && !hasResults && !catalogLoading && (!account || !catalogEnabled || debouncedQuery === query) && (
          <div className="text-center py-8 text-neutral-400 text-sm">
            <p>Aucun résultat pour « {query} »</p>
            <p className="text-xs text-neutral-500 mt-1">Essaie avec un nom de chaîne (TF1, M6), une plateforme (Netflix, Prime) ou un titre.</p>
          </div>
        )}

        {/* Suggestions initiales si vide */}
        {cleanQuery.length === 0 && (
          <div className="space-y-4 py-2">
            {/* Historique de l'appareil d'abord : c'est la recherche qu'on veut refaire. */}
            {recent.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <History className="h-3.5 w-3.5" aria-hidden="true" />Recherches récentes
                  </p>
                  <button
                    type="button"
                    onClick={() => setRecent(clearSearchHistory())}
                    className="rounded-full px-2 py-1 text-xs text-neutral-500 hover:bg-white/10 hover:text-white"
                  >
                    Effacer
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((entry, idx) => (
                    <span key={entry} className="inline-flex items-center overflow-hidden rounded-full border border-neutral-800 bg-white/5">
                      <button
                        type="button"
                        onClick={() => updateQuery(entry)}
                        title={entry}
                        {...(idx === 0 ? { 'data-recent-search-first': true } : {})}
                        onKeyDown={e => {
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            inputRef.current?.focus();
                          }
                        }}
                        className="block max-w-[240px] truncate px-2.5 py-1.5 text-xs text-neutral-200 hover:text-white"
                      >
                        {entry}
                      </button>
                      <button
                        type="button"
                        tabIndex={tvMode ? -1 : 0}
                        aria-label={`Retirer « ${entry} » de l'historique`}
                        onClick={() => setRecent(forgetSearch(entry))}
                        className={`px-1.5 py-1.5 text-neutral-500 hover:text-white ${tvMode ? 'pointer-events-none opacity-40' : ''}`}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-neutral-400">Recherches populaires :</p>
            <div className="flex flex-wrap gap-2">
              {['TF1', 'France 2', 'M6', 'Canal+', 'Arte', 'Netflix', 'YouTube', 'Disney+'].map((tag, idx) => (
                <button
                  key={tag}
                  type="button"
                  {...(idx === 0 ? { 'data-popular-search-first': true } : {})}
                  onClick={() => updateQuery(tag)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp' && recent.length === 0) {
                      e.preventDefault();
                      inputRef.current?.focus();
                    }
                  }}
                  className="text-xs bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white px-2.5 py-1.5 rounded-full border border-neutral-800"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Résultats Chaînes TV Direct */}
        {matchedChannels.length > 0 && (
          <div className="space-y-2 mt-2">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Tv className="h-3.5 w-3.5" /> Chaînes en direct ({matchedChannels.length})
            </h3>
            <div className="space-y-1">
              {matchedChannels.map((channel, idx) => {
                const isFirst = firstResultKind === 'channel' && idx === 0;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    {...(isFirst ? { 'data-search-first-result': true } : {})}
                    onKeyDown={isFirst ? e => { if (e.key === 'ArrowUp') { e.preventDefault(); inputRef.current?.focus(); } } : undefined}
                    onClick={() => {
                      rememberQuery();
                      onSelectChannel(channel);
                      handleOpenChange(false);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-neutral-900 hover:border-primary/40 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{channel.name}</p>
                        {channel.group && <p className="text-xs text-neutral-400 truncate">{channel.group}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {channelQuality(channel) && <Badge variant="outline" className="text-[10px] border-neutral-700">{channelQuality(channel)}</Badge>}
                      <Play className="h-4 w-4 text-primary" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Chaînes verrouillées (contrôle parental) : jamais jouées sans code */}
        {matchedLockedChannels.length > 0 && (
          <div className="space-y-2 mt-2">
            <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Chaînes protégées ({matchedLockedChannels.length})
            </h3>
            <div className="space-y-1">
              {matchedLockedChannels.map((channel, idx) => {
                const isFirst = firstResultKind === 'locked' && idx === 0;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    {...(isFirst ? { 'data-search-first-result': true } : {})}
                    onKeyDown={isFirst ? e => { if (e.key === 'ArrowUp') { e.preventDefault(); inputRef.current?.focus(); } } : undefined}
                    onClick={() => { rememberQuery(); onLockedChannelSelect?.(); }}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-amber-500/30 text-left transition-colors"
                    title="Contenu protégé par le code parental"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{channel.name}</p>
                        {channel.group && <p className="text-xs text-neutral-400 truncate">{channel.group}</p>}
                      </div>
                    </div>
                    <Lock className="h-4 w-4 text-amber-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Résultats Streaming */}
        {matchedStreaming.length > 0 && (
          <div className="space-y-2 mt-4">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" /> Plateformes de streaming ({matchedStreaming.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {matchedStreaming.map((platform, idx) => {
                const isFirst = firstResultKind === 'streaming' && idx === 0;
                return (
                  <button
                    key={platform.id}
                    type="button"
                    {...(isFirst ? { 'data-search-first-result': true } : {})}
                    onKeyDown={isFirst ? e => { if (e.key === 'ArrowUp') { e.preventDefault(); inputRef.current?.focus(); } } : undefined}
                    onClick={() => handleOpenPlatform(platform)}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-neutral-900 hover:border-primary/40 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <PlatformLogo platformId={platform.id} size="sm" className="h-6 w-6 rounded shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{platform.name}</p>
                        {platform.note && <p className="text-[11px] text-neutral-400 truncate">{platform.note}</p>}
                      </div>
                    </div>
                    {platform.badge && <Badge variant="outline" className="text-[10px] border-neutral-700 shrink-0">{platform.badge}</Badge>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Résultats Replay */}
        {matchedReplay.length > 0 && (
          <div className="space-y-2 mt-4">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Tv className="h-3.5 w-3.5" /> Replay officiel ({matchedReplay.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {matchedReplay.map((ch, idx) => {
                const isFirst = firstResultKind === 'replay' && idx === 0;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    {...(isFirst ? { 'data-search-first-result': true } : {})}
                    onKeyDown={isFirst ? e => { if (e.key === 'ArrowUp') { e.preventDefault(); inputRef.current?.focus(); } } : undefined}
                    onClick={() => handleOpenReplay(ch.url, ch.platform)}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-neutral-900 hover:border-primary/40 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-6 w-6 rounded flex items-center justify-center font-bold text-xs text-white" style={{ backgroundColor: ch.color }}>
                        {ch.platform[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{ch.name}</p>
                        <p className="text-[11px] text-neutral-400 truncate">{ch.platform}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-neutral-700 shrink-0">Replay</Badge>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Résultats VOD Ma Liste */}
        {matchedVod.length > 0 && (
          <div className="space-y-2 mt-4">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Film className="h-3.5 w-3.5" /> Films et séries ({matchedVod.length})
            </h3>
            <div className="space-y-1">
              {matchedVod.slice(0, vodLimit).map((item, idx) => {
                const isFirst = firstResultKind === 'vod' && idx === 0;
                return (
                  <button
                    key={`${item.kind}:${item.id}`}
                    type="button"
                    {...(isFirst ? { 'data-search-first-result': true } : {})}
                    onKeyDown={isFirst ? e => { if (e.key === 'ArrowUp') { e.preventDefault(); inputRef.current?.focus(); } } : undefined}
                    onClick={() => {
                      rememberQuery();
                      // La fiche s'ouvre par-dessus la recherche : la refermer ramène aux
                      // résultats, sans retaper la requête ni perdre la position.
                      if (onSelectVod) { onSelectVod(item); return; }
                      onSelectTab(item.kind === 'series' ? 'series' : 'movies');
                      handleOpenChange(false);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-neutral-900 hover:border-primary/40 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative h-12 w-8 rounded bg-neutral-900 flex items-center justify-center shrink-0 overflow-hidden">
                        {item.kind === 'series' ? <MonitorPlay className="h-4 w-4 text-primary" /> : <Film className="h-4 w-4 text-primary" />}
                        {item.poster && <img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-neutral-400">{item.kind === 'series' ? 'Série' : 'Film'}{item.rating ? ` · ★ ${item.rating}` : ''}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">Voir</Badge>
                  </button>
                );
              })}
            </div>
            {matchedVod.length > vodLimit && <button type="button" className="min-h-11 px-3 rounded-lg bg-white/10 text-sm" onClick={() => setVodLimit(limit => limit + 24)}>Afficher davantage de titres</button>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
