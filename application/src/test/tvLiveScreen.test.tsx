import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TvLiveScreen } from '@/components/TvLiveScreen';
import { resolveTvMode } from '@/hooks/useTvMode';
import type { Channel } from '@/types/channel';

const fr: Channel[] = [
  { id: 'fr-1', name: 'Info', url: 'https://example.test/1', group: 'France', quality: 'HD' },
  { id: 'fr-2', name: 'Culture', url: 'https://example.test/2', group: 'France' },
  { id: 'fr-3', name: 'Sport', url: 'https://example.test/3', group: 'France' },
];
const be: Channel[] = [{ id: 'be-1', name: 'Bruxelles', url: 'https://example.test/b', group: 'Belgique' }];
const adult: Channel[] = [{ id: 'x-1', name: 'Nuit', url: 'https://example.test/x', group: 'Adulte' }];
const groups = [{ name: 'France', channels: fr }, { name: 'Belgique', channels: be }, { name: 'Adulte', channels: adult }];

beforeEach(() => { localStorage.clear(); document.documentElement.classList.add('remote-navigation'); });
afterEach(() => { cleanup(); document.documentElement.classList.remove('remote-navigation'); });

const active = () => document.activeElement as HTMLElement;
const key = (k: string) => fireEvent.keyDown(active(), { key: k });

it('le bouton Tri classe Toutes entre pays et permet de retrouver l’ordre de la liste', () => {
  function SortedScreen() {
    const [alphabetical, setSorted] = useState(false);
    return <TvLiveScreen playlistId="tri" groups={groups} favoriteIds={[]} alphabetical={alphabetical} onToggleSort={() => setSorted(v => !v)} onPlay={() => {}} />;
  }
  render(<SortedScreen />);
  const names = () => [...document.querySelectorAll<HTMLButtonElement>('[data-channel-row-id]')].map(el => el.getAttribute('aria-label')!.replace(/^\d+\. /, ''));
  expect(names()[0]).toBe('Info');
  const sort = screen.getByRole('button', { name: 'Tri : liste' });
  fireEvent.click(sort);
  expect(names()).toEqual(['Bruxelles', 'Culture', 'Info', 'Nuit', 'Sport']);
  fireEvent.click(screen.getByRole('button', { name: 'Tri : A–Z' }));
  expect(names()[0]).toBe('Info');
});

function setup(extra: Partial<React.ComponentProps<typeof TvLiveScreen>> = {}) {
  const onPlay = vi.fn();
  render(<TvLiveScreen playlistId="tv-test" groups={groups} favoriteIds={[]} onPlay={onPlay} onSearch={() => {}} onGuide={() => {}} {...extra} />);
  return { onPlay };
}

it('arrive sur la liste, descend ligne par ligne et OK lance la chaîne', () => {
  const { onPlay } = setup();
  expect(active().dataset.tvRow).toBe('0');
  expect(screen.getByRole('heading', { name: 'Toutes' })).toBeVisible();
  key('ArrowDown');
  expect(active().dataset.tvRow).toBe('1');
  expect(active()).toHaveAccessibleName('2. Culture');
  fireEvent.click(active());
  expect(onPlay).toHaveBeenCalledWith(fr[1]);
});

it('borne la hauteur dès le premier rendu : la liste garde une fenêtre défilante', () => {
  setup();
  const root = document.querySelector<HTMLElement>('[data-tv-live]');
  // Sans hauteur au premier rendu, la rangée de grille prend la hauteur du contenu et le
  // virtualiseur rend les 18 900 chaînes d'un coup (WebView figée, plus aucune flèche).
  expect(root?.style.height).toMatch(/^\d+px$/);
  expect(parseInt(root!.style.height, 10)).toBeLessThanOrEqual(window.innerHeight);
});

it('gauche passe aux catégories ; la liste suit après une pause, droite l’applique tout de suite', async () => {
  setup();
  key('ArrowLeft');
  expect(active().closest('[data-tv-col]')?.getAttribute('data-tv-col')).toBe('cat');
  expect(active()).toHaveTextContent('Toutes');
  key('ArrowDown');
  expect(active()).toHaveTextContent('Favoris');
  for (let i = 0; i < 2; i++) key('ArrowDown');
  expect(active()).toHaveTextContent('France');
  key('ArrowDown');
  expect(active()).toHaveTextContent('Belgique');
  // Un passage rapide ne change pas la liste ; une pause l'affiche sans appui sur OK.
  expect(screen.getByRole('heading', { name: 'Toutes' })).toBeVisible();
  expect(await screen.findByRole('heading', { name: 'Belgique' })).toBeVisible();
  key('ArrowDown');
  expect(active()).toHaveTextContent('Adulte');
  key('ArrowRight');
  expect(screen.getByRole('heading', { name: 'Adulte' })).toBeVisible();
  // Numérotation canonique : Nuit garde le numéro 5 de la liste complète.
  expect(active()).toHaveAccessibleName('5. Nuit');
});

it('droite ouvre l’aperçu : Regarder lance la chaîne mise en avant', () => {
  const { onPlay } = setup();
  key('ArrowDown');
  key('ArrowRight');
  expect(active()).toHaveTextContent('Regarder');
  key('ArrowDown');
  expect(active()).toHaveTextContent('Ajouter aux favoris');
  key('ArrowUp');
  fireEvent.click(active());
  expect(onPlay).toHaveBeenCalledWith(fr[1]);
});

