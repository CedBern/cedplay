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
    getCachedSettings: () => state.settings,
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

vi.mock('@/utils/publicPlaylist', () => ({
  PUBLIC_PLAYLIST_INITIALIZED: 'publicPlaylistInitialized',
  PUBLIC_PLAYLIST_ID: 'cedplay-public-v1',
  playlistDisplayName: (p: PlaylistInfo) => p.name,
  isLegacyPublicPlaylist: () => false,
  reconcilePublicPlaylist: (_previous: PlaylistInfo, incoming: PlaylistInfo) => incoming,
  loadPublicPlaylist: vi.fn(async () => {
    const channels = [{ id: 'free', name: 'Canal 22', url: 'https://example.test/free.m3u8', group: 'Mexique' }];
    return { id: 'cedplay-public-v1', name: 'Chaînes gratuites', channels, groups: [{ name: 'Mexique', channels }] };
  }),
}));
import { loadPublicPlaylist } from '@/utils/publicPlaylist';

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

describe('Démarrage sur la dernière chaîne', () => {
  it('relance la dernière chaîne regardée quand le réglage est actif', async () => {
    state.settings = { theme: 'dark', autoLoadLastPlaylist: true, startOnLastChannel: true };
    render(<IPTVPlayer />);
    await waitFor(() => expect(idb.pushPlayHistory).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'a', kind: 'live' })));
  });

  it('reste sur l’accueil quand le réglage est désactivé', async () => {
    render(<IPTVPlayer />);
    await waitFor(() => expect(screen.getByLabelText('Connexion Xtream')).toBeTruthy());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(idb.pushPlayHistory).not.toHaveBeenCalled();
  });
});

