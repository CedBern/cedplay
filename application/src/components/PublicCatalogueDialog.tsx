import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { loadPublicCatalogue, catalogueCheckLabel, type PublicChannelSource } from '@/utils/publicCatalogue';
import { focusRemote } from '@/utils/remoteNavigation';

export function PublicCatalogueDialog({ onOpenChange, onOpen, tvMode }: {
  onOpenChange: (open: boolean) => void;
  onOpen: () => Promise<boolean>;
  tvMode: boolean;
}) {
  const [entries, setEntries] = useState<PublicChannelSource[]>([]);
  const [error, setError] = useState('');
  const [country, setCountry] = useState('Tous');
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const lastEntry = useRef<HTMLElement | null>(null);
  const opening = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadPublicCatalogue(controller.signal).then(data => {
      if (!controller.signal.aborted) setEntries(data);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Catalogue indisponible.');
    });
    return () => controller.abort();
  }, []);
  const countries = useMemo(() => ['Tous', ...new Set(entries.map(c => c.group))], [entries]);
  const visible = useMemo(() => entries.filter(c => country === 'Tous' || c.group === country)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' })), [entries, country]);

  const open = async () => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    try {
      if (await onOpen()) onOpenChange(false);
    } catch {
      setError('Impossible d’ouvrir la sélection. Réessaie dans un instant.');
    } finally { opening.current = false; setBusy(false); }
  };

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!tvMode || !event.key.startsWith('Arrow')) return;
    const root = content.current;
    if (!root) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-catalogue-zone]');
    const zone = target?.dataset.catalogueZone;
    const filters = Array.from(root.querySelectorAll<HTMLElement>('[data-catalogue-zone="filter"]'));
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-catalogue-zone="entry"]'));
    const actions = Array.from(root.querySelectorAll<HTMLElement>('[data-catalogue-zone="action"]'));
    let next: HTMLElement | undefined;
    const remembered = lastEntry.current && rows.includes(lastEntry.current) ? lastEntry.current : rows[0];
    const currentFilter = filters.find(el => el.getAttribute('aria-pressed') === 'true') ?? filters[0];
    if (zone === 'entry' && target) {
      lastEntry.current = target;
      const index = rows.indexOf(target);
      if (event.key === 'ArrowRight') next = actions[0];
      if (event.key === 'ArrowLeft') next = currentFilter;
      if (event.key === 'ArrowUp') next = rows[index - 1] ?? currentFilter;
      if (event.key === 'ArrowDown') next = rows[index + 1] ?? actions[0];
    } else if (zone === 'filter' && target) {
      const index = filters.indexOf(target);
      if (event.key === 'ArrowDown') next = remembered ?? actions[0];
      if (event.key === 'ArrowLeft') next = filters[index - 1];
      if (event.key === 'ArrowRight') next = filters[index + 1] ?? actions[0];
    } else if (zone === 'action' && target) {
      const index = actions.indexOf(target);
      if (event.key === 'ArrowUp') next = remembered ?? currentFilter;
      if (event.key === 'ArrowLeft') next = actions[index - 1] ?? remembered ?? currentFilter;
      if (event.key === 'ArrowRight') next = actions[index + 1];
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = actions[0];
    event.preventDefault(); event.stopPropagation();
    if (next) focusRemote(next);
  };

  return <Dialog open onOpenChange={onOpenChange}>
    <DialogContent ref={content} onKeyDown={navigate} data-remote-self={tvMode ? '' : undefined}
      className="flex h-[88dvh] max-h-[700px] max-w-3xl flex-col gap-3"
      onOpenAutoFocus={event => {
        event.preventDefault();
        content.current?.querySelector<HTMLElement>('[data-catalogue-zone="filter"]')?.focus();
      }}>
      <DialogHeader className="shrink-0 pr-7">
        <DialogTitle>Chaînes gratuites officielles</DialogTitle>
        <DialogDescription>Une seule sélection, issue des diffuseurs et de SPR/MXPlus. Ouvrir ou actualiser cette sélection conserve tes autres listes et les favoris des chaînes retrouvées.</DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 gap-2 overflow-x-auto" aria-label="Pays du catalogue">
        {countries.map(name => <Button key={name} variant="outline" className="shrink-0" data-catalogue-zone="filter"
          aria-pressed={country === name} onClick={() => setCountry(name)}>{name}</Button>)}
      </div>
      <p className="shrink-0 text-xs text-muted-foreground">{entries.length ? `${visible.length} / ${entries.length} chaînes · sources classées A–Z` : error ? 'Sources indisponibles' : 'Chargement du catalogue…'}
        {tvMode && ' · ↑↓ parcourir · → ouvrir la sélection'}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto" aria-label="Sources des chaînes gratuites">
        {visible.map(entry => <li key={entry.id}>
          <a href={entry.source} target="_blank" rel="noopener noreferrer" data-catalogue-zone="entry"
            onFocus={event => { lastEntry.current = event.currentTarget; }}
            className="block rounded-xl border border-border px-4 py-3 text-left"
            aria-label={`Source de ${entry.name}`}>
            <span className="block font-medium">{entry.name} <span className="text-sm text-muted-foreground">· {entry.group}</span></span>
            <span className="block text-xs">{catalogueCheckLabel(entry)}</span>
            <span className="block break-all text-xs text-muted-foreground">Source : {new URL(entry.source).hostname} ↗</span>
          </a>
        </li>)}
      </ul>
      <p className="shrink-0 text-xs text-muted-foreground">Contrôle ponctuel depuis notre poste, sans essai sur ta TV. La disponibilité peut changer selon le programme, le pays ou le réseau. Le filtre pays sert à consulter les sources ; toute la sélection sera ouverte.</p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button data-catalogue-zone="action" aria-busy={busy} onClick={() => void open()}>{busy ? 'Ouverture…' : 'Ouvrir / actualiser la sélection'}</Button>
        <Button data-catalogue-zone="action" variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
