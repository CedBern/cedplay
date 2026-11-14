import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SettingsPanel } from '@/components/SettingsPanel';
import { StorageManager } from '@/utils/storage';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';

describe('Saisie des réglages à la télécommande', () => {
  afterEach(() => vi.restoreAllMocks());
  it('attend OK sur chaque champ et réserve le premier Retour à la sortie de saisie', () => {
    const close = vi.fn();
    render(<SettingsPanel open tvMode currentSettings={{ ...StorageManager.defaultSettings(), parentalControlEnabled: true, parentalPin: '1234' }} onSettingsChange={vi.fn()} onOpenChange={close} />);
    const fields = Array.from(screen.getByRole('dialog').querySelectorAll('input[data-remote-input]'));
    expect(fields).toHaveLength(8);
    for (const field of fields) {
      expect(field).toHaveAttribute('readonly');
      expect(field).toHaveAttribute('inputmode', 'none');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Films et séries' }));
    const input = screen.getByLabelText(/Clé ou jeton TMDB/);
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: 'brouillon-tv' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveValue('brouillon-tv');
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).toHaveBeenCalledWith(false);
  });

  it('déplace le focus entre les champs sans ouvrir leur saisie, y compris dans la synchronisation locale', async () => {
    function Page() {
      useRemoteNavigation();
      return <SettingsPanel open tvMode currentSettings={StorageManager.defaultSettings()} onSettingsChange={vi.fn()} onOpenChange={vi.fn()} />;
    }
    await act(async () => { render(<Page />); });
    fireEvent.click(screen.getByRole('button', { name: 'Sous-titres' }));
    const guide = screen.getByLabelText(/Clé API DeepL/);
    const tmdb = screen.getByLabelText(/Clé API OpenSubtitles/);
    const address = screen.getByPlaceholderText('http://192.168.1.42:48123/sync/…');
    const name = screen.getByPlaceholderText('Nom (ex. TV Salon, facultatif)');
    const fields = [guide, tmdb, address, name];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = fields.indexOf(this);
      return { x: 10, y: index * 60, left: 10, top: index * 60, right: 310, bottom: index * 60 + 44, width: index < 0 ? 0 : 300, height: index < 0 ? 0 : 44, toJSON: () => ({}) };
    });
    guide.focus();
    fireEvent.keyDown(guide, { key: 'ArrowDown' });
    expect(tmdb).toHaveFocus();
    expect(tmdb).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Synchronisation locale (TV / Téléphone)' }));
    address.focus();
    fireEvent.keyDown(address, { key: 'ArrowDown' });
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('readonly');
  });

  it('descend dans les options avant de rejoindre les actions fixées en bas', async () => {
    function Page() {
      useRemoteNavigation();
      return <SettingsPanel open tvMode currentSettings={StorageManager.defaultSettings()} onSettingsChange={vi.fn()} onOpenChange={vi.fn()} />;
    }
    await act(async () => { render(<Page />); });
    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }));
    const autoplay = screen.getByLabelText('Lire automatiquement la chaîne sélectionnée');
    const reload = screen.getByRole('button', { name: 'Listes et guide TV' });
    const cancel = screen.getByRole('button', { name: 'Annuler' });
    const options = Array.from(screen.getByRole('dialog').querySelectorAll('input, button')).filter(el => el !== cancel && el.textContent !== 'Enregistrer' && el.textContent !== 'Close');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = options.indexOf(this);
      const y = this === cancel ? 275 : index * 60;
      return { x: 10, y, left: 10, top: y, right: 310, bottom: y + 44, width: index < 0 && this !== cancel ? 0 : 300, height: index < 0 && this !== cancel ? 0 : 44, toJSON: () => ({}) };
    });
    autoplay.focus();
    for (let step = 0; step < 5; step++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(cancel).not.toHaveFocus();
    expect(reload).toHaveFocus();
  });
});
