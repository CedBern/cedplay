import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { desktopHttp, isDesktopRuntime } from '@/utils/desktopBridge';

export interface BodlavDocumentary {
  id: string;
  title: string;
  url: string;
  image?: string;
  year?: string;
  language?: string;
}

export const BODLAV_ORIGIN = 'https://bodlav.com';
export const BODLAV_CACHE_KEY = 'cedplay_bodlav_documentaries_v1';
export const BODLAV_CACHE_TTL = 6 * 3600 * 1000;
export const MAX_BODLAV_ITEMS = 12;
const MAX_HTML_BYTES = 1_000_000;
const MAX_CACHE_CHARS = 24_000;
const TIMEOUT_MS = 12_000;
const PREFIX = '[a-zA-Z0-9_-]{1,80}';
const DETAIL_PATH = new RegExp(`^/${PREFIX}/b/bodlav/([0-9]{1,20})$`);
const CATEGORY_PATH = new RegExp(`^/${PREFIX}/c/bodlav/26/0$`);
const ENTRY_PATH = new RegExp(`^/${PREFIX}/?$`);

function siteUrl(value: string, base = BODLAV_ORIGIN): URL | null {
  try {
    const url = new URL(value, base);
    return url.origin === BODLAV_ORIGIN && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

export function bodlavDocumentaryUrl(value: string): string | undefined {
  const url = siteUrl(value);
  return url && DETAIL_PATH.test(url.pathname) ? url.href : undefined;
}

function posterUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return;
    if (url.hostname === 'image.tmdb.org' && /^\/t\/p\/(?:w[0-9]+|original)\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)) return url.href;
    if (url.hostname === 'i.imgur.com' && /^\/[a-zA-Z0-9]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)) return url.href;
  } catch { /* Une affiche absente ne supprime pas le titre. */ }
}

function htmlDocument(html: string): Document {
  if (html.length > MAX_HTML_BYTES) throw new Error('Catalogue trop volumineux.');
  // Le document reste détaché : aucun script, style ou gestionnaire du site n'entre dans l'application.
  return new DOMParser().parseFromString(html, 'text/html');
}

export function parseBodlavEntry(html: string): string {
  const url = siteUrl(htmlDocument(html).querySelector('#bodlavc')?.getAttribute('href') ?? '');
  if (!url || !ENTRY_PATH.test(url.pathname)) throw new Error('Entrée Bodlav indisponible.');
  return `${url.origin}/${url.pathname.split('/')[1]}/home/bodlav`;
}

export function parseBodlavCategory(html: string, base: string): string | undefined {
  for (const link of htmlDocument(html).querySelectorAll('a[href]')) {
    const url = siteUrl(link.getAttribute('href') ?? '', base);
    if (url && CATEGORY_PATH.test(url.pathname) && /^documentaires?$/i.test(link.textContent?.trim() ?? '')) return url.href;
  }
}

export function parseBodlavDocumentaries(html: string, categoryUrl: string): BodlavDocumentary[] {
  const category = siteUrl(categoryUrl);
  if (!category || !CATEGORY_PATH.test(category.pathname)) throw new Error('Catégorie Bodlav invalide.');
  const items: BodlavDocumentary[] = [];
  const seen = new Set<string>();
  for (const card of htmlDocument(html).querySelectorAll('#cat-film-grid a.film-card')) {
    const candidate = siteUrl(card.getAttribute('href') ?? '', category.href);
    const url = candidate ? bodlavDocumentaryUrl(candidate.href) : undefined;
    const title = card.querySelector('.film-card-title')?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 240);
    const kind = card.querySelector('[data-cat]')?.getAttribute('data-cat');
    if (!url || !title || (kind && !/^documentaires?$/i.test(kind.trim()))) continue;
    const id = new URL(url).pathname.match(DETAIL_PATH)![1];
    if (seen.has(id)) continue;
    seen.add(id);
    const image = posterUrl(card.querySelector('img.film-card-img')?.getAttribute('src') ?? '');
    const date = card.querySelector('.trend-card-date')?.textContent?.trim() ?? '';
    const language = card.querySelector('.film-card-vostfr')?.textContent?.trim().toUpperCase();
    items.push({ id, title, url, ...(image ? { image } : {}), ...(/^(?:19|20)[0-9]{2}$/.test(date) ? { year: date } : {}), ...(language === 'VOSTFR' ? { language } : {}) });
    if (items.length === MAX_BODLAV_ITEMS) break;
  }
  return items;
}

