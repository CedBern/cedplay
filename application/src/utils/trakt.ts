import type { PlayHistoryEntry } from '@/utils/idb';
import { getExternalWatches, saveExternalWatches } from '@/utils/idb';
import { mergeExternalWatches } from '@/utils/externalWatch';
import { normalizeForCompare, normalizeTitle } from '@/utils/titleNormalize';
import { StorageManager, type AppSettings } from '@/utils/storage';

export const TRAKT_API_URL = 'https://api.trakt.tv';
export const TRAKT_ACTIVATE_URL = 'https://trakt.tv/activate';

/** Identifiant client officiel CedPlay (remplaçable dans les réglages par un identifiant personnel). */
export const DEFAULT_TRAKT_CLIENT_ID = '37e19da8e80be9519ce77d2da5040eeb2d29dfefcf18c5e9336d37651a51a80d';
const TRAKT_FETCH_TIMEOUT_MS = 10_000;

async function fetchTraktWithTimeout(url: string, init: RequestInit, timeoutMs = TRAKT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchPromise = fetch(url, { ...init, signal: controller.signal });
  fetchPromise.catch(() => {});
  try {
    return await Promise.race([
      fetchPromise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export class TraktError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'TraktError';
  }
}

export interface TraktDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface TraktTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  created_at: number;
}

export interface TraktUser {
  username: string;
  name?: string | undefined;
  vip?: boolean | undefined;
}

export interface TraktHistoryItem {
  id: number;
  watched_at: string;
  action: string;
  type: 'movie' | 'episode';
  movie?: {
    title: string;
    year?: number;
    ids?: {
      trakt?: number;
      slug?: string;
      imdb?: string;
      tmdb?: number;
    };
  };
  show?: {
    title: string;
    year?: number;
    ids?: {
      trakt?: number;
      slug?: string;
      imdb?: string;
      tmdb?: number;
    };
  };
  episode?: {
    season: number;
    number: number;
    title?: string;
    ids?: {
      trakt?: number;
      imdb?: string;
      tmdb?: number;
    };
  };
}

export interface TraktScrobblePayload {
  kind: 'movie' | 'series';
  title: string;
  year?: number | string | undefined;
  season?: number | undefined;
  episode?: number | undefined;
  tmdbId?: number | undefined;
  progress: number; // 0..100
}

export type TraktPollStatus =
  | { status: 'success'; tokens: TraktTokenResponse }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

function traktHeaders(clientId?: string, accessToken?: string): Record<string, string> {
  const key = (clientId?.trim() || DEFAULT_TRAKT_CLIENT_ID).trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': key,
  };
  if (accessToken?.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }
  return headers;
}

/** Vérifie si un compte Trakt est connecté dans les réglages. */
export function isTraktConnected(settings?: Partial<AppSettings> | null): boolean {
  return typeof settings?.traktToken === 'string' && settings.traktToken.trim().length > 0;
}

/**
 * 1. Demande d'un code appareil pour l'autorisation OAuth sur TV ou mobile.
 * L'utilisateur reçoit un `user_code` à saisir sur https://trakt.tv/activate.
 */