it('Retour remonte aperçu → chaînes → catégories, puis laisse la main', () => {
  setup();
  key('ArrowRight');
  const back = () => { const e = new Event('tv-live-back', { cancelable: true }); act(() => { window.dispatchEvent(e); }); return e.defaultPrevented; };
  expect(back()).toBe(true);
  expect(active().dataset.tvRow).toBe('0');
  expect(back()).toBe(true);
  expect(active().dataset.tvCat).toBeDefined();
  expect(back()).toBe(false);
});

it('Haut sur la première catégorie rend la main à la navigation générale', () => {
  setup();
  key('ArrowLeft');
  for (let i = 0; i < 6; i++) key('ArrowUp');
  expect(active()).toHaveTextContent('Toutes');
  const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
  active().dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('une seule cible par colonne reste atteignable depuis l’extérieur (tabindex itinérant)', () => {
  setup();
  const reachable = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-item]')).filter(el => el.tabIndex === 0);
  expect(reachable).toHaveLength(1);
  expect(reachable[0].dataset.tvRow).toBe('0');
});

it('groupe protégé : liste vide, OK demande le code', () => {
  const onLockedGroupSelect = vi.fn();
  setup({ lockedGroups: ['Adulte'], onLockedGroupSelect });
  expect(screen.getByRole('heading', { name: 'Toutes' })).toBeVisible();
  for (let i = 0; i < 6; i++) key('ArrowDown');
  // La chaîne adulte n'apparaît pas dans Toutes : la dernière ligne est Bruxelles.
  expect(active()).toHaveAccessibleName('4. Bruxelles');
  key('ArrowLeft');
  for (let i = 0; i < 5; i++) key('ArrowDown');
  expect(active()).toHaveTextContent('Adulte');
  key('ArrowRight');
  expect(screen.getByText(/Groupe protégé/)).toBeVisible();
  expect(active()).toHaveTextContent('Adulte'); // liste vide : le focus reste sur la catégorie
  fireEvent.click(active());
  expect(onLockedGroupSelect).toHaveBeenCalledTimes(1);
});

it('les favoris s’ouvrent en premier quand il y en a', () => {
  setup({ favoriteIds: ['be-1'] });
  expect(screen.getByRole('heading', { name: 'Favoris' })).toBeVisible();
  // Numérotation canonique : Bruxelles porte le numéro 4 de la liste complète,
  // pas la position 1 de la catégorie Favoris.
  expect(active()).toHaveAccessibleName('4. Bruxelles');
});

it('les chiffres composent un numéro, la sélection rejoint la chaîne après validation', () => {
  vi.useFakeTimers();
  try {
    setup({ zapList: [...fr, ...be] });
    key('2');
    expect(screen.getByRole('status', { name: 'Zapping' })).toHaveTextContent('2');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(active().dataset.tvRow).toBe('1');
    expect(active()).toHaveAccessibleName('2. Culture');
    expect(screen.queryByRole('status', { name: 'Zapping' })).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('un numéro sans chaîne affiche le message et ne déplace pas la sélection', () => {
  vi.useFakeTimers();
  try {
    setup({ zapList: [...fr, ...be] });
    key('9');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByRole('status', { name: 'Zapping' })).toHaveTextContent('Aucune chaîne n° 9');
    expect(active().dataset.tvRow).toBe('0');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.queryByRole('status', { name: 'Zapping' })).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('le tampon accepte 5 chiffres, comme le lecteur natif', () => {
  vi.useFakeTimers();
  try {
    setup({ zapList: [...fr, ...be] });
    for (const d of ['1', '2', '3', '4', '5']) key(d);
    expect(screen.getByRole('status', { name: 'Zapping' })).toHaveTextContent('12345');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByRole('status', { name: 'Zapping' })).toHaveTextContent('Aucune chaîne n° 12345');
  } finally { vi.useRealTimers(); }
});

it('un numéro d’une autre catégorie rejoint la chaîne et sa catégorie', () => {
  vi.useFakeTimers();
  try {
    setup({ zapList: [...fr, ...be] });
    // Partir d'une catégorie sans Bruxelles : la liste France, dans l'ordre de la source.
    key('ArrowLeft');
    for (let i = 0; i < 3; i++) key('ArrowDown');
    key('ArrowRight');
    act(() => { vi.advanceTimersByTime(600); }); // laisse la sélection de catégorie s'appliquer
    expect(screen.getByRole('heading', { name: 'France' })).toBeVisible();
    key('4');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByRole('heading', { name: 'Belgique' })).toBeVisible();
    expect(active()).toHaveAccessibleName('4. Bruxelles');
  } finally { vi.useRealTimers(); }
});

it('entrer dans une catégorie qui contient la chaîne en cours : le focus va sur elle', () => {
  const { onPlay } = setup({ currentChannel: fr[2] });
  key('ArrowLeft');
  for (let i = 0; i < 3; i++) key('ArrowDown'); // France, catégorie de la chaîne en cours
  key('ArrowRight');
  expect(screen.getByRole('heading', { name: 'France' })).toBeVisible();
  expect(active()).toHaveAccessibleName('3. Sport');
  fireEvent.click(active());
  expect(onPlay).toHaveBeenCalledWith(fr[2]);
});

it('mode d’interface : réglage manuel prioritaire sur la détection', () => {
  expect(resolveTvMode('auto', true)).toBe(true);
  expect(resolveTvMode('auto', false)).toBe(false);
  expect(resolveTvMode(undefined, true)).toBe(true);
  expect(resolveTvMode('tv', false)).toBe(true);
  expect(resolveTvMode('mobile', true)).toBe(false);
});
