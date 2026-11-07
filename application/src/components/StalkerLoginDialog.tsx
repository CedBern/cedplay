import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectPortal, downloadStalkerPlaylist, normalizeMac, stalkerAvailable } from '@/utils/stalker';
import type { PlaylistInfo } from '@/types/channel';

/** Connexion à un portail Stalker / Ministra par adresse MAC (application Android). */
export function StalkerLoginDialog({ onPlaylistLoaded, open: controlledOpen, onOpenChange, hideTrigger = false }: {
  onPlaylistLoaded: (playlist: PlaylistInfo) => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (value: boolean) => { if (onOpenChange) onOpenChange(value); else setInnerOpen(value); };
  const [portal, setPortal] = useState('');
  const [mac, setMac] = useState('00:1A:79:');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const available = stalkerAvailable();
  const macInvalid = mac.replace(/[^0-9a-f]/gi, '').length >= 12 && !normalizeMac(mac);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(''); setStatus('Connexion au portail…');
    try {
      const { account } = await connectPortal(portal, mac);
      setStatus('Lecture des chaînes…');
      const playlist = await downloadStalkerPlaylist(account, name, count => setStatus(`Lecture des chaînes… ${count}`));
      await onPlaylistLoaded(playlist);
      toast.success(`Portail connecté : ${playlist.channels.length} chaînes.`);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion impossible.');
    } finally {
      setBusy(false); setStatus('');
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    {!hideTrigger && <DialogTrigger asChild>
      <Button variant="outline" size="sm" className="shrink-0 bg-neutral-900 text-neutral-100 hover:bg-neutral-800">Portail MAC</Button>
    </DialogTrigger>}
    <DialogContent className="max-w-md rounded-[20px]">
      <DialogHeader>
        <DialogTitle>Portail Stalker (adresse MAC)</DialogTitle>
        <DialogDescription>Pour les abonnements prévus pour les boîtiers MAG : l’adresse du portail et l’adresse MAC enregistrée chez le fournisseur.</DialogDescription>
      </DialogHeader>
      {!available
        ? <p className="text-sm text-muted-foreground">La connexion à un portail se fait depuis l’application Android (le navigateur ne peut pas envoyer l’adresse MAC au portail).</p>
        : <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-1.5 text-sm">
            <label htmlFor="stalker-portal" className="text-muted-foreground">Adresse du portail</label>
            <Input id="stalker-portal" value={portal} onChange={e => setPortal(e.target.value)} placeholder="http://exemple.com:8080/c/" inputMode="url" autoComplete="off" required />
          </div>
          <div className="grid gap-1.5 text-sm">
            <label htmlFor="stalker-mac" className="text-muted-foreground">Adresse MAC</label>
            <Input id="stalker-mac" value={mac} onChange={e => setMac(e.target.value)} placeholder="00:1A:79:12:34:56" autoComplete="off" aria-invalid={macInvalid} className="font-mono" required />
          </div>
          <div className="grid gap-1.5 text-sm">
            <label htmlFor="stalker-name" className="text-muted-foreground">Nom de la liste (facultatif)</label>
            <Input id="stalker-name" value={name} onChange={e => setName(e.target.value)} placeholder="Mon portail" maxLength={60} />
          </div>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {status && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{status}</p>}
          <p className="text-xs text-muted-foreground">Le lien de chaque chaîne est demandé au portail au moment de la lecture. Le guide peut venir d’une source XMLTV ajoutée dans les réglages du guide.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={busy || !portal.trim() || !normalizeMac(mac)}>{busy ? 'Connexion…' : 'Se connecter'}</Button>
          </div>
        </form>}
    </DialogContent>
  </Dialog>;
}
