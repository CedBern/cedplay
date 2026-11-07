import { describe, expect, it, vi } from 'vitest';
import { memoFetch } from '@/utils/memoFetch';

// Chaque test utilise des clés uniques : la map inFlight est globale au module
// et ne survit qu'aux promesses en vol (pas de cache persistant).

describe('memoFetch', () => {
  it('partage la même promesse pour deux appels concurrents de même clé', async () => {
    const fn = vi.fn(async () => 'résultat');
    const [a, b] = await Promise.all([
      memoFetch('key-shared', fn),
      memoFetch('key-shared', fn),
    ]);
    expect(a).toBe('résultat');
    expect(b).toBe('résultat');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('appelle fn séparément pour des clés différentes', async () => {
    const fn = vi.fn(async (n: string) => n);
    const [a, b] = await Promise.all([
      memoFetch('key-a', () => fn('a')),
      memoFetch('key-b', () => fn('b')),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rappelle fn après résolution : pas de cache persistant', async () => {
    const fn = vi.fn(async () => 'valeur');
    await memoFetch('key-once', fn);
    await memoFetch('key-once', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('purge l\'entrée après un rejet : fn est rappelée', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('échec réseau'))
      .mockResolvedValueOnce('reprise');
    await expect(memoFetch('key-fail', fn)).rejects.toThrow('échec réseau');
    await expect(memoFetch('key-fail', fn)).resolves.toBe('reprise');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
