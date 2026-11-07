import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { SettingsPanel } from '../components/SettingsPanel';
import { AppSettings } from '../utils/storage';

vi.mock('@/utils/idb', () => {
  return {
    deleteMeta: vi.fn(),
    getSettingsFromDB: vi.fn().mockResolvedValue(undefined),
    saveSettingsToDB: vi.fn(),
    getSettingsChangeLog: vi.fn().mockResolvedValue([
      { ts: Date.now(), changes: { volume: 0.5 }, fromVersion: 1, toVersion: 2 }
    ]),
    getSettingsMigrationStats: vi.fn().mockResolvedValue({ migrations: 1, lastMigrationTs: Date.now() })
  };
});

const baseSettings: AppSettings = {
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
  __version: 3
};

describe('SettingsPanel diagnostics UI', () => {
  it('toggles diagnostics panel and shows version & changes', async () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(<SettingsPanel open={true} currentSettings={baseSettings} onSettingsChange={onChange} onOpenChange={onOpenChange} />);
    expect(screen.queryByTestId('settings-diagnostics')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /diagnostics/i }));
  await waitFor(() => expect(screen.getByTestId('settings-diagnostics')).toBeTruthy());
    expect(screen.getByText(/Version:/)).toBeTruthy();
    expect(screen.getByText(/Changements récents/)).toBeTruthy();
  });
});

describe('SettingsPanel aperçu vidéo', () => {
  beforeEach(() => localStorage.clear());

  it('propose les trois modes, Automatique actif par défaut', () => {
    render(<SettingsPanel open={true} currentSettings={baseSettings} onSettingsChange={vi.fn()} onOpenChange={vi.fn()} />);
    const group = within(screen.getByRole('group', { name: /aperçu vidéo/i }));
    expect(screen.getByRole('group', { name: /aperçu vidéo/i })).toBeTruthy();
    expect(group.getByRole('button', { name: 'Automatique' }).getAttribute('aria-pressed')).toBe('true');
    expect(group.getByRole('button', { name: 'Manuel' }).getAttribute('aria-pressed')).toBe('false');
    expect(group.getByRole('button', { name: 'Désactivé' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('enregistre le mode manuel (et l’ancien booléen à true)', async () => {
    const onChange = vi.fn();
    render(<SettingsPanel open={true} currentSettings={baseSettings} onSettingsChange={onChange} onOpenChange={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('group', { name: /aperçu vidéo/i })).getByRole('button', { name: 'Manuel' }));
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls[0][0] as AppSettings;
    expect(saved.tvPreviewMode).toBe('manual');
    expect(saved.tvPreview).toBe(true);
  });

  it('le mode Désactivé écrit aussi l’ancien booléen à false', async () => {
    const onChange = vi.fn();
    render(<SettingsPanel open={true} currentSettings={baseSettings} onSettingsChange={onChange} onOpenChange={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('group', { name: /aperçu vidéo/i })).getByRole('button', { name: 'Désactivé' }));
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls[0][0] as AppSettings;
    expect(saved.tvPreviewMode).toBe('off');
    expect(saved.tvPreview).toBe(false);
  });
});
