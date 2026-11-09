import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Play, RotateCcw, Subtitles } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import type { Episode } from '@/utils/xtreamCatalog';

type Zone = 'season' | 'list' | 'actions';

interface FicheAction {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface TvSeriesFicheProps {
  episodes: Episode[];
  /** Saison affichée (valeur du fournisseur, '' tant que la fiche charge). */
  season: string;
  onSeasonChange: (season: string) => void;
  watchlisted: boolean;
  onToggleWatchlist: () => void;
  subtitlesEnabled: boolean;
  subtitleEpisodeId?: string | null | undefined;
  onSubtitles: (episode: Episode) => void;
  onPlay: (episode: Episode, restart: boolean) => void;
  progress: (id: string) => { label: string; saved: boolean };
  busy: boolean;
}

/**
 * Fiche série pour la télécommande. Une seule règle de déplacement :
 * Haut/Bas change de ligne dans la colonne active, Droite entre dans les options de
 * l'épisode, Gauche revient à la liste ; sur la ligne « Saison », Gauche/Droite
 * change de saison. Aucun saut géométrique entre les boutons d'un même épisode.
 */
export function TvSeriesFiche({
  episodes, season, onSeasonChange, watchlisted, onToggleWatchlist,
  subtitlesEnabled, subtitleEpisodeId, onSubtitles, onPlay, progress, busy,
}: TvSeriesFicheProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const seasons = useMemo(() => [...new Set(episodes.map(e => e.season))], [episodes]);
  const activeSeason = seasons.includes(season) ? season : seasons[0] ?? '';
  const seasonEpisodes = useMemo(() => episodes.filter(e => e.season === activeSeason), [episodes, activeSeason]);
  const seasonIndex = Math.max(0, seasons.indexOf(activeSeason));
  const [zone, setZone] = useState<Zone>('list');
  const [listIndex, setListIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);

  useEffect(() => { setListIndex(0); setActionIndex(0); }, [activeSeason]);
  useEffect(() => { setListIndex(i => Math.min(i, Math.max(0, seasonEpisodes.length - 1))); }, [seasonEpisodes.length]);

  const episode = seasonEpisodes[Math.min(listIndex, Math.max(0, seasonEpisodes.length - 1))] ?? null;
  const progressLabel = episode ? progress(episode.id).label : 'Regarder';
  const progressSaved = episode ? progress(episode.id).saved : false;

  const actions = useMemo<FicheAction[]>(() => {
    if (!episode) return [];
    const list: FicheAction[] = [];
    if (episode.extension) {
      list.push({ id: 'play', label: progressLabel, icon: <Play className="h-4 w-4" aria-hidden="true" />, primary: true, disabled: busy, run: () => onPlay(episode, false) });
    }
    if (progressSaved) {
      list.push({ id: 'restart', label: 'Depuis le début', icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />, disabled: busy, run: () => onPlay(episode, true) });
    }
    if (subtitlesEnabled) {
      list.push({
        id: 'subtitles',
        label: subtitleEpisodeId === episode.id ? 'Sous-titres choisis' : 'Sous-titres',
        icon: <Subtitles className="h-4 w-4" aria-hidden="true" />,
        run: () => onSubtitles(episode),
      });
    }
    list.push({
      id: 'watchlist',
      label: watchlisted ? 'Retirer de Ma Liste' : 'Ajouter à Ma Liste',
      icon: watchlisted ? <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />,
      run: onToggleWatchlist,
    });
    return list;
  }, [episode, progressLabel, progressSaved, busy, subtitlesEnabled, subtitleEpisodeId, watchlisted, onPlay, onSubtitles, onToggleWatchlist]);
  useEffect(() => { setActionIndex(i => Math.min(i, Math.max(0, actions.length - 1))); }, [actions.length]);

  // Le vrai focus suit l'état : un déplacement ne dépend jamais de la géométrie.
  // Ne dépendre que des index évite qu'un simple rendu du parent (toast, historique)
  // ne reprenne le focus alors qu'il est parti dans le panneau de sous-titres.
  const focusStop = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const selector = zone === 'season'
      ? '[data-tv-fiche-season]'
      : zone === 'list'
        ? `[data-tv-fiche-ep="${listIndex}"]`
        : `[data-tv-fiche-action="${actionIndex}"]`;
    const target = root.querySelector<HTMLButtonElement>(selector);
    const el = target?.disabled
      ? Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tv-fiche-action]')).find(button => !button.disabled)
      : target;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  }, [zone, listIndex, actionIndex]);
  // Au premier rendu, le dialogue n'a pas encore de cible (ou seulement son
  // conteneur) : le premier épisode prend le focus. Si l'utilisateur a déjà visé un
  // contrôle (croix de fermeture), l'arrivée des épisodes ne le lui retire pas.
  // Ensuite, chaque déplacement d'état replace le focus sur la cible calculée.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      const active = document.activeElement;
      const dialog = rootRef.current?.closest('[role="dialog"]');
      if (!active || active === document.body || active === dialog) focusStop();
      return;
    }
    focusStop();
  }, [focusStop]);

  const moveSeason = (delta: number) => {
    const next = seasons[seasonIndex + delta];
    if (!next) return false;
    onSeasonChange(next);
    setListIndex(0);
    setActionIndex(0);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    let handled = false;
    if (e.key === 'ArrowLeft') {
      if (zone === 'season') handled = moveSeason(-1) || true;
      else if (zone === 'actions') { setZone('list'); handled = true; }
      else handled = true;
    } else if (e.key === 'ArrowRight') {
      if (zone === 'season') handled = moveSeason(1) || true;
      else if (zone === 'list') { setActionIndex(Math.max(0, actions.findIndex(action => !action.disabled))); setZone('actions'); handled = true; }
      else handled = true;
    } else if (e.key === 'ArrowUp') {
      if (zone === 'list') { if (listIndex > 0) setListIndex(listIndex - 1); else setZone('season'); handled = true; }
      else if (zone === 'actions') { if (actionIndex > 0) setActionIndex(actionIndex - 1); handled = true; }
      else handled = true;
    } else if (e.key === 'ArrowDown') {
      if (zone === 'list') { if (listIndex < seasonEpisodes.length - 1) setListIndex(listIndex + 1); handled = true; }
      else if (zone === 'actions') { if (actionIndex < actions.length - 1) setActionIndex(actionIndex + 1); handled = true; }
      else { setZone('list'); handled = true; }
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  // Le focus peut venir d'ailleurs (reprise, pointeur) : recaler la colonne active.
  const onFocus = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>('[data-tv-fiche-ep]');
    if (item) { setZone('list'); setListIndex(Number(item.dataset.tvFicheEp)); return; }
    const action = target.closest<HTMLElement>('[data-tv-fiche-action]');
    if (action) { setZone('actions'); setActionIndex(Number(action.dataset.tvFicheAction)); return; }
    if (target.hasAttribute('data-tv-fiche-season')) setZone('season');
  };

  if (!episodes.length) return <p className="text-sm text-muted-foreground">Aucun épisode fourni pour cette série.</p>;

  return (
    <div
      ref={rootRef}
      data-remote-self
      data-tv-fiche
      className="tv-fiche flex h-full min-h-0 flex-col gap-2 rounded-2xl border border-neutral-900 bg-neutral-950 p-3 text-foreground"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <button
          type="button"
          data-tv-item
          data-tv-fiche-season
          tabIndex={zone === 'season' ? 0 : -1}
          aria-label={`Saison ${activeSeason} sur ${seasons.length}`}
          className="tv-fiche-step flex min-h-10 items-center gap-2 rounded-xl px-4 text-[15px] font-medium"
          onClick={() => moveSeason(1)}
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span>Saison {activeSeason}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
        <p className="text-right text-[11px] leading-tight text-muted-foreground">▲▼ épisodes · ▶ options<br />◀ ▶ saison · Retour fermer</p>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="tv-fiche-scroll w-[46%] min-h-0 overflow-y-auto rounded-xl border border-neutral-900 p-1.5" role="group" aria-label={`Épisodes de la saison ${activeSeason}`}>
          {seasonEpisodes.map((item, index) => {
            const saved = progress(item.id).saved;
            return (
              <button
                key={item.id}
                type="button"
                data-tv-item
                data-tv-fiche-ep={index}
                {...(index === 0 ? { 'data-remote-start': true } : {})}
                tabIndex={zone === 'list' && index === listIndex ? 0 : -1}
                aria-current={index === listIndex ? 'true' : undefined}
                className={`tv-fiche-ep flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-[15px] ${index === listIndex ? 'is-selected' : ''}`}
                onClick={() => { setListIndex(index); setActionIndex(0); setZone('actions'); }}
              >
                <span className="min-w-0 flex-1 truncate">{item.number}. {item.name}</span>
                {subtitleEpisodeId === item.id && <Subtitles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                {saved && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">reprise</span>}
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {episode ? <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="text-sm font-semibold">Épisode {episode.number} · {episode.name}</p>
              {episode.plot && <p className="mt-1 line-clamp-4 text-xs text-muted-foreground">{episode.plot}</p>}
              {!episode.extension && <p className="mt-1 text-xs text-amber-300">Format non fourni.</p>}
            </div>
            <div className="space-y-1.5">
              {actions.map((action, index) => (
                <button
                  key={action.id}
                  type="button"
                  data-tv-item
                  data-tv-fiche-action={index}
                  tabIndex={zone === 'actions' && index === actionIndex ? 0 : -1}
                  disabled={action.disabled}
                  className={`tv-fiche-action flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[15px] ${action.primary ? 'is-primary' : ''}`}
                  onClick={action.run}
                >
                  {action.icon}
                  <span className="truncate">{action.label}</span>
                </button>
              ))}
            </div>
          </> : <p className="text-sm text-muted-foreground">Aucun épisode dans cette saison.</p>}
        </div>
      </div>
    </div>
  );
}
