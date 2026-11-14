// Maintien des notifications système de rappels EPG (natif uniquement) :
// synchronisation au montage, à chaque changement de la liste des rappels et au
// retour au premier plan (notamment après un accord de notification donné dans
// les réglages Android), et routage de l'appui sur une notification vers
// l'ouverture de la chaîne.

import { useEffect } from 'react';
import { isDesktopRuntime, onDesktopServerEvent } from '@/utils/desktopBridge';
import { REMINDERS_EVENT } from '@/utils/reminders';
import { addReminderTapListener, ensureReminderChannel, syncNativeReminders } from '@/utils/remindersNative';

export function useRemindersSync(onOpenChannel?: (channelId: string) => void): void {
  useEffect(() => {
    void ensureReminderChannel();
    // Un refus de permission ou une erreur du plugin ne doit jamais casser le
    // montage : la synchronisation retentera d'elle-même.
    const sync = () => { syncNativeReminders().catch(() => { /* retenté plus tard */ }); };
    sync();
    window.addEventListener(REMINDERS_EVENT, sync);
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    let removeTap: (() => void) | undefined;
    let removeDesktopEvent: (() => void) | undefined;
    let disposed = false;
    if (onOpenChannel) {
      void addReminderTapListener(channelId => { if (!disposed) onOpenChannel(channelId); })
        .then(remove => { if (disposed) remove(); else removeTap = remove; })
        .catch(() => { /* plugin indisponible : ne pas interrompre le montage */ });
      if (isDesktopRuntime()) {
        removeDesktopEvent = onDesktopServerEvent<{ channelId?: string }>('reminderTriggered', () => {
          window.dispatchEvent(new Event(REMINDERS_EVENT));
        });
      }
    }
    return () => {
      disposed = true;
      window.removeEventListener(REMINDERS_EVENT, sync);
      document.removeEventListener('visibilitychange', onVisible);
      removeTap?.();
      removeDesktopEvent?.();
    };
  }, [onOpenChannel]);
}
