import type { TmdbDetails } from '@/utils/tmdb';

/**
 * Profil de goût local, construit uniquement à partir des fiches TMDB des films
 * déjà vus : genres, réalisateurs, têtes d'affiche, décennies et films similaires.
 * Aucun accès réseau ici — pur et déterministe (nowMs injectable pour les tests).
 */

/** Demi-vie d'un visionnage : mêmes 30 jours que le classement « Pour toi ». */
export const TASTE_HALF_LIFE_MS = 30 * 24 * 3600 * 1000;

/** Un réalisateur pèse plus qu'un second rôle : c'est le signal le plus stable. */
const DIRECTOR_WEIGHT = 2;
const CAST_WEIGHT = 0.75;
const CAST_LIMIT = 3;
const DECADE_WEIGHT = 1;
/** Un film classé « similaire » par TMDB est un rapprochement explicite, pas statistique. */
const SIMILAR_WEIGHT = 1.5;
/** Un réalisateur ou un comédien apprécié pèse juste sous un « similaire » explicite. */
const PERSON_BOOST = 1.2;

export interface TasteSource {
  details: TmdbDetails;
  /** Horodatage du visionnage (ms). */
  ts: number;
  /** Poids fixe 0..1 pour une œuvre possédée et non visionnée : la date du fichier
   * ne dit rien de la fraîcheur du goût. Absent = décroissance par récence. */
  weight?: number;
}

export interface TasteProfile {
  /** Poids par genre TMDB, ramené à 1 pour le genre dominant. */
  genres: Map<string, number>;
  /** Poids par personne (réalisateur ou comédien), ramené à 1 pour la dominante. */
  people: Map<string, number>;
  /** Poids par décennie (« 1990 », « 2010 »…), ramené à 1. */
  decades: Map<string, number>;
  /** Films similaires des titres vus : `type:id TMDB` → titre de l'œuvre vue. Le
   * type participe à l'identité : films et séries partagent les identifiants TMDB. */
  similar: Map<string, string>;
  /** Nombre de fiches TMDB réellement exploitées. */
  sampleSize: number;
}

export interface TasteMatch {
  /** Pertinence brute 0..~4 (voir TASTE_MAX_SCORE). */
  score: number;
  /** Justifications lisibles, de la plus forte à la plus faible. */
  reasons: string[];
}

/** Plafond théorique de `matchTaste` : genre 1 + personne 1,2 + similaires 1,5 + décennie 0,35. */
export const TASTE_MAX_SCORE = 4.05;

export const EMPTY_PROFILE: TasteProfile = {
  genres: new Map(),
  people: new Map(),
  decades: new Map(),
  similar: new Map(),
  sampleSize: 0,
};

function recency(ts: number, nowMs: number): number {
  return Math.exp(-Math.LN2 * Math.max(0, nowMs - ts) / TASTE_HALF_LIFE_MS);
}

function bump(map: Map<string, number>, key: string, weight: number): void {
  if (!key || weight <= 0) return;
  map.set(key, (map.get(key) ?? 0) + weight);
}

/** Ramène la carte à 0..1 sur sa valeur maximale : un profil de 2 films et un profil
 * de 12 films doivent produire des scores comparables. */
function normalized(map: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const value of map.values()) if (value > max) max = value;
  if (max <= 0) return new Map();
  const out = new Map<string, number>();
  for (const [key, value] of map) out.set(key, value / max);
  return out;
}

export function decadeOf(releaseDate: string): string {
  const year = Number(releaseDate.slice(0, 4));
  return Number.isFinite(year) && year > 1880 ? `${Math.floor(year / 10) * 10}` : '';
}

