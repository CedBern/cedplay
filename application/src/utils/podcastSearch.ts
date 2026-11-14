import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { desktopHttp, isDesktopRuntime } from '@/utils/desktopBridge';
import type { LinkResolutionResult, PodcastSearchResult } from '@/types/podcast';

/**
 * Suggestions de démarrage (utile sur TV : s'abonner sans taper à la télécommande).
 * Chaque flux et chaque pochette ont été vérifiés le 7 nov. 2026 (HTTP 200, titre du flux
 * identique à l'émission). Pochettes : Apple Podcasts ; flux : Apple, sinon gpodder/fyyd.
 * À revérifier si une suggestion cesse de se charger.
 */
export const DEFAULT_PODCAST_SUGGESTIONS: PodcastSearchResult[] = [
  {
    id: 'sug-affaires-sensibles',
    title: 'Affaires sensibles',
    author: 'France Inter',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_13940.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/63/70/8c/63708c3b-ed11-5d19-fa67-132f92e463f3/mza_8301076687401115427.jpg/600x600bb.jpg',
    genre: 'Histoire & Enquêtes',
    source: 'suggestion',
  },
  {
    id: 'sug-cours-histoire',
    title: 'Le Cours de l’histoire',
    author: 'France Culture',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_10076.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/1a/02/0c/1a020ca8-b6d2-39f5-01ba-a0efa9b9eaf7/mza_1050990122467541468.jpg/600x600bb.jpg',
    genre: 'Histoire & Enquêtes',
    source: 'suggestion',
  },
  {
    id: 'sug-pieds-sur-terre',
    title: 'Les Pieds sur terre',
    author: 'France Culture',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_10078.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/9f/ab/b1/9fabb1e0-ef8c-d78b-cd79-13225e0c2aad/mza_12414803589752471015.jpg/600x600bb.jpg',
    genre: 'Société & Récits',
    source: 'suggestion',
  },
  {
    id: 'sug-transfert',
    title: 'Transfert',
    author: 'Slate.fr Podcasts',
    feedUrl: 'https://feeds.audiomeans.fr/feed/f02d124c-01fa-4ddc-a6fe-9363f52c58bc.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/3a/34/1f/3a341fd1-41ac-401b-2721-50e2245be56d/mza_7797341130086209673.png/600x600bb.jpg',
    genre: 'Société & Récits',
    source: 'suggestion',
  },
  {
    id: 'sug-heure-du-monde',
    title: 'L’Heure du Monde',
    author: 'Le Monde',
    feedUrl: 'https://feeds.acast.com/public/shows/68db9d2509b1c365e44318ca',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/09/b4/9f/09b49f13-4c73-2e89-5bdd-117a5a787623/mza_10769402460129893157.jpeg/600x600bb.jpg',
    genre: 'Actualités',
    source: 'suggestion',
  },
  {
    id: 'sug-hugodecrypte',
    title: 'HugoDécrypte - Actus et interviews',
    author: 'Hugo Décrypte',
    feedUrl: 'https://feeds.acast.com/public/shows/95497e34-ecc2-596a-b910-bb3342918621',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/99/8f/f2/998ff2e2-df8b-3569-4624-13843d12c9e3/mza_14083435330052627150.jpeg/600x600bb.jpg',
    genre: 'Actualités',
    source: 'suggestion',
  },
  {
    id: 'sug-choses-a-savoir',
    title: 'Choses à Savoir - Culture générale',
    author: 'Choses à Savoir',
    feedUrl: 'https://feeds.acast.com/public/shows/66057de88268a800162cadf2',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/31/55/a8/3155a807-e878-0453-86f7-1842cd32a186/mza_12348316116145026782.jpeg/600x600bb.jpg',
    genre: 'Sciences & Tech',
    source: 'suggestion',
  },
  {
    id: 'sug-terre-au-carre',
    title: 'La Terre au carré',
    author: 'France Inter',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_10212.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/12/36/3c/12363c30-c2f6-7ad5-d913-2ef4e74c8cf1/mza_12902193722203466429.jpg/600x600bb.jpg',
    genre: 'Sciences & Tech',
    source: 'suggestion',
  },
  {
    id: 'sug-collimateur',
    title: 'Le Collimateur',
    author: 'Alexandre Jubelin / Binge Audio',
    feedUrl: 'https://feeds.audiomeans.fr/feed/64ee3763-1a46-44c2-8640-3a69405a3ad8.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/b2/45/0b/b2450be9-3bcb-c147-edc3-ad328dc4c46d/mza_15988037313708713035.jpg/600x600bb.jpg',
    genre: 'Histoire & Enquêtes',
    source: 'suggestion',
  },
];

