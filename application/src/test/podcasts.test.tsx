import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseItunesDurationMs, parsePodcastRss } from '@/utils/podcastParser';
import {
  clearPodcastStorageForTests,
  getEpisodeProgress,
  saveEpisodeProgress,
  saveSubscribedPodcast,
} from '@/utils/podcastStorage';
import { AudioBridge } from '@/utils/nativePlayer';
import { PodcastsPanel } from '@/components/PodcastsPanel';
import { MiniAudioPlayer } from '@/components/MiniAudioPlayer';

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
});
