import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSettingsFromDBMock = vi.fn();
const saveSettingsToDBMock = vi.fn();

vi.mock('@/utils/idb', () => ({
  getSettingsFromDB: (...a: unknown[]) => getSettingsFromDBMock(...a),
  saveSettingsToDB: (...a: unknown[]) => saveSettingsToDBMock(...a),
  PersistedSettings: {} as unknown,
}));

import { StorageManager, AppSettings } from '@/utils/storage';

describe('StorageManager cache stats', () => {
  beforeEach(() => {
    getSettingsFromDBMock.mockReset();
    saveSettingsToDBMock.mockReset();
    (StorageManager as any).__resetCacheForTests(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('tracks loads and hits', async () => {
    const base: AppSettings = {
      volume: 0.5,
      autoplay: true,
      theme: 'dark',
      keyboardNavigation: true,
      telemetryPersistence: true,
      compactModeDefault: false,
      virtualizationEnabledDefault: true,
      muteOnStart: true,
      playbackRate: 1,
      autoLoadLastPlaylist: true,
      __version: 3
    };
    getSettingsFromDBMock.mockResolvedValueOnce(base);
    const first = await StorageManager.loadSettingsAsync();
    const statsAfterLoad = StorageManager.getSettingsCacheStats();
    expect(first.volume).toBe(0.5);
    expect(statsAfterLoad.loads).toBe(1);
    expect(statsAfterLoad.hits).toBe(0);

    // Subsequent loads should hit cache
    const second = await StorageManager.loadSettingsAsync();
    const third = await StorageManager.loadSettingsAsync();
    expect(second).toBe(first);
    expect(third).toBe(first);
    const statsAfterHits = StorageManager.getSettingsCacheStats();
    expect(statsAfterHits.loads).toBe(1);
    expect(statsAfterHits.hits).toBeGreaterThanOrEqual(2);

    // Saving with no effective change should count as hit (no load)
    await StorageManager.saveSettings({ volume: 0.5 });
    const statsPostSaveNoop = StorageManager.getSettingsCacheStats();
    expect(statsPostSaveNoop.loads).toBe(1);
  });
});