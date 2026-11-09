// Réglage du pays des offres : un reclic sur le pays déjà choisi ne doit pas
// effacer les abonnements cochés (seul un vrai changement de pays le fait).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/WatchSubscriptions', () => ({
  WatchSubscriptions: ({ selected }: { selected: number[] }) => (
    <p data-testid="abonnements">{selected.join(',')}</p>
  ),
}));
vi.mock('@/utils/idb', () => ({
  getSettingsFromDB: async () => undefined,
  saveSettingsToDB: async () => {},
  pushSettingsChangeLogEntry: async () => {},
  updateSettingsMigrationStats: async () => {},
  getSettingsChangeLog: async () => [],
  getSettingsMigrationStats: async () => ({ migrations: 0, lastMigrationTs: null }),
  deleteMeta: async () => {},
}));

import { SettingsPanel } from '@/components/SettingsPanel';
import type { AppSettings } from '@/utils/storage';

const settings: AppSettings = {
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
  __version: 3,
  tmdbApiKey: 'cle-fictive',
  watchRegion: 'MX',
  watchProviderIds: [8, 457],
};

const country = (name: string) =>
  within(screen.getByRole('group', { name: /Pays des offres légales/i })).getByRole('button', { name });

const renderPanel = () => {
  const onChange = vi.fn();
  render(<SettingsPanel open currentSettings={settings} onSettingsChange={onChange} onOpenChange={() => {}} />);
  return onChange;
};

const savedSettings = async (onChange: ReturnType<typeof vi.fn>): Promise<AppSettings> => {
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  return onChange.mock.calls[0]![0] as AppSettings;
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('pays des offres et abonnements', () => {
  it('recliquer le pays déjà choisi conserve les abonnements cochés', async () => {
    const onChange = renderPanel();
    expect(screen.getByTestId('abonnements').textContent).toBe('8,457');

    fireEvent.click(country('Mexique'));

    expect(country('Mexique').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('abonnements').textContent).toBe('8,457');

    const saved = await savedSettings(onChange);
    expect(saved.watchRegion).toBe('MX');
    expect(saved.watchProviderIds).toEqual([8, 457]);
  });

  it('changer de pays efface les abonnements, propres à un autre catalogue', async () => {
    const onChange = renderPanel();
    fireEvent.click(country('France'));

    expect(country('France').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('abonnements').textContent).toBe('');

    const saved = await savedSettings(onChange);
    expect(saved.watchRegion).toBe('FR');
    expect(saved.watchProviderIds).toEqual([]);
  });
});