/** Agrège les fiches vues en un profil pondéré par la fraîcheur des visionnages. */
export function buildTasteProfile(sources: TasteSource[], nowMs = Date.now()): TasteProfile {
  const genres = new Map<string, number>();
  const people = new Map<string, number>();
  const decades = new Map<string, number>();
  const similar = new Map<string, string>();

  let sampleSize = 0;
  for (const source of sources) {
    const { details } = source;
    if (!details || !details.id) continue;
    const weight = source.weight ?? recency(source.ts, nowMs);
    if (weight <= 0) continue;
    sampleSize += 1;

    for (const genre of details.genres) bump(genres, genre, weight);
    if (details.director) bump(people, details.director, weight * DIRECTOR_WEIGHT);
    for (const member of details.cast.slice(0, CAST_LIMIT)) bump(people, member.name, weight * CAST_WEIGHT);
    const decade = decadeOf(details.releaseDate);
    if (decade) bump(decades, decade, weight * DECADE_WEIGHT);
    // Le film vu garde la priorité si plusieurs titres vus pointent le même similaire.
    // Clé « type:id » : une série et un film peuvent partager le même identifiant
    // numérique TMDB sans être la même œuvre.
    const kind = details.kind ?? 'movie';
    for (const candidate of details.similar) {
      if (!candidate.id || !candidate.title) continue;
      const key = `${kind}:${candidate.id}`;
      if (!similar.has(key)) similar.set(key, details.title || candidate.title);
    }
  }

  return { genres: normalized(genres), people: normalized(people), decades: normalized(decades), similar, sampleSize };
}

interface WeightedReason {
  label: string;
  weight: number;
}

function bestBy<T extends { weight: number }>(list: T[]): T | undefined {
  let best: T | undefined;
  for (const entry of list) if (!best || entry.weight > best.weight) best = entry;
  return best;
}

/**
 * Rapproche une fiche TMDB du profil. Les justifications sont triées du signal le
 * plus fort au plus faible : TMDB « similaire » d'abord, puis réalisateur/comédien,
 * genre et enfin décennie.
 */
export function matchTaste(profile: TasteProfile, details: TmdbDetails, limit = 2): TasteMatch {
  if (!profile.sampleSize || !details) return { score: 0, reasons: [] };

  const reasons: WeightedReason[] = [];
  let score = 0;

  const similarSource = profile.similar.get(`${details.kind ?? 'movie'}:${details.id}`);
  if (similarSource) {
    score += SIMILAR_WEIGHT;
    reasons.push({ label: `Proche de « ${similarSource} »`, weight: SIMILAR_WEIGHT });
  }

  // Le réalisateur compte même absent du casting affiché : un film d'auteur sans
  // comédien connu doit quand même profiter du goût pour ce réalisateur.
  const director = details.director ?? '';
  const directorWeight = director ? profile.people.get(director) ?? 0 : 0;
  const topCast = bestBy(
    (details.cast ?? [])
      .map(member => ({ label: member.name, weight: profile.people.get(member.name) ?? 0 }))
      .filter(entry => entry.weight > 0),
  );
  if (directorWeight > 0 && directorWeight >= (topCast?.weight ?? 0)) {
    score += directorWeight * PERSON_BOOST;
    reasons.push({ label: `Réalisé par ${director}`, weight: directorWeight * PERSON_BOOST });
  } else if (topCast) {
    score += topCast.weight * PERSON_BOOST;
    reasons.push({ label: `Avec ${topCast.label}`, weight: topCast.weight * PERSON_BOOST });
  }

  const genres = details.genres
    .map(genre => ({ label: genre, weight: profile.genres.get(genre) ?? 0 }))
    .filter(entry => entry.weight > 0);
  const topGenre = bestBy(genres);
  if (topGenre) {
    score += topGenre.weight;
    reasons.push({ label: `Genre : ${topGenre.label}`, weight: topGenre.weight });
  }

  const decade = decadeOf(details.releaseDate);
  const decadeWeight = decade ? profile.decades.get(decade) ?? 0 : 0;
  if (decadeWeight > 0) {
    score += decadeWeight * 0.35;
    reasons.push({ label: `Années ${decade}`, weight: decadeWeight * 0.35 });
  }

  reasons.sort((a, b) => b.weight - a.weight);
  return { score, reasons: reasons.slice(0, Math.max(0, limit)).map(entry => entry.label) };
}