export async function requestDeviceCode(clientId?: string): Promise<TraktDeviceCodeResponse> {
  const key = (clientId?.trim() || DEFAULT_TRAKT_CLIENT_ID).trim();
  let res: Response;
  try {
    res = await fetch(`${TRAKT_API_URL}/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: key }),
    });
  } catch (err) {
    throw new TraktError(`Impossible de contacter Trakt : ${err instanceof Error ? err.message : 'erreur réseau'}`);
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new TraktError(`Échec de génération du code appareil Trakt (${res.status}) : ${errorText || res.statusText}`, res.status);
  }

  const data = await res.json();
  return {
    device_code: String(data.device_code),
    user_code: String(data.user_code),
    verification_url: data.verification_url ? String(data.verification_url) : TRAKT_ACTIVATE_URL,
    expires_in: Number(data.expires_in) || 600,
    interval: Number(data.interval) || 5,
  };
}

/**
 * 2. Sondage du token auprès de Trakt.
 * Doit être appelé à intervalle régulier (défini par `interval`, généralement 5s) pendant que
 * l'utilisateur saisit son code.
 */
export async function pollDeviceToken(
  deviceCode: string,
  clientId?: string,
  clientSecret?: string,
  signal?: AbortSignal,
): Promise<TraktPollStatus> {
  const key = (clientId?.trim() || DEFAULT_TRAKT_CLIENT_ID).trim();
  const body: Record<string, string> = {
    code: deviceCode,
    client_id: key,
  };
  if (clientSecret?.trim()) {
    body.client_secret = clientSecret.trim();
  }

  try {
    const fetchInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (signal) {
      fetchInit.signal = signal;
    }
    const res = await fetch(`${TRAKT_API_URL}/oauth/device/token`, fetchInit);

    if (res.status === 200) {
      const tokens: TraktTokenResponse = await res.json();
      return { status: 'success', tokens };
    }
    if (res.status === 400) {
      // Pending : l'utilisateur n'a pas encore validé
      return { status: 'pending' };
    }
    if (res.status === 404 || res.status === 410) {
      // Code expiré ou inconnu
      return { status: 'expired' };
    }
    if (res.status === 418) {
      // Demande refusée par l'utilisateur
      return { status: 'denied' };
    }
    if (res.status === 429) {
      // Sondage trop rapide
      return { status: 'slow_down' };
    }

    const err = await res.text().catch(() => '');
    return { status: 'error', message: `Erreur Trakt (${res.status}) : ${err}` };
  } catch (error) {
    if (signal?.aborted) {
      return { status: 'error', message: 'Annulé' };
    }
    return { status: 'error', message: error instanceof Error ? error.message : 'Erreur réseau Trakt' };
  }
}

/**
 * 3. Renouvellement du jeton Trakt via refresh_token.
 */
export async function refreshTraktToken(
  refreshToken: string,
  clientId?: string,
  clientSecret?: string,
): Promise<TraktTokenResponse> {
  const key = (clientId?.trim() || DEFAULT_TRAKT_CLIENT_ID).trim();
  const body: Record<string, string> = {
    refresh_token: refreshToken.trim(),
    client_id: key,
    grant_type: 'refresh_token',
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
  };
  if (clientSecret?.trim()) {
    body.client_secret = clientSecret.trim();
  }

  let res: Response;
  try {
    res = await fetchTraktWithTimeout(`${TRAKT_API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new TraktError(`Impossible de contacter Trakt : ${err instanceof Error ? err.message : 'erreur réseau'}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new TraktError(`Échec du renouvellement du jeton Trakt (${res.status}) : ${errText || res.statusText}`, res.status);
  }

  return res.json();
}

const inFlightTokenRefresh = new Map<string, Promise<Partial<AppSettings> & { traktToken: string }>>();

/**
 * Obtient un jeton d'accès Trakt valide, en le renouvelant automatiquement s'il arrive à expiration.
 */
export async function getValidTraktAccessToken(
  settings: Partial<AppSettings>,
  onSettingsUpdated?: (patch: Partial<AppSettings>) => void | Promise<void>,
  forceRefresh = false,
): Promise<string | null> {
  const token = settings.traktToken?.trim();
  if (!token) return null;

  const expiresAt = settings.traktExpiresAt;
  const refreshToken = settings.traktRefreshToken?.trim();
  const isExpiringSoon = typeof expiresAt === 'number' && expiresAt > 0 && Date.now() >= expiresAt - 10 * 60 * 1000;

  if ((forceRefresh || isExpiringSoon) && refreshToken) {
    try {
      let refreshPromise = inFlightTokenRefresh.get(refreshToken);
      if (!refreshPromise) {
        refreshPromise = refreshTraktToken(refreshToken, settings.traktClientId, settings.traktClientSecret)
          .then((newTokens) => ({
            traktToken: newTokens.access_token,
            traktRefreshToken: newTokens.refresh_token,
            traktExpiresAt: (newTokens.created_at + newTokens.expires_in) * 1000,
          }))
          .finally(() => {
            inFlightTokenRefresh.delete(refreshToken);
          });
        inFlightTokenRefresh.set(refreshToken, refreshPromise);
      }
      const patch = await refreshPromise;
      if (onSettingsUpdated) {
        await onSettingsUpdated(patch);
      }
      return patch.traktToken;
    } catch {
      // Si le refresh forcé échoue, ne pas renvoyer le token révoqué
      return forceRefresh ? null : token;
    }
  }

  return token;
}

/**
 * 4. Récupération du profil utilisateur Trakt (@username).
 */
export async function fetchTraktUserProfile(accessToken: string, clientId?: string): Promise<TraktUser> {
  let res: Response;
  try {
    res = await fetch(`${TRAKT_API_URL}/users/me`, {
      headers: traktHeaders(clientId, accessToken),
    });
  } catch (err) {
    throw new TraktError(`Impossible de contacter Trakt : ${err instanceof Error ? err.message : 'erreur réseau'}`);
  }

  if (res.status === 401) {
    throw new TraktError('Jeton Trakt non autorisé ou expiré (401).', 401);
  }
  if (!res.ok) {
    throw new TraktError(`Impossible de récupérer le profil Trakt (${res.status})`, res.status);
  }

  const data = await res.json();
  return {
    username: String(data.username || data.ids?.slug || 'utilisateur'),
    name: data.name ? String(data.name) : undefined,
    vip: Boolean(data.vip),
  };
}

/**
 * 5. Récupère l'historique récent des films et épisodes vus sur Trakt.
 * Lève une exception claire en cas de refus d'authentification (401/403) ou d'erreur réseau,
 * sans masquer les échecs par des listes vides.
 */
export async function fetchTraktHistory(
  accessToken: string,
  options: { limit?: number | undefined; clientId?: string | undefined } = {},
): Promise<TraktHistoryItem[]> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const headers = traktHeaders(options.clientId, accessToken);

  let moviesRes: Response;
  let episodesRes: Response;
  try {
    [moviesRes, episodesRes] = await Promise.all([
      fetch(`${TRAKT_API_URL}/sync/history/movies?limit=${limit}`, { headers }),
      fetch(`${TRAKT_API_URL}/sync/history/episodes?limit=${limit}`, { headers }),
    ]);
  } catch (err) {
    throw new TraktError(`Impossible de contacter Trakt : ${err instanceof Error ? err.message : 'erreur réseau'}`);
  }

  if (moviesRes.status === 401 || episodesRes.status === 401) {
    throw new TraktError('Jeton Trakt non autorisé ou expiré (401). Reconnecte ton compte.', 401);
  }
  if (moviesRes.status === 403 || episodesRes.status === 403) {
    throw new TraktError('Accès Trakt refusé (403). Vérifie les autorisations.', 403);
  }
  if (!moviesRes.ok) {
    throw new TraktError(`Erreur Trakt films (${moviesRes.status}) : ${moviesRes.statusText}`, moviesRes.status);
  }
  if (!episodesRes.ok) {
    throw new TraktError(`Erreur Trakt séries (${episodesRes.status}) : ${episodesRes.statusText}`, episodesRes.status);
  }

  const movies: TraktHistoryItem[] = await moviesRes.json().catch(() => []);
  const episodes: TraktHistoryItem[] = await episodesRes.json().catch(() => []);

  const combined = [...(Array.isArray(movies) ? movies : []), ...(Array.isArray(episodes) ? episodes : [])];
  combined.sort((a, b) => Date.parse(b.watched_at || '0') - Date.parse(a.watched_at || '0'));
  return combined.slice(0, limit);
}

/**
 * 6. Convertit l'historique Trakt en entrées `PlayHistoryEntry` pour alimenter
 * le profil de goût et les recommandations de CedPlay (« Vu ailleurs » / « Pour toi »).
 * IMPORTANT : Pour une série, l'identifiant TMDB de la SÉRIE (show.ids.tmdb) est affecté à tmdbId,
 * et l'identifiant de l'épisode est conservé dans episodeTmdbId.
 */
export function traktHistoryToWatchEntries(history: TraktHistoryItem[]): PlayHistoryEntry[] {
  return history
    .map(item => {
      const ts = Date.parse(item.watched_at || '');
      if (Number.isNaN(ts) || ts <= 0) return null;

      if (item.type === 'movie' && item.movie) {
        const title = (item.movie.title || '').trim();
        if (!title) return null;
        const tmdbId = item.movie.ids?.tmdb;
        const year = item.movie.year ? String(item.movie.year) : undefined;
        return {
          channelId: `trakt:movie:${tmdbId || normalizeForCompare(title)}`,
          channelName: title,
          name: title,
          ts,
          mediaKind: 'movie',
          kind: 'vod',
          status: 'completed',
          positionMs: 100,
          durationMs: 100,
          completed: true,
          platform: 'trakt',
          sourceId: tmdbId ? String(tmdbId) : undefined,
          ...(tmdbId ? { tmdbId } : {}),
          ...(year ? { year } : {}),
        } as PlayHistoryEntry;
      }

      if (item.type === 'episode' && item.episode && item.show) {
        const showTitle = (item.show.title || '').trim();
        if (!showTitle) return null;
        const season = item.episode.season;
        const epNum = item.episode.number;
        const epTitle = (item.episode.title || '').trim();
        // Utiliser impérativement l'identifiant TMDB de la série comme tmdbId
        const showTmdbId = item.show.ids?.tmdb;
        const episodeTmdbId = item.episode.ids?.tmdb;
        const year = item.show.year ? String(item.show.year) : undefined;

        const displayName = `${showTitle} S${season}E${epNum}${epTitle ? ` · ${epTitle}` : ''}`;
        return {
          channelId: `trakt:series:${showTmdbId || normalizeForCompare(showTitle)}:s${season}e${epNum}`,
          channelName: displayName,
          name: showTitle,
          episodeName: epTitle || `Épisode ${epNum}`,
          season,
          episode: epNum,
          ts,
          mediaKind: 'series',
          kind: 'vod',
          status: 'completed',
          positionMs: 100,
          durationMs: 100,
          completed: true,
          platform: 'trakt',
          sourceId: showTmdbId ? String(showTmdbId) : undefined,
          ...(showTmdbId ? { tmdbId: showTmdbId } : {}),
          ...(episodeTmdbId ? { episodeTmdbId } : {}),
          ...(year ? { year } : {}),
        } as PlayHistoryEntry;
      }

      return null;
    })
    .filter((e): e is PlayHistoryEntry => e !== null);
}

/**
 * 7. Synchronise l'historique Trakt avec le stockage local « Vu ailleurs » de CedPlay.
 */
export async function syncTraktHistory(
  accessToken: string,
  clientId?: string,
): Promise<{ added: number; total: number }> {
  // Purger les scrobbles en attente en tâche de fond
  void flushPendingTraktScrobbles().catch(() => {});

  const history = await fetchTraktHistory(accessToken, { limit: 50, ...(clientId ? { clientId } : {}) });
  const entries = traktHistoryToWatchEntries(history);
  if (entries.length === 0) {
    const existing = await getExternalWatches();
    return { added: 0, total: existing.length };
  }

  const existing = await getExternalWatches();
  const merged = mergeExternalWatches(existing, entries);
  await saveExternalWatches(merged);

  const added = Math.max(0, merged.length - existing.length);
  return { added, total: merged.length };
}

/**
 * 8. Scrobble de lecture vers Trakt (start, pause, stop).
 * Supporte les retries en cas d'instabilité réseau ou coupure temporaire.
 * Ne bloque et ne lève jamais d'erreur afin de ne jamais interrompre la lecture.
 */
export async function scrobbleTrakt(
  action: 'start' | 'pause' | 'stop',
  payload: TraktScrobblePayload,
  accessToken: string,
  clientId?: string,
  onUnauthorized?: () => Promise<string | null>,
  maxRetries = 0,
): Promise<boolean> {
  if (!accessToken?.trim() || !payload.title?.trim()) return false;

  const progress = Math.min(100, Math.max(0, Math.round(payload.progress)));
  const parsedYear = typeof payload.year === 'number'
    ? payload.year
    : typeof payload.year === 'string'
      ? parseInt(payload.year, 10) || undefined
      : normalizeTitle(payload.title).year ? parseInt(normalizeTitle(payload.title).year!, 10) : undefined;

  let body: Record<string, unknown>;

  if (payload.kind === 'movie') {
    body = {
      movie: {
        title: normalizeTitle(payload.title).title || payload.title,
        ...(parsedYear ? { year: parsedYear } : {}),
        ...(payload.tmdbId ? { ids: { tmdb: payload.tmdbId } } : {}),
      },
      progress,
    };
  } else {
    // Pour une série, Trakt exige un numéro de saison et d'épisode.
    // Ne jamais envoyer un faux S01E01 ou déduire arbitrairement la saison 1 si la saison est inconnue !
    const season = payload.season;
    const episodeNum = payload.episode;
    if (season === undefined || episodeNum === undefined) {
      return false;
    }
    body = {
      show: {
        title: normalizeTitle(payload.title).title || payload.title,
        ...(parsedYear ? { year: parsedYear } : {}),
        ...(payload.tmdbId ? { ids: { tmdb: payload.tmdbId } } : {}),
      },
      episode: {
        season,
        number: episodeNum,
      },
      progress,
    };
  }

  let tokenToUse = accessToken;
  const attempts = Math.max(1, 1 + maxRetries);

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      let res = await fetchTraktWithTimeout(`${TRAKT_API_URL}/scrobble/${action}`, {
        method: 'POST',
        headers: traktHeaders(clientId, tokenToUse),
        body: JSON.stringify(body),
      });

      // En cas de jeton non autorisé (401), si un renouvellement est possible, retenter une fois
      if (res.status === 401 && onUnauthorized) {
        const refreshed = await onUnauthorized();
        if (refreshed?.trim()) {
          tokenToUse = refreshed;
          res = await fetchTraktWithTimeout(`${TRAKT_API_URL}/scrobble/${action}`, {
            method: 'POST',
            headers: traktHeaders(clientId, tokenToUse),
            body: JSON.stringify(body),
          });
        }
      }

      if (res.status === 201 || res.status === 200) {
        return true;
      }

      // Si erreur 4xx (autre que 401 ou 429), la requête est irrecevable, inutile de retenter
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return false;
      }
    } catch {
      // Erreur réseau ou timeout : continue vers la prochaine tentative s'il en reste
    }

    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  return false;
}

/**
 * Extrait le numéro de saison et d'épisode depuis un texte ou libellé d'épisode.
 * Retourne les numéros reconnus ou un objet vide si non déterminés (aucun repli aveugle sur S01E01).
 */
export function parseSeasonAndEpisode(text?: string): { season?: number; episode?: number } {
  if (!text) return {};
  const matchSxE = text.match(/\b[sS](\d+)\s*[eE](\d+)\b/);
  if (matchSxE) {
    return { season: parseInt(matchSxE[1], 10), episode: parseInt(matchSxE[2], 10) };
  }
  const matchX = text.match(/\b(\d+)x(\d+)\b/);
  if (matchX) {
    return { season: parseInt(matchX[1], 10), episode: parseInt(matchX[2], 10) };
  }
  const matchEp = text.match(/(?:^|[\s._-])(?:episode|épisode)\s*(\d+)/i);
  if (matchEp) {
    return { episode: parseInt(matchEp[1], 10) };
  }
  return {};
}

export interface PendingStopRequest {
  entry: PlayHistoryEntry;
  positionMs: number;
  durationMs: number;
  ended: boolean;
  settings: Partial<AppSettings>;
  onSettingsUpdated?: ((patch: Partial<AppSettings>) => void | Promise<void>) | undefined;
  isClosed: boolean;
  watchDurationMs?: number | undefined;
}

export interface ScrobbleSessionState {
  start: boolean;
  stop: boolean;
  starting?: boolean;
  stopping?: boolean;
  startPromise?: Promise<boolean> | undefined;
  pendingStop?: PendingStopRequest | undefined;
  pendingStopPromise?: Promise<boolean> | undefined;
  initialPositionMs?: number;
}

const scrobbledSessions = new Map<string, ScrobbleSessionState>();

/** Réinitialise le suivi des sessions de scrobble (pour tests et changement de profil). */
export function resetScrobbleSessions(): void {
  scrobbledSessions.clear();
  activeFlushPromise = null;
}

export interface PendingTraktScrobble {
  action: 'start' | 'stop';
  payload: TraktScrobblePayload;
  sessionKey: string;
  clientId?: string | undefined;
  timestamp: number;
}

const PENDING_SCROBBLES_STORAGE_KEY = 'cedplay_trakt_pending_scrobbles';

export function getPendingTraktScrobbles(): PendingTraktScrobble[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PENDING_SCROBBLES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePendingTraktScrobbles(items: PendingTraktScrobble[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (items.length === 0) {
      localStorage.removeItem(PENDING_SCROBBLES_STORAGE_KEY);
    } else {
      const bounded = items.slice(-30);
      localStorage.setItem(PENDING_SCROBBLES_STORAGE_KEY, JSON.stringify(bounded));
    }
  } catch {
    // quota ou stockage indisponible non-bloquant
  }
}

export function enqueuePendingTraktScrobble(scrobble: PendingTraktScrobble): void {
  const current = getPendingTraktScrobbles();
  const filtered = current.filter(s => !(s.sessionKey === scrobble.sessionKey && s.action === scrobble.action));
  filtered.push(scrobble);
  savePendingTraktScrobbles(filtered);
}

export function removePendingTraktScrobble(sessionKey: string, action: 'start' | 'stop'): void {
  const current = getPendingTraktScrobbles();
  const filtered = current.filter(s => !(s.sessionKey === sessionKey && s.action === action));
  savePendingTraktScrobbles(filtered);
}

export function clearPendingTraktScrobbles(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PENDING_SCROBBLES_STORAGE_KEY);
    }
  } catch {
    // localStorage inaccessible
  }
}

let activeFlushPromise: Promise<number> | null = null;

async function doFlushPendingTraktScrobbles(
  settings?: Partial<AppSettings> | null,
  onSettingsUpdated?: (patch: Partial<AppSettings>) => void | Promise<void>,
): Promise<number> {
  const effectiveSettings = settings ?? StorageManager.getCachedSettings();
  if (!isTraktConnected(effectiveSettings) || effectiveSettings?.traktScrobble === false) {
    return 0;
  }
  const pending = getPendingTraktScrobbles();
  if (pending.length === 0) {
    return 0;
  }

  let currentSettings: Partial<AppSettings> = { ...effectiveSettings };
  const tokenUpdater = async (patch: Partial<AppSettings>) => {
    currentSettings = { ...currentSettings, ...patch };
    if (onSettingsUpdated) {
      await onSettingsUpdated(patch);
      return;
    }
    try {
      await StorageManager.saveSettings(patch);
    } catch {
      // sauvegarde asynchrone non-bloquante
    }
  };

  const validToken = await getValidTraktAccessToken(currentSettings, tokenUpdater);
  if (!validToken) {
    return 0;
  }

  let flushedCount = 0;

  for (const item of pending) {
    const handleUnauthorized = () => getValidTraktAccessToken(currentSettings, tokenUpdater, true);
    const ok = await scrobbleTrakt(
      item.action,
      item.payload,
      currentSettings.traktToken?.trim() || validToken,
      item.clientId || currentSettings.traktClientId,
      handleUnauthorized,
      1,
    );
    if (ok) {
      flushedCount++;
      // Retrait atomique de l'élément réussi : ne touche pas aux nouveaux scrobbles ajoutés pendant l'attente
      removePendingTraktScrobble(item.sessionKey, item.action);
      const session = scrobbledSessions.get(item.sessionKey);
      if (session) {
        if (item.action === 'stop') session.stop = true;
        else session.start = true;
      }
    } else {
      // Si l'élément a plus de 7 jours, le purger
      if (Date.now() - item.timestamp >= 7 * 24 * 3600 * 1000) {
        removePendingTraktScrobble(item.sessionKey, item.action);
      }
    }
  }

  return flushedCount;
}

/**
 * Rejoue les scrobbles qui n'ont pas pu être transmis (ex: fermeture hors-ligne sur Android).
 * Mutex intégré : élimine les vidages parallèles concurrents.
 * Vérifie explicitement que traktScrobble n'est pas désactivé.
 * Suppression atomique : ne supprime que les éléments transmis avec succès, sans écraser les ajouts survenus pendant le vidage.
 */
export async function flushPendingTraktScrobbles(
  settings?: Partial<AppSettings> | null,
  onSettingsUpdated?: (patch: Partial<AppSettings>) => void | Promise<void>,
): Promise<number> {
  if (activeFlushPromise) {
    return activeFlushPromise;
  }
  const promise = doFlushPendingTraktScrobbles(settings, onSettingsUpdated);
  activeFlushPromise = promise;
  try {
    return await promise;
  } finally {
    if (activeFlushPromise === promise) {
      activeFlushPromise = null;
    }
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => {
    void flushPendingTraktScrobbles().catch(() => {});
  });
}

/**
 * Déclenche automatiquement le scrobble Trakt lors de l'avancement de lecture d'une VOD.
 * - Start : dès 5 secondes de lecture effective stabilisée (en cours de lecture active).
 * - Stop : lors de la fin de vidéo, à la fermeture du lecteur, ou dès que la progression atteint 80 %.
 * - Verrous posés avant le premier await avec libération dans un finally couvrant toute l'opération.
 * - Exclusion mutuelle absolue : impossible d'émettre start si stop est en vol ou déjà envoyé, et vice versa.
 * - Ne scrobble jamais sur une simple reprise fermée immédiatement (distingue position et temps regardé).
 * - Retentes et file d'attente hors-ligne en cas d'échec à la fermeture du lecteur.
 */
export async function maybeScrobbleTrakt(
  entry: PlayHistoryEntry,
  positionMs: number,
  durationMs: number,
  ended = false,
  settings?: Partial<AppSettings> | null,
  sessionId?: string,
  onSettingsUpdated?: (patch: Partial<AppSettings>) => void | Promise<void>,
  isClosed = false,
  watchDurationMs?: number,
): Promise<boolean> {
  const effectiveSettings = settings ?? StorageManager.getCachedSettings();
  const entryTitle = entry.name?.trim();
  if (!isTraktConnected(effectiveSettings) || effectiveSettings?.traktScrobble === false || durationMs <= 0 || !entryTitle) {
    return false;
  }

  // Tenter de purger en tâche de fond les scrobbles en attente
  void flushPendingTraktScrobbles(effectiveSettings, onSettingsUpdated).catch(() => {});

  // Clé de session stable : ne dépend PAS de entry.ts qui varie à chaque tick de sauvegarde
  const sessionKey = sessionId?.trim() || entry.channelId || `${entry.name}:${entry.mediaKind ?? 'movie'}`;
  let session = scrobbledSessions.get(sessionKey);
  if (!session) {
    session = { start: false, stop: false, initialPositionMs: positionMs };
    scrobbledSessions.set(sessionKey, session);
    if (scrobbledSessions.size > 50) {
      const firstKey = scrobbledSessions.keys().next().value;
      if (firstKey) scrobbledSessions.delete(firstKey);
    }
  }

  const progress = Math.min(100, Math.max(0, (positionMs / durationMs) * 100));
  const isSeries = entry.mediaKind === 'series';
  const parsed = isSeries ? parseSeasonAndEpisode(entry.episodeName || entry.name) : {};
  const season = entry.season ?? parsed.season;
  const episode = entry.episode ?? parsed.episode;

  // Temps réellement regardé au cours de cette session :
  // Si watchDurationMs est fourni par le lecteur (Web ou Android natif), on s'y fie rigoureusement
  // pour distinguer une reprise à 40 min immédiatement fermée d'un visionnage effectif de 5 secondes.
  // Sinon (appels sans durée explicite / tests), on se réfère à la position de lecture (positionMs >= 5000).
  const hasWatchedMin = watchDurationMs !== undefined
    ? watchDurationMs >= 5000
    : positionMs >= 5000;

  // Définition rigoureuse des conditions de déclenchement :
  // Exclusion mutuelle totale entre start et stop, sans aucune brèche de concurrence :
  // - Stop : impossible si déjà arrêté (stop) ou si un stop est déjà en vol. Si un start est en vol,
  //   on conserve la demande d'arrêt et on l'envoie immédiatement après la fin du start.
  // - Start : impossible si fermé, si déjà démarré (start), si un start est en vol, OU si un stop a déjà eu lieu ou est en vol !
  const stopCondition = (ended || hasWatchedMin) && (ended || progress >= 80 || isClosed) && !session.stop && !session.stopping;
  if (stopCondition && session.starting) {
    const prev = session.pendingStop;
    session.pendingStop = {
      entry,
      positionMs,
      durationMs,
      ended: (prev?.ended ?? false) || ended,
      settings: effectiveSettings,
      onSettingsUpdated,
      isClosed: (prev?.isClosed ?? false) || isClosed,
      watchDurationMs: watchDurationMs !== undefined
        ? Math.max(prev?.watchDurationMs ?? 0, watchDurationMs)
        : prev?.watchDurationMs,
    };
    if (!session.pendingStopPromise && session.startPromise) {
      session.pendingStopPromise = session.startPromise.catch(() => false).then(() => {
        const pending = session.pendingStop;
        session.pendingStop = undefined;
        session.pendingStopPromise = undefined;
        if (!pending) return false;
        return maybeScrobbleTrakt(
          pending.entry,
          pending.positionMs,
          pending.durationMs,
          pending.ended,
          pending.settings,
          sessionKey,
          pending.onSettingsUpdated,
          pending.isClosed,
          pending.watchDurationMs,
        );
      });
    }
    return session.pendingStopPromise ? await session.pendingStopPromise : false;
  }

  const shouldStop = stopCondition && !session.starting;
  const shouldStart = hasWatchedMin && !isClosed && !session.start && !session.starting && !session.stop && !session.stopping;

  if (!shouldStop && !shouldStart) {
    return false;
  }

  const action: 'stop' | 'start' = shouldStop ? 'stop' : 'start';

  // VERROUILLAGE SYNCHRONE IMMÉDIAT AVANT LE PREMIER AWAIT :
  // Neutralise les appels concurrents dans le même tick ou pendant l'attente du jeton.
  if (action === 'stop') {
    session.stopping = true;
  } else {
    session.starting = true;
  }

  const execute = async (): Promise<boolean> => {
    try {
      let currentSettings: Partial<AppSettings> = { ...effectiveSettings };
      const tokenUpdater = async (patch: Partial<AppSettings>) => {
        currentSettings = { ...currentSettings, ...patch };
        if (onSettingsUpdated) {
          await onSettingsUpdated(patch);
          return;
        }
        try {
          await StorageManager.saveSettings(patch);
        } catch {
          // sauvegarde asynchrone non-bloquante
        }
      };

      // Renouvellement automatique du jeton s'il est expiré ou proche de l'expiration (< 10 min)
      const validToken = await getValidTraktAccessToken(currentSettings, tokenUpdater);
      if (!validToken) {
        return false;
      }

      const payload: TraktScrobblePayload = {
        kind: isSeries ? 'series' : 'movie',
        title: entryTitle,
        ...(season !== undefined ? { season } : {}),
        ...(episode !== undefined ? { episode } : {}),
        ...(entry.tmdbId ? { tmdbId: entry.tmdbId } : {}),
        ...(entry.year ? { year: entry.year } : {}),
        progress,
      };

      const handleUnauthorized = () => getValidTraktAccessToken(currentSettings, tokenUpdater, true);

      // À la fermeture du lecteur, retenter jusqu'à 2 fois en cas d'instabilité réseau
      const ok = await scrobbleTrakt(
        action,
        payload,
        validToken,
        effectiveSettings.traktClientId,
        handleUnauthorized,
        isClosed ? 2 : 0,
      );

      if (ok) {
        if (action === 'stop') {
          session.stop = true;
        } else {
          session.start = true;
        }
        return true;
      }

      // Si le scrobble final de fermeture a échoué malgré les retries (ex: appareil hors-ligne),
      // on l'enregistre dans la file d'attente persistante pour envoi dès rétablissement du réseau.
      if (action === 'stop' && isClosed) {
        enqueuePendingTraktScrobble({
          action: 'stop',
          payload,
          sessionKey,
          clientId: effectiveSettings.traktClientId,
          timestamp: Date.now(),
        });
      }

      return false;
    } finally {
      // Libération garantie du verrou dans le finally couvrant l'ensemble de l'opération
      if (action === 'stop') {
        session.stopping = false;
      } else {
        session.starting = false;
        session.startPromise = undefined;
      }
    }
  };

  const executionPromise = execute();
  if (action === 'start') {
    session.startPromise = executionPromise;
  }
  return await executionPromise;
}
