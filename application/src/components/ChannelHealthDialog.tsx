import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleX, EyeOff } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { describeFailure, probeStreams, type ProbeResult } from '@/utils/streamCheck';
import type { Channel } from '@/types/channel';

type Scope = 'favorites' | 'visible';

/**
 * Vérification des liens : repère les chaînes qui ne répondent pas et propose
 * de les masquer. Une chaîne masquée se réaffiche à tout moment.
 */
export function ChannelHealthDialog({ open, onOpenChange, visibleChannels, favoriteIds, hiddenChannelIds, onHide, onShowAll }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chaînes des groupes affichés (hors chaînes déjà masquées). */
  visibleChannels: Channel[];
  favoriteIds: string[];
  hiddenChannelIds: string[];
  onHide: (ids: string[]) => void;
  onShowAll: () => void;
}) {
  const favorites = useMemo(() => {
    const set = new Set(favoriteIds);
    return visibleChannels.filter(c => set.has(c.id));
  }, [visibleChannels, favoriteIds]);
  const [scope, setScope] = useState<Scope>('visible');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [tested, setTested] = useState<Channel[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setResults(null);
    setTested([]);
    setDone(0);
  }, [open]);
  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null; }, []);

  const targets = scope === 'favorites' ? favorites : visibleChannels;
  const failures = useMemo(
    () => (results ? tested.map((c, i) => ({ channel: c, result: results[i] })).filter(r => r.result && !r.result.ok) : []),
    [results, tested],
  );

  const start = async () => {
    // Le lot natif peut finir après la fermeture : seule la session courante
    // a le droit de publier ses résultats et de terminer l'indicateur d'attente.
    if (abortRef.current && !abortRef.current.signal.aborted) return;
    const list = targets;
    if (!list.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setTested(list);
    setResults([]);
    setDone(0);
    setRunning(true);
    try {
      await probeStreams(list.map(c => c.url), (count, partial) => {
        if (abortRef.current !== controller) return;
        setDone(count); setResults([...partial]);
      }, controller.signal);
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setRunning(false); }
    }
  };

  const minutes = Math.max(1, Math.round(targets.length / 6 * 2 / 60));
  const percent = tested.length ? Math.round(done / tested.length * 100) : 0;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85dvh] max-w-lg flex-col gap-4 rounded-[20px]">
      <DialogHeader>
        <DialogTitle>Vérifier les chaînes</DialogTitle>
        <DialogDescription>Repère les liens qui ne répondent plus. Une chaîne peut être coupée seulement pour un moment : une chaîne masquée se réaffiche à tout moment.</DialogDescription>
      </DialogHeader>

      {!running && <div role="radiogroup" aria-label="Chaînes à vérifier" className="grid grid-cols-2 gap-2">
        {([['favorites', 'Mes favoris', favorites.length], ['visible', 'Groupes affichés', visibleChannels.length]] as const).map(([value, label, count]) => <button
          key={value}
          type="button"
          role="radio"
          aria-checked={scope === value}
          onClick={() => setScope(value)}
          className={`rounded-2xl border px-3 py-3 text-left transition-colors ${scope === value ? 'border-primary bg-primary/10' : 'border-neutral-800 hover:bg-accent/60'}`}
        >
          <span className="block text-sm font-medium text-foreground">{label}</span>
          <span className="block font-mono text-xs text-muted-foreground">{count} chaînes</span>
        </button>)}
      </div>}

      {running || results ? <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground">{running ? 'Vérification en cours…' : `${done - failures.length} sur ${done} répondent`}</span>
          <span className="font-mono text-xs text-muted-foreground">{done} / {tested.length}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progression de la vérification">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div> : <p className="text-xs text-muted-foreground">Environ {minutes} min pour {targets.length} chaînes. Les flux ne sont pas lus : seuls quelques octets sont demandés.</p>}

      {failures.length > 0 && <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {failures.map(({ channel, result }) => <li key={channel.id} className="flex min-h-11 items-center gap-3 rounded-xl px-2">
          <CircleX aria-hidden="true" className="h-4 w-4 shrink-0 text-live" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{channel.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{describeFailure(result!)}</span>
        </li>)}
      </ul>}
      {results && !running && failures.length === 0 && done > 0 && <p className="flex items-center gap-2 text-sm text-foreground"><CircleCheck aria-hidden="true" className="h-4 w-4 text-primary" />Toutes les chaînes vérifiées répondent.</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-900 pt-3">
        {hiddenChannelIds.length > 0
          ? <Button type="button" variant="ghost" size="sm" onClick={onShowAll}>Réafficher {hiddenChannelIds.length} masquée{hiddenChannelIds.length > 1 ? 's' : ''}</Button>
          : <span />}
        <div className="flex gap-2">
          {running
            ? <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>Arrêter</Button>
            : <Button type="button" variant={failures.length ? 'outline' : 'default'} disabled={!targets.length} onClick={() => { void start(); }}>{results ? 'Relancer' : 'Lancer la vérification'}</Button>}
          {!running && failures.length > 0 && <Button type="button" onClick={() => { onHide(failures.map(f => f.channel.id)); setResults(null); setTested([]); setDone(0); }}>
            <EyeOff aria-hidden="true" className="mr-1.5 h-4 w-4" />Masquer {failures.length}
          </Button>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
