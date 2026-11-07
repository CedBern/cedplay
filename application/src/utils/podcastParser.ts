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

/** Erreur de contenu du flux (format, épisodes) : inutile de retenter par un autre chemin réseau. */
export class FeedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedFormatError';
  }
}

function childrenNamed(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(c => (c.localName || c.tagName).toLowerCase() === localName);
}

/** Lien Atom portant cette relation (« alternate » par défaut quand rel est absent). */
function atomLink(parent: Element, rel: string, preferAudio = false): string {
  const links = childrenNamed(parent, 'link').filter(l => (l.getAttribute('rel') || 'alternate') === rel && l.getAttribute('href'));
  const chosen = (preferAudio && links.find(l => (l.getAttribute('type') || '').startsWith('audio/'))) || links[0];
  return chosen?.getAttribute('href')?.trim() || '';
}

/** Adresse audio d'un élément : enclosure RSS 2.0, enc:enclosure RSS 1.0, lien Atom ou media:content. */
function audioUrlOf(item: Element, isAtom: boolean): string {
  if (isAtom) {
    const href = atomLink(item, 'enclosure', true);
    if (href) return href;
  }
  const enclosure = item.getElementsByTagNameNS('*', 'enclosure')[0] || item.getElementsByTagName('enclosure')[0];
  const fromEnclosure = enclosure?.getAttribute('url') || enclosure?.getAttribute('rdf:resource') || enclosure?.getAttributeNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'resource');
  if (fromEnclosure?.trim()) return fromEnclosure.trim();
  const mediaContent = item.getElementsByTagName('media:content')[0] || item.getElementsByTagNameNS('*', 'content')[0];
  return mediaContent?.getAttribute('url')?.trim() || '';
}

/** Analyse un flux de podcast RSS 2.0 / iTunes, RSS 1.0 (RDF) ou Atom, et extrait l'émission et ses épisodes audio. */
export function parsePodcastRss(xmlText: string, feedUrl: string, now = Date.now()): ParsedPodcastFeed {
  const normalizedUrl = feedUrl.trim();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText.replace(/^\uFEFF/, '').trim(), 'text/xml');

  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new FeedFormatError('Le flux est invalide ou illisible.');
  }

  const root = doc.documentElement;
  const isAtom = (root?.localName || '').toLowerCase() === 'feed';
  const channelEl = isAtom ? root : doc.getElementsByTagName('channel')[0];
  if (!channelEl) {
    throw new FeedFormatError('Format de flux non reconnu : RSS ou Atom attendu.');
  }

  const feedTitle = stripHtml(directChildText(channelEl, 'title')) || normalizedUrl;
  const feedDescription = stripHtml(
    (isAtom ? directChildText(channelEl, 'subtitle') : directChildText(channelEl, 'description'))
      || directChildText(channelEl, 'itunes:summary')
  );
  let feedArtwork = findArtwork(channelEl);
  if (!feedArtwork && isAtom) {
    const logo = (childrenNamed(channelEl, 'logo')[0] || childrenNamed(channelEl, 'icon')[0])?.textContent?.trim();
    if (logo && /^https?:\/\//i.test(logo)) feedArtwork = logo;
  }
  const siteUrl = (isAtom ? atomLink(channelEl, 'alternate') : directChildText(channelEl, 'link')) || undefined;

  // RSS 2.0 : <item> dans <channel>. RSS 1.0 (RDF) : <item> à côté de <channel>. Atom : <entry>.
  let itemNodes = isAtom ? childrenNamed(channelEl, 'entry') : Array.from(channelEl.getElementsByTagName('item'));
  if (!isAtom && itemNodes.length === 0) itemNodes = Array.from(doc.getElementsByTagName('item'));
  const episodes: PodcastEpisode[] = [];
  const seenIds = new Set<string>();

  for (const item of itemNodes) {
    const audioUrl = audioUrlOf(item, isAtom);
    if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) continue;

    const guid = directChildText(item, isAtom ? 'id' : 'guid') || item.getAttribute('rdf:about') || audioUrl;
    const rawId = `${normalizedUrl}::${guid}`;
    if (seenIds.has(rawId)) continue;
    seenIds.add(rawId);

    const title = stripHtml(directChildText(item, 'title')) || 'Épisode sans titre';
    const pubDate = (isAtom
      ? directChildText(item, 'published') || directChildText(item, 'updated')
      : directChildText(item, 'pubDate') || directChildText(item, 'dc:date')) || undefined;
    const parsedDate = pubDate ? Date.parse(pubDate) : Number.NaN;
    const publishedAt = Number.isFinite(parsedDate) ? parsedDate : 0;
    const durationRaw = directChildText(item, 'itunes:duration') || directChildText(item, 'duration');
    const durationMs = parseItunesDurationMs(durationRaw);
    const description = stripHtml(
      (isAtom
        ? directChildText(item, 'summary') || directChildText(item, 'content')
        : directChildText(item, 'description') || directChildText(item, 'content:encoded'))
        || directChildText(item, 'itunes:summary')
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
    throw new FeedFormatError('Ce flux ne contient aucun épisode audio.');
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
