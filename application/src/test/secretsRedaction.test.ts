import { describe, it, expect, vi, beforeEach } from 'vitest';

// Secrets journalisés : vérifie le masquage utilitaire ET à l'écriture du journal
// de changements par StorageManager (jamais la valeur en clair, seulement l'occurrence).

let stored: unknown;
const getSettingsFromDBMock = vi.fn();
const saveSettingsToDBMock = vi.fn();
const pushChangelogMock = vi.fn();

vi.mock('@/utils/idb', () => ({
  getSettingsFromDB: (...args: unknown[]) => getSettingsFromDBMock(...args),
  saveSettingsToDB: (...args: unknown[]) => saveSettingsToDBMock(...args),
  pushSettingsChangeLogEntry: (...args: unknown[]) => pushChangelogMock(...args),
  updateSettingsMigrationStats: vi.fn(),
  PersistedSettings: {},
}));

import { StorageManager } from '@/utils/storage';
import { redactChangeLog, redactSetting } from '@/utils/redact';

describe('redact util', () => {
  it('masque uniquement les clés secrètes non vides', () => {
    expect(redactSetting('tmdbApiKey', 'sk-test-123')).toBe('••••');
    expect(redactSetting('deeplApiKey', 'key:fx')).toBe('••••');
    expect(redactSetting('openSubtitlesApiKey', 'abc')).toBe('••••');
    expect(redactSetting('subdlApiKey', 'abc')).toBe('••••');
    expect(redactSetting('parentalPin', '1234')).toBe('••••');
    expect(redactSetting('tmdbApiKey', '')).toBe('');
    expect(redactSetting('tmdbApiKey', undefined)).toBeUndefined();
    expect(redactSetting('volume', 0.5)).toBe(0.5);
    expect(redactSetting('parentalControlEnabled', true)).toBe(true);
  });

  it('assainit un journal existant (entrées écrites avant le masquage)', () => {
    const entries = [
      { ts: 1, changes: { volume: 0.5, tmdbApiKey: 'sk-fuite' } },
      { ts: 2, changes: { theme: 'light' } },
      { ts: 3, changes: { parentalPin: '1234' } },
    ];
    const [first, second, third] = redactChangeLog(entries);
    expect(first.changes.volume).toBe(0.5);
    expect(first.changes.tmdbApiKey).toBe('••••');
    expect(second).toBe(entries[1]); // intouché si aucun secret
    expect(third.changes.parentalPin).toBe('••••');
    expect(JSON.stringify(redactChangeLog(entries))).not.toContain('sk-fuite');
  });
});

describe('StorageManager : journal de changements sans secrets', () => {
  beforeEach(() => {
    stored = undefined;
    getSettingsFromDBMock.mockReset();
    saveSettingsToDBMock.mockReset();
    pushChangelogMock.mockReset();
    (StorageManager as unknown as { __resetCacheForTests(): void }).__resetCacheForTests();
    getSettingsFromDBMock.mockResolvedValue(undefined);
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });
  });

  it('journalise l\'occurrence d\'un changement de clé API/PIN sans la valeur', async () => {
    await StorageManager.loadSettingsAsync();
    await StorageManager.saveSettings({ tmdbApiKey: 'sk-secret-value', parentalPin: '9876', volume: 0.5 });
    expect(pushChangelogMock).toHaveBeenCalled();
    const dumped = JSON.stringify(pushChangelogMock.mock.calls.map(call => call[0]));
    expect(dumped).not.toContain('sk-secret-value');
    expect(dumped).not.toContain('9876');
    expect(dumped).toContain('••••');
    // Les réglages non secrets restent journalisés en clair.
    expect(dumped).toContain('"volume":0.5');
    // Les valeurs réelles sont bien persistées (utilisables par l'application).
    const persisted = stored as Record<string, unknown>;
    expect(persisted.tmdbApiKey).toBe('sk-secret-value');
    expect(persisted.parentalPin).toBe('9876');
  });

  it('ne journalise rien quand aucune valeur ne change', async () => {
    await StorageManager.loadSettingsAsync();
    await StorageManager.saveSettings({ volume: 0.8 }); // valeur par défaut : pas de diff
    expect(pushChangelogMock).not.toHaveBeenCalled();
  });
});
