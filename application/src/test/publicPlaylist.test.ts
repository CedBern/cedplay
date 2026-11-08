import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { M3UParser } from '@/utils/m3uParser';
import { loadPublicPlaylist, isLegacyPublicPlaylist, playlistDisplayName, reconcilePublicPlaylist, PUBLIC_PLAYLIST_ID } from '@/utils/publicPlaylist';

it('affiche le grand catalogue comme Chaînes gratuites sans renommer les listes privées', () => {
  const base = { id: 'old', name: 'Flux publics légaux', channels: [], groups: [], totalChannelsBeforeDedup: 2465 };
  expect(isLegacyPublicPlaylist(base)).toBe(true);
  expect(playlistDisplayName(base)).toBe('Chaînes gratuites');
  expect(playlistDisplayName({ ...base, id: PUBLIC_PLAYLIST_ID, name: 'Chaînes gratuites' })).toBe('Chaînes gratuites');
  expect(playlistDisplayName({ ...base, name: 'Ma liste' })).toBe('Ma liste');
  expect(isLegacyPublicPlaylist({ ...base, totalChannelsBeforeDedup: 20 })).toBe(false);
});

it('le bouton gratuit charge le grand catalogue embarqué et non une petite sélection', async () => {
  const content = readFileSync('public/flux-legaux.m3u', 'utf8');
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => content }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const playlist = await loadPublicPlaylist();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/flux-legaux\.m3u$/));
    expect(playlist.id).toBe(PUBLIC_PLAYLIST_ID);
    expect(playlist.channels).toHaveLength(1988);
  } finally { vi.unstubAllGlobals(); }
});

it('une adresse officielle corrigée conserve l’identité et les favoris de la chaîne', () => {
  const old = { id: 'ancien', name: 'TV UNAM', tvgId: 'TVUNAM.mx', url: 'https://example.test/old?DVR', isFavorite: true };
  const fresh = { ...old, id: 'nouveau', url: 'https://example.test/live', isFavorite: false };
  const previous = { id: PUBLIC_PLAYLIST_ID, name: 'Mon catalogue officiel', channels: [old], groups: [{ name: 'Mexique', channels: [old] }] };
  const incoming = { ...previous, name: 'Chaînes gratuites', channels: [fresh], groups: [{ name: 'Mexique', channels: [fresh] }] };
  const merged = reconcilePublicPlaylist(previous, incoming);
  expect(merged.channels[0]).toMatchObject({ id: 'ancien', url: fresh.url, isFavorite: true });
  expect(merged.groups[0].channels[0]).toBe(merged.channels[0]);
  expect(previous.channels[0].url).toBe(old.url);
});

it('importe le catalogue public embarqué complet dans les deux chemins du parseur', async () => {
  const content = readFileSync('public/flux-legaux.m3u', 'utf8');
  const sync = M3UParser.parseM3U(content, 'Public');
  const workerPath = await M3UParser.parseM3UWithProgress(content, 'Public');
  expect(sync.totalChannelsBeforeDedup).toBe(2465);
  expect(sync.channels).toHaveLength(1988);
  expect(workerPath.channels).toEqual(sync.channels);
  expect(sync.groups).toHaveLength(8);
  expect(new Set(sync.channels.map(c => c.id)).size).toBe(1988);
});
