import { Capacitor, CapacitorHttp } from '@capacitor/core';

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

/** Télécharge un texte avec ce User-Agent (Android : requête native, sans contrainte CORS). */
export async function fetchTextWithUserAgent(url: string, userAgent: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) throw new Error('native only');
  const response = await CapacitorHttp.get({ url, headers: { 'User-Agent': userAgent }, responseType: 'text', connectTimeout: 15000, readTimeout: 60000 });
  if (response.status < 200 || response.status >= 300) throw new Error(`Import impossible : HTTP ${response.status}.`);
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
}

function parseJsonLoose(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * GET JSON : Android = requête native CapacitorHttp (ni CORS ni mixed content, donc
 * les serveurs Xtream sans en-têtes CORS répondent quand même) ; web = fetch standard.
 * Le corps est parsé même hors 2xx : le relais web renvoie ses erreurs en JSON.
 */
export async function httpGetJson(url: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, headers: { 'User-Agent': getActiveUserAgent() }, responseType: 'json', connectTimeout: 15000, readTimeout: 30000 });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: typeof response.data === 'string' ? parseJsonLoose(response.data) : response.data };
  }
  const res = await fetch(url);
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}
