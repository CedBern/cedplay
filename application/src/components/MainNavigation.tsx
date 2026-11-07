import { Clapperboard, House, LayoutGrid, Tv2 } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

export type NavSection = 'continue' | 'channels' | 'vod' | 'more';

const sections: { value: NavSection; label: string; Icon: typeof House }[] = [
  { value: 'continue', label: 'Accueil', Icon: House },
  { value: 'channels', label: 'Direct', Icon: Tv2 },
  { value: 'vod', label: 'Films & séries', Icon: Clapperboard },
  { value: 'more', label: 'Plus', Icon: LayoutGrid },
];

/** Onglet de navigation correspondant à un écran de l'application. */
export function navSectionFor(screen: string): NavSection | '' {
  if (screen === 'player' || screen === 'channels') return 'channels';
  if (screen === 'movies' || screen === 'series') return 'vod';
  if (screen === 'more' || screen === 'replay' || screen === 'streaming' || screen === 'loader') return 'more';
  if (screen === 'continue') return 'continue';
  return '';
}

/**
 * Navigation principale « Salle obscure » : quatre rubriques.
 * - Mobile : barre fixe en bas d'écran, onglet actif en ambre avec un trait en haut.
 * - À partir de sm : barre en pilule sous l'en-tête, onglet actif sur fond élevé.
 */
export function MainNavigation({ onNavigate }: { onNavigate: (section: NavSection) => void }) {
  return <TabsList
    aria-label="Rubriques"
    data-main-navigation
    className="glass fixed inset-x-0 bottom-0 z-40 !mt-0 grid h-auto grid-cols-4 gap-0 rounded-none border-t border-white/5 px-1.5 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+8px)] text-muted-foreground sm:static sm:!mt-0 sm:flex sm:w-max sm:max-w-full sm:justify-start sm:gap-1 sm:overflow-x-auto sm:rounded-full sm:border sm:border-white/5 sm:p-1"
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
