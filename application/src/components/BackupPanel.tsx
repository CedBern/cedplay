import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Backup, parseBackup } from '@/utils/backup';
import { exportBackupFromDB, restoreBackupToDB } from '@/utils/idb';
import { toast } from 'sonner';
import { Save } from 'lucide-react';

export function BackupPanel({ onRestored, className, showLabel = false }: { onRestored: () => Promise<void>; className?: string; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const download = async () => {
    setBusy(true);
    try {
      const backup = await exportBackupFromDB();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `cedplay-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Sauvegarde téléchargée');
    } catch { toast.error('Impossible de créer la sauvegarde.'); }
    finally { setBusy(false); }
  };
  const read = async (file?: File) => {
    setPending(null);
    if (!file) return;
    setBusy(true);
    try { setPending(parseBackup(await file.text())); }
    catch { toast.error('Sauvegarde invalide ou version non prise en charge. Aucune donnée modifiée.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await restoreBackupToDB(pending);
      setPending(null);
      await onRestored();
      toast.success(`${result.added} liste(s) ajoutée(s), ${result.skipped} déjà présente(s). Favoris réunis.`);
    } catch { toast.error('Restauration impossible. Réessaie avec ce fichier.'); }
    finally { setBusy(false); }
  };
  return <>
    <Button 
      variant="outline" 
      size="sm" 
      onClick={() => setOpen(true)}
      className={className || "border-neutral-800 text-white hover:bg-neutral-900"}
      title="Sauvegarder et restaurer"
      aria-label="Sauvegarder et restaurer"
    >
      <Save className="h-4 w-4 sm:mr-1.5" />
      <span className={showLabel ? 'ml-1.5' : 'hidden sm:inline'}>Sauvegarde</span>
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setPending(null); } }}>
      <DialogContent><DialogHeader><DialogTitle>Sauvegarder et restaurer</DialogTitle>
        <DialogDescription>Listes, favoris, réglages et historique dans un fichier sur ton appareil.</DialogDescription>
      </DialogHeader>
      <p className="text-sm">Ce fichier contient tes listes, tes favoris, tes réglages — et, si tu en as enregistré, tes identifiants Xtream et tes clés API en clair. Garde-le privé (disque chiffré, coffre-fort de mots de passe).</p>
      <Button disabled={busy} onClick={download}>Télécharger la sauvegarde</Button>
      <label className="text-sm space-y-2">Ouvrir une sauvegarde JSON
        <input ref={input} type="file" accept=".json,application/json" disabled={busy} className="block w-full" onChange={e => void read(e.target.files?.[0])} />
      </label>
      {pending && <div className="space-y-3" role="status">
        <p>{pending.playlists.length} liste(s), {pending.playlists.reduce((n, p) => n + p.channels.length, 0)} chaîne(s).
          Les listes et réglages actuels sont conservés. Les favoris sont réunis.</p>
        <Button disabled={busy} onClick={restore}>Ajouter les données sauvegardées</Button>
      </div>}
      {busy && <p role="status">Opération en cours…</p>}
      </DialogContent>
    </Dialog>
  </>;
}
