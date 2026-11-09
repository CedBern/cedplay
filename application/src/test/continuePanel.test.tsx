import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContinuePanel } from '@/components/ContinuePanel';
import { getPlayHistory, setMeta } from '@/utils/idb';
import type { Channel, PlaylistInfo } from '@/types/channel';

afterEach(cleanup);

const channels: Channel[] = [
  { id: 'a', name: 'Télé Québec', url: 'https://example.test/a', group: 'Test', quality: 'HD' },
  { id: 'b', name: 'Arte', url: 'https://example.test/b', group: 'Test', quality: 'HD' },
];
const playlist: PlaylistInfo = {
  id: 'ma-liste',
  name: 'Liste test',
  channels,
  groups: [{ name: 'Test', channels }],
};

beforeEach(async () => { await setMeta('playHistory', []); await setMeta('vod_watchlist', []); });

it('affiche les chaînes récentes et les films/séries en cours, en ignorant le reste', async () => {
  await setMeta('playHistory', [
    { channelId: 'a', ts: 4 },
    { channelId: 'b', ts: 3 },
    { channelId: 'vod:ma-liste:movie:42', kind: 'vod', name: 'Film test', ts: 5, status: 'started', positionMs: 180000 },
    // Terminé : ne doit pas apparaître dans « Reprendre »
    { channelId: 'vod:ma-liste:movie:43', kind: 'vod', name: 'Déjà fini', ts: 2, status: 'completed', positionMs: 1000000 },
    // À peine lancé (sous le seuil) : ne doit pas apparaître
    { channelId: 'vod:ma-liste:series:7', kind: 'vod', name: 'Épisode survolé', ts: 1, status: 'started', positionMs: 1000 },
  ]);

  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);

  const reprise = await screen.findByRole('region', { name: 'Reprendre' });
  expect(within(reprise).getByText('Film test')).toBeTruthy();
  expect(within(reprise).getByText(/Reprendre à 3 min/)).toBeTruthy();
  expect(screen.queryByText('Déjà fini')).toBeNull();
  expect(screen.queryByText('Épisode survolé')).toBeNull();

  const recentes = screen.getByRole('region', { name: 'Chaînes récentes' });
  expect(within(recentes).getByText('Télé Québec')).toBeTruthy();
  expect(within(recentes).getByText('Arte')).toBeTruthy();
});

it('redirige vers le catalogue et vers la chaîne au clic', async () => {
  await setMeta('playHistory', [
    { channelId: 'a', ts: 2 },
    { channelId: 'vod:ma-liste:series:9', kind: 'vod', name: 'Série test', ts: 3, status: 'started', positionMs: 120000 },
  ]);
  const onChannelSelect = vi.fn();
  const onOpenVod = vi.fn();
  const user = userEvent.setup();

  render(<ContinuePanel playlist={playlist} onChannelSelect={onChannelSelect} onOpenVod={onOpenVod} />);

  await user.click(await screen.findByRole('button', { name: 'Reprendre Série test' }));
  expect(onOpenVod).toHaveBeenCalledWith('series');

  await user.click(screen.getByRole('button', { name: /Télé Québec/ }));
  expect(onChannelSelect).toHaveBeenCalledWith(channels[0]);
});

