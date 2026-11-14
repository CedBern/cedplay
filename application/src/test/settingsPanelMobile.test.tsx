import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsPanel } from '@/components/SettingsPanel';
import { StorageManager } from '@/utils/storage';

describe('Réglages sur téléphone', () => {
  const originalWidth = window.innerWidth;
  const settings = StorageManager.defaultSettings();
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    localStorage.clear();
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    vi.restoreAllMocks();
  });

  it('ouvre une liste de rubriques sans champ de saisie ni clavier demandé', async () => {
    render(<SettingsPanel open currentSettings={settings} onSettingsChange={vi.fn()} onOpenChange={vi.fn()} />);
    const lecture = screen.getByRole('button', { name: 'Lecture' });
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(10);
    expect(screen.queryByRole('textbox')).toBeNull();
    await waitFor(() => expect(lecture).toHaveFocus());
  });

  it('ouvre une seule rubrique à la fois et conserve la saisie cachée jusqu’à Enregistrer', async () => {
    const onChange = vi.fn();
    const save = vi.spyOn(StorageManager, 'saveSettings').mockImplementation(async draft => ({ ...settings, ...draft }));
    render(<SettingsPanel open currentSettings={settings} onSettingsChange={onChange} onOpenChange={vi.fn()} />);
    const films = screen.getByRole('button', { name: 'Films et séries' });
    fireEvent.click(films);
    expect(films).toHaveAttribute('aria-expanded', 'true');
    const key = screen.getByLabelText(/Clé ou jeton TMDB/);
    expect(key).not.toHaveFocus();
    fireEvent.change(key, { target: { value: 'cle-en-brouillon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
    expect(key).not.toBeVisible();
    expect(key).toHaveValue('cle-en-brouillon');
    expect(films).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tmdbApiKey: 'cle-en-brouillon' }));
  });

  it('replie les rubriques à la réouverture', () => {
    const props = { currentSettings: settings, onSettingsChange: vi.fn(), onOpenChange: vi.fn() };
    const { rerender } = render(<SettingsPanel {...props} open />);
    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
    rerender(<SettingsPanel {...props} open={false} />);
    rerender(<SettingsPanel {...props} open />);
    expect(screen.getByRole('button', { name: 'Lecture' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('préserve les champs locaux et le PIN quand leur rubrique est repliée', () => {
    render(<SettingsPanel open currentSettings={{ ...settings, parentalControlEnabled: true, parentalPin: '1234' }} onSettingsChange={vi.fn()} onOpenChange={vi.fn()} />);
    const local = screen.getByRole('button', { name: 'Synchronisation locale (TV / Téléphone)' });
    fireEvent.click(local);
    const address = screen.getByPlaceholderText('http://192.168.1.42:48123/sync/…');
    fireEvent.change(address, { target: { value: 'http://192.168.1.2:48123/sync/test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Contrôle parental' }));
    const pin = screen.getByLabelText(/Code PIN/);
    fireEvent.change(pin, { target: { value: '5678' } });
    fireEvent.click(local);
    expect(address).toHaveValue('http://192.168.1.2:48123/sync/test');
    expect(pin).not.toBeVisible();
    expect(pin).toHaveValue('5678');
  });

  it('replie aussi les rubriques sur une TV étroite et place l’entrée sur Lecture', () => {
    render(<SettingsPanel open tvMode currentSettings={settings} onSettingsChange={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lecture' })).toHaveAttribute('data-remote-start');
    expect(screen.getByLabelText(/Clé ou jeton TMDB/)).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Lecture' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('adapte les rubriques quand la largeur change', () => {
    render(<SettingsPanel open currentSettings={settings} onSettingsChange={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByLabelText(/Clé ou jeton TMDB/)).toBeVisible();
  });
});

