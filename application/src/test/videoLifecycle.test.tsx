import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useVideoPlayer } from '@/hooks/useVideoPlayer';
import { setPlaybackDelegated } from '@/utils/playbackOwnership';

const mockHls = vi.hoisted(() => ({ instances: [] as Array<{
  destroy: ReturnType<typeof vi.fn>;
  events: Record<string, (...args: unknown[]) => void>;
  startLoad: ReturnType<typeof vi.fn>;
  recoverMediaError: ReturnType<typeof vi.fn>;
}> }));

const mockMpegts = vi.hoisted(() => ({
  instances: [] as Array<{
    attachMediaElement: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    detachMediaElement: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    events: Record<string, (...args: unknown[]) => void>;
  }>,
  isSupported: vi.fn(() => true),
  Events: { ERROR: 'error' },
}));

vi.mock('mpegts.js', () => ({
  default: {
    isSupported: () => mockMpegts.isSupported(),
    createPlayer: vi.fn(() => {
      const inst = {
        attachMediaElement: vi.fn(),
        load: vi.fn(),
        pause: vi.fn(),
        unload: vi.fn(),
        destroy: vi.fn(),
        detachMediaElement: vi.fn(),
        events: {} as Record<string, (...args: unknown[]) => void>,
        on: vi.fn((ev: string, cb: (...args: unknown[]) => void) => { inst.events[ev] = cb; }),
      };
      mockMpegts.instances.push(inst);
      return inst;
    }),
    Events: mockMpegts.Events,
  },
}));

vi.mock('hls.js', () => ({ default: class {
  static isSupported = () => true;
  static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  events: Record<string, (...args: unknown[]) => void> = {};
  destroy = vi.fn(); levels = [{ height: 720 }];
  loadSource = vi.fn(); attachMedia = vi.fn();
  startLoad = vi.fn(); recoverMediaError = vi.fn();
  on(event: string, callback: (...args: unknown[]) => void) { this.events[event] = callback; }
  constructor() { mockHls.instances.push(this); }
} }));

let player: ReturnType<typeof useVideoPlayer>;
function Harness() { player = useVideoPlayer(); return <video ref={player.videoRef} />; }

beforeEach(() => {
  setPlaybackDelegated(false);
  vi.useFakeTimers();
  mockHls.instances.length = 0;
  mockMpegts.instances.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

afterEach(() => {
  cleanup();
  setPlaybackDelegated(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Cycle de vie vidéo', () => {
  it('ferme HLS et les reprises avant une activité Android, bloque les lectures tardives et attend une reprise manuelle', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/a.m3u8'); });
    act(() => mockHls.instances[0].events.error('error', { fatal: true }));
    act(() => setPlaybackDelegated(true));
    expect(mockHls.instances[0].destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await player.playStream('https://example.test/late.m3u8');
      player.togglePlay();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mockHls.instances).toHaveLength(1);
    act(() => setPlaybackDelegated(false));
    expect(mockHls.instances).toHaveLength(1);
    await act(async () => { player.togglePlay(); });
    expect(mockHls.instances).toHaveLength(2);
  });

  it('synchronise l’indication sonore avec le démarrage muet et le bouton son', () => {
    render(<Harness />);
    act(() => { player.changeVolume(0.7); player.changeMute(true); });
    expect(player.isMuted).toBe(true);
    expect(player.videoRef.current!.muted).toBe(true);
    act(() => player.toggleMute());
    expect(player.isMuted).toBe(false);
    expect(player.videoRef.current!.muted).toBe(false);
  });

  it('le volume garde la session HLS et les callbacks stables', async () => {
    render(<Harness />);
    const play = player.playStream;
    await act(async () => { await player.playStream('https://example.test/a.m3u8'); });
    act(() => player.changeVolume(0.3));
    expect(player.volume).toBe(0.3);
    expect(mockHls.instances[0].destroy).not.toHaveBeenCalled();
    expect(player.playStream).toBe(play);
  });

  it('la fin de vidéo remet le bouton sur Lecture', async () => {
    render(<Harness />);
    act(() => player.videoRef.current!.dispatchEvent(new Event('play')));
    expect(player.isPlaying).toBe(true);
    act(() => player.videoRef.current!.dispatchEvent(new Event('ended')));
    expect(player.isPlaying).toBe(false);
  });

  it('borne les reprises à cinq et affiche une erreur terminale', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/a.m3u8'); });
    for (let i = 0; i < 6; i++) {
      act(() => mockHls.instances[mockHls.instances.length - 1].events.error('error', { fatal: true }));
      if (i < 5) await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    }
    expect(mockHls.instances).toHaveLength(6);
    expect(player.retryAttempts).toBe(5);
    expect(player.error).toContain('Gave up after 5');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('arrêter annule une reprise programmée', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/a.m3u8'); });
    act(() => mockHls.instances[0].events.error('error', { fatal: true }));
    act(() => player.stopStream());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(mockHls.instances).toHaveLength(1);
    expect(player.isLoading).toBe(false);
  });

  it('ignore les erreurs d’une ancienne chaîne après zapping', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/a.m3u8'); });
    const old = mockHls.instances[0];
    await act(async () => { await player.playStream('https://example.test/b.m3u8'); });
    act(() => old.events.error('error', { fatal: true }));
    expect(player.retryAttempts).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prépare la vidéo même lorsque la lecture automatique est désactivée', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/a.m3u8', { autoplay: false }); });
    act(() => mockHls.instances[0].events.manifest());
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    act(() => player.togglePlay());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('tente la récupération ciblée startLoad sur erreur réseau fatale HLS', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/a.m3u8'); });
    const hlsInst = mockHls.instances[0];
    act(() => hlsInst.events.error('error', { fatal: true, type: 'networkError' }));
    expect(hlsInst.startLoad).toHaveBeenCalledOnce();
    expect(hlsInst.recoverMediaError).not.toHaveBeenCalled();
    expect(player.retryAttempts).toBe(0);
  });

  it('tente la récupération ciblée recoverMediaError sur erreur média fatale HLS', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/a.m3u8'); });
    const hlsInst = mockHls.instances[0];
    act(() => hlsInst.events.error('error', { fatal: true, type: 'mediaError' }));
    expect(hlsInst.recoverMediaError).toHaveBeenCalledOnce();
    expect(hlsInst.startLoad).not.toHaveBeenCalled();
    expect(player.retryAttempts).toBe(0);
  });

  it('initialise le moteur mpegts.js pour les flux MPEG-TS (.ts)', async () => {
    render(<Harness />);
    await act(async () => { await player.playStream('https://example.test/stream.ts'); });
    expect(mockMpegts.instances).toHaveLength(1);
    const mpegInst = mockMpegts.instances[0];
    expect(mpegInst.attachMediaElement).toHaveBeenCalledOnce();
    expect(mpegInst.load).toHaveBeenCalledOnce();
    act(() => player.stopStream());
    expect(mpegInst.detachMediaElement).toHaveBeenCalledOnce();
    expect(mpegInst.destroy).toHaveBeenCalledOnce();
  });
});
