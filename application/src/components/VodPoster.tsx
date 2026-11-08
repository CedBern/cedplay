import { memo, useEffect, useState } from 'react';
import { failedPosterUrls, loadedPosterUrls, rememberFailedPoster, rememberLoadedPoster } from '@/utils/vodPosterCache';

export interface VodPosterProps {
  src?: string | null | undefined;
  alt?: string | undefined;
  kind?: 'movie' | 'series' | undefined;
  fallbackIconSize?: string | undefined;
  className?: string | undefined;
}

/**
 * Affiche de film/série avec :
 * 1. Synchronisation de ligne : affichage instantané (0 ms) si déjà en cache mémoire
 * 2. Placeholder doux (shimmer pulse) au lieu d'un bloc noir vide lors du premier chargement
 * 3. Transition d'opacité fluide (fade-in) évitant tout pop-in asymétrique ou saccadé
 * 4. Repli élégant en cas d'erreur de chargement
 */
export const VodPoster = memo(function VodPoster({
  src,
  alt = '',
  kind = 'movie',
  fallbackIconSize = 'text-3xl',
  className = 'w-full h-full object-cover',
}: VodPosterProps) {
  const isInitiallyLoaded = Boolean(src && loadedPosterUrls.has(src));
  const isInitiallyFailed = Boolean(src && failedPosterUrls.has(src));

  const [loaded, setLoaded] = useState(isInitiallyLoaded);
  const [error, setError] = useState(isInitiallyFailed);

  useEffect(() => {
    if (!src) {
      setLoaded(false);
      setError(false);
      return;
    }
    setLoaded(loadedPosterUrls.has(src));
    setError(failedPosterUrls.has(src));
  }, [src]);

  if (!src || error) {
    return (
      <span className={fallbackIconSize} aria-hidden="true">
        {kind === 'movie' ? '🎬' : '📺'}
      </span>
    );
  }

  return (
    <>
      {!loaded && (
        <div
          className="absolute inset-0 bg-neutral-800/60 animate-pulse pointer-events-none"
          aria-hidden="true"
        />
      )}
      <img
        src={src}
        alt={alt}
        decoding="async"
        referrerPolicy="no-referrer"
        className={`${className} transition-opacity duration-300 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => {
          rememberLoadedPoster(src);
          setLoaded(true);
        }}
        onError={() => {
          rememberFailedPoster(src);
          setError(true);
          setLoaded(false);
        }}
      />
    </>
  );
});
