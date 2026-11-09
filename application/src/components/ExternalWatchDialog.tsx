import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Clapperboard } from 'lucide-react';
import { clearExternalWatches, getExternalWatches, saveExternalWatches, type PlayHistoryEntry } from '@/utils/idb';
import {
  externalSummary, MAX_WATCH_IMPORT_BYTES, mergeExternalWatches, parseWatchImport,
  WATCH_PLATFORMS, type WatchPlatformId,
} from '@/utils/externalWatch';

const MAX_MEGABYTES = Math.round(MAX_WATCH_IMPORT_BYTES / (1024 * 1024));

/** `File.text()` manque aux WebView anciennes des box : repli FileReader. */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsText(file);
  });
}

/**
 * Import « Vu ailleurs » : l'historique exporté par Netflix, Prime Video ou YouTube.
 * Le fichier est lu sur l'appareil, jamais envoyé ; seuls les titres sont conservés
 * pour nourrir le rail « Pour toi ».
 */
export function ExternalWatchDialog({ watches, onChanged }: {
  watches: PlayHistoryEntry[];
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<WatchPlatformId>('netflix');
  const [confirmErase, setConfirmErase] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const total = watches.length;

  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_WATCH_IMPORT_BYTES) {
      toast.error(`Fichier trop volumineux (${Math.round(file.size / (1024 * 1024))} Mo) : maximum ${MAX_MEGABYTES} Mo.`);
      return;
    }
    setBusy(true);
    try {
      const result = parseWatchImport(await readFileText(file), { platform });
      const merged = mergeExternalWatches(await getExternalWatches(), result.entries);
      await saveExternalWatches(merged);
      await onChanged();
      const ignored = [
        result.undated ? `${result.undated} ligne(s) sans date` : '',
        result.truncated ? `${result.truncated} au-delà du plafond de 500` : '',
      ].filter(Boolean).join(' · ');
      toast.success(`${result.entries.length} visionnage(s) importé(s)${ignored ? ` — ${ignored}` : ''}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import impossible : fichier non reconnu.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const erase = async () => {
    setBusy(true);
    try {
      await clearExternalWatches();
      await onChanged();
      setConfirmErase(false);
      toast.success('Visionnages ailleurs effacés du profil.');
    } catch { toast.error('Effacement impossible.'); }
    finally { setBusy(false); }
  };

  return <>
    <Button
      variant="outline"
      size="sm"
      onClick={() => { setOpen(true); setConfirmErase(false); }}
      className="shrink-0 border-neutral-800 text-white hover:bg-neutral-900"
      title="Importer ce que tu regardes sur Netflix, Prime Video, YouTube…"
    >
      <Clapperboard className="h-4 w-4 sm:mr-1.5" />
      <span className="hidden sm:inline">Vu ailleurs{total > 0 ? ` (${total})` : ''}</span>
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setConfirmErase(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vu ailleurs</DialogTitle>
          <DialogDescription>Netflix, Prime Video, YouTube, Arte… : importe l'historique exporté par ces plateformes.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-neutral-300">
          Ces titres enrichissent « Pour toi » (genres, réalisateurs, casting, films proches TMDB) et rapprochent
          le catalogue de tes goûts. Rien n'est relancé depuis CedPlay et rien ne remplace tes visionnages ici.
        </p>
        <label className="text-sm space-y-2">Plateforme du fichier
          <select
            aria-label="Plateforme du fichier importé"
            className="bg-neutral-900 p-3 rounded-md w-full"
            value={platform}
            disabled={busy}
            onChange={event => setPlatform(event.target.value as WatchPlatformId)}
          >
            {WATCH_PLATFORMS.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <label className="text-sm space-y-2">Fichier d'historique
          <input
            ref={input}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            disabled={busy}
            className="block w-full"
            onChange={event => void importFile(event.target.files?.[0])}
          />
        </label>
        <p className="text-xs text-neutral-500">
          CSV Netflix / Prime Video (colonnes titre et date) ou JSON YouTube Takeout (watch-history.json),
          {` ${MAX_MEGABYTES} Mo maximum`}. Le fichier reste sur l'appareil : seuls les titres et ta clé TMDB
          servent à retrouver les fiches.
        </p>
        {total > 0 && <p className="text-sm text-neutral-300" role="status">{externalSummary(watches)}</p>}
        {total > 0 && (confirmErase
          ? <div className="flex flex-wrap gap-2">
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void erase()}>Confirmer l'effacement</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmErase(false)}>Annuler</Button>
          </div>
          : <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmErase(true)}>Effacer ces visionnages</Button>)}
        {busy && <p role="status">Opération en cours…</p>}
        <details className="text-xs text-neutral-500">
          <summary className="cursor-pointer">Format générique (CSV ou JSON)</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-neutral-900 p-2 text-[11px]">{`title,year,date,platform,tmdbId
Inception,2010,2023-04-12,netflix,27205`}</pre>
          <p className="mt-1">Le JSON accepte les mêmes champs (`watchedAt` pour la date). `tmdbId` est facultatif :
            sans lui, le titre et l'année suffisent.</p>
        </details>
      </DialogContent>
    </Dialog>
  </>;
}
