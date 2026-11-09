import { useEffect, useState } from 'react';
import { fetchRegionProviders, type TmdbProvider } from '@/utils/tmdb';
import { providerLogoUrl, watchRegionPhrase } from '@/utils/watchAvailability';

interface WatchSubscriptionsProps {
  apiKey: string;
  region: string;
  selected: number[];
  onChange: (ids: number[]) => void;
}

/**
 * Choix des abonnements du pays : la liste vient de TMDB, jamais d'une table
 * locale, car les identifiants de fournisseurs changent d'un pays à l'autre
 * (Disney+ vaut 2706 au Mexique et 337 en France).
 */
export function WatchSubscriptions({ apiKey, region, selected, onChange }: WatchSubscriptionsProps) {
  const [providers, setProviders] = useState<TmdbProvider[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    setProviders([]);
    if (!apiKey.trim()) { setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    void fetchRegionProviders(region, apiKey)
      .then(list => { if (!cancelled) { setProviders(list); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [apiKey, region]);

  const toggle = (providerId: number) => {
    onChange(selected.includes(providerId)
      ? selected.filter(id => id !== providerId)
      : [...selected, providerId]);
  };

  if (!apiKey.trim()) {
    return <p className="py-2 text-xs text-muted-foreground">Renseigne d’abord une clé TMDB : la liste des plateformes du pays vient de TMDB.</p>;
  }
  if (state === 'loading') {
    return <p role="status" className="py-2 text-xs text-muted-foreground">Chargement des plateformes {watchRegionPhrase(region)}…</p>;
  }
  if (state === 'error') {
    return <p role="status" className="py-2 text-xs text-muted-foreground">Liste des plateformes indisponible (réseau ou clé invalide).</p>;
  }
  if (!providers.length) return null;

  return (
    <div className="py-3">
      <span className="block text-sm text-foreground">Mes abonnements {watchRegionPhrase(region)}</span>
      <span className="block text-xs text-muted-foreground">
        Coche les plateformes que tu paies : la fiche d’un film propose alors une rangée de titres réellement diffusés chez elles dans ce pays.
      </span>
      <div role="group" aria-label={`Mes abonnements ${watchRegionPhrase(region)}`} className="mt-2 flex flex-wrap gap-2">
        {providers.slice(0, 40).map(provider => {
          const active = selected.includes(provider.providerId);
          return (
            <button
              key={provider.providerId}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(provider.providerId)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs ${
                active
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-neutral-800 text-muted-foreground hover:border-primary'
              }`}
            >
              {provider.logoPath && (
                <img src={providerLogoUrl(provider.logoPath)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-4 w-4 rounded" />
              )}
              {provider.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
