import { useCallback, useEffect, useRef, useState } from 'react';
import { attachUsageMeter } from '@/utils/usageJournal';
import type HlsType from 'hls.js';
import { Capacitor } from '@capacitor/core';
import { isPlaybackDelegated, onPlaybackDelegated } from '@/utils/playbackOwnership';
import { getProxyBase } from '@/utils/proxy';

interface PlayOptions { resetAttempts?: boolean; autoplay?: boolean; }
const MAX_RETRIES = 5;

export function getPlaybackUrl(rawUrl: string): string {
  if (Capacitor.isNativePlatform()) {
    return rawUrl;
  }
  try {
    const parsed = new URL(rawUrl, window.location.href);
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname.endsWith('.test') || parsed.protocol === 'blob:') {
      return rawUrl;
    }
    return `${getProxyBase()}/proxy?url=${encodeURIComponent(rawUrl)}`;
  } catch {
    return rawUrl;
  }
}

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const mpegtsRef = useRef<{ destroy: () => void; pause: () => void; unload: () => void; detachMediaElement: () => void } | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const suspendedUrlRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef(0);
  const generationRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const sourceCleanupRef = useRef<(() => void) | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentQuality, setCurrentQuality] = useState('auto');
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [retryAttempts, setRetryAttempts] = useState(0);
  // Pause du direct : écart (secondes) entre la position courante et le bord du
  // direct. null = au direct (ou flux non live).
  const [liveBehindSec, setLiveBehindSec] = useState<number | null>(null);
  // Pistes de sous-titres du manifeste HLS (index -1 = désactivées).
  const [subtitleTracks, setSubtitleTracks] = useState<{ index: number; label: string }[]>([]);
  const [subtitleTrack, setSubtitleTrack] = useState(-1);

  const clearSource = useCallback(() => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    sourceCleanupRef.current?.();
    sourceCleanupRef.current = null;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.pause();
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch { /* Le moteur peut être déjà détaché après une erreur réseau. */ }
      mpegtsRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    generationRef.current += 1;
    lastUrlRef.current = null;
    suspendedUrlRef.current = null;
    clearSource();
    const video = videoRef.current;
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    setIsPlaying(false); setIsLoading(false); setError(null);
    setAvailableQualities([]); setCurrentQuality('auto');
    setSubtitleTracks([]); setSubtitleTrack(-1);
  }, [clearSource]);

  const playStream = useCallback(async function play(url: string, options: PlayOptions = {}) {
    if (isPlaybackDelegated()) return;
    suspendedUrlRef.current = null;
    const video = videoRef.current;
    if (!video) return;
    const generation = ++generationRef.current;
    clearSource();
    video.pause(); video.removeAttribute('src'); video.load();
    lastUrlRef.current = url;
    setIsPlaying(false); setIsLoading(true); setError(null);
    setAvailableQualities([]); setCurrentQuality('auto');
    setSubtitleTracks([]); setSubtitleTrack(-1);
    if (options.resetAttempts !== false) { retryRef.current = 0; setRetryAttempts(0); }
    const isCurrent = () => generationRef.current === generation;
    const retry = () => {
      if (!isCurrent() || retryTimerRef.current !== null) return;
      if (retryRef.current >= MAX_RETRIES) {
        setError(`Gave up after ${MAX_RETRIES} attempts. Lecture impossible : vérifier le flux ou réessayer.`);
        setIsLoading(false); return;
      }
      const attempt = ++retryRef.current;
      setRetryAttempts(attempt);
      const delay = Math.min(1500 * 2 ** (attempt - 1), 20000);
      setError(`Nouvel essai dans ${delay / 1000} s (${attempt}/${MAX_RETRIES})…`);
      setIsLoading(true);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (isCurrent()) void play(url, { ...options, resetAttempts: false });
      }, delay);
    };
    const beginPlayback = async () => {
      if (!isCurrent()) return;
      setIsLoading(false);
      if (options.autoplay === false) return;
      try { await video.play(); }
      catch (failure) {
        if (!isCurrent() || (failure as Error).name === 'AbortError') return;
        if ((failure as Error).name === 'NotAllowedError') {
          setError('Clique sur Lecture pour démarrer la vidéo.');
        } else retry();
      }
    };
    try {
      // Garde de protocole sur l'URL D'ORIGINE : le proxy web la réécrit en HTTP
      // et masquerait un vrai protocole exotique (rtmp, rtsp…).
      const original = new URL(url, window.location.href);
      if (!['http:', 'https:', 'blob:'].includes(original.protocol)) {
        setError('Ce protocole vidéo nécessite un lecteur externe.'); setIsLoading(false); return;
      }
      const streamUrl = getPlaybackUrl(url);
      const target = new URL(streamUrl, window.location.href);
      if (!['http:', 'https:', 'blob:'].includes(target.protocol)) {
        setError('Ce protocole vidéo nécessite un lecteur externe.'); setIsLoading(false); return;
      }
      if (/\.m3u8(?:$|[?#])/i.test(target.href) || /hls/i.test(target.pathname)) {
        // hls.js is loaded lazily: heavy (~500 Ko) and useless for MPEG-TS or native streams.
        const { default: Hls } = await import('hls.js');
        if (Hls.isSupported()) {
          if (!isCurrent()) return;

          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1024 * 1024,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 10,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 4,
            levelLoadingTimeOut: 15000,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
          });
          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!isCurrent()) return;
            setAvailableQualities(['auto', ...hls.levels.map((level, index) => `${level.height || index + 1}p`)]);
            void beginPlayback();
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            // Récupération ciblée : erreur réseau → relance du chargement,
            // erreur média → récupération du moteur, sinon cycle de retry complet.
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              retry();
            }
          });
          // Pistes de sous-titres embarquées dans le manifeste (direct).
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
            if (!isCurrent()) return;
            setSubtitleTracks(hls.subtitleTracks.map((track, index) => ({
              index,
              label: track.name || track.lang || `Piste ${index + 1}`,
            })));
            setSubtitleTrack(hls.subtitleTrack);
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          return;
        }
        if (!video.canPlayType('application/vnd.apple.mpegurl')) {
          setError('HLS indisponible dans ce navigateur.'); setIsLoading(false); return;
        }
      }
      // MPEG-TS over HTTP via mpegts.js
      if (/\.ts(?:$|[?#])/i.test(url) || target.pathname.includes('/live/') || target.searchParams.get('url')?.includes('.ts')) {
        try {
          const mpegts = (await import('mpegts.js')).default;
          if (mpegts && typeof mpegts.isSupported === 'function' && mpegts.isSupported()) {
            if (!isCurrent()) return;

            const player = mpegts.createPlayer({
              type: 'mse',
              isLive: true,
              url: streamUrl,
            }, {
              enableWorker: false,
              enableWorkerForMSE: false,
              enableStashBuffer: true,
              stashInitialSize: 128 * 1024,
              liveBufferLatencyChasing: false,
              liveSync: false,
              lazyLoad: false,
              autoCleanupSourceBuffer: true,
              autoCleanupMaxBackwardDuration: 60,
              autoCleanupMinBackwardDuration: 30,
            });
            mpegtsRef.current = player;
            player.attachMediaElement(video);
            player.load();

            const onCanPlay = () => {
              if (isCurrent()) void beginPlayback();
            };
            video.addEventListener('canplay', onCanPlay, { once: true });

            sourceCleanupRef.current = () => {
              video.removeEventListener('canplay', onCanPlay);
            };

            player.on(mpegts.Events.ERROR, () => {
              video.removeEventListener('canplay', onCanPlay);
              if (isCurrent()) retry();
            });
            return;
          }
        } catch {
          // Fall back to standard HTML5 video
        }
      }
      // A native handoff or channel change may have happened during the dynamic import.
      if (!isCurrent()) return;
      const ready = () => { void beginPlayback(); };
      video.addEventListener('loadeddata', ready, { once: true });
      video.addEventListener('error', retry);
      sourceCleanupRef.current = () => {
        video.removeEventListener('loadeddata', ready); video.removeEventListener('error', retry);
      };
      video.src = streamUrl;
      if (options.autoplay !== false) void beginPlayback(); else setIsLoading(false);
    } catch { retry(); }
  }, [clearSource]);

  const togglePlay = useCallback(() => {
    if (isPlaybackDelegated()) return;
    const video = videoRef.current;
    if (!video) return;
    if (!lastUrlRef.current && suspendedUrlRef.current) {
      void playStream(suspendedUrlRef.current);
      return;
    }
    if (!lastUrlRef.current) return;
    if (video.paused) {
      setError(null);
      void video.play().catch(() => setError('Lecture impossible. Vérifie le flux puis réessaie.'));
    } else video.pause();
  }, [playStream]);
  const toggleFullscreen = useCallback(() => {
    const operation = document.fullscreenElement ? document.exitFullscreen?.() : videoRef.current?.requestFullscreen?.();
    void operation?.catch(() => setError('Plein écran indisponible.'));
  }, []);
  const changeVolume = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(1, value));
    if (videoRef.current) { videoRef.current.volume = clamped; videoRef.current.muted = clamped === 0; }
    setIsMuted(clamped === 0);
    setVolume(clamped);
  }, []);
  const changeMute = useCallback((muted: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    setIsMuted(video.muted || video.volume === 0);
  }, []);
  const toggleMute = useCallback(() => {
    if (videoRef.current) changeMute(!videoRef.current.muted);
  }, [changeMute]);
  const changeQuality = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls || index < 0 || index > hls.levels.length) return;
    hls.currentLevel = index - 1;
    setCurrentQuality(index === 0 ? 'auto' : `${hls.levels[index - 1].height || index}p`);
  }, []);
  /** Sélectionne une piste de sous-titres HLS (-1 = désactivées). */
  const changeSubtitleTrack = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.subtitleTrack = index;
    setSubtitleTrack(index);
  }, []);
  const adaptQualityToNetwork = useCallback((_networkDownlink: number) => {
    // HLS.js owns automatic adaptation. Manual quality selection stays authoritative.
  }, []);
  const getBufferHealth = useCallback(() => {
    const video = videoRef.current;
    if (!video) return 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) return video.buffered.end(i) - video.currentTime;
    }
    return 0;
  }, []);
  const manualRetry = useCallback(() => {
    if (lastUrlRef.current) void playStream(lastUrlRef.current);
  }, [playStream]);

  /** Rejoint le bord du direct après une pause (ou un décalage) sur un flux live. */
  const seekToLiveEdge = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const hls = hlsRef.current;
    const sync = hls?.liveSyncPosition;
    if (typeof sync === 'number' && sync > 0) {
      video.currentTime = sync;
    } else if (video.seekable.length) {
      try { video.currentTime = video.seekable.end(video.seekable.length - 1); } catch { /* bord indisponible */ }
    }
    setLiveBehindSec(null);
    void video.play().catch(() => {});
  }, []);

  useEffect(() => onPlaybackDelegated(() => {
    const previousUrl = lastUrlRef.current;
    stopStream();
    suspendedUrlRef.current = previousUrl;
  }), [stopStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => { setIsPlaying(true); wasPlayingRef.current = true; setIsLoading(false); setError(null); };
    const onPause = () => { setIsPlaying(false); };
    const onEnded = () => { wasPlayingRef.current = false; setIsPlaying(false); };
    const onVolume = () => { setVolume(video.volume); setIsMuted(video.muted || video.volume === 0); };
    const onFullscreen = () => setIsFullscreen(!!document.fullscreenElement);
    // Écart au direct (throttlé à ~1 s) : sert au bouton « Direct » après une pause.
    let lastCheck = 0;
    const onTime = () => {
      const nowTs = Date.now();
      if (nowTs - lastCheck < 1000) return;
      lastCheck = nowTs;
      if (!Number.isFinite(video.duration)) {
        const hls = hlsRef.current;
        const sync = hls?.liveSyncPosition;
        const edge = typeof sync === 'number' && sync > 0
          ? sync
          : video.seekable.length ? video.seekable.end(video.seekable.length - 1) : video.currentTime;
        const behind = Math.max(0, edge - video.currentTime);
        setLiveBehindSec(prev => {
          const next = behind > 2 ? behind : null;
          // Ne met à jour l'état que si le statut change (évite 1 re-render par seconde).
          if (next === null && prev === null) return prev;
          if (next !== null && prev !== null && Math.abs(next - prev) < 1) return prev;
          return next;
        });
      } else setLiveBehindSec(null);
    };
    video.volume = 0.8;
    video.addEventListener('play', onPlay); video.addEventListener('pause', onPause); video.addEventListener('ended', onEnded);
    video.addEventListener('volumechange', onVolume); video.addEventListener('timeupdate', onTime);
    document.addEventListener('fullscreenchange', onFullscreen);
    // Ce lecteur web ne joue que le direct (la VOD passe par le lecteur natif ou ses propres écrans).
    const detachUsage = attachUsageMeter(video, 'live');
    return () => {
      detachUsage();
      generationRef.current += 1;
      lastUrlRef.current = null;
      clearSource(); video.pause(); video.removeAttribute('src'); video.load();
      video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause); video.removeEventListener('ended', onEnded);
      video.removeEventListener('volumechange', onVolume); video.removeEventListener('timeupdate', onTime);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [clearSource]);

  // Reprise automatique après le retour du réseau (réglable dans les paramètres).
  useEffect(() => {
    const onOnline = () => {
      if (isPlaybackDelegated()) return;
      if (!wasPlayingRef.current || !lastUrlRef.current) return;
      void import('@/utils/storage').then(async ({ StorageManager }) => {
        try {
          const settings = await StorageManager.loadSettingsAsync();
          if (settings.autoReconnect === false) return;
          if (wasPlayingRef.current && lastUrlRef.current && !isPlaybackDelegated()) {
            void playStream(lastUrlRef.current, { autoplay: true });
          }
        } catch { /* paramètres indisponibles : on retente quand même ? non, prudence */ }
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [playStream]);
  return { videoRef, isPlaying, isLoading, error, isFullscreen, volume, currentQuality, availableQualities,
    playStream, stopStream, changeQuality, adaptQualityToNetwork, getBufferHealth, retryAttempts,
    togglePlay, toggleFullscreen, changeVolume, changeMute, isMuted, toggleMute, manualRetry, liveBehindSec, seekToLiveEdge,
    subtitleTracks, subtitleTrack, changeSubtitleTrack };
}
