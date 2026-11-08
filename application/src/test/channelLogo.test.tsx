import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChannelLogo } from '@/components/ChannelLogo';

describe('ChannelLogo', () => {
  beforeEach(() => {
    (ChannelLogo as unknown as { clearCache: () => void }).clearCache();
  });

  it('affiche le logo vectoriel de la plateforme si aucun src n’est fourni', () => {
    render(<ChannelLogo name="FR | NETFLIX 4K" />);
    // Le composant PlatformLogo pour Netflix a le title "FR | NETFLIX 4K" et contient le SVG
    const logoContainer = screen.getByTitle('FR | NETFLIX 4K');
    expect(logoContainer).toBeDefined();
    expect(logoContainer.querySelector('svg')).not.toBeNull();
  });

  it('affiche le logo vectoriel Disney+ pour une chaîne Disney', () => {
    render(<ChannelLogo name="DISNEY+ CINEMA" />);
    const logoContainer = screen.getByTitle('DISNEY+ CINEMA');
    expect(logoContainer).toBeDefined();
    expect(logoContainer.querySelector('svg')).not.toBeNull();
  });

  it('bascule vers le logo vectoriel si le chargement de l’image src échoue', () => {
    const { container } = render(<ChannelLogo src="https://example.com/broken-netflix.png" name="NETFLIX ACTION" />);
    const img = container.querySelector('img');
    if (img) {
      fireEvent.error(img);
    }
    // Après erreur, le logo vectoriel Netflix prend le relais
    const logoContainer = screen.getByTitle('NETFLIX ACTION');
    expect(logoContainer).toBeDefined();
    expect(logoContainer.querySelector('svg')).not.toBeNull();
  });

  it('affiche le trigramme par défaut si la chaîne n’est pas une plateforme reconnue', () => {
    render(<ChannelLogo name="CNN News" />);
    expect(screen.getByText('CNN')).toBeDefined();
  });

  it('affiche l’image du logo en entier (object-contain, jamais rognée par object-cover)', () => {
    const { container } = render(<ChannelLogo src="https://example.com/tf1.png" name="TF1" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // Les logos arrondis/rectangulaires doivent rester visibles intégralement.
    expect(img?.className).toContain('object-contain');
    expect(img?.className).not.toContain('object-cover');
  });
});
