// Tests de MosaicPicker : limite de connexions du compte (avertissement sans
// blocage), préférence TS pour les flux de la mosaïque, dispositions enregistrées.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MosaicPicker } from '@/components/MosaicPicker';
import { setMeta } from '@/utils/idb';
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

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await setMeta('mosaicLayouts:pl', []);
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

it('enregistre puis recharge une disposition de mosaïque', async () => {
  const user = userEvent.setup();
  const channels = [ts('1', 'Un', 'https://s/1.ts'), ts('2', 'Deux', 'https://s/2.ts'), ts('3', 'Trois', 'https://s/3.ts')];
  const { unmount } = render(<MosaicPicker playlist={playlist(channels)} />);
  cocher(1); cocher(2);
  // Télécommande : OK (ou toucher) active la saisie du nom, comme partout.
  const nameField = screen.getByLabelText('Nom de la disposition');
  await user.click(nameField);
  await user.type(nameField, 'Soir foot');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Soir foot · 2')).toBeVisible();
  unmount();

  // Nouvelle ouverture du panneau : la disposition est proposée, le clic la charge.
  render(<MosaicPicker playlist={playlist(channels)} />);
  await user.click(await screen.findByText('Soir foot · 2'));
  expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true);
  expect((screen.getAllByRole('checkbox')[2] as HTMLInputElement).checked).toBe(true);
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la mosaïque (2/8)' }));
  await vi.waitFor(() => expect(mocks.openMosaic).toHaveBeenCalledWith([
    { url: 'https://s/2.ts', title: 'Deux' },
    { url: 'https://s/3.ts', title: 'Trois' },
  ]));
  // Suppression : la puce disparaît et ne revient pas au remontage.
  await user.click(screen.getByRole('button', { name: 'Supprimer la disposition Soir foot' }));
  await vi.waitFor(() => expect(screen.queryByText('Soir foot · 2')).toBeNull());
  unmount();
  render(<MosaicPicker playlist={playlist(channels)} />);
  await vi.waitFor(() => expect(screen.queryByText('Soir foot · 2')).toBeNull());
});

it('nomme la disposition par défaut avec la date quand le champ est vide', async () => {
  const user = userEvent.setup();
  render(<MosaicPicker playlist={playlist([ts('1', 'Un', 'https://s/1.ts'), ts('2', 'Deux', 'https://s/2.ts')])} />);
  cocher(0); cocher(1);
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText(/Mosaïque \d{2}\/\d{2}\/\d{4} · 2/)).toBeVisible();
});

it('écarte les groupes verrouillés au chargement et au lancement d’une disposition', async () => {
  const user = userEvent.setup();
  await setMeta('mosaicLayouts:pl', [{ id: 'l1', name: 'Mixte', channelIds: ['1', 'a', '2'], createdAt: Date.now() }]);
  const adulte = (id: string, name: string): Channel => ({ id, name, url: `https://s/${id}.ts`, isFavorite: false, group: 'Adulte' });
  const channels = [ts('1', 'Un', 'https://s/1.ts'), adulte('a', 'X premium'), ts('2', 'Deux', 'https://s/2.ts')];
  render(<MosaicPicker playlist={playlist(channels)} lockedGroups={['Adulte']} unlocked={false} />);
  // Chargement : la chaîne protégée n'est ni listée ni sélectionnée.
  await user.click(await screen.findByText('Mixte · 3'));
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
  expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText('X premium')).toBeNull();
  // Lancement : seules les chaînes autorisées partent en mosaïque.
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la mosaïque (2/8)' }));
  await vi.waitFor(() => expect(mocks.openMosaic).toHaveBeenCalledWith([
    { url: 'https://s/1.ts', title: 'Un' },
    { url: 'https://s/2.ts', title: 'Deux' },
  ]));
  expect(mocks.openMosaic.mock.calls[0][0].some(c => c.title === 'X premium')).toBe(false);
});
