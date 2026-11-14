import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { AudioBridge, NativePlayerBridge, buildNativeZap } from '@/utils/nativePlayer';
import {
  closeDesktopLiveSession,
  closeDesktopVodSession,
  openDesktopLiveSession,
  setDesktopRuntimeForTests,
  subscribeDesktopUi,
} from '@/utils/desktopBridge';
import { DesktopCinemaPlayer } from '@/components/DesktopCinemaPlayer';
import { attachDesktopMediaStream } from '@/utils/desktopMediaAttach';
import { searchTmdb } from '@/utils/tmdb';
import * as trakt from '@/utils/trakt';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/utils/desktopMediaAttach', () => ({
  attachDesktopMediaStream: vi.fn(() => ({ destroy: vi.fn() })),
}));

describe('Desktop audit of Android parity', () => {
  beforeEach(() => {
    localStorage.clear();
    setDesktopRuntimeForTests(true);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome Desktop audit');
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    closeDesktopLiveSession();
    await AudioBridge.stop();
    AudioBridge.resetForTests();
    setDesktopRuntimeForTests(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('control: ordinary web starts its actual HTML audio element', async () => {
    setDesktopRuntimeForTests(false);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    await AudioBridge.playEpisode({
      id: 'audit-web', feedUrl: 'https://audit.test/rss',
      audioUrl: 'https://audit.test/episode.mp3', title: 'Audit', podcastTitle: 'Audit',
    });
    expect(play).toHaveBeenCalledOnce();
  });

  it('starts actual HTML audio on Windows instead of reporting an Android-only failure', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    await AudioBridge.playEpisode({
      id: 'audit-desktop', feedUrl: 'https://audit.test/rss',
      audioUrl: 'https://audit.test/episode.mp3', title: 'Audit', podcastTitle: 'Audit',
    });
    expect({ playCalls: play.mock.calls.length, errors: vi.mocked(toast.error).mock.calls })
      .toEqual({ playCalls: 1, errors: [] });
    const audio = play.mock.contexts[0] as HTMLMediaElement;
    await AudioBridge.setSpeed(1.5);
    expect(audio.playbackRate).toBe(1.5);
    await AudioBridge.seekTo(15000);
    expect(audio.currentTime).toBe(15);
    await AudioBridge.pause();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await AudioBridge.resume();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('routes TMDB through Windows HTTP bridge when browser cross-origin requests are unavailable', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (url !== '/api/desktop/http') throw new TypeError('Browser cross-origin request blocked');
      const request = JSON.parse(String(options?.body));
      expect(request.url).toContain('https://api.themoviedb.org/3/search/movie');
      expect(request.headers.Authorization).toBe('Bearer synthetic.audit.token');
      expect(request.url).not.toContain('synthetic.audit.token');
      return new Response(JSON.stringify({ status: 200, data: { results: [] } }), { status: 200 });
    });
    await expect(searchTmdb('Desktop audit', '', 'movie', 'synthetic.audit.token')).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('cancels a pending TMDB desktop bridge request without waiting for the network timeout', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = searchTmdb('Desktop abort audit', '', 'movie', 'synthetic.abort.token', controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('subscribes the recordings UI to backend recording events even before LAN pairing is opened', () => {
    const eventSource = vi.fn(function () { return new EventTarget(); });
    vi.stubGlobal('EventSource', eventSource);
    const unsubscribe = subscribeDesktopUi(() => {});
    try {
      expect(eventSource).toHaveBeenCalledWith('/api/desktop/events');
    } finally {
      unsubscribe();
    }
  });

  it('does not invent watched time when a completed video reports zero played milliseconds', async () => {
    const scrobble = vi.spyOn(trakt, 'maybeScrobbleTrakt').mockResolvedValue(false);
    const pending = NativePlayerBridge.openVod('https://audit.test/film.mp4', 'Film audit', 'audit:film');
    closeDesktopVodSession({
      mediaId: 'audit:film', positionMs: 95000, durationMs: 100000, completed: true,
      progress: [{ mediaId: 'audit:film', positionMs: 95000, durationMs: 100000, completed: true, playedMs: 0 }],
    });
    await expect(pending).resolves.toBe(true);
    await vi.waitFor(() => expect(scrobble).toHaveBeenCalledOnce());
    expect(scrobble.mock.calls[0]?.[8]).toBe(0);
  });

  it('keeps the whole playlist available to previous-channel zapping on Windows', () => {
    const channels = Array.from({ length: 301 }, (_, i) => ({
      id: `audit-${i}`, name: `Chaîne audit ${i + 1}`, url: `https://audit.test/${i}.ts`,
    }));
    render(<DesktopCinemaPlayer />);
    act(() => {
      void openDesktopLiveSession(channels[0]!.url, channels[0]!.name, buildNativeZap(channels, channels[0]!));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chaîne précédente' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Lecture : Chaîne audit 301');
  });

  it('honours provider timezone when restarting the current Xtream program', async () => {
    const startMs = Date.parse('2026-11-13T19:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(startMs + 15 * 60000);
    render(<DesktopCinemaPlayer />);
    act(() => {
      void openDesktopLiveSession('https://audit.test/live.ts', 'Audit', {
        urls: ['https://audit.test/live.ts'], titles: ['Audit'], index: 0,
        epg: [[[startMs, startMs + 60 * 60000, 'Émission audit']]],
        catchup: [{
          template: 'https://audit.test/timeshift/{minutes}/{start}/1.ts',
          timezone: 'Europe/Paris', url: '', urlStart: 0, urlEnd: 0,
        }],
      });
    });
    fireEvent.click(screen.getByRole('button', { name: /Depuis le début/ }));
    const calls = vi.mocked(attachDesktopMediaStream).mock.calls;
    expect(calls[calls.length - 1]?.[1])
      .toBe('https://audit.test/timeshift/60/2026-11-13:20-00/1.ts');
  });
});
