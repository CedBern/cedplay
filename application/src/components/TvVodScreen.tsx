import { focusMainNavigation } from '@/utils/remoteNavigation';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, ChevronDown, HardDrive, RefreshCw, Search, Sparkles } from 'lucide-react';
import type { CatalogCategory, CatalogItem } from '@/utils/xtreamCatalog';
import { VodPoster } from '@/components/VodPoster';
import { prefetchPosters } from '@/utils/vodPosterCache';

type Column = 'cat' | 'grid';
type CatItem =
  | { kind: 'action'; id: 'search' | 'watchlist' | 'foryou' | 'refresh' | 'local'; label: string }
  | { kind: 'category'; id: string; label: string };
type Cell = { kind: 'poster'; item: CatalogItem } | { kind: 'more' };

const COLS = 6;
const PAGE = 8;
const PAGE_ROWS = 3;

/** Dernière position connue (catégorie + affiche surlignée) ; VodLibrary lit la catégorie au chargement. */
export function storedVodPosition(playlistId: string, kind: 'movie' | 'series'): { category: string; itemId?: string } | null {
  try {
    const raw = localStorage.getItem(`cedplay.tvVod:${playlistId}:${kind}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as { category?: unknown; itemId?: unknown };
    if (typeof value.category !== 'string') return null;
    return { category: value.category, ...(typeof value.itemId === 'string' && value.itemId ? { itemId: value.itemId } : {}) };
  } catch { return null; }
}

function storeVodPosition(playlistId: string, kind: 'movie' | 'series', position: { category: string | null; itemId?: string | undefined }): void {
  try {
    localStorage.setItem(`cedplay.tvVod:${playlistId}:${kind}`, JSON.stringify({ category: position.category ?? '', ...(position.itemId ? { itemId: position.itemId } : {}) }));
  } catch { /* stockage indisponible */ }
}

export interface TvVodScreenProps {
  kind: 'movie' | 'series';
  playlistId: string;
  categories: CatalogCategory[];
  /** Catégorie appliquée (null pendant un chargement) ; '' = toutes les catégories. */
  category: string | null;
  onSelectCategory: (id: string) => void;
  /** Titres déjà limités à la pagination ; la recherche « dans la catégorie » reste mobile. */
  items: CatalogItem[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  hasMore: boolean;
  onLoadMore: () => void;
  showWatchlistOnly: boolean;
  onToggleWatchlistOnly: () => void;
  /** Films : suggestions « Pour toi », proposées comme Ma Liste dans la colonne de gauche. */
  showForYou?: boolean | undefined;
  onToggleForYou?: (() => void) | undefined;
  forYouEmptyText?: string | undefined;
  watchlistCount: number;
  watchlistIds: Set<string>;
  /** OK sur une affiche : ouvrir la fiche (sous-titres, saisons et épisodes y sont choisis). */
  onOpen: (item: CatalogItem) => void;
  onRefresh: () => void;
  onSearch?: (() => void) | undefined;
  /** Films : bibliothèque USB/SD, proposée comme une action de la colonne de gauche. */
  onShowLocal?: (() => void) | undefined;
  /** Reprise de lecture : « Reprendre à N min » s'affiche sous l'affiche concernée. */
  progress: (id: string) => { label: string; saved: boolean };
}

/** Cellule d'affiche : mémoïsée, sans handler propre — focus et clic sont délégués au conteneur
 * de la grille. Un déplacement ne re-rend ainsi que les deux cellules qui changent d'état. */
const PosterCell = memo(function PosterCell({ item, index, selected, focusable, watchlisted, resume, kind }: {
  item: CatalogItem; index: number; selected: boolean; focusable: boolean; watchlisted: boolean; resume: string | null; kind: 'movie' | 'series';
}) {
  return (
    <button
      type="button"
      {...(index === 0 ? { 'data-remote-start': true } : {})}
      data-tv-item
      data-tv-row={index}
      tabIndex={focusable ? 0 : -1}
      className={`tv-row poster press text-left rounded-xl overflow-hidden bg-card border border-neutral-900 ${selected ? 'is-selected' : ''}`}
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-neutral-900 flex items-center justify-center">
        <VodPoster src={item.poster} kind={kind} />
        {watchlisted && <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-1 z-10" title="Dans ma liste"><Bookmark className="h-3 w-3 fill-current" /></div>}
      </div>
      <div className="p-2"><p className="text-xs line-clamp-2">{item.name}</p>{item.rating && <p className="text-xs text-neutral-400">★ {item.rating}</p>}{resume && <p className="text-[11px] text-muted-foreground line-clamp-1">{resume}</p>}</div>
    </button>
  );
});

/** Cellule « Afficher davantage » : mémoïsée, clic délégué au conteneur. */
const MoreCell = memo(function MoreCell({ index, focusable }: { index: number; focusable: boolean }) {
  return (
    <button
      type="button"
      data-tv-item
      data-tv-row={index}
      tabIndex={focusable ? 0 : -1}
      className="tv-row flex aspect-[2/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-neutral-900 bg-card text-center text-[13px] text-muted-foreground"
    >
      <ChevronDown className="h-6 w-6" aria-hidden="true" />
      Afficher davantage
    </button>
  );
});

/** Bouton de catégorie/action : mémoïsé, focus et clic délégués au conteneur. */
const CategoryButton = memo(function CategoryButton({ item, index, selected, watchlistActive, focused, watchlistCount }: {
  item: CatItem; index: number; selected: boolean; watchlistActive: boolean; focused: boolean; watchlistCount: number;
}) {
  const icon = item.kind === 'action'
    ? (item.id === 'search' ? <Search className="h-4 w-4" aria-hidden="true" />
      : item.id === 'watchlist' ? (watchlistActive ? <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />)
      : item.id === 'foryou' ? <Sparkles className={`h-4 w-4 ${watchlistActive ? 'text-primary' : ''}`} aria-hidden="true" />
      : item.id === 'local' ? <HardDrive className="h-4 w-4" aria-hidden="true" />
      : <RefreshCw className="h-4 w-4" aria-hidden="true" />)
    : null;
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      aria-pressed={item.kind === 'action' && (item.id === 'watchlist' || item.id === 'foryou') ? watchlistActive : undefined}
      data-tv-item
      data-tv-cat={index}
      tabIndex={focused ? 0 : -1}
      className={`tv-cat flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-[15px] ${selected || watchlistActive ? 'is-selected' : ''} ${item.kind === 'action' ? 'text-muted-foreground' : ''}`}
    >
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 line-clamp-2 leading-5">{item.label}</span>
      {item.kind === 'action' && item.id === 'watchlist' && <span className="shrink-0 font-mono text-xs tabular-nums opacity-70">{watchlistCount}</span>}
    </button>
  );
});

/**
 * Écran catalogue (Films / Séries) pour la télécommande, sur le modèle de TvLiveScreen :
 * catégories | grille d'affiches.
 * OK sur une affiche ouvre la fiche complète : c'est elle qui porte le synopsis, la lecture
 * et Ma Liste, en un seul appui — la fiche éclair d'une troisième colonne coûtait un quart
 * de la largeur sans être atteignable sans traverser toute la ligne.
 * Une seule cible focalisable par colonne (tabindex itinérant) ; les flèches sont gérées ici,
 * Haut depuis la première ligne rend la main à la navigation générale (rubriques).
 * Cellules et colonnes sont mémoïsées (focus/clic délégués aux conteneurs) : un appui
 * prolongé ne re-rend plus l'écran entier — c'est lui qui saccadait à la télécommande.
 * La dernière position (catégorie + affiche surlignée) est conservée dans le stockage local
 * pour retrouver la grille telle qu'elle était au retour.
 */
export function TvVodScreen({
  kind, playlistId, categories, category, onSelectCategory, items, loading, error, onRetry,
  hasMore, onLoadMore, showWatchlistOnly, onToggleWatchlistOnly, showForYou = false, onToggleForYou, forYouEmptyText,
  watchlistCount, watchlistIds, onOpen, onRefresh, onSearch, onShowLocal, progress,
}: TvVodScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const redirecting = useRef(false);
  const [, setFocusTick] = useState(0);
  /** Demande de focus après le prochain rendu, même si l'état ne change pas. */
  const requestFocus = useCallback(() => { pendingFocus.current = true; setFocusTick(t => t + 1); }, []);

  const catItems = useMemo<CatItem[]>(() => {
    // Pas d'entrée « toutes les catégories » : sur un gros compte Xtream, elle
    // déclenchait le téléchargement de dizaines de milliers de titres et figeait
    // la box. Une catégorie réelle est toujours sélectionnée.
    const list: CatItem[] = [
      { kind: 'action', id: 'watchlist', label: 'Ma Liste' },
    ];
    if (onToggleForYou) list.push({ kind: 'action', id: 'foryou', label: 'Pour toi' });
    for (const c of categories) list.push({ kind: 'category', id: c.id, label: c.name });
    if (onSearch) list.push({ kind: 'action', id: 'search', label: 'Rechercher' });
    list.push({ kind: 'action', id: 'refresh', label: 'Actualiser' });
    if (onShowLocal) list.push({ kind: 'action', id: 'local', label: 'USB / SD' });
    return list;
  }, [onSearch, onShowLocal, onToggleForYou, categories]);

  const cells = useMemo<Cell[]>(() => {
    const list: Cell[] = items.map(item => ({ kind: 'poster' as const, item }));
    if (hasMore && items.length) list.push({ kind: 'more' });
    return list;
  }, [items, hasMore]);

  const [column, setColumn] = useState<Column>('grid');
  // Ma Liste / Pour toi affichés : la colonne de gauche pointe sur leur entrée, et choisir
  // n'importe quelle catégorie — même celle déjà retenue — revient au catalogue.
  const virtualList = showForYou ? 'foryou' : showWatchlistOnly ? 'watchlist' : null;
  const activeEntryIndex = (list: CatItem[]) => (virtualList
    ? list.findIndex(i => i.kind === 'action' && i.id === virtualList)
    : list.findIndex(i => i.kind === 'category' && i.id === category));
  const [catIndex, setCatIndex] = useState(() => Math.max(0, activeEntryIndex(catItems)));
  const [row, setRow] = useState(0);

  const highlighted = row < items.length ? items[row] ?? null : null;
  const selectedCat = catItems.find((i): i is Extract<CatItem, { kind: 'category' }> => i.kind === 'category' && i.id === category);
  const listTitle = showForYou ? 'Pour toi, d’après tes visionnages' : showWatchlistOnly ? 'Ma Liste' : selectedCat?.label ?? (kind === 'movie' ? 'Films' : 'Séries');

  // Catégorie changée ailleurs (chargement, reprise du stockage) : la colonne de gauche suit.
  useEffect(() => {
    if (column === 'cat') return;
    const index = activeEntryIndex(catItems);
    if (index >= 0) setCatIndex(index);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catItems, category, column, virtualList]);
  useEffect(() => { setCatIndex(i => Math.min(i, Math.max(0, catItems.length - 1))); }, [catItems.length]);
  useEffect(() => { setRow(r => Math.min(r, Math.max(0, cells.length - 1))); }, [cells.length]);

  // Préchargement intelligent des affiches : rangée actuelle + 3 rangées suivantes en mémoire.
  useEffect(() => {
    if (!items.length) return;
    const posters = items.slice(row, row + 20).map(item => item.poster);
    prefetchPosters(posters, 20);
  }, [items, row]);


  // Restauration de position : l'affiche surlignée de la dernière visite, si elle est encore là.
  const initialPosition = useMemo(() => storedVodPosition(playlistId, kind), [playlistId, kind]);
  const pendingRestore = useRef<string | null>(initialPosition?.itemId ?? null);
  const movedRef = useRef(false);
  // Ligne à refocaliser après restauration, même si le focus est déjà passé sur les
  // catégories entre-temps (catalogue chargé en différé).
  const restoreFocusRow = useRef<number | null>(null);
  useEffect(() => {
    if (!items.length) return;
    const id = pendingRestore.current;
    pendingRestore.current = null;
    if (!id || movedRef.current) return;
    const index = items.findIndex(i => i.id === id);
    if (index >= 0) {
      // L'affiche mémorisée est revenue : la grille reprend la main (le titre peut
      // arriver après le montage, l'écran étant alors resté sur les catégories).
      setRow(index);
      setColumn('grid');
      restoreFocusRow.current = index;
      requestFocus();
    }
  }, [items, requestFocus]);
  // La sauvegarde locale est synchrone : attendre une pause dans la navigation,
  // puis conserver aussi la dernière position au départ de l'écran.
  const positionRef = useRef<{ category: string | null; itemId?: string | undefined } | null>(null);
  useEffect(() => {
    if (!items.length) return;
    positionRef.current = { category, itemId: highlighted?.id };
    const timer = window.setTimeout(() => {
      if (positionRef.current) storeVodPosition(playlistId, kind, positionRef.current);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [playlistId, kind, category, highlighted?.id, items.length]);
  useEffect(() => () => {
    if (positionRef.current) storeVodPosition(playlistId, kind, positionRef.current);
  }, [playlistId, kind]);

  // Hauteur : tout l'espace restant sous les rubriques, sans défilement de page.
  // Estimée dès le premier rendu à partir de l'en-tête déjà monté : sans hauteur, la
  // rangée de grille prend la taille du contenu et la zone défilante n'a plus rien à
  // faire défiler (les flèches changent la sélection hors de l'écran).
  // Mesurée en-tête déplié ; l'en-tête replié (télécommande) ajoute sa hauteur par la
  // variable CSS --tv-vod-extra, animée en même temps que lui.
  const [height, setHeight] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const header = document.querySelector('[data-app-header]');
    const top = header?.getBoundingClientRect().bottom ?? 96;
    return Math.max(320, Math.floor(window.innerHeight - Math.max(0, top) - 12));
  });
  useLayoutEffect(() => {
    const measure = () => {
      const root = document.documentElement;
      const shift = root.classList.contains('tv-chrome-hidden') ? parseFloat(getComputedStyle(root).getPropertyValue('--tv-header-shift')) || 0 : 0;
      const top = (rootRef.current?.getBoundingClientRect().top ?? 0) + shift;
      setHeight(Math.max(320, Math.floor(window.innerHeight - Math.max(0, top) - 12)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Retour sur l'écran (fiche fermée, rubrique rouverte) à la télécommande : focus sur la grille.
  useLayoutEffect(() => {
    if (!document.documentElement.classList.contains('remote-navigation')) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    if (cells.length) setColumn('grid'); else setColumn('cat');
    requestFocus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parcourir les catégories : la grille suit après une courte pause, pas à chaque étape.
  useEffect(() => {
    if (column !== 'cat') return;
    const item = catItems[catIndex];
    if (item?.kind !== 'category' || (item.id === category && !virtualList)) return;
    const t = window.setTimeout(() => { movedRef.current = true; onSelectCategory(item.id); setRow(0); }, 250);
    return () => window.clearTimeout(t);
  }, [column, catIndex, catItems, category, virtualList, onSelectCategory]);

  // Déplacer le vrai focus après le rendu de la cible.
  useLayoutEffect(() => {
    // Retour sur l'affiche mémorisée : reprendre le focus même si l'attente du
    // catalogue l'avait laissé sur les catégories.
    if (restoreFocusRow.current !== null && column === 'grid' && row === restoreFocusRow.current) {
      pendingFocus.current = true;
      restoreFocusRow.current = null;
    }
    if (!pendingFocus.current) {
      // La ligne active a changé sans touche (position restaurée) : le focus la suit.
      const a = document.activeElement;
      if (column !== 'grid' || !(a instanceof HTMLElement) || !gridRef.current?.contains(a) || a.dataset.tvRow === String(row)) return;
      pendingFocus.current = true;
    }
    let el: HTMLElement | null | undefined = null;
    if (column === 'cat') el = catRef.current?.querySelector<HTMLElement>(`[data-tv-cat="${catIndex}"]`);
    else {
      // Sélection vide (chargement, Ma Liste vide) : rester sur les catégories.
      if (!cells.length) { setColumn('cat'); return; }
      el = gridRef.current?.querySelector<HTMLElement>(`[data-tv-row="${row}"]`);
    }
    if (!el) return;
    pendingFocus.current = false;
    redirecting.current = false;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  });

  /** Appliquer tout de suite la catégorie sous le focus (droite ou OK). */
  const commitCategory = () => {
    const item = catItems[catIndex];
    if (item?.kind !== 'category' || (item.id === category && !virtualList)) return false;
    movedRef.current = true;
    onSelectCategory(item.id);
    setRow(0);
    return true;
  };
  const go = (next: Column) => {
    if (next === 'grid' && column === 'cat' && commitCategory()) { requestFocus(); setColumn('grid'); return true; }
    if (next === 'grid' && cells.length === 0) return false;
    requestFocus();
    setColumn(next);
    return true;
  };

  const moveCat = (delta: number) => {
    const next = Math.max(0, Math.min(catItems.length - 1, catIndex + delta));
    if (next === catIndex) return false;
    movedRef.current = true;
    requestFocus();
    setCatIndex(next);
    return true;
  };

  const moveRow = (delta: number) => {
    const next = Math.max(0, Math.min(cells.length - 1, row + delta));
    if (next === row) return false;
    movedRef.current = true;
    requestFocus();
    setRow(next);
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key;
    let handled = false;
    if (key === 'ArrowDown') handled = column === 'cat' ? moveCat(1) || true : moveRow(COLS) || true;
    else if (key === 'ArrowUp') {
      // Haut sur le premier élément : la navigation générale remonte aux rubriques.
      // Première rangée : Haut quitte la grille au lieu de glisser vers la première affiche.
      handled = column === 'cat' ? moveCat(-1) : (row >= COLS && moveRow(-COLS));
      if (!handled) {
        // Toujours la rubrique active, même si l'en-tête replié est encore hors de l'écran.
        handled = focusMainNavigation(rootRef.current);
      }
    } else if (key === 'ArrowRight') {
      if (column === 'cat') handled = go('grid') || true;
      // Droite avance dans la ligne ; au bord droit elle ne sort plus de la grille :
      // c'est OK qui ouvre la fiche, en un seul appui depuis n'importe quelle affiche.
      else handled = (row % COLS < COLS - 1 && moveRow(1)) || true;
    } else if (key === 'ArrowLeft') {
      handled = column === 'grid' ? (row % COLS === 0 ? go('cat') : moveRow(-1)) || true : true;
    } else if (key === 'PageDown' || key === 'ChannelDown') handled = column === 'grid' ? moveRow(PAGE_ROWS * COLS) || true : moveCat(PAGE) || true;
    else if (key === 'PageUp' || key === 'ChannelUp') handled = column === 'grid' ? moveRow(-PAGE_ROWS * COLS) || true : moveCat(-PAGE) || true;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  // Retour : grille → catégories → navigation générale, puis le comportement habituel (Accueil).
  useEffect(() => {
    const onBack = (event: Event) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !rootRef.current?.contains(active)) return;
      if (column === 'grid') { event.preventDefault(); go('cat'); }
      else if (column === 'cat' && focusMainNavigation(rootRef.current)) event.preventDefault();
    };
    window.addEventListener('tv-vod-back', onBack);
    return () => window.removeEventListener('tv-vod-back', onBack);
  });

  // Entrer dans l'écran à la télécommande : rejoindre la colonne active, pas la plus proche.
  const onFocusCapture = (e: React.FocusEvent) => {
    const from = e.relatedTarget;
    if (from instanceof Node && rootRef.current?.contains(from)) return;
    if (!document.documentElement.classList.contains('remote-navigation')) return;
    const target = e.target as HTMLElement;
    const col: Column | null = target.closest('[data-tv-col="cat"]') ? 'cat' : target.closest('[data-tv-col="grid"]') ? 'grid' : null;
    const wanted: Column = cells.length ? 'grid' : 'cat';
    const index = wanted === 'grid' ? String(row) : String(catIndex);
    if (col !== wanted || (wanted === 'grid' ? target.dataset.tvRow : target.dataset.tvCat) !== index) {
      redirecting.current = true;
      requestFocus();
      setColumn(wanted);
    }
  };

  // Focus et clic : délégués aux conteneurs (les cellules mémoïsées n'ont pas de handler).
  const syncColumn = useCallback((col: Column, index: number) => {
    if (redirecting.current) return;
    setColumn(col);
    if (col === 'cat') setCatIndex(index);
    else setRow(index);
  }, []);
  const onGridFocus = useCallback((e: React.FocusEvent) => {
    const attr = (e.target as HTMLElement).getAttribute?.('data-tv-row');
    if (attr != null) syncColumn('grid', Number(attr));
  }, [syncColumn]);
  const onGridClick = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-tv-row]');
    if (!el) return;
    const cell = cells[Number(el.getAttribute('data-tv-row'))];
    if (!cell) return;
    if (cell.kind === 'more') onLoadMore();
    else onOpen(cell.item);
  }, [cells, onLoadMore, onOpen]);
  const onCatFocus = useCallback((e: React.FocusEvent) => {
    const attr = (e.target as HTMLElement).getAttribute?.('data-tv-cat');
    if (attr != null) syncColumn('cat', Number(attr));
  }, [syncColumn]);
  const onCatClick = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-tv-cat]');
    if (!el) return;
    const index = Number(el.getAttribute('data-tv-cat'));
    const item = catItems[index];
    if (!item) return;
    if (item.kind === 'action') {
      if (item.id === 'search') onSearch?.();
      else if (item.id === 'watchlist') onToggleWatchlistOnly();
      else if (item.id === 'foryou') onToggleForYou?.();
      else if (item.id === 'local') onShowLocal?.();
      else onRefresh();
      return;
    }
    setCatIndex(index);
    if (item.id !== category || virtualList) { movedRef.current = true; onSelectCategory(item.id); setRow(0); }
    requestFocus(); setColumn('grid');
  }, [virtualList, catItems, category, onSearch, onToggleWatchlistOnly, onToggleForYou, onRefresh, onShowLocal, onSelectCategory, requestFocus]);

  return (
    <div
      ref={rootRef}
      data-remote-self
      data-tv-vod
      data-tv-column={column}
      className="tv-vod grid gap-3 text-foreground"
      style={height ? { height: `calc(${height}px + var(--tv-vod-extra, 0px))` } : undefined}
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
    >
      {/* Catégories et actions */}
      <nav aria-label="Catégories" data-tv-col="cat" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 ${column === 'cat' ? 'is-active' : ''}`}>
        <div ref={catRef} className="tv-scroll min-h-0 flex-1 overflow-y-auto p-2" onFocus={onCatFocus} onClick={onCatClick}>
          {catItems.map((item, index) => (
            <React.Fragment key={`${item.kind}:${item.id}`}>
              {item.kind === 'category' && index > 0 && catItems[index - 1]?.kind === 'action' && <div className="mx-2 my-1.5 border-t border-neutral-900" aria-hidden="true" />}
              <CategoryButton
                item={item}
                index={index}
                selected={item.kind === 'category' && item.id === category && !showForYou}
                watchlistActive={item.kind === 'action' && ((item.id === 'watchlist' && showWatchlistOnly) || (item.id === 'foryou' && showForYou))}
                focused={column === 'cat' && index === catIndex}
                watchlistCount={watchlistCount}
              />
            </React.Fragment>
          ))}
        </div>
      </nav>

      {/* Grille d'affiches */}
      <section aria-label={`Titres : ${listTitle}`} data-tv-col="grid" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 ${column === 'grid' ? 'is-active' : ''}`}>
        <header className="flex shrink-0 items-baseline justify-between gap-3 px-4 pb-1.5 pt-3">
          <h2 className="truncate text-[15px] font-semibold">{listTitle}</h2>
          <span className="shrink-0 text-[11px] text-muted-foreground">OK : fiche</span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" role="status">{items.length ? `${Math.min(row + 1, items.length)} / ${items.length}` : '0'}</span>
        </header>
        <div ref={gridRef} className="tv-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3" onFocus={onGridFocus} onClick={onGridClick}>
          {loading ? <p className="px-3 py-6 text-sm text-muted-foreground" role="status">Chargement du catalogue…</p>
            : error ? <div className="space-y-2 px-3 py-6 text-amber-300" role="alert"><p>{error}</p><button type="button" onClick={onRetry} className="tv-action flex min-h-10 items-center gap-2 rounded-xl px-3 text-[15px]">Réessayer</button></div>
            : cells.length === 0 ? <p className="px-3 py-6 text-sm text-muted-foreground">{showForYou ? (forYouEmptyText ?? 'Aucune suggestion pour l’instant.') : showWatchlistOnly ? 'Ma Liste est vide ici : ajoute des titres depuis leur fiche.' : 'Aucun titre dans cette sélection.'}</p>
            : <div className="grid grid-cols-6 gap-3">
              {cells.map((cell, index) => {
                if (cell.kind === 'more') return <MoreCell key="more" index={index} focusable={column === 'grid' && index === row} />;
                const resume = progress(cell.item.id);
                return (
                  <PosterCell
                    key={cell.item.id}
                    item={cell.item}
                    index={index}
                    selected={index === row}
                    focusable={column === 'grid' && index === row}
                    watchlisted={watchlistIds.has(cell.item.id)}
                    resume={resume.saved ? resume.label : null}
                    kind={kind}
                  />
                );
              })}
            </div>}
        </div>
      </section>
    </div>
  );
}
