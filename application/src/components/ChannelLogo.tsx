import React, { useState, useRef, useEffect } from 'react';
import { PlatformLogo } from '@/components/PlatformLogo';
import { matchStreamingPlatformOrNetwork } from '@/utils/platformLogos';

// Cache failed logo URLs to avoid repeated broken image flashes
const failedLogos = new Set<string>();

interface ChannelLogoProps {
  src?: string | null | undefined;
  name: string;
  compact?: boolean | undefined;
}

export const ChannelLogo: React.FC<ChannelLogoProps> = ({ src, name, compact }) => {
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [imageError, setImageError] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  const sizeClass = compact ? 'w-8 h-8' : 'w-12 h-12';

  // Default logo path for fallback
  const defaultLogo = '/default-logo.svg';

  const detectedPlatformId = matchStreamingPlatformOrNetwork(name);

  useEffect(() => {
    if (!ref.current) return;
    if (!src || failedLogos.has(src)) return; // nothing to observe
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    // IntersectionObserver for lazy reveal
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      });
    }, { rootMargin: '100px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [src]);

  // If no src provided or error occurred, check if name matches a known platform/channel logo
  if (!src || failedLogos.has(src) || imageError) {
    if (detectedPlatformId) {
      return (
        <PlatformLogo
          platformId={detectedPlatformId}
          name={name}
          compact={compact}
          className={`${sizeClass} rounded-lg`}
        />
      );
    }
    return (
      <div className={`${sizeClass} rounded-lg bg-muted flex items-center justify-center`}> 
        <span className={`text-[10px] uppercase tracking-wide ${compact ? 'text-[9px]' : ''}`}>{name.slice(0, 3)}</span>
      </div>
    );
  }

  // Use default logo if src fails
  const logoSrc = imageError ? defaultLogo : src;

  return (
    <div className={`relative ${sizeClass} shrink-0`}> 
      {!loaded && (
        <div className={`absolute inset-0 rounded-lg bg-muted animate-pulse`} />
      )}
      <img
        ref={ref}
        src={visible ? logoSrc : undefined}
        data-src={logoSrc}
        alt="" aria-hidden="true"
        loading="lazy"
        className={`object-cover rounded-lg w-full h-full transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          const url = (e.currentTarget.getAttribute('data-src') || logoSrc) as string;
          if (url && url !== defaultLogo) {
            failedLogos.add(url);
            setImageError(true);
          }
          setLoaded(false);
        }}
      />
    </div>
  );
};

// Attach helper to component for optional external clearing without separate export
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ChannelLogo as any).clearCache = () => failedLogos.clear();
