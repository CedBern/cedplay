import { useState } from 'react';
import { Film, HardDrive } from 'lucide-react';
import { VodLibrary, type VodResumeRequest } from '@/components/VodLibrary';
import { LocalLibrary } from '@/components/LocalLibrary';
import type { PlaylistInfo } from '@/types/channel';

interface MoviesPanelProps {
  playlist: PlaylistInfo;
  tmdbApiKey?: string | null;
  resumeRequest?: VodResumeRequest | undefined;
  onResumeHandled?: (() => void) | undefined;
  /** Rendu télécommande pour le catalogue VOD (l'écran Direct a le sien). */
  tvMode?: boolean | undefined;
  onSearch?: (() => void) | undefined;
}

/**
 * Rubrique « Films » : catalogue VOD de la liste + bibliothèque locale (USB/SD).
 * Le choix de source est une sous-catégorie, pas un onglet dédié.
 */
export function MoviesPanel({ playlist, tmdbApiKey, resumeRequest, onResumeHandled, tvMode, onSearch }: MoviesPanelProps) {
  const [source, setSource] = useState<'catalog' | 'local'>('catalog');
  const pill = (active: boolean) =>
    `inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${active ? 'border-foreground bg-foreground text-background' : 'border-neutral-800 text-muted-foreground hover:text-foreground'}`;
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Source des films" className="flex items-center gap-2">
        <button type="button" aria-pressed={source === 'catalog'} className={pill(source === 'catalog')} onClick={() => setSource('catalog')}>
          <Film className="h-4 w-4" aria-hidden="true" /> Catalogue
        </button>
        <button type="button" aria-pressed={source === 'local'} className={pill(source === 'local')} onClick={() => setSource('local')}>
          <HardDrive className="h-4 w-4" aria-hidden="true" /> USB/SD
        </button>
      </div>
      {source === 'catalog'
        ? <VodLibrary key={`${playlist.id}:movie`} playlist={playlist} kind="movie" tmdbApiKey={tmdbApiKey ?? undefined} resumeRequest={resumeRequest} onResumeHandled={onResumeHandled} tvMode={tvMode} onSearch={onSearch} />
        : <LocalLibrary tmdbApiKey={tmdbApiKey ?? null} />}
    </div>
  );
}
