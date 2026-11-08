import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { watchNativeFavorites } from '@/utils/nativeFavorites';
import type { Channel } from '@/types/channel';

const mocks = vi.hoisted(() => ({
  platform: 'android', callback: undefined as (() => void) | undefined,
  pending: [] as { channelUrl: string; favorite: boolean; revision: number }[],
  favorites: [] as string[],
  get: vi.fn(), save: vi.fn(), ack: vi.fn(), snapshot: vi.fn(), remove: vi.fn(), error: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform, isPluginAvailable: () => true },
  registerPlugin: () => ({
    getFavoriteChanges: async () => ({ entries: [...mocks.pending] }),
    acknowledgeFavoriteChanges: mocks.ack,
    setFavoritesSnapshot: mocks.snapshot,
    addListener: async (_: string, callback: () => void) => { mocks.callback = callback; return { remove: mocks.remove }; },
  }),
}));
vi.mock('@/utils/idb', () => ({ getFavoritesFromDB: mocks.get, saveFavoritesToDB: mocks.save }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
const channels: Channel[] = [{ id: 'one', name: 'Une', url: 'https://example.test/1',
  variants: [{ id: 'hd', name: 'Une HD', url: 'https://example.test/hd' }] }];
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks(); mocks.platform = 'android'; mocks.pending = []; mocks.favorites = ['other-list'];
  mocks.get.mockImplementation(async () => [...mocks.favorites]);
  mocks.save.mockImplementation(async (value: string[]) => { mocks.favorites = value; });
  mocks.ack.mockImplementation(async ({ entries }) => {
    mocks.pending = mocks.pending.filter(p => !entries.some((entry: typeof p) => entry.channelUrl === p.channelUrl && entry.revision === p.revision));
  });
  mocks.snapshot.mockResolvedValue(undefined);
});
afterEach(() => { stop?.(); stop = undefined; });

describe('Favoris depuis le lecteur natif', () => {
  it('importe le journal au redémarrage et garde les favoris des autres listes', async () => {
    mocks.pending = [{ channelUrl: channels[0].url, favorite: true, revision: 1 }];
    stop = watchNativeFavorites(channels);
    await waitFor(() => expect(mocks.favorites).toEqual(['other-list', 'one']));
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledWith({ urls: [channels[0].url, channels[0].variants![0].url] }));
    expect(mocks.pending).toEqual([]);
  });
  it('applique un retrait et un ajout de variante reçus pendant la lecture', async () => {
    mocks.favorites = ['other-list', 'one'];
    stop = watchNativeFavorites(channels);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalled());
    mocks.pending = [{ channelUrl: channels[0].url, favorite: false, revision: 2 },
      { channelUrl: channels[0].variants![0].url, favorite: true, revision: 3 }];
    mocks.callback?.();
    await waitFor(() => expect(mocks.favorites).toEqual(['other-list', 'one']));
    await waitFor(() => expect(mocks.pending).toEqual([]));
  });
  it('applique la dernière intention entre deux variantes, indépendamment de l’ordre JSON', async () => {
    mocks.pending = [{ channelUrl: channels[0].variants![0].url, favorite: false, revision: 3 },
      { channelUrl: channels[0].url, favorite: true, revision: 2 }];
    stop = watchNativeFavorites(channels);
    await waitFor(() => expect(mocks.ack).toHaveBeenCalled());
    expect(mocks.favorites).toEqual(['other-list']);
    expect(mocks.pending).toEqual([]);
  });
  it('conserve le journal et ne confirme rien si IndexedDB refuse l’écriture', async () => {
    mocks.pending = [{ channelUrl: channels[0].url, favorite: true, revision: 1 }];
    mocks.save.mockRejectedValueOnce(new Error('QuotaExceededError'));
    stop = watchNativeFavorites(channels);
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.pending).toHaveLength(1);
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(mocks.pending).toEqual([]));
    expect(mocks.favorites).toEqual(['other-list', 'one']);
  });
  it('conserve les changements d’une liste qui n’est pas ouverte', async () => {
    mocks.pending = [{ channelUrl: 'https://example.test/another-list', favorite: true, revision: 9 }];
    stop = watchNativeFavorites(channels);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalled());
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.pending).toHaveLength(1);
  });
  it('ignore le pont sur navigateur', () => {
    mocks.platform = 'web';
    stop = watchNativeFavorites(channels);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
