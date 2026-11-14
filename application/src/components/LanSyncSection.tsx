import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getCurrentLanHostUrl,
  getLanHostEnabled,
  getSyncedPeers,
  lanSyncAvailable,
  removeSyncedPeer,
  setLanHostEnabled,
  syncWithPeer,
  type SyncedPeer,
} from '@/utils/lanSync';

const QUIET_ZONE = 4;

function buildQrPath(text: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size: count + QUIET_ZONE * 2, path };
}

function formatSyncDate(ts?: number): string {
  if (!ts) return 'Jamais';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function LanSyncSection({ fieldClass, remoteActivation = false }: { fieldClass: string; remoteActivation?: boolean }) {
  const canHost = lanSyncAvailable();
  const [hostEnabled, setHostEnabledState] = useState(false);
  const [hostUrl, setHostUrl] = useState<string | null>(() => getCurrentLanHostUrl());
  const [peers, setPeers] = useState<SyncedPeer[]>([]);
  const [peerUrlInput, setPeerUrlInput] = useState('');
  const [peerLabelInput, setPeerLabelInput] = useState('');
  const [syncingUrl, setSyncingUrl] = useState<string | null>(null);

  useEffect(() => {
    void getLanHostEnabled().then(setHostEnabledState);
    void getSyncedPeers().then(setPeers);

    const onUrl = () => setHostUrl(getCurrentLanHostUrl());
    const onPeers = () => {
      void getSyncedPeers().then(setPeers);
    };
    window.addEventListener('lan-sync-host-url', onUrl);
    window.addEventListener('lan-sync-peers-updated', onPeers);
    return () => {
      window.removeEventListener('lan-sync-host-url', onUrl);
      window.removeEventListener('lan-sync-peers-updated', onPeers);
    };
  }, []);

  const qrContent = hostUrl ? `cedplay://sync?url=${encodeURIComponent(hostUrl)}` : '';
  const qr = useMemo(() => (qrContent ? buildQrPath(qrContent) : null), [qrContent]);

  const toggleHost = async (checked: boolean) => {
    await setLanHostEnabled(checked);
    setHostEnabledState(checked);
    window.dispatchEvent(new Event('lan-sync-host-changed'));
  };

  const handleSync = async (rawUrl: string, label?: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      toast.error('Saisis l’adresse affichée sur l’autre appareil.');
      return;
    }
    setSyncingUrl(trimmed);
    try {
      const summary = await syncWithPeer(trimmed, label?.trim() || undefined);
      toast.success(
        `Synchronisé : ${summary.vodHistoryCount} progression(s), ${summary.watchlistCount} titre(s) dans Ma liste.`,
      );
      setPeerUrlInput('');
      setPeerLabelInput('');
      setPeers(await getSyncedPeers());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la synchronisation locale.');
    } finally {
      setSyncingUrl(null);
    }
  };

  return (
    <div className="space-y-3 py-3">
      <p className="text-xs text-muted-foreground">
        Synchronise la progression VOD et Ma liste sur le réseau Wi-Fi local, sans serveur externe. Les réglages d’interface et de lecteur restent propres à chaque appareil.
      </p>

      {canHost && (
        <div className="space-y-2.5 rounded-lg border border-border/70 bg-muted/20 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm text-foreground">Recevoir les synchronisations sur cet appareil</span>
              <span className="block text-xs text-muted-foreground">
                Utile sur Android TV pour que le téléphone puisse s’appairer par QR code ou adresse locale.
              </span>
            </span>
            <input
              type="checkbox"
              checked={hostEnabled}
              onChange={e => void toggleHost(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </label>

          {hostEnabled && (
            hostUrl && qr ? (
              <div className="flex flex-col items-center gap-2 pt-1 text-center">
                <svg
                  role="img"
                  aria-label="QR code de synchronisation locale"
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  shapeRendering="crispEdges"
                  className="h-[140px] w-[140px] rounded-lg"
                  style={{ background: '#fff' }}
                >
                  <path d={qr.path} fill="#000" />
                </svg>
                <span className="break-all text-xs font-medium text-foreground">{hostUrl}</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Serveur local en attente de connexion Wi-Fi / Ethernet…
              </p>
            )
          )}
        </div>
      )}

      <div className="space-y-2">
        <span className="block text-sm text-foreground">Synchroniser avec un autre appareil</span>
        <Input
          remoteActivation={remoteActivation}
          className={fieldClass}
          type="text"
          placeholder="http://192.168.1.42:48123/sync/…"
          value={peerUrlInput}
          onChange={e => setPeerUrlInput(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            remoteActivation={remoteActivation}
            className={`${fieldClass} mt-0`}
            type="text"
            placeholder="Nom (ex. TV Salon, facultatif)"
            value={peerLabelInput}
            onChange={e => setPeerLabelInput(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={syncingUrl !== null}
            onClick={() => void handleSync(peerUrlInput, peerLabelInput)}
            className="shrink-0 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingUrl === peerUrlInput.trim() ? 'animate-spin' : ''}`} />
            Synchroniser
          </Button>
        </div>
      </div>

      {peers.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <span className="block text-xs font-medium text-muted-foreground">Appareils appairés</span>
          {peers.map(peer => (
            <div key={peer.url} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{peer.label || peer.url}</div>
                <div className="truncate text-xs text-muted-foreground">
                  Dernière synchro : {formatSyncDate(peer.lastSyncedAt)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={syncingUrl !== null}
                  onClick={() => void handleSync(peer.url, peer.label)}
                  aria-label={`Synchroniser avec ${peer.label || peer.url}`}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingUrl === peer.url ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeSyncedPeer(peer.url)}
                  aria-label={`Supprimer ${peer.label || peer.url}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
