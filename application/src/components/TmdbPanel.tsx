import { useEffect, useMemo, useState } from 'react';
import {
  fetchDiscover, fetchTmdbDetails, pickBestMatch, searchTmdb, tmdbImageUrl, TmdbAuthenticationError,
  type TmdbDetails, type TmdbKind, type TmdbSimilar,
} from '@/utils/tmdb';
import { WatchProviders } from '@/components/WatchProviders';
import { normalizeForCompare, normalizeTitle } from '@/utils/titleNormalize';
import { watchRegionPhrase } from '@/data/watchRegions';
import type { CatalogItem } from '@/utils/xtreamCatalog';

interface TmdbPanelProps {
  name: string;
  year: string;
  kind: 'movie' | 'series';
  apiKey: string | undefined;
  tmdbId?: number | undefined;
  catalogItems: CatalogItem[];
  onOpenItem: (item: CatalogItem) => void;
  /** Pays des offres légales (code à deux lettres). */
  region: string;
  /** Fournisseurs TMDB retenus comme abonnements, pour la rangée « chez moi ». */
  providerIds: number[];
  /**
   * Identité stable de la fiche hôte (identifiant catalogue) : un titre ouvert
   * depuis une rangée est oublié dès que la fiche change de film.
   */
  sheetKey?: string | undefined;
  /**
   * Titre TMDB (absent de la playlist) actuellement affiché à la place de la
   * fiche hôte, ou `null` quand on la voit. La fiche hôte masque alors ses
   * blocs fournisseur pour ne pas attribuer à B le synopsis et la lecture de A.
   */
  onActiveChange?: ((active: { filmKey: string; title: string; year: string } | null) => void) | undefined;
  /**
   * Ce que le fournisseur IPTV donne déjà dans la fiche (souvent repris de TMDB/IMDb) :
   * ces éléments ne sont alors pas répétés ici, TMDB ne sert que de repli.
   */
  provided?: { overview?: boolean; director?: boolean; cast?: boolean } | undefined;
}

const formatRevenue = (revenue: number): string =>
  revenue >= 1_000_000 ? `≈ ${Math.round(revenue / 1_000_000)} M$` : `${revenue.toLocaleString('fr-FR')} $`;

const formatRuntime = (minutes: number): string =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;

function ReviewItem({ author, content, createdAt, rating }: { author: string; content: string; createdAt: string; rating?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white/5 rounded-lg p-3 space-y-1">
      <p className="text-xs text-neutral-400">
        {author}
        {rating ? ` · ${rating}/10` : ''}
        {createdAt ? ` · ${createdAt}` : ''}
      </p>
      <p className={`text-sm text-neutral-200 whitespace-pre-line ${expanded ? '' : 'line-clamp-4'}`}>{content}</p>
      {content.length > 220 && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Moins' : 'Lire plus'}
        </button>
      )}
    </div>
  );
}

/** Synopsis replié à 5 lignes sur les textes longs, pour garder Sous-titres et Regarder à portée. */
function Overview({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 280;
  return (
    <div className="space-y-1">
      <p className={`text-sm text-neutral-200 whitespace-pre-line break-words ${long && !expanded ? 'line-clamp-5' : ''}`}>{text}</p>
      {long && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Moins' : 'Lire la suite'}
        </button>
      )}
    </div>
  );
}

interface TitleRailProps {
  heading: string;
  hint?: string;
  note?: string;
  items: TmdbSimilar[];
  onPick: (item: TmdbSimilar) => void;
  /** Vrai quand le titre est déjà dans une liste chargée (ouverture directe). */
  isLocal: (item: TmdbSimilar) => boolean;
}

/** Rangée de vignettes défilante, commune aux recommandations et aux abonnements. */
function TitleRail({ heading, hint, note, items, onPick, isLocal }: TitleRailProps) {
  return (
    <div className="space-y-2 min-w-0">
      <p className="text-sm font-medium text-white">
        {heading}
        {hint && <span className="ml-2 text-xs font-normal text-neutral-500">{hint}</span>}
      </p>
      {/* Rangée défilante qui va jusqu'aux bords de la fiche : la carte coupée à droite signale la suite. */}
      <div className="rail -mx-4 px-4 sm:-mx-6 sm:px-6 scroll-px-4 sm:scroll-px-6 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const local = isLocal(item);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              className="w-24 shrink-0 snap-start text-left rounded-md overflow-hidden bg-white/5 border border-neutral-800 hover:border-primary focus-visible:outline-none focus-visible:ring-2 ring-primary"
              title={item.releaseDate ? `${item.title} (${item.releaseDate.slice(0, 4)})` : item.title}
            >
              <div className="aspect-[2/3] bg-neutral-900 flex items-center justify-center">
                {item.posterPath ? (
                  <img src={tmdbImageUrl(item.posterPath)} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl" aria-hidden="true">🎬</span>
                )}
              </div>
              <div className="p-1.5">
                <p className="text-[10px] leading-tight line-clamp-2">{item.title}</p>
                {local
                  ? <p className="text-[9px] text-emerald-400">Dans ta playlist</p>
                  : item.voteAverage > 0 && <p className="text-[10px] text-amber-300">★ {item.voteAverage.toFixed(1)}</p>}
              </div>
            </button>
          );
        })}
      </div>
      {note && <p className="text-[10px] text-neutral-500">{note}</p>}
    </div>
  );
}

