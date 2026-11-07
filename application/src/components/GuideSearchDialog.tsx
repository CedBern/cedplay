import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Channel } from '@/types/channel';
import type { EPGData, EPGProgram } from '@/types/epg';
import { formatTime } from '@/utils/epgXmltv';
import { searchPrograms } from '@/utils/epgSearch';

interface GuideSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: Channel[];
  epgData: EPGData | undefined;
  catchupDays?: ((channel: Channel) => number) | undefined;
  onPick: (channel: Channel, program: EPGProgram) => void;
}

const dayOf = (date: Date) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
};

/** Recherche d'une émission dans tout le guide (en cours, à venir, passées rejouables). */
export function GuideSearchDialog({ open, onOpenChange, channels, epgData, catchupDays, onPick }: GuideSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);
  useEffect(() => { if (!open) { setQuery(''); setDebounced(''); } }, [open]);
  const results = useMemo(
    () => (debounced.trim().length >= 2 ? searchPrograms(epgData, channels, debounced, { catchupDays }) : []),
    [debounced, epgData, channels, catchupDays],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col border-neutral-800 bg-neutral-950 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Search className="h-5 w-5" aria-hidden="true" />Rechercher une émission</DialogTitle>
          <DialogDescription className="text-neutral-400">Titre, résumé ou genre, dans tout le guide chargé.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ex. : journal, Koh-Lanta, football…"
          aria-label="Émission à rechercher"
          className="bg-neutral-900/60 border-neutral-800 text-white placeholder:text-neutral-500"
        />
        {debounced.trim().length >= 2 && results.length === 0 && <p role="status" className="py-8 text-center text-sm text-neutral-400">Aucune émission trouvée.</p>}
        <ul className="max-h-[55vh] overflow-y-auto" aria-label="Résultats">
          {results.map(({ channel, program, when }) => (
            <li key={`${channel.id}:${program.startTime.getTime()}`}><button
              type="button"
              onClick={() => onPick(channel, program)}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${when === 'now' ? 'bg-live text-white' : when === 'past' ? 'bg-primary/20 text-primary' : 'bg-neutral-800 text-neutral-300'}`}>
                {when === 'now' ? 'En direct' : when === 'past' ? 'Replay' : 'À venir'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{program.title}</span>
                <span className="block truncate text-xs text-neutral-400">{channel.name} · {dayOf(program.startTime)} {formatTime(program.startTime)} – {formatTime(program.endTime)}</span>
              </span>
            </button></li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
