import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TvVodScreen, type TvVodScreenProps } from '@/components/TvVodScreen';
import { clearVodCategoryCache } from '@/utils/vodPosterCache';
import { MainNavigation } from '@/components/MainNavigation';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
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
    onOpen: vi.fn(),
    onRefresh: vi.fn(),
    onSearch: vi.fn(),
    progress: (id: string) => (id === 'id-1' ? { label: 'Reprendre à 5 min', saved: true } : { label: 'Regarder', saved: false }),
    ...overrides,
  };
  render(<TvVodScreen {...props} />);
  return props;
}

it('place Ma Liste avant les catégories dans leur ordre fournisseur et les outils', () => {
  setup({ categories: [{ id: 'z', name: 'Z Séries' }, { id: 'n', name: '01 Films' }, { id: 'f', name: 'FR Films' }], onShowLocal: vi.fn() });
  expect(within(screen.getByRole('navigation', { name: 'Catégories' })).getAllByRole('button').map(button => button.textContent)).toEqual([
    'Ma Liste2', 'Z Séries', '01 Films', 'FR Films', 'Rechercher', 'Actualiser', 'USB / SD',
  ]);
});

it('borne la hauteur dès le premier rendu : la grille garde une fenêtre défilante', () => {
  setup();
  const root = document.querySelector<HTMLElement>('[data-tv-vod]');
  // Sans hauteur au premier rendu, la rangée de grille prend la hauteur du contenu et la
  // zone défilante n'a plus rien à faire défiler : les flèches changent la sélection hors écran.
  expect(root?.style.height).toMatch(/^\d+px$/);
});

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

it('haut en tête de grille rejoint la rubrique active, même en-tête replié hors écran', () => {
  const nav = document.createElement('div');
  nav.setAttribute('data-main-navigation', '');
  nav.innerHTML = '<button role="tab" aria-selected="false">Direct</button><button role="tab" aria-selected="true">Films</button>';
  document.body.appendChild(nav);
  try {
    setup();
    key('ArrowRight');
    key('ArrowUp');
    expect(active()).toHaveTextContent('Films');
  } finally { nav.remove(); }
});

it('films : la ligne « USB / SD » de la colonne de gauche ouvre la bibliothèque locale', () => {
  const onShowLocal = vi.fn();
  setup({ onShowLocal });
  fireEvent.click(screen.getByRole('button', { name: 'USB / SD' }));
  expect(onShowLocal).toHaveBeenCalledTimes(1);
});

it('séries : pas de ligne « USB / SD »', () => {
  setup({ kind: 'series' });
  expect(screen.queryByRole('button', { name: 'USB / SD' })).toBeNull();
});

