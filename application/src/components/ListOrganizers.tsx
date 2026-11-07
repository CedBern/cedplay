import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChannelLogo } from '@/components/ChannelLogo';
import { getFavoritesFromDB, getMeta, saveFavoritesToDB, setMeta } from '@/utils/idb';
import type { Channel, ChannelGroup } from '@/types/channel';

// ── Groupes masqués ────────────────────────────────────────────────

const hiddenKey = (playlistId: string) => `hiddenGroups:${playlistId}`;

export async function loadHiddenGroups(playlistId: string): Promise<string[]> {
  try {
    const saved = await getMeta<unknown>(hiddenKey(playlistId));
    return Array.isArray(saved) ? saved.filter((g): g is string => typeof g === 'string') : [];
  } catch { return []; }
}

export async function saveHiddenGroups(playlistId: string, groups: string[]): Promise<void> {
  await setMeta(hiddenKey(playlistId), groups);
}

/**
 * Masquer des groupes pour de bon (pays étrangers, doublons…) : ils disparaissent
 * de la liste, du guide et du zapping. Rien n'est supprimé de la liste source.
 */
export function GroupManagerDialog({ open, onOpenChange, groups, hidden, onChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ChannelGroup[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const visibleCount = groups.length - groups.filter(g => hiddenSet.has(g.name)).length;
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fr');
    return q ? groups.filter(g => g.name.toLocaleLowerCase('fr').includes(q)) : groups;
  }, [groups, query]);
  const toggle = (name: string) => onChange(hiddenSet.has(name) ? hidden.filter(g => g !== name) : [...hidden, name]);
  const setMany = (names: string[], hide: boolean) => {
    const next = new Set(hidden);
    for (const n of names) { if (hide) next.add(n); else next.delete(n); }
    onChange([...next]);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85dvh] max-w-lg flex-col gap-3 rounded-[20px]">
      <DialogHeader>
        <DialogTitle>Groupes affichés</DialogTitle>
        <DialogDescription>
          {visibleCount} sur {groups.length} visibles. Un groupe masqué disparaît de la liste, du guide et du zapping. Rien n'est supprimé.
        </DialogDescription>
      </DialogHeader>
      <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrer les groupes…" aria-label="Filtrer les groupes" className="min-h-11 rounded-full" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setMany(filtered.map(g => g.name), false)}>Tout afficher{query ? ' (filtrés)' : ''}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setMany(filtered.map(g => g.name), true)}>Tout masquer{query ? ' (filtrés)' : ''}</Button>
      </div>
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {filtered.map(group => {
          const isHidden = hiddenSet.has(group.name);
          return <li key={group.name}>
            <button
              type="button"
              role="switch"
              aria-checked={!isHidden}
              onClick={() => toggle(group.name)}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {isHidden
                ? <EyeOff aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-500" />
                : <Eye aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
              <span className={`min-w-0 flex-1 truncate text-sm ${isHidden ? 'text-neutral-500 line-through' : 'text-foreground'}`}>{group.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{group.channels.length}</span>
            </button>
          </li>;
        })}
        {filtered.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">Aucun groupe ne correspond.</li>}
      </ul>
    </DialogContent>
  </Dialog>;
}

// ── Favoris ordonnés ───────────────────────────────────────────────

/**
 * Organiser les favoris : l'ordre donne aussi leur numéro de télécommande
 * (taper 1 lance le premier favori, 2 le deuxième…).
 */
export function FavoritesOrganizerDialog({ open, onOpenChange, channels }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Toutes les chaînes de la liste active (base + variantes). */
  channels: Channel[];
}) {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    void getFavoritesFromDB().then(setFavorites).catch(() => setFavorites([]));
  }, [open]);
  const byId = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const c of channels) { map.set(c.id, c); for (const v of c.variants || []) map.set(v.id, v); }
    return map;
  }, [channels]);
  // Seuls les favoris de la liste active sont affichés ; les autres gardent leur place.
  const visible = favorites.filter(id => byId.has(id));

  const persist = (next: string[]) => {
    setFavorites(next);
    void saveFavoritesToDB(next).then(() => window.dispatchEvent(new Event('favorites-updated')));
  };
  const move = (id: string, delta: number) => {
    const pos = visible.indexOf(id);
    const target = visible[pos + delta];
    if (target === undefined) return;
    const next = [...favorites];
    const a = next.indexOf(id), b = next.indexOf(target);
    [next[a], next[b]] = [next[b], next[a]];
    persist(next);
  };
  const remove = (id: string) => persist(favorites.filter(f => f !== id));

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85dvh] max-w-lg flex-col gap-3 rounded-[20px]">
      <DialogHeader>
        <DialogTitle>Mes favoris</DialogTitle>
        <DialogDescription>Le numéro sert de touche de télécommande : tape 1 pour lancer le premier favori.</DialogDescription>
      </DialogHeader>
      <ol className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {visible.map((id, index) => {
          const channel = byId.get(id)!;
          return <li key={id} className="flex min-h-14 items-center gap-3 rounded-xl px-2 hover:bg-accent/40">
            <span className="w-6 shrink-0 text-right font-mono text-sm text-primary">{index + 1}</span>
            <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{channel.name}</span>
            <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-full" disabled={index === 0} aria-label={`Monter ${channel.name}`} onClick={() => move(id, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-full" disabled={index === visible.length - 1} aria-label={`Descendre ${channel.name}`} onClick={() => move(id, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-full text-muted-foreground" aria-label={`Retirer ${channel.name} des favoris`} onClick={() => remove(id)}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </li>;
        })}
        {visible.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">Aucun favori dans cette liste. Touche le cœur d'une chaîne pour l'ajouter.</li>}
      </ol>
    </DialogContent>
  </Dialog>;
}
