import 'fake-indexeddb/auto';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelList } from '@/components/ChannelList';
import { setMeta } from '@/utils/idb';
import type { EPGData } from '@/types/epg';

afterEach(cleanup);

/** Les cartes sont mémoïsées : sans horloge, la zone EPG et sa barre de progression
 * resteraient figées sur l'état du premier rendu. */
it("actualise la progression en cours puis fait passer la carte mémoïsée à l'émission suivante", async () => {
  // Uniquement l'intervalle et l'horloge : fake-indexeddb doit garder ses vraisTimers/microtasks.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  try {
    // 11:45:00 : « Émission A » (11:30–12:00, 30 min) est à 50 %, « Émission B » (12:00–12:30) suit.
    vi.setSystemTime(new Date(2026, 10, 7, 11, 45, 0));
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
    const indicatorAt50 = container.querySelector('[role="progressbar"] > div') as HTMLElement | null;
    expect(indicatorAt50?.style.transform).toBe('translateX(-50%)');

    // 7 min 30 s plus tard (11:52:30) : toujours « Émission A », mais la progression passe à 75 %.
    await act(async () => { await vi.advanceTimersByTimeAsync(450_000); });
    expect(container.textContent).toContain('Émission A');
    const indicatorAt75 = container.querySelector('[role="progressbar"] > div') as HTMLElement | null;
    expect(indicatorAt75?.style.transform).toBe('translateX(-25%)');

    // 8 min plus tard (12:00:30) : l'horloge 30 s a franchi 12:00, « Émission B » prend le relais.
    await act(async () => { await vi.advanceTimersByTimeAsync(480_000); });
    expect(container.textContent).toContain('Émission B');
    expect(container.textContent).toContain('12:00');
    expect(container.textContent).not.toContain('Émission A');
  } finally {
    vi.useRealTimers();
  }
});