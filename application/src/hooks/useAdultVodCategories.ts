import { useEffect, useMemo, useState } from 'react';
import type { PlaylistInfo } from '@/types/channel';
import { ensureAdultVodCategoryIds, hasKnownAdultVodCategories, knownAdultVodCategoryIds, vodAccountOf, type VodKind } from '@/utils/parentalVod';

const KINDS: VodKind[] = ['movie', 'series'];

export interface AdultVodFilter {
  /** true quand chaque type est tranché : verrouillé (ids connus) ou sans compte Xtream. */
  ready: boolean;
  /**
   * Verdict pour un titre du catalogue. Fermé par défaut : tant que les catégories
   * d'un type ne sont pas connues, ses titres sont considérés adultes — un catalogue
   * qu'on ne sait pas trier ne doit pas laisser passer de contenu verrouillé.
   */
  isAdult: (kind: VodKind, categoryId?: string | null) => boolean;
}

/**
 * Verdict « catégorie adulte » pour les titres Xtream quand le contrôle parental est actif.
 * Les catégories ne sont demandées qu'une fois par liste et par type (registre de session).
 */
export function useAdultVodCategories(playlist: PlaylistInfo | null, enabled: boolean): AdultVodFilter {
  const account = useMemo(() => vodAccountOf(playlist), [playlist]);
  const [ids, setIds] = useState<Record<VodKind, Set<string> | null> | null>(null);

  useEffect(() => {
    if (!enabled || !playlist || !account) { setIds(null); return; }
    if (KINDS.every(kind => hasKnownAdultVodCategories(playlist.id, kind))) {
      setIds({ movie: knownAdultVodCategoryIds(playlist.id, 'movie'), series: knownAdultVodCategoryIds(playlist.id, 'series') });
      return;
    }
    const controller = new AbortController();
    setIds(null);
    void Promise.allSettled(KINDS.map(async kind => {
      const known = await ensureAdultVodCategoryIds(playlist, kind, account, controller.signal);
      return [kind, known] as const;
    })).then(results => {
      if (controller.signal.aborted) return;
      const next: Record<VodKind, Set<string> | null> = { movie: null, series: null };
      for (const result of results) {
        if (result.status === 'fulfilled') next[result.value[0]] = result.value[1];
      }
      setIds(next);
    });
    return () => controller.abort();
  }, [enabled, playlist, account]);

  return useMemo<AdultVodFilter>(() => ({
    ready: !enabled || !playlist || !account || (ids !== null && KINDS.every(kind => ids[kind] !== null)),
    isAdult: (kind, categoryId) => {
      // Sans contrôle parental actif ou sans catalogue Xtream, il n'y a rien à verrouiller.
      if (!enabled || !playlist || !account) return false;
      if (!ids) return true;
      const known = ids[kind];
      if (!known) return true;
      return !!categoryId && known.has(categoryId);
    },
  }), [enabled, playlist, account, ids]);
}
