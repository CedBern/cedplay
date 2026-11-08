import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - type resolution sometimes lags in certain editors
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual';
import { CalendarDays, CircleDot, Clock, Eye, Grid2X2, Heart, List, ListChecks, Lock, Pencil, Play, Search, SlidersHorizontal, Star } from 'lucide-react';
import type { FavoriteList } from '@/utils/favoriteLists';
import { byChannelName, byGroupName } from '@/utils/channelCustomization';
import { ChannelLogo } from '@/components/ChannelLogo';
import type { Channel, ChannelGroup } from '@/types/channel';
import type { EPGData, EPGProgram } from '@/types/epg';
import { getCurrentProgram, getUpcomingProgram, getProgramProgress, formatTime } from '@/utils/epgXmltv';
import { getPlayHistory, saveFavoritesToDB } from '@/utils/idb';
import { NativePlayerBridge, channelNumbering, findChannelByNumber, type PreviewState } from '@/utils/nativePlayer';

type Column = 'cat' | 'list' | 'info';
type CategoryItem =
  | { kind: 'action'; id: 'search' | 'guide' | 'organize' | 'sort'; label: string }
  | { kind: 'category'; id: string; label: string; count: number; locked: boolean };

const ROW_HEIGHT = 56;
const PAGE = 8;
/** Temps d'arrêt sur une chaîne avant de lancer son aperçu (évite d'ouvrir un flux à chaque appui). */
const PREVIEW_DELAY = 600;

const CategoryButton = React.memo(function CategoryButton({ item, index, selected, focused }: {
  item: CategoryItem; index: number; selected: boolean; focused: boolean;
}) {
  const icon = item.kind === 'action'
    ? (item.id === 'search' ? <Search className="h-4 w-4" aria-hidden="true" /> : item.id === 'sort' ? <List className="h-4 w-4" aria-hidden="true" /> : item.id === 'organize' ? <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> : <CalendarDays className="h-4 w-4" aria-hidden="true" />)
    : item.id === 'favorites' ? <Star className="h-4 w-4" aria-hidden="true" />
    : item.id.startsWith('favlist:') ? <ListChecks className="h-4 w-4" aria-hidden="true" />
    : item.id === 'recent' ? <Clock className="h-4 w-4" aria-hidden="true" />
    : item.id === 'all' ? <List className="h-4 w-4" aria-hidden="true" />
    : item.locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : null;
  return <React.Fragment>
    {item.kind === 'category' && item.id === 'favorites' && index > 0 && <div className="mx-2 my-1.5 border-t border-neutral-900" aria-hidden="true" />}
    <button type="button" aria-current={selected ? 'true' : undefined} data-tv-item data-tv-cat={index}
      data-remote-entry={index === 0 ? '' : undefined} tabIndex={focused ? 0 : -1}
      className={`tv-cat flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[15px] ${selected ? 'is-selected' : ''} ${item.kind === 'action' ? 'text-muted-foreground' : ''}`}>
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.kind === 'category' && <span className="shrink-0 font-mono text-xs tabular-nums opacity-70">{item.locked ? '' : item.count}</span>}
    </button>
  </React.Fragment>;
});

interface ChannelRowProps {
  channel: Channel;
  index: number;
  number: string | undefined;
  /** Décalage vertical calculé par le virtualiseur. */
  start: number;
  selected: boolean;
  highlighted: boolean;
  playing: boolean;
  program: EPGProgram | null;
  favorite: boolean;
  onPlay: (channel: Channel) => void;
  onFocus: (index: number) => void;
}

/** Ligne mémoïsée : à chaque appui de défilement, seules les lignes dont l'état change se re-rendent. */
const ChannelRow = React.memo(function ChannelRow({ channel, index, number, start, selected, highlighted, playing, program, favorite, onPlay, onFocus }: ChannelRowProps) {
  return <button
    type="button"
    aria-current={playing ? 'true' : undefined}
    aria-label={`${number || index + 1}. ${channel.name}${program ? `, ${program.title}` : ''}`}
    data-tv-item
    data-tv-row={index}
    data-channel-row-id={channel.id}
    tabIndex={selected ? 0 : -1}
    onFocus={() => onFocus(index)}
    onClick={() => onPlay(channel)}
    className={`tv-row absolute left-0 right-0 flex items-center gap-3 rounded-xl px-3 text-left ${highlighted ? 'is-selected' : ''} ${playing ? 'is-playing' : ''}`}
    style={{ top: start, height: ROW_HEIGHT - 4 }}
  >
    <span className="w-8 shrink-0 text-right font-mono text-[13px] tabular-nums opacity-60">{number || '·'}</span>
    <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15px] font-medium leading-5">{channel.name}</span>
      {program && <span className="block truncate text-xs leading-4 opacity-70">{program.title}</span>}
    </span>
    {favorite && <Heart className="h-3.5 w-3.5 shrink-0 fill-current opacity-80" aria-label="Favori" />}
    {channel.quality && <span className="shrink-0 rounded border border-current/30 px-1.5 font-mono text-[10px] leading-4 opacity-70">{channel.quality}</span>}
    {playing && <span className="h-2 w-2 shrink-0 rounded-full bg-live" aria-label="En cours" />}
  </button>;
});

