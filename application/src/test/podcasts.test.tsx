import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseItunesDurationMs, parsePodcastRss } from '@/utils/podcastParser';
import {
  clearPodcastStorageForTests,
  getEpisodeProgress,
  readPodcastFeeds,
  saveEpisodeProgress,
  saveSubscribedPodcast,
} from '@/utils/podcastStorage';
import { AudioBridge } from '@/utils/nativePlayer';
import { PodcastsPanel } from '@/components/PodcastsPanel';
import { formatEpisodeDate, formatEpisodeLength } from '@/utils/podcastFormat';
import { MiniAudioPlayer } from '@/components/MiniAudioPlayer';
import {
  DEFAULT_PODCAST_SUGGESTIONS,
  resolvePodcastLink,
  searchPodcasts,
} from '@/utils/podcastSearch';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Les Pieds sur terre</title>
    <description>Des histoires vraies racontées à la première personne.</description>
    <link>https://www.radiofrance.fr/franceculture/podcasts/les-pieds-sur-terre</link>
    <itunes:image href="https://example.test/cover.jpg" />
    <item>
      <guid>ep-2</guid>
      <title>Épisode 2 : La traversée</title>
      <pubDate>Wed, 05 Nov 2025 06:00:00 GMT</pubDate>
      <itunes:duration>00:28:30</itunes:duration>
      <description>Récit d'une traversée maritime.</description>
      <enclosure url="https://example.test/audio/ep2.mp3" type="audio/mpeg" length="27360000" />
    </item>
    <item>
      <guid>ep-1</guid>
      <title>Épisode 1 : Le départ</title>
      <pubDate>Tue, 04 Nov 2025 06:00:00 GMT</pubDate>
      <itunes:duration>1800</itunes:duration>
      <description>Récit du grand départ.</description>
      <enclosure url="https://example.test/audio/ep1.mp3" type="audio/mpeg" length="28800000" />
    </item>
  </channel>
