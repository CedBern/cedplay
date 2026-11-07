// Rappels EPG (notifications dans l'application au début d'une émission).
// Stockés en IndexedDB ; déclenchés par l'intervalle de contrôle d'IPTVPlayer.

import { getMeta, setMeta } from '@/utils/idb';

export interface EpgReminder {
  id: string;
  channelId: string;
  channelName: string;
  title: string;
  startTime: number; // epoch ms
}

const KEY = 'epgReminders';
export const REMINDERS_EVENT = 'epg-reminders-updated';

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REMINDERS_EVENT));
}

export async function getReminders(): Promise<EpgReminder[]> {
  try {
    const saved = await getMeta<EpgReminder[]>(KEY);
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/** Ajoute (ou remplace) un rappel pour la même chaîne et le même créneau. */
export async function addReminder(reminder: Omit<EpgReminder, 'id'>): Promise<void> {
  const list = await getReminders();
  const existing = list.findIndex(r => r.channelId === reminder.channelId && r.startTime === reminder.startTime);
  if (existing >= 0) {
    list[existing] = { ...reminder, id: list[existing].id };
  } else {
    list.push({ ...reminder, id: `${reminder.channelId}:${reminder.startTime}` });
  }
  await setMeta(KEY, list);
  emit();
}

export async function removeReminder(id: string): Promise<void> {
  const list = await getReminders();
  await setMeta(KEY, list.filter(r => r.id !== id));
  emit();
}

export async function isReminded(channelId: string, startTime: number): Promise<boolean> {
  const list = await getReminders();
  return list.some(r => r.channelId === channelId && r.startTime === startTime);
}

/** Récupère et retire les rappels arrivés à échéance dans les 90 dernières secondes. */
export async function popDueReminders(now: number): Promise<EpgReminder[]> {
  const list = await getReminders();
  const due = list.filter(r => r.startTime <= now && now - r.startTime <= 90_000);
  if (due.length) {
    const dueIds = new Set(due.map(r => r.id));
    await setMeta(KEY, list.filter(r => !dueIds.has(r.id)));
    emit();
  }
  return due;
}
