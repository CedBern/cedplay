import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoviesPanel } from '@/components/MoviesPanel';
import type { PlaylistInfo } from '@/types/channel';

vi.mock('@/components/LocalLibrary', () => ({ LocalLibrary: () => <div>Bibliothèque locale test</div> }));
afterEach(cleanup);

// Liste M3U simple : aucun compte Xtream, donc ni catalogue ni colonne « USB / SD ».
const playlist = { id: 'm3u', name: 'Liste M3U', channels: [], groups: [] } as unknown as PlaylistInfo;

it('sans compte Xtream, USB/SD reste accessible sur téléphone', async () => {
  const user = userEvent.setup();
  render(<MoviesPanel playlist={playlist} />);
  expect(screen.getByText(/importe ta liste depuis « Ajouter »/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: /USB\/SD/ }));
  expect(screen.getByText('Bibliothèque locale test')).toBeVisible();
  // Et le chemin inverse reste ouvert.
  await user.click(screen.getByRole('button', { name: /Catalogue/ }));
  expect(screen.getByText(/importe ta liste depuis « Ajouter »/)).toBeVisible();
});

it('TV sans compte Xtream : l’écran explique quoi faire et mène à la connexion ou à USB/SD', async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  render(<MoviesPanel playlist={playlist} tvMode onConnect={onConnect} />);
  expect(screen.getByRole('heading', { name: 'Les films viennent de ton abonnement' })).toBeVisible();
  expect(screen.getByText(/Aucun catalogue de films ou séries associé/)).toBeVisible();
  // La première tuile reçoit la télécommande.
  const connect = screen.getByRole('button', { name: /Connecter un abonnement/ });
  expect(connect.hasAttribute('data-remote-start')).toBe(true);
  await user.click(connect);
  expect(onConnect).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: /clé USB ou une carte SD/ }));
  expect(screen.getByText('Bibliothèque locale test')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Catalogue/ }));
  expect(screen.getByRole('heading', { name: 'Les films viennent de ton abonnement' })).toBeVisible();
});
