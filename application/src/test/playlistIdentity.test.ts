import { expect, it } from 'vitest';
import { M3UParser } from '@/utils/m3uParser';
import { findExistingPlaylist, reconcilePlaylist } from '@/utils/playlistIdentity';

const m3u = '#EXTM3U\n#EXTINF:-1 tvg-id="alpha" group-title="Test",Alpha\nhttps://example.test/a';

it('préserve favoris, dernière chaîne et variante lors du rafraîchissement après renommage', () => {
  const previous = M3UParser.parseM3U(m3u, 'Ancien fichier.m3u');
  const fresh = M3UParser.parseM3U(m3u, 'Liste — example.test');
  expect(previous.channels[0].id).not.toBe(fresh.channels[0].id);
  previous.channels[0].isFavorite = true;
  previous.channels[0].variants = [{ id: 'ancienne-variante', name: 'Alpha HD', url: 'https://example.test/hd' }];
  fresh.channels[0].variants = [{ id: 'nouvelle-variante', name: 'Alpha HD', url: 'https://example.test/hd' }];
  const updated = reconcilePlaylist(previous, fresh);
  expect(updated.id).toBe(previous.id);
  expect(updated.channels[0].id).toBe(previous.channels[0].id);
  expect(updated.channels[0].isFavorite).toBe(true);
  expect(updated.channels[0].variants?.[0].id).toBe('ancienne-variante');
  expect(updated.groups[0].channels[0]).toBe(updated.channels[0]);
});

it('ne remplace pas un fichier différent portant le même nom', () => {
  const previous = M3UParser.parseM3U(m3u, 'playlist.m3u');
  const incoming = M3UParser.parseM3U(m3u.replace('/a', '/b'), 'playlist.m3u');
  expect(findExistingPlaylist([previous], incoming)).toBeUndefined();
  expect(findExistingPlaylist([previous], M3UParser.parseM3U(m3u, 'autre nom'))?.id).toBe(previous.id);
  previous.url = 'https://example.test/source'; incoming.url = previous.url;
  expect(findExistingPlaylist([previous], incoming)?.id).toBe(previous.id);
});
