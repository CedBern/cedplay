import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TraktAuthDialog } from '@/components/TraktAuthDialog';
import * as traktUtils from '@/utils/trakt';

vi.mock('@/utils/trakt', async () => {
  const actual = await vi.importActual<typeof import('@/utils/trakt')>('@/utils/trakt');
  return {
    ...actual,
    requestDeviceCode: vi.fn(),
    pollDeviceToken: vi.fn(),
    fetchTraktUserProfile: vi.fn(),
    syncTraktHistory: vi.fn(),
  };
});

describe('TraktAuthDialog', () => {
  const defaultTokens = {
    access_token: 'acc-123',
    token_type: 'bearer',
    expires_in: 7200,
    refresh_token: 'ref-123',
    scope: 'public',
    created_at: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le code utilisateur et le lien après chargement', async () => {
    vi.mocked(traktUtils.requestDeviceCode).mockResolvedValueOnce({
      device_code: 'dev-code-1',
      user_code: 'TRAKT-999',
      verification_url: 'https://trakt.tv/activate',
      expires_in: 600,
      interval: 5,
    });
    vi.mocked(traktUtils.pollDeviceToken).mockResolvedValue({ status: 'pending' });

    render(
      <TraktAuthDialog
        open={true}
        onOpenChange={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(await screen.findByText('TRAKT-999')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /trakt\.tv\/activate/i })).toHaveAttribute(
      'href',
      'https://trakt.tv/activate'
    );
    expect(screen.getByRole('img', { name: /QR code vers trakt\.tv\/activate/i })).toBeInTheDocument();
  });

  it('gère le succès de polling et appelle onSuccess', async () => {
    vi.mocked(traktUtils.requestDeviceCode).mockResolvedValueOnce({
      device_code: 'dev-code-1',
      user_code: 'TRAKT-999',
      verification_url: 'https://trakt.tv/activate',
      expires_in: 600,
      interval: 1, // court pour le test
    });

    vi.mocked(traktUtils.pollDeviceToken).mockResolvedValueOnce({
      status: 'success',
      tokens: defaultTokens,
    });

    vi.mocked(traktUtils.fetchTraktUserProfile).mockResolvedValueOnce({
      username: 'cedric_test',
    });

    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <TraktAuthDialog
        open={true}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        tokens: defaultTokens,
        user: { username: 'cedric_test' },
      });
    }, { timeout: 4000 });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('affiche une erreur et permet de réessayer si la requête initiale échoue', async () => {
    const user = userEvent.setup();
    vi.mocked(traktUtils.requestDeviceCode)
      .mockRejectedValueOnce(new Error('Erreur réseau simulée'))
      .mockResolvedValueOnce({
        device_code: 'dev-ok',
        user_code: 'CODE-RETRY',
        verification_url: 'https://trakt.tv/activate',
        expires_in: 600,
        interval: 5,
      });

    render(
      <TraktAuthDialog
        open={true}
        onOpenChange={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(await screen.findByText(/Erreur réseau simulée/)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /Réessayer/i });
    await user.click(retryBtn);

    expect(await screen.findByText('CODE-RETRY')).toBeInTheDocument();
  });
});
