import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChannelList } from '@/components/ChannelList';
import { TvLiveScreen } from '@/components/TvLiveScreen';
import { setMeta } from '@/utils/idb';
import type { ChannelGroup } from '@/types/channel';

const groups: ChannelGroup[] = ['Sport', '01 Films', 'France', '✪ Divers'].map((name, index) => ({
  name,
  channels: [{ id: `ordered-${index}`, name: `Programme ${index}`, group: name, url: `https://example.test/${index}` }],
}));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

it('TV : Toutes et Favoris précèdent les outils ; les catégories gardent leur ordre d’origine et filtrent', () => {
  const play = vi.fn();
  render(<TvLiveScreen playlistId="category-order-tv" groups={groups} favoriteIds={['ordered-2']} onPlay={play} onSearch={() => {}} onGuide={() => {}} />);
  const categories = [...document.querySelectorAll<HTMLButtonElement>('[data-tv-cat]')];
  expect(categories.slice(0, 2).map(button => button.textContent)).toEqual(['Toutes4', 'Favoris1']);
  expect(categories.slice(-2).map(button => button.textContent)).toEqual(['Rechercher', 'Guide TV']);
  expect(categories.filter(button => groups.some(group => button.textContent === `${group.name}1`)).map(button => button.textContent))
    .toEqual(['Sport1', '01 Films1', 'France1', '✪ Divers1']);

  fireEvent.click(screen.getByRole('button', { name: /^Toutes/ }));
  expect(document.querySelectorAll('[data-channel-row-id]')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: /^Favoris/ }));
  expect(document.querySelectorAll('[data-channel-row-id]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '3. Programme 2' }));
  expect(play).toHaveBeenCalledWith(groups[2].channels[0]);
  fireEvent.click(screen.getByRole('button', { name: /^01 Films/ }));
  expect(document.querySelectorAll('[data-channel-row-id]')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '2. Programme 1' })).toBeVisible();
});

it('mobile : les catégories numérotées ou françaises ne passent pas devant l’ordre de la liste', async () => {
  await setMeta('favorites', ['ordered-2']);
  render(<ChannelList playlistId="category-order-mobile" groups={groups} onChannelSelect={() => {}} />);
  await screen.findByRole('heading', { name: 'Programme 0' });
  const tabs = screen.getAllByRole('tab');
  expect(tabs.slice(0, 2).map(tab => tab.textContent)).toEqual(['Toutes4', 'Favoris1']);
  expect(tabs.slice(-4).map(tab => tab.textContent)).toEqual(groups.map(group => group.name));
  await userEvent.click(screen.getByRole('tab', { name: /^Favoris/ }));
  expect(await screen.findByRole('heading', { name: 'Programme 2' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Programme 0' })).toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: /^01 Films/ }));
  expect(await screen.findByRole('heading', { name: 'Programme 1' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Programme 2' })).toBeNull();
});
