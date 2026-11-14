import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { desktopHttp, isDesktopRuntime } from '@/utils/desktopBridge';

/**
 * User-Agent envoyé au fournisseur (flux, guide, API Xtream). Certains serveurs
 * n'acceptent qu'un lecteur précis : il se règle par liste.
 */
export const DEFAULT_USER_AGENT = 'IPTVSmartersPro';

/** ASCII imprimable seulement (un en-tête HTTP n'accepte rien d'autre), 200 caractères au plus. */
export function cleanUserAgent(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length <= 200 && /^[\x20-\x7e]+$/.test(text) ? text : '';
}

export const playlistUserAgent = (playlist: { userAgent?: string | undefined } | null | undefined) =>
  cleanUserAgent(playlist?.userAgent) || DEFAULT_USER_AGENT;

let active = DEFAULT_USER_AGENT;
/** User-Agent de la liste ouverte, pour les requêtes qui ne connaissent pas leur liste. */
export function setActiveUserAgent(userAgent: string): void { active = cleanUserAgent(userAgent) || DEFAULT_USER_AGENT; }
export function getActiveUserAgent(): string { return active; }

/** Télécharge un texte avec ce User-Agent (Android ou Desktop : requête directe sans contrainte CORS). */
export async function fetchTextWithUserAgent(url: string, userAgent: string): Promise<string> {
  if (isDesktopRuntime()) {
    const response = await desktopHttp<string>({ url, headers: { 'User-Agent': userAgent }, responseType: 'text', timeoutMs: 60000 });
    if (response.status < 200 || response.status >= 300) throw new Error(`Import impossible : HTTP ${response.status}.`);
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  }
  if (!Capacitor.isNativePlatform()) throw new Error('native only');
  const response = await CapacitorHttp.get({ url, headers: { 'User-Agent': userAgent }, responseType: 'text', connectTimeout: 15000, readTimeout: 60000 });
  if (response.status < 200 || response.status >= 300) throw new Error(`Import impossible : HTTP ${response.status}.`);
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
}

function parseJsonLoose(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/** Fournisseur qui accepte la connexion sans répondre : sans borne, le dialogue
 *  d'import restait sur « Import en cours… » indéfiniment. */
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export interface HttpGetOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

/**
 * GET JSON : Android = requête native CapacitorHttp (ni CORS ni mixed content, donc
 * les serveurs Xtream sans en-têtes CORS répondent quand même) ; web = fetch standard.
 * Le corps est parsé même hors 2xx : le relais web renvoie ses erreurs en JSON.
 */
export async function httpGetJson(url: string, options: HttpGetOptions = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const cancelled = () => new DOMException('Cancelled', 'AbortError');
  if (options.signal?.aborted) throw cancelled();
  if (isDesktopRuntime()) {
    const response = await desktopHttp<unknown>({
      url,
      headers: { 'User-Agent': getActiveUserAgent() },
      responseType: 'json',
      timeoutMs,
    });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: typeof response.data === 'string' ? parseJsonLoose(response.data) : response.data };
  }
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url, headers: { 'User-Agent': getActiveUserAgent() }, responseType: 'json',
      connectTimeout: Math.min(15000, timeoutMs), readTimeout: timeoutMs,
    });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: typeof response.data === 'string' ? parseJsonLoose(response.data) : response.data };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch (error) {
    if (options.signal?.aborted) throw cancelled();
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Le serveur ne répond pas (délai dépassé). Vérifie la connexion.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