export const PODCAST_GENRES = [
  'Tous',
  'Histoire & Enquêtes',
  'Actualités',
  'Société & Récits',
  'Sciences & Tech',
] as const;

/**
 * Effectue une requête HTTP multi-plateforme (CapacitorHttp sur Android, fetch sur Web).
 */
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  if (isDesktopRuntime()) {
    try {
      const res = await desktopHttp<T | string>({
        url,
        headers: { Accept: 'application/json, text/plain, */*' },
        responseType: 'json',
        timeoutMs: 10000,
      });
      if (res.status >= 200 && res.status < 300) {
        return typeof res.data === 'string' ? JSON.parse(res.data) as T : res.data;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url,
        headers: { Accept: 'application/json, text/plain, */*' },
        connectTimeout: 8000,
        readTimeout: 10000,
      });
      if (res.status >= 200 && res.status < 300) {
        if (typeof res.data === 'string') {
          return JSON.parse(res.data) as T;
        }
        return res.data as T;
      }
      return null;
    } catch {
      return null;
    }
  }

  try {
    const init: RequestInit = {
      headers: { Accept: 'application/json, text/plain, */*' },
    };
    if (signal) init.signal = signal;
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Récupère le texte brut d'une page Web pour analyser les liens alternatifs RSS ou les balises meta OpenGraph.
 */
async function fetchHtmlText(url: string, signal?: AbortSignal): Promise<string | null> {
  if (isDesktopRuntime()) {
    try {
      const res = await desktopHttp<string>({
        url,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'CedPlay/1.12 (Windows; Podcasts)',
        },
        responseType: 'text',
        timeoutMs: 10000,
      });
      if (res.status >= 200 && res.status < 300) {
        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      }
      return null;
    } catch {
      return null;
    }
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'CedPlay/1.11 (Android; Podcasts)',
        },
        connectTimeout: 8000,
        readTimeout: 10000,
      });
      if (res.status >= 200 && res.status < 300) {
        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      }
      return null;
    } catch {
      return null;
    }
  }

  try {
    const init: RequestInit = {
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    };
    if (signal) init.signal = signal;
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    // Repli proxy allorigins pour le web si blocage CORS
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const proxyInit: RequestInit = {};
      if (signal) proxyInit.signal = signal;
      const res = await fetch(proxyUrl, proxyInit);
      if (res.ok) return await res.text();
    } catch { /* proxy indisponible : on abandonne */ }
    return null;
  }
}

interface ItunesSearchResult {
  resultCount?: number;
  results?: Array<{
    collectionId?: number;
    trackId?: number;
    collectionName?: string;
    trackName?: string;
    artistName?: string;
    feedUrl?: string;
    artworkUrl600?: string;
    artworkUrl100?: string;
    primaryGenreName?: string;
    genres?: string[];
    trackCount?: number;
  }>;
}

interface GpodderSearchResult {
  url?: string;
  title?: string;
  author?: string;
  description?: string;
  logo_url?: string;
  scaled_logo_url?: string;
}

/**
 * Recherche des podcasts par nom ou mot-clé dans les annuaires publics (Apple Podcasts + Gpodder).
 * Fusionne les résultats pour toujours obtenir la meilleure pochette ET un flux RSS direct fonctionnel.
 */
