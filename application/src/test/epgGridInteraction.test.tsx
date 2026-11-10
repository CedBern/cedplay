import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EPGGrid } from '@/components/EPGGrid';
import { formatTime } from '@/utils/epgXmltv';

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

it('la flèche gauche ouvre l’émission précédente au lieu du nom de la chaîne', async () => {
  const now = Date.now();
  await act(async () => {
    render(<EPGGrid channels={[channel]} onSelectChannel={() => {}} epgData={{ a: [
      { id: 'avant', channelId: 'a', title: 'Émission précédente', startTime: new Date(now - 3_600_000), endTime: new Date(now - 1_800_000) },
      { id: 'encours', channelId: 'a', title: 'Émission en cours', startTime: new Date(now - 1_800_000), endTime: new Date(now + 1_800_000) },
    ] }} />);
  });
  const current = screen.getByRole('button', { name: /^Émission en cours,/ });
  act(() => { current.focus(); });
  fireEvent.keyDown(current, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Émission précédente,/ }));
  // La colonne des chaînes reste visible mais ne capte plus le focus télécommande.
  expect(screen.getByTitle('Chaîne test')).toHaveAttribute('tabindex', '-1');
});

it('garde le titre lisible au bord de la colonne quand l’émission a commencé avant la vue', async () => {
  const now = Date.now();
  await act(async () => { render(<EPGGrid channels={[channel]} onSelectChannel={() => {}} epgData={{ a: [
    { id: 'long', channelId: 'a', title: 'Programmes de la nuit', startTime: new Date(now - 7_200_000), endTime: new Date(now + 7_200_000) },
  ] }} />); });
  const label = screen.getByRole('button', { name: /^Programmes de la nuit,/ }).querySelector(':scope > div');
  expect(label).toHaveClass('sticky');
  expect((label as HTMLElement).style.left).toBe('208px'); // colonne 200 px + 8 px de padding
});

it('le bandeau TV réunit Liste/Grille/Lecteur, l’aperçu et l’émission ciblée au-dessus de la grille', async () => {
  const now = Date.now();
  const epgData = { a: [
    { id: 'encours', channelId: 'a', title: 'Émission en cours', startTime: new Date(now - 60_000), endTime: new Date(now + 600_000) },
  ] };
  await act(async () => {
    render(<EPGGrid channels={[channel]} currentChannel={channel} epgData={epgData} guideState={{ data: epgData, status: 'ready', fetchedAt: now }} onSelectChannel={() => {}} tvMode preview toolbar={<button type="button">Liste</button>} />);
  });
  const band = document.querySelector<HTMLElement>('[data-guide-band]');
  expect(band).not.toBeNull();
  expect(within(band!).getByRole('button', { name: 'Liste' })).toBeVisible();
  expect(within(band!).getByRole('button', { name: 'Actualiser' })).toBeVisible();
  // L'aperçu vit dans le bandeau, pas au-dessus des programmes.
  expect(band).toContainElement(document.querySelector<HTMLElement>('[data-guide-preview]'));
  // Même sans cibler une case, le bandeau annonce la chaîne, le direct et l'émission,
  // avec ses horaires, sa progression et le temps restant.
  expect(within(band!).getByText('Émission en cours')).toBeVisible();
  expect(within(band!).getByText('Chaîne test')).toBeVisible();
  expect(within(band!).getByText('En direct')).toBeVisible();
  expect(within(band!).getByText(`${formatTime(new Date(now - 60_000))} – ${formatTime(new Date(now + 600_000))}`)).toBeVisible();
  expect(within(band!).getByText(/^reste \d+ min$/)).toBeVisible();
});

it('la flèche bas depuis Liste dans le bandeau entre par l’émission en cours', async () => {
  const now = Date.now();
  await act(async () => {
    render(<EPGGrid channels={[channel]} onSelectChannel={() => {}} tvMode toolbar={<button type="button">Liste</button>} epgData={{ a: [
      { id: 'avant', channelId: 'a', title: 'Émission précédente', startTime: new Date(now - 3_600_000), endTime: new Date(now - 1_800_000) },
      { id: 'encours', channelId: 'a', title: 'Émission en cours', startTime: new Date(now - 1_800_000), endTime: new Date(now + 1_800_000) },
    ] }} />);
  });
  const liste = screen.getByRole('button', { name: 'Liste' });
  act(() => { liste.focus(); });
  fireEvent.keyDown(liste, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Émission en cours,/ }));
});

it('la flèche gauche sur la première émission reste sur place', async () => {
  const now = Date.now();
  await act(async () => {
    render(<EPGGrid channels={[channel]} onSelectChannel={() => {}} epgData={{ a: [
      { id: 'seule', channelId: 'a', title: 'Première émission', startTime: new Date(now - 3_600_000), endTime: new Date(now + 1_800_000) },
    ] }} />);
  });
  const first = screen.getByRole('button', { name: /^Première émission,/ });
  act(() => { first.focus(); });
  fireEvent.keyDown(first, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(first);
});

it('la flèche bas depuis la barre d’outils entre par l’émission en cours', async () => {
  const now = Date.now();
  await act(async () => {
    render(<EPGGrid channels={[channel]} onSelectChannel={() => {}} epgData={{ a: [
      { id: 'avant', channelId: 'a', title: 'Émission précédente', startTime: new Date(now - 3_600_000), endTime: new Date(now - 1_800_000) },
      { id: 'encours', channelId: 'a', title: 'Émission en cours', startTime: new Date(now - 1_800_000), endTime: new Date(now + 1_800_000) },
    ] }} />);
  });
  const toolbar = screen.getByRole('button', { name: 'Rechercher une émission' });
  act(() => { toolbar.focus(); });
  fireEvent.keyDown(toolbar, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Émission en cours,/ }));
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
