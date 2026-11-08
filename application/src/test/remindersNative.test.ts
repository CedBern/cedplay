import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getMeta, setMeta } from '@/utils/idb';
import { addReminder, REMINDERS_EVENT, removeReminder } from '@/utils/reminders';
import { notificationId, syncNativeReminders } from '@/utils/remindersNative';
import { useRemindersSync } from '@/hooks/useRemindersSync';

const mocks = vi.hoisted(() => {
  const removeListener = vi.fn(async () => undefined);
  return {
    isNativePlatform: vi.fn(() => true),
    schedule: vi.fn(async (_payload: { notifications: Array<{ id: number; channelId: string; title: string; body: string; schedule: { at: Date; allowWhileIdle: boolean }; extra: { channelId: string } }> }) => ({ notifications: [] })),
    cancel: vi.fn(async (_payload: { notifications: Array<{ id: number }> }) => undefined),
    checkPermissions: vi.fn(async () => ({ display: 'granted' as string })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' as string })),
    createChannel: vi.fn(async (_channel: unknown) => undefined),
    addListener: vi.fn(async (_event: string, _callback: (action: { notification: { extra?: unknown } }) => void) => ({ remove: removeListener })),
    removeListener,
  };
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.isNativePlatform() } }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mocks }));

const START = Date.now() + 3_600_000;
const reminder = { channelId: '5', channelName: 'TF1', title: 'Film du soir', startTime: START };

beforeEach(async () => {
  await setMeta('epgReminders', []);
  await setMeta('epgRemindersScheduled', []);
  vi.clearAllMocks();
  mocks.isNativePlatform.mockReturnValue(true);
  mocks.checkPermissions.mockResolvedValue({ display: 'granted' });
});

it('ne programme rien en web', async () => {
  mocks.isNativePlatform.mockReturnValue(false);
  await addReminder(reminder);
  await syncNativeReminders();
  expect(mocks.schedule).not.toHaveBeenCalled();
  expect(mocks.createChannel).not.toHaveBeenCalled();
});

it('pose une notification à l’heure de début avec la chaîne en extra', async () => {
  await addReminder(reminder);
  await syncNativeReminders();
  expect(mocks.schedule).toHaveBeenCalledOnce();
  const notif = mocks.schedule.mock.calls[0][0].notifications[0];
  expect(notif.id).toBe(notificationId({ id: '5:' + START }));
  expect(notif.channelId).toBe('epg-reminders');
  expect(notif.title).toBe('TF1');
  expect(notif.body).toBe('Film du soir commence');
  expect(notif.schedule.at.getTime()).toBe(START);
  expect(notif.schedule.allowWhileIdle).toBe(true);
  expect(notif.extra.channelId).toBe('5');
  // La liste posée est mémorisée pour la réconciliation suivante.
  expect(await getMeta('epgRemindersScheduled')).toEqual([{ id: notif.id, startTime: START }]);
});

it('demande la permission d’afficher avant la première programmation', async () => {
  mocks.checkPermissions.mockResolvedValue({ display: 'prompt' });
  await addReminder(reminder);
  await syncNativeReminders();
  expect(mocks.requestPermissions).toHaveBeenCalledOnce();
  expect(mocks.schedule).toHaveBeenCalledOnce();
});

it('ne programme rien et ne mémorise pas quand la permission est refusée', async () => {
  mocks.checkPermissions.mockResolvedValue({ display: 'denied' });
  mocks.requestPermissions.mockResolvedValue({ display: 'denied' });
  await addReminder(reminder);
  await syncNativeReminders();
  expect(mocks.schedule).not.toHaveBeenCalled();
  // Rien de mémorisé : la synchronisation suivante retentera.
  expect(await getMeta('epgRemindersScheduled')).toEqual([]);
});

it('reprogramme une fois la permission accordée', async () => {
  mocks.checkPermissions.mockResolvedValue({ display: 'denied' });
  mocks.requestPermissions.mockResolvedValue({ display: 'denied' });
  await addReminder(reminder);
  await syncNativeReminders();
  expect(mocks.schedule).not.toHaveBeenCalled();
  mocks.checkPermissions.mockResolvedValue({ display: 'granted' });
  await syncNativeReminders();
  expect(mocks.schedule).toHaveBeenCalledOnce();
  expect(await getMeta('epgRemindersScheduled')).toHaveLength(1);
});

