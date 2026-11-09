import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getMeta, setMeta } from '@/utils/idb';
import { normalizeForCompare } from '@/utils/titleNormalize';
import { memoFetch } from '@/utils/memoFetch';
import { parseWatchAvailability, type WatchAvailability } from '@/utils/watchAvailability';

export type TmdbKind = 'movie' | 'tv';

export interface TmdbSearchResult {
  id: number;
  title: string;
  releaseDate: string;
  posterPath: string | null;
  voteAverage: number;
  voteCount: number;
}

export interface TmdbReview {
  author: string;
  content: string;
  createdAt: string;
  rating?: number;
}

export interface TmdbSimilar {
  id: number;
  title: string;
  releaseDate: string;
  posterPath: string | null;
  voteAverage: number;
}

export interface TmdbDetails {
  id: number;
  /** Namespace film/série : films et séries partagent l'espace d'identifiants TMDB. */
  kind?: TmdbKind;
  title: string;
  overview: string;
  releaseDate: string;
  runtime: number | null; // minutes
  genres: string[];
  voteAverage: number;
  voteCount: number;
  revenue: number;
  posterPath: string | null;
  director?: string;
  cast: { name: string; character?: string }[];
  similar: TmdbSimilar[];
  reviews: TmdbReview[];
}

const API = 'https://api.themoviedb.org/3';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const MAX_FETCH_MS = 30_000;

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function tmdbImageUrl(path: string | null, size = 'w200'): string {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

export function tmdbPageUrl(kind: TmdbKind, id: number): string {
  return `https://www.themoviedb.org/${kind}/${id}`;
}

export class TmdbAuthenticationError extends Error {
  constructor() {
    super('Clé ou jeton TMDB refusé. Vérifie la valeur dans Réglages › Films et séries.');
    this.name = 'TmdbAuthenticationError';
  }
}

async function tmdbGet(path: string, apiKey: string, signal?: AbortSignal): Promise<unknown> {
  const credential = apiKey.trim();
  // TMDB accepte la clé v3 en paramètre et le jeton de lecture (JWT) en en-tête.
  // Accepter aussi le préfixe « Bearer » s'il a été copié avec le jeton.
  const isToken = /^Bearer\s+/i.test(credential) || credential.includes('.');
  const headers: Record<string, string> = { 'User-Agent': 'LecteurIPTV/1.4' };
  if (isToken) headers.Authorization = `Bearer ${credential.replace(/^Bearer\s+/i, '')}`;
  const params = new URLSearchParams({ language: 'fr-FR' });
  if (!isToken) params.set('api_key', credential);
  const separator = path.includes('?') ? '&' : '?';
  const url = `${API}${path}${separator}${params}`;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      headers,
      responseType: 'json',
      connectTimeout: 10_000,
      readTimeout: MAX_FETCH_MS,
    });
    if (response.status === 401) throw new TmdbAuthenticationError();
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_FETCH_MS);
  try {
    const response = await fetch(url, { headers, signal: signal ?? controller.signal });
    if (response.status === 401) throw new TmdbAuthenticationError();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseSearchResults(data: unknown): TmdbSearchResult[] {
  const results = object(data).results;
  if (!Array.isArray(results)) return [];
  return results.map((raw) => {
    const v = object(raw);
    return {
      id: num(v.id),
      title: str(v.title || v.name),
      releaseDate: str(v.release_date || v.first_air_date),
      posterPath: typeof v.poster_path === 'string' ? v.poster_path : null,
      voteAverage: num(v.vote_average),
      voteCount: num(v.vote_count),
    };
  }).filter((r) => r.id > 0 && !!r.title);
}

function parseTmdbDetails(data: unknown): TmdbDetails {
  const root = object(data);
  const credits = object(root.credits);
  const crew = Array.isArray(credits.crew) ? credits.crew.map(object) : [];
  const castRaw = Array.isArray(credits.cast) ? credits.cast.map(object) : [];
  const reviews = Array.isArray(object(root.reviews).results) ? (object(root.reviews).results as unknown[]).map(object) : [];
  const similar = Array.isArray(object(root.recommendations).results) ? (object(root.recommendations).results as unknown[]).map(object) : [];
  const runtimeRaw = num(root.runtime) || (Array.isArray(root.episode_run_time) && (root.episode_run_time as unknown[]).length ? num((root.episode_run_time as unknown[])[0]) : 0);
  const genres = Array.isArray(root.genres) ? root.genres.map(object).map((g) => str(g.name)).filter(Boolean) : [];
  const director = crew.find((c) => str(c.job).toLowerCase() === 'director');
  return {
    id: num(root.id),
    title: str(root.title || root.name),
    overview: str(root.overview),
    releaseDate: str(root.release_date || root.first_air_date),
    runtime: runtimeRaw > 0 ? runtimeRaw : null,
    genres,
    voteAverage: num(root.vote_average),
    voteCount: num(root.vote_count),
    revenue: num(root.revenue),
    posterPath: typeof root.poster_path === 'string' ? root.poster_path : null,
    ...(director ? { director: str(director.name) } : {}),
    cast: castRaw.slice(0, 8).map((c) => ({ name: str(c.name), ...(str(c.character) ? { character: str(c.character) } : {}) })),
    similar: similar.slice(0, 10).map((v) => ({
      id: num(v.id),
      title: str(v.title || v.name),
      releaseDate: str(v.release_date || v.first_air_date),
      posterPath: typeof v.poster_path === 'string' ? v.poster_path : null,
      voteAverage: num(v.vote_average),
    })).filter((s) => s.id > 0 && !!s.title),
    reviews: reviews.slice(0, 6).map((r) => {
      const authorDetails = object(r.author_details);
      return {
        author: str(r.author) || 'Spectateur',
        content: str(r.content),
        createdAt: str(r.created_at).slice(0, 10),
        ...(num(authorDetails.rating) ? { rating: num(authorDetails.rating) } : {}),
      };
    }).filter((r) => !!r.content),
  };
}

/** Recherche d'un titre (films ou séries), avec cache 12 h et déduplication en vol. */
export async function searchTmdb(query: string, year: string, kind: TmdbKind, apiKey: string): Promise<TmdbSearchResult[]> {
  const cacheKey = `tmdb_search_${kind}_${normalizeForCompare(`${query} ${year}`)}`;
  return memoFetch(cacheKey, async () => {
    const cached = await getMeta<{ fetchedAt: number; results: TmdbSearchResult[] }>(cacheKey);
    if (cached?.results?.length && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.results;
    const params = new URLSearchParams({ query, ...(year ? { year } : {}) });
    const results = parseSearchResults(await tmdbGet(`/search/${kind}?${params}`, apiKey));
    await setMeta(cacheKey, { fetchedAt: Date.now(), results });
    return results;
  });
}

/** Fiche complète TMDB (casting, avis spectateurs, films similaires), avec cache 12 h et déduplication en vol. */
export async function fetchTmdbDetails(id: number, kind: TmdbKind, apiKey: string): Promise<TmdbDetails> {
  const cacheKey = `tmdb_${kind}_${id}`;
  return memoFetch(cacheKey, async () => {
    const cached = await getMeta<{ fetchedAt: number; details: TmdbDetails }>(cacheKey);
    if (cached?.details && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.details;
    const details = parseTmdbDetails(await tmdbGet(`/${kind}/${id}?append_to_response=credits,reviews,recommendations`, apiKey));
    await setMeta(cacheKey, { fetchedAt: Date.now(), details });
    return details;
  });
}

/**
 * Disponibilité légale du titre (France) : abonnement, gratuit, location, achat.
 * Même cache 12 h et même déduplication en vol que les autres appels TMDB.
 * `null` quand le pays n'a aucune offre répertoriée.
 */
export async function fetchWatchProviders(id: number, kind: TmdbKind, apiKey: string): Promise<WatchAvailability | null> {
  const cacheKey = `tmdb_providers_${kind}_${id}`;
  return memoFetch(cacheKey, async () => {
    const cached = await getMeta<{ fetchedAt: number; availability: WatchAvailability | null }>(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.availability;
    const availability = parseWatchAvailability(await tmdbGet(`/${kind}/${id}/watch/providers`, apiKey));
    await setMeta(cacheKey, { fetchedAt: Date.now(), availability });
    return availability;
  });
}

/** Égalité de titre uniquement ; les remakes sans année restent ambigus. */
export function pickBestMatch(queryTitle: string, results: TmdbSearchResult[], year = ''): TmdbSearchResult | null {
  const q = normalizeForCompare(queryTitle);
  if (!q) return null;
  const matches = results.filter(r => normalizeForCompare(r.title) === q && (!year || r.releaseDate.slice(0, 4) === year));
  const unique = [...new Map(matches.map(r => [r.id, r])).values()];
  return unique.length === 1 ? unique[0] : null;
}
