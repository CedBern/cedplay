import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelList } from '@/components/ChannelList';
import { getMeta, setMeta } from '@/utils/idb';
import { Channel } from '@/types/channel';

afterEach(cleanup);
const channels: Channel[] = [
  { id: 'a', name: 'Télé Québec', url: 'https://example.test/a', group: 'Test', quality: 'HD' },
  { id: 'b', name: 'Film du soir', url: 'https://example.test/b', group: 'Test', quality: 'SD' },
];
it('relit les filtres sans les écraser et filtre aussi la vue Récentes', async () => {
  await Promise.all([
    setMeta('qualityFilter', 'HD'), setMeta('selectedGroup', 'recent'), setMeta('favorites', []),
    setMeta('playHistory', [{ channelId: 'a', ts: 2 }, { channelId: 'b', ts: 1 }]),
  ]);
  render(<ChannelList groups={[{ name: 'Test', channels }]} onChannelSelect={() => {}} />);
  await screen.findByRole('heading', { name: /^Télé Québec/ });
  expect(screen.queryByRole('heading', { name: /^Film du soir/ })).toBeNull();
  expect(await getMeta('qualityFilter')).toBe('HD');
  expect(await getMeta('selectedGroup')).toBe('recent');
  await userEvent.type(screen.getByRole('textbox', { name: 'Rechercher une chaîne' }), 'inexistant');
  await waitFor(() => expect(screen.queryByRole('heading', { name: /^Télé Québec/ })).toBeNull());
});