it('annule la notification d’un rappel supprimé avant échéance', async () => {
  await addReminder(reminder);
  await syncNativeReminders();
  const id = mocks.schedule.mock.calls[0][0].notifications[0].id;
  mocks.cancel.mockClear();
  await removeReminder('5:' + START);
  await syncNativeReminders();
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.cancel.mock.calls[0][0].notifications).toEqual([{ id }]);
  expect(await getMeta('epgRemindersScheduled')).toEqual([]);
});

it('oublie sans annuler une notification déjà sonnée (elle reste dans le volet)', async () => {
  await addReminder(reminder);
  await syncNativeReminders();
  const id = mocks.schedule.mock.calls[0][0].notifications[0].id;
  mocks.cancel.mockClear();
  // Le rappel est consommé (popDueReminders) et le temps a passé.
  await setMeta('epgReminders', []);
  await syncNativeReminders(START + 1_000);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(await getMeta('epgRemindersScheduled')).toEqual([]);
  expect(id).toBeTypeOf('number');
});

it('ignore les rappels passés et replanifie seulement les nouveaux', async () => {
  await addReminder({ ...reminder, startTime: Date.now() - 5_000 });
  await syncNativeReminders();
  expect(mocks.schedule).not.toHaveBeenCalled();
  // Un second rappel futur est posé sans toucher au premier.
  await addReminder(reminder);
  await syncNativeReminders();
  expect(mocks.schedule).toHaveBeenCalledOnce();
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it('resynchronise à l’écoute de REMINDERS_EVENT et retire le tap au démontage', async () => {
  mocks.schedule.mockClear();
  const onOpenChannel = vi.fn();
  const { unmount } = renderHook(() => useRemindersSync(onOpenChannel));
  await act(async () => {
    window.dispatchEvent(new Event(REMINDERS_EVENT));
  });
  expect(mocks.createChannel).toHaveBeenCalled();
  // Appui sur une notification : la chaîne est transmise au handler.
  const listener = mocks.addListener.mock.calls.find(c => c[0] === 'localNotificationActionPerformed');
  expect(listener).toBeDefined();
  await act(async () => {
    await listener![1]({ notification: { extra: { channelId: '9' } } });
  });
  expect(onOpenChannel).toHaveBeenCalledWith('9');
  // Extra étranger : pas d’ouverture.
  await act(async () => {
    await listener![1]({ notification: { extra: { other: true } } });
  });
  expect(onOpenChannel).toHaveBeenCalledOnce();
  const handle = await mocks.addListener.mock.results[0].value;
  unmount();
  expect(handle.remove).toBe(mocks.removeListener);
  expect(mocks.removeListener).toHaveBeenCalled();
});

it('encaisse une erreur du plugin et retente au retour au premier plan', async () => {
  mocks.schedule.mockClear();
  mocks.schedule.mockRejectedValueOnce(new Error('plantage du plugin'));
  await addReminder(reminder);
  const { unmount } = renderHook(() => useRemindersSync(vi.fn()));
  await act(async () => { /* synchronisation au montage : l'échec est encaissé */ });
  expect(mocks.schedule).toHaveBeenCalledTimes(1);
  // Rien de mémorisé : la synchronisation suivante retentera.
  expect(await getMeta('epgRemindersScheduled')).toEqual([]);
  // Retour au premier plan (accord de notification dans les réglages, par exemple).
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(mocks.schedule).toHaveBeenCalledTimes(2);
  expect(await getMeta('epgRemindersScheduled')).toHaveLength(1);
  unmount();
});

it('encaisse aussi une erreur à l’installation de l’écouteur de notification', async () => {
  mocks.addListener.mockRejectedValueOnce(new Error('écouteur indisponible'));
  const { unmount } = renderHook(() => useRemindersSync(vi.fn()));
  await act(async () => { /* le rejet ne doit pas devenir une erreur non gérée */ });
  expect(mocks.addListener).toHaveBeenCalledOnce();
  unmount();
});

it('calcule un identifiant 32 bits stable', () => {
  const a = notificationId({ id: '5:1700000000000' });
  expect(a).toBe(notificationId({ id: '5:1700000000000' }));
  expect(a).toBe(Math.trunc(a));
  expect(a).toBeGreaterThanOrEqual(-2_147_483_648);
  expect(a).toBeLessThanOrEqual(2_147_483_647);
});
