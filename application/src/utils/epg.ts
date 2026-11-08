import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getActiveUserAgent } from '@/utils/userAgent';
import type { PlaylistInfo } from '@/types/channel';
import type { EPGData } from '@/types/epg';
import { getXtreamAccount } from '@/utils/xtreamCatalog';
import { listXmltvChannels } from '@/utils/epgXmltv';
import { getMeta, setMeta } from '@/utils/idb';
import { getProxyBase } from '@/utils/proxy';
import { AppSettings } from '@/utils/storage';
import { packEPGData, unpackEPGData, type PackedEPGData } from '@/utils/epgPacked';
import { assertImportSize, assertXmltvTextSize, decodeImportText } from '@/utils/textImport';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const MAX_FETCH_MS = 60_000;

interface EPGCache { fetchedAt: number; xml: string; source: string }
export interface EPGSource { xml: string; fetchedAt: number; stale: boolean; url: string }

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** URL du guide : xmltv.php du compte Xtream, ou adresse XMLTV personnalisée des paramètres. */
export function getEPGUrl(playlist: PlaylistInfo, settings: AppSettings): string | null {
  const account = getXtreamAccount(playlist);
  if (account) {
    return `${account.server}/xmltv.php?username=${encodeURIComponent(account.username)}&password=${encodeURIComponent(account.password)}`;
  }
  const custom = settings.epgUrl?.trim();
  if (custom) {
    try { return new URL(custom).href; } catch { return null; }
  }
  return null;
}

async function decompressGzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  // Un gzip de 40 Mo peut doubler ou tripler une fois décompressé : sans plafond,
  // le WebView meurt avant même le début de l'analyse.
  assertXmltvTextSize(text.length);
  return text;
}