export interface TvLiveScreenProps {
  playlistId: string;
  groups: ChannelGroup[];
  favoriteIds: string[];
  epgData?: EPGData | undefined;
  currentChannel?: Channel | null | undefined;
  lockedGroups?: string[] | undefined;
  unlocked?: boolean | undefined;
  /** Liste ordonnée du zapping (celle transmise au lecteur natif) : numérotation canonique partagée. */
  zapList?: Channel[] | undefined;
  onPlay: (channel: Channel) => void;
  onLockedGroupSelect?: (() => void) | undefined;
  onSearch?: (() => void) | undefined;
  onGuide?: (() => void) | undefined;
  onMosaic?: ((channel: Channel) => void) | undefined;
  onRecord?: ((channel: Channel) => void) | undefined;
  /** Aperçu vidéo de la chaîne surlignée (lecteur Android posé sur la colonne de droite). */
  preview?: boolean | undefined;
  /** Mode de l'aperçu : automatique après le survol, ou manuel via le bouton « Aperçu » (petites box, abonnements limités en connexions). « off » n'arrive jamais avec preview actif. */
  previewMode?: 'auto' | 'manual' | 'off' | undefined;
  /** Modifier la chaîne surlignée (nom, logo, numéro, listes, masquage). */
  onEdit?: ((channel: Channel) => void) | undefined;
  /** Organiser la liste (groupes, ordre, numéros). */
  onOrganize?: (() => void) | undefined;
  favoriteLists?: FavoriteList[] | undefined;
  /** Groupes déjà dans l'ordre choisi : ne pas les trier. */
  customGroupOrder?: boolean | undefined;
  alphabetical?: boolean | undefined;
  onToggleSort?: (() => void) | undefined;
}

