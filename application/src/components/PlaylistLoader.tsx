import { useRef, useState } from 'react';
import { loadPublicPlaylist } from '@/utils/publicPlaylist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { CORSProxy } from '@/utils/corsProxy';
import { parseM3UInWorker } from '@/utils/parseWorker';
import { PlaylistInfo } from '@/types/channel';
import { XtreamLoginDialog } from '@/components/XtreamLoginDialog';
import { StalkerLoginDialog } from '@/components/StalkerLoginDialog';
import { stalkerAvailable } from '@/utils/stalker';

interface PlaylistLoaderProps { onPlaylistLoaded: (playlist: PlaylistInfo) => void | Promise<void>; tvMode?: boolean; }

export function PlaylistLoader({ onPlaylistLoaded, tvMode = false }: PlaylistLoaderProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = async (operation: () => Promise<PlaylistInfo>) => {
    setBusy(true); setProgress(0);
    try {
      const playlist = await operation();
      if (!playlist.channels.length) throw new Error('Aucune chaîne trouvée dans cette liste M3U.');
      await onPlaylistLoaded(playlist);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Import impossible.'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const loadFile = (file: File) => {
    void load(async () => {
      const content = await file.text();
      return parseM3UInWorker(content, file.name, setProgress);
    });
  };

  const loadUrl = (rawUrl: string) => {
    void load(async () => {
      const content = await CORSProxy.fetchWithProxy(rawUrl);
      if (!content.includes('#EXTINF:') || content.trim().startsWith('<')) {
        throw new Error('Le serveur ne renvoie pas une liste de chaînes M3U.');
      }
      // Nom sans identifiants ; l'URL source est conservée pour le rafraîchissement.
      const host = (() => { try { return new URL(rawUrl).hostname; } catch { return 'liste'; } })();
      const playlist = await parseM3UInWorker(content, `Liste — ${host}`, setProgress);
      playlist.url = rawUrl;
      return playlist;
    });
  };

  const loadDemo = () => { void load(() => loadPublicPlaylist(setProgress)); };

  return <Card className="w-full max-w-xl bg-neutral-950 text-white border-neutral-800">
    <CardHeader><CardTitle>Importer une liste de chaînes</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <div className="p-4 bg-primary/10 rounded-lg border border-primary/30 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-white">Chaînes gratuites</h4>
            <p className="text-xs text-neutral-400">Catalogue complet de plus de 1 000 chaînes, classées par pays.</p>
          </div>
          <Button type="button" variant="default" size="sm" disabled={busy} onClick={loadDemo} className="shrink-0">Charger</Button>
        </div>
      </div>

      <div className="p-4 bg-neutral-900/80 rounded-lg border border-neutral-800/80 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-sm text-neutral-100">Abonnement Xtream Codes</h4>
            <p className="text-xs text-neutral-400">Connexion directe par serveur, identifiant et mot de passe.</p>
          </div>
          <XtreamLoginDialog tvMode={tvMode} onPlaylistLoaded={onPlaylistLoaded} />
        </div>
      </div>

      {stalkerAvailable() && <div className="p-4 bg-neutral-900/80 rounded-lg border border-neutral-800/80 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-sm text-neutral-100">Portail Stalker (adresse MAC)</h4>
            <p className="text-xs text-neutral-400">Abonnements prévus pour les boîtiers MAG : adresse du portail et adresse MAC.</p>
          </div>
          <StalkerLoginDialog onPlaylistLoaded={onPlaylistLoaded} />
        </div>
      </div>}

      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-neutral-900" /></div>
        <div className="relative flex justify-center text-xs uppercase"><span className="bg-neutral-950 px-2 text-neutral-500">Ou fichier M3U classique</span></div>
      </div>

      <p className="text-sm text-neutral-300">Choisis un fichier ou l’adresse de ta liste M3U. Elle sera enregistrée sur cet ordinateur.</p>
      <label className="block space-y-2">Fichier M3U ou M3U8
        <Input ref={fileRef} aria-label="Fichier M3U ou M3U8" type="file" accept=".m3u,.m3u8" disabled={busy} onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (!/\.m3u8?$/i.test(file.name)) { toast.error('Choisis un fichier M3U ou M3U8.'); return; }
          loadFile(file);
        }} />
      </label>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); loadUrl(url.trim()); }}>
        <label htmlFor="playlist-url">Adresse de la liste</label>
        <Input id="playlist-url" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/playlist.m3u" disabled={busy} autoComplete="off" />
        <Button type="submit" disabled={busy || !url.trim()}>Importer l’adresse</Button>
      </form>
      {busy && <div role="status"><progress max="100" value={progress} className="w-full" />Import : {progress} %</div>}
      <p className="text-xs text-neutral-400">Si le serveur refuse l’import web, télécharge la liste puis choisis le fichier. Aucun relais public utilisé.</p>
    </CardContent>
  </Card>;
}
