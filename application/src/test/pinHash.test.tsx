import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParentalPinDialog } from '@/components/ParentalPinDialog';
import { hashPin, isHashedPin, maybeUpgradePin, verifyPin } from '@/utils/pinHash';

// jsdom ne fournit pas crypto.subtle : webcrypto de Node pour les empreintes SHA-256.
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('pinHash', () => {
  it('hache puis vérifie un code (sel aléatoire, format sha256:salt:empreinte)', async () => {
    const stored = await hashPin('1234');
    expect(isHashedPin(stored)).toBe(true);
    expect(stored).toMatch(/^sha256:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(await verifyPin('1234', stored)).toBe(true);
    expect(await verifyPin('1235', stored)).toBe(false);
    expect(await verifyPin('', stored)).toBe(false);
    // Deux hachages du même code divergent par le sel mais vérifient tous les deux.
    const again = await hashPin('1234');
    expect(again).not.toBe(stored);
    expect(await verifyPin('1234', again)).toBe(true);
  });

  it('accepte encore un ancien code stocké en clair (données non migrées)', async () => {
    expect(await verifyPin('1234', '1234')).toBe(true);
    expect(await verifyPin('9999', '1234')).toBe(false);
    expect(await verifyPin('1234', '')).toBe(false);
    expect(await verifyPin('1234', undefined)).toBe(false);
  });

  it('résiste à une empreinte malformée', async () => {
    expect(await verifyPin('x', 'sha256:')).toBe(false);
    expect(await verifyPin('x', 'sha256:zz:gg')).toBe(false);
  });

  it('maybeUpgradePin hache un ancien code via le rappel de sauvegarde', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    await maybeUpgradePin('1234', save);
    expect(save).toHaveBeenCalledOnce();
    const hashed = save.mock.calls[0][0].parentalPin;
    expect(isHashedPin(hashed)).toBe(true);
    expect(await verifyPin('1234', hashed)).toBe(true);
  });

  it('maybeUpgradePin ne réécrit pas une empreinte déjà hachée', async () => {
    const save = vi.fn();
    const stored = await hashPin('1234');
    await maybeUpgradePin(stored, save);
    expect(save).not.toHaveBeenCalled();
    await maybeUpgradePin('', save);
    await maybeUpgradePin(undefined, save);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('ParentalPinDialog avec empreinte hachée', () => {
  it('déverrouille avec le bon code, refuse un code erroné', async () => {
    const stored = await hashPin('1234');
    const onUnlock = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ParentalPinDialog open pin={stored} onOpenChange={() => {}} onUnlock={onUnlock} />);
    await user.type(screen.getByLabelText('Code parental'), '9999');
    await user.click(screen.getByRole('button', { name: 'Déverrouiller' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onUnlock).not.toHaveBeenCalled();

    rerender(<ParentalPinDialog open={false} pin={stored} onOpenChange={() => {}} onUnlock={onUnlock} />);
    rerender(<ParentalPinDialog open pin={stored} onOpenChange={() => {}} onUnlock={onUnlock} />);
    await user.type(screen.getByLabelText('Code parental'), '1234');
    await user.click(screen.getByRole('button', { name: 'Déverrouiller' }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });
});
