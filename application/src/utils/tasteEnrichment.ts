import { historyScope, type PlayHistoryEntry } from '@/utils/idb';
import type { LocalWork } from '@/utils/localLibrary';
import { buildTasteProfile, type TasteProfile, type TasteSource } from '@/utils/tasteProfile';
import { fetchTmdbDetails, pickBestMatch, searchTmdb, TmdbAuthenticationError, type TmdbDetails, type TmdbKind } from '@/utils/tmdb';
import { normalizeForCompare, normalizeTitle } from '@/utils/titleNormalize';
import type { CatalogItem } from '@/utils/xtreamCatalog';

/**
 * Résolution TMDB du profil de goût. Le budget réseau est borné : seuls les derniers
 * films vus, les derniers visionnages « Vu ailleurs » et les meilleurs candidats sont
 * résolus, chaque appel étant mis en cache 12 h par `tmdb.ts`. Une panne ou une clé
 * absente laisse simplement le classement local (aucune erreur remontée à l'interface).
 */

/** Films vus dans CedPlay exploités pour le profil. */
export const TASTE_SAMPLE = 12;
/** Visionnages importés (« Vu ailleurs ») exploités pour le profil, toutes plateformes. */
export const EXTERNAL_SAMPLE = 12;
/** Œuvres de la bibliothèque locale (USB/SD) exploitées pour le profil. */
export const LOCAL_SAMPLE = 12;
/** Une œuvre possédée n'est pas un visionnage : elle informe sans écraser l'historique. */
const LOCAL_WEIGHT = 0.6;
/** Candidats enrichis pour le reclassement. */
export const CANDIDATE_SAMPLE = 12;
/** Requêtes TMDB simultanées : reste discret sur un box ou un téléphone. */
const CONCURRENCY = 3;

const VOD_CHANNEL = /^vod:(.+):(movie|series):([^:]+)$/;

export interface TasteEnrichment {
  playlistId: string;
  profile: TasteProfile;
  /** Fiches TMDB des candidats reclassables, par identifiant catalogue. */
  detailsByItemId: Map<string, TmdbDetails>;
  /** Fiches exploitées pour le profil (diagnostic et tests). */
  sampleSize: number;
  /** Dont fiches issues de « Vu ailleurs » (badge d'interface). */
  externalSampleSize: number;
  /** Dont fiches issues de la bibliothèque locale USB/SD. */
  localSampleSize: number;
}

async function eachPool<T>(values: T[], limit: number, task: (value: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      const value = values[index];
      if (value !== undefined) await task(value);
    }
  });
  await Promise.all(workers);
}

/** Fiche TMDB par identifiant fournisseur, sinon par titre exact + année. */
async function resolveDetails(
  input: { name: string; year?: string; tmdbId?: number },
  kind: TmdbKind,
  apiKey: string,
): Promise<TmdbDetails | null> {
  if (input.tmdbId && input.tmdbId > 0) {
    try {
      return stampKind(await fetchTmdbDetails(input.tmdbId, kind, apiKey), kind);
    } catch (error) {
      if (error instanceof TmdbAuthenticationError) throw error;
      // Identifiant fournisseur périmé : on retombe sur la recherche par titre.
    }
  }
  const normalized = normalizeTitle(input.name);
  const query = normalized.title || input.name.trim();
  const year = input.year || normalized.year;
  if (!query) return null;
  try {
    const results = await searchTmdb(query, year, kind, apiKey);
    const best = pickBestMatch(query, results, year);
    if (!best) return null;
    return stampKind(await fetchTmdbDetails(best.id, kind, apiKey), kind);
  } catch (error) {
    if (error instanceof TmdbAuthenticationError) throw error;
    return null;
  }
}

/** Marque la fiche de son espace film/série : les similaires TMDB partagent
 * l'espace d'identifiants numériques entre films et séries. */
function stampKind(details: TmdbDetails, kind: TmdbKind): TmdbDetails {
  details.kind = kind;
  return details;
}

/** Derniers films vus dans CedPlay exploitables, du plus récent au plus ancien. */
export function recentWatchedMovies(history: PlayHistoryEntry[], playlistId: string, kind: 'movie' | 'series' = 'movie'): PlayHistoryEntry[] {
  return history
    .map(historyScope)
    .filter(e => e.kind === 'vod' && e.playlistId === playlistId && e.mediaKind === kind && !!e.name && (e.status === 'completed' || (e.positionMs || 0) >= 60000))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, TASTE_SAMPLE);
}

/**
 * Échantillon équitable entre plateformes : un historique YouTube très fourni
 * (clips, trailers, vidéos diverses) ne doit pas écarter Netflix et Prime Video
 * du profil. Tourniquet sur les visionnages les plus récents de chaque plateforme.
 */
export function sampleExternalWatches(watches: PlayHistoryEntry[], limit = EXTERNAL_SAMPLE): PlayHistoryEntry[] {
  const byPlatform = new Map<string, PlayHistoryEntry[]>();
  for (const watch of watches) {
    if (!watch?.name || typeof watch.ts !== 'number') continue;
    const key = watch.platform || 'autre';
    const queue = byPlatform.get(key);
    if (queue) queue.push(watch);
    else byPlatform.set(key, [watch]);
  }
  const queues = [...byPlatform.values()];
  for (const queue of queues) queue.sort((a, b) => b.ts - a.ts);
  const sample: PlayHistoryEntry[] = [];
  let index = 0;
  while (sample.length < limit && queues.some(queue => queue.length > 0)) {
    const next = queues[index % queues.length]?.shift();
    index += 1;
    if (next) sample.push(next);
  }
  return sample;
}

