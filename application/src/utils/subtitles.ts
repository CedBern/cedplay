import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getMeta, setMeta } from '@/utils/idb';
import { normalizeTitle, normalizeForCompare } from '@/utils/titleNormalize';
import { memoFetch } from '@/utils/memoFetch';

export type SubtitleLanguage = 'fr' | 'en' | 'es' | 'other';

export interface SubtitleTrack {
  id: string;
  name: string;
  lang: SubtitleLanguage;
  langCode: string;
  langLabel: string;
  url: string;
  format: 'srt' | 'vtt';
  isTranslated?: boolean | undefined;
  originalLang?: string | undefined;
  release?: string | undefined;
}

export interface SubtitleSearchQuery {
  title: string;
  year?: string | number | undefined;
  imdbId?: string | undefined;
  kind?: 'movie' | 'series' | undefined;
  season?: number | undefined;
  episode?: number | undefined;
}

export interface SubtitleApiKeys {
  openSubtitlesApiKey?: string | undefined;
  subdlApiKey?: string | undefined;
  deeplApiKey?: string | undefined;
}

/** Normalise les codes de langue pour regrouper Français, Anglais et Espagnol mexicain / latino */
export function normalizeSubtitleLang(code: string): { lang: SubtitleLanguage; label: string } {
  const c = (code || '').toLowerCase().trim();
  if (['fr', 'fre', 'fra', 'french', 'français'].includes(c)) {
    return { lang: 'fr', label: 'Français' };
  }
  if (['en', 'eng', 'english', 'anglais'].includes(c)) {
    return { lang: 'en', label: 'Anglais' };
  }
  if (['es', 'spa', 'es-mx', 'es-419', 'spanish', 'espagnol', 'mexican'].includes(c)) {
    return { lang: 'es', label: 'Espagnol (Mexique / Latam)' };
  }
  return { lang: 'other', label: code.toUpperCase() };
}

const isIdbAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

const WEB_FETCH_TIMEOUT_MS = 20_000;
interface CinemetaResult { metas?: { id?: string; imdb_id?: string; name?: string; releaseInfo?: string }[] }
interface SubtitleSearchResult {
  subtitles?: { id?: string; url?: string; lang?: string; subtitleFileName?: string; movieReleaseName?: string; releaseGroup?: string }[];
  data?: { attributes?: { language?: string; release?: string; files?: { file_id?: number }[] } }[];
}

