import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// P2-07 : les entrées du Direct (recherche, guide, organisation, tri…) doivent garder la
// même identité d'un rendu du parent à l'autre, sinon le `useMemo` de TvLiveScreen est
// reconstruit, ses effets se relancent et le minuteur de catégorie est réarmé.
const capture = vi.hoisted(() => {
  const channel = { id: 'c', name: 'Canal test', url: 'https://example.test/test.m3u8' };
  return {
    channel,
    playlist: { id: 'p', name: 'Liste test', channels: [channel], groups: [{ name: 'Test', channels: [channel] }] },
    props: [] as Record<string, unknown>[],
  };
});

vi.mock('@/utils/storage', () => {
  const settings = { theme: 'dark', autoLoadLastPlaylist: true, autoplay: false, keyboardNavigation: false, interfaceMode: 'tv' };
  return { StorageManager: { getSettings: () => settings, getCachedSettings: () => settings, loadSettingsAsync: async () => settings, getLastPlaylist: () => 'Liste test', setLastPlaylist: vi.fn() } };
});
vi.mock('@/utils/idb', () => ({
  getPlaylistsFromDB: async () => [capture.playlist], getLastChannelForPlaylist: async () => capture.channel.id,
  getMeta: async () => undefined, setMeta: vi.fn(), savePlaylistToDB: vi.fn(),
  getFavoritesFromDB: async () => [], setLastChannelForPlaylist: async () => {}, pushPlayHistory: async () => {},
}));
vi.mock('@/utils/nativePlayer', async () => ({ ...await vi.importActual<typeof import('@/utils/nativePlayer')>('@/utils/nativePlayer'), NativePlayerBridge: { open: vi.fn(), isAvailable: () => false, setChannelShortcuts: vi.fn(), setPlayerOptions: vi.fn(), setHomeFavorites: vi.fn(), addWatchNext: vi.fn(), isTelevision: async () => true } }));
vi.mock('@/components/VideoPlayer', () => ({ VideoPlayer: () => <div>Lecteur test</div> }));
vi.mock('@/components/ChannelList', () => ({ ChannelList: () => <div>Liste des chaînes test</div> }));
vi.mock('@/components/ContinuePanel', () => ({ ContinuePanel: () => <div>Reprise test</div> }));
vi.mock('@/components/LocalLibrary', () => ({ LocalLibrary: () => <div>Bibliothèque locale test</div> }));
vi.mock('@/components/SettingsPanel', () => ({ SettingsPanel: () => null }));
vi.mock('@/components/TvLiveScreen', () => ({
  TvLiveScreen: (props: Record<string, unknown>) => { capture.props.push(props); return <div>Direct TV test</div>; },
}));

import { IPTVPlayer } from '@/components/IPTVPlayer';

afterEach(() => {
  cleanup();
  capture.props.length = 0;
  document.documentElement.classList.remove('remote-navigation', 'tv-mode');
});

it('garde les mêmes callbacks du Direct quand le parent se re-rend', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<IPTVPlayer />);
  await screen.findByText('Reprise test');

  const tabs = within(document.querySelector<HTMLElement>('[data-app-header]')!).getByRole('tablist', { name: 'Rubriques' });
  await user.click(within(tabs).getByRole('tab', { name: 'Direct' }));
  await screen.findByText('Direct TV test');
  expect(capture.props.length).toBeGreaterThan(0);
  const before = capture.props[capture.props.length - 1];

  const renders = capture.props.length;
  rerender(<IPTVPlayer />);
  await waitFor(() => expect(capture.props.length).toBeGreaterThan(renders));
  const after = capture.props[capture.props.length - 1];

  for (const key of ['onPlay', 'onSearch', 'onGuide', 'onMosaic', 'onRecord', 'onEdit', 'onOrganize', 'onToggleSort'] as const) {
    expect(after[key], key).toBe(before[key]);
  }
});
