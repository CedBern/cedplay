import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { LinkResolutionResult, PodcastSearchResult } from '@/types/podcast';

/**
 * Suggestions de démarrage francophones et généralistes, avec métadonnées complètes
 * et flux RSS publics directement vérifiés pour un abonnement immédiat en un clic
 * (très utile sur mobile et particulièrement sur TV pour éviter de taper à la télécommande).
 */
export const DEFAULT_PODCAST_SUGGESTIONS: PodcastSearchResult[] = [
  {
    id: 'sug-affaires-sensibles',
    title: 'Affaires sensibles',
    author: 'France Inter · Fabrice Drouelle',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_13940.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/63/70/8c/63708c3b-ed11-5d19-fa67-132f92e463f3/mza_8301076687401115427.jpg/600x600bb.jpg',
    description: 'Les grandes affaires, les aventures et les procès qui ont marqué les cinquante dernières années.',
    genre: 'Histoire & Enquêtes',
    source: 'suggestion',
  },
  {
    id: 'sug-transfert',
    title: 'Transfert',
    author: 'Slate / Louie Media',
    feedUrl: 'https://feeds.acast.com/public/shows/transfert',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/bf/16/be/bf16be02-4fc4-bc1d-23e5-8f645229be49/mza_10793668740871146714.jpg/600x600bb.jpg',
    description: 'Des personnes ordinaires racontent des histoires extraordinaires qui ont changé leur vie.',
    genre: 'Société & Récits',
    source: 'suggestion',
  },
  {
    id: 'sug-heure-du-monde',
    title: "L'Heure du Monde",
    author: 'Le Monde',
    feedUrl: 'https://feeds.acast.com/public/shows/68db9d25-6677-5056-b8db-4d8ce7b54546',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/17/8e/ad/178eadba-b2c6-db4e-5e04-d50c95026b23/mza_4833240898516140656.jpg/600x600bb.jpg',
    description: "Chaque matin, vingt minutes pour comprendre l'actualité avec la rédaction du Monde.",
    genre: 'Actualités',
    source: 'suggestion',
  },
  {
    id: 'sug-hugodecrypte',
    title: 'HugoDécrypte - Actus du Jour',
    author: 'Hugo Décrypte',
    feedUrl: 'https://feeds.acast.com/public/shows/95497e34-5853-470a-8bf8-223403a48e71',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/cb/20/4e/cb204e3b-b2f5-b38a-7cf9-8b01e4db95c8/mza_8317377596001095908.jpg/600x600bb.jpg',
    description: "Un résumé quotidien de l'actualité en une dizaine de minutes par Hugo Décrypte.",
    genre: 'Actualités',
    source: 'suggestion',
  },
  {
    id: 'sug-pieds-sur-terre',
    title: 'Les pieds sur terre',
    author: 'France Culture',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_10267.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/1a/0f/52/1a0f52d5-7151-5120-cf9d-16ec663d2746/mza_10287515949430349488.jpg/600x600bb.jpg',
    description: 'Une demi-heure de reportage sans commentaire, nourrie de témoignages spontanés.',
    genre: 'Société & Récits',
    source: 'suggestion',
  },
  {
    id: 'sug-face-a-lhistoire',
    title: "Face à l'histoire",
    author: 'France Inter · Philippe Collin',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_18991.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/4a/12/37/4a1237eb-7e44-d9ae-8ee7-67c0ffbe4c9e/mza_17621147040854659107.jpg/600x600bb.jpg',
    description: "Grandes fresques historiques et destins hors du commun racontés par Philippe Collin.",
    genre: 'Histoire & Enquêtes',
    source: 'suggestion',
  },
  {
    id: 'sug-choses-a-savoir',
    title: 'Choses à savoir',
    author: 'Choses à Savoir',
    feedUrl: 'https://feeds.acast.com/public/shows/choses-a-savoir',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/a5/d8/4a/a5d84a5d-b06d-ce37-4d1e-e8838a6a68aa/mza_11739501531778997861.jpg/600x600bb.jpg',
    description: 'Des explications courtes pour apprendre quelque chose de nouveau chaque jour.',
    genre: 'Sciences & Tech',
    source: 'suggestion',
  },
  {
    id: 'sug-terre-au-carre',
    title: 'La Terre au carré',
    author: 'France Inter · Mathieu Vidard',
    feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_14312.xml',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/f4/04/b5/f404b5f8-8bb0-2e86-880c-0744747754b2/mza_11707530664871408051.jpg/600x600bb.jpg',
    description: 'Le magazine environnement et science de France Inter par Mathieu Vidard.',
    genre: 'Sciences & Tech',
    source: 'suggestion',
  },
  {
    id: 'sug-collimateur',
    title: 'Le Collimateur',
    author: 'IRSEM · Alexandre Jubelin',
    feedUrl: 'https://feeds.acast.com/public/shows/le-collimateur',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/a4/09/b6/a409b6ca-35ae-eeb5-7c28-971c699fa4ea/mza_13204791569438072186.jpg/600x600bb.jpg',
    description: 'Le podcast sur la guerre, les conflits armés et la géopolitique stratégique.',
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
    } catch {}
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
      const key = title.toLowerCase();
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
      const title = (r.title || '').trim();
      const key = title.toLowerCase();

      // Si un résultat Apple sans feedUrl correspondait à ce titre, on lui associe le flux Gpodder
      const matchingApple = items.find(it => it.title.trim().toLowerCase() === key && !it.feedUrl);
      if (matchingApple) {
        matchingApple.feedUrl = feedUrl;
        if (!matchingApple.description && r.description) matchingApple.description = r.description.trim();
        seenUrls.add(urlKey);
        continue;
      }

      if (seenUrls.has(urlKey) || seenTitles.has(key)) continue;
      seenTitles.add(key);
      seenUrls.add(urlKey);

      items.push({
        id: `gpodder-${feedUrl}`,
        title,
        author: (r.author || '').trim(),
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

  // 2. Détection Apple Podcasts
  const appleIdMatch = normalized.match(/id(\d{6,12})/i);
  if (normalized.includes('podcasts.apple.com') || appleIdMatch) {
    const itunesId = appleIdMatch ? appleIdMatch[1] : '';
    if (itunesId) {
      const lookupUrl = `https://itunes.apple.com/lookup?id=${itunesId}&entity=podcast`;
      const lookupData = await fetchJson<ItunesSearchResult>(lookupUrl, options?.signal);
      const r = lookupData?.results?.[0];
      if (r) {
        let feedUrl = (r.feedUrl || '').trim();
        const title = (r.collectionName || r.trackName || '').trim();
        const author = (r.artistName || '').trim();
        const artworkUrl = r.artworkUrl600 || r.artworkUrl100 || '';

        // Si Apple n'inclut pas feedUrl (ex. Radio France), chercher dans l'annuaire ouvert
        if (!feedUrl && title) {
          const searchOpts: { signal?: AbortSignal; limit?: number } = { limit: 5 };
          if (options?.signal) searchOpts.signal = options.signal;
          const list = await searchPodcasts(title, searchOpts);
          const found = list.find(it => it.feedUrl);
          if (found) feedUrl = found.feedUrl;
        }

        if (feedUrl) {
          return {
            kind: 'apple',
            resolved: true,
            feedUrl,
            podcast: {
              id: `apple-${itunesId}`,
              title,
              author,
              feedUrl,
              artworkUrl,
              genre: r.primaryGenreName,
              source: 'apple',
            },
          };
        }

        return {
          kind: 'apple',
          resolved: false,
          warning: `L'émission « ${title} » a été trouvée sur Apple Podcasts mais ne diffuse pas de flux RSS ouvert public.`,
        };
      }
    }
  }

  // 3. Détection Spotify (open.spotify.com/show/...)
  if (normalized.includes('open.spotify.com/show/')) {
    const html = await fetchHtmlText(normalized, options?.signal);
    let showTitle = '';
    if (html) {
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<title>([^<]+)<\/title>/i);
      if (ogTitle && ogTitle[1]) {
        showTitle = ogTitle[1].replace(/ \| Spotify$/i, '').replace(/ \| Podcast on Spotify$/i, '').trim();
      }
    }

    if (showTitle) {
      const searchOpts: { signal?: AbortSignal; limit?: number } = { limit: 5 };
      if (options?.signal) searchOpts.signal = options.signal;
      const searchResults = await searchPodcasts(showTitle, searchOpts);
      const matching = searchResults.find(it => it.feedUrl);
      if (matching) {
        return {
          kind: 'spotify',
          resolved: true,
          feedUrl: matching.feedUrl,
          podcast: matching,
          warning:
            'Émission identifiée depuis votre lien Spotify. Remarque : chez Spotify, le créateur doit avoir activé la distribution externe de son flux RSS pour être écouté dans CedPlay.',
        };
      }
    }

    return {
      kind: 'spotify',
      resolved: false,
      warning:
        'Ce podcast Spotify est une exclusivité interne qui ne diffuse pas de flux RSS public. Chez Spotify, le créateur doit activer son flux pour permettre une écoute hors de l’application officielle.',
    };
  }

  // 4. Détection page web standard (Radio France, Arte Radio, blog, site officiel...)
  const html = await fetchHtmlText(normalized, options?.signal);
  if (html) {
    const linkMatch =
      html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i) ||
      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/rss\+xml["']/i) ||
      html.match(/<link[^>]+type=["']application\/atom\+xml["'][^>]+href=["']([^"']+)["']/i);

    if (linkMatch && linkMatch[1]) {
      try {
        const resolvedFeed = new URL(linkMatch[1], normalized).toString();
        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
        const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
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
      } catch {}
    }
  }

  return {
    kind: 'web',
    resolved: false,
    error:
      'Aucun flux RSS public n’a pu être détecté automatiquement sur cette page. Vous pouvez essayer d’ajouter directement son adresse RSS dans les options avancées.',
  };
}
