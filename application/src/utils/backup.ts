import { z } from 'zod';
import { Channel, PlaylistInfo } from '@/types/channel';

const channelSchema: z.ZodType<Channel, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  id: z.string().min(1), name: z.string(), url: z.string(),
  logo: z.string().optional(), group: z.string().optional(), tvgId: z.string().optional(),
  tvgName: z.string().optional(), chno: z.string().optional(), duration: z.number().finite().optional(),
  isFavorite: z.boolean().optional(), quality: z.enum(['4K', 'UHD', 'FHD', 'HD', 'SD']).optional(),
  variants: z.array(channelSchema).optional(),
}).strict().transform(value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as unknown as Channel));

const playlistSchema = z.object({
  id: z.string().min(1), name: z.string(), url: z.string().optional(),
  channels: z.array(channelSchema), totalChannelsBeforeDedup: z.number().int().nonnegative().optional(),
}).strict();

const localSchema = z.object({
  /** Positions de lecture VOD (localStorage `vod_progress_*`). */
  vodProgress: z.record(z.object({ positionMs: z.number().finite(), durationMs: z.number().finite() })).optional(),
  /** Comptes Xtream liés (localStorage `xtream_account_*`), mots de passe inclus. */
  xtreamAccounts: z.record(z.object({ server: z.string(), username: z.string(), password: z.string() })).optional(),
  /** Nom de la dernière liste utilisée. */
  lastPlaylist: z.string().optional(),
}).strict().optional();

// Version 2 ajoute la section `local` (progression VOD, comptes Xtream) ;
// les sauvegardes v1 restent lisibles.
const backupSchema = z.object({
  format: z.literal('lecteur-iptv'), version: z.union([z.literal(1), z.literal(2)]), createdAt: z.string().datetime(),
  playlists: z.array(playlistSchema),
  meta: z.array(z.object({ key: z.string().min(1), value: z.unknown() }).strict()),
  local: localSchema,
}).strict();

export type Backup = z.infer<typeof backupSchema>;
export type MetaEntry = { key: string; value: unknown };
export type LocalBackup = NonNullable<Backup['local']>;

export function playlistSignature(playlist: Backup['playlists'][number]): string {
  return JSON.stringify(playlist, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
}

// Files are JSON only, never evaluated. Bound nesting before recursive schema parsing.
function checkDepth(value: unknown, depth = 0): void {
  if (depth > 30) throw new Error('Sauvegarde trop imbriquée.');
  if (value && typeof value === 'object') for (const item of Object.values(value)) checkDepth(item, depth + 1);
}

export function parseBackup(text: string): Backup {
  try {
    const raw: unknown = JSON.parse(text);
    checkDepth(raw);
    const backup = backupSchema.parse(raw);
    if (new Set(backup.playlists.map(p => p.id)).size !== backup.playlists.length ||
        new Set(backup.meta.map(m => m.key)).size !== backup.meta.length) throw new Error();
    for (const entry of backup.meta) {
      if (entry.key === 'favorites' && (!Array.isArray(entry.value) || entry.value.some(id => typeof id !== 'string'))) throw new Error();
      if (entry.key === 'playHistory' && (!Array.isArray(entry.value) || entry.value.some(e =>
        !e || typeof e.channelId !== 'string' || !Number.isFinite(e.ts)))) throw new Error();
      if (entry.key === 'settings') {
        // Schéma volontairement tolérant : une future version peut étendre les réglages.
        z.object({ volume: z.number().min(0).max(1).optional(), autoplay: z.boolean().optional(),
          theme: z.enum(['light', 'dark']).optional(), keyboardNavigation: z.boolean().optional() }).passthrough().parse(entry.value);
      }
      if (['lastPlaylistId', 'selectedGroup', 'qualityFilter', 'searchMode'].includes(entry.key) ||
          entry.key.startsWith('lastChannel_') || entry.key.startsWith('preferredVariant_')) {
        if (entry.value !== undefined && typeof entry.value !== 'string') throw new Error();
      }
      if (['compactMode', 'virtualizationEnabled', 'showVariants', 'showPerfPanel'].includes(entry.key) && typeof entry.value !== 'boolean') throw new Error();
    }
    return backup;
  } catch { throw new Error('Sauvegarde invalide ou version non prise en charge. Aucune donnée modifiée.'); }
}

export function createBackup(playlists: PlaylistInfo[], meta: MetaEntry[], local?: LocalBackup): Backup {
  return { format: 'lecteur-iptv', version: 2, createdAt: new Date().toISOString(),
    playlists: playlists.map(({ groups: _groups, ...playlist }) => playlist), meta, local };
}

export function rebuildPlaylist(playlist: Backup['playlists'][number]): PlaylistInfo {
  const groups = new Map<string, Channel[]>();
  for (const channel of playlist.channels) {
    const name = channel.group || 'Ungrouped';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(channel);
  }
  const { url, totalChannelsBeforeDedup, ...base } = playlist;
  return { ...base, ...(url !== undefined ? { url } : {}),
    ...(totalChannelsBeforeDedup !== undefined ? { totalChannelsBeforeDedup } : {}),
    groups: [...groups].map(([name, channels]) => ({ name, channels })) };
}
