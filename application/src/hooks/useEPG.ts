import { useCallback, useEffect, useRef, useState } from 'react';
import { EPGData } from '@/types/epg';
import { PlaylistInfo } from '@/types/channel';
import { AppSettings } from '@/utils/storage';
import { fetchEPGSource, getParsedEPGCache, saveParsedEPGCache } from '@/utils/epg';
import { parseEPGInWorker } from '@/utils/epgWorker';

export interface EPGState {
  data: EPGData | undefined;
  status: 'loading' | 'ready' | 'absent' | 'error' | 'stale';
  fetchedAt?: number;
}

export function useEPG(playlist: PlaylistInfo | null, settings: AppSettings): EPGState & { retry: () => void } {
  const [state, setState] = useState<EPGState>({ data: undefined, status: 'loading' });
  const [revision, setRevision] = useState(0);
  const force = useRef(false);
  const retry = useCallback(() => { force.current = true; setRevision(r => r + 1); }, []);
  useEffect(() => {
    let cancelled = false;
    const forced = force.current;
    force.current = false;
    if (!playlist) { setState({ data: {}, status: 'absent' }); return; }
    // Rafraîchissement silencieux : on garde la grille affichée si elle est prête.
    const keepPrevious = (prev: EPGState) => (prev.status === 'ready' || prev.status === 'stale');
    setState(prev => (keepPrevious(prev) ? prev : { data: undefined, status: 'loading' }));
    void (async () => {
      try {
        const source = await fetchEPGSource(playlist, settings, forced);
        if (cancelled) return;
        if (!source) { setState({ data: {}, status: 'absent' }); return; }
        // Cache chaud : données déjà parsées pour cette même source → zéro parse.
        const cachedParsed = await getParsedEPGCache(playlist.id, source.url, source.fetchedAt);
        if (cancelled) return;
        if (cachedParsed) {
          setState({ data: cachedParsed, status: source.stale ? 'stale' : 'ready', fetchedAt: source.fetchedAt });
          return;
        }
        // Parse hors du thread principal (worker, repli transparent).
        const data = await parseEPGInWorker(source.xml, playlist.channels);
        if (cancelled) return;
        setState({ data, status: source.stale ? 'stale' : 'ready', fetchedAt: source.fetchedAt });
        void saveParsedEPGCache(playlist.id, source.url, source.fetchedAt, data);
      } catch {
        if (!cancelled) setState(prev => ((prev.status === 'ready' || prev.status === 'stale') ? prev : { data: {}, status: 'error' }));
      }
    })();
    return () => { cancelled = true; };
  }, [playlist, settings.epgUrl, revision]);
  useEffect(() => {
    const timer = window.setInterval(retry, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [retry]);
  return { ...state, retry };
}
