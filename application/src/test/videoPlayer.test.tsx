// Tests du VideoPlayer (VideoPlayer.tsx) — scénarios simples :
// placeholder, zapping numérique, raccourcis clavier.
// Le circuit breaker et le basculement de variantes ne sont PAS couverts ici
// (trop d'effets croisés : cf. videoLifecycle.test.tsx pour le hook seul).
// Le mock de hls.js reproduit celui de src/test/videoLifecycle.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoPlayer } from '@/components/VideoPlayer';
import type { Channel } from '@/types/channel';

const mockHls = vi.hoisted(() => ({ instances: [] as Array<{ destroy: ReturnType<typeof vi.fn>; events: Record<string, (...args: unknown[]) => void> }> }));
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
vi.mock('mpegts.js', () => ({ default: { isSupported: () => false, createPlayer: vi.fn(), Events: {} } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/utils/idb', () => ({
  getPreferredVariantForChannel: vi.fn(async () => undefined),
  setPreferredVariantForChannel: vi.fn(async () => {}),
}));
vi.mock('@/utils/proxy', () => ({ getProxyBase: () => 'http://relais.test' }));
vi.mock('@/utils/storage', () => ({
  StorageManager: {
    // muteOnStart: false → le lecteur démarre avec le son activé.
    loadSettingsAsync: vi.fn(async () => ({ volume: 0.8, muteOnStart: false, autoReconnect: true, playbackRate: 1 })),
    saveSettings: vi.fn(async () => ({})),
    getCachedSettings: vi.fn(() => ({ volume: 0.8, muteOnStart: false })),
  },
}));
vi.mock('@/utils/nativePlayer', () => ({
  NativePlayerBridge: { isAvailable: () => false, open: vi.fn(), openExternal: vi.fn() },
}));

const canal: Channel = { id: 'c1', name: 'TF1', url: 'http://x/live/1.m3u8' };

beforeEach(() => {
  vi.clearAllMocks();
  mockHls.instances.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VideoPlayer', () => {
  it('affiche le placeholder quand aucune chaîne n’est fournie', () => {
    render(<VideoPlayer />);
    expect(screen.getByText('Choisis une chaîne pour commencer')).toBeVisible();
    // Aucune lecture lancée sans chaîne.
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(mockHls.instances).toHaveLength(0);
  });

  it('gère le zapping numérique : saisie, Entrée et Échap', async () => {
    const onZapToNumber = vi.fn();
    render(<VideoPlayer channel={canal} onZapToNumber={onZapToNumber} />);

    // Saisie de « 12 » : l'overlay rôle=status affiche les chiffres tapés.
    fireEvent.keyDown(window, { key: '1' });
    const overlay = screen.getByRole('status');
    expect(overlay).toHaveTextContent('1');
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByRole('status')).toHaveTextContent('12');
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Numéro de chaîne saisi : 12');

    // Entrée valide le numéro saisi.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onZapToNumber).toHaveBeenCalledTimes(1);
    expect(onZapToNumber).toHaveBeenCalledWith(12);
    expect(screen.queryByRole('status')).toBeNull();

    // Échap efface une nouvelle saisie sans zapper.
    fireEvent.keyDown(window, { key: '7' });
    expect(screen.getByRole('status')).toHaveTextContent('7');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(onZapToNumber).toHaveBeenCalledTimes(1);
  });

  it('réagit aux raccourcis clavier : sourdine et zapping PageUp/PageDown', async () => {
    const onNextChannel = vi.fn();
    const onPrevChannel = vi.fn();
    render(<VideoPlayer channel={canal} onNextChannel={onNextChannel} onPrevChannel={onPrevChannel} />);

    // La lecture démarre dès que HLS signale le manifeste (autoplay).
    await waitFor(() => expect(mockHls.instances).toHaveLength(1));
    await act(async () => { mockHls.instances[0].events['manifest']('manifest', {}); });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    // Les réglages sont chargés (muteOnStart: false) : le bouton propose de couper le son…
    const boutonCouper = await screen.findByRole('button', { name: 'Couper le son' });
    expect(boutonCouper).toBeVisible();

    // …et la touche « m » bascule la sourdine.
    fireEvent.keyDown(window, { key: 'm' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Activer le son' })).toBeVisible());
    fireEvent.keyDown(window, { key: 'm' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Couper le son' })).toBeVisible());

    // PageUp = chaîne précédente, PageDown = chaîne suivante (mapping du code).
    fireEvent.keyDown(window, { key: 'PageUp' });
    expect(onPrevChannel).toHaveBeenCalledTimes(1);
    expect(onNextChannel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(onNextChannel).toHaveBeenCalledTimes(1);
    expect(onPrevChannel).toHaveBeenCalledTimes(1);
  });
});
