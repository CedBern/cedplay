import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelList } from '@/components/ChannelList';
import type { Channel, ChannelGroup } from '@/types/channel';

// jsdom n'a pas de dimensions : le virtualiseur réel ne monte aucune ligne. On lui fait
// rendre une ligne fixe pour pouvoir observer le reflow du maintien en vue.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 108,
    getVirtualItems: () => [{ index: 0, start: 0 }],
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
  defaultRangeExtractor: () => [0],
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const channels: Channel[] = [
  { id: 'a', name: 'Télé Québec', url: 'https://example.test/a', group: 'Test' },
  { id: 'b', name: 'Film du soir', url: 'https://example.test/b', group: 'Test' },
];
const freshGroups = (): ChannelGroup[] => [{ name: 'Test', channels }];
const searchBox = () => screen.getByRole('textbox', { name: 'Rechercher une chaîne' });

it('conserve la recherche quand les groupes changent d’identité (rafraîchissement du guide)', async () => {
  const { rerender } = render(<ChannelList groups={freshGroups()} onChannelSelect={() => {}} />);
  await screen.findByRole('heading', { name: /^Télé Québec/ });

  fireEvent.change(searchBox(), { target: { value: 'québec' } });
  await waitFor(() => expect(screen.queryByRole('heading', { name: /^Film du soir/ })).toBeNull());

  // Le parent reconstruit son tableau de groupes à chaque mise à jour du guide.
  rerender(<ChannelList groups={freshGroups()} onChannelSelect={() => {}} />);

  // Laisser la ré-hydratation des préférences se terminer avant de conclure.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(searchBox()).toHaveValue('québec');
  expect(screen.queryByRole('heading', { name: /^Film du soir/ })).toBeNull();
});

it('remet la recherche à zéro quand on change de liste', async () => {
  const { rerender } = render(<ChannelList playlistId="p1" groups={freshGroups()} onChannelSelect={() => {}} />);
  await screen.findByRole('heading', { name: /^Télé Québec/ });
  fireEvent.change(searchBox(), { target: { value: 'québec' } });

  rerender(<ChannelList playlistId="p2" groups={freshGroups()} onChannelSelect={() => {}} />);

  await waitFor(() => expect(searchBox()).toHaveValue(''));
});

it('ne mesure plus le viewport à chaque frappe dans une liste virtualisée', async () => {
  const many: Channel[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `perf-${i}`, name: `Chaîne ${i}`, url: `https://example.test/${i}.ts`, group: 'Test',
  }));
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  const { container } = render(<ChannelList groups={[{ name: 'Test', channels: many }]} onChannelSelect={() => {}} />);
  await waitFor(() => expect(container.querySelector('[data-channel-id] button')).not.toBeNull());

  // Le focus dans la liste déclenche la restauration/le maintien en vue une fois…
  const firstButton = container.querySelector<HTMLButtonElement>('[data-channel-id] button')!;
  await act(async () => { firstButton.focus(); });
  spy.mockClear();

  // …mais la frappe ne doit plus relancer le parcours du DOM et le reflow.
  fireEvent.change(searchBox(), { target: { value: 'c' } });
  fireEvent.change(searchBox(), { target: { value: 'ch' } });
  fireEvent.change(searchBox(), { target: { value: 'cha' } });
  expect(spy).not.toHaveBeenCalled();
});