/** fetch web avec timeout : un serveur muet ne doit pas bloquer des minutes. */
async function webFetch(url: string, init?: RequestInit, timeoutMs = WEB_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Recherche l'identifiant IMDb (ex: "tt1375666") via Cinemeta pour fiabiliser la recherche de sous-titres */
export function lookupImdbId(
  title: string,
  year?: string | number,
  kind: 'movie' | 'series' = 'movie'
): Promise<string | null> {
  const norm = normalizeTitle(title);
  const cleanTitle = norm.title || title;
  const targetYear = String(year || norm.year || '').trim();
  const cacheKey = `imdb_v2_${kind}_${cleanTitle.toLowerCase()}_${targetYear}`;
  // Déduplication en vol : deux appels simultanés pour le même titre = une seule requête.
  return memoFetch(cacheKey, async () => {
    if (isIdbAvailable()) {
      try {
        const cached = await getMeta<string>(cacheKey);
        if (cached) return cached;
      } catch {
        // cache read failure fallback
      }
    }

    const type = kind === 'series' ? 'series' : 'movie';
    const url = `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(cleanTitle)}.json`;

    try {
      let data: CinemetaResult;
      if (Capacitor.isNativePlatform()) {
        const res = await CapacitorHttp.get({
          url,
          headers: { 'User-Agent': 'LecteurIPTV/1.5' },
          connectTimeout: 8_000,
          readTimeout: 10_000,
        });
        data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      } else {
        const res = await webFetch(url);
        if (!res.ok) return null;
        data = await res.json();
      }

      const metas = Array.isArray(data?.metas) ? data.metas : [];
      if (!metas.length) return null;

      // Si on a l'année, chercher la correspondance la plus proche
      const matches = metas.filter(m => normalizeForCompare(m.name || '') === normalizeForCompare(cleanTitle)
        && (!targetYear || String(m.releaseInfo || '').slice(0, 4) === targetYear));
      const ids = new Set(matches.map(m => m.imdb_id || m.id));
      if (ids.size !== 1) return null;
      const best = matches[0];

      const imdbId = best?.imdb_id || best?.id;
      if (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt')) {
        if (isIdbAvailable()) await setMeta(cacheKey, imdbId);
        return imdbId;
      }
    } catch {
      // Échec non bloquant
    }
    return null;
  });
}

/**
 * Recherche les sous-titres disponibles pour un film ou un épisode de série.
 * Trie automatiquement les résultats : Français en priorité absolue,
 * puis Anglais et Espagnol mexicain en repli.
 */
export function searchSubtitles(
  query: SubtitleSearchQuery,
  keys?: SubtitleApiKeys
): Promise<SubtitleTrack[]> {
  // Déduplication en vol : un remontage de composant ne doit pas doubler les requêtes.
  const dedupKey = JSON.stringify(['searchsubs', query, keys?.openSubtitlesApiKey || '']);
  return memoFetch(dedupKey, () => searchSubtitlesInner(query, keys));
}

async function searchSubtitlesInner(
  query: SubtitleSearchQuery,
  keys?: SubtitleApiKeys
): Promise<SubtitleTrack[]> {
  const { title, year, kind = 'movie', season, episode } = query;
  let imdbId = query.imdbId;

  if (!imdbId) {
    imdbId = (await lookupImdbId(title, year, kind)) || undefined;
  }

  if (!imdbId) return [];

  const tracks: SubtitleTrack[] = [];
  const endpointType = kind === 'series' ? 'series' : 'movie';
  const endpointId = kind === 'series'
    ? `${imdbId}:${season || 1}:${episode || 1}`
    : imdbId;

  // 1. Source OpenSubtitles v3 bridge (rapide, sans clé requise)
  const stremioUrl = `https://opensubtitles-v3.strem.io/subtitles/${endpointType}/${endpointId}.json`;
  try {
    let data: SubtitleSearchResult = {};
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({
        url: stremioUrl,
        headers: { 'User-Agent': 'LecteurIPTV/1.5' },
        connectTimeout: 8_000,
        readTimeout: 12_000,
      });
      data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } else {
      const res = await webFetch(stremioUrl);
      if (res.ok) data = await res.json();
    }

    if (Array.isArray(data?.subtitles)) {
      for (const item of data.subtitles) {
        if (!item?.url) continue;
        const norm = normalizeSubtitleLang(item.lang || item.id || '');
        tracks.push({
          id: `os_${item.id || tracks.length}`,
          name: item.subtitleFileName || item.movieReleaseName || `${norm.label} (OpenSubtitles)`,
          lang: norm.lang,
          langCode: item.lang || 'und',
          langLabel: norm.label,
          url: item.url,
          format: item.url.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt',
          release: item.movieReleaseName || item.releaseGroup || undefined,
        });
      }
    }
  } catch {
    // Si la passerelle échoue, on continue vers les clés utilisateur si présentes
  }

  // 2. Source OpenSubtitles API v3 officielle (si clé API fournie dans les paramètres)
  if (keys?.openSubtitlesApiKey?.trim()) {
    try {
      const params = new URLSearchParams({
        imdb_id: imdbId.replace(/^tt/, ''),
        languages: 'fr,en,es',
        ...(kind === 'series' && season ? { season_number: String(season) } : {}),
        ...(kind === 'series' && episode ? { episode_number: String(episode) } : {}),
      });
      const apiUrl = `https://api.opensubtitles.com/api/v1/subtitles?${params.toString()}`;
      const headers = {
        'Api-Key': keys.openSubtitlesApiKey.trim(),
        'User-Agent': 'LecteurIPTV v1.5',
        Accept: 'application/json',
      };

      let osData: SubtitleSearchResult = {};
      if (Capacitor.isNativePlatform()) {
        const res = await CapacitorHttp.get({ url: apiUrl, headers });
        osData = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      } else {
        const res = await webFetch(apiUrl, { headers });
        if (res.ok) osData = await res.json();
      }

      if (Array.isArray(osData?.data)) {
        for (const entry of osData.data) {
          const file = entry.attributes?.files?.[0];
          if (!file?.file_id) continue;
          const langCode = entry.attributes?.language || 'und';
          const norm = normalizeSubtitleLang(langCode);
          tracks.push({
            id: `os_v3_${file.file_id}`,
            name: entry.attributes?.release || `${norm.label} (OS v3)`,
            lang: norm.lang,
            langCode,
            langLabel: norm.label,
            url: `https://api.opensubtitles.com/api/v1/download/${file.file_id}`,
            format: 'srt',
            release: entry.attributes?.release,
          });
        }
      }
    } catch {
      // Ignorer l'erreur d'API secondaire
    }
  }

  // 3. Tri strict selon la priorité demandée :
  // Priorité 1 : Français
  // Priorité 2 : Anglais et Espagnol mexicain / latino
  // Autres langues : en dernier
  return sortTracksByPriority(tracks);
}

