import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TvVodScreen, type TvVodScreenProps } from '@/components/TvVodScreen';
import { VodLibrary } from '@/components/VodLibrary';
import type { CatalogItem } from '@/utils/xtreamCatalog';
import type { PlaylistInfo } from '@/types/channel';

// ── TvVodScreen : écran catalogue télécommande (props seules, pas de réseau) ──

const items: CatalogItem[] = Array.from({ length: 13 }, (_, i) => ({ id: `id-${i + 1}`, name: `Titre ${i + 1}`, poster: '', categoryId: 'c1', extension: 'mp4', rating: '7.5' }));

beforeEach(() => { localStorage.clear(); document.documentElement.classList.add('remote-navigation'); });
afterEach(() => { cleanup(); document.documentElement.classList.remove('remote-navigation'); });

const active = () => document.activeElement as HTMLElement;
const key = (k: string) => fireEvent.keyDown(active(), { key: k });
const col = () => active().closest('[data-tv-col]')?.getAttribute('data-tv-col');

function setup(overrides: Partial<TvVodScreenProps> = {}) {
  const props: TvVodScreenProps = {
    kind: 'movie',
    playlistId: 'pl',
    categories: [{ id: 'c1', name: 'Action' }, { id: 'c2', name: 'Comédie' }],
    category: 'c1',
    onSelectCategory: vi.fn(),
    items,
    loading: false,
    error: '',
    onRetry: vi.fn(),
    hasMore: true,
    onLoadMore: vi.fn(),
    showWatchlistOnly: false,
    onToggleWatchlistOnly: vi.fn(),
    watchlistCount: 2,
    watchlistIds: new Set(['id-2']),
    onToggleWatchlistItem: vi.fn(),
    onOpen: vi.fn(),
    onPlay: vi.fn(),
    onRefresh: vi.fn(),
    onSearch: vi.fn(),
    progressLabel: (id: string) => (id === 'id-1' ? 'Reprendre à 5 min' : 'Regarder'),
    ...overrides,
  };
  render(<TvVodScreen {...props} />);
  return props;
}

it('arrive sur la grille, se déplace et OK ouvre la fiche', () => {
  const { onOpen } = setup();
  expect(active().dataset.tvRow).toBe('0');
  key('ArrowRight');
  expect(active().dataset.tvRow).toBe('1');
  key('ArrowDown');
  expect(active().dataset.tvRow).toBe('7');
  fireEvent.click(active());
  expect(onOpen).toHaveBeenCalledWith(items[7]);
});

it('gauche en début de ligne passe aux catégories, droite rend la grille', () => {
  setup();
  key('ArrowLeft');
  expect(col()).toBe('cat');
  expect(active()).toHaveTextContent('Action');
  key('ArrowRight');
  expect(col()).toBe('grid');
  expect(active().dataset.tvRow).toBe('0');
});

it('OK sur une catégorie pointée l’applique tout de suite et rend la grille', () => {
  const { onSelectCategory } = setup();
  key('ArrowLeft');
  key('ArrowDown');
  expect(active()).toHaveTextContent('Comédie');
  fireEvent.click(active());
  expect(onSelectCategory).toHaveBeenCalledTimes(1);
  expect(onSelectCategory).toHaveBeenCalledWith('c2');
  expect(col()).toBe('grid');
});

it('parcourir les catégories applique la catégorie après une pause, sans OK', async () => {
  const { onSelectCategory } = setup();
  key('ArrowLeft');
  key('ArrowDown');
  expect(active()).toHaveTextContent('Comédie');
  // La grille n'a pas changé tant que la pause n'est pas passée.
  expect(screen.getByRole('heading', { name: 'Action' })).toBeVisible();
  await waitFor(() => expect(onSelectCategory).toHaveBeenCalledWith('c2'));
});

