import type { ChannelGroup } from '@/types/channel';

// Heuristique simple et volontairement prudente : ne verrouille que les groupes
// dont le nom contient un marqueur explicite de contenu pour adultes.
// L'utilisateur peut ensuite affiner via les réglages si besoin.
const ADULT_RE = /(xxx|adult|adulte|18\s*\+|pour\s+adultes|érotique|erotique|erotic|porno(graphie|graphic)?|porn)/i;

export function isAdultGroupName(name: string): boolean {
  return ADULT_RE.test(name);
}

export function adultGroupNames(groups: ChannelGroup[]): string[] {
  return groups.map(g => g.name).filter(isAdultGroupName);
}

/** Valide qu'un code PIN est exploitable (4 à 8 chiffres). */
export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
