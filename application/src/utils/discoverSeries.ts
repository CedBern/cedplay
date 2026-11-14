import { historyScope, type PlayHistoryEntry } from '@/utils/idb';
import type { Episode } from '@/utils/xtreamCatalog';

/** Pas de date de publication fiable chez tous les fournisseurs : on annonce un
 * épisode suivant disponible, jamais une nouveauté supposée. */
export function followedSeries(history: PlayHistoryEntry[], playlistId: string): PlayHistoryEntry[] {
  const entries = history.map(historyScope).filter(e => e.playlistId === playlistId && e.kind === 'vod' && e.mediaKind === 'series' && e.seriesId);
  const seen = new Set<string>();
  return [...entries].sort((a, b) => b.ts - a.ts).filter(entry => {
    if (seen.has(entry.seriesId!)) return false;
    seen.add(entry.seriesId!);
    return entry.status === 'completed' && !entry.hiddenFromContinue && !!entry.name;
  }).slice(0, 4);
}

export function nextSeriesEpisode(seed: PlayHistoryEntry, episodes: Episode[], history: PlayHistoryEntry[]): Episode | undefined {
  const ordered = [...episodes].filter(e => Number(e.season) > 0 && e.number > 0)
    .sort((a, b) => Number(a.season) - Number(b.season) || a.number - b.number);
  const index = ordered.findIndex(e => e.id === seed.channelId.split(':').at(-1));
  if (index < 0) return undefined;
  const known = history.map(historyScope).filter(e => e.playlistId === seed.playlistId && e.mediaKind === 'series');
  for (const episode of ordered.slice(index + 1)) {
    const watched = known.find(e => e.channelId.split(':').at(-1) === episode.id);
    if (watched?.status === 'completed') continue;
    // Ne pas sauter un épisode en cours, retiré ou sans format pour proposer le suivant.
    if (!episode.extension || watched?.hiddenFromContinue || (watched?.positionMs ?? 0) > 0) return undefined;
    return episode;
  }
  return undefined;
}
