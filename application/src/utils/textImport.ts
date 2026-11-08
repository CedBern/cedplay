// Décodage et plafonnement des fichiers importés (listes M3U, guides XMLTV).
// Deux copies complètes d'un fichier de 400 Mo suffisaient à tuer le WebView
// sans message sur une box à 1 Go ; et un fichier Latin-1 sans déclaration
// affichait « Chaîne Ã‰ » sur toutes les chaînes.

/** Taille maximale lue sur le réseau ou sur le disque (octets). */
export const MAX_PLAYLIST_BYTES = 64 * 1024 * 1024;
export const MAX_XMLTV_BYTES = 64 * 1024 * 1024;

/** Taille maximale du texte décompressé : un gzip de 40 Mo peut doubler ou tripler. */
export const MAX_XMLTV_CHARS = 120_000_000;

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));

export function assertImportSize(bytes: number, kind: 'playlist' | 'xmltv'): void {
  const max = kind === 'xmltv' ? MAX_XMLTV_BYTES : MAX_PLAYLIST_BYTES;
  if (bytes <= max) return;
  throw new Error(kind === 'xmltv'
    ? `Guide trop volumineux (${megabytes(bytes)} Mo) : maximum ${megabytes(max)} Mo.`
    : `Liste trop volumineuse (${megabytes(bytes)} Mo) : maximum ${megabytes(max)} Mo.`);
}

export function assertXmltvTextSize(chars: number): void {
  if (chars <= MAX_XMLTV_CHARS) return;
  throw new Error(`Guide trop volumineux une fois décompressé (${megabytes(chars)} Mo) : maximum ${megabytes(MAX_XMLTV_CHARS)} Mo.`);
}

const LABEL_ALIASES: Record<string, string> = {
  'utf8': 'utf-8',
  'unicode-1-1-utf-8': 'utf-8',
  'latin1': 'windows-1252',
  'latin-1': 'windows-1252',
  'iso-8859-1': 'windows-1252',
  'iso8859-1': 'windows-1252',
  'iso_8859-1': 'windows-1252',
  'cp1252': 'windows-1252',
  'windows1252': 'windows-1252',
};

/** Déclaration `<?xml … encoding="…" ?>`, lue sur les premiers octets seulement. */
function declaredEncoding(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  const match = head.match(/<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i);
  if (!match) return null;
  const label = match[1].trim().toLowerCase();
  return LABEL_ALIASES[label] ?? label;
}

function tryDecode(bytes: Uint8Array, label: string): string | null {
  try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch { return null; }
}

/**
 * Décode un import en respectant BOM et déclaration XML, avec repli sur
 * windows-1252 quand les octets ne sont pas de l'UTF-8 valide (cas fréquent
 * des listes de revendeurs en Latin-1).
 */
export function decodeImportText(bytes: Uint8Array, kind: 'playlist' | 'xmltv'): string {
  assertImportSize(bytes.length, kind);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (kind === 'xmltv') {
    const label = declaredEncoding(bytes);
    if (label) {
      const decoded = tryDecode(bytes, label);
      if (decoded !== null) return decoded;
    }
  }
  const utf8 = tryDecode(bytes, 'utf-8');
  if (utf8 !== null) return utf8;
  return new TextDecoder('windows-1252').decode(bytes);
}
