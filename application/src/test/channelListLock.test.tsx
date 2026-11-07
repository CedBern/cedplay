import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelList } from '@/components/ChannelList';
import { setMeta } from '@/utils/idb';
import type { Channel } from '@/types/channel';

afterEach(cleanup);

const normal: Channel = { id: 'a', name: 'Télé Québec', url: 'https://example.test/a', group: 'Test', quality: 'HD' };
const adulte: Channel = { id: 'x', name: 'Chaîne adulte', url: 'https://example.test/x', group: 'XXX', quality: 'HD' };

it('masque les chaînes d’un groupe verrouillé et demande le code à la sélection', async () => {
  await setMeta('playHistory', []);
  const onLockedGroupSelect = vi.fn();
  render(
    <ChannelList
      groups={[{ name: 'Test', channels: [normal] }, { name: 'XXX', channels: [adulte] }]}
      onChannelSelect={() => {}}
      lockedGroups={['XXX']}
      unlocked={false}
      onLockedGroupSelect={onLockedGroupSelect}
    />,
  );

  // La chaîne du groupe XXX est masquée de la vue « Toutes »
  await screen.findByRole('heading', { name: /^Télé Québec/ });
  expect(screen.queryByRole('heading', { name: /Chaîne adulte/ })).toBeNull();

  // Sélectionner l'onglet verrouillé déclenche la demande de code
  await userEvent.click(screen.getByRole('tab', { name: /XXX/ }));
  expect(onLockedGroupSelect).toHaveBeenCalledWith('XXX');
});

it('affiche les chaînes verrouillées une fois déverrouillé', async () => {
  await setMeta('playHistory', []);
  render(
    <ChannelList
      groups={[{ name: 'Test', channels: [normal] }, { name: 'XXX', channels: [adulte] }]}
      onChannelSelect={() => {}}
      lockedGroups={['XXX']}
      unlocked
    />,
  );
  expect(await screen.findByRole('heading', { name: /Chaîne adulte/ })).toBeTruthy();
});