export interface EnrichInput {
  kind?: 'movie' | 'series';
  history: PlayHistoryEntry[];
  /** Catalogue complet, pour retrouver l'identifiant TMDB d'un film déjà vu. */
  movies: CatalogItem[];
  /** Candidats pré-classés à enrichir. */
  candidates: CatalogItem[];
  /** Visionnages importés d'autres plateformes. */
  external?: PlayHistoryEntry[];
  /** Films et séries de la bibliothèque locale, déjà dédoublonnés. */
  local?: LocalWork[];
  playlistId: string;
  apiKey: string;
  nowMs?: number;
}

/** Construit le profil de goût puis résout les fiches des meilleurs candidats. */
export async function enrichRecommendations(input: EnrichInput): Promise<TasteEnrichment> {
  const mediaKind = input.kind ?? 'movie';
  const tmdbKind: TmdbKind = mediaKind === 'series' ? 'tv' : 'movie';
  const apiKey = input.apiKey.trim();
  const empty: TasteEnrichment = {
    playlistId: input.playlistId,
    profile: buildTasteProfile([], input.nowMs),
    detailsByItemId: new Map(),
    sampleSize: 0,
    externalSampleSize: 0,
    localSampleSize: 0,
  };
  if (!apiKey) return empty;

  const catalogById = new Map(input.movies.map(item => [item.id, item]));
  const sources: TasteSource[] = [];
  // Un même film vu ici et ailleurs ne doit pas compter deux fois dans le profil.
  // Identité = type + titre + année de la fiche résolue (celle de l'import) :
  // un titre seul fusionnerait deux remakes ou un film et sa série homonyme.
  const seenWorks = new Set<string>();
  const workKey = (details: TmdbDetails, kind: TmdbKind): string =>
    `${kind}|${normalizeForCompare(details.title)}|${details.releaseDate.slice(0, 4)}`;
  // Un épisode par entrée d'historique : pour les séries, un même titre ne doit
  // compter qu'une fois dans le profil (le plus récent épisode vu) et ne pas
  // multiplier les appels TMDB pour la même œuvre.
  const watchedWorks = recentWatchedMovies(input.history, input.playlistId, mediaKind)
    .filter((entry, index, list) => mediaKind === 'movie'
      || list.findIndex(other => (other.seriesId ?? other.name) === (entry.seriesId ?? entry.name)) === index);
  await eachPool(watchedWorks, CONCURRENCY, async (entry) => {
    const scope = entry.channelId.match(VOD_CHANNEL);
    const catalogItem = scope ? catalogById.get(entry.seriesId || scope[3] as string) : undefined;
    const details = await resolveDetails(
      {
        name: entry.name ?? '',
        ...(entry.year ? { year: entry.year } : {}),
        ...(catalogItem?.tmdbId ? { tmdbId: catalogItem.tmdbId } : {}),
      },
      tmdbKind,
      apiKey,
    );
    if (!details) return;
    seenWorks.add(workKey(details, tmdbKind));
    sources.push({ details, ts: entry.ts });
  });

  let externalSampleSize = 0;
  await eachPool(sampleExternalWatches(input.external ?? []), CONCURRENCY, async (entry) => {
    const kind: TmdbKind = entry.mediaKind === 'series' ? 'tv' : 'movie';
    const details = await resolveDetails(
      {
        name: entry.name ?? '',
        ...(entry.year ? { year: entry.year } : {}),
        ...(entry.tmdbId ? { tmdbId: entry.tmdbId } : {}),
      },
      kind,
      apiKey,
    );
    if (!details) return;
    const key = workKey(details, kind);
    if (seenWorks.has(key)) return;
    seenWorks.add(key);
    sources.push({ details, ts: entry.ts });
    externalSampleSize += 1;
  });

  let localSampleSize = 0;
  await eachPool((input.local ?? []).slice(0, LOCAL_SAMPLE), CONCURRENCY, async (work) => {
    const kind: TmdbKind = work.kind === 'series' ? 'tv' : 'movie';
    const details = await resolveDetails(
      { name: work.title, ...(work.year ? { year: work.year } : {}) },
      kind,
      apiKey,
    );
    if (!details) return;
    const key = workKey(details, kind);
    if (seenWorks.has(key)) return;
    seenWorks.add(key);
    sources.push({ details, ts: work.lastModified, weight: LOCAL_WEIGHT });
    localSampleSize += 1;
  });
  // Les œuvres possédées n'ont pas de date de visionnage : leur poids fixe
  // remplace la décroissance par récence dans le profil.
  const profile = buildTasteProfile(sources, input.nowMs);
  const detailsByItemId = new Map<string, TmdbDetails>();
  if (profile.sampleSize > 0) {
    await eachPool(input.candidates.slice(0, CANDIDATE_SAMPLE), CONCURRENCY, async (item) => {
      const details = await resolveDetails(
        { name: item.name, ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}) },
        tmdbKind,
        apiKey,
      );
      if (details) detailsByItemId.set(item.id, details);
    });
  }

  return { playlistId: input.playlistId, profile, detailsByItemId, sampleSize: profile.sampleSize, externalSampleSize, localSampleSize };
}
