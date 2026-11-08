import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPTVPlayer } from '@/components/IPTVPlayer';
import { TvVodScreen } from '@/components/TvVodScreen';
import type { CatalogItem } from '@/utils/xtreamCatalog';

// Parcours complet de l'en-tête TV dans l'application réelle : rubriques sur une ligne,
// repli quand la télécommande entre dans la grille, retour aux rubriques par Haut.
// L'animation elle-même (CSS) n'existe pas dans jsdom : on vérifie l'état qui la pilote.

const fixture = vi.hoisted(() => {
  const channel = { id: 'c', name: 'Canal test', url: 'https://example.test/test.m3u8' };
  return { channel, playlist: { id: 'p', name: 'Liste test', channels: [channel], groups: [{ name: 'Test', channels: [channel] }] } };
});
vi.mock('@/utils/storage', () => {
  const settings = { theme: 'dark', autoLoadLastPlaylist: true, autoplay: false, keyboardNavigation: false, interfaceMode: 'tv' };
  return { StorageManager: { getSettings: () => settings, getCachedSettings: () => settings, loadSettingsAsync: async () => settings, getLastPlaylist: () => 'Liste test', setLastPlaylist: vi.fn() } };
});
vi.mock('@/utils/idb', () => ({
  getPlaylistsFromDB: async () => [fixture.playlist], getLastChannelForPlaylist: async () => fixture.channel.id,
  getMeta: async () => undefined, setMeta: vi.fn(), savePlaylistToDB: vi.fn(),
  getFavoritesFromDB: async () => [], setLastChannelForPlaylist: async () => {}, pushPlayHistory: async () => {},
}));
vi.mock('@/utils/nativePlayer', async () => ({ ...await vi.importActual<typeof import('@/utils/nativePlayer')>('@/utils/nativePlayer'), NativePlayerBridge: { open: vi.fn(), isAvailable: () => false, setChannelShortcuts: vi.fn(), setPlayerOptions: vi.fn(), setHomeFavorites: vi.fn(), addWatchNext: vi.fn(), isTelevision: async () => true } }));
vi.mock('@/components/VideoPlayer', () => ({ VideoPlayer: () => <div>Lecteur test</div> }));
vi.mock('@/components/ChannelList', () => ({ ChannelList: () => <div>Liste des chaînes test</div> }));
vi.mock('@/components/TvLiveScreen', () => ({ TvLiveScreen: () => <div>Direct TV test</div> }));
vi.mock('@/components/ContinuePanel', () => ({ ContinuePanel: () => <div>Reprise test</div> }));
vi.mock('@/components/LocalLibrary', () => ({ LocalLibrary: () => <div>Bibliothèque locale test</div> }));
vi.mock('@/components/SettingsPanel', () => ({ SettingsPanel: () => null }));
// Catalogue sans réseau : le vrai écran télécommande, nourri de quelques affiches.
const items: CatalogItem[] = Array.from({ length: 8 }, (_, i) => ({ id: `id-${i}`, name: `Titre ${i}`, poster: '', categoryId: 'c1', extension: 'mp4', rating: '' }));
vi.mock('@/components/VodLibrary', () => ({
  VodLibrary: ({ kind }: { kind: 'movie' | 'series' }) => <TvVodScreen
    kind={kind} playlistId="p" categories={[{ id: 'c1', name: 'Action' }]} category="c1" onSelectCategory={() => {}}
    items={items} loading={false} error="" onRetry={() => {}} hasMore={false} onLoadMore={() => {}}
    showWatchlistOnly={false} onToggleWatchlistOnly={() => {}} watchlistCount={0} watchlistIds={new Set()}
    onToggleWatchlistItem={() => {}} onOpen={() => {}} onPlay={() => {}} onRefresh={() => {}} onSearch={() => {}}
    progressLabel={() => 'Regarder'}
  />,
}));

