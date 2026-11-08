import { lazy } from 'react';

/**
 * Écrans et dialogues secondaires chargés à la demande : le paquet principal reste
 * léger au démarrage (l'ouverture charge la liste active, le reste arrive en arrière-plan
 * ou à l'usage). Chaque composant est rendu sous un <Suspense> avec un repli statique.
 */
export const LazyChannelList = lazy(() => import('@/components/ChannelList').then(m => ({ default: m.ChannelList })));
export const LazyTvLiveScreen = lazy(() => import('@/components/TvLiveScreen').then(m => ({ default: m.TvLiveScreen })));
export const LazyEPGGrid = lazy(() => import('@/components/EPGGrid').then(m => ({ default: m.EPGGrid })));
export const LazyVideoPlayer = lazy(() => import('@/components/VideoPlayer').then(m => ({ default: m.VideoPlayer })));
export const LazyVodLibrary = lazy(() => import('@/components/VodLibrary').then(m => ({ default: m.VodLibrary })));
export const LazyMoviesPanel = lazy(() => import('@/components/MoviesPanel').then(m => ({ default: m.MoviesPanel })));
export const LazyContinuePanel = lazy(() => import('@/components/ContinuePanel').then(m => ({ default: m.ContinuePanel })));
export const LazyPodcastsPanel = lazy(() => import('@/components/PodcastsPanel').then(m => ({ default: m.PodcastsPanel })));
export const LazyReplayHub = lazy(() => import('@/components/ReplayHub').then(m => ({ default: m.ReplayHub })));
export const LazyRecordings = lazy(() => import('@/components/Recordings').then(m => ({ default: m.Recordings })));
export const LazySettingsPanel = lazy(() => import('@/components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
export const LazyGlobalSearchDialog = lazy(() => import('@/components/GlobalSearchDialog').then(m => ({ default: m.GlobalSearchDialog })));
export const LazyXtreamLoginDialog = lazy(() => import('@/components/XtreamLoginDialog').then(m => ({ default: m.XtreamLoginDialog })));
export const LazyStalkerLoginDialog = lazy(() => import('@/components/StalkerLoginDialog').then(m => ({ default: m.StalkerLoginDialog })));
export const LazyChannelHealthDialog = lazy(() => import('@/components/ChannelHealthDialog').then(m => ({ default: m.ChannelHealthDialog })));
export const LazyPlaylistManager = lazy(() => import('@/components/PlaylistManager').then(m => ({ default: m.PlaylistManager })));
export const LazyPlaylistLoader = lazy(() => import('@/components/PlaylistLoader').then(m => ({ default: m.PlaylistLoader })));
export const LazyBackupPanel = lazy(() => import('@/components/BackupPanel').then(m => ({ default: m.BackupPanel })));

/** Repli stable pendant le chargement d'un écran : aucune cible de focus, hauteur approximative. */
export function PanelFallback({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-[20px] border border-neutral-900 bg-neutral-950 ${className}`} />;
}
