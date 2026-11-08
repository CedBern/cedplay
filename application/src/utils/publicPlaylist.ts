import { parseM3UInWorker } from '@/utils/parseWorker';
import type { PlaylistInfo } from '@/types/channel';

export const PUBLIC_PLAYLIST_ID = 'cedplay-public-v1';
export const PUBLIC_PLAYLIST_INITIALIZED = 'publicPlaylistInitialized';

/** Sélection embarquée : aucun téléchargement de catalogue distant au premier lancement. */
export async function loadPublicPlaylist(onProgress: (percent: number) => void = () => {}): Promise<PlaylistInfo> {
  const response = await fetch(`${import.meta.env.BASE_URL}chaines-gratuites.m3u`);
  if (!response.ok) throw new Error('Impossible de charger les chaînes gratuites.');
  const content = await response.text();
  if (!content.trimStart().startsWith('#EXTM3U') || !content.includes('#EXTINF:')) {
    throw new Error('La sélection de chaînes gratuites est vide ou invalide.');
  }
  const playlist = await parseM3UInWorker(content, 'Chaînes gratuites', onProgress);
  if (!playlist.channels.length) throw new Error('Aucune chaîne gratuite disponible.');
  return { ...playlist, id: PUBLIC_PLAYLIST_ID };
}
