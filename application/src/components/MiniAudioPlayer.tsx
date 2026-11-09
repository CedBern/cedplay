import { useEffect, useState } from 'react';
import { Headphones, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react';
import type { AudioPlaybackState } from '@/types/podcast';
import { AudioBridge } from '@/utils/nativePlayer';
import { formatAudioTime, formatEpisodeLength } from '@/utils/podcastFormat';

const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2] as const;

export interface MiniAudioPlayerProps {
  tv?: boolean;
  showPaused?: boolean;
  onOpenPodcasts?: () => void;
}

export function MiniAudioPlayer({ tv = false, showPaused = true, onOpenPodcasts }: MiniAudioPlayerProps) {
  const [state, setState] = useState<AudioPlaybackState>(() => AudioBridge.getState());

  useEffect(() => {
    return AudioBridge.subscribe(setState);
  }, []);

  if (!state.active || !state.episodeId || (!showPaused && !state.playing)) return null;

  const percent = state.durationMs > 0
    ? Math.min(100, Math.max(0, Math.round((state.positionMs / state.durationMs) * 100)))
    : 0;
  const remaining = state.durationMs > 0
    ? `Reste ${formatEpisodeLength(Math.max(0, state.durationMs - state.positionMs))}`
    : '';

  const cycleSpeed = () => {
    const idx = SPEEDS.findIndex(s => Math.abs(s - state.speed) < 0.03);
    const next = SPEEDS[(idx + 1) % SPEEDS.length] ?? 1;
    void AudioBridge.setSpeed(next);
  };

  return (
    <aside
      aria-label="Mini-lecteur audio"
      data-mini-audio-player
      data-tv-mode={tv ? 'true' : 'false'}
      className={
        tv
          ? 'glass fixed inset-x-4 bottom-3 z-40 mx-auto max-w-4xl overflow-hidden rounded-2xl border border-white/10 shadow-2xl'
          : 'glass fixed inset-x-2 bottom-[calc(68px+env(safe-area-inset-bottom))] sm:bottom-3 z-40 mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/10 shadow-2xl'
      }
    >
      {state.durationMs > 0 && (
        <div
          role="progressbar"
          aria-label="Progression de l’épisode en cours"
          aria-valuetext={`${formatAudioTime(state.positionMs)} sur ${formatAudioTime(state.durationMs)}`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 w-full bg-neutral-800"
        >
          <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
      )}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <button
          type="button"
          onClick={onOpenPodcasts}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg p-1"
          title="Ouvrir l’espace Écouter"
        >
          {/* Téléphone : la place va au titre, la pochette n'apparaît qu'à partir de sm (et sur TV). */}
          {state.artworkUrl ? (
            <img
              src={state.artworkUrl}
              alt=""
              referrerPolicy="no-referrer"
              className={`${tv ? 'block' : 'hidden sm:block'} h-10 w-10 shrink-0 rounded-lg object-cover bg-neutral-800`}
            />
          ) : (
            <span className={`${tv ? 'flex' : 'hidden sm:flex'} h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary`}>
              <Headphones className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          {/* Titre, puis émission · temps restant. Le reste ne se coupe jamais : c'est le
              nom de l'émission qui cède la place. Durée audio restante, indépendante de la
              vitesse — la même que dans la liste des épisodes et sur l'Accueil. */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-white">
              {state.title}
            </span>
            {(state.podcastTitle || remaining) && (
              <span className="flex min-w-0 gap-1 text-[11px] text-neutral-400">
                {state.podcastTitle && <span className="truncate">{state.podcastTitle}</span>}
                {state.podcastTitle && remaining && <span aria-hidden="true">·</span>}
                {remaining && <span className="shrink-0">{remaining}</span>}
              </span>
            )}
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => void AudioBridge.seekBy(-15_000)}
            aria-label="Reculer de 15 secondes"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void AudioBridge.togglePlayPause()}
            aria-label={state.playing ? 'Pause audio' : 'Reprendre audio'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {state.playing ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void AudioBridge.seekBy(30_000)}
            aria-label="Avancer de 30 secondes"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={`Vitesse de lecture ${state.speed}x`}
            className="min-h-8 rounded-full border border-neutral-700 bg-neutral-900 px-2 text-[11px] font-mono font-medium text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {state.speed}×
          </button>
          <button
            type="button"
            onClick={() => void AudioBridge.stop()}
            aria-label="Fermer le lecteur audio"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
