import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesktopCinemaPlayer } from '@/components/DesktopCinemaPlayer';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
import { attachDesktopMediaStream } from '@/utils/desktopMediaAttach';
import { closeDesktopVodSession, openDesktopVodSession, setDesktopRuntimeForTests } from '@/utils/desktopBridge';
import { readUsageJournal } from '@/utils/usageJournal';

const hlsState = vi.hoisted(() => ({
  supported: false,
  options: {} as Record<string, unknown>,
  instance: null as null | { audioTrack: number; subtitleTrack: number; subtitleDisplay: boolean },
}));
vi.mock('hls.js', () => ({ default: class {
  static Events = { ERROR: 'error', AUDIO_TRACKS_UPDATED: 'audio', SUBTITLE_TRACKS_UPDATED: 'subtitle' };
  static isSupported() { return hlsState.supported; }
  audioTracks = [{ name: 'eng' }, { name: 'fra' }];
  subtitleTracks = [{ name: 'fra' }];
  audioTrack = 0;
  subtitleTrack = -1;
  subtitleDisplay = false;
  constructor(options: Record<string, unknown>) { hlsState.options = options; hlsState.instance = this; }
  on(event: string, callback: () => void) { if (event !== 'error') callback(); }
  loadSource() {}
  attachMedia() {}
  destroy() {}
} }));

