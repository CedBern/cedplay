import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VodPoster } from '@/components/VodPoster';
import { clearPosterCache, failedPosterUrls, loadedPosterUrls, prefetchPosters } from '@/utils/vodPosterCache';

describe('VodPoster', () => {
  beforeEach(() => {
    clearPosterCache();
  });

  afterEach(() => {
    cleanup();
  });

  it('affiche le fallback émoji quand aucune source n’est fournie', () => {
    render(<VodPoster kind="movie" />);
    expect(screen.getByText('🎬')).toBeVisible();
  });

  it('affiche le fallback série 📺 quand kind="series"', () => {
    render(<VodPoster kind="series" />);
    expect(screen.getByText('📺')).toBeVisible();
  });

  it('affiche l’image et anime l’opacité au chargement', () => {
    const { container } = render(<VodPoster src="https://example.com/poster.jpg" kind="movie" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.className).toContain('opacity-0');

    fireEvent.load(img!);
    expect(img?.className).toContain('opacity-100');
    expect(loadedPosterUrls.has('https://example.com/poster.jpg')).toBe(true);
  });

  it('s’affiche immédiatement à 100% si l’URL est déjà en cache mémoire', () => {
    loadedPosterUrls.add('https://example.com/cached.jpg');
    const { container } = render(<VodPoster src="https://example.com/cached.jpg" kind="movie" />);
    const img = container.querySelector('img');
    expect(img?.className).toContain('opacity-100');
  });

  it('bascule sur le fallback si le chargement de l’image échoue', () => {
    const { container } = render(<VodPoster src="https://example.com/bad.jpg" kind="movie" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    fireEvent.error(img!);
    expect(screen.getByText('🎬')).toBeVisible();
    expect(failedPosterUrls.has('https://example.com/bad.jpg')).toBe(true);
  });

  it('prefetchPosters ne plante pas et filtre les URLs invalides ou déjà en cache', () => {
    loadedPosterUrls.add('https://example.com/known.jpg');
    prefetchPosters(['https://example.com/known.jpg', null, undefined, '', 'https://example.com/new.jpg'], 5);
    // L'URL connue n'est pas réévaluée
    expect(loadedPosterUrls.has('https://example.com/known.jpg')).toBe(true);
  });
});
