import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelList } from '@/components/ChannelList';
import { getMeta, setMeta } from '@/utils/idb';
import type { Channel } from '@/types/channel';

afterEach(cleanup);
const channels: Channel[] = [
  { id: 'public-a', name: 'Info', url: 'https://example.test/a', group: 'France', quality: 'HD' },
  { id: 'public-b', name: 'Culture', url: 'https://example.test/b', group: 'France', quality: '4K' },
];
const groups = [{ name: 'France', channels }];

it('une nouvelle liste ne reprend pas le filtre 4K global, conserve ses propres filtres et les efface', async () => {
  await setMeta('qualityFilter', '4K');
  const view = render(<ChannelList playlistId="public-remote" groups={groups} onChannelSelect={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'Info HD' })).toBeVisible();
  expect(screen.getByText('2 chaînes affichées sur 2')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '4K' }));
  await waitFor(async () => expect(await getMeta('channelFilters:public-remote')).toEqual({ quality: '4K', group: 'all' }));
  expect(screen.queryByRole('heading', { name: 'Info HD' })).toBeNull();
  view.rerender(<ChannelList playlistId="other-remote" groups={groups} onChannelSelect={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'Info HD' })).toBeVisible();
  view.rerender(<ChannelList playlistId="public-remote" groups={groups} onChannelSelect={() => {}} />);
  await screen.findByText('1 chaîne affichée sur 2');
  await userEvent.click(screen.getByRole('button', { name: 'Effacer les filtres' }));
  expect(await screen.findByRole('heading', { name: 'Info HD' })).toBeVisible();
});

it('haut/bas suit la même action sur les chaînes et OK ne déclenche qu’une seule lecture', async () => {
  const select = vi.fn();
  render(<ChannelList playlistId="remote-rows" groups={groups} onChannelSelect={select} />);
  await screen.findByRole('heading', { name: 'Info HD' });
  const first = screen.getByRole('button', { name: 'Lire Info' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  const second = screen.getByRole('button', { name: 'Lire Culture' });
  expect(second).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(channels[1]);
  fireEvent.keyDown(second, { key: 'ArrowUp' });
  expect(first).toHaveFocus();
});
