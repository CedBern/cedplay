/**
 * Pays proposés pour les offres légales de streaming.
 *
 * TMDB (via JustWatch) publie la disponibilité pays par pays : un film sur
 * Netflix au Mexique peut être absent du catalogue français, et les
 * identifiants de fournisseurs diffèrent d'un pays à l'autre (Disney+ vaut
 * 2706 au Mexique, 337 en France). Ce module ne contient que des données :
 * ni stockage, ni réseau, pour rester importable partout.
 */

export const WATCH_REGIONS = [
  { code: 'MX', label: 'Mexique', phrase: 'au Mexique' },
  { code: 'FR', label: 'France', phrase: 'en France' },
  { code: 'ES', label: 'Espagne', phrase: 'en Espagne' },
  { code: 'US', label: 'États-Unis', phrase: 'aux États-Unis' },
  { code: 'CA', label: 'Canada', phrase: 'au Canada' },
  { code: 'AR', label: 'Argentine', phrase: 'en Argentine' },
  { code: 'CO', label: 'Colombie', phrase: 'en Colombie' },
  { code: 'CL', label: 'Chili', phrase: 'au Chili' },
  { code: 'BR', label: 'Brésil', phrase: 'au Brésil' },
  { code: 'GB', label: 'Royaume-Uni', phrase: 'au Royaume-Uni' },
  { code: 'BE', label: 'Belgique', phrase: 'en Belgique' },
  { code: 'CH', label: 'Suisse', phrase: 'en Suisse' },
] as const;

export type WatchRegion = (typeof WATCH_REGIONS)[number]['code'];

/** Pays par défaut des offres : le Mexique, où vit l'utilisateur de référence. */
export const DEFAULT_WATCH_REGION: WatchRegion = 'MX';

/** Plafond du réglage « mes abonnements » (identifiants TMDB). */
export const MAX_WATCH_SUBSCRIPTIONS = 30;

/** Code pays à deux lettres retenu s'il est proposé, sinon le pays par défaut. */
export function normalizeWatchRegion(value: unknown): WatchRegion {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (WATCH_REGIONS as readonly { code: string }[]).some(r => r.code === code)
    ? code as WatchRegion
    : DEFAULT_WATCH_REGION;
}

export function watchRegionLabel(region: string): string {
  return WATCH_REGIONS.find(r => r.code === region)?.label ?? region;
}

/** « au Mexique », « en France » : la préposition change selon le pays. */
export function watchRegionPhrase(region: string): string {
  return WATCH_REGIONS.find(r => r.code === region)?.phrase ?? `en ${watchRegionLabel(region)}`;
}

/** Abonnements retenus : identifiants TMDB positifs, dédoublonnés et plafonnés. */
export function normalizeWatchSubscriptions(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0);
  return [...new Set(ids)].slice(0, MAX_WATCH_SUBSCRIPTIONS);
}
