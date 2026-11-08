import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VodPoster } from '@/components/VodPoster';
import { MAX_FAILED_POSTERS, MAX_LOADED_POSTERS, clearPosterCache, failedPosterUrls, loadedPosterUrls, prefetchPosters, rememberFailedPoster, rememberLoadedPoster } from '@/utils/vodPosterCache';

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

  it('borne le cache des affiches : les plus anciennes entrées sortent', () => {
    for (let i = 0; i <= MAX_LOADED_POSTERS; i += 1) rememberLoadedPoster(`https://example.com/p${i}.jpg`);
    expect(loadedPosterUrls.size).toBe(MAX_LOADED_POSTERS);
    expect(loadedPosterUrls.has('https://example.com/p0.jpg')).toBe(false);
    expect(loadedPosterUrls.has(`https://example.com/p${MAX_LOADED_POSTERS}.jpg`)).toBe(true);

    for (let i = 0; i <= MAX_FAILED_POSTERS; i += 1) rememberFailedPoster(`https://example.com/bad${i}.jpg`);
    expect(failedPosterUrls.size).toBe(MAX_FAILED_POSTERS);
    expect(failedPosterUrls.has('https://example.com/bad0.jpg')).toBe(false);
  });

  it('ré-ajouter une affiche déjà connue ne change pas sa place dans le cache', () => {
    rememberLoadedPoster('https://example.com/first.jpg');
    rememberLoadedPoster('https://example.com/second.jpg');
    rememberLoadedPoster('https://example.com/first.jpg');
    const entries = [...loadedPosterUrls];
    expect(entries).toEqual(['https://example.com/first.jpg', 'https://example.com/second.jpg']);
  });
});
