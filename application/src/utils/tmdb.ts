import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getMeta, setMeta } from '@/utils/idb';
import { normalizeForCompare } from '@/utils/titleNormalize';
import { memoFetch } from '@/utils/memoFetch';
import {
  DEFAULT_WATCH_REGION, parseWatchAvailability, type WatchAvailability,
} from '@/utils/watchAvailability';

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

/** Fournisseur de diffusion tel que TMDB le liste pour un pays donné. */
export interface TmdbProvider {
  providerId: number;
  name: string;
  logoPath: string | null;
  /** Priorité d'affichage dans le pays interrogé ; les autres pays sont écartés. */
  priority: number;
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
  /** Identifiants TMDB des genres (filtre /discover) ; absents des fiches mises en cache avant cette version. */
  genreIds?: number[];
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
const DISCOVER_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
const MAX_FETCH_MS = 30_000;

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function tmdbImageUrl(path: string | null, size = 'w200'): string {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
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

/** Films ou séries d'une liste TMDB (recommandations, /discover). */
function parseSimilarList(value: unknown): TmdbSimilar[] {
  if (!Array.isArray(value)) return [];
  return value.map(object).map((v) => ({
    id: num(v.id),
    title: str(v.title || v.name),
    releaseDate: str(v.release_date || v.first_air_date),
    posterPath: typeof v.poster_path === 'string' ? v.poster_path : null,
    voteAverage: num(v.vote_average),
  })).filter((s) => s.id > 0 && !!s.title);
}

function parseTmdbDetails(data: unknown): TmdbDetails {
  const root = object(data);
  const credits = object(root.credits);
  const crew = Array.isArray(credits.crew) ? credits.crew.map(object) : [];
  const castRaw = Array.isArray(credits.cast) ? credits.cast.map(object) : [];
  const reviews = Array.isArray(object(root.reviews).results) ? (object(root.reviews).results as unknown[]).map(object) : [];
  const similar = parseSimilarList(object(root.recommendations).results);
  const runtimeRaw = num(root.runtime) || (Array.isArray(root.episode_run_time) && (root.episode_run_time as unknown[]).length ? num((root.episode_run_time as unknown[])[0]) : 0);
  const genreList = Array.isArray(root.genres) ? root.genres.map(object) : [];
  const genres = genreList.map((g) => str(g.name)).filter(Boolean);
  const genreIds = genreList.map((g) => num(g.id)).filter((id) => id > 0);
  const director = crew.find((c) => str(c.job).toLowerCase() === 'director');
  return {
    id: num(root.id),
    title: str(root.title || root.name),
    overview: str(root.overview),
    releaseDate: str(root.release_date || root.first_air_date),
    runtime: runtimeRaw > 0 ? runtimeRaw : null,
    genres,
    genreIds,
    voteAverage: num(root.vote_average),
    voteCount: num(root.vote_count),
    revenue: num(root.revenue),
    posterPath: typeof root.poster_path === 'string' ? root.poster_path : null,
    ...(director ? { director: str(director.name) } : {}),
    cast: castRaw.slice(0, 8).map((c) => ({ name: str(c.name), ...(str(c.character) ? { character: str(c.character) } : {}) })),
    similar: similar.slice(0, 10),
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
 * Disponibilité légale du titre dans le pays demandé : abonnement, gratuit,
 * location, achat. Le pays fait partie de la clé de cache, sinon changer de
 * pays servirait les offres de l'ancien pendant 12 h.
 * `null` quand le pays n'a aucune offre répertoriée.
 */
export async function fetchWatchProviders(
  id: number, kind: TmdbKind, apiKey: string, region: string = DEFAULT_WATCH_REGION,
): Promise<WatchAvailability | null> {
  const cacheKey = `tmdb_providers_${kind}_${id}_${region}`;
  return memoFetch(cacheKey, async () => {
    const cached = await getMeta<{ fetchedAt: number; availability: WatchAvailability | null }>(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.availability;
    const availability = parseWatchAvailability(await tmdbGet(`/${kind}/${id}/watch/providers`, apiKey), region);
    await setMeta(cacheKey, { fetchedAt: Date.now(), availability });
    return availability;
  });
}

/**
 * Lit la liste des fournisseurs diffusant des films dans un pays.
 * Seuls ceux qui ont une priorité d'affichage dans ce pays sont retenus :
 * TMDB renvoie aussi les fournisseurs d'autres régions.
 */
export function parseRegionProviders(data: unknown, region: string): TmdbProvider[] {
  const results = object(data).results;
  if (!Array.isArray(results)) return [];
  const providers: TmdbProvider[] = [];
  for (const raw of results) {
    const value = object(raw);
    const priority = object(value.display_priorities)[region];
    const providerId = num(value.provider_id);
    const name = str(value.provider_name);
    if (providerId <= 0 || !name || typeof priority !== 'number' || !Number.isFinite(priority)) continue;
    providers.push({
      providerId,
      name,
      logoPath: typeof value.logo_path === 'string' ? value.logo_path : null,
      priority,
    });
  }
  return providers.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'fr'));
}

/** Fournisseurs disponibles dans le pays (réglage « mes abonnements »), cache 12 h. */
export async function fetchRegionProviders(region: string, apiKey: string): Promise<TmdbProvider[]> {
  const cacheKey = `tmdb_region_providers_${region}`;
  return memoFetch(cacheKey, async () => {
    const cached = await getMeta<{ fetchedAt: number; providers: TmdbProvider[] }>(cacheKey);
    if (cached?.providers?.length && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.providers;
    const data = await tmdbGet(`/watch/providers/movie?watch_region=${encodeURIComponent(region)}`, apiKey);
    const providers = parseRegionProviders(data, region);
    await setMeta(cacheKey, { fetchedAt: Date.now(), providers });
    return providers;
  });
}

/**
 * Titres populaires réellement diffusés dans le pays chez les fournisseurs
 * retenus, **en abonnement seulement** : sans `with_watch_monetization_types`,
 * /discover rend aussi la location et l'achat, qui ne sont pas des abonnements.
 * `watch_region` est obligatoire avec `with_watch_providers`, et l'absence
 * d'abonnement coché renvoie une liste vide sans appel réseau.
 */
export async function fetchDiscover(
  kind: TmdbKind,
  options: { region: string; providerIds: number[]; genreIds?: number[] | undefined },
  apiKey: string,
): Promise<TmdbSimilar[]> {
  const providerIds = [...new Set(options.providerIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  if (!providerIds.length) return [];
  const genreIds = [...new Set(options.genreIds ?? [])].filter((id) => id > 0).slice(0, 2);
  // v2 : les entrées v1 (6 h) ne filtraient pas le mode de diffusion et pouvaient
  // contenir de la location ou de l'achat — ne pas les resservir après mise à jour.
  const cacheKey = `tmdb_discover_v2_${kind}_${options.region}_${providerIds.join('|')}_${genreIds.join('-')}`;
  return memoFetch(cacheKey, async () => {
    const cached = await getMeta<{ fetchedAt: number; items: TmdbSimilar[] }>(cacheKey);
    if (cached?.items?.length && Date.now() - cached.fetchedAt < DISCOVER_TTL_MS) return cached.items;
    const params = new URLSearchParams({
      watch_region: options.region,
      with_watch_providers: providerIds.join('|'),
      with_watch_monetization_types: 'flatrate',
      sort_by: 'popularity.desc',
      'vote_count.gte': '20',
      include_adult: 'false',
    });
    if (genreIds.length) params.set('with_genres', genreIds.join(','));
    const items = parseSimilarList(object(await tmdbGet(`/discover/${kind}?${params}`, apiKey)).results).slice(0, 12);
    await setMeta(cacheKey, { fetchedAt: Date.now(), items });
    return items;
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
