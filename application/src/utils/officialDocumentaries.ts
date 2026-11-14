import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { desktopHttp, isDesktopRuntime } from '@/utils/desktopBridge';

export type OfficialDocumentarySource = 'tv5mondeplus' | 'imagotv';
export interface OfficialDocumentary { id: string; title: string; url: string; image?: string; year?: string }
export const OFFICIAL_DOCUMENTARY_SOURCES = {
  tv5mondeplus: { name: 'TV5MONDEplus', url: 'https://www.tv5mondeplus.com/fr/documentaires', maxBytes: 4_000_000 },
  imagotv: { name: 'ImagoTV', url: 'https://www.imagotv.fr/documentaires', maxBytes: 1_000_000 },
} as const;
export const OFFICIAL_DOCUMENTARY_CACHE_TTL = 6 * 3600 * 1000;
export const officialDocumentaryCacheKey = (source: OfficialDocumentarySource) => `cedplay_official_documentaries_${source}_v1`;
const MAX_ITEMS = 12;
const TIMEOUT_MS = 12_000;
const MAX_CACHE_CHARS = 30_000;
const DETAIL_PATH = { tv5mondeplus: /^\/fr\/documentaires\/[a-z0-9-]+\/[a-z0-9-]+$/, imagotv: /^\/documentaires\/[a-z0-9-]+$/ };

export function officialDocumentaryUrl(source: OfficialDocumentarySource, value: string): string | undefined {
  try {
    const config = OFFICIAL_DOCUMENTARY_SOURCES[source];
    const url = new URL(value, config.url);
    if (url.origin !== new URL(config.url).origin || url.username || url.password || url.search || url.hash) return;
    return url.href === config.url || DETAIL_PATH[source].test(url.pathname) ? url.href : undefined;
  } catch { return; }
}

function posterUrl(source: OfficialDocumentarySource, value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return;
    if (source === 'tv5mondeplus' && url.hostname === 'assets.tv5mondeplus.com'
      && /^\/imagescaler002\/tv5monde\/tv5mondeplus\/assets\/[a-zA-Z0-9_/-]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)
      && (!url.search || /^\?w=[0-9]{1,4}$/.test(url.search))) return url.href;
    if (source === 'imagotv' && url.hostname === 'asset.vodify.fr' && !url.search
      && /^\/img\/imago\/content\/documentary\/cover\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)) return url.href;
  } catch { /* Une affiche invalide ne retire pas le documentaire. */ }
}

const text = (value: string | null | undefined) => value?.trim().replace(/\s+/g, ' ').slice(0, 240) ?? '';
function documentHtml(source: OfficialDocumentarySource, html: string): Document {
  if (html.length > OFFICIAL_DOCUMENTARY_SOURCES[source].maxBytes) throw new Error('Catalogue trop volumineux.');
  // Seul le texte du document détaché est lu ; aucun HTML du site n'est monté dans CedPlay.
  return new DOMParser().parseFromString(html, 'text/html');
}
const idFor = (url: string) => new URL(url).pathname;

