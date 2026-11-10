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
  // Rectangles réalistes : le cadre d'aperçu est à droite, la case à gauche ; sinon
  // le test de recouvrement croirait que l'aperçu masque l'émission ciblée.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = this.hasAttribute('data-guide-preview')
      ? { left: 700, top: 60, width: 256, height: 144 }
      : this.hasAttribute('data-program-start')
        ? { left: 220, top: 100, width: 380, height: 56 }
        : { left: 0, top: 0, width: 960, height: 300 };
    return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) } as DOMRect;
  });
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
  // Le cadre est réservé dans le bandeau dès l'ouverture ; le 16:9 est porté par
  // le style (l'utilitaire `aspect-video` n'existe pas dans le CSS produit).
  expect(document.querySelector<HTMLElement>('[data-guide-preview]')?.style.aspectRatio).toBe('16 / 9');
  // Le flux ne démarre qu'avec une émission ciblée.
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

it('une émission à venir ne lance pas le direct : le cadre annonce son heure', async () => {
  const now = Date.now();
  const future = { id: 'f', channelId: 'a', title: 'Film du soir', startTime: new Date(now + 3_600_000), endTime: new Date(now + 5_400_000) };
  await act(async () => {
    render(<EPGGrid channels={[channel]} epgData={{ a: [program(), future] }} onSelectChannel={() => {}} tvMode preview />);
  });
  const cell = screen.getByRole('button', { name: /^Film du soir,/ });
  await act(async () => { cell.focus(); });
  await act(async () => { vi.advanceTimersByTime(800); });
  // Le flux de la chaîne montrerait un autre programme que celui affiché dans le bandeau.
  expect(bridge.showPreview).not.toHaveBeenCalled();
  expect(screen.getByText('Programme à venir')).toBeVisible();
  expect(screen.getByText(/^À \d/)).toBeVisible();
  // Le bandeau annonce l'émission à venir sans progression ni temps restant.
  expect(screen.getByText('À venir')).toBeVisible();
  expect(screen.queryByText(/^reste /)).toBeNull();
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
