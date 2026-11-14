// Rappels EPG en notification système (Android). Complète les rappels in-app de
// reminders.ts : chaque rappel futur devient une notification programmée à
// l'heure de début de l'émission ; un appui dessus ouvre la chaîne via le même
// flux que le raccourci lecteuriptv://channel?id=… (launchChannelId). Sans
// objet en web. Le plugin re-programme lui-même les notifications après reboot
// (LocalNotificationRestoreReceiver) — la resynchronisation sert aux changements
// faits côté application et, après un refus de permission, à la nouvelle
// tentative une fois l'autorisation obtenue.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getMeta, setMeta } from '@/utils/idb';
import { isDesktopRuntime, syncDesktopReminders } from '@/utils/desktopBridge';
import { getReminders, type EpgReminder } from '@/utils/reminders';

const CHANNEL_ID = 'epg-reminders';
const SCHEDULED_KEY = 'epgRemindersScheduled';

/** Notification posée : identifiant plugin (32 bits) et début du rappel d'origine. */
interface ScheduledRef {
  id: number;
  startTime: number;
}

/** Identifiant de notification 32 bits stable, dérivé de l'identifiant du rappel. */
export function notificationId(reminder: Pick<EpgReminder, 'id'>): number {
  let hash = 0;
  for (let i = 0; i < reminder.id.length; i++) hash = ((hash * 31) + reminder.id.charCodeAt(i)) | 0;
  return hash;
}

function isNative(): boolean {
  return Capacitor.isNativePlatform?.() === true;
}

/** Canal Android dédié (créé une seule fois ; recréer est sans effet). */
export async function ensureReminderChannel(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Rappels de programmes',
      description: 'Rappel au début d’une émission suivie dans le guide.',
      importance: 3, // IMPORTANCE_DEFAULT : son léger, pas d'irruption plein écran.
      vibration: false,
    });
  } catch { /* canal déjà présent ou plateforme sans canaux */ }
}

/** Vrai si l'affichage des notifications est autorisé (demande au besoin). */
async function ensureDisplayPermission(): Promise<boolean> {
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') return true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  } catch {
    // Plugin absent ou demande rejetée : on ne programme pas, la prochaine
    // synchronisation (montage, changement de rappel, retour au premier plan)
    // retentera une fois l'autorisation obtenue.
    return false;
  }
}

async function getScheduled(): Promise<ScheduledRef[]> {
  try {
    const saved = await getMeta<ScheduledRef[]>(SCHEDULED_KEY);
    return Array.isArray(saved)
      ? saved.filter(s => typeof s?.id === 'number' && typeof s?.startTime === 'number')
      : [];
  } catch {
    return [];
  }
}

/**
 * Aligne les notifications programmées sur les rappels stockés : pose les
 * nouveaux, annule ceux supprimés avant échéance, oublie ceux déjà sonnés (la
 * notification affichée reste dans le volet tant que l'utilisateur ne l'a pas
 * écartée).
 */
export async function syncNativeReminders(now: number = Date.now()): Promise<void> {
  if (!isNative()) {
    if (isDesktopRuntime()) {
      const reminders = await getReminders();
      const pending = reminders.filter(r => r.startTime > now - 90_000);
      await syncDesktopReminders(pending);
    }
    return;
  }
  const [reminders, scheduled] = await Promise.all([getReminders(), getScheduled()]);
  const future = new Map<number, EpgReminder>();
  for (const r of reminders) if (r.startTime > now) future.set(notificationId(r), r);
  const scheduledIds = new Set(scheduled.map(s => s.id));
  // Supprimés avant échéance : la notification ne doit plus sonner.
  const toCancel = scheduled.filter(s => !future.has(s.id) && s.startTime > now).map(s => ({ id: s.id }));
  if (toCancel.length) await LocalNotifications.cancel({ notifications: toCancel });
  const toSchedule = [...future.entries()].filter(([id]) => !scheduledIds.has(id));
  if (toSchedule.length) {
    // Permission refusée : ne rien poser ni mémoriser, pour que la prochaine
    // synchronisation retente (le registre décrit ce qui est réellement posé).
    if (!(await ensureDisplayPermission())) return;
    await LocalNotifications.schedule({
      notifications: toSchedule.map(([id, r]) => ({
        id,
        channelId: CHANNEL_ID,
        title: r.channelName,
        body: `${r.title} commence`,
        schedule: { at: new Date(r.startTime), allowWhileIdle: true },
        extra: { channelId: r.channelId },
      })),
    });
  }
  const scheduledRefs: ScheduledRef[] = [];
  for (const [id, r] of future) scheduledRefs.push({ id, startTime: r.startTime });
  await setMeta(SCHEDULED_KEY, scheduledRefs);
}

/** Appui sur une notification de rappel : fournit la chaîne à ouvrir. */
export function addReminderTapListener(handler: (channelId: string) => void): Promise<() => void> {
  if (!isNative()) return Promise.resolve(() => {});
  return LocalNotifications.addListener('localNotificationActionPerformed', action => {
    const extra = action.notification.extra as { channelId?: unknown } | undefined;
    if (typeof extra?.channelId === 'string' && extra.channelId) handler(extra.channelId);
  }).then(listener => () => { void listener.remove(); });
}