function storedCategory(playlistId: string): string | null {
  try { return localStorage.getItem(`cedplay.tvCategory:${playlistId}`); } catch { return null; }
}
function storeCategory(playlistId: string, id: string): void {
  try { localStorage.setItem(`cedplay.tvCategory:${playlistId}`, id); } catch { /* stockage indisponible */ }
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/**
 * Écran Direct pour la télécommande : catégories | chaînes | aperçu.
 * Une seule cible focalisable par colonne (tabindex itinérant) ; les flèches sont gérées ici,
 * Haut depuis le premier élément rend la main à la navigation générale (rubriques).
 */
export function TvLiveScreen({
  playlistId, groups, zapList, favoriteIds, epgData, currentChannel, lockedGroups, unlocked = false,
  onPlay, onLockedGroupSelect, onSearch, onGuide, onMosaic, onRecord, preview = false, previewMode = 'auto',
  onEdit, onOrganize, favoriteLists, customGroupOrder = false, alphabetical = false, onToggleSort,
}: TvLiveScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const redirecting = useRef(false);
  const [, setFocusTick] = useState(0);
  /** Demande de focus après le prochain rendu, même si l'état ne change pas. */
  const requestFocus = () => { pendingFocus.current = true; setFocusTick(t => t + 1); };
  const now = useClock();

  const lockedSet = useMemo(() => new Set(lockedGroups ?? []), [lockedGroups]);
  const parentalLocked = lockedSet.size > 0 && !unlocked;
  const allChannels = useMemo(() => {
    const flat = groups.flatMap(g => g.channels);
    return alphabetical ? flat.sort(byChannelName) : flat;
  }, [groups, alphabetical]);
  const allowed = useCallback((c: Channel) => !parentalLocked || !lockedSet.has(c.group || ''), [parentalLocked, lockedSet]);

  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getPlayHistory().then(history => {
      if (cancelled) return;
      const seen = new Set<string>();
      setRecentIds(history.filter(h => h.kind !== 'vod').map(h => h.channelId).filter(id => !seen.has(id) && !!seen.add(id)));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [playlistId, currentChannel?.id]);

  const byId = useMemo(() => new Map(allChannels.map(c => [c.id, c])), [allChannels]);
  const favorites = useMemo(() => favoriteIds.map(id => byId.get(id)).filter((c): c is Channel => !!c && allowed(c)), [favoriteIds, byId, allowed]);
  const recents = useMemo(() => recentIds.map(id => byId.get(id)).filter((c): c is Channel => !!c && allowed(c)), [recentIds, byId, allowed]);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // Numérotation canonique (celle du lecteur natif) : numéro affiché = numéro tapé = numéro box.
  const numberingSource = useMemo(() => zapList ?? allChannels.filter(allowed), [zapList, allChannels, allowed]);
  const numberById = useMemo(() => {
    const { numbers } = channelNumbering(numberingSource);
    const map = new Map<string, string>();
    numberingSource.forEach((c, i) => { if (numbers[i]) map.set(c.id, numbers[i]); });
    return map;
  }, [numberingSource]);

  const items = useMemo<CategoryItem[]>(() => {
    const list: CategoryItem[] = [];
    if (onSearch) list.push({ kind: 'action', id: 'search', label: 'Rechercher' });
    if (onGuide) list.push({ kind: 'action', id: 'guide', label: 'Guide TV' });
    if (onOrganize) list.push({ kind: 'action', id: 'organize', label: 'Organiser' });
    if (onToggleSort) list.push({ kind: 'action', id: 'sort', label: alphabetical ? 'Tri : A–Z' : 'Tri : liste' });
    list.push({ kind: 'category', id: 'favorites', label: 'Favoris', count: favorites.length, locked: false });
    for (const l of favoriteLists ?? []) {
      list.push({ kind: 'category', id: `favlist:${l.id}`, label: l.name, count: l.channelIds.filter(id => { const c = byId.get(id); return !!c && allowed(c); }).length, locked: false });
    }
    list.push({ kind: 'category', id: 'recent', label: 'Récentes', count: recents.length, locked: false });
    list.push({ kind: 'category', id: 'all', label: 'Toutes', count: allChannels.filter(allowed).length, locked: false });
    for (const g of customGroupOrder ? groups : [...groups].sort(byGroupName)) {
      const locked = parentalLocked && lockedSet.has(g.name);
      list.push({ kind: 'category', id: `group:${g.name}`, label: g.name, count: g.channels.length, locked });
    }
    return list;
  }, [onSearch, onGuide, onOrganize, onToggleSort, alphabetical, favorites.length, favoriteLists, byId, recents.length, allChannels, allowed, groups, customGroupOrder, parentalLocked, lockedSet]);

  const [category, setCategory] = useState<string>(() => storedCategory(playlistId) ?? (favoriteIds.length ? 'favorites' : 'all'));
  useEffect(() => {
    if (!items.some(i => i.kind === 'category' && i.id === category)) setCategory('all');
  }, [items, category]);
  useEffect(() => { storeCategory(playlistId, category); }, [playlistId, category]);

  const selectedItem = items.find((i): i is Extract<CategoryItem, { kind: 'category' }> => i.kind === 'category' && i.id === category);
  const channels = useMemo<Channel[]>(() => {
    if (category === 'favorites') return favorites;
    if (category === 'recent') return recents;
    if (category.startsWith('favlist:')) {
      const list = favoriteLists?.find(l => `favlist:${l.id}` === category);
      return (list?.channelIds ?? []).map(id => byId.get(id)).filter((c): c is Channel => !!c && allowed(c));
    }
    if (category === 'all') return allChannels.filter(allowed);
    const name = category.slice('group:'.length);
    if (parentalLocked && lockedSet.has(name)) return [];
    return groups.find(g => g.name === name)?.channels ?? [];
  }, [category, favorites, favoriteLists, byId, recents, allChannels, allowed, groups, parentalLocked, lockedSet]);

  const [column, setColumn] = useState<Column>('list');
  const [catIndex, setCatIndex] = useState(() => Math.max(0, items.findIndex(i => i.id === category)));
  const [row, setRow] = useState(0);
  const [infoIndex, setInfoIndex] = useState(0);
  // Catégorie changée ailleurs (stockage, chaîne en cours) : la colonne de gauche suit.
  useEffect(() => {
    if (column === 'cat') return;
    const index = items.findIndex(i => i.id === category);
    if (index >= 0) setCatIndex(index);
  }, [items, category, column]);

  // La chaîne en cours (retour du lecteur, zapping) redevient la ligne active.
  useEffect(() => {
    if (!currentChannel) return;
    const index = channels.findIndex(c => c.id === currentChannel.id);
    if (index >= 0) setRow(index);
  }, [currentChannel, channels]);
  useEffect(() => { setRow(r => Math.min(r, Math.max(0, channels.length - 1))); }, [channels.length]);

  const highlighted = channels[row] ?? null;

  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => [...new Set([...defaultRangeExtractor(range), row])].filter(i => i < channels.length).sort((a, b) => a - b),
  });

  // Avant la première mesure (ou sans mise en page), une fenêtre autour de la ligne active.
  const measured: { index: number; start: number; key: React.Key }[] = virtualizer.getVirtualItems();
  const visibleRows = measured.length || !channels.length ? measured
    : Array.from({ length: Math.min(channels.length, row + 11) - Math.max(0, row - 10) }, (_, i) => {
      const index = Math.max(0, row - 10) + i;
      return { index, start: index * ROW_HEIGHT, key: index };
    });

  // Hauteur : tout l'espace restant sous les rubriques, sans défilement de page.
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const top = rootRef.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(320, Math.floor(window.innerHeight - Math.max(0, top) - 12)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Mode manuel : l'aperçu ne démarre que sur le bouton « Aperçu » (pas d'ouverture au survol),
  // et pour la chaîne surlignée au moment de l'appui seulement. Chaque changement de chaîne le
  // coupe et exige un nouvel appui : limite les connexions répétées (petites box, abonnements
  // sensibles aux ouvertures simultanées).
  const [manualPreview, setManualPreview] = useState(false);
  useEffect(() => { setManualPreview(false); }, [preview, previewMode, highlighted?.id]);

  const infoActions = useMemo(() => {
    if (!highlighted) return [] as { id: string; label: string; short: string; icon: React.ReactNode; run: () => void }[];
    const fav = favoriteSet.has(highlighted.id);
    return [
      { id: 'play', label: 'Regarder', short: 'Regarder', icon: <Play className="h-5 w-5" aria-hidden="true" />, run: () => onPlay(highlighted) },
      ...(preview && previewMode === 'manual' ? [{ id: 'preview', label: manualPreview ? 'Couper l’aperçu' : 'Aperçu', short: manualPreview ? 'Couper' : 'Aperçu', icon: <Eye className="h-5 w-5" aria-hidden="true" />, run: () => setManualPreview(v => !v) }] : []),
      { id: 'fav', label: fav ? 'Retirer des favoris' : 'Ajouter aux favoris', short: fav ? 'Retirer' : 'Favori', icon: <Heart className={`h-5 w-5 ${fav ? 'fill-current' : ''}`} aria-hidden="true" />, run: () => {
        const next = fav ? favoriteIds.filter(id => id !== highlighted.id) : [...favoriteIds, highlighted.id];
        void saveFavoritesToDB(next).then(() => window.dispatchEvent(new Event('favorites-updated')));
      } },
      ...(onMosaic ? [{ id: 'mosaic', label: 'Mosaïque', short: 'Mosaïque', icon: <Grid2X2 className="h-5 w-5" aria-hidden="true" />, run: () => onMosaic(highlighted) }] : []),
      ...(onRecord ? [{ id: 'record', label: 'Enregistrer', short: 'Enregistrer', icon: <CircleDot className="h-5 w-5" aria-hidden="true" />, run: () => onRecord(highlighted) }] : []),
      ...(onEdit ? [{ id: 'edit', label: 'Modifier la chaîne', short: 'Modifier', icon: <Pencil className="h-5 w-5" aria-hidden="true" />, run: () => onEdit(highlighted) }] : []),
    ];
  }, [highlighted, favoriteSet, favoriteIds, onPlay, onMosaic, onRecord, onEdit, preview, previewMode, manualPreview]);
  useEffect(() => { setInfoIndex(i => Math.min(i, Math.max(0, infoActions.length - 1))); }, [infoActions.length]);

  // Retour sur l'écran (lecteur fermé, rubrique rouverte) à la télécommande : focus sur la liste.
  useLayoutEffect(() => {
    if (!document.documentElement.classList.contains('remote-navigation')) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    if (channels.length) setColumn('list'); else setColumn('cat');
    requestFocus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parcourir les catégories : la liste suit après une courte pause, pas à chaque étape.
  useEffect(() => {
    if (column !== 'cat') return;
    const item = items[catIndex];
    if (item?.kind !== 'category' || item.id === category) return;
    const t = window.setTimeout(() => { setCategory(item.id); setRow(0); }, 250);
    return () => window.clearTimeout(t);
  }, [column, catIndex, items, category]);

  // Garder la ligne active visible avec une ligne de contexte (hauteur fixe : calcul direct,
  // sans le défilement asynchrone du virtualiseur qui décroche sur les appuis répétés).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !channels.length) return;
    const top = row * ROW_HEIGHT, bottom = top + ROW_HEIGHT;
    const margin = el.clientHeight > ROW_HEIGHT * 3 ? ROW_HEIGHT : 0;
    if (top - margin < el.scrollTop) el.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > el.scrollTop + el.clientHeight) el.scrollTop = bottom + margin - el.clientHeight;
  }, [row, channels, height]);

  // Déplacer le vrai focus après le rendu de la cible (ligne virtualisée comprise).
  useLayoutEffect(() => {
    if (!pendingFocus.current) {
      // La ligne active a changé sans touche (chaîne en cours retrouvée) : le focus la suit.
      const a = document.activeElement;
      if (column !== 'list' || !(a instanceof HTMLElement) || !listRef.current?.contains(a) || a.dataset.tvRow === String(row)) return;
      pendingFocus.current = true;
    }
    let el: HTMLElement | null | undefined = null;
    if (column === 'cat') el = catRef.current?.querySelector<HTMLElement>(`[data-tv-cat="${catIndex}"]`);
    else if (column === 'list') {
      // Catégorie vide (ou protégée) : rester sur les catégories.
      if (!channels.length) { setColumn('cat'); return; }
      el = listRef.current?.querySelector<HTMLElement>(`[data-tv-row="${row}"]`);
    }
    else el = infoRef.current?.querySelector<HTMLElement>(`[data-tv-info="${infoIndex}"]`);
    if (!el) return;
    pendingFocus.current = false;
    redirecting.current = false;
    el.focus({ preventScroll: true });
    if (column !== 'list') el.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  });

  /** Appliquer tout de suite la catégorie sous le focus (droite ou OK). */
  const commitCategory = () => {
    const item = items[catIndex];
    if (item?.kind !== 'category' || item.id === category) return false;
    setCategory(item.id);
    setRow(0);
    return true;
  };
  const go = (next: Column) => {
    if (next === 'list' && column === 'cat' && commitCategory()) { requestFocus(); setColumn('list'); return true; }
    if (next === 'list' && channels.length === 0) return false;
    if (next === 'info' && infoActions.length === 0) return false;
    requestFocus();
    setColumn(next);
    return true;
  };

  const moveCat = (delta: number) => {
    const next = Math.max(0, Math.min(items.length - 1, catIndex + delta));
    if (next === catIndex) return false;
    requestFocus();
    setCatIndex(next);
    return true;
  };

  const moveRow = (delta: number) => {
    const next = Math.max(0, Math.min(channels.length - 1, row + delta));
    if (next === row) return false;
    requestFocus();
    setRow(next);
    return true;
  };

  const moveInfo = (delta: number) => {
    const next = Math.max(0, Math.min(infoActions.length - 1, infoIndex + delta));
    if (next === infoIndex) return false;
    requestFocus();
    setInfoIndex(next);
    return true;
  };

  /** Actions en grille de 2 (aperçu vidéo) : pas de déplacement hors de la grille. */
  const moveGrid = (delta: number) => {
    const next = infoIndex + delta;
    if (next < 0 || next >= infoActions.length) return false;
    requestFocus();
    setInfoIndex(next);
    return true;
  };

  // ── Zapping numérique (chiffres de la télécommande) ──────────────────
  // Tampon comme dans le lecteur : validation auto après 1500 ms, Entrée pour avancer.
  // Un numéro validé déplace la sélection (jamais de lecture directe) : l'écran garde son
  // modèle « surligner puis OK », l'aperçu démarre seul après le délai habituel.
  const [zapBuffer, setZapBuffer] = useState('');
  const [zapMiss, setZapMiss] = useState<string | null>(null);
  const zapTimer = useRef<number | null>(null);
  const clearZapTimer = () => { if (zapTimer.current !== null) { window.clearTimeout(zapTimer.current); zapTimer.current = null; } };
  useEffect(() => clearZapTimer, []);
  const commitZap = useCallback((buffer: string) => {
    clearZapTimer();
    setZapBuffer('');
    const target = findChannelByNumber(numberingSource, buffer);
    if (!target) { setZapMiss(buffer); window.setTimeout(() => setZapMiss(null), 1500); return; }
    const inList = channels.findIndex(c => c.id === target.id);
    if (inList >= 0) { requestFocus(); setColumn('list'); setRow(inList); return; }
    // Ailleurs : rejoindre la catégorie de la chaîne (son groupe, sinon « Toutes »).
    const inGroup = target.group ? groups.find(g => g.name === target.group) : undefined;
    const nextCategory = inGroup ? `group:${inGroup.name}` : 'all';
    const nextChannels = nextCategory === 'all' ? allChannels.filter(allowed) : (inGroup?.channels ?? []);
    const nextRow = Math.max(0, nextChannels.findIndex(c => c.id === target.id));
    const nextCatIndex = Math.max(0, items.findIndex(i => i.id === nextCategory));
    requestFocus();
    setCategory(nextCategory);
    setCatIndex(nextCatIndex);
    setColumn('list');
    setRow(nextRow);
  }, [numberingSource, channels, groups, allChannels, allowed, items]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key;
    // Chiffres : tampon de zapping (aucune autre action n'utilise les chiffres ici).
    if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      e.stopPropagation();
      clearZapTimer();
      setZapMiss(null);
      // Longueur unique avec le lecteur natif (5 chiffres) : un numéro possible dans
      // un écran doit l'être dans tous.
      const next = (zapBuffer + key).slice(0, 5);
      setZapBuffer(next);
      zapTimer.current = window.setTimeout(() => commitZap(next), 1500);
      return;
    }
    if (key === 'Enter' && zapBuffer) {
      e.preventDefault();
      e.stopPropagation();
      commitZap(zapBuffer);
      return;
    }
    if (key === 'Backspace' && zapBuffer) {
      e.preventDefault();
      e.stopPropagation();
      clearZapTimer();
      const next = zapBuffer.slice(0, -1);
      setZapBuffer(next);
      if (next) zapTimer.current = window.setTimeout(() => commitZap(next), 1500);
      return;
    }
    if (key === 'Escape' && (zapBuffer || zapMiss)) {
      e.preventDefault();
      e.stopPropagation();
      clearZapTimer();
      setZapBuffer('');
      setZapMiss(null);
      return;
    }
    let handled = false;
    if (preview && column === 'info' && key.startsWith('Arrow')) {
      if (key === 'ArrowDown') handled = moveGrid(2) || true;
      else if (key === 'ArrowUp') handled = moveGrid(-2); // première ligne : les rubriques
      else if (key === 'ArrowRight') handled = (infoIndex % 2 === 0 && moveGrid(1)) || true;
      else handled = infoIndex % 2 === 1 ? moveGrid(-1) : go('list') || true;
    } else if (key === 'ArrowDown') handled = column === 'cat' ? moveCat(1) || true : column === 'list' ? moveRow(1) || true : moveInfo(1) || true;
    else if (key === 'ArrowUp') {
      // Haut sur le premier élément : la navigation générale remonte aux rubriques.
      handled = column === 'cat' ? moveCat(-1) : column === 'list' ? moveRow(-1) : moveInfo(-1);
    } else if (key === 'ArrowRight') handled = (column === 'cat' ? go('list') : column === 'list' ? go('info') : false) || true;
    else if (key === 'ArrowLeft') handled = (column === 'info' ? go('list') : column === 'list' ? go('cat') : false) || true;
    else if (key === 'PageDown' || key === 'ChannelDown') handled = column === 'list' ? moveRow(PAGE) || true : column === 'cat' ? moveCat(PAGE) || true : false;
    else if (key === 'PageUp' || key === 'ChannelUp') handled = column === 'list' ? moveRow(-PAGE) || true : column === 'cat' ? moveCat(-PAGE) || true : false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  // Retour : aperçu → chaînes → catégories, puis le comportement habituel (Accueil).
  useEffect(() => {
    const onBack = (event: Event) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !rootRef.current?.contains(active)) return;
      if (column === 'info') { event.preventDefault(); go('list'); }
      else if (column === 'list') { event.preventDefault(); go('cat'); }
    };
    window.addEventListener('tv-live-back', onBack);
    return () => window.removeEventListener('tv-live-back', onBack);
  });

  // Entrer dans l'écran à la télécommande : rejoindre la colonne active, pas la plus proche.
  const onFocusCapture = (e: React.FocusEvent) => {
    const from = e.relatedTarget;
    if (from instanceof Node && rootRef.current?.contains(from)) return;
    if (!document.documentElement.classList.contains('remote-navigation')) return;
    const target = e.target as HTMLElement;
    // Bas depuis les rubriques vise la première commande de gauche. Ne pas la
    // détourner vers la dernière chaîne : Rechercher/Guide/Organiser doivent rester accessibles.
    if (target.hasAttribute('data-remote-entry')) return;
    const col: Column | null = target.closest('[data-tv-col="cat"]') ? 'cat' : target.closest('[data-tv-col="list"]') ? 'list' : target.closest('[data-tv-col="info"]') ? 'info' : null;
    const wanted: Column = channels.length ? 'list' : 'cat';
    const index = wanted === 'list' ? String(row) : String(catIndex);
    if (col !== wanted || (wanted === 'list' ? target.dataset.tvRow : target.dataset.tvCat) !== index) {
      redirecting.current = true;
      requestFocus();
      setColumn(wanted);
    }
  };
  // Le focus réel peut changer à la souris : garder la colonne cohérente.
  // Callback stable : la mémoïsation des lignes doit survivre aux re-rendus de l'écran.
  const syncColumn = useCallback((col: Column, index: number) => {
    if (redirecting.current) return;
    setColumn(col);
    if (col === 'cat') setCatIndex(index);
    else if (col === 'list') setRow(index);
    else setInfoIndex(index);
  }, []);
  const handleRowFocus = useCallback((index: number) => syncColumn('list', index), [syncColumn]);

  // ── Aperçu vidéo ─────────────────────────────────────────────────────
  // Actif quand le focus est dans la liste ou l'aperçu : pas en parcourant les catégories,
  // ni quand une fenêtre (recherche, réglages) ou les rubriques ont pris le focus.
  const previewRef = useRef<HTMLDivElement>(null);
  const [focusInside, setFocusInside] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'waiting' | PreviewState>('idle');
  const previewUrl = preview && focusInside && column !== 'cat' && highlighted && (previewMode !== 'manual' || manualPreview) ? highlighted.url : null;
  const requested = useRef<string | null>(null);
  const sendPreview = useCallback((url: string) => {
    const box = previewRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    requested.current = url;
    void NativePlayerBridge.showPreview({ url, x: box.left, y: box.top, width: box.width, height: box.height, radius: 12, dpr: window.devicePixelRatio || 1 });
  }, []);
  useEffect(() => {
    if (!preview) return;
    const unsubscribe = NativePlayerBridge.onPreviewState(setPreviewState);
    const relayout = () => { if (requested.current) sendPreview(requested.current); };
    window.addEventListener('resize', relayout);
    return () => {
      unsubscribe();
      window.removeEventListener('resize', relayout);
      requested.current = null;
      void NativePlayerBridge.hidePreview();
    };
  }, [preview, sendPreview]);
  useEffect(() => {
    if (!preview) return;
    requested.current = null;
    void NativePlayerBridge.stopPreview();
    if (!previewUrl) { setPreviewState('idle'); return; }
    setPreviewState('waiting');
    const t = window.setTimeout(() => sendPreview(previewUrl), PREVIEW_DELAY);
    return () => window.clearTimeout(t);
  }, [preview, previewUrl, sendPreview]);
  const onFocusIn = () => setFocusInside(true);
  // Vérifier après coup : une ligne virtualisée remplacée ou la fenêtre qui passe au lecteur
  // ne doivent pas couper l'aperçu, seule une sortie réelle du focus le fait.
  const onFocusOut = () => { window.setTimeout(() => setFocusInside(!!rootRef.current?.contains(document.activeElement)), 0); };

  const current = highlighted && epgData ? getCurrentProgram(highlighted.id, epgData, now) : null;
  const upcoming = highlighted && epgData ? getUpcomingProgram(highlighted.id, epgData, now) : null;
  const listTitle = selectedItem?.label ?? 'Chaînes';
  const categoryFocused = column === 'cat';
  const categoryButtons = useMemo(() => items.map((item, index) => <CategoryButton key={item.id} item={item} index={index}
    selected={item.kind === 'category' && item.id === category}
    focused={categoryFocused && index === catIndex} />), [items, category, categoryFocused, catIndex]);

  return (
    <div
      ref={rootRef}
      data-remote-self
      data-tv-live
      data-tv-column={column}
      className="tv-live relative grid gap-3 text-foreground"
      style={height ? { height } : undefined}
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
    >
      {/* Tampon de zapping numérique : chiffres composés, ou numéro sans chaîne */}
      {(zapBuffer || zapMiss) && (
        <div role="status" aria-label="Zapping" className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center">
          <span className="rounded-xl bg-black/85 px-4 py-2 font-mono text-2xl font-bold text-white">
            {zapBuffer || `Aucune chaîne n° ${zapMiss}`}
          </span>
        </div>
      )}
      {/* Catégories */}
      <nav aria-label="Catégories" data-tv-col="cat" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 ${column === 'cat' ? 'is-active' : ''}`}>
        <div ref={catRef} className="tv-scroll min-h-0 flex-1 overflow-y-auto p-2"
          onFocus={e => {
            const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tv-cat]');
            if (target) syncColumn('cat', Number(target.dataset.tvCat));
          }}
          onClick={e => {
            const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tv-cat]');
            if (!target) return;
            const index = Number(target.dataset.tvCat);
            const item = items[index];
            if (!item) return;
            if (item.kind === 'action') { (item.id === 'search' ? onSearch : item.id === 'organize' ? onOrganize : item.id === 'sort' ? onToggleSort : onGuide)?.(); return; }
            if (item.locked) { onLockedGroupSelect?.(); return; }
            setCatIndex(index);
            if (item.id !== category) { setCategory(item.id); setRow(0); }
            requestFocus(); setColumn('list');
          }}>
          {categoryButtons}
        </div>
      </nav>

      {/* Chaînes */}
      <section aria-label={`Chaînes : ${listTitle}`} data-tv-col="list" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 ${column === 'list' ? 'is-active' : ''}`}>
        <header className="flex shrink-0 items-baseline justify-between gap-3 px-4 pb-1.5 pt-3">
          <h2 className="truncate text-[15px] font-semibold">{listTitle}</h2>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" role="status">{channels.length ? `${row + 1} / ${channels.length}` : '0'}</span>
        </header>
        <div ref={listRef} className="tv-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {channels.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              {selectedItem?.locked ? 'Groupe protégé : sélectionne-le et appuie sur OK pour saisir le code.'
                : category === 'favorites' ? 'Aucun favori. Choisis une chaîne puis « Ajouter aux favoris » à droite.'
                : category === 'recent' ? 'Aucune chaîne regardée récemment.'
                : 'Aucune chaîne dans cette catégorie.'}
            </p>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {visibleRows.map(v => {
                const channel = channels[v.index];
                if (!channel) return null;
                return <ChannelRow
                  key={v.key}
                  channel={channel}
                  index={v.index}
                  number={numberById.get(channel.id)}
                  start={v.start}
                  selected={column === 'list' && v.index === row}
                  highlighted={v.index === row}
                  playing={currentChannel?.id === channel.id}
                  program={epgData ? getCurrentProgram(channel.id, epgData, now) : null}
                  favorite={favoriteSet.has(channel.id)}
                  onPlay={onPlay}
                  onFocus={handleRowFocus}
                />;
              })}
            </div>
          )}
        </div>
      </section>

      {/* Aperçu */}
      <aside aria-label="Aperçu" data-tv-col="info" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 p-4 ${column === 'info' ? 'is-active' : ''}`}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{highlighted?.group ?? ''}</span>
          <span className="font-mono tabular-nums">{formatTime(now)}</span>
        </div>
        {highlighted ? <>
          {preview ? <>
            {/* Emplacement de la vidéo : Android y pose son lecteur ; dessous, le logo en attendant l'image. */}
            <div ref={previewRef} data-tv-preview={previewState} className="tv-preview relative mt-2 flex w-full shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '16 / 9' }}>
              <ChannelLogo src={highlighted.logo ?? null} name={highlighted.name} />
              <span className="px-2 text-center text-[11px] text-muted-foreground" role="status">
                {previewState === 'error' ? 'Aperçu indisponible'
                  : previewState === 'idle' && previewMode === 'manual' && !manualPreview ? 'Lance via « Aperçu »'
                  : previewState === 'idle' ? '' : 'Aperçu…'}
              </span>
            </div>
            <div className="mt-2 flex min-w-0 items-baseline gap-2">
              <h3 className="min-w-0 truncate text-base font-semibold leading-6">{highlighted.name}</h3>
              {highlighted.quality && <span className="shrink-0 font-mono text-xs text-muted-foreground">{highlighted.quality}</span>}
            </div>
          </> : <div className="mt-3 flex items-center gap-3">
            <ChannelLogo src={highlighted.logo ?? null} name={highlighted.name} />
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-lg font-semibold leading-6">{highlighted.name}</h3>
              {highlighted.quality && <span className="font-mono text-xs text-muted-foreground">{highlighted.quality}</span>}
            </div>
          </div>}
          <div className={`${preview ? 'mt-2' : 'mt-4'} min-h-0 flex-1 space-y-3 overflow-hidden text-sm`}>
            {current ? <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">En ce moment</p>
              <p className="mt-0.5 line-clamp-2 font-medium">{current.title}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatTime(current.startTime)}–{formatTime(current.endTime)}</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800"><span className="block h-full bg-primary" style={{ width: `${getProgramProgress(current, now)}%` }} /></span>
              </div>
            </div> : <p className="text-muted-foreground">Pas d’information de programme.</p>}
            {upcoming && <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ensuite · <span className="font-mono">{formatTime(upcoming.startTime)}</span></p>
              <p className="mt-0.5 line-clamp-2">{upcoming.title}</p>
            </div>}
          </div>
          <div ref={infoRef} className={preview ? 'mt-2 grid grid-cols-2 gap-1.5' : 'mt-3 space-y-1.5'}>
            {infoActions.map((action, index) => <button
              key={action.id}
              type="button"
              data-tv-item
              data-tv-info={index}
              aria-label={preview ? action.label : undefined}
              tabIndex={column === 'info' && index === infoIndex ? 0 : -1}
              onFocus={() => syncColumn('info', index)}
              onClick={action.run}
              className={preview
                ? `tv-action tv-action-compact flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-2.5 text-left text-[13px] ${action.id === 'play' ? 'is-primary' : ''}`
                : `tv-action flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] ${action.id === 'play' ? 'is-primary' : ''}`}
            >{action.icon}<span className="truncate">{preview ? action.short : action.label}</span></button>)}
          </div>
        </> : <p className="mt-4 text-sm text-muted-foreground">Choisis une catégorie à gauche.</p>}
        {!preview && <p className="mt-3 border-t border-neutral-900 pt-2 text-[11px] text-muted-foreground">OK : regarder · ◀ ▶ : colonnes · Retour : catégories</p>}
      </aside>
    </div>
  );
}
