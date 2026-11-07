// Tests de MosaicPicker : limite de connexions du compte (avertissement sans
// blocage) et préférence TS pour les flux de la mosaïque.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MosaicPicker } from '@/components/MosaicPicker';
import type { Channel, PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ available: true, openMosaic: vi.fn(), account: null as unknown, limits: null as unknown }));
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: { isAvailable: () => mocks.available, openMosaic: mocks.openMosaic } }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => mocks.account,
  fetchXtreamLimits: () => mocks.limits === null ? Promise.reject(new Error('indisponible')) : Promise.resolve(mocks.limits),
}));

const ts = (id: string, name: string, url: string): Channel => ({ id, name, url, isFavorite: false });
const hls = (id: string, name: string, tsUrl: string): Channel => ({ id, name, url: tsUrl.replace(/\.ts$/, '.m3u8'), isFavorite: false, variants: [ts(`${id}-ts`, `${name} (TS)`, tsUrl)] });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.available = true;
  mocks.account = { server: 'https://provider.test', username: 'u', password: 'p' };
  mocks.limits = null;
});
afterEach(cleanup);

const playlist = (channels: Channel[]): PlaylistInfo => ({ id: 'pl', name: 'Test', channels, groups: [] });
const cocher = (index: number) => fireEvent.click(screen.getAllByRole('checkbox')[index]);

it('affiche la limite du compte depuis le cache puis le rafraîchissement', async () => {
  localStorage.setItem('cedplay.xtreamLimits:pl', JSON.stringify({ maxConnections: 2, activeCons: 1, fetchedAt: Date.now() }));
  mocks.limits = { maxConnections: 4, activeCons: 0, fetchedAt: Date.now() };
  render(<MosaicPicker playlist={playlist([])} />);
  // Le cache s'affiche à la première peinture, puis le rafraîchissement le remplace.
  expect(screen.getByText(/Abonnement : 2 connexions simultanées · 1 active actuellement/)).toBeVisible();
  await screen.findByText(/Abonnement : 4 connexions simultanées\./);
});

it('avertit sans bloquer quand la sélection dépasse la limite', async () => {
  mocks.limits = { maxConnections: 1, activeCons: 0, fetchedAt: Date.now() };
  render(<MosaicPicker playlist={playlist([ts('1', 'Un', 'https://s/1.ts'), ts('2', 'Deux', 'https://s/2.ts')])} />);
  cocher(0); cocher(1);
  expect(await screen.findByText(/le fournisseur refusera les flux au-delà de 1/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Lancer la mosaïque (2/8)' })).toBeEnabled();
});

it('ne prévient pas quand la sélection tient sous la limite', async () => {
  mocks.limits = { maxConnections: 8, activeCons: 0, fetchedAt: Date.now() };
  render(<MosaicPicker playlist={playlist([ts('1', 'Un', 'https://s/1.ts'), ts('2', 'Deux', 'https://s/2.ts')])} />);
  cocher(0); cocher(1);
  expect(await screen.findByText(/Abonnement : 8 connexions simultanées\./)).toBeVisible();
  expect(screen.queryByText(/refusera/)).toBeNull();
});

it('reste sur une aide générique quand la limite est inconnue', () => {
  mocks.account = null;
  render(<MosaicPicker playlist={playlist([])} />);
  expect(screen.getByText(/l’abonnement doit autoriser autant de connexions simultanées/)).toBeVisible();
});

it('joue la variante TS quand elle existe, sinon l’URL principale', async () => {
  render(<MosaicPicker playlist={playlist([hls('1', 'Un', 'https://s/live/u/p/1.ts'), ts('2', 'Deux', 'https://s/live/u/p/2.ts')])} />);
  cocher(0); cocher(1);
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la mosaïque (2/8)' }));
  await vi.waitFor(() => expect(mocks.openMosaic).toHaveBeenCalledWith([
    { url: 'https://s/live/u/p/1.ts', title: 'Un' },
    { url: 'https://s/live/u/p/2.ts', title: 'Deux' },
  ]));
});
