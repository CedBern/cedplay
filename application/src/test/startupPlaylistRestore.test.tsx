import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Channel, PlaylistInfo } from '@/types/channel';

// Réglages et base de données simulés : le chemin rapide ne doit pas tout relire.
const state = vi.hoisted(() => ({
  settings: { theme: 'dark', autoLoadLastPlaylist: true } as Record<string, unknown>,
  playlists: [] as PlaylistInfo[],
  meta: {} as Record<string, unknown>,
}));

vi.mock('@/utils/storage', () => ({
  StorageManager: {
    getSettings: () => state.settings,
    loadSettingsAsync: async () => state.settings,
    getLastPlaylist: () => 'Ma liste',
    setLastPlaylist: vi.fn(),
  },
}));

vi.mock('@/utils/idb', () => ({
  getPlaylistsFromDB: vi.fn(async () => state.playlists),
  getPlaylistFromDB: vi.fn(async (id: string) => state.playlists.find(p => p.id === id)),
  savePlaylistToDB: vi.fn(async () => {}),
  getLastChannelForPlaylist: vi.fn(async () => 'a'),
  setLastChannelForPlaylist: vi.fn(async () => {}),
  getMeta: vi.fn(async (key: string) => state.meta[key]),
  setMeta: vi.fn(async () => {}),
  setMetaMany: vi.fn(async () => {}),
  deleteMeta: vi.fn(async () => {}),
  getFavoritesFromDB: vi.fn(async () => []),
  saveFavoritesToDB: vi.fn(async () => {}),
  getPlayHistory: vi.fn(async () => []),
  pushPlayHistory: vi.fn(async () => {}),
  updateVodHistoryProgress: vi.fn(async () => {}),
  getSettingsFromDB: vi.fn(async () => undefined),
  saveSettingsToDB: vi.fn(async () => {}),
  getSettingsChangeLog: vi.fn(async () => []),
  getSettingsMigrationStats: vi.fn(async () => ({})),
  updateSettingsMigrationStats: vi.fn(async () => {}),
  pushSettingsChangeLogEntry: vi.fn(async () => {}),
  getTelemetryEventsFromDB: vi.fn(async () => undefined),
  saveTelemetryEventsToDB: vi.fn(async () => {}),
  // Le panneau d'accueil est monté de façon différée (React.lazy) : sa course avec la fin du
  // test est indéterminée, donc tout ce qu'il lit au montage doit exister dans le mock — sinon
  // une rejection non gérée fait échouer la suite (tests pourtant verts, code de sortie en erreur).
  getVodWatchlistFromDB: vi.fn(async () => []),
  toggleVodWatchlist: vi.fn(async () => []),
  historyScope: vi.fn((raw: unknown) => raw),
  manageContinueEntry: vi.fn(async () => {}),
}));

import * as idb from '@/utils/idb';
import { IPTVPlayer } from '@/components/IPTVPlayer';

const channels: Channel[] = [
  { id: 'a', name: 'TF1', url: 'https://example.test/a', group: 'France' },
  { id: 'b', name: 'M6', url: 'https://example.test/b', group: 'France' },
];
const playlist: PlaylistInfo = { id: 'p1', name: 'Ma liste', channels, groups: [{ name: 'France', channels }] };

beforeEach(() => {
  localStorage.clear();
  state.settings = { theme: 'dark', autoLoadLastPlaylist: true };
  state.playlists = [playlist];
  state.meta = { lastPlaylistId: 'p1' };
  vi.clearAllMocks();
  state.meta = { lastPlaylistId: 'p1' };
});
afterEach(cleanup);

describe('Démarrage : restauration de la dernière liste', () => {
  it('ne lit que la dernière liste utilisée, pas toutes les listes', async () => {
    render(<IPTVPlayer />);
    await waitFor(() => expect(screen.getByLabelText('Connexion Xtream')).toBeTruthy());
    expect(idb.getPlaylistFromDB).toHaveBeenCalledWith('p1');
    expect(idb.getPlaylistsFromDB).not.toHaveBeenCalled();
  });

  it('sans dernier identifiant connu, replie sur la lecture de toutes les listes', async () => {
    state.meta = {};
    render(<IPTVPlayer />);
    await waitFor(() => expect(idb.getPlaylistsFromDB).toHaveBeenCalled());
  });

  it('l’écran « Mes listes » charge toutes les listes à la demande', async () => {
    state.settings = { theme: 'dark', autoLoadLastPlaylist: false };
    render(<IPTVPlayer />);
    await waitFor(() => expect(idb.getPlaylistsFromDB).toHaveBeenCalled());
    // La liste active reste passée par le chemin rapide (une seule lecture).
    expect(idb.getPlaylistFromDB).toHaveBeenCalledWith('p1');
  });
});
