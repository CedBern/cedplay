import { useCallback, useEffect, useRef, useState } from 'react';
import { EPGData } from '@/types/epg';
import { PlaylistInfo } from '@/types/channel';
import { AppSettings } from '@/utils/storage';
import { fetchEPGSource, fetchSecondaryEPGSources, getParsedEPGCache, getSecondaryEPGUrls, saveParsedEPGCache, type EPGSource } from '@/utils/epg';
import { parseEPGInWorker } from '@/utils/epgWorker';
import { EPG_CONFIG_EVENT, epgConfigSignature, getEpgConfig } from '@/utils/epgConfig';

export interface EPGState {
  data: EPGData | undefined;
  status: 'loading' | 'ready' | 'absent' | 'error' | 'stale';
  fetchedAt?: number;
  /** Nombre de sources de guide lues (principale et complémentaires). */
  sourceCount?: number;
}

/** Empreinte de la liste de chaînes : un guide analysé pour une autre liste n'est pas réutilisé. */
const channelsSignature = (playlist: PlaylistInfo) =>
  `${playlist.channels.length}:${playlist.channels[0]?.id ?? ''}:${playlist.channels[playlist.channels.length - 1]?.id ?? ''}`;

export function useEPG(playlist: PlaylistInfo | null, settings: AppSettings): EPGState & { retry: () => void } {
  const [state, setState] = useState<EPGState>({ data: undefined, status: 'loading' });
  const [revision, setRevision] = useState(0);
  const force = useRef(false);
  const retry = useCallback(() => { force.current = true; setRevision(r => r + 1); }, []);
  // Réglages du guide modifiés (sources, associations, décalage) : nouvelle analyse sans retéléchargement.
  const playlistId = playlist?.id;
  useEffect(() => {
    const onConfig = (event: Event) => {
      const detail = (event as CustomEvent<{ playlistId?: string }>).detail;
      if (!detail?.playlistId || detail.playlistId === playlistId) setRevision(r => r + 1);
    };
    window.addEventListener(EPG_CONFIG_EVENT, onConfig);
    return () => window.removeEventListener(EPG_CONFIG_EVENT, onConfig);
  }, [playlistId]);
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
        let primaryError: unknown = null;
        const [config, primary] = await Promise.all([
          getEpgConfig(playlist.id),
          fetchEPGSource(playlist, settings, forced).catch((e: unknown) => { primaryError = e; return null; }),
        ]);
        if (cancelled) return;
        const secondaryUrls = getSecondaryEPGUrls(playlist, settings, config.extraUrls);
        const secondary = secondaryUrls.length ? await fetchSecondaryEPGSources(playlist.id, secondaryUrls, forced) : [];
        if (cancelled) return;
        const sources = [primary, ...secondary].filter((s): s is EPGSource => !!s);
        if (!sources.length) {
          if (primaryError || secondaryUrls.length) throw primaryError ?? new Error('Guide indisponible.');
          setState({ data: {}, status: 'absent' });
          return;
        }
        const fetchedAt = Math.max(...sources.map(s => s.fetchedAt));
        const stale = sources.some(s => s.stale) || !!primaryError;
        const status = stale ? 'stale' : 'ready';
        // Une seule source sans réglage : clé historique (adresse + date), sinon empreinte complète.
        const simple = sources.length === 1 && !Object.keys(config.channels).length && !config.offsetHours;
        const cacheUrl = simple
          ? sources[0].url
          : `${sources.map(s => `${s.url}@${s.fetchedAt}`).join('|')}#${epgConfigSignature(config)}#${channelsSignature(playlist)}`;
        // Cache chaud : données déjà parsées pour ces mêmes sources → zéro parse.
        const cachedParsed = await getParsedEPGCache(playlist.id, cacheUrl, fetchedAt);
        if (cancelled) return;
        if (cachedParsed) {
          setState({ data: cachedParsed, status, fetchedAt, sourceCount: sources.length });
          return;
        }
        // Parse hors du thread principal (worker, repli transparent).
        const data = await parseEPGInWorker(sources.map(s => s.xml), playlist.channels, { overrides: config.channels, offsetHours: config.offsetHours });
        if (cancelled) return;
        setState({ data, status, fetchedAt, sourceCount: sources.length });
        void saveParsedEPGCache(playlist.id, cacheUrl, fetchedAt, data);
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
