import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { desktopApiPost, isDesktopRuntime, onDesktopServerEvent } from '@/utils/desktopBridge';

export interface PairedCredentials { server: string; username: string; password: string }

interface PairingPlugin {
  acknowledgePairing?(options: { requestId: string; accepted: boolean }): Promise<void>;
  startPairing(): Promise<{ url: string }>;
  stopPairing(options: { url: string }): Promise<void>;
  addListener(event: 'pairingCredentials', listener: (data: Partial<PairedCredentials> & { requestId: string }) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<PairingPlugin>('NativePlayer');

/** Le serveur d'appairage vit dans l'application Android ou Desktop Windows : pas de QR code dans un navigateur classique. */
export function pairingAvailable(): boolean {
  return isDesktopRuntime() || (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativePlayer'));
}

/**
 * Met en forme ce que le téléphone a envoyé. Accepte un lien M3U complet collé dans « serveur »
 * (…/get.php?username=…&password=…) : les identifiants en sont tirés. null si la saisie ne suffit pas.
 */
export function normalizePairedCredentials(raw: Partial<PairedCredentials> | null | undefined): PairedCredentials | null {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  let server = text(raw?.server);
  let username = text(raw?.username);
  let password = text(raw?.password);
  if (!server) return null;
  if (!/^https?:\/\//i.test(server)) server = `http://${server}`;
  let url: URL;
  try { url = new URL(server); } catch { return null; }
  if (!url.hostname) return null;
  username ||= url.searchParams.get('username')?.trim() ?? '';
  password ||= url.searchParams.get('password')?.trim() ?? '';
  if (!username || !password) return null;
  // Lien de liste ou d'API : seul le début de l'adresse désigne le serveur.
  const isLink = url.search !== '' || /\.php$/i.test(url.pathname);
  server = `${url.origin}${isLink ? url.pathname.replace(/[^/]*\.php$/i, '') : url.pathname}`.replace(/\/+$/, '');
  return { server, username, password };
}

/**
 * Ouvre l'appairage : `onUrl` reçoit l'adresse à afficher en QR code, `onCredentials` ce que
 * le téléphone envoie. Renvoie la fermeture. Sans réseau local ou hors Android, rien ne s'affiche.
 */
export function openPairing(onCredentials: (credentials: PairedCredentials) => boolean, onUrl: (url: string) => void): () => void {
  if (!pairingAvailable()) return () => {};
  let closed = false;
  let handle: PluginListenerHandle | null = null;
  let unsubDesktop: (() => void) | null = null;
  let started: string | null = null;
  // Fermer par adresse : une fermeture tardive ne doit pas couper l'appairage rouvert entre-temps.
  const stop = () => {
    if (!started) return;
    if (isDesktopRuntime()) void desktopApiPost('/api/desktop/pairing/stop', { url: started }).catch(() => {});
    else void plugin.stopPairing({ url: started }).catch(() => {});
  };
  void (async () => {
    try {
      if (isDesktopRuntime()) {
        unsubDesktop = onDesktopServerEvent<Partial<PairedCredentials> & { requestId: string }>('pairingCredentials', data => {
          if (closed) return;
          const credentials = normalizePairedCredentials(data);
          let accepted = false;
          try { accepted = !!credentials && onCredentials(credentials) === true; }
          finally { void desktopApiPost('/api/desktop/pairing/ack', { requestId: data.requestId, accepted }).catch(() => {}); }
        });
        if (closed) { unsubDesktop(); return; }
        const { url } = await desktopApiPost<{ url: string }>('/api/desktop/pairing/start', {});
        started = url;
        if (closed) { stop(); return; }
        if (/^http:\/\/[\d.]+:\d+\/[a-z0-9]+$/.test(url)) onUrl(url);
        return;
      }
      const listener = await plugin.addListener('pairingCredentials', data => {
        if (closed) return;
        const credentials = normalizePairedCredentials(data);
        let accepted = false;
        try { accepted = !!credentials && onCredentials(credentials) === true; }
        finally { void plugin.acknowledgePairing?.({ requestId: data.requestId, accepted })?.catch(() => {}); }
      });
      if (closed) { void listener.remove(); return; }
      handle = listener;
      const { url } = await plugin.startPairing();
      started = url;
      if (closed) { stop(); return; }
      if (/^http:\/\/[\d.]+:\d+\/[a-z0-9]+$/.test(url)) onUrl(url);
    } catch { /* pas de réseau local : la saisie à la télécommande reste là */ }
  })();
  return () => {
    closed = true;
    unsubDesktop?.();
    void handle?.remove();
    stop();
  };
}
