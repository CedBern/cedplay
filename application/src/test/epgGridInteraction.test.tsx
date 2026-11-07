import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EPGGrid } from '@/components/EPGGrid';

vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ getTotalSize: () => 108, getVirtualItems: () => [{ index: 0, start: 44 }] }) }));
vi.mock('@/utils/reminders', () => ({ getReminders: async () => [], addReminder: vi.fn(), removeReminder: vi.fn(), REMINDERS_EVENT: 'reminders-updated' }));
afterEach(cleanup);

it.each(['Enter', ' '])('la touche %s sur une cloche ne lance pas le direct', async key => {
  const onSelect = vi.fn();
  const now = Date.now();
  const channel = { id: 'a', name: 'Chaîne test', url: 'https://example.test/a' };
  await act(async () => { render(<EPGGrid channels={[channel]} epgData={{ a: [{ id: 'p', channelId: 'a', title: 'Émission à venir', startTime: new Date(now + 60_000), endTime: new Date(now + 120_000) }] }} onSelectChannel={onSelect} />); });
  fireEvent.keyDown(screen.getByRole('button', { name: /Rappel pour/ }), { key });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: /^Émission à venir,/ }), { key });
  expect(onSelect).toHaveBeenCalledWith(channel);
});
