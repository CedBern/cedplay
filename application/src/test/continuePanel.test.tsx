import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContinuePanel } from '@/components/ContinuePanel';
import { getPlayHistory, setMeta } from '@/utils/idb';
import { clearPodcastStorageForTests, saveEpisodeProgress, saveSubscribedPodcast, removeSubscribedPodcast } from '@/utils/podcastStorage';
import type { Channel, PlaylistInfo } from '@/types/channel';
import { clearParentalVodRegistry, rememberVodCategories } from '@/utils/parentalVod';
import { saveForYouSnapshot } from '@/utils/discover';
import { writeMyPlatforms } from '@/utils/myPlatforms';
import * as xtreamCatalog from '@/utils/xtreamCatalog';
vi.mock('@/hooks/useBodlavDocumentaries', () => ({ useBodlavDocumentaries: () => [] }));
vi.mock('@/hooks/useOfficialDocumentaries', () => ({ useOfficialDocumentaries: () => [] }));

afterEach(() => { cleanup(); clearPodcastStorageForTests(); });

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

it('place la reprise audio après Ma liste et la masque de Tout après désabonnement', async () => {
  clearPodcastStorageForTests();
  const feed = { url: 'https://example.test/feed', title: 'Mon podcast', description: '', addedAt: 0, lastFetchedAt: Date.now() };
  saveSubscribedPodcast(feed, []);
  saveEpisodeProgress({ episodeId: 'audio-test', feedUrl: feed.url, title: 'Épisode audio', podcastTitle: feed.title,
    audioUrl: 'https://example.test/audio.mp3', positionMs: 60000, durationMs: 600000, speed: 1 });
  await setMeta('vod_watchlist', [{ id: '101', name: 'Film gardé', kind: 'movie', playlistId: playlist.id }]);
  const view = render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await screen.findByRole('region', { name: 'Ma liste' });
  const titles = screen.getAllByRole('region').map(r => r.getAttribute('aria-label'));
  expect(titles.indexOf('Reprendre les podcasts')).toBeGreaterThan(titles.indexOf('Ma liste'));
  expect(screen.queryByRole('region', { name: 'Reprendre' })).toBeNull();
  expect(within(screen.getByRole('region', { name: 'Reprendre les podcasts' })).getByText('Épisode audio')).toBeTruthy();
  view.unmount();
  removeSubscribedPodcast(feed.url);
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await screen.findByRole('region', { name: 'Ma liste' });
  expect(screen.queryByText('Épisode audio')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Podcasts' }));
  expect(within(screen.getByRole('region', { name: 'Reprendre' })).getByText('Épisode audio')).toBeTruthy();
});

beforeEach(async () => { await setMeta('playHistory', []); await setMeta('vod_watchlist', []); writeMyPlatforms([]); });

it('regroupe les recommandations par visionnage réel, sans doubler Pour toi', async () => {
  const sourceId = `vod:${playlist.id}:movie:source`;
  await setMeta('playHistory', [{ channelId: sourceId, kind: 'vod', name: 'Film source', ts: 10, status: 'completed' }]);
  saveForYouSnapshot(playlist.id, [
    { id: 'suggestion', name: 'Film conseillé', sourceId, reason: 'Même catégorie' },
    { id: 'autre', name: 'Autre conseil' },
  ]);
  const onOpenVod = vi.fn();
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={onOpenVod} tvMode />);
  const row = await screen.findByRole('region', { name: 'Parce que tu as regardé « Film source »' });
  await userEvent.click(within(row).getByRole('button', { name: /Film conseillé/ }));
  expect(onOpenVod).toHaveBeenCalledWith('movie', expect.objectContaining({ id: 'suggestion' }));
  expect(within(screen.getByRole('region', { name: 'Pour toi' })).queryByText('Film conseillé')).toBeNull();
  saveForYouSnapshot(playlist.id, []);
});

