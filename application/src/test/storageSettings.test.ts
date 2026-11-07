import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock idb utilities BEFORE importing StorageManager
let stored: any | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
const getSettingsFromDBMock = vi.fn();
const saveSettingsToDBMock = vi.fn();

vi.mock('@/utils/idb', () => {
  return {
    getSettingsFromDB: (...args: unknown[]) => getSettingsFromDBMock(...args),
    saveSettingsToDB: (...args: unknown[]) => saveSettingsToDBMock(...args),
    // Provide the type name so the import doesn't break during TS emit
    PersistedSettings: {} as unknown,
  };
});

// Now import after mocks are in place
import { StorageManager, AppSettings } from '@/utils/storage';

describe('StorageManager settings validation & migration', () => {
  beforeEach(() => {
    stored = undefined;
    getSettingsFromDBMock.mockReset();
    saveSettingsToDBMock.mockReset();
  // Reset in-memory cache to avoid cross test interaction
  (StorageManager as any).__resetCacheForTests(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('repairs invalid persisted settings and persists migration', async () => {
    // Simulate previously persisted invalid settings
    const invalidPersisted = {
      volume: 5,               // > 1 invalid
  autoplay: 'yes',         // wrong type
      theme: 'light',
      keyboardNavigation: true
      // missing other optional flags
    } as unknown as AppSettings;
    getSettingsFromDBMock.mockResolvedValueOnce(invalidPersisted);
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const loaded = await StorageManager.loadSettingsAsync();

    // Volume clamped to 1
    expect(loaded.volume).toBe(1);
  // Autoplay falls back to default true (new default)
  expect(loaded.autoplay).toBe(true);
    // Theme preserved (valid)
    expect(loaded.theme).toBe('light');
    // keyboardNavigation preserved
    expect(loaded.keyboardNavigation).toBe(true);

    // Migration should have attempted to persist repaired version
    expect(saveSettingsToDBMock).toHaveBeenCalledTimes(1);
    expect((stored as AppSettings).volume).toBe(1);
  expect(loaded.__version).toBe(10);
    expect(loaded.proxyUrl).toBe('');
  expect(loaded.tmdbApiKey).toBe(''); // défaut appliqué par la migration v4 -> v5
  expect(loaded.subtitlesEnabled).toBe(true);
  expect(loaded.subtitleAutoTranslate).toBe(true);
  expect(loaded.subtitlePreferredLang).toBe('fr');
  expect(loaded.parentalControlEnabled).toBe(false);
  expect(loaded.parentalPin).toBe('');
  });

  it('saves valid partial updates and preserves untouched fields', async () => {
    // Initial valid settings returned from DB
    const base: AppSettings = {
      volume: 0.8,
      autoplay: true,
      theme: 'dark',
      keyboardNavigation: true,
      compactModeDefault: false,
      virtualizationEnabledDefault: true,
      telemetryPersistence: true,
      muteOnStart: true,
      playbackRate: 1,
      autoLoadLastPlaylist: true,
      autoReconnect: true,
      epgUrl: '',
      tmdbApiKey: '',
      proxyUrl: '',
      __version: 8
    };
    getSettingsFromDBMock.mockResolvedValue(base);
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const updated = await StorageManager.saveSettings({ volume: 0.55, telemetryPersistence: false });

    expect(updated.volume).toBeCloseTo(0.55, 5);
    expect(updated.telemetryPersistence).toBe(false);
    // Unchanged fields remain the same
    expect(updated.theme).toBe('dark');
  expect(updated.autoplay).toBe(true);
    expect(saveSettingsToDBMock).toHaveBeenCalled();
    expect((stored as AppSettings).volume).toBeCloseTo(0.55, 5);
    });

  it('migrates legacy v1 settings without version to v2', async () => {
    const legacyNoVersion: AppSettings = {
      volume: 0.8,
      autoplay: false,
      theme: 'dark',
      keyboardNavigation: true,
      compactModeDefault: false,
      virtualizationEnabledDefault: true,
      // telemetryPersistence intentionally undefined (legacy)
    } as AppSettings; // simulate prior version
    getSettingsFromDBMock.mockResolvedValueOnce(legacyNoVersion);
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const result = await StorageManager.loadSettingsAsync();
    expect(result.__version).toBe(10);
    expect(result.telemetryPersistence).toBe(true); // default applied during migration
    expect(saveSettingsToDBMock).toHaveBeenCalled();
  });

  it('does not persist when saving a partial that results in no changes', async () => {
    const base: AppSettings = StorageManager.defaultSettings();
    getSettingsFromDBMock.mockResolvedValue(base);
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const result = await StorageManager.saveSettings({});
    // No-op should not trigger persistence now that optimization is in place
    expect(result.volume).toBe(0.8);
    expect(saveSettingsToDBMock).not.toHaveBeenCalled();
  });

  it('garde un jeton v4 TMDB (~220 caractères) entier', async () => {
    const base: AppSettings = StorageManager.defaultSettings();
    getSettingsFromDBMock.mockResolvedValue(base);
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    // Un jeton v4 typique dépasse 200 caractères : l'ancienne limite le tronquait.
    const token = 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(200) + '.b2suCk9UdE-tb2tlbg';
    expect(token.length).toBeGreaterThan(200);
    const result = await StorageManager.saveSettings({ tmdbApiKey: token });
    expect(result.tmdbApiKey).toBe(token);
    expect((stored as AppSettings).tmdbApiKey).toBe(token);
  });

  it('sauvegarde puis recharge un long jeton TMDB sans le tronquer', async () => {
    const token = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(320)}.signature`;
    getSettingsFromDBMock.mockResolvedValue(StorageManager.defaultSettings());
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });
    expect((await StorageManager.saveSettings({ tmdbApiKey: token })).tmdbApiKey).toBe(token);
    StorageManager.__resetCacheForTests();
    getSettingsFromDBMock.mockResolvedValue(stored);
    expect((await StorageManager.loadSettingsAsync()).tmdbApiKey).toBe(token);
  });

  it('préserve le long jeton TMDB quand un autre réglage doit être réparé', async () => {
    const token = `eyJhbGciOiJIUzI1NiJ9.${'b'.repeat(320)}.signature`;
    getSettingsFromDBMock.mockResolvedValue({ ...StorageManager.defaultSettings(), volume: 5, tmdbApiKey: token });
    const loaded = await StorageManager.loadSettingsAsync();
    expect(loaded.volume).toBe(1);
    expect(loaded.tmdbApiKey).toBe(token);
  });

  it('conserve les réglages du lecteur Android (tampon, décodage, AFR)', async () => {
    getSettingsFromDBMock.mockResolvedValue(StorageManager.defaultSettings());
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });
    const saved = await StorageManager.saveSettings({ playerBuffer: 'large', playerDecoder: 'software', playerAfr: true });
    expect(saved).toMatchObject({ playerBuffer: 'large', playerDecoder: 'software', playerAfr: true });
    StorageManager.__resetCacheForTests();
    getSettingsFromDBMock.mockResolvedValue(stored);
    expect(await StorageManager.loadSettingsAsync()).toMatchObject({ playerBuffer: 'large', playerDecoder: 'software', playerAfr: true });
  });

  it('migrates the legacy tvPreview boolean to tvPreviewMode (v8 -> v9)', async () => {
    const { tvPreviewMode: _dropped, ...withoutMode } = StorageManager.defaultSettings(); // eslint-disable-line @typescript-eslint/no-unused-vars
    getSettingsFromDBMock.mockResolvedValueOnce({ ...withoutMode, __version: 8, tvPreview: false });
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const loaded = await StorageManager.loadSettingsAsync();
    expect(loaded.tvPreviewMode).toBe('off');
    expect(loaded.__version).toBe(10);
  });

  it('adds last-channel start (off) and 24 h playlist refresh during v9 -> v10', async () => {
    const { startOnLastChannel: _a, playlistRefreshHours: _b, ...v9 } = StorageManager.defaultSettings();
    getSettingsFromDBMock.mockResolvedValueOnce({ ...v9, __version: 9 });
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const loaded = await StorageManager.loadSettingsAsync();
    expect(loaded.startOnLastChannel).toBe(false);
    expect(loaded.playlistRefreshHours).toBe(24);
    expect(loaded.__version).toBe(10);
  });

  it('keeps a chosen playlist refresh interval and rejects invalid ones', async () => {
    getSettingsFromDBMock.mockResolvedValue(StorageManager.defaultSettings());
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });
    expect((await StorageManager.saveSettings({ playlistRefreshHours: 0, startOnLastChannel: true })).playlistRefreshHours).toBe(0);
    StorageManager.__resetCacheForTests();
    getSettingsFromDBMock.mockResolvedValue({ ...StorageManager.defaultSettings(), playlistRefreshHours: -5 });
    expect((await StorageManager.loadSettingsAsync()).playlistRefreshHours).toBe(24);
  });

  it('defaults tvPreviewMode to auto when nothing was persisted', async () => {
    const { tvPreviewMode: _dropped, ...withoutMode } = StorageManager.defaultSettings(); // eslint-disable-line @typescript-eslint/no-unused-vars
    getSettingsFromDBMock.mockResolvedValueOnce({ ...withoutMode, __version: 8 });
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const loaded = await StorageManager.loadSettingsAsync();
    expect(loaded.tvPreviewMode).toBe('auto');
  });

  it('keeps an explicit tvPreviewMode', async () => {
    const persisted = { ...StorageManager.defaultSettings(), tvPreviewMode: 'manual', tvPreview: true };
    getSettingsFromDBMock.mockResolvedValueOnce(persisted);
    saveSettingsToDBMock.mockImplementation(async (s: unknown) => { stored = s; });

    const loaded = await StorageManager.loadSettingsAsync();
    expect(loaded.tvPreviewMode).toBe('manual');
  });
});