it('affiche l’affiche et la progression puis retire la carte en conservant la position', async () => {
  await setMeta('playHistory', [{ channelId: 'vod:ma-liste:movie:42', kind: 'vod', name: 'Mon film', ts: 5, positionMs: 180000, durationMs: 720000, poster: 'https://example.test/affiche.jpg' }]);
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  const region = await screen.findByRole('region', { name: 'Reprendre' });
  expect(within(region).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  expect(region.querySelector('img')).toHaveAttribute('src', 'https://example.test/affiche.jpg');
  expect(within(region).getByText('25 % · 9 min restantes')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer Mon film de Reprendre' }));
  expect(await screen.findByText('Rien à reprendre pour le moment.')).toBeTruthy();
  expect((await getPlayHistory())[0]).toMatchObject({ positionMs: 180000, hiddenFromContinue: true });
});

it('marque un épisode comme vu sans modifier les autres listes', async () => {
  await setMeta('playHistory', [
    { channelId: 'vod:ma-liste:series:42', kind: 'vod', name: 'Série', episodeName: 'S2 E3', ts: 5, positionMs: 180000 },
    { channelId: 'vod:autre:series:42', kind: 'vod', name: 'Autre', ts: 4, positionMs: 190000 },
  ]);
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  // L'épisode apparaît dans le bandeau « À la une » et dans la carte de reprise.
  expect((await screen.findAllByText('S2 E3')).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Marquer Série comme vu' }));
  expect(await screen.findByText('Rien à reprendre pour le moment.')).toBeTruthy();
  const history = await getPlayHistory();
  expect(history.find(e => e.playlistId === 'ma-liste')?.status).toBe('completed');
  expect(history.find(e => e.playlistId === 'autre')?.status).toBeUndefined();
});

it('affiche un état vide quand il n’y a rien à reprendre', async () => {
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  expect(await screen.findByText('Rien à reprendre pour le moment.')).toBeTruthy();
});


it('affiche la section Ma Liste et déclenche onOpenVod avec l’élément au clic', async () => {
  await setMeta('vod_watchlist', [
    { id: '101', name: 'Interstellar', kind: 'movie', playlistId: 'ma-liste', rating: '8.6' },
  ]);
  const onOpenVod = vi.fn();
  const user = userEvent.setup();

  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={onOpenVod} />);

  const watchlistRegion = await screen.findByRole('region', { name: 'Ma liste' });
  expect(within(watchlistRegion).getByText('Interstellar')).toBeTruthy();
  expect(within(watchlistRegion).getByText(/Film · ★ 8.6/)).toBeTruthy();

  await user.click(within(watchlistRegion).getByRole('button', { name: /Interstellar/ }));
  expect(onOpenVod).toHaveBeenCalledWith('movie', expect.objectContaining({ id: '101', name: 'Interstellar' }));
});

it('Découvrir : ordre par défaut Direct, Vidéo, Podcasts et Sélection CedPlay sans émission suivie', async () => {
  await setMeta('favorites', ['a']);
  await setMeta('vod_watchlist', [{ id: '101', name: 'Interstellar', kind: 'movie', playlistId: 'ma-liste' }]);
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await screen.findByRole('region', { name: 'Ma liste' });
  const titles = screen.getAllByRole('region').map(r => r.getAttribute('aria-label'));
  expect(titles).toEqual(['Mes chaînes en ce moment', 'Ma liste', 'Sélection CedPlay', 'Chaînes récentes'].filter(t => titles.includes(t)));
  expect(titles.indexOf('Mes chaînes en ce moment')).toBeLessThan(titles.indexOf('Ma liste'));
  expect(titles.indexOf('Ma liste')).toBeLessThan(titles.indexOf('Sélection CedPlay'));
});

it('Découvrir : les filtres gardent seulement les rangées de leur type, Direct seulement dans Tout', async () => {
  await setMeta('playHistory', [{ channelId: 'a', ts: 4 }]);
  await setMeta('vod_watchlist', [
    { id: '101', name: 'Interstellar', kind: 'movie', playlistId: 'ma-liste' },
    { id: '7', name: 'Slow Horses', kind: 'series', playlistId: 'ma-liste' },
  ]);
  const user = userEvent.setup();
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  expect(await screen.findByRole('region', { name: 'Chaînes récentes' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Séries' }));
  expect(screen.queryByRole('region', { name: 'Chaînes récentes' })).toBeNull();
  const list = screen.getByRole('region', { name: 'Ma liste' });
  expect(within(list).getByText('Slow Horses')).toBeTruthy();
  expect(within(list).queryByText('Interstellar')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Podcasts' }));
  expect(screen.queryByRole('region', { name: 'Ma liste' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Sélection CedPlay' })).toBeTruthy();
});

it('Découvrir : la fiche d’un titre en cours s’ouvre par un bouton explicite, sans appui long', async () => {
  await setMeta('playHistory', [{ channelId: 'vod:ma-liste:movie:42', kind: 'vod', name: 'Mon film', ts: 5, positionMs: 180000, durationMs: 720000 }]);
  const onOpenVod = vi.fn();
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={onOpenVod} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Fiche de Mon film' }));
  expect(onOpenVod).toHaveBeenCalledWith('movie', expect.objectContaining({ id: '42', name: 'Mon film', playlistId: 'ma-liste' }));
});
