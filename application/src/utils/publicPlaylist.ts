import { parseM3UInWorker } from '@/utils/parseWorker';
import type { Channel, PlaylistInfo } from '@/types/channel';

export const PUBLIC_PLAYLIST_ID = 'cedplay-public-v1';
export const PUBLIC_PLAYLIST_INITIALIZED = 'publicPlaylistInitialized';

export function isLegacyPublicPlaylist(playlist: PlaylistInfo): boolean {
  return !playlist.url && playlist.name === 'Flux publics légaux' &&
    (playlist.totalChannelsBeforeDedup === 2465 || playlist.channels.length === 1988);
}

/** Nomme le catalogue gratuit sans renommer les listes personnelles. */
export function playlistDisplayName(playlist: PlaylistInfo): string {
  if (playlist.id === PUBLIC_PLAYLIST_ID || isLegacyPublicPlaylist(playlist)) return 'Chaînes gratuites';
  return playlist.name;
}

/** Le catalogue gratuit a un id stable ; une correction d'adresse conserve les favoris. */
export function reconcilePublicPlaylist(previous: PlaylistInfo, incoming: PlaylistInfo): PlaylistInfo {
  const byTvg = new Map(previous.channels.filter(c => c.tvgId).map(c => [c.tvgId, c]));
  const mapped = new Map<string, Channel>(incoming.channels.map(c => {
    const old = c.tvgId ? byTvg.get(c.tvgId) : undefined;
    return [c.id, old ? { ...c, id: old.id, isFavorite: old.isFavorite ?? false } : c];
  }));
  return { ...incoming, name: previous.name, channels: incoming.channels.map(c => mapped.get(c.id)!),
    groups: incoming.groups.map(g => ({ ...g, channels: g.channels.map(c => mapped.get(c.id)!) })),
    ...(previous.userAgent ? { userAgent: previous.userAgent } : {}) };
}

/** Sélection embarquée : aucun téléchargement de catalogue distant au premier lancement. */
export async function loadPublicPlaylist(onProgress: (percent: number) => void = () => {}): Promise<PlaylistInfo> {
  const response = await fetch(`${import.meta.env.BASE_URL}flux-legaux.m3u`);
  if (!response.ok) throw new Error('Impossible de charger les chaînes gratuites.');
  const content = await response.text();
  if (!content.trimStart().startsWith('#EXTM3U') || !content.includes('#EXTINF:')) {
    throw new Error('La sélection de chaînes gratuites est vide ou invalide.');
  }
  const playlist = await parseM3UInWorker(content, 'Chaînes gratuites', onProgress);
  if (!playlist.channels.length) throw new Error('Aucune chaîne gratuite disponible.');
  return { ...playlist, id: PUBLIC_PLAYLIST_ID };
}
