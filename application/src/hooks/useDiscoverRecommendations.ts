import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaylistInfo } from '@/types/channel';
import { getExternalWatches, type PlayHistoryEntry } from '@/utils/idb';
import type { AdultVodFilter } from '@/hooks/useAdultVodCategories';
import { getXtreamAccount } from '@/utils/xtreamCatalog';
import {
  feedHomeRecommendations,
  historySignature,
  shouldRefreshRecommendations,
  type VodKind,
} from '@/utils/discoverRecommendations';

const KINDS: VodKind[] = ['movie', 'series'];

export function useDiscoverRecommendations(
  playlist: PlaylistInfo,
  history: PlayHistoryEntry[],
  adult: AdultVodFilter,
  enabled: boolean,
  externalWatchesProp?: PlayHistoryEntry[],
  tmdbApiKey?: string | null,
) {
  const account = useMemo(() => getXtreamAccount(playlist), [playlist]);
  const lastSignaturesRef = useRef<Record<string, Partial<Record<VodKind, string>>>>({});
  const [internalExternalWatches, setInternalExternalWatches] = useState<PlayHistoryEntry[]>([]);

  useEffect(() => {
    if (externalWatchesProp !== undefined) return;
    let cancelled = false;
    const load = () => {
      void getExternalWatches().then(watches => {
        if (!cancelled) setInternalExternalWatches(watches);
      }).catch(() => {});
    };
    load();
    window.addEventListener('external-watches-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('external-watches-updated', load);
    };
  }, [externalWatchesProp]);

  const externalWatches = externalWatchesProp ?? internalExternalWatches;

  useEffect(() => {
    if (!enabled || !account) return;

    const controller = new AbortController();
    const playlistSigs = lastSignaturesRef.current[playlist.id] ?? {};
    lastSignaturesRef.current[playlist.id] = playlistSigs;

    void (async () => {
      for (const kind of KINDS) {
        if (controller.signal.aborted) return;
        const currentSig = historySignature(history, playlist.id, kind, externalWatches);
        if (shouldRefreshRecommendations(playlist.id, kind, history, playlistSigs[kind], externalWatches)) {
          const success = await feedHomeRecommendations({
            account,
            playlist,
            kind,
            history,
            externalWatches,
            adult,
            ...(tmdbApiKey ? { tmdbApiKey } : {}),
            signal: controller.signal,
          });
          if (success && !controller.signal.aborted) {
            playlistSigs[kind] = currentSig;
          }
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [enabled, account, playlist, history, externalWatches, adult, tmdbApiKey]);
}
