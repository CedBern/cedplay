import React, { useState, useEffect } from 'react';
import { PlatformLogo } from '@/components/PlatformLogo';
import { matchStreamingPlatformOrNetwork } from '@/utils/platformLogos';

// Cache failed logo URLs to avoid repeated broken image flashes
const failedLogos = new Set<string>();
// Détection de plateforme mise en cache : les noms de chaînes se répètent sur des
// milliers de lignes et la détection enchaîne des dizaines d'expressions régulières.
const platformCache = new Map<string, string | null>();

interface ChannelLogoProps {
  src?: string | null | undefined;
  name: string;
  compact?: boolean | undefined;
}

const ChannelLogoBase: React.FC<ChannelLogoProps> = ({ src, name, compact }) => {
  const [loaded, setLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const sizeClass = compact ? 'w-8 h-8' : 'w-12 h-12';

  // Default logo path for fallback
  const defaultLogo = '/default-logo.svg';

  let detectedPlatformId = platformCache.get(name);
  if (detectedPlatformId === undefined) {
    detectedPlatformId = matchStreamingPlatformOrNetwork(name);
    platformCache.set(name, detectedPlatformId);
  }

  // Ligne recyclée avec une autre chaîne : repartir du fond animé le temps du chargement.
  useEffect(() => { setLoaded(false); }, [src]);

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

  return (
    <div className={`relative ${sizeClass} shrink-0`}>
      {!loaded && (
        <div className={`absolute inset-0 rounded-lg bg-muted animate-pulse`} />
      )}
      {/* Chargement paresseux et décodage asynchrones gérés par le navigateur :
          plus d'observateur d'intersection par instance (coût au défilement). */}
      {/* object-contain (et non cover) : les logos rectangulaires ou circulaires doivent
          rester entiers — cover rognerait les bords et couperait les logos arrondis. */}
      <img
        src={src}
        data-src={src}
        alt="" aria-hidden="true"
        loading="lazy"
        decoding="async"
        className={`object-contain rounded-lg p-0.5 w-full h-full transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          const url = (e.currentTarget.getAttribute('data-src') || src) as string;
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

// Mémoïsé : les listes virtualisées re-rendent toutes leurs lignes à chaque image de
// défilement ; le logo ne doit suivre que ses propres props (src, nom, taille).
export const ChannelLogo = React.memo(ChannelLogoBase);

// Attach helper to component for optional external clearing without separate export
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ChannelLogo as any).clearCache = () => { failedLogos.clear(); platformCache.clear(); };