export async function searchPodcasts(
  query: string,
  options?: { signal?: AbortSignal; country?: string; limit?: number }
): Promise<PodcastSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return DEFAULT_PODCAST_SUGGESTIONS;
  }

  const country = options?.country || 'FR';
  const limit = options?.limit || 15;
  const encoded = encodeURIComponent(trimmed);

  const itunesUrl = `https://itunes.apple.com/search?media=podcast&entity=podcast&term=${encoded}&country=${country}&limit=${limit}`;
  const gpodderUrl = `https://gpodder.net/search.json?q=${encoded}`;

  const [itunesData, gpodderData] = await Promise.all([
    fetchJson<ItunesSearchResult>(itunesUrl, options?.signal),
    fetchJson<GpodderSearchResult[]>(gpodderUrl, options?.signal),
  ]);

  const items: PodcastSearchResult[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  // 1. Parser les résultats iTunes (riches en pochettes HD et métadonnées)
  if (itunesData?.results && Array.isArray(itunesData.results)) {
    for (const r of itunesData.results) {
      const title = (r.collectionName || r.trackName || '').trim();
      if (!title) continue;
      // Titre + auteur : deux émissions homonymes de producteurs différents restent distinctes.
      const key = `${normalizeName(title)}|${normalizeName(r.artistName || '')}`;
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);

      const feedUrl = (r.feedUrl || '').trim();
      const artworkUrl = r.artworkUrl600 || r.artworkUrl100 || '';
      const genre = r.primaryGenreName || (r.genres && r.genres[0]) || '';

      items.push({
        id: `apple-${r.collectionId || r.trackId || title}`,
        title,
        author: (r.artistName || '').trim(),
        feedUrl,
        artworkUrl,
        genre,
        episodeCount: r.trackCount,
        source: 'apple',
      });
      if (feedUrl) seenUrls.add(feedUrl.toLowerCase());
    }
  }

  // 2. Enrichir avec Gpodder (permet de retrouver le flux RSS de Radio France ou d'émissions sans feedUrl dans Apple)
  if (gpodderData && Array.isArray(gpodderData)) {
    for (const r of gpodderData) {
      const feedUrl = (r.url || '').trim();
      if (!feedUrl) continue;
      const urlKey = feedUrl.toLowerCase();
      if (seenUrls.has(urlKey)) continue;
      const title = (r.title || '').trim();
      // Gpodder colle parfois l'adresse e-mail : « France Inter (podcast@radiofrance.com) ».
      const author = (r.author || '').replace(/\s*\([^)]*@[^)]*\)/g, '').trim();
      const sameShow = (it: PodcastSearchResult) =>
        normalizeName(it.title) === normalizeName(title) && authorsMatch(it.author, author);

      // Un résultat Apple sans flux reçoit celui de Gpodder seulement si titre ET auteur concordent.
      const matchingApple = items.find(it => !it.feedUrl && sameShow(it));
      if (matchingApple) {
        matchingApple.feedUrl = feedUrl;
        if (!matchingApple.description && r.description) matchingApple.description = r.description.trim();
        seenUrls.add(urlKey);
        continue;
      }

      if (items.some(sameShow)) continue;
      seenUrls.add(urlKey);

      items.push({
        id: `gpodder-${feedUrl}`,
        title,
        author,
        feedUrl,
        artworkUrl: r.scaled_logo_url || r.logo_url || '',
        description: (r.description || '').trim(),
        source: 'gpodder',
      });
    }
  }

  // Trier les podcasts : ceux avec flux RSS validé en premier
  items.sort((a, b) => {
    if (a.feedUrl && !b.feedUrl) return -1;
    if (!a.feedUrl && b.feedUrl) return 1;
    return 0;
  });

  return items;
}

const NO_PUBLIC_FEED = 'Impossible de retrouver un flux public pour ce lien.';

/** Le texte reçu est-il un flux (RSS, Atom, RDF), quelle que soit l'adresse ? */
export function looksLikeFeed(text: string): boolean {
  const head = text.replace(/^\uFEFF/, '').slice(0, 4000);
  const root = head.search(/<(rss|feed|rdf:RDF)[\s>]/i);
  if (root === -1) return false;
  const html = head.search(/<html[\s>]/i);
  return html === -1 || root < html;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Mots trop communs pour distinguer deux producteurs (France Culture / France Inter…).
const GENERIC_AUTHOR_WORDS = new Set(['radio', 'france', 'podcast', 'podcasts', 'media', 'medias', 'studio', 'studios', 'les', 'the']);

/**
 * Vrai seulement si les deux auteurs sont connus et désignent visiblement le même producteur.
 * Un auteur absent ou trop vague (« Radio France ») ne confirme pas l'identité d'une émission.
 */
export function authorsMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  const words = (s: string) => s.split(' ').filter(w => w.length >= 3 && !GENERIC_AUTHOR_WORDS.has(w));
  const wa = words(na);
  const wb = new Set(words(nb));
  // D'abord la précision : sans mot distinctif d'un côté, même une égalité ne prouve rien.
  if (wa.length === 0 || wb.size === 0) return false;
  if (na === nb) return true;
  return wa.some(w => wb.has(w));
}

