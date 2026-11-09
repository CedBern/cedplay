import { CHANNEL_QUALITIES, channelQuality, selectChannelQuality } from '@/utils/channelQuality';
import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Search, Heart, Play, Tv, Zap, Lock, Grid2X2, CircleDot, PlayCircle, SlidersHorizontal, ListOrdered, Pencil } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { toast } from 'sonner';
import { ChannelLogo } from '@/components/ChannelLogo';
import { NativePlayerBridge, buildNativeZap } from '@/utils/nativePlayer';
// Virtual list
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - type resolution sometimes lags in certain editors
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual';
import { Channel, ChannelGroup, PlaylistInfo } from '@/types/channel';
import { EPGData } from '@/types/epg';
import { StorageManager } from '@/utils/storage';
import { saveFavoritesToDB, getFavoritesFromDB, getSearchMode, saveSearchMode, getPlayHistory, getMeta, setMetaMany, getSettingsFromDB } from '@/utils/idb';
import { downloadPlaylistAdvanced } from '@/utils/m3uExport';
import { useDebounce } from '@/hooks/useDebounce';
import { getCurrentProgram, getUpcomingProgram, getProgramProgress, formatTime } from '@/utils/epgXmltv';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { createSearchIndex, searchChannels } from '@/utils/channelSearch';
import { focusRemote } from '@/utils/remoteNavigation';
import type { FavoriteList } from '@/utils/favoriteLists';
import { byChannelName } from '@/utils/channelCustomization';
import { tntDisplayName } from '@/utils/tntOrdering';

/** Surligne les occurrences de la recherche dans un nom (fonction pure, partagée par toutes les cartes). */
const highlight = (text: string, rawQuery: string): React.ReactNode => {
  if (!rawQuery.trim()) return text;
  const tokens = rawQuery.split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
  if (!tokens.length) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let indexOffset = 0;
  while (indexOffset < text.length) {
    let bestIdx = -1; let bestLen = 0; let bestToken = '';
    for (const t of tokens) {
      const idx = lower.indexOf(t.toLowerCase(), indexOffset);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx || (idx === bestIdx && t.length > bestLen))) {
        bestIdx = idx; bestLen = t.length; bestToken = t;
      }
    }
    if (bestIdx === -1) {
      parts.push(text.slice(indexOffset));
      break;
    }
    if (bestIdx > indexOffset) parts.push(text.slice(indexOffset, bestIdx));
    parts.push(<mark key={indexOffset+':'+bestToken} className="bg-yellow-500/60 text-black rounded px-0.5">{text.substr(bestIdx, bestLen)}</mark>);
    indexOffset = bestIdx + bestLen;
    if (indexOffset >= text.length) break;
  }
  return parts;
};

/** Horloge de la liste : les cartes sont mémoïsées et ne suivent plus les re-rendus du parent,
 * la zone EPG (programme en cours, progression) doit donc s'actualiser d'elle-même. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

interface ChannelCardProps {
  channel: Channel;
  compactMode: boolean;
  showVariants: boolean;
  selectedGroup: string;
  isPlaying: boolean;
  isSelected: boolean;
  isFavorite: boolean;
  favoriteNumber: number | undefined;
  searchTerm: string;
  epgData: EPGData | undefined;
  /** Horloge partagée de la liste : fait passer la carte à l'émission suivante sans re-rendu du parent. */
  now: Date;
  groups: ChannelGroup[];
  /** Favoris en Set : l'identité ne change qu'avec les favoris, pas à chaque rendu du parent —
   * passer le tableau brut aurait re-rendu toutes les cartes à chaque zap ou frappe. */
  favoriteSet: Set<string>;
  onChannelSelect: (channel: Channel) => void;
  onNativeChannelSelect: ((channel: Channel) => void) | undefined;
  onMosaic: ((channel: Channel) => void) | undefined;
  onRecord: ((channel: Channel) => void) | undefined;
  onEditChannel: ((channel: Channel) => void) | undefined;
  toggleFavorite: (channel: Channel, event: React.MouseEvent) => void;
}

/** Carte mémoïsée : au défilement, seules les lignes qui entrent dans la fenêtre se montent,
 * les autres ne sont plus re-rendues à chaque image. L'horloge `now` (30 s) reste le seul
 * re-rendu périodique, pour la zone EPG. */
