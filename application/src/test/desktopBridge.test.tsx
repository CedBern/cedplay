import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  closeDesktopLiveSession,
  closeDesktopMosaicSession,
  closeDesktopVodSession,
  isDesktopRuntime,
  openDesktopLiveSession,
  openDesktopMosaicSession,
  openDesktopVodSession,
  setDesktopRuntimeForTests,
  showDesktopPreview,
  stopDesktopPreview,
  syncDesktopReminders,
} from '@/utils/desktopBridge';
import { resolveTvMode } from '@/hooks/useTvMode';
import { LocalLibraryBridge, NativePlayerBridge, RecordingsBridge } from '@/utils/nativePlayer';
import { stalkerAvailable } from '@/utils/stalker';
import { pairingAvailable } from '@/utils/tvPairing';
import { lanSyncAvailable } from '@/utils/lanSync';
import { CORSProxy } from '@/utils/corsProxy';
import { probeStreams } from '@/utils/streamCheck';
import { DesktopLivePreview } from '@/components/DesktopLivePreview';
import { DesktopCinemaPlayer } from '@/components/DesktopCinemaPlayer';
import { DesktopMosaicPlayer } from '@/components/DesktopMosaicPlayer';

describe('Desktop Windows bridge & cinema overlays', () => {
  afterEach(() => {
    setDesktopRuntimeForTests(null);
    stopDesktopPreview();
    closeDesktopLiveSession();
    closeDesktopVodSession(null);
    closeDesktopMosaicSession();
    vi.restoreAllMocks();
  });

  it('unlocks TV mode, native bridges, pairing, LAN sync, and Stalker on desktop runtime', () => {
    setDesktopRuntimeForTests(false);
    expect(isDesktopRuntime()).toBe(false);
    expect(NativePlayerBridge.isAvailable()).toBe(false);

    setDesktopRuntimeForTests(true);
    expect(isDesktopRuntime()).toBe(true);
    expect(resolveTvMode('auto', false)).toBe(true);
    expect(resolveTvMode('mobile', false)).toBe(false);
    expect(NativePlayerBridge.isAvailable()).toBe(true);
    expect(LocalLibraryBridge.isAvailable()).toBe(true);
    expect(RecordingsBridge.isAvailable()).toBe(true);
    expect(stalkerAvailable()).toBe(true);
    expect(pairingAvailable()).toBe(true);
    expect(lanSyncAvailable()).toBe(true);
  });

  it('routes CORSProxy and probeStreams via local desktop HTTP server endpoints', async () => {
    setDesktopRuntimeForTests(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/desktop/http') {
        return new Response(JSON.stringify({ status: 200, url: 'http://test/list.m3u', headers: {}, data: '#EXTM3U\n' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/desktop/probe-streams') {
        return new Response(JSON.stringify({ results: [{ ok: true, status: 200 }, { ok: false, status: 404 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const m3u = await CORSProxy.fetchWithProxy('http://iptv.test/list.m3u');
    expect(m3u).toBe('#EXTM3U\n');
    const probes = await probeStreams(['http://a.test/1.ts', 'http://a.test/2.ts']);
    expect(probes).toEqual([{ ok: true, status: 200 }, { ok: false, status: 404 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('renders DesktopLivePreview at bounding rect and allows unmuting', () => {
    setDesktopRuntimeForTests(true);
    render(<DesktopLivePreview />);
    act(() => {
      showDesktopPreview({ url: 'http://cdn.test/ch1.mp4', x: 600, y: 120, width: 320, height: 180, radius: 12, dpr: 1 });
    });

    const box = document.querySelector('[data-desktop-live-preview]') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.style.left).toBe('600px');
    expect(box.style.width).toBe('320px');

    const muteBtn = screen.getByRole('button', { name: 'Activer le son de l’aperçu' });
    fireEvent.click(muteBtn);
    expect(screen.getByRole('button', { name: 'Couper le son de l’aperçu' })).toBeTruthy();
  });

  it('renders DesktopCinemaPlayer live overlay with zap, EPG, channel drawer, and returns current channel on close', async () => {
    setDesktopRuntimeForTests(true);
    render(<DesktopCinemaPlayer />);

    const returned = vi.fn();
    let sessionPromise!: Promise<boolean>;
    act(() => {
      sessionPromise = openDesktopLiveSession(
        'http://cdn.test/ch1.mp4',
        'TF1',
        {
          urls: ['http://cdn.test/ch1.mp4', 'http://cdn.test/ch2.mp4'],
          titles: ['TF1', 'France 2'],
          numbers: ['1', '2'],
          epg: [
            [[Date.now() - 60000, Date.now() + 600000, 'Journal 20h']],
            [[Date.now() - 60000, Date.now() + 600000, 'Documentaire']],
          ],
          index: 0,
        },
        returned,
      );
    });

    expect(screen.getByText('TF1')).toBeTruthy();
    expect(screen.getByText(/Journal 20h/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Chaîne suivante' }));
    expect(screen.getByText('France 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Quitter le lecteur' }));
    await waitFor(() => expect(returned).toHaveBeenCalledWith('http://cdn.test/ch2.mp4'));
    await expect(sessionPromise).resolves.toBe(true);
  });

  it('renders DesktopCinemaPlayer VOD overlay with next episode & progress resolution', async () => {
    setDesktopRuntimeForTests(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ durationSec: 1200, videoCodec: 'h264', audioCodec: 'aac' }), { status: 200 }),
    );
    render(<DesktopCinemaPlayer />);

    let vodPromise!: Promise<{ mediaId: string; positionMs: number; durationMs: number } | null>;
    act(() => {
      vodPromise = openDesktopVodSession({
        url: 'http://cdn.test/ep1.mp4',
        title: 'Série — E01',
        mediaId: 'ep-1',
        startPositionMs: 0,
        zap: {
          urls: ['http://cdn.test/ep1.mp4', 'http://cdn.test/ep2.mp4'],
          titles: ['Série — E01', 'Série — E02'],
          ids: ['ep-1', 'ep-2'],
          index: 0,
        },
      });
    });

    expect(screen.getByText('Série — E01')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Épisode suivant' }));
    expect(screen.getByText('Série — E02')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Quitter la lecture' }));
    const result = await vodPromise;
    expect(result?.mediaId).toBe('ep-2');
  });

  it('renders DesktopMosaicPlayer for 2..8 streams and exits on Escape', async () => {
    setDesktopRuntimeForTests(true);
    render(<DesktopMosaicPlayer />);

    let mosaicPromise!: Promise<boolean>;
    act(() => {
      mosaicPromise = openDesktopMosaicSession([
        { url: 'http://cdn.test/1.mp4', title: 'Chaîne 1' },
        { url: 'http://cdn.test/2.mp4', title: 'Chaîne 2' },
        { url: 'http://cdn.test/3.mp4', title: 'Chaîne 3' },
      ]);
    });

    expect(screen.getByText('Chaîne 1')).toBeTruthy();
    expect(screen.getByText('Chaîne 2')).toBeTruthy();
    expect(screen.getByText('Chaîne 3')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(mosaicPromise).resolves.toBe(true);
  });

  it('syncs EPG reminders to desktop server when running in desktop runtime', async () => {
    setDesktopRuntimeForTests(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, count: 1 }), { status: 200 }),
    );
    await syncDesktopReminders([
      { id: '101:1700000000000', channelId: '101', channelName: 'TF1 HD', title: 'Journal', startTime: 1700000000000 },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/desktop/reminders/sync',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