</rss>`;

describe('Podcasts Livraison 1A — Analyse RSS, vitesse + position et changement d’épisode', () => {
  beforeEach(() => {
    clearPodcastStorageForTests();
    AudioBridge.resetForTests();
  });

  afterEach(() => {
    cleanup();
    clearPodcastStorageForTests();
    AudioBridge.resetForTests();
  });

  it('analyse un flux RSS 2.0 / iTunes et convertit les durées HH:MM:SS ou secondes', () => {
    expect(parseItunesDurationMs('01:02:03')).toBe(3_723_000);
    expect(parseItunesDurationMs('28:30')).toBe(1_710_000);
    expect(parseItunesDurationMs('1800')).toBe(1_800_000);

    const parsed = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    expect(parsed.feed.title).toBe('Les Pieds sur terre');
    expect(parsed.feed.artworkUrl).toBe('https://example.test/cover.jpg');
    expect(parsed.episodes).toHaveLength(2);
    expect(parsed.episodes[0]?.title).toBe('Épisode 2 : La traversée');
    expect(parsed.episodes[0]?.durationMs).toBe(1_710_000);
    expect(parsed.episodes[0]?.audioUrl).toBe('https://example.test/audio/ep2.mp3');
    expect(parsed.episodes[1]?.title).toBe('Épisode 1 : Le départ');
    expect(parsed.episodes[1]?.durationMs).toBe(1_800_000);
  });

  it('restaure la vitesse choisie avec la position lors de la reprise d’un épisode', async () => {
    const parsed = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    const ep1 = parsed.episodes[1]!;

    // On écoute l'épisode 1 jusqu'à 7 min (420 000 ms) à la vitesse 1.5x, puis on met en pause et on ferme
    await AudioBridge.playEpisode(ep1);
    await AudioBridge.setSpeed(1.5);
    AudioBridge.reportPosition(420_000, ep1.durationMs);
    await AudioBridge.stop();

    const saved = getEpisodeProgress(ep1.id);
    expect(saved).not.toBeNull();
    expect(saved?.positionMs).toBe(420_000);
    expect(saved?.speed).toBe(1.5);

    // Lorsqu'on relance l'épisode 1 sans spécifier de vitesse ni de position, les deux sont restaurées
    const resumedState = await AudioBridge.playEpisode(ep1);
    expect(resumedState.episodeId).toBe(ep1.id);
    expect(resumedState.positionMs).toBe(420_000);
    expect(resumedState.speed).toBe(1.5);
  });

  it('enregistre la dernière position (et vitesse) sous le bon épisode avant de passer à l’épisode suivant', async () => {
    const parsed = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    const ep1 = parsed.episodes[1]!;
    const ep2 = parsed.episodes[0]!;

    // L'épisode 2 avait déjà une position antérieure (120 000 ms à 1.25x)
    saveEpisodeProgress({
      episodeId: ep2.id,
      feedUrl: ep2.feedUrl,
      audioUrl: ep2.audioUrl,
      title: ep2.title,
      podcastTitle: ep2.podcastTitle,
      positionMs: 120_000,
      durationMs: ep2.durationMs,
      speed: 1.25,
    });

    // On lance l'épisode 1, on passe à 1.75x et on avance jusqu'à 615 000 ms
    await AudioBridge.playEpisode(ep1);
    await AudioBridge.setSpeed(1.75);
    AudioBridge.reportPosition(615_000, ep1.durationMs);

    // On passe directement à l'épisode 2 sans appeler pause() au préalable
    const stateEp2 = await AudioBridge.playEpisode(ep2);

    // 1. La dernière position (615 000 ms) et vitesse (1.75x) ont bien été enregistrées sous ep1.id
    const savedEp1 = getEpisodeProgress(ep1.id);
    expect(savedEp1?.episodeId).toBe(ep1.id);
    expect(savedEp1?.positionMs).toBe(615_000);
    expect(savedEp1?.speed).toBe(1.75);

    // 2. L'épisode 2 n'a pas été écrasé par la position de l'épisode 1 : il reprend à 120 000 ms et 1.25x
    const savedEp2 = getEpisodeProgress(ep2.id);
    expect(savedEp2?.episodeId).toBe(ep2.id);
    expect(savedEp2?.positionMs).toBe(120_000);
    expect(savedEp2?.speed).toBe(1.25);
    expect(stateEp2.episodeId).toBe(ep2.id);
    expect(stateEp2.positionMs).toBe(120_000);
    expect(stateEp2.speed).toBe(1.25);
  });

  it('assure l’exclusion mutuelle entre podcast et vidéo (aucun double son)', async () => {
    const parsed = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    const ep1 = parsed.episodes[1]!;

    const onVideoStopped = vi.fn();
    const unsub = AudioBridge.onAudioTakeover(onVideoStopped);

    // Démarrer un podcast coupe immédiatement la session vidéo active
    await AudioBridge.playEpisode(ep1);
    AudioBridge.reportPosition(95_000, ep1.durationMs);
    expect(onVideoStopped).toHaveBeenCalledTimes(1);
    expect(AudioBridge.getState().playing).toBe(true);

    // Démarrer une vidéo met immédiatement le podcast en pause en conservant sa position
    await AudioBridge.pauseForVideo();
    expect(AudioBridge.getState().playing).toBe(false);
    expect(getEpisodeProgress(ep1.id)?.positionMs).toBe(95_000);

    unsub();
  });

  it('affiche PodcastsPanel et MiniAudioPlayer en mode mobile et TV (useTvMode) et permet de reprendre un épisode', async () => {
    const user = userEvent.setup();
    const parsed = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    saveSubscribedPodcast(parsed.feed, parsed.episodes);

    const ep2 = parsed.episodes[0]!;
    saveEpisodeProgress({
      episodeId: ep2.id,
      feedUrl: ep2.feedUrl,
      audioUrl: ep2.audioUrl,
      title: ep2.title,
      podcastTitle: ep2.podcastTitle,
      positionMs: 300_000,
      durationMs: ep2.durationMs,
      speed: 1.5,
    });

    const { rerender } = render(
      <>
        <PodcastsPanel tvMode={false} />
        <MiniAudioPlayer tv={false} />
      </>
    );

    // Une seule ligne d'infos : l'épisode 2 (28:30, repris à 5:00) affiche le temps restant.
    const row = screen.getByRole('button', { name: `Reprendre ${ep2.title}` });
    expect(row).toHaveTextContent('Reste 24 min');
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '18');
    // Le résumé est replié par défaut, le chevron l'ouvre.
    expect(screen.queryByText('Récit d\'une traversée maritime.')).toBeNull();
    const details = screen.getByRole('button', { name: `Détails de ${ep2.title}` });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    await user.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Récit d\'une traversée maritime.')).toBeInTheDocument();

    // Toute la ligne reprend l'épisode à 5:00 et 1.5× et ouvre le MiniAudioPlayer
    await user.click(row);
    expect(screen.getByRole('button', { name: `Pause ${ep2.title}` })).toHaveAttribute('aria-current', 'true');

    const mini = screen.getByRole('complementary', { name: 'Mini-lecteur audio' });
    expect(mini).toHaveAttribute('data-tv-mode', 'false');
    expect(within(mini).getByText(ep2.title)).toBeInTheDocument();
    expect(within(mini).getByText('1.5×')).toBeInTheDocument();

    // Vérifier le basculement vers tvMode=true (réglage Auto/TV/Mobile)
    rerender(
      <>
        <PodcastsPanel tvMode={true} />
        <MiniAudioPlayer tv={true} />
      </>
    );
    expect(screen.getByRole('complementary', { name: 'Mini-lecteur audio' })).toHaveAttribute('data-tv-mode', 'true');
  });

  it('maintient le MiniAudioPlayer affiché et met à jour sa progression lors des événements audioState Android', async () => {
    const parsed = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    const ep1 = parsed.episodes[1]!;

    render(<MiniAudioPlayer tv={false} />);
    await act(async () => {
      await AudioBridge.playEpisode(ep1);
    });
    expect(screen.getByRole('complementary', { name: 'Mini-lecteur audio' })).toBeInTheDocument();

    // Simule l'événement périodique (5 s) envoyé par NativePlayerPlugin.snapshotToJS sur Android
    act(() => {
      AudioBridge.receiveNativeAudioEventForTests({
        active: true,
        playing: true,
        episodeId: ep1.id,
        feedUrl: ep1.feedUrl,
        audioUrl: ep1.audioUrl,
        title: ep1.title,
        podcastTitle: ep1.podcastTitle,
        artworkUrl: ep1.artworkUrl ?? '',
        positionMs: 65_000,
        durationMs: ep1.durationMs,
        speed: 1.25,
      });
    });

    const mini = screen.getByRole('complementary', { name: 'Mini-lecteur audio' });
    expect(mini).toBeInTheDocument();
    const bar = within(mini).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuetext', '1:05 sur 30:00');
    expect(within(mini).getByText('1.25×')).toBeInTheDocument();
    // Temps restant lisible : durée audio restante (30:00 - 1:05), indépendante de la vitesse.
    expect(within(mini).getByText('Reste 29 min')).toBeInTheDocument();
  });
});

describe('Écouter — présentation sobre', () => {
  beforeEach(() => {
    clearPodcastStorageForTests();
    AudioBridge.resetForTests();
  });

  afterEach(() => {
    cleanup();
    clearPodcastStorageForTests();
    AudioBridge.resetForTests();
  });

  it('durées à la minute et dates courtes', () => {
    expect(formatEpisodeLength(25 * 60_000)).toBe('25 min');
    expect(formatEpisodeLength(65 * 60_000)).toBe('1 h 05');
    expect(formatEpisodeLength(120 * 60_000)).toBe('2 h');
    expect(formatEpisodeLength(10_000)).toBe('1 min');
    const now = new Date(2026, 10, 7, 12);
    expect(formatEpisodeDate(undefined, new Date(2026, 10, 7, 6).getTime(), now)).toBe('Aujourd’hui');
    expect(formatEpisodeDate(undefined, new Date(2026, 10, 6, 23).getTime(), now)).toBe('Hier');
    expect(formatEpisodeDate(undefined, new Date(2026, 9, 29).getTime(), now)).toBe('29 oct.');
    expect(formatEpisodeDate(undefined, new Date(2025, 9, 29).getTime(), now)).toBe('29 oct. 2025');
  });

  it('sans abonnement : recherche directe ; avec abonnements : repliée derrière Ajouter', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PodcastsPanel />);
    expect(screen.getByRole('searchbox', { name: 'Rechercher un podcast' })).toBeInTheDocument();
    unmount();

    const parsed = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    saveSubscribedPodcast(parsed.feed, parsed.episodes);
    render(<PodcastsPanel />);
    expect(screen.queryByRole('searchbox', { name: 'Rechercher un podcast' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Les Pieds sur terre', pressed: true })).toBeInTheDocument();
    expect(screen.getByText('2 épisodes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajouter un podcast' }));
    expect(screen.getByRole('searchbox', { name: 'Rechercher un podcast' })).toHaveFocus();
  });

  it('supprimer demande confirmation puis rend le focus à l’émission suivante (TV : actions libellées)', async () => {
    const user = userEvent.setup();
    const first = parsePodcastRss(SAMPLE_RSS, 'https://example.test/rss.xml');
    const second = parsePodcastRss(SAMPLE_RSS.replace(/Les Pieds sur terre/g, 'Affaires sensibles'), 'https://example.test/autre.xml');
    saveSubscribedPodcast(first.feed, first.episodes);
    saveSubscribedPodcast(second.feed, second.episodes);
    render(<PodcastsPanel tvMode />);
    await user.click(screen.getByRole('button', { name: 'Les Pieds sur terre' }));

    expect(screen.getByRole('button', { name: 'Actualiser Les Pieds sur terre' })).toHaveTextContent('Actualiser');
    const remove = screen.getByRole('button', { name: 'Supprimer Les Pieds sur terre' });
    expect(remove).toHaveTextContent('Supprimer');

    await user.click(remove);
    const confirm = screen.getByRole('button', { name: 'Confirmer la suppression de Les Pieds sur terre' });
    expect(confirm).toHaveTextContent('Confirmer ?');
    expect(screen.getByRole('button', { name: 'Les Pieds sur terre', pressed: true })).toBeInTheDocument();

    await user.click(confirm);
    expect(screen.queryByRole('button', { name: 'Les Pieds sur terre' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Affaires sensibles', pressed: true })).toHaveFocus();
  });

  describe('Découverte, recherche par nom et résolution de liens', () => {
    it('fournit les suggestions de démarrage avec pochettes et flux RSS publics valides', () => {
      expect(DEFAULT_PODCAST_SUGGESTIONS.length).toBeGreaterThanOrEqual(6);
      const affairesSensibles = DEFAULT_PODCAST_SUGGESTIONS.find(s => s.title.includes('Affaires sensibles'));
      expect(affairesSensibles).toBeDefined();
      expect(affairesSensibles?.feedUrl).toMatch(/^https?:\/\//);
      expect(affairesSensibles?.artworkUrl).toMatch(/^https?:\/\//);
      expect(affairesSensibles?.author).toContain('France Inter');
    });

    it('recherche des podcasts par nom et combine les métadonnées', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('itunes.apple.com')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                resultCount: 1,
                results: [
                  {
                    collectionId: 912451024,
                    collectionName: 'Affaires sensibles',
                    artistName: 'France Inter',
                    artworkUrl600: 'https://example.test/affaires.jpg',
                    primaryGenreName: 'Histoire',
                    trackCount: 150,
                  },
                ],
              }),
          });
        }
        if (url.includes('gpodder.net')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  title: 'Affaires sensibles',
                  author: 'France Inter',
                  url: 'https://radiofrance-podcast.net/podcast09/rss_13940.xml',
                  description: 'Les grandes affaires judiciaires.',
                },
              ]),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        const results = await searchPodcasts('affaires sensibles');
        expect(results.length).toBeGreaterThan(0);
        const top = results[0]!;
        expect(top.title).toBe('Affaires sensibles');
        expect(top.author).toBe('France Inter');
        expect(top.artworkUrl).toBe('https://example.test/affaires.jpg');
        // Le flux manquant d'Apple a bien été enrichi par Gpodder
        expect(top.feedUrl).toBe('https://radiofrance-podcast.net/podcast09/rss_13940.xml');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('résout un lien Apple Podcasts, Spotify avec avertissement, ou page Web', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('itunes.apple.com/lookup?id=1200361736')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                resultCount: 1,
                results: [
                  {
                    collectionId: 1200361736,
                    collectionName: 'The Daily',
                    artistName: 'The New York Times',
                    feedUrl: 'https://feeds.simplecast.com/Sl5CSM3S',
                    artworkUrl600: 'https://example.test/daily.jpg',
                  },
                ],
              }),
          });
        }
        if (url.includes('open.spotify.com/show/xyz')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<meta property="og:title" content="Le Grand Débat | Spotify">'),
          });
        }
        if (url.includes('itunes.apple.com/search') || url.includes('gpodder.net')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          });
        }
        if (url.includes('example.test/podcast-page')) {
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                '<html><head><link rel="alternate" type="application/rss+xml" href="https://example.test/feed.xml" /><meta property="og:title" content="Mon Super Podcast"></head></html>'
              ),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      try {
        // 1. Lien direct RSS
        const direct = await resolvePodcastLink('https://example.test/podcast.xml');
        expect(direct.resolved).toBe(true);
        expect(direct.kind).toBe('feed');
        expect(direct.feedUrl).toBe('https://example.test/podcast.xml');

        // 2. Lien Apple Podcasts
        const apple = await resolvePodcastLink('https://podcasts.apple.com/us/podcast/the-daily/id1200361736');
        expect(apple.resolved).toBe(true);
        expect(apple.kind).toBe('apple');
        expect(apple.podcast?.title).toBe('The Daily');
        expect(apple.feedUrl).toBe('https://feeds.simplecast.com/Sl5CSM3S');

        // 3. Lien Spotify sans flux public externe : avertissement bienveillant
        const spotify = await resolvePodcastLink('https://open.spotify.com/show/xyz');
        expect(spotify.kind).toBe('spotify');
        expect(spotify.resolved).toBe(false);
        expect(spotify.warning).toContain('Spotify');

        // 4. Page web avec balise link rel="alternate" type="application/rss+xml"
        const web = await resolvePodcastLink('https://example.test/podcast-page');
        expect(web.resolved).toBe(true);
        expect(web.kind).toBe('web');
        expect(web.feedUrl).toBe('https://example.test/feed.xml');
        expect(web.podcast?.title).toBe('Mon Super Podcast');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('permet de parcourir les suggestions et de s’abonner en un clic dans PodcastsPanel', async () => {
      const user = userEvent.setup();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('radiofrance-podcast.net') || url.includes('rss')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(SAMPLE_RSS),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      try {
        render(<PodcastsPanel tvMode={false} />);

        // Une seule entrée : la recherche par nom ; le lien reste un recours replié.
        expect(screen.getByRole('searchbox', { name: 'Rechercher un podcast' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Lien ou adresse RSS du podcast' })).toBeNull();
        await user.click(screen.getByRole('button', { name: /Coller un lien/i }));
        expect(screen.getByRole('textbox', { name: 'Lien ou adresse RSS du podcast' })).toHaveFocus();

        // Les suggestions de démarrage sont visibles en pochettes
        const resultsGrid = screen.getByTestId('podcast-search-results');
        expect(within(resultsGrid).getByText('Affaires sensibles')).toBeInTheDocument();
        const subscribeBtn = within(resultsGrid).getByRole('button', { name: /S'abonner à Affaires sensibles/i });

        // Clic sur la pochette : télécharge le flux, ajoute l'émission et l'ouvre
        await user.click(subscribeBtn);

        const savedFeeds = readPodcastFeeds();
        expect(savedFeeds.some(f => f.title === 'Les Pieds sur terre')).toBe(true);
        expect(await screen.findByRole('button', { name: 'Les Pieds sur terre', pressed: true })).toHaveFocus();
        expect(screen.queryByRole('searchbox', { name: 'Rechercher un podcast' })).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('ajoute depuis un lien collé (flux direct)', async () => {
      const user = userEvent.setup();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('example.test/podcast.xml')) {
          return Promise.resolve({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      try {
        render(<PodcastsPanel />);
        await user.click(screen.getByRole('button', { name: /Coller un lien/i }));
        await user.type(screen.getByRole('textbox', { name: 'Lien ou adresse RSS du podcast' }), 'https://example.test/podcast.xml');
        await user.click(screen.getByRole('button', { name: 'Ajouter depuis ce lien' }));
        expect(await screen.findByRole('button', { name: 'Les Pieds sur terre', pressed: true })).toBeInTheDocument();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