export function readBodlavCache(): { fetchedAt: number; items: BodlavDocumentary[] } | null {
  try {
    const raw = localStorage.getItem(BODLAV_CACHE_KEY);
    if (!raw || raw.length > MAX_CACHE_CHARS) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const cache = value as Record<string, unknown>;
    if (cache.version !== 1 || typeof cache.fetchedAt !== 'number' || !Number.isFinite(cache.fetchedAt) || cache.fetchedAt <= 0 || cache.fetchedAt > Date.now() || !Array.isArray(cache.items) || cache.items.length > MAX_BODLAV_ITEMS) return null;
    const items: BodlavDocumentary[] = [];
    for (const item of cache.items) {
      if (!item || typeof item !== 'object') return null;
      const v = item as Record<string, unknown>;
      const url = typeof v.url === 'string' ? bodlavDocumentaryUrl(v.url) : undefined;
      if (!url || typeof v.id !== 'string' || new URL(url).pathname.match(DETAIL_PATH)![1] !== v.id || typeof v.title !== 'string' || !v.title.trim() || v.title.length > 240) return null;
      if (items.some(i => i.id === v.id)) continue;
      const image = typeof v.image === 'string' ? posterUrl(v.image) : undefined;
      items.push({ id: v.id, title: v.title, url, ...(image ? { image } : {}), ...(typeof v.year === 'string' && /^(?:19|20)[0-9]{2}$/.test(v.year) ? { year: v.year } : {}), ...(v.language === 'VOSTFR' ? { language: 'VOSTFR' } : {}) });
    }
    return { fetchedAt: cache.fetchedAt, items };
  } catch { return null; }
}

const cancelled = () => new DOMException('Cancelled', 'AbortError');

async function requestHtml(url: string, signal: AbortSignal): Promise<string> {
  if (!siteUrl(url)) throw new Error('Adresse Bodlav invalide.');
  if (signal.aborted) throw cancelled();
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => {};
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { controller.abort(); rejectAbort(cancelled()); };
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(onAbort, TIMEOUT_MS);
  try {
    return await Promise.race([abortPromise, (async () => {
      if (isDesktopRuntime()) {
        const response = await desktopHttp<string>({ url, responseType: 'text', timeoutMs: TIMEOUT_MS });
        if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string' || response.data.length > MAX_HTML_BYTES) throw new Error('Catalogue indisponible.');
        return response.data;
      }
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS, disableRedirects: true });
        if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string' || response.data.length > MAX_HTML_BYTES) throw new Error('Catalogue indisponible.');
        return response.data;
      }
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_HTML_BYTES) throw new Error('Catalogue indisponible.');
      if (!response.body) {
        const html = await response.text();
        if (html.length > MAX_HTML_BYTES) throw new Error('Catalogue trop volumineux.');
        return html;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      let html = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_HTML_BYTES) throw new Error('Catalogue trop volumineux.');
          html += decoder.decode(value, { stream: true });
        }
        return html + decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
    })()]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

export async function loadBodlavDocumentaries(signal: AbortSignal): Promise<BodlavDocumentary[]> {
  if (signal.aborted) throw cancelled();
  const cached = readBodlavCache();
  if (cached && Date.now() - cached.fetchedAt < BODLAV_CACHE_TTL) return cached.items;
  try {
    const entry = parseBodlavEntry(await requestHtml(BODLAV_ORIGIN, signal));
    const html = await requestHtml(entry, signal);
    const category = parseBodlavCategory(html, entry);
    if (!category) throw new Error('Rubrique documentaire indisponible.');
    const items = parseBodlavDocumentaries(await requestHtml(category, signal), category);
    if (signal.aborted) throw cancelled();
    if (!items.length) throw new Error('Catalogue documentaire vide.');
    try { localStorage.setItem(BODLAV_CACHE_KEY, JSON.stringify({ version: 1, fetchedAt: Date.now(), items })); } catch { /* Le quota ne bloque pas Découvrir. */ }
    return items;
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (cached) return cached.items;
    throw error;
  }
}