/** Trie les pistes de sous-titres selon la règle métier : FR d'abord, puis EN et ES */
export function sortTracksByPriority(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const score = (t: SubtitleTrack): number => {
    if (t.isTranslated && t.lang === 'fr') return 0; // Traduction FR prête
    if (t.lang === 'fr') return 1;                  // FR natif
    if (t.lang === 'en') return 2;                  // EN (meilleure base de traduction ou lecture VO)
    if (t.lang === 'es') return 3;                  // ES mexicain/latam
    return 10;
  };

  return [...tracks].sort((a, b) => score(a) - score(b));
}

/** Télécharge le contenu texte d'un sous-titre.
 *  Pour l'API officielle OpenSubtitles v3, la clé API est transmise en en-tête
 *  (sans elle, le téléchargement renvoie 401). */
export function downloadSubtitleText(url: string, apiKeys?: SubtitleApiKeys): Promise<string> {
  // Déduplication en vol (le même fichier peut être demandé deux fois).
  return memoFetch(`subdl_${url}`, async () => {
    let downloadUrl = url;
    const officialFile = url.match(/^https:\/\/api\.opensubtitles\.com\/api\/v1\/download\/(\d+)$/);
    if (officialFile) {
      if (!apiKeys?.openSubtitlesApiKey?.trim()) throw new Error('Clé OpenSubtitles nécessaire.');
      const headers = { 'User-Agent': 'LecteurIPTV v1.5', 'Api-Key': apiKeys.openSubtitlesApiKey.trim(), 'Content-Type': 'application/json' };
      const endpoint = 'https://api.opensubtitles.com/api/v1/download';
      const body = { file_id: Number(officialFile[1]) };
      let data: { link?: string };
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.post({ url: endpoint, headers, data: body, connectTimeout: 10000, readTimeout: 15000 });
        if (response.status < 200 || response.status >= 300) throw new Error('Téléchargement refusé par OpenSubtitles.');
        data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      } else {
        const response = await webFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) throw new Error('Téléchargement refusé par OpenSubtitles.');
        data = await response.json();
      }
      if (!data.link || !data.link.startsWith('https://')) throw new Error('Lien de sous-titres absent.');
      downloadUrl = data.link;
    }
    const headers: Record<string, string> = { 'User-Agent': 'LecteurIPTV/1.5' };
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({
        url: downloadUrl,
        headers,
        connectTimeout: 10_000,
        readTimeout: 15_000,
      });
      if (res.status < 200 || res.status >= 300) throw new Error('Sous-titre indisponible.');
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    }
    const res = await webFetch(downloadUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  });
}

/** Clé de cache pour un sous-titre téléchargé ou traduit */
export function getSubtitleCacheKey(mediaKey: string, lang = 'fr'): string {
  return `sub_v2_${mediaKey}_${lang}`;
}

/** Récupère un sous-titre mis en cache localement */
export async function getCachedSubtitle(
  mediaKey: string,
  lang = 'fr'
): Promise<{ srt: string; vtt: string } | null> {
  if (!isIdbAvailable()) return null;
  try {
    const data = await getMeta<{ srt: string; vtt: string; savedAt: number }>(
      getSubtitleCacheKey(mediaKey, lang)
    );
    if (data?.srt && data?.vtt) return { srt: data.srt, vtt: data.vtt };
  } catch {
    // ignore
  }
  return null;
}

/** Enregistre un sous-titre en cache local IndexedDB pour ne pas avoir à le re-télécharger ou re-traduire */
export async function saveCachedSubtitle(
  mediaKey: string,
  lang: string,
  srt: string,
  vtt: string
): Promise<void> {
  if (!isIdbAvailable()) return;
  try {
    await setMeta(getSubtitleCacheKey(mediaKey, lang), {
      srt,
      vtt,
      savedAt: Date.now(),
    });
  } catch {
    // ignore
  }
}