it('affiche les plateformes choisies, masque leur accès sous verrouillage parental', async () => {
  writeMyPlatforms(['youtube']);
  const view = render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  const row = await screen.findByRole('region', { name: 'Mes plateformes' });
  expect(within(row).getByRole('button', { name: /YouTube/ })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Films' }));
  expect(screen.queryByRole('region', { name: 'Mes plateformes' })).toBeNull();
  view.rerender(<ContinuePanel playlist={playlist} parentalEnabled unlocked={false} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tout' }));
  expect(screen.queryByRole('region', { name: 'Mes plateformes' })).toBeNull();
  writeMyPlatforms([]);
});

it('ouvre le prochain épisode disponible avec son identifiant et celui de sa série', async () => {
  const linked = { ...playlist, id: 'suite-serie' };
  localStorage.setItem('xtream_account_suite-serie', JSON.stringify({ server: 'https://example.test', username: 'test', password: 'test' }));
  const request = vi.spyOn(xtreamCatalog, 'catalogRequest').mockResolvedValue({ episodes: { '1': [
    { id: '101', title: 'Premier', episode_num: 1, container_extension: 'mp4' },
    { id: '102', title: 'Deuxième', episode_num: 2, container_extension: 'mp4' },
  ] } });
  try {
    await setMeta('playHistory', [{ channelId: 'vod:suite-serie:series:101', kind: 'vod', mediaKind: 'series', seriesId: '7', name: 'Ma série', ts: 10, status: 'completed' }]);
    const onResumeVod = vi.fn();
    render(<ContinuePanel playlist={linked} onChannelSelect={() => {}} onOpenVod={() => {}} onResumeVod={onResumeVod} tvMode />);
    const row = await screen.findByRole('region', { name: 'Épisodes suivants' });
    await userEvent.click(within(row).getByRole('button', { name: /Ma série/ }));
    expect(onResumeVod).toHaveBeenCalledWith({ kind: 'series', id: '102', seriesId: '7', name: 'Ma série' });
    expect(request).toHaveBeenCalledWith(expect.any(Object), 'get_series_info', { series_id: '7' }, expect.any(AbortSignal));
  } finally {
    cleanup(); request.mockRestore(); localStorage.removeItem('xtream_account_suite-serie');
  }
});

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

it('Découvrir : ordre par défaut Direct avant Vidéo et aucun podcast non sollicité sur l’accueil', async () => {
  await setMeta('favorites', ['a']);
  await setMeta('vod_watchlist', [{ id: '101', name: 'Interstellar', kind: 'movie', playlistId: 'ma-liste' }]);
  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await screen.findByRole('region', { name: 'Ma liste' });
  const titles = screen.getAllByRole('region').map(r => r.getAttribute('aria-label'));
  expect(titles).toEqual(['Mes chaînes en ce moment', 'Ma liste', 'Documentaires TV5MONDEplus', 'Documentaires ImagoTV']);
  expect(titles.indexOf('Mes chaînes en ce moment')).toBeLessThan(titles.indexOf('Ma liste'));
});

it('Découvrir : les filtres gardent seulement les rangées de leur type, Direct seulement dans Tout', async () => {
  // Un favori laissé par un test précédent sortirait la chaîne « a » des récentes.
  await setMeta('favorites', []);
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

it('TV, premier lancement : l’accueil propose le direct, la connexion et les podcasts au lieu d’une page vide', async () => {
  clearPodcastStorageForTests();
  await setMeta('vod_watchlist', []);
  await setMeta('favorites', []);
  const user = userEvent.setup();
  const onBrowseLive = vi.fn(), onConnect = vi.fn(), onOpenPodcasts = vi.fn();
  const fresh: PlaylistInfo = { ...playlist, id: 'premier-lancement' };
  render(<ContinuePanel tvMode playlist={fresh} onChannelSelect={() => {}} onOpenVod={() => {}} onBrowseLive={onBrowseLive} onConnect={onConnect} onOpenPodcasts={onOpenPodcasts} />);
  const live = await screen.findByRole('button', { name: /Regarder le direct/ });
  expect(screen.getByRole('heading', { name: 'Par où commencer ?' })).toBeTruthy();
  expect(screen.queryByText('Rien à reprendre pour le moment.')).toBeNull();
  expect(live.textContent).toContain('2 chaînes prêtes dans « Liste test »');
  // Les tuiles suivent la navigation en rangées de l'accueil : Bas depuis les filtres, puis Droite.
  expect(live.hasAttribute('data-remote-start')).toBe(true);
  screen.getByRole('button', { name: 'Tout' }).focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(live);
  await user.keyboard('{ArrowRight}{Enter}');
  expect(onConnect).toHaveBeenCalledTimes(1);
  await user.click(live);
  expect(onBrowseLive).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: /Écouter un podcast/ }));
  expect(onOpenPodcasts).toHaveBeenCalledWith();
});

it('téléphone : l’accueil vide garde son message d’origine', async () => {
  clearPodcastStorageForTests();
  await setMeta('vod_watchlist', []);
  await setMeta('favorites', []);
  render(<ContinuePanel playlist={{ ...playlist, id: 'premier-lancement-mobile' }} onChannelSelect={() => {}} onOpenVod={() => {}} onBrowseLive={() => {}} onConnect={() => {}} />);
  expect(await screen.findByText('Rien à reprendre pour le moment.')).toBeTruthy();
  expect(screen.queryByText('Par où commencer ?')).toBeNull();
});

it('TV : le visuel initial suit la première rangée visible puis le focus et le filtre', async () => {
  await setMeta('favorites', ['a']);
  await setMeta('vod_watchlist', [
    { id: '1', name: 'Film gardé', kind: 'movie', playlistId: playlist.id, poster: 'https://example.test/film.jpg' },
    { id: '2', name: 'Série gardée', kind: 'series', playlistId: playlist.id, poster: 'https://example.test/serie.jpg' },
  ]);
  render(<ContinuePanel tvMode playlist={playlist} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  const hero = await screen.findByRole('region', { name: 'Contenu sélectionné' });
  expect(within(hero).getByRole('heading', { name: 'Télé Québec' })).toBeVisible();
  fireEvent.focus(within(screen.getByRole('region', { name: 'Ma liste' })).getByRole('button', { name: /Film gardé/ }));
  expect(hero.querySelector('img')).toHaveAttribute('src', 'https://example.test/film.jpg');
  await userEvent.click(screen.getByRole('button', { name: 'Séries' }));
  expect(within(hero).queryByText('Film gardé')).toBeNull();
  expect(within(hero).getByRole('heading', { name: 'Série gardée' })).toBeVisible();
  expect(hero.querySelector('img')).toHaveAttribute('src', 'https://example.test/serie.jpg');
});

it('TV : une chaîne verrouillée disparaît aussi immédiatement du visuel sélectionné', async () => {
  await setMeta('favorites', ['a']);
  const props = { tvMode: true, playlist, lockedGroups: ['Test'], onChannelSelect: () => {}, onOpenVod: () => {} };
  const { rerender } = render(<ContinuePanel {...props} unlocked />);
  await screen.findByRole('region', { name: 'Contenu sélectionné' });
  fireEvent.focus(within(screen.getByRole('region', { name: 'Mes chaînes en ce moment' })).getByRole('button'));
  rerender(<ContinuePanel {...props} unlocked={false} />);
  expect(screen.getByRole('region', { name: 'Contenu sélectionné' })).toHaveTextContent('Tous les documentaires');
  expect(screen.queryByRole('heading', { name: 'Télé Québec' })).toBeNull();
});

it('TV : le changement de playlist abandonne le film sélectionné de l’ancienne liste', async () => {
  await setMeta('favorites', []);
  await setMeta('vod_watchlist', [
    { id: '1', name: 'Ancien film', kind: 'movie', playlistId: playlist.id, poster: 'https://example.test/ancien.jpg' },
    { id: '1', name: 'Nouveau film', kind: 'movie', playlistId: 'autre-liste', poster: 'https://example.test/nouveau.jpg' },
  ]);
  const props = { tvMode: true, onChannelSelect: () => {}, onOpenVod: () => {} };
  const { rerender } = render(<ContinuePanel {...props} playlist={playlist} />);
  await screen.findByRole('region', { name: 'Contenu sélectionné' });
  fireEvent.focus(within(screen.getByRole('region', { name: 'Ma liste' })).getByRole('button', { name: /Ancien film/ }));
  rerender(<ContinuePanel {...props} playlist={{ ...playlist, id: 'autre-liste' }} />);
  const hero = await screen.findByRole('region', { name: 'Contenu sélectionné' });
  expect(within(hero).queryByText('Ancien film')).toBeNull();
  expect(within(hero).getByRole('heading', { name: 'Nouveau film' })).toBeVisible();
  expect(hero.querySelector('img')).toHaveAttribute('src', 'https://example.test/nouveau.jpg');
});

it('TV : le verrouillage VOD retire également le visuel d’un titre adulte', async () => {
  const linked = { ...playlist, id: 'hero-parental' };
  localStorage.setItem('xtream_account_hero-parental', JSON.stringify({ server: 'https://example.test', username: 'test', password: 'test' }));
  rememberVodCategories(linked.id, 'movie', [{ id: 'adult', name: 'Adult XXX' }]);
  rememberVodCategories(linked.id, 'series', []);
  await setMeta('favorites', []);
  await setMeta('vod_watchlist', [{ id: '1', name: 'Titre verrouillé', kind: 'movie', categoryId: 'adult', playlistId: linked.id, poster: 'https://example.test/adult.jpg' }]);
  const props = { tvMode: true, playlist: linked, parentalEnabled: true, onChannelSelect: () => {}, onOpenVod: () => {} };
  const { rerender } = render(<ContinuePanel {...props} unlocked />);
  await screen.findByRole('region', { name: 'Contenu sélectionné' });
  fireEvent.focus(within(screen.getByRole('region', { name: 'Ma liste' })).getByRole('button', { name: /Titre verrouillé/ }));
  rerender(<ContinuePanel {...props} unlocked={false} />);
  expect(screen.queryByRole('region', { name: 'Contenu sélectionné' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Titre verrouillé' })).toBeNull();
  localStorage.removeItem('xtream_account_hero-parental');
  clearParentalVodRegistry();
});

it('TV : Pour toi relit le cache de la nouvelle playlist pour la carte et son visuel', async () => {
  await setMeta('favorites', []);
  const first = { ...playlist, id: 'hero-cache-a' };
  const second = { ...playlist, id: 'hero-cache-b' };
  saveForYouSnapshot(first.id, [{ id: '1', name: 'Film du cache A', poster: 'https://example.test/cache-a.jpg' }]);
  saveForYouSnapshot(second.id, [{ id: '1', name: 'Film du cache B', poster: 'https://example.test/cache-b.jpg' }]);
  const props = { tvMode: true, onChannelSelect: () => {}, onOpenVod: () => {} };
  const { rerender } = render(<ContinuePanel {...props} playlist={first} />);
  await screen.findByRole('region', { name: 'Contenu sélectionné' });
  fireEvent.focus(within(screen.getByRole('region', { name: 'Pour toi' })).getByRole('button', { name: /Film du cache A/ }));
  rerender(<ContinuePanel {...props} playlist={second} />);
  const hero = await screen.findByRole('region', { name: 'Contenu sélectionné' });
  expect(within(hero).getByRole('heading', { name: 'Film du cache B' })).toBeVisible();
  expect(hero.querySelector('img')).toHaveAttribute('src', 'https://example.test/cache-b.jpg');
  const row = screen.getByRole('region', { name: 'Pour toi' });
  expect(within(row).getByRole('button', { name: /Film du cache B/ })).toBeVisible();
  expect(within(row).queryByText('Film du cache A')).toBeNull();
});

it('téléphone : le bandeau présente le titre en cours avec sa vraie affiche, puis Pour toi', async () => {
  await setMeta('favorites', []); await setMeta('vod_watchlist', []);
  const phone = { ...playlist, id: 'bandeau-telephone' };
  await setMeta('playHistory', [{ channelId: 'vod:bandeau-telephone:movie:42', kind: 'vod', name: 'Mon film', ts: 5, positionMs: 180000, durationMs: 720000, poster: 'https://example.test/affiche.jpg' }]);
  saveForYouSnapshot(phone.id, [{ id: '7', name: 'Film conseillé', poster: 'https://example.test/conseil.jpg', reason: 'Proche de « Mon film »' }]);
  const onResumeVod = vi.fn(); const onOpenVod = vi.fn();
  render(<ContinuePanel playlist={phone} onChannelSelect={() => {}} onOpenVod={onOpenVod} onResumeVod={onResumeVod} />);
  const hero = await screen.findByRole('region', { name: 'À la une' });
  const slides = within(hero).getAllByRole('article');
  expect(slides).toHaveLength(2);
  expect(within(slides[0]).getByRole('heading', { name: 'Mon film' })).toBeVisible();
  expect(slides[0].querySelector('img')).toHaveAttribute('src', 'https://example.test/affiche.jpg');
  expect(within(slides[1]).getByText('Proche de « Mon film »')).toBeVisible();
  await userEvent.click(within(slides[0]).getByRole('button', { name: 'Reprendre' }));
  expect(onResumeVod).toHaveBeenCalledWith(expect.objectContaining({ kind: 'movie', id: '42' }));
  await userEvent.click(within(slides[0]).getByRole('button', { name: 'Fiche de Mon film' }));
  await userEvent.click(within(slides[1]).getByRole('button', { name: 'Voir la fiche' }));
  expect(onOpenVod).toHaveBeenNthCalledWith(1, 'movie', expect.objectContaining({ id: '42', name: 'Mon film' }));
  expect(onOpenVod).toHaveBeenNthCalledWith(2, 'movie', expect.objectContaining({ id: '7', name: 'Film conseillé' }));
});

it('téléphone : les reprises sans affiche ne consomment pas les deux places du bandeau', async () => {
  await setMeta('favorites', []); await setMeta('vod_watchlist', []);
  const phone = { ...playlist, id: 'reprises-illustrees' };
  await setMeta('playHistory', Array.from({ length: 5 }, (_, index) => ({
    channelId: `vod:${phone.id}:movie:${index}`,
    kind: 'vod', name: `Film ${index}`, ts: 10 - index,
    positionMs: 180000, durationMs: 720000,
    ...(index >= 2 ? { poster: `https://example.test/affiche-${index}.jpg` } : {}),
  })));
  render(<ContinuePanel playlist={phone} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  const hero = await screen.findByRole('region', { name: 'À la une' });
  expect(within(hero).getAllByRole('heading').map(heading => heading.textContent)).toEqual(['Film 2', 'Film 3']);
});

it('téléphone : pas de bandeau sans affiche, ni dans Podcasts ; la TV garde son propre bandeau', async () => {
  await setMeta('favorites', []); await setMeta('vod_watchlist', []);
  const phone = { ...playlist, id: 'bandeau-sans-affiche' };
  await setMeta('playHistory', [{ channelId: 'vod:bandeau-sans-affiche:movie:42', kind: 'vod', name: 'Film sans affiche', ts: 5, positionMs: 180000, durationMs: 720000 }]);
  const { unmount } = render(<ContinuePanel playlist={phone} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await screen.findByRole('region', { name: 'Reprendre' });
  expect(screen.queryByRole('region', { name: 'À la une' })).toBeNull();
  unmount();
  await setMeta('playHistory', [{ channelId: 'vod:bandeau-sans-affiche:movie:42', kind: 'vod', name: 'Film avec affiche', ts: 5, positionMs: 180000, durationMs: 720000, poster: 'https://example.test/affiche.jpg' }]);
  const tv = render(<ContinuePanel playlist={phone} tvMode onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await screen.findByRole('region', { name: 'Contenu sélectionné' });
  expect(screen.queryByRole('region', { name: 'À la une' })).toBeNull();
  tv.unmount();
  render(<ContinuePanel playlist={phone} onChannelSelect={() => {}} onOpenVod={() => {}} />);
  await screen.findByRole('region', { name: 'À la une' });
  await userEvent.click(screen.getByRole('button', { name: 'Podcasts' }));
  expect(screen.queryByRole('region', { name: 'À la une' })).toBeNull();
});

it('TV : la première carte est le point d’entrée du rail, les filtres seulement quand aucune rangée n’existe', async () => {
  await setMeta('favorites', []); await setMeta('vod_watchlist', []);
  const tvList = { ...playlist, id: 'entree-tv' };
  await setMeta('playHistory', [{ channelId: 'vod:entree-tv:movie:42', kind: 'vod', name: 'Mon film', ts: 5, positionMs: 180000, durationMs: 720000 }]);
  render(<ContinuePanel playlist={tvList} tvMode onChannelSelect={() => {}} onOpenVod={() => {}} />);
  const card = await screen.findByRole('button', { name: 'Reprendre Mon film' });
  expect(card).toHaveAttribute('data-remote-entry');
  expect(document.querySelectorAll('[data-remote-entry]')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Séries' }));
  expect(screen.getByRole('button', { name: 'Séries' })).toHaveAttribute('data-remote-entry');
  expect(document.querySelectorAll('[data-remote-entry]')).toHaveLength(1);
});

it('alimente automatiquement les recommandations directement depuis l’accueil sans visite préalable du catalogue', async () => {
  const linked = { ...playlist, id: 'auto-recs' };
  localStorage.setItem('xtream_account_auto-recs', JSON.stringify({ server: 'https://example.test', username: 'test', password: 'test' }));
  const sourceId = 'vod:auto-recs:movie:10';
  await setMeta('favorites', []);
  await setMeta('vod_watchlist', []);
  await setMeta('playHistory', [{
    channelId: sourceId,
    kind: 'vod',
    mediaKind: 'movie',
    playlistId: linked.id,
    name: 'Film Culte',
    categoryId: 'cat-culte',
    status: 'completed',
    ts: 100,
  }]);

  const request = vi.spyOn(xtreamCatalog, 'catalogRequest').mockImplementation((_a, action, params) => {
    if (action === 'get_vod_streams' && params?.category_id === 'cat-culte') {
      return Promise.resolve([
        { stream_id: 10, name: 'Film Culte', category_id: 'cat-culte', container_extension: 'mp4' },
        { stream_id: 20, name: 'Film Conseillé Direct', category_id: 'cat-culte', container_extension: 'mp4' },
      ]);
    }
    return Promise.resolve([]);
  });

  try {
    render(<ContinuePanel playlist={linked} onChannelSelect={() => {}} onOpenVod={() => {}} tvMode />);
    // La rangée Parce que tu as regardé apparaît directement sans avoir visité Films/Séries
    const row = await screen.findByRole('region', { name: 'Parce que tu as regardé « Film Culte »' });
    expect(within(row).getByRole('button', { name: /Film Conseillé Direct/ })).toBeVisible();

    // Vérifie qu'aucune requête globale sans category_id n'a été faite
    const globalCalls = request.mock.calls.filter(c => c[1] === 'get_vod_streams' && !c[2]?.category_id);
    expect(globalCalls).toHaveLength(0);
  } finally {
    cleanup();
    request.mockRestore();
    localStorage.removeItem('xtream_account_auto-recs');
  }
});

it('affiche « Parce que tu as regardé » d’après une œuvre externe (Trakt) sans aucun visionnage local', async () => {
  const traktList = { ...playlist, id: 'trakt-accueil' };
  localStorage.setItem('xtream_account_trakt-accueil', JSON.stringify({ server: 'https://example.test', username: 'test', password: 'test' }));
  const traktChannelId = 'trakt:movie:27205';

  await setMeta('favorites', []);
  await setMeta('vod_watchlist', []);
  await setMeta('playHistory', []); // Aucun visionnage dans CedPlay
  await setMeta('externalWatches', [{
    channelId: traktChannelId,
    name: 'Inception',
    kind: 'vod',
    mediaKind: 'movie',
    platform: 'trakt',
    tmdbId: 27205,
    status: 'completed',
    ts: Date.now(),
  }]);

  // Simule les recommandations d'accueil pré-calculées avec le sourceId de Trakt
  saveForYouSnapshot(traktList.id, [
    { id: '100', name: 'Interstellar', sourceId: traktChannelId, reason: 'Même réalisateur que « Inception »' },
  ], 'movie');

  try {
    render(<ContinuePanel playlist={traktList} onChannelSelect={() => {}} onOpenVod={() => {}} tvMode />);
    const row = await screen.findByRole('region', { name: 'Parce que tu as regardé « Inception »' });
    expect(within(row).getByRole('button', { name: /Interstellar/ })).toBeVisible();
  } finally {
    cleanup();
    localStorage.removeItem('xtream_account_trakt-accueil');
  }
});

it('distingue les recommandations de la bibliothèque de celles à découvrir ailleurs', async () => {
  const onOpenVod = vi.fn();
  const onSearchTitle = vi.fn();
  saveForYouSnapshot(playlist.id, [
    { id: '1', name: 'Film Maison', availability: 'library', reason: 'Dans ta playlist' },
    { id: 'tmdb:movie:999', name: 'Film Ailleurs', availability: 'discover', reason: 'Proche de « Dune »' },
  ]);

  render(<ContinuePanel playlist={playlist} onChannelSelect={() => {}} onOpenVod={onOpenVod} onSearchTitle={onSearchTitle} tvMode />);
  const row = await screen.findByRole('region', { name: 'Pour toi' });
  expect(within(row).getByText('Bibliothèque')).toBeVisible();
  expect(within(row).getByText('À découvrir')).toBeVisible();

  fireEvent.click(within(row).getByRole('button', { name: /Film Ailleurs/ }));
  expect(onSearchTitle).toHaveBeenCalledWith('Film Ailleurs');
  expect(onOpenVod).not.toHaveBeenCalled();

  fireEvent.click(within(row).getByRole('button', { name: /Film Maison/ }));
  expect(onOpenVod).toHaveBeenCalledWith('movie', expect.objectContaining({ id: '1', name: 'Film Maison' }));
});
