import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EPGGrid } from '@/components/EPGGrid';

vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ getTotalSize: () => 108, getVirtualItems: () => [{ index: 0, start: 44 }] }) }));
vi.mock('@/utils/reminders', () => ({ getReminders: async () => [], addReminder: vi.fn(), removeReminder: vi.fn(), REMINDERS_EVENT: 'reminders-updated' }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const channel = { id: 'a', name: 'Chaîne test', url: 'https://example.test/a' };
const press = (el: HTMLElement, key = 'Enter') => { fireEvent.keyDown(el, { key }); fireEvent.keyUp(el, { key }); };

it.each(['Enter', ' '])('la touche %s sur une cloche ne lance pas le direct ; sur une émission à venir elle ouvre sa fiche', async key => {
  const onSelect = vi.fn();
  const now = Date.now();
  await act(async () => { render(<EPGGrid channels={[channel]} epgData={{ a: [{ id: 'p', channelId: 'a', title: 'Émission à venir', startTime: new Date(now + 60_000), endTime: new Date(now + 120_000) }] }} onSelectChannel={onSelect} />); });
  fireEvent.keyDown(screen.getByRole('button', { name: /Rappel pour/ }), { key });
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => { press(screen.getByRole('button', { name: /^Émission à venir,/ }), key); });
  expect(onSelect).not.toHaveBeenCalled();
  expect(await screen.findByRole('dialog', { name: 'Émission à venir' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Regarder la chaîne' }));
  expect(onSelect).toHaveBeenCalledWith(channel);
});

it('OK sur l’émission en cours lance la chaîne ; OK maintenu ouvre la fiche', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSelect = vi.fn();
  const now = Date.now();
  await act(async () => { render(<EPGGrid channels={[channel]} epgData={{ a: [{ id: 'p', channelId: 'a', title: 'Le journal', description: 'Les titres du jour.', startTime: new Date(now - 60_000), endTime: new Date(now + 600_000) }] }} onSelectChannel={onSelect} />); });
  const cell = screen.getByRole('button', { name: /^Le journal,/ });
  press(cell);
  expect(onSelect).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(cell, { key: 'Enter' });
  await act(async () => { vi.advanceTimersByTime(700); });
  fireEvent.keyDown(cell, { key: 'Enter', repeat: true });
  fireEvent.keyUp(cell, { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('dialog', { name: 'Le journal' })).toBeVisible();
  expect(screen.getByText('Les titres du jour.')).toBeVisible();
  // L'enregistrement n'est proposé que sur Android ; la fiche le dit au lieu d'un bouton inerte.
  expect(screen.getByText(/disponible dans l’application Android/)).toBeVisible();
});

it('après OK maintenu relâché dans la fiche puis fermeture, OK relance la chaîne', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSelect = vi.fn();
  const now = Date.now();
  await act(async () => { render(<EPGGrid channels={[channel]} epgData={{ a: [{ id: 'p', channelId: 'a', title: 'Le journal', startTime: new Date(now - 60_000), endTime: new Date(now + 600_000) }] }} onSelectChannel={onSelect} />); });
  const cell = screen.getByRole('button', { name: /^Le journal,/ });
  act(() => { cell.focus(); });
  fireEvent.keyDown(cell, { key: 'Enter' });
  await act(async () => { vi.advanceTimersByTime(700); });
  const dialog = await screen.findByRole('dialog', { name: 'Le journal' });
  // Le relâchement arrive dans la fiche, qui a pris le focus.
  fireEvent.keyUp(dialog, { key: 'Enter' });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onSelect).not.toHaveBeenCalled();
  press(cell);
  expect(onSelect).toHaveBeenCalledWith(channel);
});

it('cherche une émission dans le guide et ouvre sa fiche', async () => {
  const now = Date.now();
  const other = { id: 'b', name: 'Autre', url: 'https://example.test/b' };
  await act(async () => {
    render(<EPGGrid channels={[channel, other]} onSelectChannel={() => {}} epgData={{
      a: [{ id: 'p1', channelId: 'a', title: 'Koh-Lanta', startTime: new Date(now + 3_600_000), endTime: new Date(now + 7_200_000) }],
      b: [{ id: 'p2', channelId: 'b', title: 'Météo', description: 'Après Koh Lanta', startTime: new Date(now - 60_000), endTime: new Date(now + 60_000) }],
    }} />);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Rechercher une émission' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Émission à rechercher' }), { target: { value: 'koh lanta' } });
  const results = await screen.findByRole('list', { name: 'Résultats' });
  await waitFor(() => expect(results.querySelectorAll('li')).toHaveLength(2));
  // En direct d'abord (trouvée par son résumé), puis à venir (trouvée par son titre).
  const items = Array.from(results.querySelectorAll('li')).map(li => li.textContent);
  expect(items[0]).toContain('Météo');
  expect(items[0]).toContain('En direct');
  expect(items[1]).toContain('Koh-Lanta');
  fireEvent.click(within(results).getByText('Koh-Lanta'));
  expect(await screen.findByRole('dialog', { name: 'Koh-Lanta' })).toBeVisible();
});
