import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalSearchDialog } from '@/components/GlobalSearchDialog';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import type { Channel, PlaylistInfo } from '@/types/channel';

afterEach(cleanup);

const channels: Channel[] = [
  { id: '1', name: 'TF1 HD', url: 'https://example.test/tf1', group: 'France', quality: 'HD' },
  { id: '2', name: 'France 2 FHD', url: 'https://example.test/fr2', group: 'France', quality: 'FHD' },
  { id: '3', name: 'Canal+ Sport', url: 'https://example.test/cplus', group: 'Sport', quality: 'HD' },
];

const testPlaylist: PlaylistInfo = {
  id: 'test-playlist',
  name: 'Test Playlist',
  channels,
  groups: [{ name: 'France', channels: [channels[0], channels[1]] }, { name: 'Sport', channels: [channels[2]] }],
};

it('affiche les suggestions populaires quand la recherche est vide', () => {
  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  expect(screen.getByText('Recherche unifiée')).toBeTruthy();
  expect(screen.getByText('Recherches populaires :')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'TF1' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Netflix' })).toBeTruthy();
});

it('recherche et sélectionne une chaîne en direct', async () => {
  const onSelectChannel = vi.fn();
  const onOpenChange = vi.fn();
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={onOpenChange}
      playlist={testPlaylist}
      onSelectChannel={onSelectChannel}
      onSelectTab={() => {}}
    />
  );

  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  await user.type(input, 'France 2');

  const channelBtn = await screen.findByRole('button', { name: /France 2 FHD/ });
  expect(channelBtn).toBeTruthy();

  await user.click(channelBtn);
  expect(onSelectChannel).toHaveBeenCalledWith(channels[1]);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('trouve une plateforme de streaming et déclenche openWeb', async () => {
  const openWebSpy = vi.spyOn(NativePlayerBridge, 'openWeb').mockResolvedValue(true);
  const onOpenChange = vi.fn();
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={onOpenChange}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  await user.type(input, 'Netflix');

  const netflixBtn = await screen.findByRole('button', { name: /Netflix/ });
  expect(netflixBtn).toBeTruthy();

  await user.click(netflixBtn);
  // Application officielle d'abord (allowAppHome), sinon navigateur : paquets transmis au pont natif.
  expect(openWebSpy).toHaveBeenCalledWith('https://www.netflix.com', undefined, ['com.netflix.mediaclient', 'com.netflix.ninja'], true);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('affiche un message quand aucun résultat ne correspond', async () => {
  const user = userEvent.setup();

  render(
    <GlobalSearchDialog
      open={true}
      onOpenChange={() => {}}
      playlist={testPlaylist}
      onSelectChannel={() => {}}
      onSelectTab={() => {}}
    />
  );

  const input = screen.getByRole('textbox', { name: 'Rechercher' });
  await user.type(input, 'xyzintrouvable123');

  expect(await screen.findByText(/Aucun résultat pour « xyzintrouvable123 »/)).toBeTruthy();
});
