import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Eye, EyeOff, ListOrdered, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChannelLogo } from '@/components/ChannelLogo';
import { getFavoritesFromDB, getMeta, saveFavoritesToDB, setMeta } from '@/utils/idb';
import { displayGroupOrder, duplicateNumbers, moveInList, numberChannels, type ListCustomization } from '@/utils/channelCustomization';
import { createFavoriteList, deleteFavoriteList, loadFavoriteLists, updateFavoriteList, FAVORITE_LISTS_EVENT, type FavoriteList } from '@/utils/favoriteLists';
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

/** Au-delà, la liste d'un groupe se filtre : des milliers de lignes à trois boutons pèsent sur une box. */
const MAX_ROWS = 300;
const iconButton = 'h-10 w-10 shrink-0 rounded-full';

/**
 * Organiser la liste : groupes affichés et leur ordre, ordre et numéros des chaînes
 * d'un groupe, chaînes masquées. Rien n'est supprimé de la liste source.
 */
export function GroupManagerDialog({ open, onOpenChange, groups, hidden, onChange, custom, onCustomChange, hiddenChannelIds = [], onUnhideChannels }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tous les groupes, personnalisation appliquée (noms, ordre des chaînes), masqués compris. */
  groups: ChannelGroup[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  custom?: ListCustomization | undefined;
  onCustomChange?: ((next: ListCustomization) => void) | undefined;
  hiddenChannelIds?: string[] | undefined;
  onUnhideChannels?: ((ids: string[]) => void) | undefined;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<{ kind: 'groups' } | { kind: 'group'; name: string } | { kind: 'hidden' }>({ kind: 'groups' });
  const [firstNumber, setFirstNumber] = useState('');
  useEffect(() => { if (!open) { setQuery(''); setView({ kind: 'groups' }); } }, [open]);
  useEffect(() => { setQuery(''); setFirstNumber(''); }, [view]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const visibleCount = groups.length - groups.filter(g => hiddenSet.has(g.name)).length;
  const ordered = useMemo(() => (custom ? displayGroupOrder(groups, custom) : [...groups].sort((a, b) => a.name.localeCompare(b.name, 'fr'))), [groups, custom]);
  const q = query.trim().toLocaleLowerCase('fr');
  const filtered = useMemo(() => (q ? ordered.filter(g => g.name.toLocaleLowerCase('fr').includes(q)) : ordered), [ordered, q]);
  const toggle = (name: string) => onChange(hiddenSet.has(name) ? hidden.filter(g => g !== name) : [...hidden, name]);
  const setMany = (names: string[], hide: boolean) => {
    const next = new Set(hidden);
    for (const n of names) { if (hide) next.add(n); else next.delete(n); }
    onChange([...next]);
  };
  const canOrder = !!custom && !!onCustomChange;
  const moveGroup = (name: string, delta: number) => {
    if (!custom || !onCustomChange) return;
    const names = ordered.map(g => g.name);
    onCustomChange({ ...custom, groupOrder: moveInList(names, names.indexOf(name), delta) });
  };

  const hiddenChannels = useMemo(() => {
    if (!hiddenChannelIds.length) return [];
    const ids = new Set(hiddenChannelIds);
    return groups.flatMap(g => g.channels).filter(c => ids.has(c.id));
  }, [groups, hiddenChannelIds]);

  const group = view.kind === 'group' ? groups.find(g => g.name === view.name) : undefined;
  const groupChannels = useMemo(() => {
    if (!group) return [];
    return q ? group.channels.filter(c => c.name.toLocaleLowerCase('fr').includes(q)) : group.channels;
  }, [group, q]);
  const dupes = useMemo(() => duplicateNumbers(groups.flatMap(g => g.channels)), [groups]);
  const moveChannel = (id: string, delta: number) => {
    if (!custom || !onCustomChange || !group) return;
    const ids = group.channels.map(c => c.id);
    const { channelSort: _sort, ...rest } = custom;
    onCustomChange({ ...rest, channelOrder: { ...custom.channelOrder, [group.name]: moveInList(ids, ids.indexOf(id), delta) } });
  };
  const applyNumbers = () => {
    const first = Number(firstNumber);
    if (!custom || !onCustomChange || !group || !Number.isInteger(first) || first < 1) return;
    onCustomChange(numberChannels(custom, group.channels.map(c => c.id), first));
    toast.success(`${group.channels.length} chaîne${group.channels.length > 1 ? 's' : ''} numérotée${group.channels.length > 1 ? 's' : ''} de ${first} à ${first + group.channels.length - 1}.`);
  };
  const resetGroupOrder = () => {
    if (!custom || !onCustomChange || !group) return;
    const { [group.name]: _removed, ...rest } = custom.channelOrder ?? {};
    onCustomChange({ ...custom, channelOrder: rest });
  };

  const back = <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setView({ kind: 'groups' })}><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />Groupes</Button>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85dvh] max-w-lg flex-col gap-3 rounded-[20px]">
      {view.kind === 'groups' && <>
        <DialogHeader>
          <DialogTitle>Organiser la liste</DialogTitle>
          <DialogDescription>
            {visibleCount} groupe{visibleCount > 1 ? 's' : ''} sur {groups.length} visible{visibleCount > 1 ? 's' : ''}. Un groupe masqué disparaît de la liste, du guide et du zapping. Rien n'est supprimé.
          </DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrer les groupes…" aria-label="Filtrer les groupes" className="min-h-11 rounded-full" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setMany(filtered.map(g => g.name), false)}>Tout afficher{query ? ' (filtrés)' : ''}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setMany(filtered.map(g => g.name), true)}>Tout masquer{query ? ' (filtrés)' : ''}</Button>
          {canOrder && <Button type="button" variant="outline" size="sm" aria-pressed={custom?.channelSort === 'name'} onClick={() => onCustomChange!({ ...custom!, channelSort: 'name' })}>Chaînes A–Z</Button>}
          {canOrder && custom?.channelSort === 'name' && <Button type="button" variant="outline" size="sm" onClick={() => { const { channelSort: _sort, ...rest } = custom; onCustomChange!(rest); }}>Ordre de la liste</Button>}
          {canOrder && custom?.groupOrder && <Button type="button" variant="outline" size="sm" onClick={() => { const { groupOrder: _g, ...rest } = custom; onCustomChange!(rest); }}>Ordre alphabétique</Button>}
          {hiddenChannels.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setView({ kind: 'hidden' })}><EyeOff className="mr-1.5 h-4 w-4" aria-hidden="true" />{hiddenChannels.length} chaîne{hiddenChannels.length > 1 ? 's' : ''} masquée{hiddenChannels.length > 1 ? 's' : ''}</Button>}
        </div>
        <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {filtered.map((g, index) => {
            const isHidden = hiddenSet.has(g.name);
            return <li key={g.name} className="flex items-center gap-1 rounded-xl px-1 hover:bg-accent/40">
              <button
                type="button"
                role="switch"
                aria-checked={!isHidden}
                aria-label={g.name}
                onClick={() => toggle(g.name)}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {isHidden
                  ? <EyeOff aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-500" />
                  : <Eye aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
                <span className={`min-w-0 flex-1 truncate text-sm ${isHidden ? 'text-neutral-500 line-through' : 'text-foreground'}`}>{g.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{g.channels.length}</span>
              </button>
              {canOrder && !q && <>
                <Button type="button" variant="ghost" size="icon" className={iconButton} disabled={index === 0} aria-label={`Monter le groupe ${g.name}`} onClick={() => moveGroup(g.name, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" variant="ghost" size="icon" className={iconButton} disabled={index === filtered.length - 1} aria-label={`Descendre le groupe ${g.name}`} onClick={() => moveGroup(g.name, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
              </>}
              {canOrder && <Button type="button" variant="ghost" size="icon" className={iconButton} aria-label={`Organiser les chaînes de ${g.name}`} onClick={() => setView({ kind: 'group', name: g.name })}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>}
            </li>;
          })}
          {filtered.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">Aucun groupe ne correspond.</li>}
        </ul>
      </>}

      {view.kind === 'group' && <>
        {back}
        <DialogHeader>
          <DialogTitle>{view.name}</DialogTitle>
          <DialogDescription>L’ordre choisi sert à la liste, au guide et au zapping. Le numéro sert de touche de télécommande.</DialogDescription>
        </DialogHeader>
        {group && <>
          <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); applyNumbers(); }}>
            <label htmlFor="first-number" className="text-sm text-muted-foreground">Numéroter à partir de</label>
            <Input id="first-number" value={firstNumber} onChange={e => setFirstNumber(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-24" placeholder="101" />
            <Button type="submit" variant="outline" size="sm" disabled={!firstNumber || Number(firstNumber) < 1}><ListOrdered className="mr-1.5 h-4 w-4" aria-hidden="true" />Appliquer</Button>
            {custom?.channelOrder?.[group.name] && <Button type="button" variant="ghost" size="sm" onClick={resetGroupOrder}>Ordre d’origine</Button>}
          </form>
          {group.channels.length > 20 && <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrer les chaînes…" aria-label="Filtrer les chaînes" className="min-h-11 rounded-full" />}
          <ol className="-mx-2 min-h-0 flex-1 overflow-y-auto">
            {groupChannels.slice(0, MAX_ROWS).map(channel => {
              const index = group.channels.indexOf(channel);
              return <li key={channel.id} className="flex min-h-12 items-center gap-2 rounded-xl px-2 hover:bg-accent/40">
                <span className={`w-10 shrink-0 text-right font-mono text-xs ${channel.chno && dupes.has(channel.chno) ? 'text-red-400' : 'text-primary'}`} title={channel.chno && dupes.has(channel.chno) ? 'Numéro utilisé par une autre chaîne' : undefined}>{channel.chno ?? ''}</span>
                <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{channel.name}</span>
                {!q && <>
                  <Button type="button" variant="ghost" size="icon" className={iconButton} disabled={index === 0} aria-label={`Monter ${channel.name}`} onClick={() => moveChannel(channel.id, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon" className={iconButton} disabled={index === group.channels.length - 1} aria-label={`Descendre ${channel.name}`} onClick={() => moveChannel(channel.id, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                </>}
                {q && <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => moveChannel(channel.id, -Infinity)}>En tête</Button>}
              </li>;
            })}
            {groupChannels.length > MAX_ROWS && <li className="px-2 py-3 text-center text-xs text-muted-foreground">{groupChannels.length - MAX_ROWS} autres : filtre pour les retrouver.</li>}
          </ol>
        </>}
      </>}

      {view.kind === 'hidden' && <>
        {back}
        <DialogHeader>
          <DialogTitle>Chaînes masquées</DialogTitle>
          <DialogDescription>Elles sont absentes de la liste, du guide et du zapping.</DialogDescription>
        </DialogHeader>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => { onUnhideChannels?.(hiddenChannelIds); setView({ kind: 'groups' }); }}>Tout réafficher</Button>
        <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {hiddenChannels.slice(0, MAX_ROWS).map(channel => <li key={channel.id} className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-accent/40">
            <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{channel.name}<span className="ml-2 text-xs text-muted-foreground">{channel.group}</span></span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onUnhideChannels?.([channel.id])}><Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />Réafficher</Button>
          </li>)}
        </ul>
      </>}
    </DialogContent>
  </Dialog>;
}

// ── Favoris ordonnés ───────────────────────────────────────────────

/**
 * Organiser les favoris : la liste « Favoris » donne les numéros de télécommande
 * (1 lance le premier favori) ; les autres listes (Sport, Enfants…) se rangent librement.
 */
export function FavoritesOrganizerDialog({ open, onOpenChange, channels }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Toutes les chaînes de la liste active (base + variantes). */
  channels: Channel[];
}) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [lists, setLists] = useState<FavoriteList[]>([]);
  const [selected, setSelected] = useState<string>('main');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => {
    if (!open) { setRenaming(null); setNewName(''); return; }
    let cancelled = false;
    const reload = () => {
      void Promise.all([getFavoritesFromDB(), loadFavoriteLists()]).then(([f, l]) => {
        if (cancelled) return;
        setFavorites(f); setLists(l);
        setSelected(s => (s === 'main' || l.some(x => x.id === s) ? s : 'main'));
      }).catch(() => setFavorites([]));
    };
    reload();
    window.addEventListener(FAVORITE_LISTS_EVENT, reload);
    return () => { cancelled = true; window.removeEventListener(FAVORITE_LISTS_EVENT, reload); };
  }, [open]);
  const byId = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const c of channels) { map.set(c.id, c); for (const v of c.variants || []) map.set(v.id, v); }
    return map;
  }, [channels]);
  const list = lists.find(l => l.id === selected);
  const ids = list ? list.channelIds : favorites;
  // Seules les chaînes de la liste active sont affichées ; les autres gardent leur place.
  const visible = ids.filter(id => byId.has(id));

  const persist = (next: string[]) => {
    if (list) { setLists(prev => prev.map(l => (l.id === list.id ? { ...l, channelIds: next } : l))); void updateFavoriteList(list.id, { channelIds: next }); return; }
    setFavorites(next);
    void saveFavoritesToDB(next).then(() => window.dispatchEvent(new Event('favorites-updated')));
  };
  const move = (id: string, delta: number) => {
    const pos = visible.indexOf(id);
    const target = visible[pos + delta];
    if (target === undefined) return;
    const next = [...ids];
    const a = next.indexOf(id), b = next.indexOf(target);
    [next[a], next[b]] = [next[b]!, next[a]!];
    persist(next);
  };
  const remove = (id: string) => persist(ids.filter(f => f !== id));
  const create = async () => {
    const created = await createFavoriteList(newName);
    if (!created) { toast.error('Nom vide ou nombre maximal de listes atteint.'); return; }
    setNewName(''); setSelected(created.id);
  };

  const chip = (id: string, label: string) => <button
    key={id}
    type="button"
    aria-pressed={selected === id}
    onClick={() => { setSelected(id); setRenaming(null); }}
    className={`min-h-10 rounded-full border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected === id ? 'border-foreground bg-foreground text-background' : 'border-neutral-800 text-muted-foreground hover:bg-accent'}`}
  >{label}</button>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85dvh] max-w-lg flex-col gap-3 rounded-[20px]">
      <DialogHeader>
        <DialogTitle>Mes favoris</DialogTitle>
        <DialogDescription>{list ? 'Range cette liste comme tu veux. Ajoute une chaîne depuis « Modifier la chaîne ».' : 'Le numéro sert de touche de télécommande : tape 1 pour lancer le premier favori.'}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        {chip('main', 'Favoris')}
        {lists.map(l => chip(l.id, l.name))}
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void create(); }}>
        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nouvelle liste" aria-label="Nom de la nouvelle liste de favoris" maxLength={40} />
        <Button type="submit" variant="outline" disabled={!newName.trim()} className="shrink-0"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Créer</Button>
      </form>
      {list && <div className="flex flex-wrap items-center gap-2">
        {renaming === list.id
          ? <form className="flex flex-1 gap-2" onSubmit={e => { e.preventDefault(); const value = (e.currentTarget.elements.namedItem('rename') as HTMLInputElement).value.trim(); if (value) void updateFavoriteList(list.id, { name: value }); setRenaming(null); }}>
            <Input name="rename" defaultValue={list.name} aria-label="Nouveau nom de la liste" maxLength={40} autoFocus />
            <Button type="submit" size="sm">OK</Button>
          </form>
          : <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(list.id)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />Renommer</Button>}
        <Button type="button" variant="ghost" size="sm" className="text-red-400" onClick={() => { void deleteFavoriteList(list.id); setSelected('main'); toast.info(`Liste « ${list.name} » supprimée.`); }}><Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Supprimer la liste</Button>
      </div>}
      <ol className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {visible.map((id, index) => {
          const channel = byId.get(id)!;
          return <li key={id} className="flex min-h-14 items-center gap-3 rounded-xl px-2 hover:bg-accent/40">
            <span className="w-6 shrink-0 text-right font-mono text-sm text-primary">{list ? '' : index + 1}</span>
            <ChannelLogo src={channel.logo ?? null} name={channel.name} compact />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{channel.name}</span>
            <Button type="button" variant="ghost" size="icon" className={iconButton} disabled={index === 0} aria-label={`Monter ${channel.name}`} onClick={() => move(id, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className={iconButton} disabled={index === visible.length - 1} aria-label={`Descendre ${channel.name}`} onClick={() => move(id, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className={`${iconButton} text-muted-foreground`} aria-label={`Retirer ${channel.name} de la liste`} onClick={() => remove(id)}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </li>;
        })}
        {visible.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">{list ? 'Cette liste est vide pour la liste de chaînes active.' : 'Aucun favori dans cette liste. Touche le cœur d’une chaîne pour l’ajouter.'}</li>}
      </ol>
    </DialogContent>
  </Dialog>;
}
