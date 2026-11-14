import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Volume2, VolumeX, X } from 'lucide-react';
import {
  closeDesktopMosaicSession,
  subscribeDesktopUi,
  toggleDesktopFullscreen,
  type DesktopMosaicSession,
} from '@/utils/desktopBridge';
import { attachDesktopMediaStream } from '@/utils/desktopMediaAttach';
import { DesktopPlayerSurface } from '@/components/DesktopPlayerSurface';

function MosaicTile({
  stream,
  index,
  audioActive,
  zoomed,
  onSelectAudio,
  onToggleZoom,
}: {
  stream: { url: string; title: string };
  index: number;
  audioActive: boolean;
  zoomed: boolean;
  onSelectAudio: () => void;
  onToggleZoom: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handle = attachDesktopMediaStream(video, stream.url, {
      live: true,
      muted: !audioActive,
      onStatus: setStatus,
    });
    return () => handle.destroy();
  }, [stream.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !audioActive;
  }, [audioActive]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelectAudio}
      onDoubleClick={onToggleZoom}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectAudio(); }
      }}
      className={`group relative overflow-hidden rounded-xl bg-black transition ${
        audioActive ? 'ring-2 ring-primary shadow-[0_0_24px_rgba(255,90,54,0.35)]' : 'ring-1 ring-white/15 hover:ring-white/40'
      }`}
    >
      <video ref={videoRef} autoPlay playsInline muted={!audioActive} className="h-full w-full object-contain bg-black" />
      {status !== 'playing' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-neutral-300">
          {status === 'error' ? 'Flux indisponible' : 'Connexion…'}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-white">
          <span className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px]">{index + 1}</span>
          <span className="truncate">{stream.title}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`rounded-full p-1 ${audioActive ? 'bg-primary text-white' : 'bg-black/60 text-neutral-300'}`}>
            {audioActive ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </span>
          <button
            type="button"
            aria-label={zoomed ? `Réduire ${stream.title}` : `Agrandir ${stream.title}`}
            onClick={(e) => { e.stopPropagation(); onToggleZoom(); }}
            className="rounded-full bg-black/60 p-1 text-neutral-200 hover:bg-white/20"
          >
            {zoomed ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DesktopMosaicPlayer() {
  const [session, setSession] = useState<DesktopMosaicSession | null>(null);
  const [audioIndex, setAudioIndex] = useState(0);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);

  useEffect(() => subscribeDesktopUi((snap) => {
    setSession(snap.mosaicSession);
    if (!snap.mosaicSession) {
      setAudioIndex(0);
      setZoomIndex(null);
    }
  }), []);

  useEffect(() => {
    if (!session) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        if (zoomIndex !== null) setZoomIndex(null);
        else closeDesktopMosaicSession();
      } else if (e.key === 'F11' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleDesktopFullscreen();
      } else if (/^[1-8]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < session.streams.length) setAudioIndex(idx);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, zoomIndex]);

  if (!session) return null;

  const count = session.streams.length;
  const gridClass = zoomIndex !== null
    ? 'grid-cols-1 grid-rows-1'
    : count <= 2
      ? 'grid-cols-2 grid-rows-1'
      : count <= 4
        ? 'grid-cols-2 grid-rows-2'
        : count <= 6
          ? 'grid-cols-3 grid-rows-2'
          : 'grid-cols-4 grid-rows-2';

  const visibleStreams = zoomIndex !== null && session.streams[zoomIndex]
    ? [{ stream: session.streams[zoomIndex], originalIndex: zoomIndex }]
    : session.streams.map((stream, originalIndex) => ({ stream, originalIndex }));

  return (
    <DesktopPlayerSurface
      data-desktop-mosaic-player
      title="Mosaïque en direct"
      aria-label="Mosaïque en direct"
      className="fixed inset-0 z-40 flex flex-col bg-[#060606] text-white"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-black/80 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">Mosaïque</span>
          <span className="text-sm text-neutral-300">{count} flux · Touches 1–{count} pour le son · Double-clic pour agrandir</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleDesktopFullscreen}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
          >
            <Maximize2 className="h-3.5 w-3.5" /> Plein écran
          </button>
          <button
            type="button"
            onClick={() => closeDesktopMosaicSession()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600/80 px-3 py-1.5 text-xs font-medium hover:bg-red-600"
          >
            <X className="h-3.5 w-3.5" /> Quitter
          </button>
        </div>
      </header>
      <div className={`grid flex-1 min-h-0 gap-2 p-2 ${gridClass}`}>
        {visibleStreams.map(({ stream, originalIndex }) => (
          <MosaicTile
            key={`${stream.url}-${originalIndex}`}
            stream={stream}
            index={originalIndex}
            audioActive={audioIndex === originalIndex}
            zoomed={zoomIndex === originalIndex}
            onSelectAudio={() => setAudioIndex(originalIndex)}
            onToggleZoom={() => setZoomIndex((z) => (z === originalIndex ? null : originalIndex))}
          />
        ))}
      </div>
    </DesktopPlayerSurface>
  );
}
