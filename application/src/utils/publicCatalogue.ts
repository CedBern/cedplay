export interface PublicChannelSource {
  id: string;
  name: string;
  group: string;
  url: string;
  source: string;
  checkedAt?: string;
  status?: number;
  segmentStatus?: number;
  segmentSampleBytes?: number;
}

function isHttpsAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

/** Données embarquées uniquement : aucune recherche ni requête de flux à l'ouverture. */
export async function loadPublicCatalogue(signal: AbortSignal): Promise<PublicChannelSource[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}chaines-gratuites-sources.json`, { signal });
  if (!response.ok) throw new Error('Impossible de charger les sources du catalogue.');
  const data: unknown = await response.json();
  if (!Array.isArray(data) || !data.length) throw new Error('Catalogue vide ou invalide.');
  const ids = new Set<string>();
  for (const entry of data) {
    if (!entry || typeof entry !== 'object' ||
      !['id', 'name', 'group', 'url', 'source'].every(key => typeof entry[key] === 'string' && entry[key].trim()) ||
      !isHttpsAddress(entry.url) || !isHttpsAddress(entry.source) || ids.has(entry.id) ||
      (entry.checkedAt !== undefined && typeof entry.checkedAt !== 'string')) {
      throw new Error('Catalogue invalide : source ou chaîne manquante.');
    }
    ids.add(entry.id);
  }
  return data;
}

export function catalogueCheckLabel(entry: PublicChannelSource): string {
  const date = entry.checkedAt ? new Date(entry.checkedAt) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'Pas encore contrôlé';
  const stamp = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  const received = entry.status === 200 && entry.segmentStatus === 200 && (entry.segmentSampleBytes ?? 0) > 188;
  return `${received ? 'Extrait reçu' : 'Échec du contrôle'} le ${stamp}`;
}
