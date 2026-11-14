import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  emitDesktopPreviewState,
  subscribeDesktopUi,
  type DesktopPreviewOverlay,
} from '@/utils/desktopBridge';
import { attachDesktopMediaStream } from '@/utils/desktopMediaAttach';

export function DesktopLivePreview() {
  const [preview, setPreview] = useState<DesktopPreviewOverlay | null>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => subscribeDesktopUi((snap) => setPreview(snap.preview)), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!preview || !video) {
      setPlaying(false);
      return;
    }
    setPlaying(false);
    const handle = attachDesktopMediaStream(video, preview.url, {
      live: true,
      muted,
      onStatus(status) {
        if (status === 'playing') setPlaying(true);
        emitDesktopPreviewState(status);
      },
    });
    return () => {
      handle.destroy();
    };
  }, [preview?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  if (!preview || preview.rect.width <= 0 || preview.rect.height <= 0) return null;

  return (
    <div
      data-desktop-live-preview
      style={{
        position: 'fixed',
        left: preview.rect.x,
        top: preview.rect.y,
        width: preview.rect.width,
        height: preview.rect.height,
        borderRadius: 12,
        zIndex: 18,
      }}
      className={`overflow-hidden pointer-events-none transition-opacity duration-200 ${playing ? 'opacity-100 bg-black' : 'opacity-0'}`}
    >
      <video
        ref={videoRef}
        autoPlay
        muted={muted}
        playsInline
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 via-black/25 to-transparent px-2.5 py-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
          En direct
        </span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? 'Activer le son de l’aperçu' : 'Couper le son de l’aperçu'}
          className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white transition hover:bg-primary"
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