describe('Independent desktop player audit: regression probes', () => {
  beforeEach(() => {
    setDesktopRuntimeForTests(true);
    localStorage.clear();
    hlsState.supported = false;
    hlsState.instance = null;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ durationSec: 1200, videoCodec: 'h264', audioCodec: 'aac' })));
  });
  afterEach(() => {
    cleanup();
    closeDesktopVodSession();
    setDesktopRuntimeForTests(null);
    vi.restoreAllMocks();
  });

  it('restores the resume position for HLS VOD when metadata arrives', async () => {
    const video = document.createElement('video');
    const handle = attachDesktopMediaStream(video, 'http://cdn.test/movie.m3u8', { live: false, startSec: 120 });
    await waitFor(() => expect(video.src).toContain('/api/desktop/proxy'));
    fireEvent.loadedMetadata(video);
    const actual = video.currentTime;
    handle.destroy();
    expect(actual).toBe(120);
  });

  it('removes pending resume metadata listeners when switching media before metadata', () => {
    const video = document.createElement('video');
    const first = attachDesktopMediaStream(video, 'http://cdn.test/first.mp4', { startSec: 120 });
    first.destroy();
    const second = attachDesktopMediaStream(video, 'http://cdn.test/second.mp4', { startSec: 0 });
    fireEvent.loadedMetadata(video);
    const actual = video.currentTime;
    second.destroy();
    expect(actual).toBe(0);
  });

  it('preserves a saved resume position when closed before the first timeupdate', async () => {
    render(<DesktopCinemaPlayer />);
    let resultPromise!: ReturnType<typeof openDesktopVodSession>;
    act(() => { resultPromise = openDesktopVodSession({ url: 'http://cdn.test/movie.mp4', title: 'Film', mediaId: 'film', startPositionMs: 120000 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Quitter la lecture' }));
    expect((await resultPromise)?.positionMs).toBe(120000);
  });

  it('keeps original VOD coordinates after an MP4 fails over to FFmpeg', async () => {
    render(<DesktopCinemaPlayer />);
    let resultPromise!: ReturnType<typeof openDesktopVodSession>;
    act(() => { resultPromise = openDesktopVodSession({ url: 'http://cdn.test/movie.mp4', title: 'Film', mediaId: 'film', startPositionMs: 120000 }); });
    const video = document.querySelector('video')!;
    fireEvent.error(video);
    expect(video.src).toContain('/api/desktop/transmux');
    expect(new URL(video.src).searchParams.get('start')).toBe('120');
    video.currentTime = 5;
    fireEvent.timeUpdate(video);
    fireEvent.click(screen.getByRole('button', { name: 'Quitter la lecture' }));
    expect((await resultPromise)?.positionMs).toBe(125000);
  });

  it('clears the previous episode duration when the next episode cannot be probed', async () => {
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify({ durationSec: String(input).includes('second') ? 0 : 1200 })));
    render(<DesktopCinemaPlayer />);
    let resultPromise!: ReturnType<typeof openDesktopVodSession>;
    act(() => { resultPromise = openDesktopVodSession({ url: 'http://cdn.test/first.mp4', title: 'Premier', mediaId: 'first', startPositionMs: 0, zap: { urls: ['http://cdn.test/first.mp4', 'http://cdn.test/second.mp4'], titles: ['Premier', 'Second'], ids: ['first', 'second'], index: 0 } }); });
    await waitFor(() => expect(screen.getByText('20:00')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Épisode suivant' }));
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 600 });
    fireEvent.durationChange(video);
    video.currentTime = 600;
    fireEvent.timeUpdate(video);
    fireEvent.ended(video);
    const result = await resultPromise;
    expect(result?.durationMs).toBe(600000);
    expect(result?.completed).toBe(true);
  });

  it('returns exact played time instead of allowing seeks to count as watched time', async () => {
    render(<DesktopCinemaPlayer />);
    let resultPromise!: ReturnType<typeof openDesktopVodSession>;
    act(() => { resultPromise = openDesktopVodSession({ url: 'http://cdn.test/movie.mp4', title: 'Film', mediaId: 'film', startPositionMs: 0, durationHintSec: 1200 }); });
    const video = document.querySelector('video')!;
    video.currentTime = 1190;
    fireEvent.timeUpdate(video);
    fireEvent.click(screen.getByRole('button', { name: 'Quitter la lecture' }));
    const result = await resultPromise;
    expect(result?.completed).toBe(true);
    expect(result?.progress?.[0]).toHaveProperty('playedMs', 0);
  });

  it('measures playing intervals independently of seeks, buffering and pauses', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const video = document.createElement('video');
    const handle = attachDesktopMediaStream(video, 'http://cdn.test/movie.mp4', { startSec: 120 });
    fireEvent.playing(video);
    now = 4000;
    fireEvent.waiting(video);
    now = 10000;
    video.currentTime = 1000;
    fireEvent.timeUpdate(video);
    expect(handle.getPlayedMs()).toBe(4000);
    fireEvent.playing(video);
    now = 11000;
    fireEvent.pause(video);
    expect(handle.getPlayedMs()).toBe(5000);
    handle.destroy();
  });

  it('selects alternate FFmpeg audio at the current absolute position', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ durationSec: 1200, audioTracks: [{ id: 0, label: 'eng' }, { id: 1, label: 'fra' }] })));
    const video = document.createElement('video');
    const tracks = vi.fn();
    const handle = attachDesktopMediaStream(video, 'http://cdn.test/movie.mkv', { startSec: 120, onAudioTracks: tracks });
    await waitFor(() => expect(handle.getAudioTracks?.()).toHaveLength(2));
    video.currentTime = 5;
    fireEvent.timeUpdate(video);
    handle.setAudioTrack?.(1);
    expect(new URL(video.src).searchParams.get('audioTrack')).toBe('1');
    expect(new URL(video.src).searchParams.get('start')).toBe('125');
    expect(handle.getCurrentTime()).toBe(125);
    handle.destroy();
  });

  it('preserves pause and playback rate when seeking in FFmpeg VOD', () => {
    const video = document.createElement('video');
    const handle = attachDesktopMediaStream(video, 'http://cdn.test/movie.mkv');
    video.playbackRate = 1.5;
    const plays = vi.mocked(video.play).mock.calls.length;
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    handle.seekTo(130);
    fireEvent.loadedMetadata(video);
    expect(video.playbackRate).toBe(1.5);
    expect(video.play).toHaveBeenCalledTimes(plays);
    expect(handle.getCurrentTime()).toBe(130);
    handle.destroy();
  });

  it('records Desktop VOD playing time in the Discover usage journal', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    render(<DesktopCinemaPlayer />);
    act(() => { void openDesktopVodSession({ url: 'http://cdn.test/movie.mp4', title: 'Film', mediaId: 'film', startPositionMs: 0 }); });
    const video = document.querySelector('video')!;
    fireEvent.playing(video);
    now = 7000;
    fireEvent.pause(video);
    expect((await readUsageJournal())[0]?.vod).toBe(7000);
  });

  it('exposes embedded textual subtitle tracks for playback', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ subtitleTracks: [{ id: 0, label: 'fra' }] })));
    const video = document.createElement('video');
    const handle = attachDesktopMediaStream(video, 'http://cdn.test/movie.mkv');
    await waitFor(() => expect(handle.getSubtitleTracks()).toEqual([{ id: 0, label: 'fra' }]));
    const url = handle.setSubtitleTrack(0)!;
    expect(new URL(url, 'http://localhost').searchParams.get('track')).toBe('0');
    expect(new URL(url, 'http://localhost').searchParams.get('uri')).toBe('http://cdn.test/movie.mkv');
    expect(handle.setSubtitleTrack(-1)).toBeNull();
    handle.destroy();
  });

  it('supports HLS resume plus its own audio and subtitle track selection', async () => {
    hlsState.supported = true;
    const video = document.createElement('video');
    const handle = attachDesktopMediaStream(video, 'http://cdn.test/movie.m3u8', { startSec: 120 });
    await waitFor(() => expect(hlsState.instance).not.toBeNull());
    expect(hlsState.options.startPosition).toBe(120);
    expect(handle.getAudioTracks?.()).toHaveLength(2);
    handle.setAudioTrack?.(1);
    expect(hlsState.instance?.audioTrack).toBe(1);
    expect(handle.getSubtitleTracks()).toEqual([{ id: 0, label: 'fra' }]);
    handle.setSubtitleTrack(0);
    expect(hlsState.instance?.subtitleTrack).toBe(0);
    expect(hlsState.instance?.subtitleDisplay).toBe(true);
    handle.setSubtitleTrack(-1);
    expect(hlsState.instance?.subtitleDisplay).toBe(false);
    handle.destroy();
  });

  it('loads an embedded subtitle selected in the actual VOD controls', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).startsWith('/api/desktop/subtitle')
      ? new Response('WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nSous-titre embarqué vérifié\n')
      : new Response(JSON.stringify({ durationSec: 1200, subtitleTracks: [{ id: 0, label: 'fra' }] })));
    render(<DesktopCinemaPlayer />);
    act(() => { void openDesktopVodSession({ url: 'http://cdn.test/movie.mkv', title: 'Film', mediaId: 'film', startPositionMs: 0 }); });
    const select = await screen.findByRole('combobox', { name: 'Piste de sous-titres' });
    fireEvent.change(select, { target: { value: '0' } });
    await screen.findByText('Sous-titre embarqué vérifié');
    fireEvent.change(select, { target: { value: '-1' } });
    await waitFor(() => expect(screen.queryByText('Sous-titre embarqué vérifié')).toBeNull());
  });

  it('shows an actionable VOD failure after both FFmpeg fallbacks fail', () => {
    render(<DesktopCinemaPlayer />);
    act(() => { void openDesktopVodSession({ url: 'http://cdn.test/movie.mp4', title: 'Film', mediaId: 'film', startPositionMs: 0 }); });
    const video = document.querySelector('video')!;
    fireEvent.error(video);
    fireEvent.error(video);
    fireEvent.error(video);
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de lire cette vidéo');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('seeks with ArrowRight and closes on Escape after subtitle switch with useRemoteNavigation active', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).startsWith('/api/desktop/subtitle')
      ? new Response('WEBVTT\n\n00:00:08.000 --> 00:00:25.000\nSous-titre embarqué vérifié\n')
      : new Response(JSON.stringify({ durationSec: 120, subtitleTracks: [{ id: 0, label: 'fra' }] })));
    function Host() {
      useRemoteNavigation();
      return <DesktopCinemaPlayer />;
    }
    render(<Host />);
    let closed = false;
    act(() => {
      void openDesktopVodSession({ url: 'http://cdn.test/movie.mkv', title: 'Film', mediaId: 'film', startPositionMs: 0 }).then(() => {
        closed = true;
      });
    });
    const select = await screen.findByRole('combobox', { name: 'Piste de sous-titres' });
    fireEvent.change(select, { target: { value: '0' } });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const slider = screen.getByRole('slider', { name: 'Position dans la vidéo' }) as HTMLInputElement;
    expect(Number(slider.value)).toBeGreaterThanOrEqual(10);
    await screen.findByText('Sous-titre embarqué vérifié');
    fireEvent.keyDown(select, { key: 'Escape' });
    await waitFor(() => expect(closed).toBe(true));
    expect(document.querySelector('[data-desktop-cinema-player]')).toBeNull();
  });
});
