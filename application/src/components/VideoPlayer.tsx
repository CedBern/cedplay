import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { TelemetryEventType } from '@/types/telemetry';
import { globalTelemetryLogger } from '@/utils/telemetry/logger';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Ratio, Subtitles, Check } from 'lucide-react';
import { Channel } from '@/types/channel';
import { useVideoPlayer } from '@/hooks/useVideoPlayer';
import { isPlaybackDelegated } from '@/utils/playbackOwnership';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { ConnectionQuality } from '@/components/ConnectionQuality';
import { QualitySelector } from '@/components/QualitySelector';
import { NetworkNotifications } from '@/components/NetworkNotifications';
import { StorageManager } from '@/utils/storage';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { getPreferredVariantForChannel, setPreferredVariantForChannel } from '@/utils/idb';
import { NativePlayerBridge, NativeZapContext } from '@/utils/nativePlayer';

interface VideoPlayerProps {
  channel?: Channel;
  className?: string;
  autoplay?: boolean;
  keyboardNavigation?: boolean;
  onNextChannel?: (() => void) | undefined;
  onPrevChannel?: (() => void) | undefined;
  /** Zapping numérique : saisie des chiffres puis Entrée. */
  onZapToNumber?: ((number: number) => void) | undefined;
  nativeZap?: NativeZapContext | undefined;
  /** Mini-lecteur : seules les commandes de lecture restent affichées. */
  mini?: boolean | undefined;
  onNativePlay?: ((channel: Channel) => void) | undefined;
}

