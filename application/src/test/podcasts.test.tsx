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

    // L'épisode 2 affiche bien sa position de reprise (5:00) et son badge de vitesse (1.5×)
    expect(screen.getByText('Reprendre à 5:00')).toBeInTheDocument();
    expect(screen.getByText('1.5×')).toBeInTheDocument();

    // Cliquer sur "Reprendre" lance l'épisode à 5:00 et 1.5× et ouvre le MiniAudioPlayer
    await user.click(screen.getByRole('button', { name: `Reprendre ${ep2.title}` }));
    expect(screen.getByTestId('active-audio-title')).toHaveTextContent(ep2.title);
    expect(screen.getByTestId('active-audio-speed')).toHaveTextContent('1.5×');

    const mini = screen.getByRole('complementary', { name: 'Mini-lecteur audio' });
    expect(mini).toHaveAttribute('data-tv-mode', 'false');
    expect(within(mini).getByText(ep2.title)).toBeInTheDocument();

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
    expect(within(mini).getByText(/1:05/)).toBeInTheDocument();
    expect(within(mini).getByText('1.25×')).toBeInTheDocument();
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

    it('permet de parcourir les suggestions, d’ouvrir l’aide et de s’abonner en un clic dans PodcastsPanel', async () => {
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

        // Les 3 onglets sont présents
        expect(screen.getByRole('tab', { name: /Rechercher un podcast/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Coller un lien/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Flux RSS direct/i })).toBeInTheDocument();

        // Le bouton d'aide "Je ne trouve pas mon podcast ?" ouvre les astuces
        const helpBtn = screen.getByRole('button', { name: /Je ne trouve pas mon podcast/i });
        await user.click(helpBtn);
        expect(screen.getByText(/Comment retrouver n’importe quelle émission dans CedPlay/i)).toBeInTheDocument();

        // Les suggestions de démarrage sont visibles
        const resultsGrid = screen.getByTestId('podcast-search-results');
        expect(within(resultsGrid).getByText('Affaires sensibles')).toBeInTheDocument();
        const subscribeBtn = within(resultsGrid).getByRole('button', { name: /S'abonner à Affaires sensibles/i });
        expect(subscribeBtn).toBeInTheDocument();

        // Clic sur S'abonner : télécharge le flux et ajoute le podcast aux abonnements
        await user.click(subscribeBtn);

        const savedFeeds = readPodcastFeeds();
        expect(savedFeeds.length).toBeGreaterThan(0);
        expect(savedFeeds.some(f => f.title === 'Les Pieds sur terre')).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
