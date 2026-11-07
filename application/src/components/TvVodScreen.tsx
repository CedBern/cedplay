import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, ChevronDown, Info, Play, RefreshCw, Search } from 'lucide-react';
import type { CatalogCategory, CatalogItem } from '@/utils/xtreamCatalog';

type Column = 'cat' | 'grid' | 'info';
type CatItem =
  | { kind: 'action'; id: 'search' | 'watchlist' | 'refresh'; label: string }
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
  watchlistCount: number;
  watchlistIds: Set<string>;
  onToggleWatchlistItem: (item: CatalogItem) => void;
  /** OK sur une affiche : ouvrir la fiche (sous-titres, saisons et épisodes y sont choisis). */
  onOpen: (item: CatalogItem) => void;
  /** Lecture directe depuis la colonne de droite (films seulement ; les séries passent par la fiche). */
  onPlay?: ((item: CatalogItem) => void) | undefined;
  onRefresh: () => void;
  onSearch?: (() => void) | undefined;
  progressLabel: (id: string) => string;
}

/**
 * Écran catalogue (Films / Séries) pour la télécommande, sur le modèle de TvLiveScreen :
 * catégories | grille d'affiches | fiche éclair + actions.
 * Une seule cible focalisable par colonne (tabindex itinérant) ; les flèches sont gérées ici,
 * Haut depuis la première ligne rend la main à la navigation générale (rubriques).
 * La dernière position (catégorie + affiche surlignée) est conservée dans le stockage local
 * pour retrouver la grille telle qu'elle était au retour.
 */
