import { useRef, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { Clapperboard, Compass, Film, Headphones, House, Ellipsis, LayoutGrid, MonitorPlay, Search, Tv2 } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isDesktopRuntime } from '@/utils/desktopBridge';

export type NavSection = 'continue' | 'channels' | 'vod' | 'movies' | 'series' | 'podcasts' | 'more';

type Section = { value: NavSection; label: string; Icon: typeof House };

const sections: Section[] = [
  { value: 'continue', label: 'Découvrir', Icon: Compass },
  { value: 'channels', label: 'Direct', Icon: Tv2 },
  { value: 'vod', label: 'Films & séries', Icon: Clapperboard },
  { value: 'podcasts', label: 'Écouter', Icon: Headphones },
  { value: 'more', label: 'Plus', Icon: LayoutGrid },
];

/** TV : Films et Séries sont deux rubriques directes dans le rail, accompagnées de l'entrée Écouter. */
const tvSections: Section[] = [
  { value: 'continue', label: 'Découvrir', Icon: Compass },
  { value: 'channels', label: 'Direct', Icon: Tv2 },
  { value: 'movies', label: 'Films', Icon: Film },
  { value: 'series', label: 'Séries', Icon: MonitorPlay },
  { value: 'podcasts', label: 'Écouter', Icon: Headphones },
  // Points de suspension, pas une grille : sur TV, la grille se confondait avec la mosaïque.
  { value: 'more', label: 'Plus', Icon: Ellipsis },
];

/** Onglet de navigation correspondant à un écran de l'application. */
export function navSectionFor(screen: string, tv = false): NavSection | '' {
  if (screen === 'player' || screen === 'channels') return 'channels';
  if (screen === 'movies' || screen === 'series') return tv ? screen : 'vod';
  if (screen === 'podcasts') return 'podcasts';
  if (screen === 'more' || screen === 'replay' || screen === 'loader') return 'more';
  if (screen === 'continue') return 'continue';
  return '';
}

/**
 * Navigation principale « Salle obscure ».
 * - Mobile : barre fixe en bas d'écran, onglet actif en ambre avec un trait en haut.
 * - À partir de sm : barre en pilule sous l'en-tête, onglet actif sur fond élevé.
 * - TV : rail translucide à gauche, déployé au focus sans déplacer le contenu.
 */
export function MainNavigation({ onNavigate, tv = false, onSearch }: { onNavigate: (section: NavSection) => void; tv?: boolean; onSearch?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const pointerInteracting = useRef(false);
  const pointerHovered = useRef(false);
  const desktop = isDesktopRuntime();
  if (tv) return <nav
    aria-label="Navigation principale"
    data-main-navigation
    data-tv-navigation
    data-expanded={expanded}
    className="tv-sidebar"
    onMouseEnter={() => { pointerHovered.current = true; setExpanded(true); }}
    onMouseLeave={() => { pointerHovered.current = false; setExpanded(false); }}
    onPointerDownCapture={() => {
      pointerInteracting.current = true;
      window.setTimeout(() => { pointerInteracting.current = false; }, 0);
    }}
    onFocusCapture={event => {
      if (desktop && pointerInteracting.current) return;
      if (desktop) {
        try { if (!(event.target as HTMLElement).matches(':focus-visible')) return; } catch { /* ignore */ }
      }
      setExpanded(true);
    }}
    onBlurCapture={event => { if (!(desktop && pointerHovered.current) && !event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false); }}
  >
    <div className="tv-sidebar-brand" aria-label="CedPlay"><BrandMark className="h-8 w-8 shrink-0" /><span className="tv-nav-label">Ced<span className="text-[#FF5A36]">Play</span></span></div>
    {onSearch && <button type="button" onClick={event => { onSearch(); if (desktop) { setExpanded(false); event.currentTarget.blur(); } }} className="tv-nav-tab tv-sidebar-search" aria-label="Recherche unifiée">
      <Search aria-hidden="true" /><span className="tv-nav-label">Rechercher</span>
    </button>}
    <TabsList aria-label="Rubriques" className="tv-nav !mt-0 h-auto bg-transparent p-0">
      {tvSections.map(({ value, label, Icon }) => <TabsTrigger
        key={value}
        value={value}
        aria-label={label}
        onClick={event => { onNavigate(value); if (desktop) { setExpanded(false); event.currentTarget.blur(); } }}
        className="tv-nav-tab relative bg-transparent shadow-none ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
      >
        <Icon aria-hidden="true" /><span className="tv-nav-label">{label}</span>
      </TabsTrigger>)}
    </TabsList>
  </nav>;
  return <TabsList
    aria-label="Rubriques"
    data-main-navigation
    className="glass fixed inset-x-0 bottom-0 z-40 !mt-0 grid h-auto grid-cols-5 gap-0 rounded-none border-t border-white/5 px-1.5 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+8px)] text-muted-foreground sm:static sm:!mt-0 sm:flex sm:w-max sm:max-w-full sm:justify-start sm:gap-1 sm:overflow-x-auto sm:rounded-full sm:border sm:border-white/5 sm:p-1"
  >
    {sections.map(({ value, label, Icon }) => <TabsTrigger
      key={value}
      value={value}
      // Un nouvel appui sur l'onglet actif ramène à son écran principal (ex. Plus › Replay → Plus).
      onClick={() => onNavigate(value)}
      className="press relative min-h-14 min-w-0 flex-col gap-1 rounded-none bg-transparent px-0 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors duration-300 before:absolute before:top-[-6px] before:h-0.5 before:w-6 before:origin-center before:scale-x-0 before:rounded-full before:bg-primary before:transition-transform before:duration-300 data-[state=active]:before:scale-x-100 hover:text-foreground focus-visible:ring-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none sm:min-h-10 sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:py-2 sm:text-sm sm:before:hidden sm:data-[state=active]:bg-secondary sm:data-[state=active]:text-foreground sm:[&[data-state=active]>svg]:text-primary"
    >
      <Icon aria-hidden="true" className="h-[22px] w-[22px] shrink-0 stroke-[1.8] sm:h-[18px] sm:w-[18px]" />
      <span className="truncate">{label}</span>
    </TabsTrigger>)}
  </TabsList>;
}