/**
 * Fiche enrichie TMDB : synopsis français, casting, notes, revenu mondial,
 * films similaires, disponibilité légale dans le pays choisi et avis spectateurs.
 *
 * Un titre de recommandation s'ouvre ici même (identifiant TMDB connu) : plus
 * aucun clic ne renvoie vers le site themoviedb.org. S'il est déjà dans une
 * liste chargée, il s'ouvre directement dans le catalogue.
 */
export function TmdbPanel({
  name, year, kind, apiKey, catalogItems, onOpenItem, region, providerIds, tmdbId, sheetKey, onActiveChange, provided,
}: TmdbPanelProps) {
  const tmdbKind: TmdbKind = kind === 'movie' ? 'movie' : 'tv';
  const [details, setDetails] = useState<TmdbDetails | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'nokey' | 'error'>('loading');
  const [authError, setAuthError] = useState(false);
  const [discover, setDiscover] = useState<TmdbSimilar[]>([]);

  // Un titre ouvert depuis une rangée appartient à la fiche courante : changer de
  // film (identifiant catalogue ou, à défaut, identifiant/nom TMDB) invalide la
  // sélection sans effet de bord.
  const filmKey = sheetKey ?? `${kind}:${tmdbId ?? name}`;
  const [picked, setPicked] = useState<{ filmKey: string; id: number; title: string; year: string } | null>(null);
  const active = picked?.filmKey === filmKey ? picked : null;
  const activeId = active?.id ?? tmdbId;
  const activeName = active?.title ?? name;
  const activeYear = active?.year ?? year;
  const providerKey = providerIds.join(',');

  // La fiche hôte apprend quel titre est réellement affiché (B remplace A).
  useEffect(() => {
    onActiveChange?.(active ? { filmKey, title: active.title, year: active.year } : null);
  }, [active, filmKey, onActiveChange]);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setAuthError(false);
    if (!apiKey?.trim()) { setState('nokey'); return; }
    setState('loading');
    void (async () => {
      try {
        const normalized = normalizeTitle(activeName);
        const query = normalized.title || activeName;
        const releaseYear = activeYear || normalized.year;
        const results = activeId ? [] : await searchTmdb(query, releaseYear, tmdbKind, apiKey);
        const match = activeId ? { id: activeId } : pickBestMatch(query, results, releaseYear);
        if (cancelled) return;
        if (!match) { setState('notfound'); return; }
        const detail = await fetchTmdbDetails(match.id, tmdbKind, apiKey);
        if (!cancelled) { setDetails(detail); setState('ready'); }
      } catch (error) {
        if (!cancelled) { setAuthError(error instanceof TmdbAuthenticationError); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [activeName, activeYear, tmdbKind, apiKey, activeId]);

  // « Disponible sur mes abonnements » : un seul appel /discover filtré par pays.
  useEffect(() => {
    setDiscover([]);
    if (state !== 'ready' || !details || !apiKey?.trim() || !providerKey) return;
    let cancelled = false;
    void fetchDiscover(
      tmdbKind,
      { region, providerIds: providerKey.split(',').map(Number), genreIds: details.genreIds },
      apiKey,
    )
      .then((items) => { if (!cancelled) setDiscover(items); })
      .catch(() => { if (!cancelled) setDiscover([]); });
    return () => { cancelled = true; };
  }, [state, details, providerKey, region, tmdbKind, apiKey]);

  // Index des listes chargées : un titre déjà présent s'ouvre sans quitter la fiche.
  const catalogIndex = useMemo(() => {
    const byTmdbId = new Map<number, CatalogItem>();
    const byTitleYear = new Map<string, CatalogItem | null>();
    for (const item of catalogItems) {
      if (item.tmdbId && !byTmdbId.has(item.tmdbId)) byTmdbId.set(item.tmdbId, item);
      const normalized = normalizeTitle(item.name);
      const key = `${normalizeForCompare(normalized.title)}|${normalized.year}`;
      byTitleYear.set(key, byTitleYear.has(key) ? null : item);
    }
    return { byTmdbId, byTitleYear };
  }, [catalogItems]);

  const localItemFor = (item: TmdbSimilar): CatalogItem | null => {
    const direct = catalogIndex.byTmdbId.get(item.id);
    if (direct) return direct;
    const normalized = normalizeTitle(item.title);
    return catalogIndex.byTitleYear.get(`${normalizeForCompare(normalized.title)}|${item.releaseDate.slice(0, 4)}`) ?? null;
  };

  const openTitle = (item: TmdbSimilar) => {
    const local = localItemFor(item);
    if (local) { onOpenItem(local); return; }
    setPicked({ filmKey, id: item.id, title: item.title, year: item.releaseDate.slice(0, 4) });
  };

  const isLocal = (item: TmdbSimilar) => localItemFor(item) !== null;

  // La fiche du fournisseur décrit le film de départ, pas celui ouvert depuis une rangée.
  const effectiveProvided = active ? undefined : provided;
  // Ni le fournisseur ni TMDB n'ont de synopsis (TMDB sans texte, titre introuvable ou en échec).
  const noOverviewAnywhere = !!effectiveProvided && !effectiveProvided.overview && (
    (state === 'ready' && !details?.overview) || state === 'notfound' || state === 'error'
  );
  const missingOverview = noOverviewAnywhere && <p className="text-sm text-neutral-300">Synopsis non fourni.</p>;

  return (
    <div className="border-t border-neutral-900 pt-3 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Fiche TMDB</p>
        {active && (
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="text-xs text-primary hover:underline"
          >
            ← Revenir à {name}
          </button>
        )}
      </div>
      {state === 'nokey' && (
        <p className="text-xs text-neutral-400">
          Ajoute ta clé ou ton jeton TMDB gratuit dans les paramètres pour enrichir la fiche : synopsis français, casting, notes,
          avis spectateurs et films similaires.
        </p>
      )}
      {state === 'loading' && <p role="status" className="text-xs text-neutral-400">Enrichissement de la fiche…</p>}
      {state === 'notfound' && <p className="text-xs text-neutral-400">Titre introuvable sur TMDB.</p>}
      {state === 'error' && <p role="status" className="text-xs text-neutral-400">{authError ? 'Clé ou jeton TMDB refusé. Vérifie la valeur dans Réglages › Films et séries.' : 'Fiche TMDB indisponible (réseau ou clé invalide).'}</p>}
      {state !== 'ready' && missingOverview}

      {state === 'ready' && details && (
        <>
          <div className="flex gap-3">
            {details.posterPath && (
              <img
                src={tmdbImageUrl(details.posterPath, 'w185')}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-20 shrink-0 rounded-md object-cover bg-neutral-900"
              />
            )}
            <div className="space-y-1 text-sm text-neutral-300 min-w-0">
              <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-neutral-400">
                {details.releaseDate && <span>{new Date(details.releaseDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
                {details.runtime !== null && <span>{formatRuntime(details.runtime)}</span>}
                {details.genres.length > 0 && <span>{details.genres.slice(0, 3).join(', ')}</span>}
              </p>
              <p>
                <span className="text-amber-300">★ {details.voteAverage.toFixed(1)}/10</span>
                <span className="text-neutral-500"> ({details.voteCount.toLocaleString('fr-FR')} votes)</span>
              </p>
              {details.revenue > 0 && <p>Revenu mondial : {formatRevenue(details.revenue)}</p>}
              {details.director && !effectiveProvided?.director && <p>Réalisation : {details.director}</p>}
              {details.cast.length > 0 && !effectiveProvided?.cast && <p>Avec : {details.cast.map((c) => c.name).join(', ')}</p>}
            </div>
          </div>
          {details.overview && !effectiveProvided?.overview && <Overview text={details.overview} />}
          {missingOverview}

          <WatchProviders tmdbId={details.id} kind={kind} title={details.title || activeName} apiKey={apiKey} region={region} />

          {discover.length > 0 && (
            <TitleRail
              heading={`Sur mes abonnements ${watchRegionPhrase(region)}`}
              hint={`${discover.length} · faire défiler →`}
              items={discover}
              onPick={openTitle}
              isLocal={isLocal}
              note="Titres disponibles en abonnement dans ce pays chez les plateformes cochées dans Réglages › Films et séries."
            />
          )}

          {details.similar.length > 0 && (
            <TitleRail
              heading={kind === 'movie' ? 'Films similaires' : 'Séries similaires'}
              hint={`${details.similar.length} · faire défiler →`}
              items={details.similar}
              onPick={openTitle}
              isLocal={isLocal}
              note="Clic : ouvre le titre dans le catalogue s'il est présent, sinon sa fiche ici."
            />
          )}

          {details.reviews.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-white">Avis spectateurs</p>
              {details.reviews.slice(0, 3).map((r, i) => (
                <ReviewItem key={i} author={r.author} content={r.content} createdAt={r.createdAt} {...(r.rating !== undefined ? { rating: r.rating } : {})} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
