/** Délai pendant lequel un second appui sur Retour confirme la sortie. */
export const EXIT_CONFIRM_MS = 2500;

/** Renvoie une fonction qui ne répond `true` qu'au second appel rapproché. */
export function createExitGuard(windowMs = EXIT_CONFIRM_MS, now: () => number = Date.now) {
  let last = -Infinity;
  return () => {
    const time = now();
    if (time - last <= windowMs) { last = -Infinity; return true; }
    last = time;
    return false;
  };
}