it('saut de page atteint la cellule « Afficher davantage » qui charge la suite', () => {
  const { onLoadMore } = setup();
  key('PageDown');
  expect(active().dataset.tvRow).toBe('13');
  expect(active()).toHaveTextContent('Afficher davantage');
  fireEvent.click(active());
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

it('droite au bout de la ligne ne quitte pas la grille et aucune fiche éclair ne subsiste', () => {
  setup();
  for (let i = 0; i < 5; i++) key('ArrowRight');
  expect(active().dataset.tvRow).toBe('5');
  key('ArrowRight');
  expect(active().dataset.tvRow).toBe('5');
  expect(col()).toBe('grid');
  expect(document.querySelector('[data-tv-col="info"]')).toBeNull();
});

it('l’affiche en reprise porte son libellé sous le titre', () => {
  setup();
  expect(within(screen.getByRole('button', { name: /^Titre 1\b/ })).getByText('Reprendre à 5 min')).toBeVisible();
  expect(within(screen.getByRole('button', { name: /^Titre 2\b/ })).queryByText(/Reprendre/)).toBeNull();
});

it.each([1, 2, 7])('%i titre(s) : droite en fin de ligne incomplète reste sur la dernière affiche', (n) => {
  const { onOpen } = setup({ items: items.slice(0, n), hasMore: false });
  for (let guard = 0; guard < 12; guard++) key('ArrowRight');
  expect(col()).toBe('grid');
  // Une ligne fait 6 affiches : avec 7 titres, la 7e est au début de la ligne suivante.
  expect(active().dataset.tvRow).toBe(String(Math.min(n - 1, 5)));
  const source = Number(active().dataset.tvRow);
  fireEvent.click(active());
  expect(onOpen).toHaveBeenCalledWith(items[source]);
});

it('Retour remonte grille → catégories, puis laisse la main', () => {
  setup();
  key('ArrowRight');
  const back = () => { const e = new Event('tv-vod-back', { cancelable: true }); act(() => { window.dispatchEvent(e); }); return e.defaultPrevented; };
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

it('une flèche maintenue ne sauvegarde pas à chaque pas, mais conserve la dernière affiche en quittant', () => {
  vi.useFakeTimers();
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  try {
    setup(); storage.mockClear();
    for (let i = 0; i < 4; i++) key('ArrowRight');
    expect(storage).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(storage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('cedplay.tvVod:pl:movie')!)).toMatchObject({ itemId: 'id-5' });
    key('ArrowLeft');
    cleanup();
    expect(JSON.parse(localStorage.getItem('cedplay.tvVod:pl:movie')!)).toMatchObject({ itemId: 'id-4' });
  } finally { cleanup(); storage.mockRestore(); vi.useRealTimers(); }
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
// « Pour toi » : une suggestion du catalogue, avec sa justification, pour vérifier que la
// raison autrefois lue dans la fiche éclair se retrouve désormais dans la fiche complète.
vi.mock('@/utils/recommendations', async () => ({
  ...await vi.importActual<typeof import('@/utils/recommendations')>('@/utils/recommendations'),
  recommendForHistory: (_history: unknown, movies: CatalogItem[]) =>
    movies.slice(0, 1).map(item => ({ item, reasons: ['Parce que tu as vu Dune'], score: 1 })),
}));
const playlist: PlaylistInfo = { id: 'test', name: 'Test', channels: [], groups: [] };

beforeEach(() => {
  vi.clearAllMocks();
  clearVodCategoryCache();
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
  expect(screen.getByRole('button', { name: 'Action' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Catégorie VOD' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Film Un/ }));
  await screen.findByRole('dialog');
  expect(screen.getByRole('dialog').querySelector('[data-remote-start]')).not.toBeNull();
});

it('la fiche ouverte par OK lance la lecture native du film', async () => {
  mocks.request.mockImplementation(catalogue);
  render(<VodLibrary playlist={playlist} kind="movie" tvMode onSearch={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Film Un/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Regarder' }));
  await waitFor(() => expect(mocks.openVod).toHaveBeenCalledWith('https://provider.test/movie/u/p/10.mp4', 'Film Un', 'test:movie:10', false));
});

it('« Pour toi » : la raison de la suggestion se lit dans la fiche', async () => {
  // Un visionnage passé déclenche le catalogue complet, donc les recommandations.
  mocks.getPlayHistory.mockResolvedValue([{ channelId: '9', ts: Date.now(), kind: 'vod', name: 'Dune', playlistId: 'test', mediaKind: 'movie', status: 'completed', positionMs: 0 }]);
  mocks.request.mockImplementation(catalogue);
  render(<VodLibrary playlist={playlist} kind="movie" tvMode onSearch={() => {}} />);
  await screen.findByRole('button', { name: /Film Un/ });
  fireEvent.click(screen.getByRole('button', { name: 'Pour toi' }));
  await screen.findByRole('heading', { name: /Pour toi, d’après tes visionnages/ });
  fireEvent.click(await screen.findByRole('button', { name: /Film Un/ }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByText('Parce que tu as vu Dune')).toBeVisible());
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
  // Entrée dans la fiche : le premier épisode de la liste, pas un bouton d'action.
  await waitFor(() => expect(screen.getByRole('button', { name: /1\. Pilote/ })).toHaveFocus());
});

it('série : refermer la fiche rend le focus à l’affiche ouverte', async () => {
  let resolveInfo: (value: unknown) => void = () => {};
  seriesMocks(resolve => { resolveInfo = resolve; });
  render(<VodLibrary playlist={playlist} kind="series" tvMode onSearch={() => {}} />);
  const poster = await screen.findByRole('button', { name: /Série Un/ });
  fireEvent.click(poster);
  await screen.findByRole('dialog');
  resolveInfo({ info: {}, episodes: { '1': [{ id: '501', episode_num: 1, title: 'Pilote', container_extension: 'mp4' }] } });
  await screen.findByRole('button', { name: /1\. Pilote/ });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  // Pas de retour aux rubriques : on reste sur l'affiche qu'on vient d'ouvrir.
  await waitFor(() => expect(poster).toHaveFocus());
});

it('série : une navigation déjà commencée garde la main à l’arrivée des épisodes', async () => {  let resolveInfo: (value: unknown) => void = () => {};
  seriesMocks(resolve => { resolveInfo = resolve; });
  render(<VodLibrary playlist={playlist} kind="series" tvMode onSearch={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Série Un/ }));
  await screen.findByRole('dialog');
  // L'utilisateur a déjà appuyé sur une flèche : le focus ne bouge plus tout seul.
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  const close = screen.getByRole('button', { name: 'Close' });
  close.focus();
  resolveInfo({ info: {}, episodes: { '1': [{ id: '501', episode_num: 1, title: 'Pilote', container_extension: 'mp4' }] } });
  await screen.findByRole('button', { name: /1\. Pilote/ });
  expect(document.activeElement).toBe(close);
});

it('propose « Pour toi » après Ma Liste', () => {
  const onToggleForYou = vi.fn();
  setup({ onToggleForYou });
  const nav = screen.getByRole('navigation', { name: 'Catégories' });
  expect(within(nav).getAllByRole('button').map(button => button.textContent).slice(0, 3)).toEqual(['Ma Liste2', 'Pour toi', 'Action']);
  fireEvent.click(within(nav).getByRole('button', { name: 'Pour toi' }));
  expect(onToggleForYou).toHaveBeenCalledTimes(1);
  cleanup();
  setup({ onToggleForYou, showForYou: true });
  expect(screen.getByRole('button', { name: 'Pour toi' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: /Pour toi/ })).toBeVisible();
});

it('« Pour toi » vide explique pourquoi', () => {
  setup({ onToggleForYou: vi.fn(), showForYou: true, items: [], hasMore: false, forYouEmptyText: 'Aucun film vu pour l’instant.' });
  expect(screen.getByText('Aucun film vu pour l’instant.')).toBeVisible();
});

it.each([
  ['Pour toi', { showForYou: true, onToggleForYou: vi.fn() }],
  ['Ma Liste', { showWatchlistOnly: true }],
] as const)('%s : revenir sur la catégorie déjà retenue quitte la liste', (_label, overrides) => {
  const { onSelectCategory } = setup({ category: 'c1', ...overrides });
  // Gauche depuis la grille : l'entrée active est la liste affichée, pas la catégorie.
  key('ArrowLeft');
  expect(col()).toBe('cat');
  expect(active()).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Action' }));
  expect(onSelectCategory).toHaveBeenCalledWith('c1');
});

it('Pour toi : droite sur la catégorie déjà retenue quitte aussi les suggestions', () => {
  const { onSelectCategory } = setup({ category: 'c1', showForYou: true, onToggleForYou: vi.fn() });
  key('ArrowLeft');
  key('ArrowDown'); // Pour toi → Action (catégorie déjà retenue)
  expect(active()).toHaveTextContent('Action');
  key('ArrowRight');
  expect(onSelectCategory).toHaveBeenCalledWith('c1');
});

it('Gauche des catégories VOD rejoint le rail et Droite revient à la même catégorie', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x:0,y:0,left:0,top:0,right:80,bottom:40,width:80,height:40,toJSON(){} });
  function Page() {
    useRemoteNavigation();
    return <Tabs value="movies" activationMode="manual"><MainNavigation tv onNavigate={()=>{}} />
      <TabsContent value="movies"><TvVodScreen kind="movie" playlistId="rail-vod" categories={[{id:'c1',name:'Action'}]} category="c1" onSelectCategory={()=>{}} items={items} loading={false} error="" onRetry={()=>{}} hasMore={false} onLoadMore={()=>{}} showWatchlistOnly={false} onToggleWatchlistOnly={()=>{}} watchlistCount={0} watchlistIds={new Set()} onOpen={()=>{}} onRefresh={()=>{}} progress={()=>({label:'Regarder',saved:false})} /></TabsContent>
    </Tabs>;
  }
  render(<Page/>);
  const category=screen.getByRole('button',{name:'Action'});
  act(() => category.focus()); key('ArrowLeft');
  expect(screen.getByRole('tab',{name:'Films'})).toHaveFocus();
  key('ArrowRight'); expect(category).toHaveFocus();
  vi.restoreAllMocks();
});
