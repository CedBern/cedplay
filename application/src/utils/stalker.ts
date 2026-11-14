import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { channelQuality } from '@/utils/channelQuality';
import { desktopHttp, isDesktopRuntime } from '@/utils/desktopBridge';
import type { Channel, ChannelGroup, PlaylistInfo } from '@/types/channel';

/**
 * Portails Stalker / Ministra (boîtiers MAG) : connexion par adresse MAC.
 * Les chaînes n'ont pas d'adresse fixe : chacune garde « adresse#cedplay-stalker=… »
 * (portail, MAC, commande) et Android demande le lien de lecture au portail au moment
 * de lire (voir Stalker.java). Les requêtes passent par le HTTP natif (Android seulement).
 */
export interface StalkerAccount { portal: string; mac: string }

export const STALKER_MARK = '#cedplay-stalker=';
const STB_AGENT = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';

export const isStalkerUrl = (url: string) => url.includes(STALKER_MARK);
export const stalkerAvailable = () => Capacitor.isNativePlatform() || isDesktopRuntime();

/** « 00-1a-79-aa-bb-cc » → « 00:1A:79:AA:BB:CC » ; vide si ce n'est pas une adresse MAC. */
export function normalizeMac(input: string): string {
  const hex = input.trim().replace(/[^0-9a-f]/gi, '');
  return hex.length === 12 ? hex.toUpperCase().match(/.{2}/g)!.join(':') : '';
}

/** Adresses d'API à essayer pour l'adresse saisie (portail en /c/, /stalker_portal/c/ ou API directe). */
export function portalCandidates(input: string): string[] {
  let raw = input.trim();
  if (!raw) return [];
  // Saisie « ftp://… » ou « file://… » : ne pas la transformer en « http://ftp//… ».
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return [];
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  let url: URL;
  try { url = new URL(raw); } catch { return []; }
  if (!['http:', 'https:'].includes(url.protocol)) return [];
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/(portal|load)\.php$/i.test(path)) return [`${url.origin}${path}`];
  const base = path.replace(/\/c$/i, '').replace(/\/index\.html?$/i, '');
  const out = new Set<string>();
  if (/stalker_portal$/i.test(base)) out.add(`${url.origin}${base}/server/load.php`);
  out.add(`${url.origin}${base}/portal.php`);
  out.add(`${url.origin}${base}/server/load.php`);
  out.add(`${url.origin}/stalker_portal/server/load.php`);
  out.add(`${url.origin}/portal.php`);
  return [...out];
}

function headers(account: StalkerAccount, token?: string): Record<string, string> {
  const origin = (() => { try { return new URL(account.portal).origin; } catch { return ''; } })();
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'; } catch { return 'Europe/Paris'; } })();
  return {
    'User-Agent': STB_AGENT,
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
    Cookie: `mac=${encodeURIComponent(account.mac)}; stb_lang=fr; timezone=${encodeURIComponent(zone)}`,
    Referer: `${origin}/c/`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function call(account: StalkerAccount, params: Record<string, string>, token?: string): Promise<unknown> {
  const query = new URLSearchParams({ ...params, JsHttpRequest: '1-xml' });
  const targetUrl = `${account.portal}${account.portal.includes('?') ? '&' : '?'}${query}`;
  const response = isDesktopRuntime()
    ? await desktopHttp<unknown>({
      url: targetUrl,
      headers: headers(account, token),
      responseType: 'text',
      timeoutMs: 60_000,
    })
    : await CapacitorHttp.get({
      url: targetUrl,
      headers: headers(account, token),
      responseType: 'text',
      connectTimeout: 10_000,
      readTimeout: 60_000,
    });
  if (response.status === 401 || response.status === 403) throw new Error('Le portail refuse cette adresse MAC.');
  if (response.status < 200 || response.status >= 300) throw new Error(`Le portail répond HTTP ${response.status}.`);
  let body: unknown = response.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body.trim()); } catch { throw new Error('Réponse du portail illisible (ce n’est peut-être pas un portail Stalker).'); }
  }
  return body && typeof body === 'object' ? (body as { js?: unknown }).js : undefined;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export async function handshake(account: StalkerAccount): Promise<string> {
  const token = str(obj(await call(account, { type: 'stb', action: 'handshake', token: '' })).token);
  if (!token) throw new Error('Le portail n’a pas accepté la connexion.');
  // Certains portails n'activent le jeton qu'après la lecture du profil.
  try { await call(account, { type: 'stb', action: 'get_profile', hd: '1', num_banks: '2', stb_type: 'MAG250', image_version: '218', auth_second_step: '0', not_valid_token: '0', hw_version: '1.7-BD-00' }, token); }
  catch { /* profil facultatif */ }
  return token;
}