/**
 * Retrouve dans les annuaires le flux d'une émission connue par son titre (et son auteur).
 * Ne choisit seul que si une seule émission porte exactement ce titre avec le même auteur, connu des deux côtés ;
 * sinon renvoie les émissions possibles pour que l'utilisateur tranche.
 */
async function findFeedForShow(
  title: string,
  author: string,
  signal?: AbortSignal
): Promise<{ match?: PodcastSearchResult; candidates: PodcastSearchResult[] }> {
  const searchOpts: { signal?: AbortSignal; limit?: number } = { limit: 10 };
  if (signal) searchOpts.signal = signal;
  const list = await searchPodcasts(title, searchOpts);

  const seen = new Set<string>();
  const withFeed = list.filter(it => {
    if (!it.feedUrl) return false;
    const key = it.feedUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const wanted = normalizeName(title);
  const sameTitle = withFeed.filter(it => normalizeName(it.title) === wanted);
  const confirmed = sameTitle.filter(it => authorsMatch(author, it.author));
  if (confirmed.length === 1) return { match: confirmed[0], candidates: [] };

  if (confirmed.length > 0) return { candidates: confirmed.slice(0, 6) };
  if (sameTitle.length > 0) return { candidates: sameTitle.slice(0, 6) };

  // Aucun titre identique : on ne propose que des titres proches (la moitié des mots significatifs).
  const keywords = wanted.split(' ').filter(w => w.length >= 4);
  if (keywords.length === 0) return { candidates: [] };
  const closeness = (it: PodcastSearchResult) => {
    const words = new Set(normalizeName(it.title).split(' '));
    return keywords.filter(w => words.has(w)).length / keywords.length;
  };
  const near = withFeed
    .map(it => ({ it, score: closeness(it) }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map(x => x.it);
  return { candidates: near.slice(0, 6) };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isAppleHost(host: string): boolean {
  return host === 'podcasts.apple.com' || host === 'itunes.apple.com';
}

/**
 * Analyse et résout un lien collé par l'utilisateur (Apple Podcasts, Spotify, page web ou flux direct).
 */
export async function resolvePodcastLink(
  rawUrl: string,
  options?: { signal?: AbortSignal }
): Promise<LinkResolutionResult> {
  const url = rawUrl.trim();
  if (!url) {
    return { kind: 'feed', resolved: false, error: 'Veuillez saisir ou coller un lien valide.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { kind: 'feed', resolved: false, error: 'L’adresse doit commencer par http:// ou https://.' };
    }
  } catch {
    return { kind: 'feed', resolved: false, error: 'Adresse URL invalide.' };
  }

  const normalized = parsed.toString();

  // 1. Détection flux RSS direct (se termine par .xml, .rss, /feed, /rss...)
  if (/\.(xml|rss)(\?|$)/i.test(normalized) || /\/(feed|rss)(\?|$)/i.test(normalized)) {
    return {
      kind: 'feed',
      resolved: true,
      feedUrl: normalized,
      podcast: {
        id: `direct-${normalized}`,
        title: 'Flux RSS direct',
        author: '',
        feedUrl: normalized,
        artworkUrl: '',
        source: 'direct',
      },
    };
  }

  // 2. Apple Podcasts : l'identifiant de l'émission est dans le chemin (…/id1200361736)
  if (isAppleHost(parsed.hostname)) {
    const itunesId = parsed.pathname.match(/\/id(\d{5,12})(?:\/|$)/i)?.[1] ?? parsed.searchParams.get('id') ?? '';
    const lookupData = itunesId
      ? await fetchJson<ItunesSearchResult>(`https://itunes.apple.com/lookup?id=${itunesId}&entity=podcast`, options?.signal)
      : null;
    const r = lookupData?.results?.[0];
    if (!r) return { kind: 'apple', resolved: false, warning: NO_PUBLIC_FEED };

    const title = (r.collectionName || r.trackName || '').trim();
    const author = (r.artistName || '').trim();
    const appleFeed = (r.feedUrl || '').trim();
    if (appleFeed) {
      return {
        kind: 'apple',
        resolved: true,
        feedUrl: appleFeed,
        podcast: {
          id: `apple-${itunesId}`,
          title,
          author,
          feedUrl: appleFeed,
          artworkUrl: r.artworkUrl600 || r.artworkUrl100 || '',
          genre: r.primaryGenreName,
          source: 'apple',
        },
      };
    }

    // Apple ne publie pas toujours le flux (ex. Radio France) : on le cherche par titre ET auteur.
    if (title) {
      const { match, candidates } = await findFeedForShow(title, author, options?.signal);
      if (match) return { kind: 'apple', resolved: true, feedUrl: match.feedUrl, podcast: match };
      if (candidates.length > 0) return { kind: 'apple', resolved: false, candidates };
    }
    return { kind: 'apple', resolved: false, warning: NO_PUBLIC_FEED };
  }

  // 3. Spotify (open.spotify.com/show/…) : titre, et auteur quand la description le donne
  if (parsed.hostname === 'open.spotify.com' && parsed.pathname.startsWith('/show/')) {
    const html = await fetchHtmlText(normalized, options?.signal);
    const raw =
      html?.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html?.match(/<title>([^<]+)<\/title>/i)?.[1] ||
      '';
    const showTitle = decodeEntities(raw.replace(/\s*\|\s*(Podcast on )?Spotify$/i, '').trim());
    // og:description ressemble à « Écoute X sur Spotify. Podcast · Auteur · Résumé » ; sinon auteur inconnu.
    const ogDescription = html?.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] || '';
    const showAuthor = decodeEntities(ogDescription.match(/Podcast\s*·\s*([^·]+?)\s*(?:·|$)/)?.[1] || '');
    if (showTitle) {
      const { match, candidates } = await findFeedForShow(showTitle, showAuthor, options?.signal);
      if (match) return { kind: 'spotify', resolved: true, feedUrl: match.feedUrl, podcast: match };
      if (candidates.length > 0) return { kind: 'spotify', resolved: false, candidates };
    }
    return { kind: 'spotify', resolved: false, warning: NO_PUBLIC_FEED };
  }

  // 4. Autre adresse : un flux sans extension (feeds.acast.com/public/shows/…), ou une page qui en annonce un
  const text = await fetchHtmlText(normalized, options?.signal);
  if (!text) {
    return { kind: 'web', resolved: false, error: 'Adresse injoignable. Vérifie le lien et la connexion.' };
  }

  if (looksLikeFeed(text)) {
    return {
      kind: 'feed',
      resolved: true,
      feedUrl: normalized,
      podcast: {
        id: `direct-${normalized}`,
        title: 'Flux RSS direct',
        author: '',
        feedUrl: normalized,
        artworkUrl: '',
        source: 'direct',
      },
    };
  }

  const linkMatch =
    text.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i) ||
    text.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/rss\+xml["']/i) ||
    text.match(/<link[^>]+type=["']application\/atom\+xml["'][^>]+href=["']([^"']+)["']/i);

  if (linkMatch && linkMatch[1]) {
    try {
      const resolvedFeed = new URL(linkMatch[1], normalized).toString();
      const ogTitle = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      const ogImage = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      return {
        kind: 'web',
        resolved: true,
        feedUrl: resolvedFeed,
        podcast: {
          id: `web-${resolvedFeed}`,
          title: ogTitle ? ogTitle[1].trim() : 'Podcast détecté sur le site',
          author: '',
          feedUrl: resolvedFeed,
          artworkUrl: ogImage ? ogImage[1].trim() : '',
          source: 'direct',
        },
      };
    } catch { /* adresse de flux illisible : on signale l'échec ci-dessous */ }
  }

  return { kind: 'web', resolved: false, error: 'Aucun flux trouvé à cette adresse.' };
}
