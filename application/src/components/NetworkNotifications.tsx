import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { NetworkStatus } from '@/hooks/useNetworkStatus';

interface NetworkNotificationsProps {
  networkStatus: NetworkStatus;
  enabled?: boolean;
}

export function NetworkNotifications({ networkStatus, enabled = true }: NetworkNotificationsProps) {
  const [lastNotifiedStatus, setLastNotifiedStatus] = useState<NetworkStatus | null>(null);
  const [lastNotificationTime, setLastNotificationTime] = useState<number>(0);
  
  // Minimum time between notifications (in milliseconds)
  const NOTIFICATION_COOLDOWN = 5000; // 5 seconds

  useEffect(() => {
    if (!enabled) return;

    if (!lastNotifiedStatus) {
      setLastNotifiedStatus(networkStatus);
      return;
    }

    const checkAndNotify = () => {
      const now = Date.now();
      const elapsed = now - lastNotificationTime;
      if (elapsed < NOTIFICATION_COOLDOWN) return;

      // Connection lost
      if (lastNotifiedStatus.isOnline && !networkStatus.isOnline) {
        toast.error('Connexion internet perdue', {
          description: 'La lecture vidéo sera interrompue jusqu\'au retour de la connexion.',
          duration: 10000,
        });
        setLastNotificationTime(now);
        setLastNotifiedStatus(networkStatus);
      }
      // Connection restored
      else if (!lastNotifiedStatus.isOnline && networkStatus.isOnline) {
        toast.success('Connexion internet rétablie', {
          description: 'Vous pouvez reprendre la lecture vidéo.',
          duration: 5000,
        });
        setLastNotificationTime(now);
        setLastNotifiedStatus(networkStatus);
      }
      // Connection quality degraded significantly
      else if (networkStatus.isOnline && lastNotifiedStatus.isOnline
        && lastNotifiedStatus.effectiveType !== 'unknown' && networkStatus.effectiveType !== 'unknown') {
        const previousQuality = getConnectionQuality(lastNotifiedStatus);
        const currentQuality = getConnectionQuality(networkStatus);
        
        if (previousQuality > currentQuality && currentQuality <= 1) {
          toast.warning('Qualité de connexion dégradée', {
            description: 'La lecture vidéo pourrait être affectée. Considérez une qualité inférieure.',
            duration: 7000,
          });
          setLastNotificationTime(now);
          setLastNotifiedStatus(networkStatus);
        }
        // Connection quality improved significantly
        else if (currentQuality > previousQuality && currentQuality >= 3) {
          toast.info('Qualité de connexion améliorée', {
            description: 'Vous pouvez maintenant utiliser une qualité vidéo supérieure.',
            duration: 5000,
          });
          setLastNotificationTime(now);
          setLastNotifiedStatus(networkStatus);
        } else {
          setLastNotifiedStatus(networkStatus);
        }
      } else {
        setLastNotifiedStatus(networkStatus);
      }
    };

    const now = Date.now();
    const elapsed = now - lastNotificationTime;
    if (elapsed < NOTIFICATION_COOLDOWN) {
      const remaining = Math.max(10, NOTIFICATION_COOLDOWN - elapsed);
      const timer = setTimeout(() => {
        checkAndNotify();
      }, remaining);
      return () => clearTimeout(timer);
    }

    checkAndNotify();
  }, [networkStatus, lastNotifiedStatus, enabled, lastNotificationTime]);

  // Helper function to get numeric quality score
  const getConnectionQuality = (status: NetworkStatus): number => {
    if (!status.isOnline) return 0;
    
    const { effectiveType, downlink } = status;
    
    if (effectiveType === '4g' && downlink > 10) return 4; // excellent
    if (effectiveType === '4g' || (effectiveType === '3g' && downlink > 5)) return 3; // good
    if (effectiveType === '3g' || downlink > 1) return 2; // fair
    return 1; // poor
  };

  return null; // This component doesn't render anything visible
}
