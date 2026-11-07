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

it.each([false, true])('sans compte Xtream, USB/SD reste accessible (TV : %s)', async tvMode => {
  const user = userEvent.setup();
  render(<MoviesPanel playlist={playlist} tvMode={tvMode} />);
  expect(screen.getByText(/importe ta liste depuis « Ajouter »/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: /USB\/SD/ }));
  expect(screen.getByText('Bibliothèque locale test')).toBeVisible();
  // Et le chemin inverse reste ouvert.
  await user.click(screen.getByRole('button', { name: /Catalogue/ }));
  expect(screen.getByText(/importe ta liste depuis « Ajouter »/)).toBeVisible();
});
