import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '@/components/SettingsPanel';
import { StorageManager, type AppSettings } from '@/utils/storage';
import * as traktUtils from '@/utils/trakt';

vi.mock('@/utils/trakt', async () => {
  const actual = await vi.importActual<typeof import('@/utils/trakt')>('@/utils/trakt');
  return {
    ...actual,
    syncTraktHistory: vi.fn().mockResolvedValue({ added: 3, total: 10 }),
    requestDeviceCode: vi.fn(),
    pollDeviceToken: vi.fn(),
  };
});

describe('SettingsPanel - Trakt.tv section', () => {
  const baseSettings: AppSettings = {
    ...StorageManager.defaultSettings(),
    traktToken: '',
    traktUsername: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le bouton de connexion quand aucun compte n’est associé', () => {
    render(
      <SettingsPanel
        open={true}
        onOpenChange={() => {}}
        currentSettings={baseSettings}
        onSettingsChange={() => {}}
      />
    );

    expect(screen.getByText('Associer un compte Trakt.tv')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Connecter mon compte Trakt/i })
    ).toBeInTheDocument();
  });

  it('affiche l’état connecté, les cases à cocher et permet de synchroniser ou déconnecter', async () => {
    const user = userEvent.setup();
    const connectedSettings: AppSettings = {
      ...baseSettings,
      traktToken: 'token-active-123',
      traktUsername: 'cedric_pro',
      traktScrobble: true,
      traktSync: true,
    };

    const onSettingsChange = vi.fn();

    render(
      <SettingsPanel
        open={true}
        onOpenChange={() => {}}
        currentSettings={connectedSettings}
        onSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByText(/Connecté : @cedric_pro/i)).toBeInTheDocument();

    const scrobbleCheck = screen.getByRole('checkbox', {
      name: /Scrobbler la lecture en direct/i,
    });
    expect(scrobbleCheck).toBeChecked();

    const syncCheck = screen.getByRole('checkbox', {
      name: /Synchroniser l’historique avec « Vu ailleurs »/i,
    });
    expect(syncCheck).toBeChecked();

    // Test du bouton synchroniser
    const syncBtn = screen.getByRole('button', {
      name: /Synchroniser l’historique maintenant/i,
    });
    await user.click(syncBtn);
    expect(traktUtils.syncTraktHistory).toHaveBeenCalledWith('token-active-123', '');

    // Test du bouton déconnecter
    const disconnectBtn = screen.getByRole('button', { name: /Déconnecter/i });
    await user.click(disconnectBtn);

    // Après déconnexion dans le draft, l'état non connecté réapparaît
    await waitFor(() => {
      expect(screen.getByText('Associer un compte Trakt.tv')).toBeInTheDocument();
    });
  });
});
