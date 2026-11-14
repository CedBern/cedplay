import { useEffect, useMemo, useState } from 'react';
import type { PlaylistInfo } from '@/types/channel';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { AdultVodFilter } from '@/hooks/useAdultVodCategories';
import { followedSeries, nextSeriesEpisode } from '@/utils/discoverSeries';
import { catalogRequest, getXtreamAccount, parseDetails, type Episode } from '@/utils/xtreamCatalog';

export interface DiscoverSeriesItem { seed: PlayHistoryEntry; episode: Episode }

export function useDiscoverSeries(playlist: PlaylistInfo, history: PlayHistoryEntry[], adult: AdultVodFilter, enabled: boolean) {
  const account = useMemo(() => getXtreamAccount(playlist), [playlist]);
  const seeds = useMemo(() => followedSeries(history, playlist.id).filter(e => !adult.isAdult('series', e.categoryId)), [history, playlist.id, adult]);
  const [result, setResult] = useState<{ seeds: PlayHistoryEntry[]; items: DiscoverSeriesItem[] } | null>(null);
  useEffect(() => {
    if (!enabled || !account || !seeds.length) return;
    const controller = new AbortController();
    // Quatre séries au maximum, une requête à la fois ; jamais de catalogue complet.
    void (async () => {
      const items: DiscoverSeriesItem[] = [];
      for (const seed of seeds) {
        if (controller.signal.aborted) return;
        try {
          const details = parseDetails(await catalogRequest(account, 'get_series_info', { series_id: seed.seriesId! }, controller.signal));
          const episode = nextSeriesEpisode(seed, details.episodes, history);
          if (episode) items.push({ seed, episode });
        } catch { /* Une série indisponible ne bloque pas les autres. */ }
      }
      if (!controller.signal.aborted) setResult({ seeds, items });
    })();
    return () => controller.abort();
  }, [enabled, account, seeds, history]);
  // Pas d'ancien résultat pendant un changement de playlist, de filtre ou de verrouillage.
  return enabled && account && result?.seeds === seeds ? result.items : [];
}