const ChannelCard = React.memo(function ChannelCard({
  channel, compactMode, showVariants, selectedGroup, isPlaying, isSelected, isFavorite,
  favoriteNumber, searchTerm, epgData, now, groups, favoriteSet,
  onChannelSelect, onNativeChannelSelect, onMosaic, onRecord, onEditChannel, toggleFavorite,
}: ChannelCardProps) {
  const variantList = showVariants ? channel.variants || [] : [];
  // Liste importée avant la détection à l'import : lire la qualité dans le libellé.
  const quality = channelQuality(channel);
  const exportChannel = () => {
    try {
      const variantsAll = [channel, ...(channel.variants || [])];
      const groupsMap: ChannelGroup[] = [{ name: channel.group || 'Single', channels: variantsAll }];
      const pl: PlaylistInfo = {
        id: 'single_'+channel.id,
        name: channel.name,
        channels: variantsAll,
        groups: groupsMap,
        totalChannelsBeforeDedup: variantsAll.length
      } as PlaylistInfo;
      downloadPlaylistAdvanced(pl, favoriteSet, { includeQuality: true, includeFavorites: true, includeVariants: true, annotateVariants: true });
      toast.success('Channel exported');
    } catch {
      toast.error('Export impossible');
    }
  };
  const copyUrl = () => {
    const url = channel.url;
    if (!url) { toast.error('No URL'); return; }
    navigator.clipboard.writeText(url).then(()=> toast.success('URL copied')).catch(()=>toast.error('Copy failed'));
  };
  return (
    <div className="space-y-1" data-channel-id={channel.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Card
            className={`relative cursor-pointer rounded-2xl border-transparent shadow-none transition-colors ${
              isPlaying
                ? 'bg-secondary shadow-[inset_3px_0_0_hsl(var(--primary))]'
                : isSelected
                  ? 'legacy-channel-selection bg-accent/60 ring-1 ring-muted-foreground/60'
                  : 'bg-transparent hover:bg-accent/60'
            }`}
          >
            {/* Toute la ligne est le bouton de lecture (tactile, clavier, télécommande).
                Un frère superposé plutôt qu'un rôle sur la carte : le cœur à droite
                reste un vrai bouton, exposé et atteignable séparément. */}
            <button
              type="button"
              data-channel-play
              aria-label={`Lire ${channel.name}`}
              className="absolute inset-0 rounded-2xl"
              onClick={() => onChannelSelect(channel)}
            />
            <CardContent className={`channel-row-content ${compactMode ? 'p-2' : 'px-3 py-3'}`}>
              <div className={`flex items-center ${compactMode ? 'space-x-2' : 'space-x-4'}`}>
                {selectedGroup === 'favorites' && favoriteNumber !== undefined && <span className="w-5 shrink-0 text-right font-mono text-[13px] text-primary" aria-label={`Favori numéro ${favoriteNumber}`}>{favoriteNumber}</span>}
                {/* Pas de numéro de chaîne avant le logo : ceux du fournisseur (TF1 = 4,
                    France 2 = 8…) n'ont aucune logique lisible et laissaient un grand vide
                    à gauche. Le numéro de favori reste : c'est le raccourci de zap, dans l'ordre
                    de la liste Favoris. */}
                {/* Channel Logo */}
                <ChannelLogo src={channel.logo ?? null} name={channel.name} compact={compactMode} />

                {/* Channel Info */}
                <div className="flex-1 min-w-0">
                  <h3 className={`font-semibold tracking-tight grid items-start gap-2 min-w-0 ${compactMode ? 'text-sm' : 'text-[15px]'} ${isPlaying ? 'text-primary' : ''}`} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }}>
                    {/* Numéro TNT devant le nom, sauf si la ligne affiche déjà un numéro personnalisé.
                        Deux lignes autorisées : les noms du fournisseur peuvent être longs, une
                        seule ligne les réduisait à « FR: TF… » à côté du badge qualité. */}
                    <span className="min-w-0 line-clamp-2 break-words">{highlight(selectedGroup !== 'favorites' && channel.chno ? channel.name : tntDisplayName(channel.name), searchTerm)}</span>
                    {quality && (
                      <Badge
                        variant={quality === '4K' || quality === 'UHD' ? 'default' : 'outline'}
                        className={`shrink-0 font-mono text-[10px] px-1.5 py-0 leading-4 tracking-wide ${compactMode ? 'scale-90' : ''} ${quality === '4K' || quality === 'UHD' ? 'border-transparent bg-primary text-primary-foreground' : 'border-neutral-700 bg-transparent text-muted-foreground'}`}
                      >
                        {quality}
                      </Badge>
                    )}
                    {variantList.length > 0 && (
                      <Badge variant="secondary" className="shrink-0 text-[10px] px-1 py-0" title={`${variantList.length} variant(s) hidden`}>
                        +{variantList.length}
                      </Badge>
                    )}
                  </h3>
                  {compactMode && epgData && (() => {
                    const currentProgram = getCurrentProgram(channel.id, epgData, now);
                    const upcomingProgram = getUpcomingProgram(channel.id, epgData, now);
                    return (
                      <div className="mt-0.5 text-[10px] truncate text-muted-foreground">
                        {currentProgram ? (
                          <span>{currentProgram.title}</span>
                        ) : upcomingProgram ? (
                          <span>À suivre : {upcomingProgram.title}</span>
                        ) : null}
                      </div>
                    );
                  })()}
                  {!compactMode && epgData && (() => {
                    const currentProgram = getCurrentProgram(channel.id, epgData, now);
                    const upcomingProgram = getUpcomingProgram(channel.id, epgData, now);
                    return (
                      <div className="mt-1">
                        {currentProgram ? (
                          <>
                            <div className="truncate text-[13px] text-neutral-300">{currentProgram.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="shrink-0 font-mono tabular-nums text-[11px] text-neutral-500">
                                {formatTime(currentProgram.startTime)}–{formatTime(currentProgram.endTime)}
                              </span>
                              <Progress
                                value={getProgramProgress(currentProgram, now)}
                                className="h-0.5 min-w-8 flex-1 bg-neutral-800"
                              />
                              {channel.group && (
                                <span className="max-w-[45%] shrink-0 truncate text-[10px] text-neutral-500">{channel.group}</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className={`${upcomingProgram ? '' : 'channel-empty-program '}min-w-0 flex-1 truncate`}>
                              {upcomingProgram ? (
                                <>À suivre : {upcomingProgram.title} à <span className="font-mono">{formatTime(upcomingProgram.startTime)}</span></>
                              ) : (
                                'Aucune information de programme'
                              )}
                            </span>
                            {channel.group && (
                              <span className="shrink-0 text-[10px] text-neutral-500">{channel.group}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {!compactMode && !epgData && channel.group && (
                    <Badge variant="outline" className="mt-1 border-neutral-800 text-[11px] font-normal text-neutral-500">
                      {channel.group}
                    </Badge>
                  )}
                </div>

                {/* Actions : seul le favori reste, le reste de la ligne lance la lecture.
                    L'éclair « lecteur natif » et le ▶ faisaient exactement la même chose
                    que le tap sur la carte (sur Android, `onChannelSelect` ouvre déjà
                    ExoPlayer) et prenaient la largeur du nom et du programme. */}
                <div data-channel-actions className={`relative z-10 flex items-center ${compactMode ? 'space-x-1' : 'space-x-2'}`}>
                  <Button
                    variant="ghost"
                    size={compactMode ? 'icon' : 'sm'}
                    onClick={(e) => toggleFavorite(channel, e)}
                    className="p-1"
                    title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    aria-label={isFavorite ? `Retirer ${channel.name} des favoris` : `Ajouter ${channel.name} aux favoris`}
                  >
                    <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current text-primary' : 'text-muted-foreground'}`} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={() => onChannelSelect(channel)}><Play className="h-4 w-4 mr-2 inline" aria-hidden="true" />Lecture</ContextMenuItem>
          {(onMosaic || onRecord) && (
            <>
              {onMosaic && <ContextMenuItem onSelect={() => onMosaic(channel)}><Grid2X2 className="h-4 w-4 mr-2 inline" aria-hidden="true" />Mosaïque</ContextMenuItem>}
              {onRecord && <ContextMenuItem onSelect={() => onRecord(channel)}><CircleDot className="h-4 w-4 mr-2 inline" aria-hidden="true" />Enregistrer</ContextMenuItem>}
              <ContextMenuSeparator />
            </>
          )}
          {NativePlayerBridge.isAvailable() && (
            <>
              <ContextMenuItem onSelect={() => onNativeChannelSelect ? onNativeChannelSelect(channel) : void NativePlayerBridge.open(channel.url, channel.name, buildNativeZap(groups.flatMap(g => g.channels), channel))}>
                <Zap className="h-4 w-4 mr-2 inline" aria-hidden="true" />Lecteur natif (ExoPlayer)
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void NativePlayerBridge.openExternal(channel.url, channel.name)}>
                <PlayCircle className="h-4 w-4 mr-2 inline" aria-hidden="true" />Ouvrir dans VLC
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem onSelect={(e) => {
            e.preventDefault();
            const synthetic = { stopPropagation: () => {/* noop */} } as unknown as React.MouseEvent;
            toggleFavorite(channel, synthetic);
          }}>{isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}</ContextMenuItem>
          {onEditChannel && <ContextMenuItem onSelect={() => onEditChannel(channel)}><Pencil className="h-4 w-4 mr-2 inline" aria-hidden="true" />Modifier la chaîne…</ContextMenuItem>}
          <ContextMenuItem onSelect={copyUrl}>Copier l'URL</ContextMenuItem>
          {channel.variants?.length ? (
            <>
              <ContextMenuItem onSelect={() => {
                const urls = [channel.url, ...channel.variants!.map(v=>v.url)].filter(Boolean).join('\n');
                navigator.clipboard.writeText(urls).then(()=>toast.success('URL des variantes copiées')).catch(()=>toast.error('Copie impossible'));
              }}>Copier toutes les URL</ContextMenuItem>
              <ContextMenuItem onSelect={() => {
                try {
                  const variantsOnly: PlaylistInfo = {
                    id: 'variants_'+channel.id,
                    name: channel.name + ' Variants',
                    channels: channel.variants!,
                    groups: [{ name: channel.group || 'Variants', channels: channel.variants! }],
                    totalChannelsBeforeDedup: channel.variants!.length
                  } as PlaylistInfo;
                  downloadPlaylistAdvanced(variantsOnly, favoriteSet, { includeQuality: true, includeFavorites: true, includeVariants: true, annotateVariants: true });
                  toast.success('Variantes exportées');
                } catch { toast.error('Export impossible'); }
              }}>Exporter les variantes</ContextMenuItem>
              <ContextMenuItem onSelect={exportChannel}>Exporter la chaîne + variantes</ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem onSelect={exportChannel}>Exporter la chaîne</ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem disabled className="text-[10px] opacity-70">ID: {channel.id.slice(0,10)}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {variantList.length > 0 && showVariants && (
        <div className="ml-6 border-l border-border pl-4 space-y-1">
          {variantList.map(v => (
            <div
              key={v.id}
              className="flex items-center justify-between text-xs rounded bg-muted/30 px-2 py-1 hover:bg-muted/50 cursor-pointer"
              onClick={() => onChannelSelect(v)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="min-w-0 flex-1 truncate">{highlight(v.name, searchTerm)}</span>
                {v.quality && (
                  <Badge variant="outline" className="text-[9px]">{v.quality}</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); toggleFavorite(v, e); }}
                  className="text-muted-foreground hover:text-foreground"
                  title={favoriteSet.has(v.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                  aria-label={favoriteSet.has(v.id) ? `Retirer ${v.name} des favoris` : `Ajouter ${v.name} aux favoris`}
                >
                  {favoriteSet.has(v.id) ? '♥' : '♡'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onChannelSelect(v); }}
                  className="text-primary"
                  title={`Lire ${v.name}`}
                  aria-label={`Lire ${v.name}`}
                >▶</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

  interface ChannelListProps {
      playlistId?: string;
      groups: ChannelGroup[];
      onChannelSelect: (channel: Channel) => void;
      onNativeChannelSelect?: (channel: Channel) => void;
      currentChannel?: Channel;
      keyboardNavigationEnabled?: boolean;
      epgData?: EPGData | undefined;
      /** Groupes verrouillés par le contrôle parental (masqués tant que non déverrouillé). */
      lockedGroups?: string[];
      /** true = le contrôle parental a été déverrouillé pour cette session. */
      unlocked?: boolean;
      /** Appelé quand l'utilisateur sélectionne un groupe verrouillé. */
      onLockedGroupSelect?: (group: string) => void;
      /** Accès contextuel : ouvrir la mosaïque à partir de cette chaîne. */
      onMosaic?: (channel: Channel) => void;
      /** Accès contextuel : programmer/consulter un enregistrement pour cette chaîne. */
      onRecord?: (channel: Channel) => void;
      /** Ouvre le choix des groupes affichés. */
      onManageGroups?: () => void;
      /** Ouvre l'organisation (ordre, numéros) des favoris. */
      onOrganizeFavorites?: () => void;
      /** Modifier une chaîne (nom, logo, numéro, listes, masquage). */
      onEditChannel?: ((channel: Channel) => void) | undefined;
      /** Listes de favoris supplémentaires, affichées comme des groupes. */
      favoriteLists?: FavoriteList[] | undefined;
      /** Les groupes arrivent dans l'ordre choisi par l'utilisateur : ne pas les trier. */
      customGroupOrder?: boolean | undefined;
      alphabetical?: boolean | undefined;
    }

  export function ChannelList({ 
      playlistId,
      groups, 
      onChannelSelect,
      onNativeChannelSelect, 
      currentChannel,
      keyboardNavigationEnabled = true,
      epgData,
      lockedGroups,
      unlocked = false,
      onLockedGroupSelect,
      onMosaic,
      onRecord,
      onManageGroups,
      onOrganizeFavorites,
      onEditChannel,
      favoriteLists,
      alphabetical = false
    }: ChannelListProps) {
  const now = useNow();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
      const [favorites, setFavorites] = useState<string[]>([]);
      const [favLoading, setFavLoading] = useState(true);
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const availableQualityFilters = useMemo(() => CHANNEL_QUALITIES.filter(q => groups.some(g => g.channels.some(ch => channelQuality(ch) === q || ch.variants?.some(v => channelQuality(v) === q)))), [groups]);
  const [showVariants, setShowVariants] = useState(false);
  const [searchMode, setSearchMode] = useState<'precise' | 'fuzzy'>('precise');
  const debouncedSearch = useDebounce(searchTerm, searchMode === 'fuzzy' ? 200 : 80);
  const [recentChannels, setRecentChannels] = useState<Channel[]>([]);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
      // Inverted index for faster search
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const hydratedGroups = useRef<ChannelGroup[] | null>(null);
  /** Liste pour laquelle la recherche a été remise à zéro : un simple changement
   * d'identité de `groups` (rafraîchissement du guide) ne doit plus effacer la frappe. */
  const searchResetFor = useRef<string | undefined>(playlistId);
  const [compactMode, setCompactMode] = useState(false);
  const [virtualizationEnabled, setVirtualizationEnabled] = useState(true);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ id: string; action: number } | null>(null);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [requestedRow, setRequestedRow] = useState<number | null>(null);
    // Load favorites & persisted search mode async from IndexedDB (fallback to old storage once, then migrate)
  useEffect(() => {
    let cancelled = false;
    hydratedGroups.current = null;
    pendingFocus.current = null;
    setFavLoading(true);
    setPreferencesLoaded(false);
    // La recherche ne repart de zéro que lorsqu'on change de liste : `groups` change
    // d'identité à chaque mise à jour du guide, et la frappe en cours disparaissait.
    if (searchResetFor.current !== playlistId) {
      searchResetFor.current = playlistId;
      setSearchTerm('');
    }
    void (async () => {
      try {
        const keys = ['favorites', 'qualityFilter', 'showVariants', 'selectedGroup', 'compactMode', 'virtualizationEnabled'] as const;
        const [values, mode, settings, history, scopedFilters] = await Promise.all([
          Promise.all(keys.map(key => getMeta<unknown>(key))), getSearchMode(), getSettingsFromDB(), getPlayHistory(),
          playlistId ? getMeta<{ quality?: string; group?: string }>(`channelFilters:${playlistId}`) : Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        let favs = Array.isArray(values[0]) ? values[0] as string[] : [];
        if (values[0] === undefined) {
          try { favs = StorageManager.getFavorites(); } catch { /* unreadable legacy data */ }
          await saveFavoritesToDB(favs);
        }
        if (cancelled) return;
        setFavorites(favs);
        if (mode) setSearchMode(mode);
        const quality = playlistId ? scopedFilters?.quality : values[1];
        setQualityFilter(typeof quality === 'string' ? quality : 'all');
        setShowVariants(values[2] === true);
        const group = playlistId ? scopedFilters?.group : values[3];
        const savedGroup = typeof group === 'string' ? group : 'all';
        setSelectedGroup(['all', 'favorites', 'recent', ...groups.map(g => g.name)].includes(savedGroup) || savedGroup.startsWith('fav:') ? savedGroup : 'all');
        setCompactMode(typeof values[4] === 'boolean' ? values[4] : settings?.compactModeDefault === true);
        setVirtualizationEnabled(typeof values[5] === 'boolean' ? values[5] : settings?.virtualizationEnabledDefault !== false);
        const byId = new Map(groups.flatMap(g => g.channels).map(c => [c.id, c]));
        setRecentChannels(history.map(h => byId.get(h.channelId)).filter((c): c is Channel => !!c));
      } catch { if (!cancelled) toast.error('Certaines préférences n’ont pas pu être relues.'); }
      finally { if (!cancelled) { hydratedGroups.current = groups; setFavLoading(false); setPreferencesLoaded(true); } }
    })();
    return () => { cancelled = true; };
  }, [groups, playlistId]);

  useEffect(() => {
    if (!preferencesLoaded || hydratedGroups.current !== groups) return;
    // Une seule transaction IndexedDB pour les 6 préférences (au lieu de 6).
    void setMetaMany([
      ...(playlistId ? [{ key: `channelFilters:${playlistId}`, value: { quality: qualityFilter, group: selectedGroup } }] : [
        { key: 'qualityFilter', value: qualityFilter }, { key: 'selectedGroup', value: selectedGroup },
      ]),
      { key: 'showVariants', value: showVariants },
      { key: 'compactMode', value: compactMode },
      { key: 'virtualizationEnabled', value: virtualizationEnabled },
    ]).catch(() => {});
  }, [groups, playlistId, preferencesLoaded, qualityFilter, showVariants, selectedGroup, compactMode, virtualizationEnabled]);

      // Export helpers (stable refs)
      const exportFilteredSubsetRef = useRef<() => void>(() => {});
      const exportFavoritesSubsetRef = useRef<() => void>(() => {});
      const exportCurrentGroupRef = useRef<() => void>(() => {});

  // Keyboard shortcuts effect moved below filteredChannels definition


      const allChannels = useMemo(() => {
        if (!groups) return [];
        const flat = groups.flatMap(group => group.channels);
        return alphabetical ? flat.sort(byChannelName) : flat;
      }, [groups, alphabetical]);

      const lockedGroupSet = useMemo(() => new Set(lockedGroups ?? []), [lockedGroups]);
      const parentalLocked = lockedGroupSet.size > 0 && !unlocked;

      // Si le groupe sélectionné devient verrouillé (ex. valeur persistée), revenir à « Toutes ».
      useEffect(() => {
        if (parentalLocked && lockedGroupSet.has(selectedGroup)) setSelectedGroup('all');
      }, [parentalLocked, lockedGroupSet, selectedGroup]);

      const searchIndex = useMemo(() => createSearchIndex(allChannels), [allChannels]);

      // Numéros des favoris de cette liste (1 = premier favori) : touches de télécommande.
      const favoriteNumbers = useMemo(() => {
        const ids = new Set<string>();
        for (const c of allChannels) { ids.add(c.id); for (const v of c.variants || []) ids.add(v.id); }
        const map = new Map<string, number>();
        for (const id of favorites) if (ids.has(id)) map.set(id, map.size + 1);
        return map;
      }, [allChannels, favorites]);

      // Favoris modifiés ailleurs (accueil, organisation) : relire.
      useEffect(() => {
        const reload = () => { void getFavoritesFromDB().then(setFavorites).catch(() => {}); };
        window.addEventListener('favorites-updated', reload);
        return () => window.removeEventListener('favorites-updated', reload);
      }, []);

      const currentFavoriteCount = useMemo(() => {
        const ids = new Set(allChannels.map(channel => channel.id));
        return favorites.filter(id => ids.has(id)).length;
      }, [allChannels, favorites]);

      const { channels: filteredChannels } = useMemo(() => {
        let base = searchChannels(searchIndex, debouncedSearch, searchMode);
        if (selectedGroup === 'favorites') {
          const favoriteOrder = new Map(favorites.map((id, i) => [id, i]));
          base = base.filter(ch => favoriteOrder.has(ch.id));
          base.sort((a, b) => favoriteOrder.get(a.id)! - favoriteOrder.get(b.id)!);
        } else if (selectedGroup.startsWith('fav:')) {
          const ids = favoriteLists?.find(l => `fav:${l.id}` === selectedGroup)?.channelIds ?? [];
          const order = new Map(ids.map((id, i) => [id, i]));
          base = base.filter(ch => order.has(ch.id));
          base.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
        } else if (selectedGroup === 'recent') {
          const recentIds = new Set(recentChannels.map(ch => ch.id));
          base = base.filter(ch => recentIds.has(ch.id));
          const order = new Map(recentChannels.map((ch, i) => [ch.id, i]));
          base.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
        } else if (selectedGroup !== 'all') base = base.filter(ch => ch.group === selectedGroup);
        if (qualityFilter !== 'all') base = base.flatMap(ch => { const selected = selectChannelQuality(ch, qualityFilter); return selected ? [selected] : []; });
        if (parentalLocked) base = base.filter(ch => !lockedGroupSet.has(ch.group || ''));
        return { channels: base };
      }, [searchIndex, selectedGroup, favorites, favoriteLists, recentChannels, qualityFilter, debouncedSearch, searchMode, parentalLocked, lockedGroupSet]);

      useEffect(() => {
        if (preferencesLoaded && qualityFilter !== 'all' && !availableQualityFilters.includes(qualityFilter as typeof CHANNEL_QUALITIES[number])) setQualityFilter('all');
      }, [preferencesLoaded, qualityFilter, availableQualityFilters]);

      // Keyboard shortcuts (now that filteredChannels exists)
      // La valeur courante de qualityFilter est lue via une ref : le listener n'est
      // attaché qu'une seule fois au lieu d'être recréé à chaque changement.
      const qualityFilterRef = React.useRef(qualityFilter);
      qualityFilterRef.current = qualityFilter;
      // Le raccourci ne parcourt que les qualités présentes (ref : un seul listener).
      const qualityOrderRef = React.useRef<readonly string[]>(['all']);
      qualityOrderRef.current = ['all', ...availableQualityFilters];
      useEffect(() => {
        const handler = (e: KeyboardEvent) => {
          if (!keyboardNavigationEnabled || e.ctrlKey || e.altKey || e.metaKey) return;
          const target = e.target as HTMLElement | null;
          const isTyping = Boolean(target && typeof target.closest === 'function' && target.closest('input,textarea,select,button,[contenteditable=true],[role=dialog],[role=tab],[role=slider]'));
          if (e.key === '/' && !isTyping) { e.preventDefault(); searchInputRef.current?.focus(); }
          else if (e.key === 'f' && !isTyping) { setSearchMode(m => { const next = m==='precise' ? 'fuzzy' : 'precise'; saveSearchMode(next).catch(()=>{}); return next; }); }
          else if (e.key === 'v' && !isTyping) { setShowVariants(v => !v); }
          else if (e.key === 'q' && !isTyping) { const order = qualityOrderRef.current; const idx = order.findIndex(o => o === qualityFilterRef.current); const next = order[(idx + 1) % order.length] ?? 'all'; setQualityFilter(next); }
          else if (e.key === 'r' && !isTyping) { setSelectedGroup('recent'); }
          else if (e.key === 'c' && !isTyping) { setCompactMode(c => !c); }
          else if (e.key === 'x' && !isTyping) { setVirtualizationEnabled(v => !v); }
          else if (e.key === 'e' && !isTyping) { exportFilteredSubsetRef.current(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [keyboardNavigationEnabled]);

      const channelsToRender = filteredChannels;
      const buildPlaylistFrom = React.useCallback((chs: Channel[], name: string): PlaylistInfo | null => {
        if (!chs.length) return null;
        const groupsMap = new Map<string, Channel[]>();
        chs.forEach(c => { const g = c.group || 'Ungrouped'; if (!groupsMap.has(g)) groupsMap.set(g, []); groupsMap.get(g)!.push(c); });
        const groups: ChannelGroup[] = Array.from(groupsMap.entries()).map(([n,c])=>({ name:n, channels:c }));
        return { id: name + '_' + Date.now(), name, channels: chs, groups, totalChannelsBeforeDedup: chs.length } as PlaylistInfo;
      }, []);

  // Place export helpers after allChannels, channelsToRender, buildPlaylistFrom
  const exportFilteredSubset = React.useCallback(() => {
    const subset = buildPlaylistFrom(channelsToRender, 'Filtered Export');
    if (!subset) return;
    downloadPlaylistAdvanced(subset, favorites, { includeQuality: true, includeFavorites: true, includeVariants: true, annotateVariants: true });
  }, [channelsToRender, favorites, buildPlaylistFrom]);

  const exportFavoritesSubset = React.useCallback(() => {
    const favChans = allChannels.filter(c => favorites.includes(c.id));
    const subset = buildPlaylistFrom(favChans, 'Favorites Export');
    if (!subset) return;
    downloadPlaylistAdvanced(subset, favorites, { includeQuality: true, includeFavorites: true, includeVariants: true, annotateVariants: true });
  }, [allChannels, favorites, buildPlaylistFrom]);

  const exportCurrentGroup = React.useCallback(() => {
    if (["all","favorites","recent"].includes(selectedGroup) || selectedGroup.startsWith('fav:')) return;
    const grpChans = allChannels.filter(c => c.group === selectedGroup);
    const subset = buildPlaylistFrom(grpChans, `Group_${selectedGroup}`);
    if (!subset) return;
    downloadPlaylistAdvanced(subset, favorites, { includeQuality: true, includeFavorites: true, includeVariants: true, annotateVariants: true });
  }, [allChannels, selectedGroup, favorites, buildPlaylistFrom]);

  useEffect(() => {
    exportFilteredSubsetRef.current = exportFilteredSubset;
    exportFavoritesSubsetRef.current = exportFavoritesSubset;
    exportCurrentGroupRef.current = exportCurrentGroup;
  }, [exportFilteredSubset, exportFavoritesSubset, exportCurrentGroup]);


      // Virtualization setup
      const parentRef = useRef<HTMLDivElement | null>(null);
      // Une ancienne préférence désactivée ne doit pas monter des milliers de cartes.
      const shouldVirtualize = channelsToRender.length > 400 || (virtualizationEnabled && channelsToRender.length > 100);
      const rowVirtualizer = useVirtualizer({
        count: shouldVirtualize ? channelsToRender.length : 0,
        getScrollElement: () => parentRef.current,
        estimateSize: () => (compactMode ? 54 : 96),
        overscan: 8,
        gap: 8,
        // Garder le bouton courant monté pendant que la fenêtre de lignes se déplace.
        rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...[focusedRow, requestedRow].filter((i): i is number => i !== null && i >= 0 && i < channelsToRender.length)])].sort((a, b) => a - b),
      });

      const restoreRowFocus = useCallback(() => {
        const pending = pendingFocus.current;
        if (!pending) return;
        const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-channel-id]') ?? []).find(el => el.dataset.channelId === pending.id);
        if (!row) return;
        const play = row.querySelector<HTMLElement>('[data-channel-play]');
        const actions = row.querySelectorAll<HTMLButtonElement>('[data-channel-actions] button');
        // action -1 = la carte elle-même (bouton de lecture) ; sinon on retrouve la même
        // action de la ligne suivante (le cœur).
        const target = pending.action < 0 ? play : (actions[Math.min(pending.action, actions.length - 1)] ?? play);
        if (target) { pendingFocus.current = null; focusRemote(target); }
      }, []);
      // Une ligne hors écran n'existe pas encore : focus seulement après son montage.
      // Dépendances explicites : sans liste, l'effet relançait un parcours du DOM et un
      // `getBoundingClientRect()` après chaque frappe (reflow forcé sur 1 988 chaînes).
      useLayoutEffect(() => {
        restoreRowFocus();
        const active = document.activeElement;
        const viewport = parentRef.current;
        if (!shouldVirtualize || !viewport || !(active instanceof HTMLElement) || !viewport.contains(active)) return;
        // Les mesures réelles peuvent remplacer les hauteurs estimées après le focus.
        const box = (active.closest('[data-channel-id]') ?? active).getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
        if (box.top < bounds.top) viewport.scrollTop -= bounds.top - box.top;
        else if (box.bottom > bounds.bottom) viewport.scrollTop += box.bottom - bounds.bottom;
      }, [restoreRowFocus, channelsToRender, shouldVirtualize, focusedRow, requestedRow, compactMode]);

      const moveRowFocus = (event: React.KeyboardEvent, index: number) => {
        if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
        if (!(event.target instanceof HTMLElement)) return;
        const inActions = event.target.closest('[data-channel-actions]');
        // La carte est elle-même le bouton de lecture : Haut/Bas y change de chaîne,
        // comme depuis le cœur à sa droite.
        if (!inActions && !event.target.closest('[data-channel-play]')) return;
        const next = index + (event.key === 'ArrowDown' ? 1 : -1);
        if (next < 0) return; // Remonter aux filtres avec Haut sur la première chaîne.
        event.preventDefault();
        if (next >= channelsToRender.length) return;
        const actions = Array.from(event.currentTarget.querySelectorAll('[data-channel-actions] button'));
        const actionButton = inActions ? event.target.closest('button') : null;
        pendingFocus.current = { id: channelsToRender[next].id, action: actionButton ? Math.max(0, actions.indexOf(actionButton)) : -1 };
        setRequestedRow(next);
        if (shouldVirtualize) rowVirtualizer.scrollToIndex(next, { align: 'auto' });
        restoreRowFocus();
      };

      const { selectedIndex } = useKeyboardNavigation(
        channelsToRender,
        onChannelSelect,
        keyboardNavigationEnabled
      );

      // Favoris en Set partagé par les cartes : identité stable tant que les favoris ne bougent pas.
      const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
      // Derniers favoris par ref : le callback reste identique d'un rendu à l'autre (les cartes
      // sont mémoïsées) tout en lisant toujours la valeur à jour, même pour des bascules rapprochées.
      const favoritesRef = useRef(favorites);
      favoritesRef.current = favorites;
      const toggleFavorite = useCallback(async (channel: Channel, event: React.MouseEvent) => {
        event.stopPropagation();
        const current = favoritesRef.current;
        const next = current.includes(channel.id) ? current.filter(f => f !== channel.id) : [...current, channel.id];
        favoritesRef.current = next;
        setFavorites(next);
        try {
          await saveFavoritesToDB(next);
        } catch {
          // Quota plein : sans retour, l'étoile restait allumée jusqu'au redémarrage.
          favoritesRef.current = current;
          setFavorites(current);
          toast.error('Stockage plein : favori non enregistré.');
          return;
        }
        window.dispatchEvent(new Event('favorites-updated'));
      }, []);

      const groupNames = useMemo(() => {
        const lists = (favoriteLists ?? []).map(l => `fav:${l.id}`);
        if (!groups) return ['all', 'favorites', ...lists, 'recent'];
        const names = groups.map(g => g.name);
        return ['all', 'favorites', ...lists, 'recent', ...names];
      }, [groups, favoriteLists]);
      // Liste de favoris supprimée pendant qu'elle était affichée : revenir à « Toutes ».
      useEffect(() => {
        if (preferencesLoaded && selectedGroup.startsWith('fav:') && favoriteLists && !favoriteLists.some(l => `fav:${l.id}` === selectedGroup)) setSelectedGroup('all');
      }, [preferencesLoaded, selectedGroup, favoriteLists]);
      const favoriteListLabel = (group: string) => favoriteLists?.find(l => `fav:${l.id}` === group)?.name;

      return (
        <div ref={rootRef} className="channel-browser h-full min-h-0 flex flex-col gap-4">
          <div className="channel-count shrink-0 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span role="status">{filteredChannels.length} chaîne{filteredChannels.length > 1 ? 's' : ''} affichée{filteredChannels.length > 1 ? 's' : ''} sur {allChannels.length}</span>
            {(searchTerm || selectedGroup !== 'all' || qualityFilter !== 'all') && <button type="button" className="min-h-9 rounded-full border border-neutral-800 px-3 text-primary" onClick={() => { setSearchTerm(''); setSelectedGroup('all'); setQualityFilter('all'); }}>Effacer les filtres</button>}
          </div>
          {/* Search */}
          <div className="channel-search shrink-0 relative flex items-center gap-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Rechercher une chaîne"
              placeholder="Rechercher une chaîne…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              ref={searchInputRef}
              className="pl-10"
            />
            <button
              type="button"
              onClick={async () => {
                setSearchMode(m => {
                  const next = m==='precise' ? 'fuzzy' : 'precise';
                  saveSearchMode(next).catch(()=>{});
                  return next;
                });
              }}
              className="text-[11px] px-2.5 py-1 border rounded-full border-neutral-800 hover:bg-neutral-900 text-white whitespace-nowrap"
              title="Toggle search mode"
            >{searchMode==='precise' ? 'Précise' : 'Approchée'}</button>
          </div>

          {/* Filters Bar */}
          <div className="channel-filters shrink-0 flex flex-col gap-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                <span className="text-[11px] font-medium text-white/70">Qualité annoncée :</span>
                {['all', ...availableQualityFilters].map(q => (
                  <button
                    key={q}
                    onClick={() => setQualityFilter(q)}
                    className={`px-2.5 py-1 rounded-full border transition text-[11px] font-medium ${qualityFilter===q ? 'bg-foreground text-background border-foreground' : 'border-neutral-800 hover:bg-neutral-900 text-white'}`}
                    aria-label={q === 'all' ? 'Toutes les qualités' : `Qualité ${q}`}
                    aria-pressed={qualityFilter === q}
                  >{q === 'all' ? 'Toutes' : q}</button>
                ))}
                {qualityFilter!=='all' && (
                  <button onClick={() => setQualityFilter('all')} className="ml-1 text-[11px] text-primary underline">Réinitialiser</button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters(v => !v)}
                className={`text-[11px] px-2.5 py-1 border rounded-full transition whitespace-nowrap ${showAdvancedFilters ? 'bg-white/20 text-white border-white/40' : 'border-neutral-800 hover:bg-neutral-900 text-white/80'}`}
              >
                {showAdvancedFilters ? '▲ Options' : '▼ Options'}
              </button>
            </div>

            {showAdvancedFilters && (
              <div className="flex flex-wrap items-center gap-3 p-2 bg-white/5 rounded border border-neutral-900 text-xs">
                <div className="flex items-center gap-1.5">
                  <span>Doublons :</span>
                  <button
                    onClick={() => setShowVariants(v => !v)}
                    className={`px-2.5 py-1 rounded-full border transition text-[11px] ${showVariants ? 'bg-foreground text-background border-foreground' : 'border-neutral-800 hover:bg-neutral-900 text-white'}`}
                  >{showVariants ? 'Masquer variantes' : 'Afficher variantes'}</button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>Mode :</span>
                  <button
                    onClick={() => setCompactMode(c => !c)}
                    className={`px-2.5 py-1 rounded-full border transition text-[11px] ${compactMode ? 'bg-foreground text-background border-foreground' : 'border-neutral-800 hover:bg-neutral-900 text-white'}`}
                  >{compactMode ? 'Compact' : 'Normal'}</button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>Export :</span>
                  <button onClick={exportFilteredSubset} disabled={!channelsToRender.length} className={`px-2.5 py-1 rounded-full border transition text-[11px] ${channelsToRender.length ? 'border-neutral-800 hover:bg-neutral-900 text-white' : 'border-neutral-900 text-white/40 cursor-not-allowed'}`} title="Exporter les chaînes visibles">Filtrées</button>
                  <button onClick={exportFavoritesSubset} disabled={!currentFavoriteCount} className={`px-2.5 py-1 rounded-full border transition text-[11px] ${currentFavoriteCount ? 'border-neutral-800 hover:bg-neutral-900 text-white' : 'border-neutral-900 text-white/40 cursor-not-allowed'}`} title="Exporter les favoris">Favoris</button>
                  <button onClick={exportCurrentGroup} disabled={(['all','favorites','recent'].includes(selectedGroup) || selectedGroup.startsWith('fav:'))} className={`px-2.5 py-1 rounded-full border transition text-[11px] ${(['all','favorites','recent'].includes(selectedGroup) || selectedGroup.startsWith('fav:')) ? 'border-neutral-900 text-white/40 cursor-not-allowed' : 'border-neutral-800 hover:bg-neutral-900 text-white'}`} title="Exporter le groupe actuel">Groupe</button>
                </div>
              </div>
            )}
          </div>

          {/* Group Tabs */}
          <Tabs activationMode="manual" value={selectedGroup} onValueChange={(value) => {
            if (parentalLocked && lockedGroupSet.has(value)) { onLockedGroupSelect?.(value); return; }
            setSelectedGroup(value);
          }} className="channel-groups flex-1 min-h-0 flex flex-col">
            <div className="channel-group-strip shrink-0 overflow-x-auto">
              <TabsList className="h-auto w-max gap-1.5 bg-transparent p-0">
                {groupNames.map(group => (
                  <TabsTrigger key={group} value={group} className="min-h-9 rounded-full border border-neutral-800 px-3.5 text-[13px] capitalize text-muted-foreground hover:bg-accent hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none">
                    {group === 'all' ? 'Toutes' : group === 'favorites' ? 'Favoris' : group === 'recent' ? 'Récentes' : favoriteListLabel(group) ?? group}
                    {parentalLocked && lockedGroupSet.has(group) && <Lock className="h-3 w-3 ml-1" aria-label={`${group} verrouillé`} />}
                    {group === 'all' && (
                      <Badge variant="secondary" className="ml-2">
                        {allChannels.length}
                      </Badge>
                    )}
                    {group === 'favorites' && (
                      <Badge variant="secondary" className="ml-2">
                        {currentFavoriteCount}
                      </Badge>
                    )}
                    {group === 'recent' && (
                      <Badge variant="secondary" className="ml-2">
                        {recentChannels.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
                {onManageGroups && <button type="button" onClick={onManageGroups} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-neutral-800 px-3.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />Groupes
                </button>}
              </TabsList>
            </div>
            {selectedGroup === 'favorites' && onOrganizeFavorites && currentFavoriteCount > 0 && <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-card px-3 py-2 text-[13px] text-muted-foreground">
              <span>Tape un numéro pour lancer le favori correspondant.</span>
              <button type="button" onClick={onOrganizeFavorites} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 font-medium text-primary hover:bg-primary/10"><ListOrdered className="h-4 w-4" aria-hidden="true" />Organiser</button>
            </div>}

            <TabsContent value={selectedGroup} className="channel-results flex-1 min-h-0 mt-4 overflow-hidden">
              {/* List area */}
              {!shouldVirtualize && (
                <ScrollArea className="h-full">
                  <div className="space-y-2">
                    {favLoading ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">Chargement des favoris…</div>
                    ) : channelsToRender.length === 0 ? (
                      <div className="text-center py-8">
                        <Tv className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">
                          {debouncedSearch ? 'Aucune chaîne ne correspond à cette recherche.' : 'Aucune chaîne dans cette sélection.'}
                        </p>
                      </div>
                    ) : channelsToRender.map((channel, index) => (
                      <div key={channel.id} onFocusCapture={() => setFocusedRow(index)} onKeyDown={e => moveRowFocus(e, index)}>
                        <ChannelCard
                          channel={channel}
                          compactMode={compactMode}
                          showVariants={showVariants}
                          selectedGroup={selectedGroup}
                          isPlaying={currentChannel?.id === channel.id}
                          isSelected={keyboardNavigationEnabled && selectedIndex === index}
                          isFavorite={favorites.includes(channel.id)}
                          favoriteNumber={favoriteNumbers.get(channel.id)}
                          searchTerm={debouncedSearch}
                          epgData={epgData}
                          now={now}
                          groups={groups}
                          favoriteSet={favoriteSet}
                          onChannelSelect={onChannelSelect}
                          onNativeChannelSelect={onNativeChannelSelect}
                          onMosaic={onMosaic}
                          onRecord={onRecord}
                          onEditChannel={onEditChannel}
                          toggleFavorite={toggleFavorite}
                        />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {shouldVirtualize && (
                <div ref={parentRef} className="h-full overflow-auto relative">
                  {favLoading ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">Chargement des favoris…</div>
                  ) : channelsToRender.length === 0 ? (
                    <div className="text-center py-8">
                      <Tv className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        {debouncedSearch ? 'Aucune chaîne ne correspond à cette recherche.' : 'Aucune chaîne dans cette sélection.'}
                      </p>
                    </div>
                  ) : (
                    <div
                      className="relative"
                      style={{ height: rowVirtualizer.getTotalSize() }}
                      data-total-height={rowVirtualizer.getTotalSize()}
                      data-virtual-root
                    >
                      {rowVirtualizer.getVirtualItems().map(virtualRow => {
                        const channel = channelsToRender[virtualRow.index];
                        return (
                          <div
                            key={channel.id}
                            ref={rowVirtualizer.measureElement}
                            data-index={virtualRow.index}
                            className="absolute top-0 left-0 w-full"
                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                            onFocusCapture={() => setFocusedRow(virtualRow.index)}
                            onKeyDown={e => moveRowFocus(e, virtualRow.index)}
                          >
                            <ChannelCard
                              channel={channel}
                              compactMode={compactMode}
                              showVariants={showVariants}
                              selectedGroup={selectedGroup}
                              isPlaying={currentChannel?.id === channel.id}
                              isSelected={keyboardNavigationEnabled && selectedIndex === virtualRow.index}
                              isFavorite={favorites.includes(channel.id)}
                              favoriteNumber={favoriteNumbers.get(channel.id)}
                              searchTerm={debouncedSearch}
                              epgData={epgData}
                              now={now}
                              groups={groups}
                              favoriteSet={favoriteSet}
                              onChannelSelect={onChannelSelect}
                              onNativeChannelSelect={onNativeChannelSelect}
                              onMosaic={onMosaic}
                              onRecord={onRecord}
                              onEditChannel={onEditChannel}
                              toggleFavorite={toggleFavorite}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      );
    }
