import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cycle complet du PIN parental : création → sauvegarde → rechargement → déverrouillage.
// Garantit que la validation de stockage n'altère ni l'empreinte hachée (104 caractères,
// la limite basse de 20 la tronquait) ni un ancien code en clair encore non migré.

let stored: unknown;
const getSettingsFromDBMock = vi.fn();
const saveSettingsToDBMock = vi.fn();

vi.mock('@/utils/idb', () => ({
  getSettingsFromDB: (...args: unknown[]) => getSettingsFromDBMock(...args),
  saveSettingsToDB: (...args: unknown[]) => saveSettingsToDBMock(...args),
  pushSettingsChangeLogEntry: vi.fn(),
  updateSettingsMigrationStats: vi.fn(),
  PersistedSettings: {},
}));

import { StorageManager } from '@/utils/storage';
import { hashPin, isHashedPin, verifyPin } from '@/utils/pinHash';

beforeEach(() => {
  // jsdom ne fournit pas crypto.subtle : webcrypto de Node pour les empreintes.
  vi.stubGlobal('crypto', webcrypto);
  stored = undefined;
  getSettingsFromDBMock.mockReset();
  saveSettingsToDBMock.mockReset();
  (StorageManager as unknown as { __resetCacheForTests(): void }).__resetCacheForTests();
  getSettingsFromDBMock.mockResolvedValue(undefined);
  saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });
});

describe('cycle de vie du PIN parental', () => {
  it('création → sauvegarde → rechargement → déverrouillage, empreinte intacte', async () => {
    // Création : l'empreinte dépasse largement l'ancienne limite de 20 caractères.
    const hashed = await hashPin('4321');
    expect(isHashedPin(hashed)).toBe(true);
    expect(hashed.length).toBeGreaterThan(20);
    // Sauvegarde (activation de la protection).
    await StorageManager.loadSettingsAsync();
    await StorageManager.saveSettings({ parentalControlEnabled: true, parentalPin: hashed });
    expect((stored as { parentalPin?: string }).parentalPin).toBe(hashed); // pas de troncature
    // Rechargement (nouvelle session).
    StorageManager.__resetCacheForTests();
    saveSettingsToDBMock.mockClear(); // ne compter que les écritures du rechargement
    getSettingsFromDBMock.mockResolvedValue(stored);
    const reloaded = await StorageManager.loadSettingsAsync(true);
    expect(reloaded.parentalPin).toBe(hashed);
    expect(reloaded.parentalControlEnabled).toBe(true);
    // Aucune « réparation » au rechargement : la validation accepte l'empreinte telle quelle.
    expect(saveSettingsToDBMock).not.toHaveBeenCalled();
    // Déverrouillage.
    expect(await verifyPin('4321', reloaded.parentalPin)).toBe(true);
    expect(await verifyPin('0000', reloaded.parentalPin)).toBe(false);
  });

  it('un ancien code en clair survit aussi à la validation au rechargement', async () => {
    await StorageManager.loadSettingsAsync();
    await StorageManager.saveSettings({ parentalControlEnabled: true, parentalPin: '1234' });
    StorageManager.__resetCacheForTests();
    getSettingsFromDBMock.mockResolvedValue(stored);
    const reloaded = await StorageManager.loadSettingsAsync(true);
    expect(reloaded.parentalPin).toBe('1234');
    expect(await verifyPin('1234', reloaded.parentalPin)).toBe(true);
  });
});
