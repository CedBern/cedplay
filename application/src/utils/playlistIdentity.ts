import type { Channel, PlaylistInfo } from '@/types/channel';

function flatten(channels: Channel[]): Channel[] {
  return channels.flatMap(c => [c, ...flatten(c.variants || [])]);
}

/** Un nom de fichier n'identifie pas sa source. Sans URL, seul un contenu identique est un réimport. */
export function findExistingPlaylist(saved: PlaylistInfo[], incoming: PlaylistInfo): PlaylistInfo | undefined {
  if (incoming.url) return saved.find(p => p.url === incoming.url);
  const urls = flatten(incoming.channels).map(c => c.url).sort();
  return saved.find(p => !p.url && urls.length > 0 && (() => {
    const previous = flatten(p.channels).map(c => c.url).sort();
    return previous.length === urls.length && previous.every((url, i) => url === urls[i]);
  })());
}

/** Conserve les identifiants déjà référencés par favoris, variantes et dernière chaîne. */
export function reconcilePlaylist(previous: PlaylistInfo, incoming: PlaylistInfo): PlaylistInfo {
  const byUrl = new Map<string, Channel[]>();
  for (const channel of flatten(previous.channels)) {
    const values = byUrl.get(channel.url) || [];
    values.push(channel); byUrl.set(channel.url, values);
  }
  const remapped = new Map<string, Channel>();
  const reconcile = (channel: Channel): Channel => {
    const candidates = byUrl.get(channel.url) || [];
    const old = candidates.find(c => c.tvgId === channel.tvgId && c.name === channel.name) || (candidates.length === 1 ? candidates[0] : undefined);
    const updated = { ...channel, ...(old ? { id: old.id, isFavorite: old.isFavorite || false } : {}),
      ...(channel.variants ? { variants: channel.variants.map(reconcile) } : {}) };
    remapped.set(channel.id, updated);
    return updated;
  };
  const channels = incoming.channels.map(reconcile);
  return { ...incoming, id: previous.id, name: previous.name, channels,
    ...(previous.userAgent ? { userAgent: previous.userAgent } : {}),
    groups: incoming.groups.map(g => ({ ...g, channels: g.channels.map(c => remapped.get(c.id) || c) })) };
}
