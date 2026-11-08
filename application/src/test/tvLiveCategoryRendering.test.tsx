import 'fake-indexeddb/auto';
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Channel } from '@/types/channel';

const renders = vi.hoisted(() => ({ categoryIcon: vi.fn() }));
vi.mock('lucide-react', async importOriginal => {
  const icons = await importOriginal<typeof import('lucide-react')>();
  return {
    ...icons,
    Lock: (props: ComponentProps<typeof icons.Lock>) => {
      renders.categoryIcon();
      return <icons.Lock {...props} />;
    },
  };
});

import { TvLiveScreen } from '@/components/TvLiveScreen';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.add('remote-navigation');
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('remote-navigation');
});

it('ne re-rend pas les 269 catégories inchangées pendant vingt déplacements dans les chaînes', async () => {
  const channels: Channel[] = Array.from({ length: 40 }, (_, index) => ({
    id: `live-${index}`, name: `Chaîne ${index}`, url: `https://example.test/${index}`, group: 'Direct',
  }));
  const lockedGroups = Array.from({ length: 269 }, (_, index) => `Groupe ${index}`);
  const groups = [
    { name: 'Direct', channels },
    ...lockedGroups.map(name => ({ name, channels: [] })),
  ];
  await act(async () => {
    render(<TvLiveScreen playlistId="category-rendering" groups={groups} lockedGroups={lockedGroups} favoriteIds={[]} onPlay={() => {}} />);
  });
  expect((document.activeElement as HTMLElement).dataset.tvRow).toBe('0');
  expect(renders.categoryIcon.mock.calls.length).toBeGreaterThanOrEqual(269);
  renders.categoryIcon.mockClear();

  for (let index = 0; index < 20; index++) {
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  }

  expect((document.activeElement as HTMLElement).dataset.tvRow).toBe('20');
  expect(renders.categoryIcon).not.toHaveBeenCalled();
});
