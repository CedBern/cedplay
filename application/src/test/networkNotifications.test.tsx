import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkNotifications } from '@/components/NetworkNotifications';
import { toast } from 'sonner';
import type { NetworkStatus } from '@/hooks/useNetworkStatus';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const status = (partial: Partial<NetworkStatus>): NetworkStatus => ({
  isOnline: true,
  connectionType: 'wifi',
  effectiveType: '4g',
  downlink: 10.5,
  rtt: 50,
  ...partial,
});

// Date.now est contrôlé : le composant impose 5 s entre deux notifications,
// et le compteur part de 0 (epoch) : on démarre au-delà pour que la première
// transition soit notifiable.
let now = 10_000;
const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

function renderWith(status0: NetworkStatus) {
  const view = render(<NetworkNotifications networkStatus={status0} />);
  return { rerender: (s: NetworkStatus) => view.rerender(<NetworkNotifications networkStatus={s} />) };
}

beforeEach(() => {
  now = 10_000;
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.warning).mockClear();
  vi.mocked(toast.info).mockClear();
});

afterEach(() => {
  dateSpy.mockReset();
  dateSpy.mockImplementation(() => now);
});

describe('NetworkNotifications', () => {
  it('ne notifie pas au premier rendu (référence initiale)', () => {
    renderWith(status({}));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('ne présente pas la première mesure du réseau comme une amélioration', () => {
    const { rerender } = renderWith(status({ effectiveType: 'unknown', downlink: 0 }));
    now = 20_000;
    rerender(status({ effectiveType: '4g', downlink: 10.5 }));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('signale la perte puis le rétablissement de la connexion', () => {
    const { rerender } = renderWith(status({}));
    now = 15_000;
    rerender(status({ isOnline: false, downlink: 0 }));
    expect(toast.error).toHaveBeenCalledOnce();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('Connexion internet perdue');

    // Après le cooldown : rétablissement notifié
    now = 25_000;
    rerender(status({}));
    expect(toast.success).toHaveBeenCalledOnce();
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe('Connexion internet rétablie');
  });

  it('diffère et notifie le rétablissement survenu pendant le cooldown sans le perdre', () => {
    const { rerender } = renderWith(status({}));
    now = 15_000;
    rerender(status({ isOnline: false, downlink: 0 }));
    expect(toast.error).toHaveBeenCalledOnce();

    // Rétablissement pendant le cooldown : aucune notification immédiate pour éviter le spam
    now = 16_000;
    rerender(status({}));
    expect(toast.success).not.toHaveBeenCalled();

    // Dès que le cooldown est écoulé, le rétablissement est bien notifié (non perdu)
    now = 30_000;
    rerender(status({}));
    expect(toast.success).toHaveBeenCalledOnce();
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe('Connexion internet rétablie');
  });

  it('signale la dégradation nette vers une connexion de qualité faible', () => {
    const { rerender } = renderWith(status({}));
    now = 15_000;
    rerender(status({ effectiveType: '2g', downlink: 0.5 }));
    expect(toast.warning).toHaveBeenCalledOnce();
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toBe('Qualité de connexion dégradée');
  });

  it('signale l\'amélioration nette depuis une connexion faible', () => {
    const { rerender } = renderWith(status({ effectiveType: '2g', downlink: 0.5 }));
    now = 15_000;
    rerender(status({ effectiveType: '4g', downlink: 10.5 }));
    expect(toast.info).toHaveBeenCalledOnce();
    expect(vi.mocked(toast.info).mock.calls[0][0]).toBe('Qualité de connexion améliorée');
  });

  it('ne notifie pas une variation mineure de qualité', () => {
    const { rerender } = renderWith(status({}));
    now = 15_000;
    rerender(status({ downlink: 8, rtt: 80 })); // reste de qualité 3 (4g)
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('enabled=false désactive toutes les notifications', () => {
    const view = render(<NetworkNotifications networkStatus={status({})} enabled={false} />);
    now = 15_000;
    view.rerender(<NetworkNotifications networkStatus={status({ isOnline: false })} enabled={false} />);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
