import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import type { Channel } from '@/types/channel';
import { IPTVPlayer } from '@/components/IPTVPlayer';

const fixture = vi.hoisted(() => {
  const channel = { id: 'c', name: 'Canal test', url: 'https://example.test/test.m3u8' };
  return { channel, playlist: { id: 'p', name: 'Liste test', channels: [channel], groups: [{ name: 'Test', channels: [channel] }] } };
});
vi.mock('@/utils/storage', () => {
  const settings = { theme: 'dark', autoLoadLastPlaylist: true, autoplay: false, keyboardNavigation: false };
  return { StorageManager: { getSettings: () => settings, loadSettingsAsync: async () => settings, getLastPlaylist: () => 'Liste test', setLastPlaylist: vi.fn() } };
});
vi.mock('@/utils/idb', () => ({
  getPlaylistsFromDB: async () => [fixture.playlist], getLastChannelForPlaylist: async () => fixture.channel.id,
  getMeta: async () => undefined, setMeta: vi.fn(), savePlaylistToDB: vi.fn(),
  getFavoritesFromDB: async () => [], setLastChannelForPlaylist: async () => {}, pushPlayHistory: async () => {},
}));
vi.mock('@/components/VideoPlayer', () => ({ VideoPlayer: ({ onNativePlay }: { onNativePlay: (c: Channel) => void }) => <div>Lecteur de Canal test<button onClick={() => onNativePlay(fixture.channel)}>Ouvrir natif depuis lecteur</button></div> }));
vi.mock('@/components/ChannelList', () => ({ ChannelList: ({ onNativeChannelSelect }: { onNativeChannelSelect: (c: Channel) => void }) => <div>Liste des chaînes test<button onClick={() => onNativeChannelSelect(fixture.channel)}>Ouvrir natif depuis carte</button></div> }));
vi.mock('@/utils/nativePlayer', async () => ({ ...await vi.importActual<typeof import('@/utils/nativePlayer')>('@/utils/nativePlayer'), NativePlayerBridge: { open: vi.fn(), isAvailable: () => false, setChannelShortcuts: vi.fn(), setPlayerOptions: vi.fn(), setHomeFavorites: vi.fn(), addWatchNext: vi.fn(), isTelevision: async () => null } }));
vi.mock('@/components/VodLibrary', () => ({ VodLibrary: ({ kind }: { kind: string }) => <div>Catalogue {kind}</div> }));
vi.mock('@/components/ContinuePanel', () => ({ ContinuePanel: () => <div>Reprise test</div> }));
vi.mock('@/components/MosaicPicker', () => ({ MosaicPicker: () => <div>Mosaïque test</div> }));
vi.mock('@/components/ReplayPanel', () => ({ ReplayPanel: () => <div>Replay test</div> }));
vi.mock('@/components/StreamingPanel', () => ({ StreamingPanel: () => <div>Streaming test</div> }));
vi.mock('@/components/LocalLibrary', () => ({ LocalLibrary: () => <div>Bibliothèque locale test</div> }));
vi.mock('@/components/Recordings', () => ({ Recordings: () => <div>Enregistrements test</div> }));
vi.mock('@/components/PlaylistLoader', () => ({ PlaylistLoader: () => <div>Importation disponible</div> }));
vi.mock('@/components/PlaylistManager', () => ({ PlaylistManager: () => <div>Listes enregistrées</div> }));
vi.mock('@/components/BackupPanel', () => ({ BackupPanel: () => <button>Sauvegarde</button> }));
vi.mock('@/components/SettingsPanel', () => ({ SettingsPanel: () => null }));
afterEach(cleanup);

it('ouvre sur Accueil, garde Direct actif dans son lecteur et retrouve Plus après la gestion des listes', async () => {
  const user = userEvent.setup();
  render(<IPTVPlayer />);
  await screen.findByText('Reprise test');
  await user.click(screen.getByRole('button', { name: 'Connexion Xtream' }));
  // Le dialogue est chargé à la demande (découpage du paquet) : attendre son montage.
  expect(await screen.findByRole('dialog', { name: 'Connexion Xtream Codes' })).toBeVisible();
  expect(await screen.findByLabelText('Adresse du serveur (avec port)')).toBeVisible();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connexion Xtream' })).toHaveFocus());
  const navigation = screen.getByRole('tablist', { name: 'Rubriques' });
  expect(within(navigation).getAllByRole('tab').map(t => t.textContent)).toEqual(['Accueil', 'Direct', 'Films & séries', 'Écouter', 'Plus']);
  await user.click(within(navigation).getByRole('tab', { name: 'Direct' }));
  expect(screen.getByText('Liste des chaînes test')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Lecteur' }));
  expect(screen.getByText('Lecteur de Canal test')).toBeVisible();
  expect(within(navigation).getByRole('tab', { name: 'Direct' })).toHaveAttribute('aria-selected', 'true');
  await user.click(within(navigation).getByRole('tab', { name: 'Direct' }));
  expect(screen.getByText('Liste des chaînes test')).toBeVisible();
  // Le lecteur web reste monté en mini-lecteur.
  expect(screen.getByRole('button', { name: 'Fermer le mini-lecteur' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Agrandir le lecteur' }));
  await user.click(screen.getByRole('button', { name: 'Chaînes' }));
  expect(screen.getByText('Liste des chaînes test')).toBeVisible();
  await user.click(within(navigation).getByRole('tab', { name: 'Films & séries' }));
  // Écrans chargés à la demande : attendre le montage du catalogue.
  await screen.findByText('Catalogue movie');
  await user.click(screen.getByRole('button', { name: 'Séries' }));
  await screen.findByText('Catalogue series');
  await user.click(within(navigation).getByRole('tab', { name: 'Plus' }));
  await user.click(screen.getByRole('button', { name: /Mes listes/ }));
  expect(screen.getByRole('region', { name: 'Gestion des listes' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Exporter' })).toBeVisible();
  expect(within(navigation).getByRole('tab', { name: 'Plus' })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('button', { name: 'Retour' }));
  expect(screen.getByRole('navigation', { name: 'Autres rubriques' })).toBeVisible();
  await user.click(within(navigation).getByRole('tab', { name: 'Films & séries' }));
  await screen.findByText('Catalogue series');
});

it('transmet le même zapping depuis une carte et le lecteur et revient aux chaînes après fermeture', async () => {
  const user = userEvent.setup();
  vi.mocked(NativePlayerBridge.open).mockImplementation(async (_url, _title, _zap, returned) => { returned?.(fixture.channel.url); return true; });
  render(<IPTVPlayer />);
  await user.click(await screen.findByRole('tab', { name: 'Direct' }));
  await screen.findByText('Liste des chaînes test');
  await user.click(screen.getByRole('button', { name: 'Ouvrir natif depuis carte' }));
  await waitFor(() => expect(NativePlayerBridge.open).toHaveBeenCalledTimes(1));
  const cardContext = vi.mocked(NativePlayerBridge.open).mock.calls[0][2];
  expect(cardContext).toMatchObject({ urls: [fixture.channel.url], index: 0 });
  await user.click(screen.getByRole('button', { name: 'Lecteur' }));
  await user.click(screen.getByRole('button', { name: 'Ouvrir natif depuis lecteur' }));
  await waitFor(() => expect(NativePlayerBridge.open).toHaveBeenCalledTimes(2));
  expect(vi.mocked(NativePlayerBridge.open).mock.calls[1][2]).toEqual(cardContext);
  expect(await screen.findByText('Liste des chaînes test')).toBeVisible();
  expect(screen.queryByText('Lecteur de Canal test')).toBeNull();
});