/** Télécharge le XMLTV (gzip accepté). Web : proxy local 127.0.0.1:5179 ; natif : CapacitorHttp. */
async function downloadXmltv(rawUrl: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url: rawUrl,
      headers: { 'User-Agent': getActiveUserAgent(), 'Accept-Encoding': 'gzip' },
      responseType: 'arraybuffer',
      connectTimeout: 15000,
      readTimeout: MAX_FETCH_MS,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    const base64 = response.data;
    if (typeof base64 !== 'string') throw new Error('Réponse inattendue du serveur.');
    const bytes = base64ToUint8Array(base64);
    assertImportSize(bytes.length, 'xmltv');
    const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    return isGzip ? decompressGzip(bytes) : decodeImportText(bytes, 'xmltv');
  }
  const proxied = `${getProxyBase()}/proxy?url=${encodeURIComponent(rawUrl)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_FETCH_MS);
  try {
    const response = await fetch(proxied, { signal: controller.signal, referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertImportSize(bytes.length, 'xmltv');
    const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGzip) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Décompression gzip indisponible.');
      return await decompressGzip(bytes);
    }
    return decodeImportText(bytes, 'xmltv');
  } finally {
    clearTimeout(timeout);
  }
}

/** Au-delà, le guide est servi sans être mis en cache : un XML de cette taille suffit à
 *  saturer le quota du WebView, partagé avec les favoris, les réglages et l'historique. */
const MAX_CACHED_XML_CHARS = 12_000_000;

/** Cache XML d'une source : la source principale garde la clé historique de la liste. */
async function fetchCachedXmltv(cacheKey: string, url: string, force: boolean): Promise<EPGSource> {
  const saved = await getMeta<EPGCache>(cacheKey).catch(() => undefined);
  const cached = saved?.source === url ? saved : undefined;
  if (!force && cached?.xml && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { ...cached, stale: false, url };
  let xml: string;
  try {
    xml = await downloadXmltv(url);
    // Validation minimale : le fichier doit ressembler à du XMLTV.
    if (!xml.includes('<tv') && !xml.includes('<programme')) throw new Error('Le serveur ne renvoie pas de guide XMLTV.');
  } catch (error) {
    if (cached?.xml) return { xml: cached.xml, fetchedAt: cached.fetchedAt, stale: true, url };
    // Le plafond de taille est une cause précise : la masquer derrière « guide
    // indisponible » ferait chercher une panne réseau inexistante.
    if (error instanceof Error && error.message.startsWith('Guide trop volumineux')) throw error;
    throw new Error('Guide indisponible. Vérifie la connexion et la source EPG.');
  }
  const fetchedAt = Date.now();
  // Un échec d'écriture (quota plein) ne doit pas être présenté comme une panne réseau :
  // le guide téléchargé reste utilisable pour la session, seul son cache est perdu.
  if (xml.length <= MAX_CACHED_XML_CHARS) {
    await setMeta(cacheKey, { fetchedAt, xml, source: url } satisfies EPGCache).catch(() => undefined);
  }
  return { xml, fetchedAt, stale: false, url };
}

/**
 * Charge le guide du jour pour une liste : cache 12 h, sinon téléchargement.
 * En cas d'échec réseau, renvoie le cache même périmé s'il existe.
 */
export async function fetchEPGSource(playlist: PlaylistInfo, settings: AppSettings, force = false): Promise<EPGSource | null> {
  const url = getEPGUrl(playlist, settings);
  if (!url) return null;
  return fetchCachedXmltv(`epgCache_${playlist.id}`, url, force);
}

const validUrl = (raw: string | undefined): string | null => {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
};

/**
 * Sources complémentaires, par ordre de priorité, après la source principale :
 * guides annoncés par la liste (url-tvg), adresse des réglages, sources ajoutées
 * pour cette liste. Les doublons et la source principale sont retirés.
 */
export function getSecondaryEPGUrls(playlist: PlaylistInfo, settings: AppSettings, extraUrls: string[] = []): string[] {
  const primary = getEPGUrl(playlist, settings);
  const out: string[] = [];
  for (const raw of [...(playlist.epgUrls ?? []), settings.epgUrl, ...extraUrls]) {
    const url = validUrl(raw);
    if (url && url !== primary && !out.includes(url)) out.push(url);
  }
  return out.slice(0, 10);
}

/** Petite empreinte stable d'une adresse (clé de cache). */
function hashUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Télécharge les sources complémentaires ; une source en échec est simplement ignorée. */
export async function fetchSecondaryEPGSources(playlistId: string, urls: string[], force = false): Promise<EPGSource[]> {
  const results = await Promise.allSettled(urls.map(url => fetchCachedXmltv(`epgCache_${playlistId}_${hashUrl(url)}`, url, force)));
  return results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
}

// ── Cache du résultat PARSÉ (par liste) : évite de re-parser l'XML multi-Mo à
//    chaque chargement quand le cache XML 12 h est encore valide. ──────────

interface EPGParsedCache { fetchedAt: number; url: string; data: PackedEPGData }

// Ne pas lire l'ancien cache : son clonage suffit à épuiser la mémoire de petites box.
const parsedKey = (playlistId: string) => `epgParsed_v2_${playlistId}`;

export async function getParsedEPGCache(playlistId: string, url: string, fetchedAt: number): Promise<EPGData | null> {
  try {
    const saved = await getMeta<EPGParsedCache>(parsedKey(playlistId));
    if (saved?.data && saved.url === url && saved.fetchedAt === fetchedAt) return unpackEPGData(saved.data);
  } catch { /* cache indisponible */ }
  return null;
}

export async function saveParsedEPGCache(playlistId: string, url: string, fetchedAt: number, data: EPGData): Promise<void> {
  try {
    await setMeta(parsedKey(playlistId), { fetchedAt, url, data: packEPGData(data) } satisfies EPGParsedCache);
  } catch { /* stockage plein : non bloquant */ }
}

export async function fetchEPGXml(playlist: PlaylistInfo, settings: AppSettings): Promise<string | null> {
  return (await fetchEPGSource(playlist, settings))?.xml ?? null;
}

export interface GuideChannelOption { id: string; name: string; source: number }

/**
 * Chaînes proposées par les guides de la liste (association manuelle), lues dans les
 * caches déjà téléchargés. Chaque identifiant n'apparaît qu'une fois (première source).
 */
export async function loadGuideChannels(playlist: PlaylistInfo, settings: AppSettings, extraUrls: string[] = []): Promise<GuideChannelOption[]> {
  const primary = await fetchEPGSource(playlist, settings).catch(() => null);
  const secondary = await fetchSecondaryEPGSources(playlist.id, getSecondaryEPGUrls(playlist, settings, extraUrls));
  const seen = new Set<string>();
  const out: GuideChannelOption[] = [];
  [primary, ...secondary].forEach((source, index) => {
    if (!source) return;
    for (const channel of listXmltvChannels(source.xml)) {
      if (seen.has(channel.id)) continue;
      seen.add(channel.id);
      out.push({ id: channel.id, name: channel.displayNames[0] || channel.id, source: index });
    }
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}
