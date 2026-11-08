import { streamingPlatforms } from '@/data/streamingPlatforms';

/** Plateformes choisies par l'utilisateur, gardées sur l'appareil (aucun compte, aucun envoi). */
const KEY = 'streaming_my_platforms';
const known = new Set(streamingPlatforms.map(p => p.id));

export function readMyPlatforms(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === 'string' && known.has(id)))];
  } catch {
    return [];
  }
}

export function writeMyPlatforms(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.filter(id => known.has(id))));
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}
