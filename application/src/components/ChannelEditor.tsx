import { useEffect, useState } from 'react';
import { Check, EyeOff, Heart, ListPlus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChannelLogo } from '@/components/ChannelLogo';
import { cleanEdit, cleanNumber, type ChannelEdit } from '@/utils/channelCustomization';
import { createFavoriteList, loadFavoriteLists, toggleInFavoriteList, FAVORITE_LISTS_EVENT, type FavoriteList } from '@/utils/favoriteLists';
import { getFavoritesFromDB, saveFavoritesToDB } from '@/utils/idb';
import type { Channel } from '@/types/channel';

/**
 * Modifier une chaîne : nom, logo, numéro, listes de favoris, masquage.
 * `channel` est la chaîne d'origine (avant personnalisation).
 */
export function ChannelEditorDialog({ channel, edit, onOpenChange, onSave, onHide }: {
  channel: Channel | null;
  edit?: ChannelEdit | undefined;
  onOpenChange: (open: boolean) => void;
  onSave: (edit: ChannelEdit | null) => void;
  onHide: (channel: Channel) => void;
}) {
  const [name, setName] = useState('');
  const [logo, setLogo] = useState('');
  const [number, setNumber] = useState('');
  const [lists, setLists] = useState<FavoriteList[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [newList, setNewList] = useState('');

  useEffect(() => {
    if (!channel) return;
    setName(edit?.name ?? '');
    setLogo(edit?.logo ?? '');
    setNumber(edit?.chno ?? '');
    setNewList('');
  }, [channel, edit]);

  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    const reload = () => {
      void Promise.all([loadFavoriteLists(), getFavoritesFromDB()]).then(([l, favs]) => {
        if (cancelled) return;
        setLists(l);
        setFavorite(favs.includes(channel.id));
      }).catch(() => {});
    };
    reload();
    window.addEventListener(FAVORITE_LISTS_EVENT, reload);
    return () => { cancelled = true; window.removeEventListener(FAVORITE_LISTS_EVENT, reload); };
  }, [channel]);

  if (!channel) return null;
  const numberInvalid = number.trim() !== '' && !cleanNumber(number);
  const logoInvalid = logo.trim() !== '' && !/^(https?:|data:image\/)/i.test(logo.trim());

  const save = () => {
    if (numberInvalid || logoInvalid) return;
    onSave(cleanEdit({ name, logo, chno: number }));
    onOpenChange(false);
    toast.success(`« ${name.trim() || channel.name} » modifiée.`);
  };
  const reset = () => { onSave(null); onOpenChange(false); toast.info(`« ${channel.name} » rétablie comme dans la liste.`); };
  const toggleFavorite = async () => {
    const favs = await getFavoritesFromDB();
    const next = favs.includes(channel.id) ? favs.filter(id => id !== channel.id) : [...favs, channel.id];
    await saveFavoritesToDB(next);
    setFavorite(next.includes(channel.id));
    window.dispatchEvent(new Event('favorites-updated'));
  };
  const addList = async () => {
    const created = await createFavoriteList(newList, channel.id);
    if (!created) { toast.error('Nom de liste vide ou nombre maximal de listes atteint.'); return; }
    setNewList('');
    toast.success(`Ajoutée à « ${created.name} ».`);
  };

  const listButton = (label: string, active: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'border-primary bg-primary/15 text-foreground' : 'border-neutral-800 text-muted-foreground hover:bg-accent'}`}
    >
      {active ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <Heart className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </button>
  );

  return <Dialog open={!!channel} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col gap-4 overflow-y-auto rounded-[20px]">
      <DialogHeader>
        <DialogTitle>Modifier la chaîne</DialogTitle>
        <DialogDescription>Les changements restent dans l’application : la liste du fournisseur n’est pas modifiée, et une actualisation les conserve.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3">
        <ChannelLogo src={(logo.trim() && !logoInvalid ? logo.trim() : channel.logo) ?? null} name={name.trim() || channel.name} />
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{name.trim() || channel.name}</p>
          <p className="truncate text-xs text-muted-foreground">{channel.group || 'Sans groupe'}{channel.chno ? ` · n° d’origine ${channel.chno}` : ''}</p>
        </div>
      </div>
      <label className="grid gap-1.5 text-sm">
        <span className="text-muted-foreground">Nom affiché</span>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={channel.name} maxLength={120} />
      </label>
      <div className="grid gap-1.5 text-sm">
        <label htmlFor="channel-edit-logo" className="text-muted-foreground">Adresse du logo</label>
        <Input id="channel-edit-logo" value={logo} onChange={e => setLogo(e.target.value)} placeholder={channel.logo || 'https://…/logo.png'} inputMode="url" aria-invalid={logoInvalid} aria-describedby={logoInvalid ? 'channel-edit-logo-error' : undefined} />
        {logoInvalid && <span id="channel-edit-logo-error" className="text-xs text-red-400">Une adresse http(s) d’image est attendue.</span>}
      </div>
      <div className="grid gap-1.5 text-sm">
        <label htmlFor="channel-edit-number" className="text-muted-foreground">Numéro de chaîne</label>
        <Input id="channel-edit-number" value={number} onChange={e => setNumber(e.target.value)} placeholder={channel.chno || 'Position dans la liste'} inputMode="numeric" aria-invalid={numberInvalid} aria-describedby={numberInvalid ? 'channel-edit-number-error' : undefined} className="max-w-[10rem]" />
        {numberInvalid && <span id="channel-edit-number-error" className="text-xs text-red-400">Un nombre entier positif est attendu.</span>}
      </div>
      <div className="grid gap-2 text-sm">
        <span className="text-muted-foreground">Listes de favoris</span>
        <div className="flex flex-wrap gap-2">
          {listButton('Favoris', favorite, () => { void toggleFavorite(); }, 'main')}
          {lists.map(l => listButton(l.name, l.channelIds.includes(channel.id), () => { void toggleInFavoriteList(l.id, channel.id); }, l.id))}
        </div>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void addList(); }}>
          <Input value={newList} onChange={e => setNewList(e.target.value)} placeholder="Nouvelle liste (Sport, Enfants…)" aria-label="Nom de la nouvelle liste de favoris" maxLength={40} />
          <Button type="submit" variant="outline" disabled={!newList.trim()} className="shrink-0"><ListPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />Créer</Button>
        </form>
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-neutral-800 pt-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => { onHide(channel); onOpenChange(false); }}><EyeOff className="mr-1.5 h-4 w-4" aria-hidden="true" />Masquer</Button>
          {edit && <Button type="button" variant="ghost" onClick={reset}><RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />Rétablir</Button>}
        </div>
        <Button type="button" onClick={save} disabled={numberInvalid || logoInvalid}>Enregistrer</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
