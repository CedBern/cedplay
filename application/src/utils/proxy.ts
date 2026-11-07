// Relais CORS pour les builds web hébergés.
// Par défaut, l'application de développement utilise le relais local
// (démarré par `pnpm proxy`) ; pour un build web déployé sur un serveur,
// renseigne l'adresse de ton relais dans les paramètres (champ « Relais web »).

import { StorageManager } from '@/utils/storage';

export const DEFAULT_PROXY = 'http://127.0.0.1:5179';

function normalize(base: string): string {
  const candidate = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.origin && parsed.origin !== 'null') {
      return parsed.origin;
    }
  } catch {
    /* ignore and return empty */
  }
  return '';
}

/** Base (origine) du relais web à utiliser pour les requêtes CORS. */
export function getProxyBase(): string {
  try {
    const configured = StorageManager.getCachedSettings().proxyUrl?.trim();
    if (configured) {
      const origin = normalize(configured);
      if (origin) return origin;
    }
  } catch {
    /* réglages indisponibles : relais par défaut */
  }
  return DEFAULT_PROXY;
}
