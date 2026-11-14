import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Cpu,
  History,
  List,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Ratio,
  RotateCcw,
  RotateCw,
  SkipForward,
  Square,
  Subtitles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { DesktopPlayerSurface } from '@/components/DesktopPlayerSurface';
import {
  closeDesktopLiveSession,
  closeDesktopVodSession,
  needsFfmpegTransmux,
  probeMediaDurationAndCodecs,
  startDesktopRecording,
  stopDesktopRecording,
  subscribeDesktopUi,
  toggleDesktopFullscreen,
  type ActiveDvrRecording,
  type DesktopLiveSession,
  type DesktopVodSession,
} from '@/utils/desktopBridge';
import { attachDesktopMediaStream, type AttachedMediaHandle } from '@/utils/desktopMediaAttach';
import type { NativeCatchup, NativeProgram } from '@/utils/nativePlayer';
import { downloadSubtitleText } from '@/utils/subtitles';
import { parseSrt, type SubtitleCue } from '@/utils/subtitleTranslator';
import { getActiveUserAgent } from '@/utils/userAgent';
import { attachUsageMeter } from '@/utils/usageJournal';

function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDurationSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function resolveCatchupUrl(catchup: NativeCatchup | undefined, program: NativeProgram | null): string | null {
  if (!catchup) return null;
  if (catchup.template && program) {
    const [startMs, endMs] = program;
    const mins = Math.max(1, Math.round((endMs - startMs) / 60000));
    const startSec = Math.floor(startMs / 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: catchup.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(startMs));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
    const stamp = `${part('year')}-${part('month')}-${part('day')}:${part('hour')}-${part('minute')}`;
    return catchup.template
      .replace(/\{start\}|\$\{start\}/g, stamp)
      .replace(/\{utc\}|\$\{utc\}/g, String(startSec))
      .replace(/\{minutes\}|\{duration\}|\$\{duration\}/g, String(mins));
  }
  if (catchup.url && Date.now() <= (catchup.urlEnd || Infinity)) return catchup.url;
  return null;
}

