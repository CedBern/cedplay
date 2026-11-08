import { useState, useMemo, useEffect } from 'react';
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
import { NativePlayerBridge } from '@/utils/nativePlayer';
import type { Channel, PlaylistInfo } from '@/types/channel';
import { Search, Tv, Film, MonitorPlay, ExternalLink, Play, Lock } from 'lucide-react';

export interface GlobalSearchDialogProps {
  open: boolean;
  tvMode?: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: PlaylistInfo | null;
  onSelectChannel: (channel: Channel) => void;
  onSelectTab: (tab: string) => void;
  onSelectVod?: ((item: VodWatchlistItem) => void) | undefined;
  /** Groupes adultes verrouillés (contrôle parental). */
  lockedGroups?: string[] | undefined;
  unlocked?: boolean | undefined;
  /** Appelé quand l'utilisateur clique sur une chaîne verrouillée (ouvre le code). */
  onLockedChannelSelect?: (() => void) | undefined;
}

export function GlobalSearchDialog({
  open,
  tvMode = false,
  onOpenChange,
  playlist,
  onSelectChannel,
  onSelectTab,
  onSelectVod,
  lockedGroups,
  unlocked,
  onLockedChannelSelect,
}: GlobalSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [watchlist, setWatchlist] = useState<VodWatchlistItem[]>([]);
  const [catalog, setCatalog] = useState<VodWatchlistItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [vodLimit, setVodLimit] = useState(12);
  const account = useMemo(() => playlist ? getXtreamAccount(playlist) : null, [playlist]);
  const debouncedQuery = useDebounce(query, 250);
  const catalogEnabled = open && debouncedQuery.trim().length >= 2;

  useEffect(() => { setCatalog([]); setCatalogError(''); setRefresh(0); }, [playlist?.id]);
  useEffect(() => { setVodLimit(12); }, [query]);
  useEffect(() => {
    if (!catalogEnabled || !account || !playlist) { setCatalogLoading(false); return; }
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError('');
    setCatalog([]);
    const kinds = ['movie', 'series'] as const;
    void Promise.allSettled(kinds.map(async kind => {
      const items = await searchCatalogSource(account, playlist.id, kind, controller.signal);
      if (!controller.signal.aborted) setCatalog(current => [...current.filter(item => item.kind !== kind), ...items]);
    })).then(results => {
      if (controller.signal.aborted) return;
      const failed = kinds.filter((_, index) => results[index].status === 'rejected');
      if (failed.length) setCatalogError(`Catalogue ${failed.map(kind => kind === 'movie' ? 'films' : 'séries').join(' et ')} indisponible. Les autres résultats restent accessibles.`);
      setCatalogLoading(false);
    });
    return () => controller.abort();
  }, [catalogEnabled, account, playlist, refresh]);

  useEffect(() => {
    if (open) {
      setQuery('');
      void getVodWatchlistFromDB().then(setWatchlist).catch(() => {});
    }
  }, [open]);

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
    return vodIndex.filter(({ name }) => words.every(word => name.includes(word))).map(({ item }) => item);
  }, [cleanQuery, vodIndex]);

  const hasResults = matchedChannels.length > 0 || matchedLockedChannels.length > 0 || matchedStreaming.length > 0 || matchedReplay.length > 0 || matchedVod.length > 0;

  const handleOpenPlatform = (platform: (typeof streamingPlatforms)[number]) => {
    // Application officielle d'abord (accueil si la page n'est pas un App Link), sinon navigateur.
    void NativePlayerBridge.openWeb(platform.url, undefined, platform.androidPackages, true);
    onOpenChange(false);
  };

  // Page d'un programme de replay : l'app officielle seulement si elle gère l'URL exacte,
  // sinon navigateur — un lancement à l'aveugle perdrait la recherche du programme.
  const handleOpenReplay = (url: string, platformId: string) => {
    const packages = replayPlatforms.find(rp => rp.id === platformId)?.androidPackages;
    void NativePlayerBridge.openWeb(url, undefined, packages);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onEscapeKeyDown={event => {
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
            remoteActivation={tvMode}
            autoFocus
            aria-label="Rechercher"
            placeholder="Chaînes, direct, films, séries, plateformes…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9 bg-neutral-900 border-neutral-800 text-white placeholder:text-neutral-500 min-h-11"
          />
        </div>

        {catalogLoading && <p role="status" className="text-xs text-primary">Chargement des catalogues films et séries…</p>}
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
            <p className="text-xs text-neutral-400">Recherches populaires :</p>
            <div className="flex flex-wrap gap-2">
              {['TF1', 'France 2', 'M6', 'Canal+', 'Arte', 'Netflix', 'YouTube', 'Disney+'].map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setQuery(tag)}
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
              {matchedChannels.map(channel => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => {
                    onSelectChannel(channel);
                    onOpenChange(false);
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
                    {channel.quality && <Badge variant="outline" className="text-[10px] border-neutral-700">{channel.quality}</Badge>}
                    <Play className="h-4 w-4 text-primary" />
                  </div>
                </button>
              ))}
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
              {matchedLockedChannels.map(channel => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => onLockedChannelSelect?.()}
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
              ))}
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
              {matchedStreaming.map(platform => (
                <button
                  key={platform.id}
                  type="button"
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
              ))}
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
              {matchedReplay.map(ch => (
                <button
                  key={ch.id}
                  type="button"
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
              ))}
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
              {matchedVod.slice(0, vodLimit).map(item => (
                <button
                  key={`${item.kind}:${item.id}`}
                  type="button"
                  onClick={() => {
                    if (onSelectVod) onSelectVod(item);
                    else onSelectTab(item.kind === 'series' ? 'series' : 'movies');
                    onOpenChange(false);
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
              ))}
            </div>
            {matchedVod.length > vodLimit && <button type="button" className="min-h-11 px-3 rounded-lg bg-white/10 text-sm" onClick={() => setVodLimit(limit => limit + 24)}>Afficher davantage de titres</button>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
