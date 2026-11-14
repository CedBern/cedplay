import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPTVPlayer } from '@/components/IPTVPlayer';
import { TvVodScreen } from '@/components/TvVodScreen';
import type { CatalogItem } from '@/utils/xtreamCatalog';

// Parcours du rail TV dans l’application réelle : icônes au repos, noms au focus.
// Les positions et la transparence sont vérifiées séparément dans un navigateur.

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
    onOpen={() => {}} onRefresh={() => {}} onSearch={() => {}}
    progress={() => ({ label: 'Regarder', saved: false })}
  />,
}));

const root = document.documentElement;
beforeEach(() => { root.classList.add('remote-navigation'); });
afterEach(() => { cleanup(); root.classList.remove('remote-navigation', 'tv-chrome-hidden', 'tv-mode'); root.style.removeProperty('--tv-header-shift'); });

const rail = () => document.querySelector<HTMLElement>('[data-tv-navigation]')!;
const focused = () => document.activeElement as HTMLElement;

it('Films : le menu reste visible dans la grille et Haut rejoint la rubrique', async () => {
  const user = userEvent.setup();
  render(<IPTVPlayer />);
  await screen.findByText('Reprise test');

  // Le rail conserve Films et Séries séparés et une orientation verticale.
  const navigation = within(rail()).getByRole('tablist', { name: 'Rubriques' });
  expect(within(navigation).getAllByRole('tab').map(t => t.textContent)).toEqual(['Découvrir', 'Direct', 'Films', 'Séries', 'Écouter', 'Plus']);
  expect(navigation).toHaveAttribute('aria-orientation', 'vertical');
  expect(document.querySelector('[data-app-header]')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Type de contenu' })).toBeNull();

  await user.click(within(navigation).getByRole('tab', { name: 'Films' }));
  // Le rail se replie quand le contenu prend le focus.
  const poster = await waitForPoster();
  act(() => poster.focus());
  expect(root.classList.contains('tv-chrome-hidden')).toBe(false);
  expect(rail()).toHaveAttribute('data-expanded', 'false');

  // Haut reste un raccourci vers la rubrique active, avec les noms déployés.
  fireEvent.keyDown(poster, { key: 'ArrowUp' });
  expect(focused()).toBe(within(navigation).getByRole('tab', { name: 'Films' }));
  expect(rail().contains(focused())).toBe(true);
  expect(rail()).toHaveAttribute('data-expanded', 'true');
  expect(root.classList.contains('tv-chrome-hidden')).toBe(false);

  // Retour dans la grille : le menu reste visible.
  act(() => poster.focus());
  expect(root.classList.contains('tv-chrome-hidden')).toBe(false);

  // Direct reste accessible depuis le rail.
  await user.click(within(navigation).getByRole('tab', { name: 'Direct' }));
  expect(root.classList.contains('tv-chrome-hidden')).toBe(false);
});

it('au toucher ou à la souris le rail reste présent et replié dans la grille', async () => {
  root.classList.remove('remote-navigation');
  const user = userEvent.setup();
  render(<IPTVPlayer />);
  await screen.findByText('Reprise test');
  await user.click(within(rail()).getByRole('tab', { name: 'Séries' }));
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
    // TV : la liste se change depuis « Plus ».
    expect(within(rail()).queryByRole('button', { name: 'Changer de liste' })).toBeNull();
    await user.click(within(rail()).getByRole('tab', { name: 'Plus' }));
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

it('Direct TV repart en haut après un accueil défilé, avant de verrouiller la page', async () => {
  const previous = Object.getOwnPropertyDescriptor(document, 'scrollingElement');
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement });
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  try {
    render(<IPTVPlayer />);
    await screen.findByText('Reprise test');
    document.documentElement.scrollTop = 900;
    scroll.mockClear();
    await userEvent.click(screen.getByRole('tab', { name: 'Direct' }));
    expect(await screen.findByText('Direct TV test')).toBeVisible();
    expect(document.documentElement.scrollTop).toBe(0);
    expect(scroll).toHaveBeenCalledWith(0, 0);
  } finally {
    document.documentElement.scrollTop = 0;
    scroll.mockRestore();
    if (previous) Object.defineProperty(document, 'scrollingElement', previous);
    else Reflect.deleteProperty(document, 'scrollingElement');
  }
});

it('Retour des catégories Films rejoint le menu, puis Séries s’ouvre avec OK', async () => {
  render(<IPTVPlayer />);
  await screen.findByText('Reprise test');
  await userEvent.click(screen.getByRole('tab', { name: 'Films' }));
  const poster = await waitForPoster();
  act(() => poster.focus());
  fireEvent.keyDown(poster, { key: 'ArrowLeft' });
  const back = new Event('iptv-back', { cancelable: true });
  window.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);
  expect(screen.getByRole('tab', { name: 'Films' })).toHaveFocus();
  expect(rail()).toBeVisible();
  // Le gestionnaire global vit dans App, pas dans IPTVPlayer : on simule ici son
  // déplacement vers l'onglet voisin ; l'activation par OK reste celle de Radix.
  act(() => screen.getByRole('tab', { name: 'Séries' }).focus());
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('tab', { name: 'Séries' })).toHaveAttribute('aria-selected', 'true');
  expect(await waitForPoster()).toBeVisible();
});