function useAutoHideHud(active: boolean) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<number | null>(null);

  const reveal = useCallback(() => {
    setVisible(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (active) {
      timerRef.current = window.setTimeout(() => setVisible(false), 3800);
    }
  }, [active]);

  useEffect(() => {
    reveal();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [reveal]);

  return { visible, reveal };
}

function DesktopLiveCinemaView({
  session,
  activeRecordings,
}: {
  session: DesktopLiveSession;
  activeRecordings: ActiveDvrRecording[];
}) {
  const zap = session.zap;
  const urls = useMemo(() => (zap?.urls?.length ? zap.urls : [session.url]), [zap, session.url]);
  const titles = useMemo(() => (zap?.titles?.length === urls.length ? zap.titles : [session.title || 'Direct']), [zap, urls.length, session.title]);
  const initialIndex = zap && zap.index >= 0 && zap.index < urls.length ? zap.index : 0;

  const [index, setIndex] = useState(initialIndex);
  const [overrideUrl, setOverrideUrl] = useState<string | null>(null);
  const [forceFfmpeg, setForceFfmpeg] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [aspect, setAspect] = useState<'contain' | 'cover' | 'fill'>('contain');
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
  const [zapDigits, setZapDigits] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [audioTracks, setAudioTracks] = useState<{ id: number; label: string }[]>([]);
  const [audioTrack, setAudioTrack] = useState(0);
  const [subtitleTracks, setSubtitleTracks] = useState<{ id: number; label: string }[]>([]);
  const [subtitleTrack, setSubtitleTrack] = useState(-1);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaHandleRef = useRef<AttachedMediaHandle | null>(null);
  const zapTimerRef = useRef<number | null>(null);

  const currentUrl = overrideUrl || urls[index] || session.url;
  const currentTitle = titles[index] || session.title || 'Direct';
  const currentGroup = zap?.groups?.[index];
  const currentLogo = zap?.logos?.[index];
  const currentNumber = zap?.numbers?.[index];
  const programs = zap?.epg?.[index] || [];
  const currentProg = programs.find((p) => p[0] <= now && now < p[1]) ?? null;
  const nextProg = programs.find((p) => p[0] > now) ?? null;
  const catchupUrl = useMemo(() => resolveCatchupUrl(zap?.catchup?.[index], currentProg), [zap, index, currentProg]);
  const activeRec = activeRecordings.find((r) => r.url === currentUrl);

  const { visible: hudVisible, reveal } = useAutoHideHud(!paused && !drawerOpen);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    return video ? attachUsageMeter(video, 'live') : undefined;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setStatus('loading');
    setPaused(false);
    setAudioTracks([]);
    setAudioTrack(0);
    setSubtitleTracks([]);
    setSubtitleTrack(-1);
    const handle = attachDesktopMediaStream(video, currentUrl, {
      live: true,
      muted,
      forceTransmux: forceFfmpeg,
      onStatus: setStatus,
      onAudioTracks: setAudioTracks,
      onSubtitleTracks: setSubtitleTracks,
    });
    mediaHandleRef.current = handle;
    return () => { handle.destroy(); mediaHandleRef.current = null; };
  }, [currentUrl, forceFfmpeg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = muted;
    videoRef.current.volume = volume;
  }, [muted, volume]);

  const switchChannel = useCallback((nextIdx: number) => {
    const bounded = (nextIdx + urls.length) % urls.length;
    setOverrideUrl(null);
    setIndex(bounded);
    reveal();
  }, [urls.length, reveal]);

  const commitNumericZap = useCallback((digits: string) => {
    setZapDigits('');
    if (!digits) return;
    const targetNum = String(Number(digits));
    const idx = zap?.numbers?.findIndex((n) => n === targetNum) ?? -1;
    if (idx >= 0) {
      switchChannel(idx);
    } else if (session.onJump) {
      closeDesktopLiveSession(urls[index], targetNum);
    }
  }, [zap?.numbers, switchChannel, session.onJump, urls, index]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      reveal();
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        if (drawerOpen) { setDrawerOpen(false); return; }
        closeDesktopLiveSession(urls[index]);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        switchChannel(index - 1);
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        switchChannel(index + 1);
      } else if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) { void v.play(); setPaused(false); } else { v.pause(); setPaused(true); }
      } else if (e.key.toLowerCase() === 'm') {
        setMuted((m) => !m);
      } else if (e.key === 'F11' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleDesktopFullscreen();
      } else if (e.key.toLowerCase() === 'l') {
        setDrawerOpen((o) => !o);
      } else if (/^\d$/.test(e.key)) {
        const next = (zapDigits + e.key).slice(0, 5);
        setZapDigits(next);
        if (zapTimerRef.current !== null) window.clearTimeout(zapTimerRef.current);
        zapTimerRef.current = window.setTimeout(() => commitNumericZap(next), 1200);
      } else if (e.key === 'Enter' && zapDigits) {
        e.preventDefault();
        if (zapTimerRef.current !== null) window.clearTimeout(zapTimerRef.current);
        commitNumericZap(zapDigits);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, urls, drawerOpen, zapDigits, reveal, switchChannel, commitNumericZap]);

  const toggleRecording = async () => {
    if (activeRec) {
      const ok = await stopDesktopRecording(activeRec.id);
      if (ok) toast.success(`Enregistrement terminé : ${currentTitle}`);
    } else {
      const started = await startDesktopRecording(currentUrl, currentTitle, getActiveUserAgent());
      if (started) toast.success(`Enregistrement démarré : ${currentTitle}`);
      else toast.error('Impossible de démarrer l’enregistrement DVR.');
    }
  };

  const progressPct = currentProg
    ? Math.max(0, Math.min(100, ((now - currentProg[0]) / Math.max(1, currentProg[1] - currentProg[0])) * 100))
    : 0;

  return (
    <DesktopPlayerSurface
      data-desktop-cinema-player="live"
      title={`Lecture : ${currentTitle}`}
      aria-label={`Lecture : ${currentTitle}`}
      className="fixed inset-0 z-40 select-none bg-black text-white"
      onMouseMove={reveal}
      onClick={() => {
        if (drawerOpen) { setDrawerOpen(false); return; }
        reveal();
      }}
      onDoubleClick={toggleDesktopFullscreen}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`h-full w-full ${aspect === 'cover' ? 'object-cover' : aspect === 'fill' ? 'object-fill' : 'object-contain'}`}
      />

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-2xl bg-black/80 px-5 py-3 text-sm backdrop-blur-md">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>Connexion au flux {forceFfmpeg ? '(FFmpeg)' : ''}…</span>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/75 p-6">
          <div className="max-w-md space-y-3 rounded-2xl border border-white/15 bg-neutral-950 p-6 text-center">
            <p className="text-base font-semibold">Impossible de lire cette chaîne</p>
            <p className="text-sm text-neutral-400">Essaie le transcodage FFmpeg ou passe à la chaîne suivante.</p>
            <div className="flex justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setForceFfmpeg((f) => !f)}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
              >
                {forceFfmpeg ? 'Réessayer en direct' : 'Forcer FFmpeg AAC'}
              </button>
              <button
                type="button"
                onClick={() => closeDesktopLiveSession(urls[index])}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm"
              >
                Retour
              </button>
            </div>
          </div>
        </div>
      )}

      {zapDigits && (
        <div className="pointer-events-none absolute right-8 top-8 rounded-2xl border border-white/15 bg-black/85 px-6 py-3 font-mono text-4xl font-bold tracking-wider backdrop-blur-md">
          {zapDigits}
        </div>
      )}

      {/* Barre haute */}
      <header
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 top-0 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-6 py-5 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => closeDesktopLiveSession(urls[index])}
            aria-label="Quitter le lecteur"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 transition hover:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          {currentLogo && <img src={currentLogo} alt="" className="h-10 w-10 rounded-lg bg-black/50 object-contain p-1" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {currentNumber && <span className="rounded bg-primary px-2 py-0.5 font-mono text-xs font-bold">{currentNumber}</span>}
              <h1 className="truncate text-lg font-bold">{currentTitle}</h1>
              {overrideUrl && <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">Archive</span>}
            </div>
            {currentGroup && <p className="truncate text-xs text-neutral-300">{currentGroup}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {urls.length > 1 && (
            <button
              type="button"
              onClick={() => setDrawerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20"
            >
              <List className="h-4 w-4" /> Chaînes ({urls.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => { void toggleRecording(); }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              activeRec ? 'bg-red-600 text-white animate-pulse' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <CircleDot className="h-4 w-4" /> {activeRec ? 'Arrêter REC' : 'Enregistrer'}
          </button>
          <button
            type="button"
            onClick={() => setForceFfmpeg((f) => !f)}
            title="Basculer entre lecture directe et remux FFmpeg"
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ${
              forceFfmpeg ? 'bg-primary text-white' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            <Cpu className="h-4 w-4" /> {forceFfmpeg ? 'FFmpeg ON' : 'Auto'}
          </button>
        </div>
      </header>

      {/* HUD bas (EPG + Contrôles) */}
      <footer
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-6 pb-5 pt-12 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {(currentProg || nextProg) && (
          <div className="mb-4 max-w-2xl rounded-2xl border border-white/10 bg-black/65 p-3.5 backdrop-blur-md">
            {currentProg && (
              <div>
                <div className="flex items-center justify-between text-xs text-neutral-300">
                  <span className="font-semibold text-primary">EN CE MOMENT · {currentProg[2]}</span>
                  <span className="font-mono">{formatClockTime(currentProg[0])}–{formatClockTime(currentProg[1])}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}
            {nextProg && (
              <p className="mt-2 truncate text-xs text-neutral-400">
                Ensuite · {formatClockTime(nextProg[0])} · {nextProg[2]}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {urls.length > 1 && (
              <button
                type="button"
                aria-label="Chaîne précédente"
                onClick={() => switchChannel(index - 1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              aria-label={paused ? 'Reprendre' : 'Pause'}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) { void v.play(); setPaused(false); } else { v.pause(); setPaused(true); }
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white hover:bg-primary/90"
            >
              {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </button>
            {urls.length > 1 && (
              <button
                type="button"
                aria-label="Chaîne suivante"
                onClick={() => switchChannel(index + 1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
            {catchupUrl && (
              <button
                type="button"
                onClick={() => {
                  setOverrideUrl(catchupUrl);
                  toast.info('Reprise du programme depuis le début');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20"
              >
                <History className="h-4 w-4 text-primary" /> Depuis le début
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {audioTracks.length > 1 && (
              <select aria-label="Piste audio" value={audioTrack} onChange={(event) => {
                const id = Number(event.target.value);
                mediaHandleRef.current?.setAudioTrack?.(id);
                setAudioTrack(id);
              }} className="rounded-xl bg-neutral-900 px-2.5 py-1.5 text-xs">
                {audioTracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
              </select>
            )}
            {subtitleTracks.length > 0 && (
              <select aria-label="Piste de sous-titres" value={subtitleTrack} onChange={(event) => {
                const id = Number(event.target.value);
                mediaHandleRef.current?.setSubtitleTrack(id);
                setSubtitleTrack(id);
              }} className="rounded-xl bg-neutral-900 px-2.5 py-1.5 text-xs">
                <option value={-1}>Sans sous-titres</option>
                {subtitleTracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
              </select>
            )}
            <button
              type="button"
              aria-label={muted ? 'Activer le son' : 'Couper le son'}
              onClick={() => setMuted((m) => !m)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const val = Number(e.target.value);
                setVolume(val);
                if (val > 0 && muted) setMuted(false);
              }}
              className="w-24 accent-primary"
            />
            <button
              type="button"
              aria-label="Format d’image"
              onClick={() => setAspect((a) => (a === 'contain' ? 'cover' : a === 'cover' ? 'fill' : 'contain'))}
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-2 text-xs hover:bg-white/20"
            >
              <Ratio className="h-4 w-4" /> {aspect === 'contain' ? 'Ajusté' : aspect === 'cover' ? 'Zoom' : 'Étiré'}
            </button>
            <button
              type="button"
              aria-label="Plein écran"
              onClick={toggleDesktopFullscreen}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </footer>

      {/* Tiroir chaînes */}
      {drawerOpen && (
        <aside
          onClick={(e) => e.stopPropagation()}
          className="tv-scroll absolute inset-y-0 right-0 z-20 w-80 overflow-y-auto border-l border-white/10 bg-neutral-950/95 p-3 backdrop-blur-xl"
        >
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Liste des chaînes</p>
          <div className="space-y-1">
            {titles.map((name, i) => (
              <button
                key={`${urls[i]}-${i}`}
                type="button"
                onClick={() => { switchChannel(i); setDrawerOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition ${
                  i === index ? 'bg-primary text-white font-semibold' : 'text-neutral-200 hover:bg-white/10'
                }`}
              >
                {zap?.numbers?.[i] && <span className="w-8 shrink-0 font-mono text-xs opacity-75">{zap.numbers[i]}</span>}
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
    </DesktopPlayerSurface>
  );
}

function DesktopVodCinemaView({ session }: { session: DesktopVodSession }) {
  const zap = session.zap;
  const urls = zap?.urls?.length ? zap.urls : [session.url];
  const titles = zap?.titles?.length === urls.length ? zap.titles : [session.title];
  const ids = zap?.ids?.length === urls.length ? zap.ids : [session.mediaId];
  const initialIndex = zap && zap.index >= 0 && zap.index < urls.length ? zap.index : 0;

  const [epIndex, setEpIndex] = useState(initialIndex);
  const [seekOffsetSec, setSeekOffsetSec] = useState(Math.max(0, Math.floor((session.startPositionMs || 0) / 1000)));
  const [restartVersion, setRestartVersion] = useState(0);
  const [currentPosSec, setCurrentPosSec] = useState(Math.max(0, (session.startPositionMs || 0) / 1000));
  const [probedDurationSec, setProbedDurationSec] = useState(session.durationHintSec || 0);
  const [videoDurationSec, setVideoDurationSec] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [subVisible, setSubVisible] = useState(true);
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
  const [audioTracks, setAudioTracks] = useState<{ id: number; label: string }[]>([]);
  const [audioTrack, setAudioTrack] = useState(0);
  const [subtitleTracks, setSubtitleTracks] = useState<{ id: number; label: string }[]>([]);
  const [subtitleTrack, setSubtitleTrack] = useState(session.subtitle ? -2 : -1);
  const [subtitleSource, setSubtitleSource] = useState(session.subtitle);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaHandleRef = useRef<AttachedMediaHandle | null>(null);
  const playedTotalsRef = useRef(new Map<string, number>());
  const progressMapRef = useRef<Map<string, { mediaId: string; positionMs: number; durationMs: number; completed?: boolean; playedMs: number }>>(new Map());

  const activeUrl = urls[epIndex] || session.url;
  const activeTitle = titles[epIndex] || session.title;
  const activeMediaId = ids[epIndex] || session.mediaId;
  const isTransmuxed = Boolean(session.localUri ? needsFfmpegTransmux(session.localUri) : needsFfmpegTransmux(activeUrl));

  const { visible: hudVisible, reveal } = useAutoHideHud(!paused);

  const effectiveDurationSec = useMemo(() => {
    if (probedDurationSec > 0) return probedDurationSec;
    if (Number.isFinite(videoDurationSec) && videoDurationSec > 0) {
      return videoDurationSec;
    }
    return 0;
  }, [probedDurationSec, videoDurationSec]);

  const snapshotCurrentProgress = useCallback(() => {
    const posMs = Math.max(0, Math.round((mediaHandleRef.current?.getCurrentTime() ?? currentPosSec) * 1000));
    const durMs = effectiveDurationSec > 0 ? Math.max(posMs, Math.round(effectiveDurationSec * 1000)) : 0;
    const completed = durMs > 0 && posMs / durMs >= 0.9;
    const playedMs = (playedTotalsRef.current.get(activeMediaId) || 0) + (mediaHandleRef.current?.getPlayedMs() || 0);
    progressMapRef.current.set(activeMediaId, { mediaId: activeMediaId, positionMs: posMs, durationMs: durMs, completed, playedMs });
  }, [activeMediaId, currentPosSec, effectiveDurationSec]);

  useEffect(() => {
    const video = videoRef.current;
    return video ? attachUsageMeter(video, 'vod') : undefined;
  }, []);

  // Sonde ffprobe pour durée exacte (utile sur MKV/TS transmuxés)
  useEffect(() => {
    const src = session.localUri || activeUrl;
    let cancelled = false;
    setProbedDurationSec(epIndex === initialIndex ? session.durationHintSec || 0 : 0);
    void probeMediaDurationAndCodecs(src).then((info) => {
      if (!cancelled && info.durationSec > 0) setProbedDurationSec(info.durationSec);
    });
    return () => { cancelled = true; };
  }, [activeUrl, session.localUri, epIndex, initialIndex, session.durationHintSec]);

  // Chargement sous-titres (SRT/VTT distant ou local)
  useEffect(() => {
    let cancelled = false;
    setCues([]);
    const loadSubs = async () => {
      try {
        if (subtitleSource?.content) {
          const parsed = parseSrt(subtitleSource.content);
          if (!cancelled) setCues(parsed);
        } else if (subtitleSource?.url) {
          let txt = '';
          if (subtitleSource.url.startsWith('/api/desktop/subtitle')) {
            const res = await fetch(subtitleSource.url);
            if (res.ok) txt = await res.text();
          } else {
            txt = await downloadSubtitleText(subtitleSource.url);
          }
          if (!cancelled && txt) setCues(parseSrt(txt));
        }
      } catch {
        /* sous-titres facultatifs */
      }
    };
    void loadSubs();
    return () => { cancelled = true; };
  }, [subtitleSource]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setStatus('loading');
    setPaused(false);
    setCurrentPosSec(seekOffsetSec);
    setVideoDurationSec(0);
    setAudioTracks([]);
    setAudioTrack(0);
    setSubtitleTracks([]);
    setSubtitleTrack(epIndex === initialIndex && session.subtitle ? -2 : -1);
    setSubtitleSource(epIndex === initialIndex ? session.subtitle : undefined);
    setSubVisible(true);
    const handle = attachDesktopMediaStream(video, activeUrl, {
      live: false,
      muted,
      startSec: seekOffsetSec,
      localUri: epIndex === initialIndex ? session.localUri : undefined,
      forceTransmux: isTransmuxed,
      onStatus: setStatus,
      onAudioTracks: setAudioTracks,
      onSubtitleTracks: setSubtitleTracks,
    });
    mediaHandleRef.current = handle;
    const playedTotals = playedTotalsRef.current;
    return () => {
      handle.destroy();
      playedTotals.set(activeMediaId, (playedTotals.get(activeMediaId) || 0) + handle.getPlayedMs());
      mediaHandleRef.current = null;
    };
  }, [activeUrl, epIndex, restartVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
    video.playbackRate = rate;
  }, [muted, volume, rate]);

  const seekTo = useCallback((targetSec: number) => {
    const clamped = Math.max(0, effectiveDurationSec > 0 ? Math.min(effectiveDurationSec - 1, targetSec) : targetSec);
    const video = videoRef.current;
    if (!video) return;
    mediaHandleRef.current?.seekTo(clamped);
    setCurrentPosSec(mediaHandleRef.current?.getCurrentTime() ?? clamped);
  }, [effectiveDurationSec]);

  const finishAndClose = useCallback(() => {
    snapshotCurrentProgress();
    const list = [...progressMapRef.current.values()];
    const main = progressMapRef.current.get(activeMediaId) ?? {
      mediaId: activeMediaId,
      positionMs: Math.round(currentPosSec * 1000),
      durationMs: Math.round(effectiveDurationSec * 1000),
    };
    closeDesktopVodSession({
      ...main,
      progress: list,
    });
  }, [snapshotCurrentProgress, activeMediaId, currentPosSec, effectiveDurationSec]);

  const goEpisode = useCallback((nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= urls.length) return;
    snapshotCurrentProgress();
    const startMs = zap?.episodeStartPositions?.[nextIdx] || 0;
    setEpIndex(nextIdx);
    setSeekOffsetSec(Math.floor(startMs / 1000));
    setRestartVersion((v) => v + 1);
  }, [urls.length, snapshotCurrentProgress, zap?.episodeStartPositions]);

  const keyActionsRef = useRef({ reveal, finishAndClose, seekTo, currentPosSec });
  keyActionsRef.current = { reveal, finishAndClose, seekTo, currentPosSec };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { reveal: showHud, finishAndClose: closeVod, seekTo: seek, currentPosSec: pos } = keyActionsRef.current;
      showHud();
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        closeVod();
      } else if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) { void v.play(); setPaused(false); } else { v.pause(); setPaused(true); }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(pos - 10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(pos + 10);
      } else if (e.key.toLowerCase() === 'm') {
        setMuted((m) => !m);
      } else if (e.key.toLowerCase() === 's') {
        setSubVisible((s) => !s);
      } else if (e.key === 'F11' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleDesktopFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentPosMs = currentPosSec * 1000;
  const activeCue = subVisible ? cues.find((c) => c.startMs <= currentPosMs && currentPosMs <= c.endMs) : undefined;
  const hasNextEp = epIndex + 1 < urls.length;
  const timelineMax = Math.max(effectiveDurationSec, currentPosSec + 1, 1);

  return (
    <DesktopPlayerSurface
      data-desktop-cinema-player="vod"
      title={`Lecture : ${activeTitle}`}
      aria-label={`Lecture : ${activeTitle}`}
      className="fixed inset-0 z-40 select-none bg-black text-white"
      onMouseMove={reveal}
      onClick={reveal}
      onDoubleClick={toggleDesktopFullscreen}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onTimeUpdate={() => setCurrentPosSec(mediaHandleRef.current?.getCurrentTime() || 0)}
        onDurationChange={() => setVideoDurationSec(mediaHandleRef.current?.getDuration() || 0)}
        onEnded={() => {
          if (hasNextEp) goEpisode(epIndex + 1);
          else finishAndClose();
        }}
        className="h-full w-full object-contain"
      />

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}

      {status === 'error' && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-black/75 p-6">
          <div className="space-y-4 rounded-2xl border border-white/15 bg-neutral-950 p-6 text-center">
            <p>Impossible de lire cette vidéo</p>
            <button type="button" onClick={() => { setSeekOffsetSec(currentPosSec); setRestartVersion((version) => version + 1); }} className="rounded-xl bg-primary px-4 py-2">Réessayer</button>
            <button type="button" onClick={finishAndClose} className="ml-2 rounded-xl bg-white/10 px-4 py-2">Retour</button>
          </div>
        </div>
      )}

      {activeCue && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-8">
          <span className="max-w-3xl whitespace-pre-line rounded-xl bg-black/80 px-4 py-2 text-center text-lg font-medium leading-snug text-white shadow-lg">
            {activeCue.text}
          </span>
        </div>
      )}

      <header
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 top-0 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-6 py-5 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={finishAndClose}
            aria-label="Quitter la lecture"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="truncate text-lg font-bold">{activeTitle}</h1>
        </div>
        {hasNextEp && (
          <button
            type="button"
            onClick={() => goEpisode(epIndex + 1)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-primary"
          >
            <SkipForward className="h-4 w-4" /> Épisode suivant
          </button>
        )}
      </header>

      <footer
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-6 pb-5 pt-12 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="w-16 font-mono text-xs tabular-nums text-neutral-300">{formatDurationSeconds(currentPosSec)}</span>
          <input
            type="range"
            aria-label="Position dans la vidéo"
            min={0}
            max={timelineMax}
            step={1}
            value={Math.min(timelineMax, currentPosSec)}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="w-16 text-right font-mono text-xs tabular-nums text-neutral-300">
            {effectiveDurationSec > 0 ? formatDurationSeconds(effectiveDurationSec) : '--:--'}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Reculer de 10 secondes"
              onClick={() => seekTo(currentPosSec - 10)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={paused ? 'Lire' : 'Pause'}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) { void v.play(); setPaused(false); } else { v.pause(); setPaused(true); }
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white hover:bg-primary/90"
            >
              {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </button>
            <button
              type="button"
              aria-label="Avancer de 10 secondes"
              onClick={() => seekTo(currentPosSec + 10)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Arrêter"
              onClick={finishAndClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {audioTracks.length > 1 && (
              <select aria-label="Piste audio" value={audioTrack} onChange={(event) => {
                const id = Number(event.target.value);
                mediaHandleRef.current?.setAudioTrack?.(id);
                setAudioTrack(id);
              }} className="rounded-xl bg-neutral-900 px-2.5 py-1.5 text-xs">
                {audioTracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
              </select>
            )}
            {(subtitleTracks.length > 0 || (epIndex === initialIndex && session.subtitle)) && (
              <select aria-label="Piste de sous-titres" value={subtitleTrack} onChange={(event) => {
                const id = Number(event.target.value);
                const url = mediaHandleRef.current?.setSubtitleTrack(id);
                setSubtitleTrack(id);
                setSubtitleSource(id === -2 ? session.subtitle : url ? { url } : undefined);
                setSubVisible(id !== -1);
              }} className="rounded-xl bg-neutral-900 px-2.5 py-1.5 text-xs">
                <option value={-1}>Sans sous-titres</option>
                {epIndex === initialIndex && session.subtitle && <option value={-2}>Sous-titres externes</option>}
                {subtitleTracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
              </select>
            )}
            {cues.length > 0 && (
              <button
                type="button"
                onClick={() => setSubVisible((s) => !s)}
                className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs ${
                  subVisible ? 'bg-primary text-white' : 'bg-white/10 text-neutral-300'
                }`}
              >
                <Subtitles className="h-4 w-4" /> Sous-titres
              </button>
            )}
            <button
              type="button"
              onClick={() => setRate((r) => (r === 1 ? 1.25 : r === 1.25 ? 1.5 : r === 1.5 ? 2 : 1))}
              className="rounded-xl bg-white/10 px-2.5 py-1.5 font-mono text-xs hover:bg-white/20"
            >
              {rate}×
            </button>
            <button
              type="button"
              aria-label={muted ? 'Activer le son' : 'Couper le son'}
              onClick={() => setMuted((m) => !m)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const val = Number(e.target.value);
                setVolume(val);
                if (val > 0 && muted) setMuted(false);
              }}
              className="w-24 accent-primary"
            />
            <button
              type="button"
              aria-label="Plein écran"
              onClick={toggleDesktopFullscreen}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </footer>
    </DesktopPlayerSurface>
  );
}

export function DesktopCinemaPlayer() {
  const [liveSession, setLiveSession] = useState<DesktopLiveSession | null>(null);
  const [vodSession, setVodSession] = useState<DesktopVodSession | null>(null);
  const [activeRecordings, setActiveRecordings] = useState<ActiveDvrRecording[]>([]);

  useEffect(() => subscribeDesktopUi((snap) => {
    setLiveSession(snap.liveSession);
    setVodSession(snap.vodSession);
    setActiveRecordings(snap.activeRecordings);
  }), []);

  if (liveSession) return <DesktopLiveCinemaView session={liveSession} activeRecordings={activeRecordings} />;
  if (vodSession) return <DesktopVodCinemaView session={vodSession} />;
  return null;
}
