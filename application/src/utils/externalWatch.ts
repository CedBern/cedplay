import type { PlayHistoryEntry } from '@/utils/idb';
import { MAX_EXTERNAL_WATCHES } from '@/utils/idb';
import type { CatalogItem } from '@/utils/xtreamCatalog';
import { normalizeForCompare, normalizeTitle, stripQualityTags } from '@/utils/titleNormalize';

/**
 * Import « Vu ailleurs » : films et séries regardés sur YouTube, Netflix, Prime
 * Video… Ces visionnages n'ont pas de flux dans CedPlay ; ils servent uniquement
 * à nourrir le rail « Pour toi » (amorces dans le catalogue + profil de goût).
 *
 * Tout est lu localement : le fichier importé n'est jamais envoyé, seuls les
 * titres (et l'identifiant TMDB quand le fichier le fournit) sont conservés.
 */

export type WatchPlatformId = 'netflix' | 'prime' | 'youtube' | 'disney' | 'hbo' | 'arte' | 'autre';

export const WATCH_PLATFORMS: { id: WatchPlatformId; label: string }[] = [
  { id: 'netflix', label: 'Netflix' },
  { id: 'prime', label: 'Prime Video' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'disney', label: 'Disney+' },
  { id: 'hbo', label: 'HBO Max' },
  { id: 'arte', label: 'Arte' },
  { id: 'autre', label: 'Autre' },
];

/**
 * Libellés écrits par les exports dans la colonne « platform » : le même service
 * arrive tantôt sous son identifiant (`prime`), tantôt sous son nom commercial
 * (« Prime Video »). On ramène les deux au même identifiant pour ne pas compter
 * un film de Prime Video comme une plateforme inconnue.
 */
const PLATFORM_ALIASES: Record<string, WatchPlatformId> = {
  netflix: 'netflix',
  prime: 'prime',
  'prime video': 'prime',
  'amazon prime': 'prime',
  'amazon prime video': 'prime',
  amazon: 'prime',
  youtube: 'youtube',
  'youtube premium': 'youtube',
  disney: 'disney',
  'disney plus': 'disney',
  hbo: 'hbo',
  'hbo max': 'hbo',
  max: 'hbo',
  arte: 'arte',
  'arte tv': 'arte',
  autre: 'autre',
  other: 'autre',
  inconnu: 'autre',
};

/** Identifiant canonique d'une plateforme, à partir de son identifiant ou de son libellé. */
export function watchPlatformId(raw: string | undefined): string | undefined {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return undefined;
  return PLATFORM_ALIASES[normalizeForCompare(value)] ?? value;
}

export function platformLabel(id: string | undefined): string {
  const resolved = watchPlatformId(id);
  return WATCH_PLATFORMS.find(platform => platform.id === resolved)?.label ?? 'Autre';
}

/** Un fichier d'historique de visionnage pèse quelques Mo : au-delà, c'est une
 * erreur de fichier (ou un Takeout complet) plutôt qu'un historique. */
export const MAX_WATCH_IMPORT_BYTES = 32 * 1024 * 1024;
/** Amorces tirées des films vus ailleurs : borne le coût du rapprochement catalogue. */
export const MAX_EXTERNAL_SEEDS = 50;

export interface WatchImportResult {
  entries: PlayHistoryEntry[];
  format: 'csv' | 'json';
  /** Lignes de visionnage reconnues, avant dédoublonnage. */
  recognised: number;
  /** Lignes ignorées : aucune date exploitable. */
  undated: number;
  /** Doublons fusionnés (même titre, même année, même type). */
  duplicates: number;
  /** Visionnages au-delà de la limite conservée. */
  truncated: number;
}

interface RawRow {
  title: string;
  ts: number | null;
  year?: string;
  tmdbId?: number;
  platform?: string;
  series?: boolean;
}

/** Takeout localise son préfixe : « Watched … », « A regardé … », « Viewed … ». */
const TITLE_PREFIX = /^(?:watched|viewed|a regard[ée]|regard[ée])\s+/i;
/** « The Office: Season 1: Episode 1 », « The Crown: Saison 3 »… */
const SERIES_SUFFIX = /:\s*(?:season|saison|limited series|mini[- ]?s[ée]rie|series)\b.*$/i;
const EPISODE_SUFFIX = /:\s*(?:episode|[ée]pisode|ep\.?)\s*\d+\b.*$/i;