it('haut en tête de grille rend la main à la navigation générale', () => {
  setup();
  const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
  active().dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('saut de page atteint la cellule « Afficher davantage » qui charge la suite', () => {
  const { onLoadMore } = setup();
  key('PageDown');
  expect(active().dataset.tvRow).toBe('13');
  expect(active()).toHaveTextContent('Afficher davantage');
  fireEvent.click(active());
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

it('colonne de droite : lecture directe du film, fiche, Ma Liste', () => {
  const { onOpen, onPlay, onToggleWatchlistItem } = setup();
  for (let i = 0; i < 5; i++) key('ArrowRight');
  key('ArrowRight'); // bord droit de la ligne : entre dans la colonne de droite
  expect(col()).toBe('info');
  expect(active()).toHaveTextContent('Regarder');
  fireEvent.click(active());
  expect(onPlay).toHaveBeenCalledWith(items[5]);
  key('ArrowDown');
  expect(active()).toHaveTextContent('Ouvrir la fiche');
  fireEvent.click(active());
  expect(onOpen).toHaveBeenCalledWith(items[5]);
  key('ArrowDown');
  expect(active()).toHaveTextContent('Ajouter à Ma Liste');
  fireEvent.click(active());
  expect(onToggleWatchlistItem).toHaveBeenCalledWith(items[5]);
});

it.each([1, 2, 7])('%i titre(s) : la colonne de droite reste atteignable aux flèches seules', (n) => {
  const { onOpen } = setup({ items: items.slice(0, n), hasMore: false });
  let source = 0;
  // n-1 pas dans la ligne incomplète, puis Droite entre dans la colonne de droite.
  for (let guard = 0; guard < 24 && col() === 'grid'; guard++) { source = Number(active().dataset.tvRow ?? '0'); key('ArrowRight'); }
  expect(col()).toBe('info');
  key('ArrowDown');
  expect(active()).toHaveTextContent('Ouvrir la fiche');
  fireEvent.click(active());
  expect(onOpen).toHaveBeenCalledWith(items[source]);
});

it('Retour remonte fiche éclair → grille → catégories, puis laisse la main', () => {
  setup();
  for (let i = 0; i < 6; i++) key('ArrowRight');
  const back = () => { const e = new Event('tv-vod-back', { cancelable: true }); act(() => { window.dispatchEvent(e); }); return e.defaultPrevented; };
  expect(back()).toBe(true);
  expect(col()).toBe('grid');
  expect(back()).toBe(true);
  expect(col()).toBe('cat');
  expect(back()).toBe(false);
});

it("retrouve l'affiche surlignée de la dernière visite", () => {
  localStorage.setItem('cedplay.tvVod:pl:movie', JSON.stringify({ category: 'c1', itemId: 'id-5' }));
  setup();
  expect(active().dataset.tvRow).toBe('4');
  expect(document.querySelector<HTMLElement>('[data-tv-row="4"]')?.className).toContain('is-selected');
});

it('échec réseau : le bouton Réessayer relance le chargement', () => {
  const { onRetry } = setup({ error: 'Catalogue indisponible', items: [], hasMore: false });
  expect(screen.getByRole('alert')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('une seule cible focusable à la fois (tabindex itinérant)', () => {
  setup();
  const reachable = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-item]')).filter(el => el.tabIndex === 0);
  expect(reachable).toHaveLength(1);
  expect(reachable[0].dataset.tvRow).toBe('0');
});

// ── VodLibrary en mode TV : branchement réel (réseau et pont natif simulés) ──

const mocks = vi.hoisted(() => ({ request: vi.fn(), openVod: vi.fn(), getPlayHistory: vi.fn(), pushPlayHistory: vi.fn() }));
vi.mock('@/utils/xtreamCatalog', async () => ({
  ...await vi.importActual<typeof import('@/utils/xtreamCatalog')>('@/utils/xtreamCatalog'),
  getXtreamAccount: () => ({ server: 'https://provider.test', username: 'u', password: 'p' }),
  catalogRequest: mocks.request,
}));
vi.mock('@/utils/idb', async () => ({
  ...await vi.importActual<typeof import('@/utils/idb')>('@/utils/idb'),
  getPlayHistory: (...args: unknown[]) => mocks.getPlayHistory(...args),
  pushPlayHistory: (...args: unknown[]) => mocks.pushPlayHistory(...args),
}));
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: { isAvailable: () => true, openVod: mocks.openVod } }));
const playlist: PlaylistInfo = { id: 'test', name: 'Test', channels: [], groups: [] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.getPlayHistory.mockResolvedValue([]);
  mocks.pushPlayHistory.mockResolvedValue(undefined);
});

const catalogue = (_a: unknown, action: string) => Promise.resolve(
  action === 'get_vod_categories'
    ? [{ category_id: '1', category_name: 'Action' }, { category_id: '2', category_name: 'Comédie' }]
    : [{ stream_id: 10, name: 'Film Un', container_extension: 'mp4', rating: '8' }, { stream_id: 11, name: 'Film Deux', container_extension: 'mp4' }],
);

it('en mode TV, la grille remplace la mise en page mobile et OK ouvre la fiche', async () => {
  mocks.request.mockImplementation(catalogue);
  render(<VodLibrary playlist={playlist} kind="movie" tvMode onSearch={() => {}} />);
  await screen.findByRole('button', { name: /Film Un/ });
  expect(screen.getByText('Toutes les catégories')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Catégorie VOD' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Film Un/ }));
  await screen.findByRole('dialog');
  expect(screen.getByRole('dialog').querySelector('[data-remote-start]')).not.toBeNull();
});

it('« Regarder » dans la colonne de droite lance la lecture native du film', async () => {
  mocks.request.mockImplementation(catalogue);
  render(<VodLibrary playlist={playlist} kind="movie" tvMode onSearch={() => {}} />);
  await screen.findByRole('button', { name: /Film Un/ });
  fireEvent.click(screen.getByRole('button', { name: 'Regarder' }));
  await waitFor(() => expect(mocks.openVod).toHaveBeenCalledWith('https://provider.test/movie/u/p/10.mp4', 'Film Un', 'test:movie:10', false));
});

it('retrouve la catégorie et l’affiche de la dernière visite', async () => {
  localStorage.setItem('cedplay.tvVod:test:movie', JSON.stringify({ category: '2', itemId: '11' }));
  mocks.request.mockImplementation(catalogue);
  render(<VodLibrary playlist={playlist} kind="movie" tvMode onSearch={() => {}} />);
  await screen.findByRole('button', { name: /Film Deux/ });
  expect(mocks.request).toHaveBeenCalledWith(expect.anything(), 'get_vod_streams', { category_id: '2' }, expect.anything());
  expect(screen.getByRole('button', { name: 'Comédie' })).toHaveAttribute('aria-current', 'true');
  await waitFor(() => expect(document.querySelector<HTMLElement>('[data-tv-row="1"]')?.className).toContain('is-selected'));
});

it('restaure une affiche mémorisée au-delà de la première page de 60 titres', async () => {
  const gros = Array.from({ length: 85 }, (_, i) => ({ stream_id: i + 1, name: `Film ${i + 1}`, container_extension: 'mp4' }));
  mocks.request.mockImplementation((_a: unknown, action: string) => Promise.resolve(
    action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'Action' }] : gros,
  ));
  localStorage.setItem('cedplay.tvVod:test:movie', JSON.stringify({ category: '', itemId: '85' }));
  render(<VodLibrary playlist={playlist} kind="movie" tvMode onSearch={() => {}} />);
  await screen.findByRole('button', { name: /Film 85/ });
  await waitFor(() => expect(document.activeElement).toHaveAttribute('data-tv-row', '84'));
  expect(document.querySelector<HTMLElement>('[data-tv-row="84"]')?.className).toContain('is-selected');
  // La limite a été étendue jusqu'au titre mémorisé : pas de « Afficher davantage » avant lui.
  expect(screen.queryByText('Afficher davantage')).toBeNull();
});

it('« Afficher davantage » étend la limite effective après une restauration au-delà de 60', async () => {
  // Restauration au titre 85 : 120 titres affichés d'emblée. Un « +60 » depuis la limite
  // de base (60) retombait sur 120 — aucun titre de plus au premier clic.
  const gros = Array.from({ length: 150 }, (_, i) => ({ stream_id: i + 1, name: `Film ${i + 1}`, container_extension: 'mp4' }));
  mocks.request.mockImplementation((_a: unknown, action: string) => Promise.resolve(
    action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'Action' }] : gros,
  ));
  localStorage.setItem('cedplay.tvVod:test:movie', JSON.stringify({ category: '', itemId: '85' }));
  render(<VodLibrary playlist={playlist} kind="movie" tvMode onSearch={() => {}} />);
  await screen.findByRole('button', { name: /Film 85/ });
  expect(screen.queryByRole('button', { name: /Film 150/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Afficher davantage' }));
  await screen.findByRole('button', { name: /Film 150/ });
  expect(screen.queryByRole('button', { name: 'Afficher davantage' })).toBeNull();
});

const seriesMocks = (deferInfo: (resolve: (value: unknown) => void) => void) => {
  mocks.request.mockImplementation((_a: unknown, action: string) => {
    if (action === 'get_series_categories') return Promise.resolve([{ category_id: '1', category_name: 'Drama' }]);
    if (action === 'get_series') return Promise.resolve([{ series_id: 20, name: 'Série Un' }]);
    if (action === 'get_series_info') return new Promise(resolve => { deferInfo(resolve); });
    return Promise.resolve([]);
  });
};

it('série : le focus entre sur le premier épisode quand la liste arrive', async () => {
  let resolveInfo: (value: unknown) => void = () => {};
  seriesMocks(resolve => { resolveInfo = resolve; });
  render(<VodLibrary playlist={playlist} kind="series" tvMode onSearch={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Série Un/ }));
  await screen.findByRole('dialog');
  // Le bouton principal n'existe pas encore : le conteneur de la fiche porte le focus.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
  resolveInfo({ info: { plot: 'Une histoire.' }, episodes: { '1': [{ id: '501', episode_num: 1, title: 'Pilote', container_extension: 'mp4' }] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Regarder' })).toHaveFocus());
});

it('série : une navigation déjà commencée garde la main à l’arrivée des épisodes', async () => {
  let resolveInfo: (value: unknown) => void = () => {};
  seriesMocks(resolve => { resolveInfo = resolve; });
  render(<VodLibrary playlist={playlist} kind="series" tvMode onSearch={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Série Un/ }));
  await screen.findByRole('dialog');
  // L'utilisateur a déjà appuyé sur une flèche : le focus ne bouge plus tout seul.
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  screen.getByRole('button', { name: /Ajouter à ma liste/ }).focus();
  resolveInfo({ info: {}, episodes: { '1': [{ id: '501', episode_num: 1, title: 'Pilote', container_extension: 'mp4' }] } });
  await screen.findByRole('button', { name: 'Regarder' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Ajouter à ma liste/ }));
});
