import type { PodcastEpisode, PodcastFeed } from '@/types/podcast';

function textOf(parent: Element | Document, tagName: string): string {
  // Handle both namespaced (itunes:duration) and plain tags
  const direct = parent.getElementsByTagName(tagName)[0];
  if (direct?.textContent) return direct.textContent.trim();
  if (tagName.includes(':')) {
    const local = tagName.split(':')[1]!;
    const nsMatches = parent.getElementsByTagNameNS('*', local);
    if (nsMatches[0]?.textContent) return nsMatches[0].textContent.trim();
  }
  return '';
}

function directChildText(parent: Element, tagName: string): string {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]!;
    if (child.tagName.toLowerCase() === tagName.toLowerCase() || child.localName?.toLowerCase() === tagName.split(':').pop()?.toLowerCase()) {
      if (tagName.includes(':') && !child.tagName.toLowerCase().startsWith(tagName.split(':')[0]!.toLowerCase() + ':')) continue;
      const val = child.textContent?.trim();
      if (val) return val;
    }
  }
  return textOf(parent, tagName);
}

function findArtwork(parent: Element): string | undefined {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]!;
    const name = child.tagName.toLowerCase();
    if (name === 'itunes:image' || child.localName?.toLowerCase() === 'image') {
      const href = child.getAttribute('href')?.trim();
      if (href && /^https?:\/\//i.test(href)) return href;
      const urlEl = child.getElementsByTagName('url')[0];
      const urlText = urlEl?.textContent?.trim();
      if (urlText && /^https?:\/\//i.test(urlText)) return urlText;
    }
  }
  return undefined;
}

/** Convertit une durée iTunes ("HH:MM:SS", "MM:SS" ou secondes) en millisecondes. */
export function parseItunesDurationMs(raw: string | undefined | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round( parseFloat(trimmed) * 1000 ));
  }
  const parts = trimmed.split(':').map(p => parseInt(p, 10));
  if (parts.some(n => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 3) {
    return ((parts[0]! * 3600) + (parts[1]! * 60) + parts[2]!) * 1000;
  }
  if (parts.length === 2) {
    return ((parts[0]! * 60) + parts[1]!) * 1000;
  }
  return 0;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedPodcastFeed {
  feed: PodcastFeed;
  episodes: PodcastEpisode[];
}

/** Analyse un flux RSS 2.0 / iTunes de podcast et extrait l'émission ainsi que ses épisodes audio. */
export function parsePodcastRss(xmlText: string, feedUrl: string, now = Date.now()): ParsedPodcastFeed {
  const normalizedUrl = feedUrl.trim();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText.trim(), 'text/xml');

  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error('Le flux RSS est invalide ou illisible.');
  }

  const channelEl = doc.getElementsByTagName('channel')[0];
  if (!channelEl) {
    throw new Error('Aucun élément <channel> trouvé dans ce flux RSS.');
  }

  const feedTitle = stripHtml(directChildText(channelEl, 'title')) || normalizedUrl;
  const feedDescription = stripHtml(
    directChildText(channelEl, 'description') || directChildText(channelEl, 'itunes:summary')
  );
  const feedArtwork = findArtwork(channelEl);
  const siteUrl = directChildText(channelEl, 'link') || undefined;

  const itemNodes = Array.from(channelEl.getElementsByTagName('item'));
  const episodes: PodcastEpisode[] = [];
  const seenIds = new Set<string>();

  for (const item of itemNodes) {
    const enclosure = item.getElementsByTagName('enclosure')[0];
    let audioUrl = enclosure?.getAttribute('url')?.trim() || '';
    if (!audioUrl) {
      const mediaContent = item.getElementsByTagName('media:content')[0];
      audioUrl = mediaContent?.getAttribute('url')?.trim() || '';
    }
    if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) continue;

    const guid = directChildText(item, 'guid') || audioUrl;
    const rawId = `${normalizedUrl}::${guid}`;
    if (seenIds.has(rawId)) continue;
    seenIds.add(rawId);

    const title = stripHtml(directChildText(item, 'title')) || 'Épisode sans titre';
    const pubDate = directChildText(item, 'pubDate') || undefined;
    const parsedDate = pubDate ? Date.parse(pubDate) : Number.NaN;
    const publishedAt = Number.isFinite(parsedDate) ? parsedDate : 0;
    const durationRaw = directChildText(item, 'itunes:duration') || directChildText(item, 'duration');
    const durationMs = parseItunesDurationMs(durationRaw);
    const description = stripHtml(
      directChildText(item, 'description')
        || directChildText(item, 'itunes:summary')
        || directChildText(item, 'content:encoded')
    );
    const artworkUrl = findArtwork(item) || feedArtwork;

    episodes.push({
      id: rawId,
      feedUrl: normalizedUrl,
      podcastTitle: feedTitle,
      title,
      audioUrl,
      ...(pubDate ? { pubDate } : {}),
      publishedAt,
      durationMs,
      ...(description ? { description } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
    });
  }

  if (episodes.length === 0) {
    throw new Error('Ce flux RSS ne contient aucun épisode audio (<enclosure>).');
  }

  episodes.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  const feed: PodcastFeed = {
    url: normalizedUrl,
    title: feedTitle,
    description: feedDescription,
    ...(feedArtwork ? { artworkUrl: feedArtwork } : {}),
    ...(siteUrl ? { siteUrl } : {}),
    addedAt: now,
    lastFetchedAt: now,
  };

  return { feed, episodes };
}
