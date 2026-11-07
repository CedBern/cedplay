import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { addReminder, getReminders, isReminded, popDueReminders, removeReminder } from '@/utils/reminders';
import { setMeta } from '@/utils/idb';

beforeEach(async () => { await setMeta('epgReminders', []); });

it('ajoute, retrouve et retire un rappel', async () => {
  const start = Date.now() + 3_600_000;
  await addReminder({ channelId: 'c1', channelName: 'Arte', title: 'Le Dessous des cartes', startTime: start });
  expect(await getReminders()).toHaveLength(1);
  expect(await isReminded('c1', start)).toBe(true);

  // Même créneau + même chaîne : remplace au lieu de dupliquer.
  await addReminder({ channelId: 'c1', channelName: 'Arte', title: 'Le Dessous des cartes (rediff)', startTime: start });
  expect(await getReminders()).toHaveLength(1);

  await removeReminder(`c1:${start}`);
  expect(await getReminders()).toHaveLength(0);
});

it('ne déclenche que les rappels arrivés à échéance récemment', async () => {
  const now = Date.now();
  await addReminder({ channelId: 'c1', channelName: 'Arte', title: 'À l’instant', startTime: now - 5_000 });
  await addReminder({ channelId: 'c2', channelName: 'M6', title: 'Plus tard', startTime: now + 3_600_000 });
  const due = await popDueReminders(now);
  expect(due).toHaveLength(1);
  expect(due[0].title).toBe('À l’instant');
  // Le rappel échu est retiré, le futur reste.
  const rest = await getReminders();
  expect(rest).toHaveLength(1);
  expect(rest[0].title).toBe('Plus tard');
});

it('ignore les rappels trop anciens (plus de 90 s)', async () => {
  const now = Date.now();
  await addReminder({ channelId: 'c1', channelName: 'Arte', title: 'Trop tard', startTime: now - 10 * 60_000 });
  const due = await popDueReminders(now);
  expect(due).toHaveLength(0);
});