/** Titre lisible + type d'œuvre, à partir d'un libellé de plateforme. */
export function cleanWatchTitle(raw: string): { title: string; series: boolean } {
  const stripped = stripQualityTags(raw.replace(TITLE_PREFIX, '').trim()).replace(/\s+/g, ' ').trim();
  const series = SERIES_SUFFIX.test(stripped) || EPISODE_SUFFIX.test(stripped);
  const title = series ? stripped.replace(SERIES_SUFFIX, '').replace(EPISODE_SUFFIX, '').trim() : stripped;
  return { title, series };
}

/**
 * Dates acceptées : ISO (AAAA-MM-JJ), américain (MM/JJ/AAAA, format des exports
 * Netflix et Prime Video), européen quand le jour dépasse 12 (JJ/MM/AAAA), pointé
 * (JJ.MM.AAAA), ou année seule. Un slash ambigu est lu à l'américaine. Une date
 * ISO impossible (2023-02-31) est refusée, jamais décalée au mois suivant.
 */
export function parseWatchDate(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (iso) {
    // Format ISO reconnu : pas de repli sur Date.parse, qui décalerait 02-31 au 3 mars.
    return validDate(+iso[1], +iso[2], +iso[3])
      ? Date.UTC(+iso[1], +iso[2] - 1, +iso[3], iso[4] ? +iso[4] : 12, iso[5] ? +iso[5] : 0)
      : null;
  }
  const separated = value.match(/^(\d{1,2})([/.])(\d{1,2})\2(\d{2,4})$/);
  if (separated) {
    const first = +separated[1];
    const second = +separated[3];
    // Le pointé est le contrat JJ.MM.AAAA ; seul le slash ambigu est lu à l'américaine.
    const dotted = separated[2] === '.';
    const month = dotted || first > 12 ? second : first;
    const day = dotted || first > 12 ? first : second;
    const year = separated[4].length === 2 ? 2000 + +separated[4] : +separated[4];
    return validDate(year, month, day) ? Date.UTC(year, month - 1, day, 12) : null;
  }
  const yearOnly = value.match(/^((?:19|20)\d{2})$/);
  if (yearOnly) return Date.UTC(+yearOnly[1], 6, 1, 12);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  // « 31/02 » ne doit pas glisser au 3 mars.
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? Math.round(value * 1000) : value;
  if (typeof value === 'string') return parseWatchDate(value);
  return null;
}

/** Séparateur majoritaire de la première ligne, hors guillemets. */
function detectDelimiter(text: string): string {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') commas += 1;
    else if (!quoted && char === ';') semicolons += 1;
    else if (!quoted && (char === '\n' || char === '\r')) break;
  }
  return semicolons > commas ? ';' : ',';
}

/** Découpe CSV tolérante : guillemets, guillemets doublés, CRLF. */
export function splitCsvRows(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(columns => columns.some(column => column.trim() !== ''));
}

const alias = (names: string[]) => names.map(normalizeForCompare);

const HEADER_ALIASES: Record<string, string[]> = {
  title: alias(['title', 'titre', 'name', 'nom', 'video title', 'titre de la video', 'show title']),
  date: alias(['date', 'watched at', 'watched date', 'watch date', 'watching date', 'view date', 'viewing date', 'last watched', 'last viewed', 'date watched', 'date de visionnage', 'date du visionnage', 'date de la lecture', 'timestamp', 'time']),
  year: alias(['year', 'annee', 'release year', 'release date', 'annee de sortie']),
  tmdbId: alias(['tmdbid', 'tmdb id', 'tmdb_id', 'tmdb']),
  platform: alias(['platform', 'plateforme', 'service', 'app', 'application']),
  kind: alias(['type', 'media type', 'categorie', 'category']),
};

