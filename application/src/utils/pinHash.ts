// Le PIN parental n'est plus stocké en clair : SHA-256 salé (Web Crypto).
// Format stocké : « sha256:<salt hex>:<empreinte hex> ». Les PIN en clair déjà
// enregistrés restent vérifiables (comparePlain) et sont hachés silencieusement
// après une vérification réussie (maybeUpgradePin) ou au prochain enregistrement
// des réglages.

const HASH_PREFIX = 'sha256:';

export function isHashedPin(stored: string | undefined | null): boolean {
  return typeof stored === 'string' && stored.startsWith(HASH_PREFIX);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Empreinte SHA-256(salt:PIN) au format « sha256:<salt>:<hex> ». */
export async function hashPin(pin: string, salt?: string): Promise<string> {
  const actualSalt = salt ?? toHex(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${actualSalt}:${pin}`));
  return `${HASH_PREFIX}${actualSalt}:${toHex(new Uint8Array(digest))}`;
}

/** Comparaison à durée constante (les deux empreintes ont la même longueur). */
function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Vérifie un PIN saisi contre la valeur stockée (hachée, ou en clair pour les anciennes données). */
export async function verifyPin(candidate: string, stored: string | undefined | null): Promise<boolean> {
  if (!stored) return false;
  if (!isHashedPin(stored)) return candidate === stored;
  const salt = stored.split(':')[1];
  if (!salt) return false;
  try {
    return equalHex(await hashPin(candidate, salt), stored);
  } catch {
    return false;
  }
}

/** Hache un PIN encore stocké en clair après une vérification réussie (migration silencieuse). */
export async function maybeUpgradePin(
  stored: string | undefined | null,
  save: (settings: { parentalPin: string }) => Promise<unknown>,
): Promise<void> {
  if (!stored || isHashedPin(stored)) return;
  try {
    await save({ parentalPin: await hashPin(stored) });
  } catch {
    /* indisponible : le PIN en clair reste valable, nouvelle tentative au prochain déverrouillage */
  }
}
