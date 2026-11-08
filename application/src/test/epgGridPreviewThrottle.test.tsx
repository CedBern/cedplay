import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Channel } from '@/types/channel';

// Aperçu natif du guide : le cadre est remesuré et le pont est rappelé au défilement.
// Sans coalescence, chaque événement `scroll` produisait un layout forcé et deux appels
// Capacitor ; on vérifie qu'une seule relance part par image.
const bridge = vi.hoisted(() => ({
  showPreview: vi.fn(async () => true),
  stopPreview: vi.fn(async () => {}),
  hidePreview: vi.fn(async () => {}),
  onPreviewState: vi.fn((_listener: (state: string) => void) => () => {}),
}));
vi.mock('@/utils/nativePlayer', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/nativePlayer')>(),
  NativePlayerBridge: bridge,
}));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ getTotalSize: () => 108, getVirtualItems: () => [{ index: 0, start: 44 }] }) }));
vi.mock('@/utils/reminders', () => ({ getReminders: async () => [], addReminder: vi.fn(), removeReminder: vi.fn(), REMINDERS_EVENT: 'reminders-updated' }));

import { EPGGrid } from '@/components/EPGGrid';

const channel: Channel = { id: 'a', name: 'Chaîne test', url: 'https://example.test/a' };
const program = () => {
  const now = Date.now();
  return { id: 'p', channelId: 'a', title: 'Le journal', startTime: new Date(now - 60_000), endTime: new Date(now + 600_000) };
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.values(bridge).forEach(fn => fn.mockClear());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, width: 320, height: 180, right: 330, bottom: 190, x: 10, y: 10, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('relance l’aperçu une seule fois par image, quel que soit le nombre d’événements de défilement', async () => {
  await act(async () => {
    render(<EPGGrid channels={[channel]} epgData={{ a: [program()] }} onSelectChannel={() => {}} tvMode preview />);
  });
  // Survol d'une émission : l'aperçu part après le délai d'arrêt.
  const cell = screen.getByRole('button', { name: /^Le journal,/ });
  await act(async () => { cell.focus(); });
  await act(async () => { vi.advanceTimersByTime(800); });
  expect(bridge.showPreview).toHaveBeenCalledTimes(1);

  bridge.showPreview.mockClear();
  await act(async () => {
    for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
  });
  expect(bridge.showPreview).toHaveBeenCalledTimes(1);
});

it('le défilement ne rappelle pas le pont quand aucun aperçu n’est affiché', async () => {
  await act(async () => {
    render(<EPGGrid channels={[channel]} epgData={{ a: [program()] }} onSelectChannel={() => {}} tvMode preview />);
  });
  bridge.showPreview.mockClear();
  await act(async () => {
    fireEvent.scroll(window);
    vi.advanceTimersByTime(20);
  });
  expect(bridge.showPreview).not.toHaveBeenCalled();
});