export function VideoPlayer({ channel, className = '', autoplay = true, keyboardNavigation = true, onNextChannel, onPrevChannel, onZapToNumber, nativeZap, onNativePlay, mini = false }: VideoPlayerProps) {
  const {
    videoRef,
    isPlaying,
    isLoading,
    error,
    isFullscreen,
    volume,
    currentQuality,
    availableQualities,
    playStream,
    stopStream,
    changeQuality,
    adaptQualityToNetwork,
    retryAttempts,
    togglePlay,
    toggleFullscreen,
    changeVolume,
    manualRetry, isMuted, toggleMute, changeMute, liveBehindSec, seekToLiveEdge,
    subtitleTracks, subtitleTrack, changeSubtitleTrack
  } = useVideoPlayer();

  // Active channel may shift to a variant if fallback is triggered
  const [activeChannel, setActiveChannel] = useState<Channel | undefined>(channel);
  const handledErrorsRef = useRef<Set<string>>(new Set());
  const [variantIndex, setVariantIndex] = useState<number>(0); // 0 = primary, >0 = variant idx

  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3500);
  }, []);

  // When playback state changes, auto-hide controls after 3.5s if playing
  useEffect(() => {
    if (isPlaying) {
      triggerControls();
    } else {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
    };
  }, [isPlaying, triggerControls]);

  const handleContainerClick = (e: React.MouseEvent) => {
    // If clicking an interactive button/slider, keep controls visible without toggling
    if ((e.target as HTMLElement).closest('button, input, select, [role="menuitem"], [role="slider"], [role="option"]')) {
      triggerControls();
      return;
    }
    setShowControls(prev => {
      if (!prev) {
        triggerControls();
        return true;
      } else {
        if (isPlaying) {
          if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
          }
          return false;
        }
        return true;
      }
    });
  };

  // Network status monitoring with auto-adaptation
  const networkStatus = useNetworkStatus();
  
  // Auto-adapt quality based on network changes
  useEffect(() => {
    if (networkStatus.isOnline && currentQuality === 'auto') {
      adaptQualityToNetwork(networkStatus.downlink);
    }
  }, [networkStatus.isOnline, networkStatus.downlink, currentQuality, adaptQualityToNetwork]);

  // Telemetry & Circuit Breaker state
  const failureTimestampsRef = useRef<number[]>([]);
  const [breakerOpen, setBreakerOpen] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0); // seconds
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const FAILURE_THRESHOLD = 5;          // failures
  const FAILURE_WINDOW_MS = 60_000;      // in rolling window
  const COOLDOWN_MS = 30_000;            // breaker open duration

  const logEvent = (type: TelemetryEventType, info?: string) => {
    globalTelemetryLogger.log(type, info ? { info } : {});
  };

  const openBreaker = useCallback(() => {
    if (breakerOpen) return;
    setBreakerOpen(true);
  logEvent('error', `breaker_open cooldown ${(COOLDOWN_MS/1000)}s`);
    setCooldownRemaining(Math.floor(COOLDOWN_MS / 1000));
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    const started = Date.now();
    cooldownTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - started;
      const remain = Math.max(0, COOLDOWN_MS - elapsed);
      setCooldownRemaining(Math.ceil(remain / 1000));
      if (remain <= 0) {
        clearInterval(cooldownTimerRef.current!);
        cooldownTimerRef.current = null;
        setBreakerOpen(false);
  logEvent('play', 'breaker_close');
        // After cooldown, user may manually retry; no auto play attempt here.
      }
    }, 1000);
  }, [breakerOpen]);

  useEffect(() => () => { if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current); }, []);

  const effectiveVariants = useMemo<Channel[]>(() => {
    if (!channel || !channel.url) return [];
    const list = channel.variants ? [...channel.variants] : [];
    if (/\.ts(?:$|[?#])/i.test(channel.url)) {
      const hlsUrl = channel.url.replace(/\.ts(?=([?#]|$))/i, '.m3u8');
      if (!list.some(v => v.url === hlsUrl)) {
        list.push({
          id: channel.id + '_hls',
          name: `${channel.name} (HLS)`,
          url: hlsUrl,
          ...(channel.group ? { group: channel.group } : {}),
          isFavorite: false,
        });
      }
    } else if (/\.m3u8(?:$|[?#])/i.test(channel.url)) {
      const tsUrl = channel.url.replace(/\.m3u8(?=([?#]|$))/i, '.ts');
      if (!list.some(v => v.url === tsUrl)) {
        list.push({
          id: channel.id + '_ts',
          name: `${channel.name} (TS)`,
          url: tsUrl,
          ...(channel.group ? { group: channel.group } : {}),
          isFavorite: false,
        });
      }
    }
    return list;
  }, [channel]);

  // Cancel pending preference reads when changing channels or leaving the player.
  useEffect(() => {
    let cancelled = false;
    stopStream();
    handledErrorsRef.current.clear(); failureTimestampsRef.current = [];
    if (channel && channel.url && !breakerOpen) {
      void (async () => {
        let idx = 0;
        const sequence = [channel, ...effectiveVariants];
        try {
          const pref = await getPreferredVariantForChannel(channel.id);
          const found = sequence.findIndex(c => c?.id === pref);
          if (found >= 0) {
            idx = found;
          } else {
            // Default preference: automatically prefer HLS (.m3u8) for smooth hardware-accelerated playback
            const hlsIdx = sequence.findIndex(c => c?.url && /\.m3u8(?:$|[?#])/i.test(c.url));
            if (hlsIdx >= 0) idx = hlsIdx;
          }
        } catch {
          const hlsIdx = sequence.findIndex(c => c?.url && /\.m3u8(?:$|[?#])/i.test(c.url));
          if (hlsIdx >= 0) idx = hlsIdx;
        }
        if (cancelled) return;
        // Le lecteur natif (ou un autre consommateur) peut avoir pris la main
        // pendant la lecture des préférences : ne pas relancer la lecture web.
        if (isPlaybackDelegated()) return;
        const selected = sequence[idx] || sequence[0] || channel;
        setActiveChannel(selected);
        setVariantIndex(idx >= 0 && idx < sequence.length ? idx : 0);
        if (selected && selected.url) {
          void playStream(selected.url, { autoplay });
        }
      })();
    } else {
      setActiveChannel(channel);
      setVariantIndex(0);
    }
    return () => { cancelled = true; stopStream(); };
    // `breakerOpen` est volontairement absent des dépendances : le circuit breaker
    // ne doit ni couper un flux sain ni relancer la lecture tout seul après le délai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, autoplay, playStream, stopStream, effectiveVariants]);
  const handleSelectVariant = async (idx: number) => {
    if (!channel) return;
    const sequence = [channel, ...effectiveVariants];
    if (idx < 0 || idx >= sequence.length) return;
    const chosen = sequence[idx] || channel;
    if (!chosen || !chosen.url) return;
    setVariantIndex(idx);
    setActiveChannel(chosen);
    if (breakerOpen) {
      toast.error('Pause automatique : attends la fin du délai de protection.');
      return;
    }
    logEvent('level-switch', `variant idx=${idx}`);
    // Stop current stream before switching to variant
    stopStream();
    void playStream(chosen.url, { resetAttempts: true }); // Small delay for cleanup
    try {
      await setPreferredVariantForChannel(channel.id, idx === 0 ? undefined : chosen.id);
    } catch (e) {
      console.warn('Persist preferred variant failed', e);
    }
    toast.success(idx === 0 ? 'Flux principal sélectionné' : `Flux n° ${idx} sélectionné${chosen.quality ? ' ('+chosen.quality+')' : ''}`);
  };

  // Auto-fallback to variants on fatal exhaustion
  useEffect(() => {
    if (!error || !channel) return;
    if (!/Gave up after/i.test(error)) return; // only act on exhausted retries
    if (handledErrorsRef.current.has(error)) return;
    handledErrorsRef.current.add(error);
  logEvent('error', error.slice(0, 120));

    // Track failures for breaker
    const now = Date.now();
    failureTimestampsRef.current.push(now);
    failureTimestampsRef.current = failureTimestampsRef.current.filter(t => now - t <= FAILURE_WINDOW_MS);
    if (!breakerOpen && failureTimestampsRef.current.length >= FAILURE_THRESHOLD) {
      openBreaker();
      toast.error('Trop d’échecs : pause automatique de 30 secondes.');
      return; // don't auto-switch while breaker open
    }

    const variants = effectiveVariants;
    // Determine current position in sequence [primary, ...variants]
    const sequence: Channel[] = [channel, ...variants];
    const currentIdx = activeChannel ? sequence.findIndex(c => c.id === activeChannel.id) : 0;
    let nextIdx = currentIdx + 1;
    if (nextIdx >= sequence.length && currentIdx > 0) {
      nextIdx = 0; // If HLS variant failed, fallback to primary (.ts)
    }
    if (nextIdx < sequence.length && nextIdx !== currentIdx) {
      const next = sequence[nextIdx];
      setVariantIndex(nextIdx);
      setActiveChannel(next);
      toast.warning(`Flux alternatif activé : ${next.name}`);
      stopStream();
      void playStream(next.url, { resetAttempts: true });
    } else if (variants.length) {
      toast.error('Tous les flux ont échoué pour cette chaîne.');
    }
  }, [error, channel, activeChannel, playStream, stopStream, breakerOpen, openBreaker, effectiveVariants]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await StorageManager.loadSettingsAsync();
      if (!cancelled) {
        changeVolume(settings.volume);
        changeMute(settings.muteOnStart !== false);
        const el = videoRef.current;
        if (el) {
          if (settings.playbackRate && !Number.isNaN(settings.playbackRate)) {
            el.playbackRate = settings.playbackRate;
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [changeVolume, changeMute, videoRef]);

  // La valeur de volume est lue via une ref : le listener clavier n'est pas
  // recréé à chaque tick du slider de volume.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  // Zapping numérique : saisie des chiffres affichée en surimpression.
  const [zapBuffer, setZapBuffer] = useState('');
  const [aspectRatioMode, setAspectRatioMode] = useState<'fit' | 'zoom' | 'stretch'>('fit');
  const toggleAspectRatio = useCallback(() => {
    setAspectRatioMode(prev => {
      if (prev === 'fit') {
        toast.info('Zoom plein écran');
        return 'zoom';
      }
      if (prev === 'zoom') {
        toast.info('Format étiré');
        return 'stretch';
      }
      toast.info('Format original (ajusté)');
      return 'fit';
    });
  }, []);
  const zapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zapBufferRef = useRef('');
  zapBufferRef.current = zapBuffer;
  const commitZap = useCallback(() => {
    const buffer = zapBufferRef.current;
    if (buffer && onZapToNumber) onZapToNumber(parseInt(buffer, 10));
    setZapBuffer('');
    if (zapTimerRef.current !== null) { clearTimeout(zapTimerRef.current); zapTimerRef.current = null; }
  }, [onZapToNumber]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!channel || !keyboardNavigation || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"], [role="tab"]')) return;
      // Zapping numérique : chiffres 0-9, Entrée valide, Échap efface.
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setZapBuffer(prev => {
          // Longueur unique avec le lecteur natif et l'écran Direct : 5 chiffres.
          const next = (prev + e.key).slice(0, 5);
          if (zapTimerRef.current !== null) clearTimeout(zapTimerRef.current);
          zapTimerRef.current = setTimeout(() => { setZapBuffer(''); }, 1500);
          return next;
        });
        return;
      }
      if (e.key === 'Enter' && zapBufferRef.current) { e.preventDefault(); commitZap(); return; }
      if (e.key === 'Escape' && zapBufferRef.current) { e.preventDefault(); setZapBuffer(''); return; }
      if (e.key === 'Backspace' && zapBufferRef.current) { e.preventDefault(); setZapBuffer(prev => prev.slice(0, -1)); return; }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'PageUp':
          e.preventDefault();
          onPrevChannel?.();
          break;
        case 'PageDown':
          e.preventDefault();
          onNextChannel?.();
          break;
        // Touches chaîne de la télécommande : même zapping que Page haut/bas.
        case 'ChannelUp':
          e.preventDefault();
          onPrevChannel?.();
          break;
        case 'ChannelDown':
          e.preventDefault();
          onNextChannel?.();
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(Math.min(1, volumeRef.current + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(Math.max(0, volumeRef.current - 0.1));
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (zapTimerRef.current !== null) {
        clearTimeout(zapTimerRef.current);
        zapTimerRef.current = null;
      }
    };
  }, [channel, togglePlay, toggleFullscreen, changeVolume, toggleMute, keyboardNavigation, onNextChannel, onPrevChannel, commitZap]);

  const handleVolumeChange = (newVolume: number[]) => {
    const vol = newVolume[0];
    changeVolume(vol);
  StorageManager.saveSettings({ volume: vol }).catch(e => console.warn('Save settings failed', e));
  };

  const handleManualRetry = () => {
    if (breakerOpen) {
      toast.error('Pause automatique : attends la fin du délai de protection.');
      return;
    }
  logEvent('retry', 'manual');
    manualRetry();
  };

  if (!channel) {
    return (
      <Card className={`dark-surface aspect-video bg-black flex items-center justify-center ${className}`}>
        <div className="text-center text-white">
          <Loader2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground animate-spin" />
          <p className="text-muted-foreground">Choisis une chaîne pour commencer</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Network Notifications */}
      <NetworkNotifications networkStatus={networkStatus} enabled={true} />

      {/* Native Player quick launcher on mobile */}
      {NativePlayerBridge.isAvailable() && (
        <div className="flex flex-wrap items-center gap-2 p-2 bg-neutral-950 rounded-[20px] border border-neutral-900 mb-2">
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs flex items-center justify-center gap-1.5 flex-1 h-10 rounded-full transition-transform active:scale-95"
            onClick={() => {
              if (activeChannel?.url) {
                if (onNativePlay) onNativePlay(activeChannel);
                else void NativePlayerBridge.open(activeChannel.url, activeChannel.name, nativeZap);
              }
            }}
          >
            <Play className="h-3.5 w-3.5 fill-current" /> Lecteur Android (ExoPlayer)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-neutral-700 bg-transparent text-white hover:bg-neutral-900 font-medium text-xs flex items-center gap-1 h-10 px-3.5 rounded-full"
            onClick={() => {
              if (activeChannel?.url) {
                void NativePlayerBridge.openExternal(activeChannel.url, activeChannel.name);
              }
            }}
            title="Ouvrir dans VLC ou lecteur externe"
          >
            VLC
          </Button>
        </div>
      )}
      
      <Card 
        className={`dark-surface relative group bg-black overflow-hidden select-none ${className}`}
        onClick={handleContainerClick}
        onMouseMove={triggerControls}
        onTouchStart={triggerControls}
      >
        <CardContent className="p-0 relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
          {/* Video Element */}
          <video
            ref={videoRef}
            className={`w-full h-full bg-black transition-all ${aspectRatioMode === 'fit' ? 'object-contain' : aspectRatioMode === 'zoom' ? 'object-cover' : 'object-fill'}`}
            poster={activeChannel?.logo || channel.logo}
            controls={false}
            autoPlay
            playsInline
            muted={isMuted}
            aria-label={`Lecteur vidéo : ${channel.name}`}
          />

          {/* Zapping numérique : affiche la saisie en cours */}
          {zapBuffer && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/85 border border-white/20 rounded-lg px-4 py-1.5 text-2xl font-bold tracking-widest text-white" role="status" aria-label={`Numéro de chaîne saisi : ${zapBuffer}`}>
              {zapBuffer}
            </div>
          )}

        {/* Loading Overlay (masqué quand une erreur est affichée : pas de double écran) */}
        {isLoading && !error && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center text-white">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin" />
              <p>Chargement de {activeChannel?.name || channel.name}…</p>
            </div>
          </div>
        )}

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center text-white max-w-md mx-auto p-4">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
              <p className="mb-2">Problème de flux</p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{error}</p>
              {retryAttempts > 0 && (
                <p className="text-xs text-muted-foreground mt-2">Tentatives : {retryAttempts}</p>
              )}
              {channel.variants?.length ? (
                <p className="text-xs text-muted-foreground mt-1">Variantes disponibles : {channel.variants.length}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 justify-center mt-4">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleManualRetry}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />Réessayer
                </Button>
                {NativePlayerBridge.isAvailable() && (
                  <>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                      onClick={() => {
                        if (activeChannel?.url) {
                          if (onNativePlay) onNativePlay(activeChannel);
                else void NativePlayerBridge.open(activeChannel.url, activeChannel.name, nativeZap);
                        }
                      }}
                    >
                      Lecteur natif (ExoPlayer)
                    </Button>
                    <Button
                      size="sm"
                      className="bg-orange-600 hover:bg-orange-500 text-white font-bold"
                      onClick={() => {
                        if (activeChannel?.url) {
                          void NativePlayerBridge.openExternal(activeChannel.url, activeChannel.name);
                        }
                      }}
                    >
                      Ouvrir dans VLC
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Channel Info Overlay (auto-hides with controls during playback) */}
        <div className={`absolute top-2 left-2 right-2 sm:top-4 sm:left-4 sm:right-4 z-10 transition-opacity duration-300 ${mini ? 'hidden' : ''} ${
          showControls || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <div className="flex items-center justify-between">
            <div className="bg-neutral-950/90 rounded-lg px-3 py-2 min-w-0 max-w-full">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                <h3 className="text-white font-semibold flex items-center gap-2 min-w-0">
                  <span className="truncate">{channel.name}</span>
                  {variantIndex > 0 && (
                    <Badge variant="secondary" className="text-xs bg-amber-600/80 text-white">ALT {variantIndex}{activeChannel?.quality ? ' • '+activeChannel.quality : ''}</Badge>
                  )}
                  {variantIndex === 0 && activeChannel?.quality && (
                    <Badge variant="secondary" className="text-xs">{activeChannel.quality}</Badge>
                  )}
                  {breakerOpen && (
                    <Badge variant="destructive" className="text-[10px] tracking-wide">COOLDOWN {cooldownRemaining}s</Badge>
                  )}
                </h3>
                {/* Connection Quality Indicator */}
                <div className="ml-2">
                  <ConnectionQuality networkStatus={networkStatus} />
                </div>
                {/* Protocol Quick Toggle (HLS <-> TS) */}
                {activeChannel && (/\.ts|\.m3u8/i.test(activeChannel.url)) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] bg-neutral-900/90 border-neutral-700 text-neutral-100 hover:bg-neutral-800"
                    title="Basculer entre HLS (décodage matériel fluide) et MPEG-TS"
                    onClick={() => {
                      if (!activeChannel?.url) return;
                      const isTs = /\.ts(?:$|[?#])/i.test(activeChannel.url);
                      const targetExt = isTs ? 'm3u8' : 'ts';
                      const sequence = [channel, ...effectiveVariants];
                      const targetIdx = sequence.findIndex(c => c?.url && new RegExp(`\\.${targetExt}(?:$|[?#])`, 'i').test(c.url));
                      if (targetIdx >= 0) {
                        void handleSelectVariant(targetIdx);
                      } else {
                        const nextUrl = isTs
                          ? activeChannel.url.replace(/\.ts(?=([?#]|$))/i, '.m3u8')
                          : activeChannel.url.replace(/\.m3u8(?=([?#]|$))/i, '.ts');
                        const nextName = isTs ? `${channel.name} (HLS)` : `${channel.name} (TS)`;
                        const updatedChannel: Channel = { ...activeChannel, url: nextUrl, name: nextName };
                        setActiveChannel(updatedChannel);
                        stopStream();
                        void playStream(nextUrl, { resetAttempts: true });
                      }
                      toast.info(isTs ? 'Basculé sur HLS (.m3u8) — décodage matériel fluide' : 'Basculé sur MPEG-TS (.ts)');
                    }}
                  >
                    {/\.m3u8/i.test(activeChannel.url) ? 'HLS' : 'TS'}
                  </Button>
                )}

                {NativePlayerBridge.isAvailable() && (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px] bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                    title="Ouvrir dans le lecteur Android (ExoPlayer)"
                    onClick={() => {
                      if (activeChannel?.url) {
                        if (onNativePlay) onNativePlay(activeChannel);
                else void NativePlayerBridge.open(activeChannel.url, activeChannel.name, nativeZap);
                      }
                    }}
                  >
                    Natif
                  </Button>
                )}

                {NativePlayerBridge.isAvailable() && (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px] bg-orange-600 hover:bg-orange-500 text-white font-bold"
                    title="Ouvrir dans VLC"
                    onClick={() => {
                      if (activeChannel?.url) {
                        void NativePlayerBridge.openExternal(activeChannel.url, activeChannel.name);
                      }
                    }}
                  >
                    VLC
                  </Button>
                )}

                {effectiveVariants.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-xs flex items-center gap-1">
                        Flux <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56">
                      <DropdownMenuLabel>Choisir un flux</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => handleSelectVariant(0)}>
                        Primary {variantIndex===0 && '•'} {channel.quality && `(${channel.quality})`}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {effectiveVariants.map((v, i) => (
                        <DropdownMenuItem key={v.id} onClick={() => handleSelectVariant(i+1)}>
                          Variante {i+1} {variantIndex===i+1 && '•'} {v.quality && `(${v.quality})`}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                
                {/* Quality Selector */}
                <QualitySelector
                  currentQuality={currentQuality}
                  availableQualities={availableQualities}
                  onQualityChange={changeQuality}
                  disabled={!isPlaying}
                />
                {/* Sous-titres du direct : pistes du manifeste HLS, rien sinon. */}
                {subtitleTracks.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-xs flex items-center gap-1" title="Sous-titres" aria-label="Sous-titres">
                        <Subtitles className="h-3 w-3" />
                        {subtitleTrack === -1 ? 'ST' : subtitleTracks.find(t => t.index === subtitleTrack)?.label || 'ST'}
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Sous-titres</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => changeSubtitleTrack(-1)} className="flex items-center justify-between gap-2 cursor-pointer">
                        Désactivés
                        {subtitleTrack === -1 && <Check className="h-4 w-4 text-green-500" />}
                      </DropdownMenuItem>
                      {subtitleTracks.map(track => (
                        <DropdownMenuItem key={track.index} onClick={() => changeSubtitleTrack(track.index)} className="flex items-center justify-between gap-2 cursor-pointer">
                          {track.label}
                          {subtitleTrack === track.index && <Check className="h-4 w-4 text-green-500" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {channel.group && (
                <Badge variant="secondary" className="text-xs mt-1">
                  {channel.group}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Controls Overlay (auto-hides with controls during playback) */}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 transition-opacity duration-300 ${
          showControls || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <div className="flex items-center gap-1 sm:gap-4">
            {/* Zapping (channel previous/next) */}
            {(onPrevChannel || onNextChannel) && (
              <div className="flex items-center space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Chaîne précédente"
                  onClick={onPrevChannel}
                  disabled={!onPrevChannel}
                  className="text-white hover:bg-white/20"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Chaîne suivante"
                  onClick={onNextChannel}
                  disabled={!onNextChannel}
                  className="text-white hover:bg-white/20"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            )}

            {/* Play/Pause */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={isPlaying ? "Pause" : "Lecture"}
              onClick={togglePlay}
              className="text-white hover:bg-white/20"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>

            {/* Retour au direct (après une pause sur un flux live) */}
            {liveBehindSec !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={seekToLiveEdge}
                className="h-8 px-3 text-xs font-semibold tracking-wide text-white border-transparent bg-black/60 hover:bg-black/80"
                title="Tu es en retard sur le direct : cliquer pour revenir en direct"
              >
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
                Direct
              </Button>
            )}

            {/* Volume */}
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label={isMuted ? "Activer le son" : "Couper le son"}
                onClick={toggleMute}
                className="text-white hover:bg-white/20"
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <div className="hidden w-20 sm:block">
                <Slider
                  aria-label="Volume"
                  value={[volume]}
                  onValueChange={handleVolumeChange}
                  max={1}
                  step={0.1}
                  className="cursor-pointer"
                />
              </div>
            </div>

            <div className="flex-1" />

                        {/* Format d'image (redimensionnement) */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Format d'image : ${aspectRatioMode === 'fit' ? 'Format original' : aspectRatioMode === 'zoom' ? 'Zoom plein écran' : 'Étiré'}`}
              onClick={toggleAspectRatio}
              className="text-white hover:bg-white/20 text-xs px-2 h-8"
              title="Changer le format (Ajusté / Zoom / Étiré)"
            >
              <Ratio className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">{aspectRatioMode === 'fit' ? 'Ajusté' : aspectRatioMode === 'zoom' ? 'Zoom' : 'Étiré'}</span>
            </Button>

            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/20"
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
    </>
  );
}
