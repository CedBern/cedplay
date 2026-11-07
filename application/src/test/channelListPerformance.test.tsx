import 'fake-indexeddb/auto';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChannelList } from '@/components/ChannelList';
import { getMeta, setMeta } from '@/utils/idb';

afterEach(cleanup);
it('limite les cartes montées même si une ancienne préférence désactive la virtualisation', async () => {
  await Promise.all([
    setMeta('virtualizationEnabled', false), setMeta('selectedGroup', 'all'),
    setMeta('qualityFilter', 'all'), setMeta('favorites', []), setMeta('playHistory', []),
  ]);
  const channels = Array.from({ length: 1000 }, (_, i) => ({ id: `perf-${i}`, name: `Chaîne ${i}`, url: `https://example.test/${i}.ts` }));
  const { container } = render(<ChannelList groups={[{ name: 'Test', channels }]} onChannelSelect={() => {}} />);
  await waitFor(() => expect(container.querySelector('[data-virtual-root]')).not.toBeNull());
  expect(container.querySelectorAll('[data-channel-id]').length).toBeLessThan(100);
  expect(await getMeta('virtualizationEnabled')).toBe(false);
});
