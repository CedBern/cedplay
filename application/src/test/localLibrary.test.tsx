import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalLibrary } from '@/components/LocalLibrary';
import { getLocalLibraryWorks, saveLocalLibraryWorks } from '@/utils/idb';

const mocks = vi.hoisted(() => ({
  listFolders: vi.fn(),
  scanLibrary: vi.fn(),
  pickFolder: vi.fn(),
  removeFolder: vi.fn(),
  playLocal: vi.fn(),
}));

vi.mock('@/utils/nativePlayer', () => ({
  LocalLibraryBridge: {
    isAvailable: true,
    listFolders: mocks.listFolders,
    scanLibrary: mocks.scanLibrary,
    pickFolder: mocks.pickFolder,
    removeFolder: mocks.removeFolder,
    playLocal: mocks.playLocal,
  },
}));
vi.mock('@/utils/tmdb', () => ({
  searchTmdb: vi.fn(async () => []),
  pickBestMatch: vi.fn(() => null),
  tmdbImageUrl: vi.fn(() => ''),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(async () => { await saveLocalLibraryWorks([]); });

const folder = { uri: 'content://com.android.externalstorage.documents/tree/primary%3AMovies', name: 'USB' };
const movie = { uri: 'content://usb/Inception (2010).mkv', name: 'Inception (2010).mkv', size: 2_000_000, lastModified: 1 };
const subbed = { uri: 'content://usb/Film.mkv', name: 'Film.mkv', size: 1_000_000, lastModified: 2, subtitleUri: 'content://usb/Film.srt' };

it('propose d’ajouter un dossier puis liste les vidéos découvertes', async () => {
  mocks.listFolders.mockResolvedValueOnce([]);
  mocks.listFolders.mockResolvedValueOnce([folder]);
  mocks.pickFolder.mockResolvedValue(folder);
  mocks.scanLibrary.mockResolvedValue({ files: [movie], truncated: false });
  const user = userEvent.setup();

  render(<LocalLibrary />);
  expect(await screen.findByText('Ta bibliothèque locale')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /Ajouter un dossier/ }));
  expect(await screen.findByText('Inception')).toBeTruthy();
  expect(screen.getByText('2010')).toBeTruthy();
});

it('affiche les sous-titres détectés et lit le fichier au clic', async () => {
  mocks.listFolders.mockResolvedValue([folder]);
  mocks.scanLibrary.mockResolvedValue({ files: [movie, subbed], truncated: false });
  const user = userEvent.setup();

  render(<LocalLibrary />);
  await screen.findByText('Film');
  expect(screen.getByText('ST')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /Film/ }));
  expect(mocks.playLocal).toHaveBeenCalledWith('content://usb/Film.mkv', 'Film', 'content://usb/Film.srt');
});

it('retire un dossier de la bibliothèque', async () => {
  mocks.listFolders.mockResolvedValue([folder]);
  mocks.scanLibrary.mockResolvedValue({ files: [movie], truncated: false });
  mocks.removeFolder.mockResolvedValue(true);
  const user = userEvent.setup();

  render(<LocalLibrary />);
  await screen.findByText('Inception');

  await user.click(screen.getByRole('button', { name: 'Retirer USB' }));
  expect(mocks.removeFolder).toHaveBeenCalledWith(folder.uri);
});

it('enregistre les œuvres analysées pour les recommandations', async () => {
  mocks.listFolders.mockResolvedValue([folder]);
  mocks.scanLibrary.mockResolvedValue({ files: [movie, subbed], truncated: false });

  render(<LocalLibrary />);
  await screen.findByText('Inception');

  await waitFor(async () => {
    const works = await getLocalLibraryWorks();
    expect(works).toHaveLength(2);
    expect(works).toContainEqual({ title: 'Inception', year: '2010', kind: 'movie', lastModified: 1 });
  });
});

it('efface l’index quand le dernier dossier est retiré', async () => {
  mocks.listFolders.mockResolvedValue([folder]);
  mocks.scanLibrary.mockResolvedValue({ files: [movie], truncated: false });
  mocks.removeFolder.mockResolvedValue(true);
  const user = userEvent.setup();

  render(<LocalLibrary />);
  await screen.findByText('Inception');
  await waitFor(async () => expect(await getLocalLibraryWorks()).toHaveLength(1));

  await user.click(screen.getByRole('button', { name: 'Retirer USB' }));
  await waitFor(async () => expect(await getLocalLibraryWorks()).toEqual([]));
});