describe('Actualisation d’une liste pendant un changement de liste', () => {
  it('enregistre la liste actualisée sans réafficher l’ancienne liste après le passage à une autre', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { within } = await import('@testing-library/react');
    const xtream: PlaylistInfo = { id: 'p1', name: 'Xtream: user', channels: [
      { id: 'x1', name: 'Info', url: 'http://serveur.test/live/user/pass/1.m3u8', group: 'Info' },
    ], groups: [] };
    xtream.groups = [{ name: 'Info', channels: xtream.channels }];
    const other: PlaylistInfo = { id: 'p2', name: 'Autre liste', channels, groups: [{ name: 'France', channels }] };
    state.playlists = [xtream, other];
    state.meta = { lastPlaylistId: 'p1', 'playlistRefreshedAt:p1': Date.now() };
    localStorage.setItem('xtream_account_p1', JSON.stringify({ server: 'http://serveur.test', username: 'user', password: 'pass' }));
    localStorage.setItem('xtream_live_selection_p1', JSON.stringify({ categoryIds: ['1'], format: 'm3u8' }));
    let answerCategories: () => void = () => {};
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('categories')) {
        await new Promise<void>(resolve => { answerCategories = resolve; });
        return { ok: true, status: 200, json: async () => [{ category_id: '1', category_name: 'Info' }] };
      }
      return { ok: true, status: 200, json: async () => [{ stream_id: 1, name: 'Info HD' }] };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const user = userEvent.setup();
      render(<IPTVPlayer />);
      const navigation = await screen.findByRole('tablist', { name: 'Rubriques' });
      await user.click(within(navigation).getByRole('tab', { name: 'Plus' }));
      await user.click(screen.getByRole('button', { name: /Mes listes/ }));
      await user.click(await screen.findByRole('button', { name: 'Mettre à jour Xtream: user' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Ouvrir Autre liste' }));
      // L'en-tête affiche la liste ouverte.
      await waitFor(() => expect(screen.getByText('Autre liste')).toBeVisible());
      answerCategories();
      await waitFor(() => expect(idb.savePlaylistToDB).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', channels: [expect.objectContaining({ name: 'Info HD' })] })));
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(screen.getByText('Autre liste')).toBeVisible();
      expect(screen.queryByText('Xtream: user')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Réimport d’une connexion Xtream', () => {
  it('reporte sur la liste existante le nouveau format choisi, pas l’ancien', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { buildLiveChannel } = await import('@/utils/xtreamLive');
    const account = { server: 'http://serveur.test:8080', username: 'user', password: 'pass' };
    const live = [buildLiveChannel(account, { stream_id: 42, name: 'TF1' }, 'FR | Info', 'm3u8')];
    state.playlists = [{ id: 'p1', name: 'Xtream: user', channels: live, groups: [{ name: 'FR | Info', channels: live }] }];
    state.meta = { lastPlaylistId: 'p1', 'playlistRefreshedAt:p1': Date.now() };
    localStorage.setItem('xtream_account_p1', JSON.stringify(account));
    localStorage.setItem('xtream_live_selection_p1', JSON.stringify({ categoryIds: ['1'], format: 'm3u8' }));
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => ({
      ok: true, status: 200,
      json: async () => String(url).includes('categories')
        ? [{ category_id: '1', category_name: 'FR | Info' }]
        : [{ stream_id: 42, name: 'TF1' }],
    })));
    try {
      const user = userEvent.setup();
      render(<IPTVPlayer />);
      await user.click(await screen.findByLabelText('Connexion Xtream'));
      await user.type(await screen.findByPlaceholderText('http://serveur.com:8080'), account.server);
      await user.type(screen.getByPlaceholderText('Identifiant'), account.username);
      await user.type(screen.getByPlaceholderText('Mot de passe'), account.password);
      // Le protocole se choisit dans l'étape connexion ; la sélection des
      // catégories est désormais une étape dédiée, sans les identifiants.
      await user.click(await screen.findByRole('button', { name: /MPEG-TS/ }));
      await user.click(screen.getByRole('button', { name: 'Se connecter & charger les catégories' }));
      await user.click(await screen.findByRole('button', { name: 'Importer les chaînes sélectionnées' }));
      // Mêmes adresses (principale et secours échangées) : c'est un réimport de p1.
      await waitFor(() => expect(idb.savePlaylistToDB).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' })));
      expect(JSON.parse(localStorage.getItem('xtream_live_selection_p1') ?? 'null')).toEqual({ categoryIds: ['1'], format: 'ts' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Chaînes gratuites au premier lancement', () => {
  it('remplace la petite sélection enregistrée au démarrage', async () => {
    const small = { ...playlist, id: 'cedplay-public-v1', name: 'Chaînes gratuites',
      channels: Array.from({ length: 13 }, (_, i) => ({ ...channels[0], id: `small-${i}` })) };
    state.playlists = [small];
    state.meta = { lastPlaylistId: small.id, publicPlaylistInitialized: true };
    render(<IPTVPlayer />);
    await screen.findByRole('button', { name: 'Changer de liste' });
    expect(loadPublicPlaylist).toHaveBeenCalledOnce();
    expect(idb.savePlaylistToDB).toHaveBeenCalledWith(expect.objectContaining({ id: small.id, channels: expect.arrayContaining([expect.objectContaining({ id: 'free' })]) }));
  });
  it('installe la sélection embarquée sans compte puis ouvre Direct sans lancer de lecture', async () => {
    state.playlists = []; state.meta = {};
    render(<IPTVPlayer />);
    await screen.findByRole('button', { name: 'Changer de liste' });
    expect(loadPublicPlaylist).toHaveBeenCalledOnce();
    expect(screen.getByText('Chaînes gratuites')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Direct' })).toHaveAttribute('aria-selected', 'true');
    expect(idb.savePlaylistToDB).toHaveBeenCalledWith(expect.objectContaining({ id: 'cedplay-public-v1' }));
    expect(idb.setMeta).toHaveBeenCalledWith('publicPlaylistInitialized', true);
    expect(idb.pushPlayHistory).not.toHaveBeenCalled();
  });
  it('ne télécharge rien et conserve une liste personnelle déjà présente', async () => {
    render(<IPTVPlayer />);
    await screen.findByRole('button', { name: 'Changer de liste' });
    expect(loadPublicPlaylist).not.toHaveBeenCalled();
    expect(idb.savePlaylistToDB).not.toHaveBeenCalled();
  });
  it('ne recrée pas automatiquement la sélection après sa suppression', async () => {
    state.playlists = []; state.meta = { publicPlaylistInitialized: true };
    render(<IPTVPlayer />);
    await screen.findByText('Importer une liste de chaînes');
    expect(loadPublicPlaylist).not.toHaveBeenCalled();
  });
  it('rend la sélection accessible depuis Plus aux installations existantes', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<IPTVPlayer />);
    await user.click(await screen.findByRole('tab', { name: 'Plus' }));
    await user.click(screen.getByRole('button', { name: /Chaînes gratuites/ }));
    await waitFor(() => expect(idb.savePlaylistToDB).toHaveBeenCalledWith(expect.objectContaining({ id: 'cedplay-public-v1' })));
    expect(screen.getByRole('tab', { name: 'Direct' })).toHaveAttribute('aria-selected', 'true');
  });
});
