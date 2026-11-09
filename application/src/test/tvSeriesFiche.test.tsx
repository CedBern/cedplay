import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { TvSeriesFiche } from '@/components/TvSeriesFiche';
import type { Episode } from '@/utils/xtreamCatalog';

const episodes: Episode[] = [
  { id: '101', name: 'Pilote', season: '1', number: 1, extension: 'mp4', plot: 'Premier épisode.' },
  { id: '102', name: 'Retour', season: '1', number: 2, extension: 'mp4', plot: '' },
  { id: '201', name: 'Nouveau départ', season: '2', number: 1, extension: 'mkv', plot: '' },
];

afterEach(cleanup);

function setup(overrides: Partial<ComponentProps<typeof TvSeriesFiche>> = {}) {
  const props = {
    episodes,
    season: '1',
    onSeasonChange: vi.fn(),
    watchlisted: false,
    onToggleWatchlist: vi.fn(),
    subtitlesEnabled: true,
    subtitleEpisodeId: null,
    onSubtitles: vi.fn(),
    onPlay: vi.fn(),
    progress: () => ({ label: 'Regarder', saved: false }),
    busy: false,
    ...overrides,
  };
  // La saison est contrôlée par le parent, comme dans la fiche réelle.
  function Harness() {
    const [season, setSeason] = useState(props.season);
    return <TvSeriesFiche {...props} season={season} onSeasonChange={next => { props.onSeasonChange(next); setSeason(next); }} />;
  }
  const view = render(<Harness />);
  return { ...props, ...view };
}

const active = () => document.activeElement as HTMLElement;

it('entre sur le premier épisode, puis Haut/Bas change d’épisode, pas de bouton', () => {
  setup();
  const first = screen.getByRole('button', { name: /1\. Pilote/ });
  expect(active()).toBe(first);
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(active()).toBe(screen.getByRole('button', { name: /2\. Retour/ }));
  fireEvent.keyDown(active(), { key: 'ArrowUp' });
  expect(active()).toBe(first);
});

it('Droite entre dans les options de l’épisode, Gauche revient à la liste', () => {
  const { onPlay } = setup();
  fireEvent.keyDown(active(), { key: 'ArrowRight' });
  const play = screen.getByRole('button', { name: 'Regarder' });
  expect(active()).toBe(play);
  fireEvent.keyDown(play, { key: 'ArrowDown' });
  expect(active()).toBe(screen.getByRole('button', { name: 'Sous-titres' }));
  fireEvent.keyDown(active(), { key: 'ArrowLeft' });
  expect(active()).toBe(screen.getByRole('button', { name: /1\. Pilote/ }));
  fireEvent.keyDown(active(), { key: 'ArrowRight' });
  fireEvent.click(active());
  expect(onPlay).toHaveBeenCalledWith(episodes[0], false);
});

it('la ligne Saison change de saison à Gauche/Droite, puis Bas revient aux épisodes', () => {
  const { onSeasonChange } = setup();
  fireEvent.keyDown(active(), { key: 'ArrowUp' });
  const seasonRow = screen.getByRole('button', { name: 'Saison 1 sur 2' });
  expect(active()).toBe(seasonRow);
  fireEvent.keyDown(seasonRow, { key: 'ArrowRight' });
  expect(onSeasonChange).toHaveBeenCalledWith('2');
  expect(active()).toBe(screen.getByRole('button', { name: 'Saison 2 sur 2' }));
  expect(screen.getByRole('button', { name: /1\. Nouveau départ/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /1\. Pilote/ })).toBeNull();
  fireEvent.keyDown(active(), { key: 'ArrowDown' });
  expect(active()).toBe(screen.getByRole('button', { name: /1\. Nouveau départ/ }));
});

it('OK sur un épisode place le focus sur ses options sans lancer la lecture', () => {
  const { onPlay } = setup();
  fireEvent.keyDown(active(), { key: 'ArrowDown' });
  const second = active();
  fireEvent.click(second);
  expect(active()).toBe(screen.getByRole('button', { name: 'Regarder' }));
  expect(onPlay).not.toHaveBeenCalled();
  expect(screen.getByText('Épisode 2 · Retour')).toBeTruthy();
});

it('affiche « Depuis le début » seulement pour un épisode repris', () => {
  const { onPlay } = setup({ progress: id => id === '101' ? { label: 'Reprendre à 12 min', saved: true } : { label: 'Regarder', saved: false } });
  expect(screen.getByRole('button', { name: 'Reprendre à 12 min' })).toBeTruthy();
  fireEvent.keyDown(active(), { key: 'ArrowRight' });
  fireEvent.keyDown(active(), { key: 'ArrowDown' });
  expect(active()).toBe(screen.getByRole('button', { name: 'Depuis le début' }));
  fireEvent.click(active());
  expect(onPlay).toHaveBeenCalledWith(episodes[0], true);
});

it('propose Ma Liste dans les mêmes options, sans sortir de la fiche', () => {
  const { onToggleWatchlist } = setup({ watchlisted: true });
  fireEvent.keyDown(active(), { key: 'ArrowRight' });
  fireEvent.keyDown(active(), { key: 'ArrowDown' });
  fireEvent.keyDown(active(), { key: 'ArrowDown' });
  const remove = screen.getByRole('button', { name: 'Retirer de Ma Liste' });
  expect(active()).toBe(remove);
  fireEvent.click(remove);
  expect(onToggleWatchlist).toHaveBeenCalled();
});

it('le panneau de sous-titres est atteignable par une action dédiée', () => {
  const { onSubtitles } = setup();
  fireEvent.keyDown(active(), { key: 'ArrowRight' });
  fireEvent.keyDown(active(), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Sous-titres' }));
  expect(onSubtitles).toHaveBeenCalledWith(episodes[0]);
});

it('sans format annoncé, la lecture disparaît mais les autres options restent', () => {
  const noFormat: Episode = { ...episodes[0] as Episode, extension: '' };
  setup({ episodes: [noFormat] });
  expect(screen.queryByRole('button', { name: 'Regarder' })).toBeNull();
  expect(screen.getByText('Format non fourni.')).toBeTruthy();
  fireEvent.keyDown(active(), { key: 'ArrowRight' });
  expect(active()).toBe(screen.getByRole('button', { name: 'Sous-titres' }));
});
