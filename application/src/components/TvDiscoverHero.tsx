import { useState } from 'react';
import { safeImage } from '@/utils/xtreamCatalog';
import { PlatformLogo } from '@/components/PlatformLogo';
import { matchStreamingPlatformOrNetwork } from '@/utils/platformLogos';

export interface TvDiscoverSelection {
  key: string;
  eyebrow: string;
  title: string;
  meta?: string | undefined;
  description?: string | undefined;
  image?: string | undefined;
  imageLayout: 'cover' | 'poster' | 'logo' | 'square';
  hints: string;
  channelName?: string | undefined;
}

/** Les visuels appartiennent au contenu sélectionné ; aucun catalogue externe n'est interrogé. */
export function TvDiscoverHero({ selection }: { selection: TvDiscoverSelection }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = safeImage(selection.image);
  const isImageValid = Boolean(image && failedImage !== image);

  // Pour les chaînes TV en direct ou récentes : si pas d'image ou image défaillante,
  // tenter le logo vectoriel local (TF1, France TV, M6, Canal+, beIN, etc.)
  const targetChannelName = selection.channelName || (selection.imageLayout === 'logo' ? selection.title : '');
  const platformLogoId = (!isImageValid && selection.imageLayout === 'logo' && targetChannelName)
    ? matchStreamingPlatformOrNetwork(targetChannelName)
    : null;

  const hasImage = isImageValid || Boolean(platformLogoId);

  return <section aria-label="Contenu sélectionné" className="tv-discover-hero" data-image-layout={selection.imageLayout} data-has-image={hasImage}>
    <div className="tv-discover-hero-glow" aria-hidden="true" />
    {/* Ambiance : le même visuel, recadré et assombri derrière le texte. Aucune autre image n'est chargée. */}
    {isImageValid && selection.imageLayout !== 'logo' && selection.imageLayout !== 'cover' && <div className="tv-discover-hero-backdrop" aria-hidden="true">
      <img key={image} src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
    </div>}
    {hasImage && <div className="tv-discover-hero-art" aria-hidden="true">
      {isImageValid ? (
        <img key={image} src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
      ) : platformLogoId ? (
        <PlatformLogo platformId={platformLogoId} name={targetChannelName} className="w-24 h-20 rounded-xl" />
      ) : null}
    </div>}
    <div className="tv-discover-hero-copy" aria-live="polite" aria-atomic="true">
      <p className="tv-discover-hero-eyebrow">{selection.eyebrow}</p>
      <h1>{selection.title}</h1>
      {selection.meta && <p className="tv-discover-hero-meta">{selection.meta}</p>}
      {selection.description && <p className="tv-discover-hero-description">{selection.description}</p>}
      <p className="tv-discover-hero-hints">{selection.hints}</p>
    </div>
  </section>;
}