function columnIndex(header: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const index = header.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

function csvHeader(row: string[]): string[] {
  return row.map(cell => normalizeForCompare(cell));
}

function rowsFromCsv(text: string, platform: WatchPlatformId): { rows: RawRow[]; undated: number } {
  const table = splitCsvRows(text.replace(/^\uFEFF/, ''));
  if (table.length === 0) return { rows: [], undated: 0 };
  const header = csvHeader(table[0]);
  const columns = {
    title: columnIndex(header, HEADER_ALIASES.title),
    date: columnIndex(header, HEADER_ALIASES.date),
    year: columnIndex(header, HEADER_ALIASES.year),
    tmdbId: columnIndex(header, HEADER_ALIASES.tmdbId),
    platform: columnIndex(header, HEADER_ALIASES.platform),
    kind: columnIndex(header, HEADER_ALIASES.kind),
  };
  // Export minimal à deux colonnes sans en-tête reconnu : première = titre, seconde = date.
  // La première ligne n'est un en-tête que si sa seconde colonne n'est pas une date.
  const positional = columns.title < 0 && columns.date < 0 && table[0].length <= 2;
  const firstRowIsData = positional && toTimestamp(table[0][1] ?? '') !== null;
  const cells = firstRowIsData ? table : table.slice(1);
  const at = (row: string[], index: number) => (index >= 0 ? row[index] ?? '' : '');
  let undated = 0;
  const rows: RawRow[] = [];
  for (const row of cells) {
    const title = positional ? row[0] ?? '' : at(row, columns.title);
    if (!title.trim()) continue;
    const rawDate = positional ? row[1] ?? '' : at(row, columns.date);
    const rawYear = at(row, columns.year).trim();
    let ts = toTimestamp(rawDate);
    if (ts === null && rawYear) ts = toTimestamp(rawYear);
    if (ts === null) { undated += 1; continue; }
    const tmdbId = Number(at(row, columns.tmdbId));
    const kind = at(row, columns.kind);
    rows.push({
      title,
      ts,
      ...(/^(?:19|20)\d{2}$/.test(rawYear) ? { year: rawYear } : {}),
      ...(Number.isFinite(tmdbId) && tmdbId > 0 ? { tmdbId } : {}),
      platform: watchPlatformId(at(row, columns.platform)) || platform,
      ...(/\b(?:tv|serie|s[ée]rie|series|show)\b/i.test(kind) ? { series: true } : {}),
    });
  }
  return { rows, undated };
}

function fieldValue(value: Record<string, unknown>, names: string[]): unknown {
  const folded = new Map<string, unknown>();
  for (const [key, raw] of Object.entries(value)) folded.set(normalizeForCompare(key), raw);
  for (const name of names) {
    const candidate = folded.get(normalizeForCompare(name));
    if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
  }
  return undefined;
}

const GENERIC_FIELDS = {
  title: ['title', 'titre', 'name', 'nom'],
  date: ['watchedAt', 'watched at', 'watchedDate', 'viewDate', 'lastWatched', 'date', 'timestamp', 'time'],
  year: ['year', 'annee', 'releaseYear'],
  tmdbId: ['tmdbId', 'tmdb_id', 'tmdb'],
  platform: ['platform', 'plateforme', 'service'],
  kind: ['type', 'mediaType', 'kind'],
};

function isTakeout(value: Record<string, unknown>): boolean {
  return typeof value.header === 'string' || typeof value.titleUrl === 'string';
}

function takeoutRow(value: Record<string, unknown>): RawRow | null {
  const header = String(value.header ?? '');
  // YouTube Music et les publicités ne disent rien du goût cinéma.
  if (!/youtube/i.test(header) || /music/i.test(header)) return null;
  const details = Array.isArray(value.details) ? value.details : [];
  if (details.some(detail => /google ads/i.test(String((detail as { name?: unknown } | null)?.name ?? '')))) return null;
  return { title: String(value.title ?? ''), ts: toTimestamp(value.time), platform: 'youtube' };
}

function genericRow(value: Record<string, unknown>, fallbackPlatform: WatchPlatformId): RawRow | null {
  const title = String(fieldValue(value, GENERIC_FIELDS.title) ?? '');
  if (!title.trim()) return null;
  const ts = toTimestamp(fieldValue(value, GENERIC_FIELDS.date)) ?? toTimestamp(fieldValue(value, GENERIC_FIELDS.year));
  const tmdbId = Number(fieldValue(value, GENERIC_FIELDS.tmdbId));
  const rawYear = String(fieldValue(value, GENERIC_FIELDS.year) ?? '').trim();
  const platform = watchPlatformId(String(fieldValue(value, GENERIC_FIELDS.platform) ?? ''));
  const kind = String(fieldValue(value, GENERIC_FIELDS.kind) ?? '');
  return {
    title,
    ts,
    ...(/^(?:19|20)\d{2}$/.test(rawYear) ? { year: rawYear } : {}),
    ...(Number.isFinite(tmdbId) && tmdbId > 0 ? { tmdbId } : {}),
    platform: platform || fallbackPlatform,
    ...(/\b(?:tv|serie|s[ée]rie|series|show)\b/i.test(kind) ? { series: true } : {}),
  };
}

/** Clé d'identité éditoriale : le même film sur deux plateformes ne compte qu'une fois.
 * Le type inféré du libellé (épisode Netflix…) participe comme le type explicite. */
function rowKey(row: RawRow): string {
  const { title, series } = cleanWatchTitle(row.title);
  return `${row.series || series ? 'series' : 'movie'}|${normalizeForCompare(title)}|${row.year ?? ''}`;
}

function toEntry(row: RawRow): PlayHistoryEntry | null {
  const cleaned = cleanWatchTitle(row.title);
  if (!cleaned.title || row.ts === null) return null;
  const series = row.series || cleaned.series;
  const platform = watchPlatformId(row.platform) || 'autre';
  const slug = normalizeForCompare(cleaned.title).replace(/ /g, '-') || 'titre';
  return {
    channelId: `elsewhere:${platform}:${series ? 'series' : 'movie'}:${slug}${row.year ? `-${row.year}` : ''}`,
    ts: row.ts,
    kind: 'vod',
    mediaKind: series ? 'series' : 'movie',
    name: cleaned.title,
    status: 'completed',
    platform,
    ...(row.year ? { year: row.year } : {}),
    ...(row.tmdbId ? { tmdbId: row.tmdbId } : {}),
  };
}

/**
 * Lit un historique exporté par une plateforme. Le format est déduit du contenu
 * (JSON si le premier caractère est `[` ou `{`, sinon CSV) ; la plateforme choisie
 * dans l'interface sert de repli quand le fichier ne la précise pas.
 */
export function parseWatchImport(text: string, options: { platform?: WatchPlatformId } = {}): WatchImportResult {
  const platform = options.platform ?? 'autre';
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('Fichier vide.');
  const format: 'csv' | 'json' = trimmed[0] === '[' || trimmed[0] === '{' ? 'json' : 'csv';

  let rawRows: RawRow[] = [];
  let undated = 0;
  if (format === 'csv') {
    const parsed = rowsFromCsv(trimmed, platform);
    rawRows = parsed.rows;
    undated = parsed.undated;
  } else {
    let root: unknown;
    try { root = JSON.parse(trimmed); } catch { throw new Error('JSON illisible : le fichier est tronqué ou n’est pas un export de visionnage.'); }
    const items = Array.isArray(root)
      ? root
      : Array.isArray((root as { items?: unknown })?.items) ? (root as { items: unknown[] }).items : null;
    if (!items) throw new Error('JSON non reconnu : liste de visionnages attendue.');
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const value = item as Record<string, unknown>;
      const row = isTakeout(value) ? takeoutRow(value) : genericRow(value, platform);
      if (!row) continue;
      if (row.ts === null) { undated += 1; continue; }
      rawRows.push(row);
    }
  }

  // Dédoublonnage interne au fichier : un même titre revu garde le visionnage le plus récent.
  const byKey = new Map<string, RawRow>();
  for (const row of rawRows) {
    const key = rowKey(row);
    const known = byKey.get(key);
    if (!known || (row.ts ?? 0) > (known.ts ?? 0)) byKey.set(key, row);
  }
  const unique = [...byKey.values()].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const kept = unique.slice(0, MAX_EXTERNAL_WATCHES);
  const entries: PlayHistoryEntry[] = [];
  for (const row of kept) {
    const entry = toEntry(row);
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    throw new Error(undated > 0
      ? 'Aucune date exploitable : attends-toi à AAAA-MM-JJ ou MM/JJ/AAAA.'
      : 'Aucun visionnage reconnu dans ce fichier.');
  }
  return {
    entries,
    format,
    recognised: rawRows.length,
    undated,
    duplicates: rawRows.length - unique.length,
    truncated: unique.length - kept.length,
  };
}

