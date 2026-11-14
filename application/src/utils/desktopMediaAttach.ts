import type HlsType from 'hls.js';
import {
  desktopLocalFileUrl,
  desktopProxyUrl,
  desktopSubtitleVttUrl,
  desktopTransmuxUrl,
  needsFfmpegTransmux,
  probeMediaDurationAndCodecs,
  resolveDesktopPlayableUrl,
} from '@/utils/desktopBridge';
import { getActiveUserAgent } from '@/utils/userAgent';

export interface AttachDesktopMediaOptions {
  live?: boolean | undefined;
  muted?: boolean | undefined;
  startSec?: number | undefined;
  forceTransmux?: boolean | undefined;
  localUri?: string | undefined;
  userAgent?: string | undefined;
  onStatus?: ((status: 'loading' | 'playing' | 'error') => void) | undefined;
  onAudioTracks?: ((tracks: { id: number; label: string }[]) => void) | undefined;
  onSubtitleTracks?: ((tracks: { id: number; label: string }[]) => void) | undefined;
}

export interface AttachedMediaHandle {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayedMs: () => number;
  seekTo: (seconds: number) => void;
  getSubtitleTracks: () => { id: number; label: string }[];
  setSubtitleTrack: (id: number) => string | null;
  getAudioTracks?: () => { id: number; label: string }[];
  setAudioTrack?: (id: number) => void;
}

