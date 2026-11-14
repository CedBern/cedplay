import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  fetchTraktUserProfile,
  pollDeviceToken,
  requestDeviceCode,
  syncTraktHistory,
  TRAKT_ACTIVATE_URL,
  type TraktDeviceCodeResponse,
  type TraktTokenResponse,
  type TraktUser,
} from '@/utils/trakt';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';

const QUIET_ZONE = 4;

function qrPath(text: string): { size: number; path: string } {
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

export interface TraktAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  onSuccess: (data: { tokens: TraktTokenResponse; user: TraktUser }) => void | Promise<void>;
}

export function TraktAuthDialog({
  open,
  onOpenChange,
  clientId,
  clientSecret,
  onSuccess,
}: TraktAuthDialogProps) {
  const [deviceData, setDeviceData] = useState<TraktDeviceCodeResponse | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activateUrl = deviceData?.verification_url || TRAKT_ACTIVATE_URL;
  const { size, path } = useMemo(() => qrPath(activateUrl), [activateUrl]);

  // Démarre la procédure OAuth dès l'ouverture du dialogue
  useEffect(() => {
    if (!open) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      setDeviceData(null);
      setErrorMsg(null);
      setCopied(false);
      return;
    }

    let active = true;
    setLoadingCode(true);
    setErrorMsg(null);

    requestDeviceCode(clientId)
      .then(res => {
        if (!active) return;
        setDeviceData(res);
        setLoadingCode(false);
      })
      .catch(err => {
        if (!active) return;
        setLoadingCode(false);
        setErrorMsg(err instanceof Error ? err.message : 'Échec de la demande Trakt.');
      });

    return () => {
      active = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [open, clientId]);

  // Boucle de polling lorsque le device_code est reçu
  useEffect(() => {
    if (!open || !deviceData?.device_code) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      const res = await pollDeviceToken(deviceData.device_code, clientId, clientSecret, controller.signal);

      if (cancelled) return;

      if (res.status === 'success') {
        try {
          const user = await fetchTraktUserProfile(res.tokens.access_token, clientId);
          await onSuccess({ tokens: res.tokens, user });
          // Déclenche une première synchronisation transparente
          syncTraktHistory(res.tokens.access_token, clientId).catch(() => {});
          toast.success(`Connecté à Trakt en tant que @${user.username} !`);
          onOpenChange(false);
        } catch {
          await onSuccess({ tokens: res.tokens, user: { username: 'utilisateur' } });
          toast.success('Connecté à Trakt !');
          onOpenChange(false);
        }
        return;
      }

      if (res.status === 'pending') {
        const intervalMs = Math.max(2, deviceData.interval || 5) * 1000;
        pollTimerRef.current = setTimeout(poll, intervalMs);
        return;
      }

      if (res.status === 'slow_down') {
        const intervalMs = Math.max(5, (deviceData.interval || 5) + 3) * 1000;
        pollTimerRef.current = setTimeout(poll, intervalMs);
        return;
      }

      if (res.status === 'expired') {
        setErrorMsg('Le code a expiré. Ferme puis réouvre pour en générer un nouveau.');
        return;
      }

      if (res.status === 'denied') {
        setErrorMsg('Connexion refusée sur Trakt.');
        return;
      }

      if (res.status === 'error') {
        setErrorMsg(res.message);
      }
    };

    // Premier poll après l'intervalle recommandé
    const initialDelay = Math.max(3, deviceData.interval || 5) * 1000;
    pollTimerRef.current = setTimeout(poll, initialDelay);

    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [open, deviceData, clientId, clientSecret, onSuccess, onOpenChange]);

  const copyCode = () => {
    if (!deviceData?.user_code) return;
    navigator.clipboard.writeText(deviceData.user_code).then(() => {
      setCopied(true);
      toast.success('Code copié dans le presse-papier !');
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error('Copie impossible.');
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-neutral-800 bg-background p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#ed1c24]" />
            Connexion à Trakt.tv
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            Autorise CedPlay à synchroniser tes visionnages et scrobbler en direct.
          </DialogDescription>
        </DialogHeader>

        {loadingCode && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Demande du code de validation…</p>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
            <p className="text-sm text-destructive">{errorMsg}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setErrorMsg(null);
                setLoadingCode(true);
                requestDeviceCode(clientId)
                  .then(res => {
                    setDeviceData(res);
                    setLoadingCode(false);
                  })
                  .catch(err => {
                    setLoadingCode(false);
                    setErrorMsg(err instanceof Error ? err.message : 'Échec de la demande Trakt.');
                  });
              }}
            >
              Réessayer
            </Button>
          </div>
        )}

        {deviceData && !errorMsg && (
          <div className="space-y-5 py-2 text-center">
            {/* Étape 1 : URL & QR Code */}
            <div className="flex flex-col items-center gap-3">
              <svg
                role="img"
                aria-label="QR code vers trakt.tv/activate"
                viewBox={`0 0 ${size} ${size}`}
                shapeRendering="crispEdges"
                className="h-36 w-36 rounded-xl border border-neutral-800 p-1"
                style={{ background: '#fff' }}
              >
                <path d={path} fill="#000" />
              </svg>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Scanne le QR code avec ton téléphone ou ouvre :
                </p>
                <a
                  href={activateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  trakt.tv/activate
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            {/* Étape 2 : Code utilisateur */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Code à saisir sur Trakt
              </p>
              <div className="my-2 font-mono text-3xl font-black tracking-widest text-primary selection:bg-primary/20">
                {deviceData.user_code}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={copyCode}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copié !' : 'Copier le code'}
              </Button>
            </div>

            {/* Statut d'attente */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              En attente de validation sur trakt.tv/activate…
            </div>
          </div>
        )}

        <div className="mt-2 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
