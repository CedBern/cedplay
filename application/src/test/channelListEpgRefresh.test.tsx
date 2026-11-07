import 'fake-indexeddb/auto';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelList } from '@/components/ChannelList';
import { setMeta } from '@/utils/idb';
import type { EPGData } from '@/types/epg';

afterEach(cleanup);

/** Les cartes sont mémoïsées : sans horloge, la zone EPG resterait figée sur
 * l'émission du premier rendu même après la fin programmée de celle-ci. */
it("fait passer la carte à l'émission suivante quand l'horloge franchit son début", async () => {
  // Uniquement l'intervalle et l'horloge : fake-indexeddb doit garder ses vraisTimers/microtasks.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  try {
    // 11:59:30 : « Émission A » (11:30–12:00) est en cours, « Émission B » (12:00–12:30) suit.
    vi.setSystemTime(new Date(2026, 10, 7, 11, 59, 30));
    await Promise.all([
      setMeta('virtualizationEnabled', false), setMeta('selectedGroup', 'all'),
      setMeta('qualityFilter', 'all'), setMeta('favorites', []), setMeta('playHistory', []),
    ]);
    const channels = [{ id: 'epg-clock', name: 'Chaîne horloge', url: 'https://example.test/clock.ts' }];
    const epgData: EPGData = {
      'epg-clock': [
        { id: 'p1', channelId: 'epg-clock', title: 'Émission A', startTime: new Date(2026, 10, 7, 11, 30), endTime: new Date(2026, 10, 7, 12, 0) },
        { id: 'p2', channelId: 'epg-clock', title: 'Émission B', startTime: new Date(2026, 10, 7, 12, 0), endTime: new Date(2026, 10, 7, 12, 30) },
      ],
    };
    const { container } = render(
      <ChannelList groups={[{ name: 'Test', channels }]} epgData={epgData} onChannelSelect={() => {}} />,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(container.textContent).toContain('Émission A');
    expect(container.textContent).toContain('11:30');
    expect(container.textContent).not.toContain('Émission B');

    // 40 s plus tard (12:00:10) : l'horloge 30 s a retiqué après la fin d'« Émission A »,
    // la carte mémoïsée doit afficher la suivante sans autre changement de prop.
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(container.textContent).toContain('Émission B');
    expect(container.textContent).toContain('12:00');
    expect(container.textContent).not.toContain('Émission A');
  } finally {
    vi.useRealTimers();
  }
});
