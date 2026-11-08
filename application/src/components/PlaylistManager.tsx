import React, { useState } from 'react';
import { PlaylistInfo } from '@/types/channel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash2, PlayCircle, Pencil, RefreshCw } from 'lucide-react';
import { deletePlaylistFromDB, savePlaylistToDB } from '@/utils/idb';
import { StorageManager } from '@/utils/storage';
import { toast } from 'sonner';
import { canRefreshPlaylist } from '@/utils/xtreamLive';
import { isLegacyPublicPlaylist, playlistDisplayName } from '@/utils/publicPlaylist';
import { cleanUserAgent, DEFAULT_USER_AGENT } from '@/utils/userAgent';

interface PlaylistManagerProps {
  playlists: PlaylistInfo[];
  onSelect: (playlist: PlaylistInfo) => void;
  onDeleted?: (id: string) => void;
  onMutate?: (playlist: PlaylistInfo, oldName?: string) => void; // rename or other mutation
  onRefresh?: (playlist: PlaylistInfo) => void; // re-download a URL playlist, keeping its identity
  currentId?: string;
}

export const PlaylistManager: React.FC<PlaylistManagerProps> = ({ playlists, onSelect, onDeleted, onMutate, onRefresh, currentId }) => {
  const [renameTarget, setRenameTarget] = useState<PlaylistInfo | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [userAgentValue, setUserAgentValue] = useState('');
  const userAgentInvalid = userAgentValue.trim() !== '' && !cleanUserAgent(userAgentValue);

  const submitRename = async () => {
    const pl = renameTarget;
    const newName = renameValue.trim();
    const userAgent = cleanUserAgent(userAgentValue);
    if (userAgentInvalid) return;
    if (!pl || !newName || (newName === pl.name && userAgent === (pl.userAgent ?? ''))) { setRenameTarget(null); return; }
    if (playlists.some(p => p.name.toLowerCase() === newName.toLowerCase() && p.id !== pl.id)) {
      toast.error('Une liste porte déjà ce nom');
      return;
    }
    setRenameBusy(true);
    try {
      const { userAgent: _previous, ...rest } = pl;
      const updated: PlaylistInfo = { ...rest, name: newName, ...(userAgent ? { userAgent } : {}) };
      await savePlaylistToDB(updated);
      if (StorageManager.getLastPlaylist() === pl.name) {
        StorageManager.setLastPlaylist(newName);
      }
      toast.success(newName !== pl.name ? 'Liste renommée' : 'Liste modifiée');
      onMutate?.(updated, pl.name);
      setRenameTarget(null);
    } catch (e) {
      console.error(e);
      toast.error('Impossible de modifier la liste');
    } finally {
      setRenameBusy(false);
    }
  };

  if (playlists.length === 0) {
    return (
      <Card className="bg-neutral-950 border-neutral-900">
        <CardHeader>
          <CardTitle className="text-white text-sm">Listes enregistrées</CardTitle>
        </CardHeader>
        <CardContent className="text-neutral-400 text-sm">Aucune liste enregistrée.</CardContent>
      </Card>
    );
  }

  const handleDelete = async (pl: PlaylistInfo) => {
    try {
      await deletePlaylistFromDB(pl.id);
      toast.success(`Liste supprimée : ${pl.name}`);
      onDeleted?.(pl.id);
    } catch (e) {
      console.error(e);
      toast.error('Impossible de supprimer la liste');
    }
  };

  return (
    <Card className="bg-neutral-950 border-neutral-900">
      <CardHeader>
        <CardTitle className="text-white text-sm">Listes enregistrées</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {playlists.map(pl => (
          <div key={pl.id} className="flex items-center justify-between gap-2 p-2 rounded bg-white/5 hover:bg-neutral-900 transition">
            <div className="flex flex-col min-w-0">
              <span className={`text-sm truncate ${pl.id === currentId ? 'text-primary font-semibold' : 'text-white'}`}>{playlistDisplayName(pl)}</span>
              <span className="text-xs text-neutral-400">{pl.channels.length} chaînes / {pl.groups.length} groupes</span>
              {isLegacyPublicPlaylist(pl) && <span className="text-xs text-muted-foreground">Ancienne sélection : relais non vérifiés. La sélection officielle est accessible depuis Plus → Chaînes gratuites.</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="icon" variant="ghost" className="h-9 w-9 text-primary" onClick={() => onSelect(pl)} title="Ouvrir la liste" aria-label={`Ouvrir ${pl.name}`}>
                <PlayCircle className="h-4 w-4" />
              </Button>
              {canRefreshPlaylist(pl) && onRefresh && (
                <Button size="icon" variant="ghost" className="h-9 w-9 text-emerald-400 hover:text-emerald-300" onClick={() => onRefresh(pl)} title={pl.url ? 'Mettre à jour la liste depuis son adresse' : 'Mettre à jour la liste depuis le compte Xtream'} aria-label={`Mettre à jour ${pl.name}`}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
              <Button size="icon" variant="ghost" className="h-9 w-9 text-blue-400 hover:text-blue-300" onClick={() => { setRenameTarget(pl); setRenameValue(pl.name); setUserAgentValue(pl.userAgent ?? ''); }} title="Modifier la liste (nom, User-Agent)" aria-label={`Modifier ${pl.name}`}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-red-400 hover:text-red-300" onClick={() => handleDelete(pl)} title="Supprimer la liste" aria-label={`Supprimer ${pl.name}`} disabled={pl.id === currentId}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      <Dialog open={renameTarget !== null} onOpenChange={open => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="max-w-sm bg-neutral-950 text-white border-neutral-800">
          <DialogHeader>
            <DialogTitle>Modifier la liste</DialogTitle>
            <DialogDescription className="text-neutral-400">Nom et identification auprès du fournisseur pour « {renameTarget?.name} ».</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Nouveau nom de la liste"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            autoFocus
            className="bg-neutral-900 border-neutral-800 text-white"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitRename(); } }}
          />
          <label htmlFor="playlist-user-agent" className="text-sm text-neutral-300">User-Agent</label>
          <Input
            id="playlist-user-agent"
            value={userAgentValue}
            onChange={e => setUserAgentValue(e.target.value)}
            placeholder={DEFAULT_USER_AGENT}
            aria-invalid={userAgentInvalid}
            aria-describedby="playlist-user-agent-hint"
            className="bg-neutral-900 border-neutral-800 text-white"
          />
          <p id="playlist-user-agent-hint" className={`text-xs ${userAgentInvalid ? 'text-red-400' : 'text-neutral-400'}`}>{userAgentInvalid
            ? 'Caractères ASCII seulement, 200 au plus.'
            : `Envoyé au fournisseur pour les flux, le guide, l’API Xtream et l’actualisation. Vide : ${DEFAULT_USER_AGENT}. À changer seulement si le fournisseur exige un lecteur précis (ex. VLC/3.0.20).`}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="border-neutral-800 text-white hover:bg-neutral-900" onClick={() => setRenameTarget(null)}>Annuler</Button>
            <Button onClick={() => void submitRename()} disabled={renameBusy || !renameValue.trim() || userAgentInvalid}>Enregistrer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
