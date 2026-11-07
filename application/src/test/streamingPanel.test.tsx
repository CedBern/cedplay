import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StreamingPanel } from '@/components/StreamingPanel';
import { NativePlayerBridge } from '@/utils/nativePlayer';

describe('StreamingPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('affiche les plateformes majeures avec leurs noms et boutons', () => {
    render(<StreamingPanel />);
    expect(screen.getByText('Plateformes de streaming officielles')).toBeDefined();
    expect(screen.getByText('Netflix')).toBeDefined();
    expect(screen.getByText('Disney+')).toBeDefined();
    expect(screen.getByText('Prime Video')).toBeDefined();
    expect(screen.getByText('Crunchyroll')).toBeDefined();
    expect(screen.getByText('Pluto TV')).toBeDefined();
  });

  it('permet de filtrer par catégorie', () => {
    render(<StreamingPanel />);
    // Clic sur "Anime"
    const animeBtn = screen.getByRole('button', { name: /Anime/ });
    fireEvent.click(animeBtn);

    expect(screen.getByRole('heading', { name: 'Crunchyroll' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'ADN' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Netflix' })).toBeNull();
  });

  it('permet de rechercher une plateforme par nom', () => {
    render(<StreamingPanel />);
    const searchInput = screen.getByLabelText('Rechercher une plateforme');
    fireEvent.change(searchInput, { target: { value: 'crunchy' } });

    expect(screen.getByText('Crunchyroll')).toBeDefined();
    expect(screen.queryByText('Netflix')).toBeNull();
    expect(screen.queryByText('Disney+')).toBeNull();
  });

  it('déclenche NativePlayerBridge.openWeb lors du clic sur Ouvrir', async () => {
    const openWebSpy = vi.spyOn(NativePlayerBridge, 'openWeb').mockResolvedValue(true);
    vi.spyOn(NativePlayerBridge, 'isAvailable').mockReturnValue(true);

    render(<StreamingPanel />);
    const openButtons = screen.getAllByRole('button', { name: /Ouvrir/ });
    expect(openButtons.length).toBeGreaterThan(0);

    fireEvent.click(openButtons[0]);
    expect(openWebSpy).toHaveBeenCalled();
  });
});
