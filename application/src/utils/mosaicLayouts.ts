// Dispositions de mosaïque enregistrées (2 à 8 chaînes), par liste. Stockées
// dans le store meta d'IndexedDB : elles passent ainsi dans les sauvegardes
// automatiques comme le reste des préférences.

import { getMeta, setMeta } from '@/utils/idb';
import type { Channel, PlaylistInfo } from '@/types/channel';

export interface MosaicLayout {
  id: string;
  name: string;
  channelIds: string[];
  createdAt: number;
}

const MAX_LAYOUTS = 20;
const key = (playlistId: string) => `mosaicLayouts:${playlistId}`;

function sanitize(raw: unknown): MosaicLayout[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const layouts: MosaicLayout[] = [];
  for (const item of raw.slice(0, MAX_LAYOUTS * 2)) {
    if (!item || typeof item !== 'object') continue;
    const { id, name, channelIds, createdAt } = item as Partial<MosaicLayout>;
    if (typeof id !== 'string' || !id || typeof name !== 'string') continue;
    const ids = Array.isArray(channelIds) ? channelIds.filter((v): v is string => typeof v === 'string') : [];
    if (ids.length < 2 || ids.length > 8) continue;
    const entry: MosaicLayout = {
      id,
      name: name.trim().slice(0, 60),
      channelIds: ids.slice(0, 8),
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    };
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    layouts.push(entry);
    if (layouts.length >= MAX_LAYOUTS) break;
  }
  return layouts;
}

export async function loadMosaicLayouts(playlistId: string): Promise<MosaicLayout[]> {
  try {
    return sanitize(await getMeta(key(playlistId)));
  } catch {
    return [];
  }
}

/** Ajoute (ou remplace, à nom identique) une disposition ; renvoie la liste à jour. */
export async function saveMosaicLayout(playlistId: string, name: string, channelIds: string[]): Promise<MosaicLayout[]> {
  const layouts = await loadMosaicLayouts(playlistId);
  const trimmed = name.trim().slice(0, 60) || `Mosaïque ${new Date().toLocaleDateString('fr-FR')}`;
  const existing = layouts.findIndex(l => l.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  const entry: MosaicLayout = {
    id: existing >= 0 ? layouts[existing].id : `mosaic:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    channelIds: channelIds.slice(0, 8),
    createdAt: Date.now(),
  };
  const next = existing >= 0 ? layouts.map(l => (l.id === entry.id ? entry : l)) : [entry, ...layouts].slice(0, MAX_LAYOUTS);
  await setMeta(key(playlistId), next);
  return next;
}

export async function deleteMosaicLayout(playlistId: string, layoutId: string): Promise<MosaicLayout[]> {
  const layouts = (await loadMosaicLayouts(playlistId)).filter(l => l.id !== layoutId);
  await setMeta(key(playlistId), layouts);
  return layouts;
}

/** Résout une disposition en chaînes encore présentes dans la liste, dans l'ordre enregistré. */
export function resolveLayout(layout: MosaicLayout, playlist: PlaylistInfo): Channel[] {
  const byId = new Map(playlist.channels.map(c => [c.id, c] as const));
  return layout.channelIds
    .map(id => byId.get(id))
    .filter((c): c is Channel => !!c)
    .slice(0, 8);
}