/** Trouve l'API du portail parmi les adresses possibles et renvoie le compte et son jeton. */
export async function connectPortal(input: string, macInput: string): Promise<{ account: StalkerAccount; token: string }> {
  if (!stalkerAvailable()) throw new Error('Les portails MAC se connectent depuis l’application Android.');
  const mac = normalizeMac(macInput);
  if (!mac) throw new Error('Adresse MAC invalide (12 chiffres hexadécimaux, ex. 00:1A:79:12:34:56).');
  const candidates = portalCandidates(input);
  if (!candidates.length) throw new Error('Adresse du portail invalide.');
  let lastError: unknown = null;
  for (const portal of candidates) {
    const account = { portal, mac };
    try { return { account, token: await handshake(account) }; }
    catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('Portail injoignable.');
}

/** « ffmpeg http://… » → « http://… ». */
export function stripCommand(cmd: string): string {
  const value = cmd.trim();
  const space = value.indexOf(' ');
  return space > 0 && !value.slice(0, space).includes('://') ? value.slice(space + 1).trim() : value;
}

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Adresse notée pour une chaîne du portail : adresse lisible + données de résolution. */
export function stalkerChannelUrl(account: StalkerAccount, cmd: string, channelId: string): string {
  const portal = new URL(account.portal);
  const direct = stripCommand(cmd);
  let shown = `${portal.origin}/stalker/${encodeURIComponent(channelId)}`;
  try {
    const u = new URL(direct);
    if (['http:', 'https:'].includes(u.protocol) && !['localhost', '127.0.0.1'].includes(u.hostname)) shown = `${u.origin}${u.pathname}${u.search}`;
  } catch { /* commande sans adresse : adresse lisible du portail */ }
  return `${shown}${STALKER_MARK}${base64Url(JSON.stringify({ p: account.portal, m: account.mac, c: cmd }))}`;
}

interface RawChannel { id?: unknown; name?: unknown; number?: unknown; cmd?: unknown; logo?: unknown; tv_genre_id?: unknown }

async function fetchGenres(account: StalkerAccount, token: string): Promise<Map<string, string>> {
  const js = await call(account, { type: 'itv', action: 'get_genres' }, token);
  const map = new Map<string, string>();
  if (Array.isArray(js)) for (const g of js) { const o = obj(g); if (str(o.id)) map.set(str(o.id), str(o.title) || 'Sans groupe'); }
  return map;
}

async function fetchChannels(account: StalkerAccount, token: string, onProgress?: (count: number) => void): Promise<RawChannel[]> {
  const all = await call(account, { type: 'itv', action: 'get_all_channels' }, token).catch(() => null);
  const data = Array.isArray(all) ? all : obj(all).data;
  if (Array.isArray(data) && data.length) return data as RawChannel[];
  // Repli : liste paginée (portails qui ne donnent pas tout d'un coup).
  const out: RawChannel[] = [];
  for (let page = 1; page <= 500; page++) {
    const js = obj(await call(account, { type: 'itv', action: 'get_ordered_list', genre: '*', fav: '0', sortby: 'number', hd: '0', p: String(page) }, token));
    const items = Array.isArray(js.data) ? js.data as RawChannel[] : [];
    out.push(...items);
    onProgress?.(out.length);
    const total = Number(js.total_items) || 0;
    if (!items.length || (total && out.length >= total)) break;
  }
  return out;
}

function logoUrl(account: StalkerAccount, logo: string): string | undefined {
  if (!logo) return undefined;
  if (/^https?:\/\//i.test(logo)) return logo;
  try {
    const origin = new URL(account.portal).origin;
    return logo.startsWith('/') ? `${origin}${logo}` : `${origin}/stalker_portal/misc/logos/320/${logo}`;
  } catch { return undefined; }
}

/** Petite empreinte stable (identifiants de chaînes propres au portail et à la MAC). */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Liste des chaînes du portail, rangées par genre. */
export async function downloadStalkerPlaylist(account: StalkerAccount, name?: string, onProgress?: (count: number) => void): Promise<PlaylistInfo> {
  const token = await handshake(account);
  const [genres, raw] = await Promise.all([fetchGenres(account, token).catch(() => new Map<string, string>()), fetchChannels(account, token, onProgress)]);
  const prefix = `stk${hash(`${account.portal}|${account.mac}`)}`;
  const channels: Channel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = str(item.id), cmd = str(item.cmd), title = str(item.name).trim();
    if (!id || !cmd || !title || seen.has(id)) continue;
    seen.add(id);
    const channelId = `${prefix}_${id}`;
    const logo = logoUrl(account, str(item.logo));
    const number = str(item.number).trim();
    const quality = channelQuality({ name: title });
    channels.push({
      id: channelId,
      name: title,
      url: stalkerChannelUrl(account, cmd, id),
      group: genres.get(str(item.tv_genre_id)) || 'Sans groupe',
      ...(logo ? { logo } : {}),
      ...(quality ? { quality } : {}),
      ...(/^\d{1,9}$/.test(number) ? { chno: number } : {}),
    });
  }
  if (!channels.length) throw new Error('Le portail n’a renvoyé aucune chaîne pour cette adresse MAC.');
  const byGroup = new Map<string, Channel[]>();
  for (const c of channels) { const list = byGroup.get(c.group!) ?? []; list.push(c); byGroup.set(c.group!, list); }
  const groups: ChannelGroup[] = [...byGroup].map(([groupName, list]) => ({ name: groupName, channels: list }));
  const host = (() => { try { return new URL(account.portal).host; } catch { return 'portail'; } })();
  return { id: `${prefix}-${Date.now().toString(36)}`, name: name?.trim() || `Portail ${host}`, channels, groups, stalker: account };
}
