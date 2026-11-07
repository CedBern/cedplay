import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { FeedFormatError, parsePodcastRss, type ParsedPodcastFeed } from './podcastParser';

/**
 * Récupère et analyse un flux RSS de podcast :
 * - Sur Android (Capacitor natif) : requête directe via `CapacitorHttp.get` (aucune limite CORS, aucun serveur tiers).
 * - Sur navigateur Web : requête directe `fetch`, puis repli lecture seule si le serveur du podcast bloque CORS.
 */
export async function fetchPodcastFeed(rawUrl: string): Promise<ParsedPodcastFeed> {
  const url = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    throw new Error('Adresse RSS invalide : utilise une URL commençant par http:// ou https://.');
  }

  const normalizedUrl = parsed.toString();

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url: normalizedUrl,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'CedPlay/1.11 (Android; Podcasts)',
      },
      connectTimeout: 12000,
      readTimeout: 15000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Le serveur du podcast a répondu avec le code HTTP ${response.status}.`);
    }
    const xmlText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    return parsePodcastRss(xmlText, normalizedUrl);
  }

  // Navigateur Web / Tests : essai direct d'abord
  try {
    const res = await fetch(normalizedUrl, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const xmlText = await res.text();
    return parsePodcastRss(xmlText, normalizedUrl);
  } catch (directError) {
    // Si c'est déjà une erreur d'analyse RSS (flux vide ou malformé), on la remonte directement
    if (directError instanceof FeedFormatError) {
      throw directError;
    }
    // Repli Web lecture seule si le serveur du podcast n'envoie pas d'en-tête Access-Control-Allow-Origin
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(normalizedUrl)}`;
      const proxyRes = await fetch(proxyUrl);
      if (!proxyRes.ok) throw new Error(`HTTP ${proxyRes.status}`);
      const xmlText = await proxyRes.text();
      return parsePodcastRss(xmlText, normalizedUrl);
    } catch (proxyError) {
      if (proxyError instanceof FeedFormatError) throw proxyError;
      throw new Error('Impossible de charger ce flux RSS (vérifie l’adresse ou la connexion).');
    }
  }
}
