import { useEffect, useRef } from 'react';
import {
  getLanHostEnabled,
  lanSyncAvailable,
  openLanSyncHost,
  syncAllPairedPeers,
} from '@/utils/lanSync';

const AUTO_SYNC_DEBOUNCE_MS = 2500;
const SUPPRESS_AFTER_SYNC_MS = 3500;

/**
 * Maintient le serveur de synchronisation réseau local actif si activé sur l'appareil,
 * et déclenche une synchronisation discrète vers les pairs appairés au démarrage,
 * au retour en ligne et après les mises à jour locales de progression ou de Ma liste.
 */
export function useLanSync(): void {
  const suppressUntilRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let closeHost: (() => void) | null = null;
    let cancelled = false;

    const refreshHost = async () => {
      closeHost?.();
      closeHost = null;
      if (!lanSyncAvailable()) return;
      const enabled = await getLanHostEnabled();
      if (cancelled || !enabled) return;
      closeHost = openLanSyncHost({
        onSynced: summary => {
          if (summary.changed) {
            suppressUntilRef.current = Date.now() + SUPPRESS_AFTER_SYNC_MS;
          }
        },
      });
    };

    void refreshHost();

    const onHostChanged = () => {
      void refreshHost();
    };
    window.addEventListener('lan-sync-host-changed', onHostChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('lan-sync-host-changed', onHostChanged);
      closeHost?.();
    };
  }, []);

  useEffect(() => {
    const runSync = () => {
      void syncAllPairedPeers().then(res => {
        if (res.succeeded > 0) {
          suppressUntilRef.current = Date.now() + SUPPRESS_AFTER_SYNC_MS;
        }
      });
    };

    const scheduleSync = () => {
      if (Date.now() < suppressUntilRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (Date.now() < suppressUntilRef.current) return;
        runSync();
      }, AUTO_SYNC_DEBOUNCE_MS);
    };

    const startupTimer = setTimeout(runSync, 1500);
    window.addEventListener('online', scheduleSync);
    window.addEventListener('vod-history-updated', scheduleSync);
    window.addEventListener('vod-watchlist-updated', scheduleSync);

    return () => {
      clearTimeout(startupTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('online', scheduleSync);
      window.removeEventListener('vod-history-updated', scheduleSync);
      window.removeEventListener('vod-watchlist-updated', scheduleSync);
    };
  }, []);
}