export function parseTV5Documentaries(html: string): OfficialDocumentary[] {
  const items: OfficialDocumentary[] = [];
  for (const card of documentHtml('tv5mondeplus', html).querySelectorAll('a.poster-card[href]')) {
    const url = officialDocumentaryUrl('tv5mondeplus', card.getAttribute('href') ?? '');
    const label = card.getAttribute('aria-label') ?? '';
    const title = / - Documentaires$/.test(label) ? text(label.replace(/ - Documentaires$/, '')) : '';
    if (!url || !DETAIL_PATH.tv5mondeplus.test(new URL(url).pathname) || !title || items.some(item => item.url === url)) continue;
    const image = posterUrl('tv5mondeplus', card.querySelector('img.poster-image')?.getAttribute('src') ?? '');
    items.push({ id: idFor(url), title, url, ...(image ? { image } : {}) });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

export function parseImagoCatalogue(html: string): Omit<OfficialDocumentary, 'title'>[] {
  const items: Omit<OfficialDocumentary, 'title'>[] = [];
  for (const card of documentHtml('imagotv', html).querySelectorAll('div.thumbnail[id^="content-documentary-"]')) {
    const url = officialDocumentaryUrl('imagotv', card.querySelector('a[href]')?.getAttribute('href') ?? '');
    if (!url || !DETAIL_PATH.imagotv.test(new URL(url).pathname) || items.some(item => item.url === url)) continue;
    const image = posterUrl('imagotv', card.querySelector('img')?.getAttribute('lazy-src') ?? '');
    items.push({ id: idFor(url), url, ...(image ? { image } : {}) });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

export function parseImagoTitle(html: string): string {
  const doc = documentHtml('imagotv', html);
  return text(doc.querySelector('h1.name')?.textContent) || text(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'));
}

export function readOfficialDocumentaryCache(source: OfficialDocumentarySource): { fetchedAt: number; items: OfficialDocumentary[] } | null {
  try {
    const raw = localStorage.getItem(officialDocumentaryCacheKey(source));
    if (!raw || raw.length > MAX_CACHE_CHARS) return null;
    const cache = JSON.parse(raw) as Record<string, unknown>;
    if (!cache || cache.version !== 1 || cache.source !== source || typeof cache.fetchedAt !== 'number' || !Number.isFinite(cache.fetchedAt)
      || cache.fetchedAt <= 0 || cache.fetchedAt > Date.now() || !Array.isArray(cache.items) || cache.items.length > MAX_ITEMS) return null;
    const items: OfficialDocumentary[] = [];
    for (const value of cache.items) {
      if (!value || typeof value !== 'object') return null;
      const item = value as Record<string, unknown>;
      const url = typeof item.url === 'string' ? officialDocumentaryUrl(source, item.url) : undefined;
      if (!url || !DETAIL_PATH[source].test(new URL(url).pathname) || item.id !== idFor(url) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 240) return null;
      if (items.some(i => i.id === item.id)) continue;
      const image = typeof item.image === 'string' ? posterUrl(source, item.image) : undefined;
      items.push({ id: idFor(url), title: item.title, url, ...(image ? { image } : {}), ...(typeof item.year === 'string' && /^(19|20)[0-9]{2}$/.test(item.year) ? { year: item.year } : {}) });
    }
    return { fetchedAt: cache.fetchedAt, items };
  } catch { return null; }
}

const cancelled = () => new DOMException('Cancelled', 'AbortError');
async function requestHtml(source: OfficialDocumentarySource, url: string, signal: AbortSignal): Promise<string> {
  if (!officialDocumentaryUrl(source, url)) throw new Error('Adresse documentaire invalide.');
  if (signal.aborted) throw cancelled();
  let rejectAbort: (error: unknown) => void = () => {};
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(cancelled());
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT_MS);
  try {
    return await Promise.race([abortPromise, (async () => {
      const response = isDesktopRuntime()
        ? await desktopHttp<string>({ url, responseType: 'text', timeoutMs: TIMEOUT_MS })
        : await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS, disableRedirects: true });
      if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string'
        || response.data.length > OFFICIAL_DOCUMENTARY_SOURCES[source].maxBytes
        || new TextEncoder().encode(response.data).byteLength > OFFICIAL_DOCUMENTARY_SOURCES[source].maxBytes) throw new Error('Catalogue indisponible.');
      return response.data;
    })()]);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export async function loadOfficialDocumentaries(source: OfficialDocumentarySource, signal: AbortSignal): Promise<OfficialDocumentary[]> {
  if (signal.aborted) throw cancelled();
  const cached = readOfficialDocumentaryCache(source);
  if (cached && Date.now() - cached.fetchedAt < OFFICIAL_DOCUMENTARY_CACHE_TTL) return cached.items;
  // Ces sites ne permettent pas le chargement interorigine dans un navigateur : la rubrique officielle reste accessible.
  if (!Capacitor.isNativePlatform() && !isDesktopRuntime()) return cached?.items ?? [];
  try {
    const html = await requestHtml(source, OFFICIAL_DOCUMENTARY_SOURCES[source].url, signal);
    let items: OfficialDocumentary[];
    if (source === 'tv5mondeplus') items = parseTV5Documentaries(html);
    else {
      const candidates = parseImagoCatalogue(html);
      const results: (OfficialDocumentary | undefined)[] = Array.from({ length: candidates.length });
      let next = 0;
      const deadline = Date.now() + 36_000;
      await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, async () => {
        while (next < candidates.length && Date.now() < deadline) {
          if (signal.aborted) throw cancelled();
          const index = next++;
          const candidate = candidates[index]!;
          try {
            const title = parseImagoTitle(await requestHtml(source, candidate.url, signal));
            if (title) results[index] = { ...candidate, title };
          } catch { if (signal.aborted) throw cancelled(); }
        }
      }));
      items = results.filter((item): item is OfficialDocumentary => item !== undefined);
    }
    if (signal.aborted) throw cancelled();
    if (!items.length) throw new Error('Catalogue documentaire vide.');
    try { localStorage.setItem(officialDocumentaryCacheKey(source), JSON.stringify({ version: 1, source, fetchedAt: Date.now(), items })); } catch { /* Le quota ne bloque pas Découvrir. */ }
    return items;
  } catch (error) { if (signal.aborted) throw cancelled(); if (cached) return cached.items; throw error; }
}