export function TvVodScreen({
  kind, playlistId, categories, category, onSelectCategory, items, loading, error, onRetry,
  hasMore, onLoadMore, showWatchlistOnly, onToggleWatchlistOnly, watchlistCount, watchlistIds,
  onToggleWatchlistItem, onOpen, onPlay, onRefresh, onSearch, progressLabel,
}: TvVodScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const redirecting = useRef(false);
  const [, setFocusTick] = useState(0);
  /** Demande de focus après le prochain rendu, même si l'état ne change pas. */
  const requestFocus = () => { pendingFocus.current = true; setFocusTick(t => t + 1); };

  const catItems = useMemo<CatItem[]>(() => {
    const list: CatItem[] = [];
    if (onSearch) list.push({ kind: 'action', id: 'search', label: 'Rechercher' });
    list.push({ kind: 'action', id: 'watchlist', label: 'Ma Liste' });
    list.push({ kind: 'action', id: 'refresh', label: 'Actualiser' });
    list.push({ kind: 'category', id: '', label: 'Toutes les catégories' });
    for (const c of categories) list.push({ kind: 'category', id: c.id, label: c.name });
    return list;
  }, [onSearch, categories]);

  const cells = useMemo<Cell[]>(() => {
    const list: Cell[] = items.map(item => ({ kind: 'poster' as const, item }));
    if (hasMore && items.length) list.push({ kind: 'more' });
    return list;
  }, [items, hasMore]);

  const [column, setColumn] = useState<Column>('grid');
  const [catIndex, setCatIndex] = useState(() => Math.max(0, catItems.findIndex(i => i.kind === 'category' && i.id === category)));
  const [row, setRow] = useState(0);
  const [infoIndex, setInfoIndex] = useState(0);

  const highlighted = row < items.length ? items[row] ?? null : null;
  const selectedCat = catItems.find((i): i is Extract<CatItem, { kind: 'category' }> => i.kind === 'category' && i.id === category);
  const listTitle = showWatchlistOnly ? 'Ma Liste' : selectedCat?.label ?? (kind === 'movie' ? 'Films' : 'Séries');

  // Catégorie changée ailleurs (chargement, reprise du stockage) : la colonne de gauche suit.
  useEffect(() => {
    if (column === 'cat') return;
    const index = catItems.findIndex(i => i.kind === 'category' && i.id === category);
    if (index >= 0) setCatIndex(index);
  }, [catItems, category, column]);
  useEffect(() => { setCatIndex(i => Math.min(i, Math.max(0, catItems.length - 1))); }, [catItems.length]);
  useEffect(() => { setRow(r => Math.min(r, Math.max(0, cells.length - 1))); }, [cells.length]);

  // Restauration de position : l'affiche surlignée de la dernière visite, si elle est encore là.
  const initialPosition = useMemo(() => storedVodPosition(playlistId, kind), [playlistId, kind]);
  const pendingRestore = useRef<string | null>(initialPosition?.itemId ?? null);
  const movedRef = useRef(false);
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
      requestFocus();
    }
  }, [items]);
  // Persistance : écrite seulement une fois des titres affichés (pas pendant les chargements).
  const readyRef = useRef(false);
  useEffect(() => { if (items.length) readyRef.current = true; }, [items]);
  useEffect(() => {
    if (!readyRef.current) return;
    storeVodPosition(playlistId, kind, { category, itemId: highlighted?.id });
  }, [playlistId, kind, category, highlighted?.id]);

  const infoActions = useMemo(() => {
    if (!highlighted) return [] as { id: string; label: string; icon: React.ReactNode; run: () => void }[];
    const fav = watchlistIds.has(highlighted.id);
    return [
      ...(onPlay && highlighted.extension ? [{ id: 'play', label: progressLabel(highlighted.id), icon: <Play className="h-5 w-5" aria-hidden="true" />, run: () => onPlay(highlighted) }] : []),
      { id: 'details', label: 'Ouvrir la fiche', icon: <Info className="h-5 w-5" aria-hidden="true" />, run: () => onOpen(highlighted) },
      { id: 'fav', label: fav ? 'Retirer de Ma Liste' : 'Ajouter à Ma Liste', icon: fav ? <BookmarkCheck className="h-5 w-5 text-primary" aria-hidden="true" /> : <Bookmark className="h-5 w-5" aria-hidden="true" />, run: () => onToggleWatchlistItem(highlighted) },
    ];
  }, [highlighted, watchlistIds, onPlay, onOpen, onToggleWatchlistItem, progressLabel]);
  useEffect(() => { setInfoIndex(i => Math.min(i, Math.max(0, infoActions.length - 1))); }, [infoActions.length]);

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
    if (item?.kind !== 'category' || item.id === category) return;
    const t = window.setTimeout(() => { movedRef.current = true; onSelectCategory(item.id); setRow(0); }, 250);
    return () => window.clearTimeout(t);
  }, [column, catIndex, catItems, category, onSelectCategory]);

  // Déplacer le vrai focus après le rendu de la cible.
  useLayoutEffect(() => {
    if (!pendingFocus.current) {
      // La ligne active a changé sans touche (position restaurée) : le focus la suit.
      const a = document.activeElement;
      if (column !== 'grid' || !(a instanceof HTMLElement) || !gridRef.current?.contains(a) || a.dataset.tvRow === String(row)) return;
      pendingFocus.current = true;
    }
    let el: HTMLElement | null | undefined = null;
    if (column === 'cat') el = catRef.current?.querySelector<HTMLElement>(`[data-tv-cat="${catIndex}"]`);
    else if (column === 'grid') {
      // Sélection vide (chargement, Ma Liste vide) : rester sur les catégories.
      if (!cells.length) { setColumn('cat'); return; }
      el = gridRef.current?.querySelector<HTMLElement>(`[data-tv-row="${row}"]`);
    }
    else el = infoRef.current?.querySelector<HTMLElement>(`[data-tv-info="${infoIndex}"]`);
    if (!el) return;
    pendingFocus.current = false;
    redirecting.current = false;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  });

  /** Appliquer tout de suite la catégorie sous le focus (droite ou OK). */
  const commitCategory = () => {
    const item = catItems[catIndex];
    if (item?.kind !== 'category' || item.id === category) return false;
    movedRef.current = true;
    onSelectCategory(item.id);
    setRow(0);
    return true;
  };
  const go = (next: Column) => {
    if (next === 'grid' && column === 'cat' && commitCategory()) { requestFocus(); setColumn('grid'); return true; }
    if (next === 'grid' && cells.length === 0) return false;
    if (next === 'info' && infoActions.length === 0) return false;
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

  const moveInfo = (delta: number) => {
    const next = Math.max(0, Math.min(infoActions.length - 1, infoIndex + delta));
    if (next === infoIndex) return false;
    requestFocus();
    setInfoIndex(next);
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key;
    let handled = false;
    if (key === 'ArrowDown') handled = column === 'cat' ? moveCat(1) || true : column === 'grid' ? moveRow(COLS) || true : moveInfo(1) || true;
    else if (key === 'ArrowUp') {
      // Haut sur le premier élément : la navigation générale remonte aux rubriques.
      handled = column === 'cat' ? moveCat(-1) : column === 'grid' ? moveRow(-COLS) : moveInfo(-1);
    } else if (key === 'ArrowRight') {
      if (column === 'cat') handled = go('grid') || true;
      // Droite avance dans la ligne ; en bord de ligne ET en bout de liste (ligne
      // incomplète), elle entre dans la colonne de droite.
      else if (column === 'grid') handled = (row % COLS < COLS - 1 ? moveRow(1) : false) || go('info') || true;
      else handled = true;
    } else if (key === 'ArrowLeft') {
      if (column === 'info') handled = go('grid') || true;
      else if (column === 'grid') handled = (row % COLS === 0 ? go('cat') : moveRow(-1)) || true;
      else handled = true;
    } else if (key === 'PageDown' || key === 'ChannelDown') handled = column === 'grid' ? moveRow(PAGE_ROWS * COLS) || true : column === 'cat' ? moveCat(PAGE) || true : false;
    else if (key === 'PageUp' || key === 'ChannelUp') handled = column === 'grid' ? moveRow(-PAGE_ROWS * COLS) || true : column === 'cat' ? moveCat(-PAGE) || true : false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  // Retour : fiche éclair → grille → catégories, puis le comportement habituel (Accueil).
  useEffect(() => {
    const onBack = (event: Event) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !rootRef.current?.contains(active)) return;
      if (column === 'info') { event.preventDefault(); go('grid'); }
      else if (column === 'grid') { event.preventDefault(); go('cat'); }
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
    const col: Column | null = target.closest('[data-tv-col="cat"]') ? 'cat' : target.closest('[data-tv-col="grid"]') ? 'grid' : target.closest('[data-tv-col="info"]') ? 'info' : null;
    const wanted: Column = cells.length ? 'grid' : 'cat';
    const index = wanted === 'grid' ? String(row) : String(catIndex);
    if (col !== wanted || (wanted === 'grid' ? target.dataset.tvRow : target.dataset.tvCat) !== index) {
      redirecting.current = true;
      requestFocus();
      setColumn(wanted);
    }
  };
  // Le focus réel peut changer à la souris : garder la colonne cohérente.
  const syncColumn = (col: Column, index: number) => {
    if (redirecting.current) return;
    setColumn(col);
    if (col === 'cat') setCatIndex(index);
    else if (col === 'grid') setRow(index);
    else setInfoIndex(index);
  };

  return (
    <div
      ref={rootRef}
      data-remote-self
      data-tv-vod
      data-tv-column={column}
      className="tv-vod grid gap-3 text-foreground"
      style={height ? { height } : undefined}
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
    >
      {/* Catégories et actions */}
      <nav aria-label="Catégories" data-tv-col="cat" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 ${column === 'cat' ? 'is-active' : ''}`}>
        <div ref={catRef} className="tv-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {catItems.map((item, index) => {
            const selected = item.kind === 'category' && item.id === category;
            const watchlistActive = item.kind === 'action' && item.id === 'watchlist' && showWatchlistOnly;
            const icon = item.kind === 'action'
              ? (item.id === 'search' ? <Search className="h-4 w-4" aria-hidden="true" />
                : item.id === 'watchlist' ? (showWatchlistOnly ? <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />)
                : <RefreshCw className="h-4 w-4" aria-hidden="true" />)
              : null;
            return <React.Fragment key={`${item.kind}:${item.id}`}>
              {item.kind === 'category' && index > 0 && catItems[index - 1]?.kind === 'action' && <div className="mx-2 my-1.5 border-t border-neutral-900" aria-hidden="true" />}
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                aria-pressed={item.kind === 'action' && item.id === 'watchlist' ? showWatchlistOnly : undefined}
                data-tv-item
                data-tv-cat={index}
                tabIndex={column === 'cat' && index === catIndex ? 0 : -1}
                onFocus={() => syncColumn('cat', index)}
                onClick={() => {
                  if (item.kind === 'action') {
                    if (item.id === 'search') onSearch?.();
                    else if (item.id === 'watchlist') onToggleWatchlistOnly();
                    else onRefresh();
                    return;
                  }
                  setCatIndex(index);
                  if (item.id !== category) { movedRef.current = true; onSelectCategory(item.id); setRow(0); }
                  requestFocus(); setColumn('grid');
                }}
                className={`tv-cat flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[15px] ${selected || watchlistActive ? 'is-selected' : ''} ${item.kind === 'action' ? 'text-muted-foreground' : ''}`}
              >
                <span className="flex w-4 shrink-0 justify-center">{icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.kind === 'action' && item.id === 'watchlist' && <span className="shrink-0 font-mono text-xs tabular-nums opacity-70">{watchlistCount}</span>}
              </button>
            </React.Fragment>;
          })}
        </div>
      </nav>

      {/* Grille d'affiches */}
      <section aria-label={`Titres : ${listTitle}`} data-tv-col="grid" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 ${column === 'grid' ? 'is-active' : ''}`}>
        <header className="flex shrink-0 items-baseline justify-between gap-3 px-4 pb-1.5 pt-3">
          <h2 className="truncate text-[15px] font-semibold">{listTitle}</h2>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" role="status">{items.length ? `${Math.min(row + 1, items.length)} / ${items.length}` : '0'}</span>
        </header>
        <div ref={gridRef} className="tv-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {loading ? <p className="px-3 py-6 text-sm text-muted-foreground" role="status">Chargement du catalogue…</p>
            : error ? <div className="space-y-2 px-3 py-6 text-amber-300" role="alert"><p>{error}</p><button type="button" onClick={onRetry} className="tv-action flex min-h-10 items-center gap-2 rounded-xl px-3 text-[15px]">Réessayer</button></div>
            : cells.length === 0 ? <p className="px-3 py-6 text-sm text-muted-foreground">{showWatchlistOnly ? 'Ma Liste est vide ici : ajoute des titres depuis leur fiche.' : 'Aucun titre dans cette sélection.'}</p>
            : <div className="grid grid-cols-6 gap-3">
              {cells.map((cell, index) => cell.kind === 'more' ? (
                <button
                  key="more"
                  type="button"
                  data-tv-item
                  data-tv-row={index}
                  tabIndex={column === 'grid' && index === row ? 0 : -1}
                  onFocus={() => syncColumn('grid', index)}
                  onClick={onLoadMore}
                  className="tv-row flex aspect-[2/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-neutral-900 bg-card text-center text-[13px] text-muted-foreground"
                >
                  <ChevronDown className="h-6 w-6" aria-hidden="true" />
                  Afficher davantage
                </button>
              ) : (
                <button
                  key={cell.item.id}
                  type="button"
                  {...(index === 0 ? { 'data-remote-start': true } : {})}
                  data-tv-item
                  data-tv-row={index}
                  tabIndex={column === 'grid' && index === row ? 0 : -1}
                  onFocus={() => syncColumn('grid', index)}
                  onClick={() => onOpen(cell.item)}
                  className={`tv-row poster press text-left rounded-xl overflow-hidden bg-card border border-neutral-900 ${index === row ? 'is-selected' : ''}`}
                >
                  <div className="relative aspect-[2/3] overflow-hidden bg-neutral-900 flex items-center justify-center">
                    {cell.item.poster
                      ? <img src={cell.item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                      : <span className="text-3xl" aria-hidden="true">{kind === 'movie' ? '🎬' : '📺'}</span>}
                    {watchlistIds.has(cell.item.id) && <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-1 z-10" title="Dans ma liste"><Bookmark className="h-3 w-3 fill-current" /></div>}
                  </div>
                  <div className="p-2"><p className="text-xs line-clamp-2">{cell.item.name}</p>{cell.item.rating && <p className="text-xs text-neutral-400">★ {cell.item.rating}</p>}</div>
                </button>
              ))}
            </div>}
        </div>
      </section>

      {/* Fiche éclair + actions */}
      <aside aria-label="Titre sélectionné" data-tv-col="info" className={`tv-col flex min-h-0 flex-col rounded-2xl border border-neutral-900 bg-neutral-950 p-4 ${column === 'info' ? 'is-active' : ''}`}>
        {highlighted ? <>
          <div className="flex min-w-0 items-start gap-3">
            <div className="w-20 shrink-0 aspect-[2/3] overflow-hidden rounded-lg bg-neutral-900 flex items-center justify-center">
              {highlighted.poster
                ? <img src={highlighted.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                : <span className="text-2xl" aria-hidden="true">{kind === 'movie' ? '🎬' : '📺'}</span>}
            </div>
            <div className="min-w-0">
              <h3 className="line-clamp-3 text-lg font-semibold leading-6">{highlighted.name}</h3>
              {highlighted.rating && <p className="mt-1 font-mono text-xs text-muted-foreground">★ {highlighted.rating}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{progressLabel(highlighted.id)}</p>
            </div>
          </div>
          <div ref={infoRef} className="mt-4 space-y-1.5">
            {infoActions.map((action, index) => <button
              key={action.id}
              type="button"
              data-tv-item
              data-tv-info={index}
              tabIndex={column === 'info' && index === infoIndex ? 0 : -1}
              onFocus={() => syncColumn('info', index)}
              onClick={action.run}
              className={`tv-action flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] ${action.id === 'play' ? 'is-primary' : ''}`}
            >{action.icon}<span className="truncate">{action.label}</span></button>)}
          </div>
        </> : <p className="mt-2 text-sm text-muted-foreground">{cells.length ? 'Choisis un titre.' : 'Aucun titre à afficher.'}</p>}
        <p className="mt-auto border-t border-neutral-900 pt-2 text-[11px] text-muted-foreground">OK : fiche · ◀ ▶ : colonnes · Retour : catégories</p>
      </aside>
    </div>
  );
}