const root = document.documentElement;
beforeEach(() => { root.classList.add('remote-navigation'); });
afterEach(() => { cleanup(); root.classList.remove('remote-navigation', 'tv-chrome-hidden', 'tv-mode'); root.style.removeProperty('--tv-header-shift'); });

const header = () => document.querySelector<HTMLElement>('[data-app-header]')!;
const focused = () => document.activeElement as HTMLElement;

it('Films : la grille replie l’en-tête, Haut le rouvre sur la rubrique, Direct ne replie pas', async () => {
  const user = userEvent.setup();
  render(<IPTVPlayer />);
  await screen.findByText('Reprise test');

  // Une seule ligne : les rubriques sont dans l'en-tête, Films et Séries séparés.
  const navigation = within(header()).getByRole('tablist', { name: 'Rubriques' });
  expect(within(navigation).getAllByRole('tab').map(t => t.textContent)).toEqual(['Accueil', 'Direct', 'Films', 'Séries', 'Écouter', 'Plus']);
  expect(screen.queryByRole('group', { name: 'Type de contenu' })).toBeNull();

  await user.click(within(navigation).getByRole('tab', { name: 'Films' }));
  // L'écran place le focus sur la première affiche : l'en-tête se replie.
  const poster = await waitForPoster();
  act(() => poster.focus());
  expect(root.classList.contains('tv-chrome-hidden')).toBe(true);
  expect(root.style.getPropertyValue('--tv-header-shift')).toMatch(/^\d+px$/);

  // Haut depuis la première ligne : la rubrique active reprend le focus et l'en-tête revient.
  fireEvent.keyDown(poster, { key: 'ArrowUp' });
  expect(focused()).toBe(within(navigation).getByRole('tab', { name: 'Films' }));
  expect(header().contains(focused())).toBe(true);
  expect(root.classList.contains('tv-chrome-hidden')).toBe(false);

  // Retour dans la grille : repli de nouveau.
  act(() => poster.focus());
  expect(root.classList.contains('tv-chrome-hidden')).toBe(true);

  // Direct n'a pas de repli : changer de rubrique rend l'en-tête.
  await user.click(within(navigation).getByRole('tab', { name: 'Direct' }));
  expect(root.classList.contains('tv-chrome-hidden')).toBe(false);
});

it('au toucher ou à la souris (sans télécommande), l’en-tête reste affiché dans la grille', async () => {
  root.classList.remove('remote-navigation');
  const user = userEvent.setup();
  render(<IPTVPlayer />);
  await screen.findByText('Reprise test');
  await user.click(within(header()).getByRole('tab', { name: 'Séries' }));
  const poster = await waitForPoster();
  act(() => poster.focus());
  expect(root.classList.contains('tv-chrome-hidden')).toBe(false);
});

it('le menu ne propose qu’une entrée pour la sélection officielle déjà enregistrée', async () => {
  const previous = { id: fixture.playlist.id, name: fixture.playlist.name };
  fixture.playlist.id = 'cedplay-public-v1';
  fixture.playlist.name = 'Chaînes gratuites';
  try {
    const user = userEvent.setup();
    render(<IPTVPlayer />);
    await screen.findByText('Reprise test');
    // TV : l'en-tête ne garde que les rubriques ; la liste se change depuis « Plus ».
    expect(within(header()).queryByRole('button', { name: 'Changer de liste' })).toBeNull();
    await user.click(within(header()).getByRole('tab', { name: 'Plus' }));
    const button = await screen.findByRole('button', { name: 'Changer de liste' });
    expect(button).toHaveAttribute('title', 'Chaînes gratuites');
    await user.click(button);
    expect(await screen.findAllByRole('menuitemradio')).toHaveLength(1);
    expect(screen.queryByRole('menuitem', { name: 'Chaînes gratuites' })).toBeNull();
  } finally { cleanup(); Object.assign(fixture.playlist, previous); }
});

async function waitForPoster(): Promise<HTMLElement> {
  await screen.findAllByText('Titre 0');
  return document.querySelector<HTMLElement>('[data-tv-vod] [data-tv-row="0"]')!;
}
