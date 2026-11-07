// Secrets de réglages : jamais journalisés ni affichés en clair.
// Utilisé à deux endroits : à l'écriture du journal de changements (storage.ts)
// et à l'affichage des Diagnostics (SettingsPanel, qui couvre aussi les entrées
// écrites avant l'introduction du masquage).

const SECRET_KEYS: ReadonlySet<string> = new Set([
  'tmdbApiKey',
  'deeplApiKey',
  'openSubtitlesApiKey',
  'subdlApiKey',
  'parentalPin',
]);

const MASK = '••••';

/** Valeur masquée si la clé porte un secret, sinon la valeur inchangée. */
export function redactSetting(key: string, value: unknown): unknown {
  if (!SECRET_KEYS.has(key) || value === undefined || value === null || value === '') return value;
  return MASK;
}

/** Journal de changements assaini pour l'affichage. */
export function redactChangeLog<T extends { changes: Record<string, unknown> }>(entries: T[]): T[] {
  return entries.map(entry => {
    const changes = entry.changes ?? {};
    if (!Object.keys(changes).some(key => SECRET_KEYS.has(key))) return entry;
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) safe[key] = redactSetting(key, value);
    return { ...entry, changes: safe };
  });
}
