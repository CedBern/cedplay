import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// IndexedDB remplacé par un faux openDB : on teste uniquement la robustesse de
// l'ouverture (échec mémorisé, attente bloquée, connexion terminée).
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('idb', () => ({ openDB: mocks.open }));

import { getPlaylistsFromDB } from '@/utils/idb';

const fakeDb = { getAll: vi.fn().mockResolvedValue([]) } as never;

beforeEach(() => { mocks.open.mockReset(); });
afterEach(() => {
  // `terminated` est le crochet naturel pour oublier la connexion entre deux tests.
  const calls = mocks.open.mock.calls;
  const options = calls[calls.length - 1]?.[2] as { terminated?: () => void } | undefined;
  options?.terminated?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ouverture IndexedDB', () => {
  it('ne mémorise pas un échec : l’appel suivant rouvre la base', async () => {
    mocks.open.mockRejectedValueOnce(new Error('VersionError')).mockResolvedValueOnce(fakeDb);
    await expect(getPlaylistsFromDB()).rejects.toThrow('VersionError');
    await expect(getPlaylistsFromDB()).resolves.toEqual([]);
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  it('borne une ouverture bloquée par un autre onglet puis retente', async () => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    mocks.open
      .mockReturnValueOnce(new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce(fakeDb);
    const pending = getPlaylistsFromDB();
    const rejected = expect(pending).rejects.toThrow('ouverture bloquée');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    // L'ancienne ouverture aboutit trop tard : elle ne doit pas remplacer la nouvelle.
    await release(fakeDb);
    await expect(getPlaylistsFromDB()).resolves.toEqual([]);
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  it('rouvre après une connexion terminée par le navigateur', async () => {
    mocks.open.mockResolvedValue(fakeDb);
    await getPlaylistsFromDB();
    const options = mocks.open.mock.calls[0][2] as { terminated?: () => void };
    options.terminated?.();
    await getPlaylistsFromDB();
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });
});