/**
 * Fusionne deux imports : l'identité est éditoriale (titre + année + type), donc
 * réimporter le même fichier ne duplique rien et un film vu sur deux plateformes
 * garde le visionnage le plus récent.
 */
export function mergeExternalWatches(
  existing: PlayHistoryEntry[],
  incoming: PlayHistoryEntry[],
  cap = MAX_EXTERNAL_WATCHES,
): PlayHistoryEntry[] {
  const byKey = new Map<string, PlayHistoryEntry>();
  for (const entry of [...existing, ...incoming]) {
    if (!entry || typeof entry.channelId !== 'string' || !entry.name || typeof entry.ts !== 'number') continue;
    const key = `${entry.mediaKind === 'series' ? 'series' : 'movie'}|${normalizeForCompare(entry.name)}|${entry.year ?? ''}`;
    const known = byKey.get(key);
    if (!known || entry.ts > known.ts) byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.ts - a.ts).slice(0, cap);
}

/**
 * Films vus ailleurs que le catalogue propose aussi : ils servent d'amorces au
 * classement local (catégorie + titre) sans aucune requête réseau. Jointure par
 * identifiant TMDB quand il est fourni, sinon par titre exact et année compatible.
 */
export function externalSeeds(watches: PlayHistoryEntry[], items: CatalogItem[], playlistId: string): PlayHistoryEntry[] {
  if (!watches.length || !items.length) return [];
  const byTmdb = new Map<number, CatalogItem>();
  const byTitle = new Map<string, CatalogItem[]>();
  for (const item of items) {
    if (item.tmdbId) byTmdb.set(item.tmdbId, item);
    const key = normalizeForCompare(normalizeTitle(item.name).title);
    if (!key) continue;
    // Tous les homonymes sont gardés : l'ambiguïté se décide après le filtre
    // d'année, sinon un troisième remake identifiable par son année est jeté.
    const list = byTitle.get(key);
    if (list) list.push(item);
    else byTitle.set(key, [item]);
  }

  const seeds = new Map<string, PlayHistoryEntry>();
  for (const watch of watches) {
    if (!watch.name) continue;
    // Le rail est composé de films : une série du même nom (Fargo, Hannibal…)
    // amorcerait le mauvais titre.
    if (watch.mediaKind === 'series') continue;
    let item = watch.tmdbId ? byTmdb.get(watch.tmdbId) : undefined;
    if (!item) {
      const normalized = normalizeTitle(watch.name);
      const key = normalizeForCompare(normalized.title);
      const year = watch.year || normalized.year;
      const candidates = (byTitle.get(key) ?? []).filter(candidate => {
        if (!year) return true;
        const candidateYear = normalizeTitle(candidate.name).year;
        return !candidateYear || candidateYear === year;
      });
      // Deux titres identiques d'années différentes : rapprochement trop risqué.
      if (candidates.length !== 1) continue;
      item = candidates[0];
    }
    const channelId = `vod:${playlistId}:movie:${item.id}`;
    const known = seeds.get(channelId);
    if (known && known.ts >= watch.ts) continue;
    seeds.set(channelId, {
      channelId,
      ts: watch.ts,
      kind: 'vod',
      name: item.name,
      categoryId: item.categoryId,
      playlistId,
      mediaKind: 'movie',
      status: 'completed',
      ...(watch.platform ? { platform: watch.platform } : {}),
      ...(watch.tmdbId || item.tmdbId ? { tmdbId: watch.tmdbId ?? item.tmdbId } : {}),
    });
  }
  return [...seeds.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_EXTERNAL_SEEDS);
}

/** « 42 visionnages ailleurs (38 films) · Netflix 30, YouTube 12 » */
export function externalSummary(watches: PlayHistoryEntry[]): string {
  const counts = new Map<string, number>();
  for (const watch of watches) {
    // Les sauvegardes antérieures gardent le libellé brut (« prime video ») :
    // on le ramène à l'identifiant pour regrouper les deux formes.
    const id = watchPlatformId(watch.platform) || 'autre';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, total]) => `${platformLabel(id)} ${total}`);
  const movies = watches.filter(watch => watch.mediaKind !== 'series').length;
  const total = watches.length;
  return `${total} visionnage${total > 1 ? 's' : ''} ailleurs (${movies} film${movies > 1 ? 's' : ''})${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}
