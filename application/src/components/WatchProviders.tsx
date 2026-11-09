import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { fetchWatchProviders, type TmdbKind } from '@/utils/tmdb';
import {
  OFFER_KIND_LABELS, providerLogoUrl, watchPackagesFor, watchUrlFor,
  type WatchAvailability, type WatchOffer,
} from '@/utils/watchAvailability';

interface WatchProvidersProps {
  tmdbId: number;
  kind: 'movie' | 'series';
  title: string;
  apiKey: string | undefined;
}

/** Ouvre l'app officielle de la plateforme (ou son site) sur la recherche du titre. */
function openTarget(url: string, label: string, packages: string[] | undefined) {
  if (NativePlayerBridge.isAvailable()) {
    void NativePlayerBridge.openWeb(url, label, packages, true).catch(() => toast.error(`Impossible d’ouvrir ${label}.`));
    return;
  }
  // Sur le Web, pas d'app à ouvrir : la recherche s'ouvre dans un nouvel onglet.
  const win = window.open(url, '_blank');
  if (win) win.opener = null;
  else toast.error(`Impossible d’ouvrir ${label} (bloqueur de fenêtres).`);
}

/**
 * « Où regarder » : offres légales en France d'après TMDB, chaque pastille ouvrant
 * l'application officielle de la plateforme (Netflix, Prime Video, Arte…).
 * Silencieux sans clé TMDB, hors réseau ou si le titre n'a aucune offre connue.
 */
export function WatchProviders({ tmdbId, kind, title, apiKey }: WatchProvidersProps) {
  const tmdbKind: TmdbKind = kind === 'movie' ? 'movie' : 'tv';
  const [availability, setAvailability] = useState<WatchAvailability | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>('idle');

  useEffect(() => {
    setAvailability(null);
    if (!apiKey?.trim() || !tmdbId) { setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    void fetchWatchProviders(tmdbId, tmdbKind, apiKey)
      .then(result => { if (!cancelled) { setAvailability(result); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('idle'); });
    return () => { cancelled = true; };
  }, [apiKey, tmdbId, tmdbKind]);

  const openOffer = useCallback((offer: WatchOffer) => {
    const url = watchUrlFor(offer.platformId, title) ?? availability?.link;
    if (!url) return;
    openTarget(url, offer.displayName || offer.name, watchPackagesFor(offer.platformId));
  }, [availability?.link, title]);

  if (state === 'idle') return null;
  if (state === 'loading') return <p role="status" className="text-xs text-neutral-500">Recherche des offres légales…</p>;
  if (!availability) return null;

  const openAllOffers = () => {
    if (availability.link) openTarget(availability.link, 'les offres', undefined);
  };

  if (!availability.offers.length) {
    return (
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Où regarder</p>
        <p className="text-xs text-neutral-400">
          Aucune offre légale répertoriée en France.
          {availability.link && <> <button type="button" onClick={openAllOffers} className="text-primary hover:underline">Voir sur TMDB</button></>}
        </p>
        <p className="text-[10px] text-neutral-500">Données de disponibilité : JustWatch via TMDB</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="watch-providers">
      <p className="text-xs uppercase tracking-wide text-neutral-500">Où regarder en France</p>
      <div className="flex flex-wrap gap-1.5">
        {availability.offers.map(offer => (
          <button
            key={offer.providerId}
            type="button"
            data-provider={offer.platformId ?? offer.providerId}
            onClick={() => openOffer(offer)}
            className="flex items-center gap-1.5 rounded-full border border-neutral-800 bg-white/5 px-2.5 py-1 text-xs text-neutral-200 hover:border-primary"
            title={`Ouvrir ${offer.displayName || offer.name}${offer.distributedBy ? ` via ${offer.distributedBy}` : ''} — ${OFFER_KIND_LABELS[offer.kind]}`}
          >
            {offer.logoPath
              ? <img src={providerLogoUrl(offer.logoPath)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-4 w-4 rounded" />
              : <span className="h-2 w-2 rounded-full bg-neutral-500" aria-hidden="true" />}
            <span>{offer.displayName || offer.name}</span>
            {offer.distributedBy && <span className="text-neutral-500">via {offer.distributedBy}</span>}
            {offer.kind !== 'flatrate' && <span className="text-neutral-500">· {OFFER_KIND_LABELS[offer.kind]}</span>}
          </button>
        ))}
      </div>
      {availability.link && (
        <button type="button" onClick={openAllOffers} className="text-[11px] text-neutral-500 hover:text-primary inline-flex items-center gap-1">
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Toutes les offres (TMDB)
        </button>
      )}
      <p className="text-[10px] text-neutral-500">Données de disponibilité : JustWatch via TMDB</p>
    </div>
  );
}
