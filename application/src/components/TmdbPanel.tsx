import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { fetchTmdbDetails, pickBestMatch, searchTmdb, tmdbImageUrl, tmdbPageUrl, TmdbAuthenticationError, type TmdbDetails, type TmdbKind } from '@/utils/tmdb';
import { normalizeForCompare, normalizeTitle } from '@/utils/titleNormalize';
import type { CatalogItem } from '@/utils/xtreamCatalog';

interface TmdbPanelProps {
  name: string;
  year: string;
  kind: 'movie' | 'series';
  apiKey: string | undefined;
  tmdbId?: number | undefined;
  catalogItems: CatalogItem[];
  onOpenItem: (item: CatalogItem) => void;
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

/** Fiche enrichie TMDB : synopsis français, casting, notes, revenu mondial, films similaires et avis spectateurs. */
export function TmdbPanel({ name, year, kind, apiKey, catalogItems, onOpenItem, tmdbId }: TmdbPanelProps) {
  const tmdbKind: TmdbKind = kind === 'movie' ? 'movie' : 'tv';
  const [details, setDetails] = useState<TmdbDetails | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'nokey' | 'error'>('loading');
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setAuthError(false);
    if (!apiKey?.trim()) { setState('nokey'); return; }
    setState('loading');
    void (async () => {
      try {
        const normalized = normalizeTitle(name);
        const query = normalized.title || name;
        const releaseYear = year || normalized.year;
        const results = tmdbId ? [] : await searchTmdb(query, releaseYear, tmdbKind, apiKey);
        const match = tmdbId ? { id: tmdbId } : pickBestMatch(query, results, releaseYear);
        if (cancelled) return;
        if (!match) { setState('notfound'); return; }
        const detail = await fetchTmdbDetails(match.id, tmdbKind, apiKey);
        if (!cancelled) { setDetails(detail); setState('ready'); }
      } catch (error) {
        if (!cancelled) { setAuthError(error instanceof TmdbAuthenticationError); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [name, year, tmdbKind, apiKey, tmdbId]);

  const openSimilar = (similarTitle: string, tmdbId: number, releaseDate: string) => {
    const query = normalizeForCompare(normalizeTitle(similarTitle).title);
    const candidates = catalogItems.filter(item => item.tmdbId === tmdbId || (
      normalizeForCompare(normalizeTitle(item.name).title) === query &&
      !!releaseDate && normalizeTitle(item.name).year === releaseDate.slice(0, 4)
    ));
    if (candidates.length === 1) onOpenItem(candidates[0]);
    else window.open(tmdbPageUrl(tmdbKind, tmdbId), '_blank', 'noopener');
  };

  return (
    <div className="border-t border-neutral-900 pt-3 space-y-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">Fiche TMDB</p>
      {state === 'nokey' && (
        <p className="text-xs text-neutral-400">
          Ajoute ta clé ou ton jeton TMDB gratuit dans les paramètres pour enrichir la fiche : synopsis français, casting, notes,
          avis spectateurs et films similaires.
        </p>
      )}
      {state === 'loading' && <p role="status" className="text-xs text-neutral-400">Enrichissement de la fiche…</p>}
      {state === 'notfound' && <p className="text-xs text-neutral-400">Titre introuvable sur TMDB.</p>}
      {state === 'error' && <p role="status" className="text-xs text-neutral-400">{authError ? 'Clé ou jeton TMDB refusé. Vérifie la valeur dans Réglages › Films et séries.' : 'Fiche TMDB indisponible (réseau ou clé invalide).'}</p>}

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
              {details.director && <p>Réalisation : {details.director}</p>}
              {details.cast.length > 0 && <p>Avec : {details.cast.map((c) => c.name).join(', ')}</p>}
            </div>
          </div>
          {details.overview && <p className="text-sm text-neutral-200 whitespace-pre-line">{details.overview}</p>}

          {details.similar.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-white">Films similaires</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {details.similar.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSimilar(s.title, s.id, s.releaseDate)}
                    className="w-24 shrink-0 text-left rounded-md overflow-hidden bg-white/5 border border-neutral-800 hover:border-primary"
                    title={s.releaseDate ? `${s.title} (${s.releaseDate.slice(0, 4)})` : s.title}
                  >
                    <div className="aspect-[2/3] bg-neutral-900 flex items-center justify-center">
                      {s.posterPath ? (
                        <img src={tmdbImageUrl(s.posterPath)} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl" aria-hidden="true">🎬</span>
                      )}
                    </div>
                    <div className="p-1.5">
                      <p className="text-[10px] leading-tight line-clamp-2">{s.title}</p>
                      {s.voteAverage > 0 && <p className="text-[10px] text-amber-300">★ {s.voteAverage.toFixed(1)}</p>}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-neutral-500 flex items-center gap-1">
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Clic : ouvre dans le catalogue si présent, sinon la page TMDB.
              </p>
            </div>
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