export function attachDesktopMediaStream(
  video: HTMLVideoElement,
  rawUrl: string,
  options: AttachDesktopMediaOptions = {},
): AttachedMediaHandle {
  let destroyed = false;
  let hls: HlsType | null = null;
  let mpegts: { destroy: () => void } | null = null;
  let usedFfmpegFallback = false;
  let metadataReady = false;
  let observedTime = false;
  let requestedPosition = Math.max(0, options.startSec || 0);
  let ffmpegOffset = 0;
  let selectedAudioTrack = 0;
  let ffmpegTracks: { id: number; label: string }[] | null = null;
  let embeddedSubtitles: { id: number; label: string }[] = [];
  let playedMs = 0;
  let playingSince: number | null = null;
  let reloadRate = video.playbackRate;

  const ua = options.userAgent ?? getActiveUserAgent();
  const isLocal = Boolean(options.localUri);
  const flushPlayed = () => {
    if (playingSince !== null) {
      const now = performance.now();
      playedMs += Math.max(0, now - playingSince);
      playingSince = now;
    }
  };
  const stopMeter = () => { flushPlayed(); playingSince = null; };
  const currentTime = () => metadataReady || observedTime
    ? Math.max(0, (usedFfmpegFallback ? ffmpegOffset : 0) + (video.currentTime || 0))
    : requestedPosition;
  const duration = () => Number.isFinite(video.duration) && video.duration > 0
    ? (usedFfmpegFallback ? ffmpegOffset : 0) + video.duration
    : 0;
  const nativeAudioTracks = () => (video as unknown as { audioTracks?: { label: string; language: string; enabled: boolean }[] }).audioTracks;
  const audioTracks = () => {
    if (usedFfmpegFallback) return ffmpegTracks || [];
    if (hls) return hls.audioTracks.map((track, id) => ({ id, label: track.name || track.lang || `Piste ${id + 1}` }));
    const tracks = nativeAudioTracks();
    return tracks?.length ? Array.from(tracks, (track, id) => ({ id, label: track.label || track.language || `Piste ${id + 1}` })) : ffmpegTracks || [];
  };
  const publishAudioTracks = () => { if (!destroyed) options.onAudioTracks?.(audioTracks()); };
  const subtitleTracks = () => {
    if (hls) return hls.subtitleTracks.map((track, id) => ({ id, label: track.name || track.lang || `Sous-titres ${id + 1}` }));
    return options.live ? [] : embeddedSubtitles;
  };
  const publishSubtitleTracks = () => { if (!destroyed) options.onSubtitleTracks?.(subtitleTracks()); };
  const probeAudioTracks = (source: string) => {
    if (ffmpegTracks !== null) { publishAudioTracks(); return; }
    ffmpegTracks = [];
    void probeMediaDurationAndCodecs(source).then((info) => {
      ffmpegTracks = info.audioTracks || [];
      embeddedSubtitles = info.subtitleTracks || [];
      publishAudioTracks();
      publishSubtitleTracks();
    });
  };

  const cleanupEngine = () => {
    try { hls?.destroy(); } catch { /* ignore */ }
    hls = null;
    try { mpegts?.destroy(); } catch { /* ignore */ }
    mpegts = null;
  };

  const attachFfmpeg = (videoCodec: 'copy' | 'h264' = 'copy', effectiveUrl = rawUrl, position = currentTime()) => {
    if (destroyed) return;
    const resume = !usedFfmpegFallback || !video.paused;
    reloadRate = video.playbackRate;
    stopMeter();
    cleanupEngine();
    usedFfmpegFallback = true;
    requestedPosition = options.live ? 0 : Math.floor(position);
    ffmpegOffset = requestedPosition;
    metadataReady = false;
    observedTime = false;
    const source = options.localUri || effectiveUrl;
    const streamUrl = desktopTransmuxUrl(source, {
      startSec: requestedPosition,
      videoCodec,
      live: Boolean(options.live),
      ua,
      audioTrack: selectedAudioTrack,
    });
    options.onStatus?.('loading');
    video.src = streamUrl;
    video.load();
    video.playbackRate = reloadRate;
    if (resume) void Promise.resolve(video.play()).catch(() => {});
    probeAudioTracks(source);
  };

  let resolvedUrl = rawUrl;

  const onPlaying = () => {
    if (!destroyed) {
      if (playingSince === null) playingSince = performance.now();
      options.onStatus?.('playing');
    }
  };

  const onError = () => {
    if (destroyed) return;
    stopMeter();
    if (!usedFfmpegFallback) {
      attachFfmpeg('copy', resolvedUrl);
      return;
    }
    if (!video.src.includes('video=h264')) {
      attachFfmpeg('h264', resolvedUrl);
      return;
    }
    options.onStatus?.('error');
  };

  const onCanPlay = () => {
    if (!destroyed && video.readyState >= 2) options.onStatus?.('playing');
  };
  const onMetadata = () => {
    if (destroyed) return;
    metadataReady = true;
    if (usedFfmpegFallback) video.playbackRate = reloadRate;
    if (!usedFfmpegFallback && requestedPosition > 0) {
      try { video.currentTime = requestedPosition; } catch { /* ignore */ }
    }
    publishAudioTracks();
    publishSubtitleTracks();
  };
  const onTimeUpdate = () => { observedTime = true; };

  video.muted = Boolean(options.muted);
  video.playsInline = true;
  video.addEventListener('playing', onPlaying);
  video.addEventListener('canplay', onCanPlay);
  video.addEventListener('error', onError);
  video.addEventListener('loadedmetadata', onMetadata);
  video.addEventListener('timeupdate', onTimeUpdate);
  for (const event of ['pause', 'waiting', 'stalled', 'seeking', 'ended']) video.addEventListener(event, stopMeter);
  options.onStatus?.('loading');

  const startPlayback = (targetUrl: string) => {
    if (destroyed) return;
    resolvedUrl = targetUrl;
    if (!options.live) probeAudioTracks(options.localUri || targetUrl);
    if (options.forceTransmux || (isLocal && needsFfmpegTransmux(options.localUri || targetUrl))) {
      attachFfmpeg('copy', targetUrl);
    } else if (isLocal) {
      video.src = desktopLocalFileUrl(options.localUri!);
      video.load();
      void Promise.resolve(video.play()).catch(() => {});
    } else {
      const cleanPath = targetUrl.split('?')[0].split('#')[0].toLowerCase();
      const proxied = desktopProxyUrl(targetUrl, ua);

      if (cleanPath.endsWith('.m3u8')) {
        void import('hls.js').then(({ default: Hls }) => {
          if (destroyed) return;
          if (!Hls.isSupported()) {
            video.src = proxied;
            void Promise.resolve(video.play()).catch(() => {});
            return;
          }
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: Boolean(options.live),
            backBufferLength: options.live ? 15 : 60,
            ...(!options.live && requestedPosition > 0 ? { startPosition: requestedPosition } : {}),
          });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, publishAudioTracks);
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, publishSubtitleTracks);
          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (destroyed || !data?.fatal) return;
            if (!usedFfmpegFallback) attachFfmpeg('copy', targetUrl);
            else options.onStatus?.('error');
          });
          hls.loadSource(proxied);
          hls.attachMedia(video);
          void Promise.resolve(video.play()).catch(() => {});
        }).catch(() => {
          if (!destroyed) attachFfmpeg('copy', targetUrl);
        });
      } else if (cleanPath.endsWith('.ts') || cleanPath.endsWith('.m2ts')) {
        void import('mpegts.js').then(({ default: mpegtsLib }) => {
          if (destroyed) return;
          if (!mpegtsLib.isSupported()) {
            attachFfmpeg('copy', targetUrl);
            return;
          }
          const player = mpegtsLib.createPlayer({
            type: 'mpegts',
            isLive: Boolean(options.live),
            url: proxied,
          }, {
            enableStashBuffer: true,
            stashInitialSize: 128,
          });
          mpegts = player;
          player.on(mpegtsLib.Events.ERROR, () => {
            if (!destroyed && !usedFfmpegFallback) attachFfmpeg('copy', targetUrl);
          });
          player.attachMediaElement(video);
          player.load();
          void Promise.resolve(video.play()).catch(() => {});
        }).catch(() => {
          if (!destroyed) attachFfmpeg('copy', targetUrl);
        });
      } else if (needsFfmpegTransmux(targetUrl)) {
        attachFfmpeg('copy', targetUrl);
      } else {
        video.src = proxied;
        video.load();
        void Promise.resolve(video.play()).catch(() => {});
      }
    }
  };

  if (!isLocal && rawUrl.includes('#cedplay-stalker=')) {
    void resolveDesktopPlayableUrl(rawUrl).then(startPlayback).catch(() => { if (!destroyed) options.onStatus?.('error'); });
  } else {
    startPlayback(rawUrl);
  }

  return {
    destroy() {
      stopMeter();
      destroyed = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      for (const event of ['pause', 'waiting', 'stalled', 'seeking', 'ended']) video.removeEventListener(event, stopMeter);
      cleanupEngine();
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignore */
      }
    },
    getCurrentTime: currentTime,
    getDuration: duration,
    getPlayedMs() { flushPlayed(); return Math.round(playedMs); },
    seekTo(seconds) {
      const target = Math.max(0, seconds);
      if (usedFfmpegFallback) {
        attachFfmpeg(video.src.includes('video=h264') ? 'h264' : 'copy', resolvedUrl, target);
      } else {
        requestedPosition = target;
        try { video.currentTime = target; observedTime = true; } catch { /* metadata not loaded */ }
      }
    },
    getAudioTracks: audioTracks,
    getSubtitleTracks: subtitleTracks,
    setSubtitleTrack(id) {
      if (hls) {
        hls.subtitleTrack = id;
        hls.subtitleDisplay = id >= 0;
        return null;
      }
      if (id < 0 || !embeddedSubtitles.some((track) => track.id === id)) return null;
      return `${desktopSubtitleVttUrl(options.localUri || resolvedUrl)}&track=${id}`;
    },
    setAudioTrack(idx: number) {
      if (!audioTracks().some((track) => track.id === idx)) return;
      if (usedFfmpegFallback) {
        selectedAudioTrack = idx;
        attachFfmpeg(video.src.includes('video=h264') ? 'h264' : 'copy', resolvedUrl);
        return;
      }
      if (hls) { hls.audioTrack = idx; return; }
      if (!nativeAudioTracks()?.length && ffmpegTracks?.length) {
        selectedAudioTrack = idx;
        attachFfmpeg('copy', resolvedUrl);
        return;
      }
      const tracks = (video as unknown as { audioTracks?: { enabled: boolean }[] }).audioTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === idx;
    },
  };
}
