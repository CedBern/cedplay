import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Channel } from '@/types/channel';

const bridge = vi.hoisted(() => ({
  showPreview: vi.fn(async () => true),
  stopPreview: vi.fn(async () => {}),
  hidePreview: vi.fn(async () => {}),
  onPreviewState: vi.fn((_listener: (state: string) => void) => () => {}),
}));
vi.mock('@/utils/nativePlayer', () => ({ NativePlayerBridge: bridge }));

import { TvLiveScreen } from '@/components/TvLiveScreen';

const channels: Channel[] = [
  { id: 'a', name: 'Info', url: 'https://example.test/a', group: 'France' },
  { id: 'b', name: 'Sport', url: 'https://example.test/b', group: 'France' },
];
const groups = [{ name: 'France', channels }];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.documentElement.classList.add('remote-navigation');
  Object.values(bridge).forEach(fn => fn.mockClear());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 640, top: 90, width: 288, height: 162, right: 928, bottom: 252, x: 640, y: 90, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('remote-navigation');
});

const active = () => document.activeElement as HTMLElement;
const key = (k: string) => fireEvent.keyDown(active(), { key: k });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function setup(preview = true) {
  const onPlay = vi.fn();
  const view = render(<TvLiveScreen playlistId="preview-test" groups={groups} favoriteIds={[]} onPlay={onPlay} preview={preview} />);
  return { onPlay, view };
}

function setupManual() {
  const onPlay = vi.fn();
  const view = render(<TvLiveScreen playlistId="preview-manual" groups={groups} favoriteIds={[]} onPlay={onPlay} preview previewMode="manual" />);
  return { onPlay, view };
}

it('lance l’aperçu de la chaîne surlignée après un court arrêt, à l’emplacement réservé', () => {
  setup();
  expect(active().dataset.tvRow).toBe('0');
  wait(300);
  expect(bridge.showPreview).not.toHaveBeenCalled();
  wait(400);
  expect(bridge.showPreview).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://example.test/a', x: 640, y: 90, width: 288, height: 162 }));
  expect(document.querySelector('[data-tv-preview]')).toHaveTextContent('Aperçu…');
});

it('changer de ligne coupe tout de suite le flux, puis lance la nouvelle chaîne', () => {
  setup();
  wait(700);
  bridge.stopPreview.mockClear();
  key('ArrowDown');
  expect(bridge.stopPreview).toHaveBeenCalled();
  wait(700);
  expect(bridge.showPreview).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://example.test/b' }));
});

it('parcourir les catégories arrête l’aperçu ; quitter l’écran le ferme', () => {
  const { view } = setup();
  wait(700);
  bridge.showPreview.mockClear();
  key('ArrowLeft');
  wait(1000);
  expect(bridge.stopPreview).toHaveBeenCalled();
  expect(bridge.showPreview).not.toHaveBeenCalled();
  view.unmount();
  expect(bridge.hidePreview).toHaveBeenCalled();
});

it('le focus parti ailleurs (fenêtre, rubriques) arrête l’aperçu', () => {
  setup();
  wait(700);
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  bridge.showPreview.mockClear();
  act(() => { outside.focus(); });
  wait(1000);
  expect(bridge.showPreview).not.toHaveBeenCalled();
  expect(bridge.stopPreview).toHaveBeenCalled();
  outside.remove();
});

it('aperçu désactivé : aucun appel au lecteur Android', () => {
  setup(false);
  wait(1000);
  expect(bridge.showPreview).not.toHaveBeenCalled();
  expect(bridge.stopPreview).not.toHaveBeenCalled();
  expect(document.querySelector('[data-tv-preview]')).toBeNull();
});

it('avec l’aperçu, les actions forment une grille : droite/bas s’y déplacent, gauche revient à la liste', () => {
  setup();
  key('ArrowRight');
  expect(active()).toHaveAccessibleName('Regarder');
  key('ArrowRight');
  expect(active()).toHaveAccessibleName('Ajouter aux favoris');
  key('ArrowLeft');
  expect(active()).toHaveAccessibleName('Regarder');
  key('ArrowLeft');
  expect(active().dataset.tvRow).toBe('0');
});

it('mode manuel : le survol n’ouvre aucun flux, l’invitation reste affichée', () => {
  setupManual();
  wait(1000);
  expect(bridge.showPreview).not.toHaveBeenCalled();
  expect(document.querySelector('[data-tv-preview]')).toHaveTextContent('Lance via « Aperçu »');
});

it('mode manuel : le bouton « Aperçu » lance le flux surligné, puis le coupe', () => {
  setupManual();
  wait(50);
  fireEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
  wait(700);
  expect(bridge.showPreview).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://example.test/a' }));
  bridge.stopPreview.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Couper l’aperçu' }));
  wait(50);
  expect(bridge.stopPreview).toHaveBeenCalled();
  wait(700);
  expect(bridge.showPreview).toHaveBeenCalledTimes(1);
});

it('mode manuel : changer de chaîne coupe l’aperçu, un nouvel appui est requis', () => {
  setupManual();
  wait(50);
  fireEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
  wait(700);
  expect(bridge.showPreview).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://example.test/a' }));
  bridge.stopPreview.mockClear();
  key('ArrowDown');
  // Le flux est coupé dès le changement de chaîne, sans suivi automatique.
  expect(bridge.stopPreview).toHaveBeenCalled();
  wait(700);
  expect(bridge.showPreview).toHaveBeenCalledTimes(1);
  // Le bouton repasse à « Aperçu » : nouvel appui pour la nouvelle chaîne.
  fireEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
  wait(700);
  expect(bridge.showPreview).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://example.test/b' }));
  expect(bridge.showPreview).toHaveBeenCalledTimes(2);
});
