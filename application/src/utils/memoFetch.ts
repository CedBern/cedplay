// Déduplication des requêtes réseau en vol : deux appels concurrents identiques
// (même clé) partagent la même promesse au lieu de doubler la requête.

const inFlight = new Map<string, Promise<unknown>>();

export function memoFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn();
  inFlight.set(key, promise);
  const drop = () => { if (inFlight.get(key) === promise) inFlight.delete(key); };
  promise.then(drop, drop);
  return promise;
}
