import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IPTVPlayer } from '@/components/IPTVPlayer';
import { savePlaylistToDB, setMeta, getPlayHistory } from '@/utils/idb';
import type { Channel, ChannelGroup, PlaylistInfo } from '@/types/channel';

const native = vi.hoisted(() => ({ available: true, open: vi.fn() }));
const app = vi.hoisted(() => ({ getLaunchUrl: vi.fn(async () => ({})), addListener: vi.fn(async () => ({ remove: async () => {} })) }));
vi.mock('@capacitor/app', () => ({ App: app }));
vi.mock('@/utils/nativePlayer', async importOriginal => {
  const original = await importOriginal<typeof import('@/utils/nativePlayer')>();
  return { ...original, NativePlayerBridge: { ...original.NativePlayerBridge, isAvailable: () => native.available, open: native.open } };
});
vi.mock('@/hooks/useEPG', () => ({ useEPG: () => ({ data: {}, status: 'absent', retry: () => {} }) }));
vi.mock('@/components/ChannelList', () => ({ ChannelList: ({ groups, onChannelSelect, onNativeChannelSelect }: {
  groups: ChannelGroup[]; onChannelSelect: (c: Channel) => void; onNativeChannelSelect?: (c: Channel) => void;
}) => <><button onClick={() => onChannelSelect(groups[0].channels[0])}>Lecture test</button><button onClick={() => onNativeChannelSelect?.(groups[0].channels[0])}>Éclair test</button></> }));
vi.mock('@/components/VideoPlayer', () => ({ VideoPlayer: () => <div>Vidéo web de contrôle</div> }));

const channel: Channel = { id: 'live-route', name: 'Chaîne de contrôle', url: 'https://example.test/1.ts', group: 'Test' };
const playlist: PlaylistInfo = { id: 'live-route', name: 'Test', channels: [channel], groups: [{ name: 'Test', channels: [channel] }] };
beforeEach(async () => {
  vi.clearAllMocks(); native.available = true;
  await savePlaylistToDB(playlist);
  await setMeta('lastPlaylistId', playlist.id);
  await setMeta('playHistory', []);
});
afterEach(cleanup);

it('Lecture ouvre Android sans monter le lecteur web et bloque les doubles appuis', async () => {
  let close!: (value: { channelUrl: string }) => void;
  native.open.mockImplementation((_url, _title, _zap, returned) => new Promise(resolve => {
    close = value => { returned(value.channelUrl); resolve(true); };
  }));
  render(<IPTVPlayer />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Direct' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Lecture test' }));
  expect(screen.getByRole('status')).toHaveTextContent('Ouverture du lecteur');
  fireEvent.click(screen.getByRole('button', { name: 'Éclair test' }));
  await waitFor(() => expect(native.open).toHaveBeenCalledOnce());
  expect(native.open).toHaveBeenCalledWith(channel.url, channel.name, expect.objectContaining({ index: 0, urls: [channel.url] }), expect.any(Function), expect.any(Function));
  expect(screen.queryByText('Vidéo web de contrôle')).toBeNull();
  await act(async () => close({ channelUrl: channel.url }));
  expect(screen.queryByRole('status')).toBeNull();
  await waitFor(async () => expect((await getPlayHistory())[0]?.channelId).toBe(channel.id));
});

it('garde la lecture web dans le navigateur et amène le lecteur à l’écran', async () => {
  native.available = false;
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  render(<IPTVPlayer />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Direct' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Lecture test' }));
  expect(await screen.findByText('Vidéo web de contrôle')).toBeVisible();
  expect(native.open).not.toHaveBeenCalled();
  expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  scroll.mockRestore();
});

it('retire l’attente après un refus du lecteur Android, sans lancer le web en cachette', async () => {
  native.open.mockResolvedValue(false);
  render(<IPTVPlayer />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Direct' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Lecture test' }));
  await waitFor(() => expect(native.open).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(screen.queryByText('Vidéo web de contrôle')).toBeNull();
});

it('nettoie une inscription tardive aux liens Android après démontage de l’écran', async () => {
  let finish!: (handle: { remove: () => Promise<void> }) => void;
  app.addListener.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<IPTVPlayer />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.unmount();
  const remove = vi.fn(async () => {});
  await act(async () => finish({ remove }));
  expect(remove).toHaveBeenCalledOnce();
});
