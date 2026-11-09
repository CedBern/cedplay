import { useCallback, useEffect, useRef, useState } from 'react';
import { EPGData } from '@/types/epg';
import { PlaylistInfo } from '@/types/channel';
import { AppSettings } from '@/utils/storage';
import { fetchEPGSource, fetchSecondaryEPGSources, getEPGUrl, getParsedEPGCache, getSecondaryEPGUrls, isEPGCacheFresh, peekParsedEPGCache, rememberParsedEPGMeta, saveParsedEPGCache, type EPGSource } from '@/utils/epg';
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
    const controller = new AbortController();
    const forced = force.current;
    force.current = false;
    if (!playlist) { setState({ data: {}, status: 'absent' }); return; }
    // Rafraîchissement silencieux : on garde la grille affichée si elle est prête.
    const keepPrevious = (prev: EPGState) => (prev.status === 'ready' || prev.status === 'stale');
    setState(prev => (keepPrevious(prev) ? prev : { data: undefined, status: 'loading' }));
    void (async () => {
      try {
        let primaryError: unknown = null;
        const config = await getEpgConfig(playlist.id);
        // Chemin chaud : l'analyse en cache suffit. Sans lui, il fallait relire les
        // 45 Mo de XML (2 s sur la box) uniquement pour calculer la clé du cache.
        const quickUrl = getEPGUrl(playlist, settings);
        const canPeek = !!quickUrl && !forced && !getSecondaryEPGUrls(playlist, settings, config.extraUrls).length
          && !Object.keys(config.channels).length && !config.offsetHours
          && await isEPGCacheFresh(playlist.id);
        if (canPeek) {
          const cached = await peekParsedEPGCache(playlist.id, quickUrl!);
          if (cancelled) return;
          if (cached) {
            setState({ data: cached.data, status: 'ready', fetchedAt: cached.fetchedAt, sourceCount: 1 });
            return;
          }
        }
        const primary = await fetchEPGSource(playlist, settings, forced).catch((e: unknown) => { primaryError = e; return null; });
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
          // Fiche d'index pour les prochains démarrages : le chemin chaud évite de relire le XML.
          void rememberParsedEPGMeta(playlist.id, cacheUrl, fetchedAt);
          setState({ data: cachedParsed, status, fetchedAt, sourceCount: sources.length });
          return;
        }
        // Parse hors du thread principal (worker, repli transparent).
        // Fenêtre gardée en mémoire : 8 jours passés (replay) et 10 à venir (séries, rappels).
        const now = Date.now();
        const options = {
          overrides: config.channels, offsetHours: config.offsetHours,
          keepFromMs: now - 8 * 86_400_000, keepUntilMs: now + 10 * 86_400_000,
        };
        // La source principale couvre presque toujours toutes les chaînes : analyser
        // les guides complémentaires « au cas où » doublait la mémoire des grosses box.
        // Ils ne sont parsés que pour les chaînes restées sans programme.
        const primaryData: EPGData = primary ? await parseEPGInWorker(primary.xml, playlist.channels, options, controller.signal) : {};
        if (cancelled) return;
        const missing = playlist.channels.filter(channel => !primaryData[channel.id]);
        const rest = sources.filter(source => source !== primary);
        const secondaryData: EPGData = missing.length && rest.length
          ? await parseEPGInWorker(rest.map(source => source.xml), missing, options, controller.signal)
          : {};
        if (cancelled) return;
        const data = secondaryData && Object.keys(secondaryData).length
          ? { ...primaryData, ...secondaryData }
          : primaryData;
        setState({ data, status, fetchedAt, sourceCount: sources.length });
        void saveParsedEPGCache(playlist.id, cacheUrl, fetchedAt, data);
      } catch {
        if (!cancelled) setState(prev => ((prev.status === 'ready' || prev.status === 'stale') ? prev : { data: {}, status: 'error' }));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [playlist, settings.epgUrl, revision]);
  useEffect(() => {
    const timer = window.setInterval(retry, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [retry]);
  return { ...state, retry };
}
