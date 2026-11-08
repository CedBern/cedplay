import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import type { PlaylistInfo, Channel } from '@/types/channel';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { fetchXtreamLimits, getXtreamAccount, readCachedLimits, type XtreamLimits } from '@/utils/xtreamCatalog';
import { deleteMosaicLayout, loadMosaicLayouts, resolveLayout, saveMosaicLayout, type MosaicLayout } from '@/utils/mosaicLayouts';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function MosaicPicker({ playlist, initialChannel, lockedGroups, unlocked }: { playlist: PlaylistInfo; initialChannel?: Channel; lockedGroups?: string[] | undefined; unlocked?: boolean | undefined }) {
  const [selected, setSelected] = useState<Channel[]>(initialChannel ? [initialChannel] : []);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [limit, setLimit] = useState(60);
  const [busy, setBusy] = useState(false);
  const debouncedSearch = useDebounce(search, 150);
  // Contrôle parental : les groupes verrouillés sont exclus tant que le code
  // n'a pas été saisi (chaînes injouables en mosaïque).
  const lockedSet = useMemo(() => (lockedGroups && !unlocked ? new Set(lockedGroups) : null), [lockedGroups, unlocked]);
  const withoutLocked = useCallback((channels: Channel[]) => lockedSet ? channels.filter(c => !lockedSet.has(c.group || '')) : channels, [lockedSet]);
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLocaleLowerCase();
    return playlist.channels.filter(c =>
      (!lockedSet || !lockedSet.has(c.group || '')) &&
      (!group || c.group === group) &&
      (!q || c.name.toLocaleLowerCase().includes(q))
    );
  }, [playlist, debouncedSearch, group, lockedSet]);
  const toggle = (channel: Channel) => setSelected(previous => previous.some(c => c.id === channel.id) ? previous.filter(c => c.id !== channel.id) : previous.length < 8 ? [...previous, channel] : previous);
  // Limites du compte (lectures simultanées) : cache d'abord, rafraîchissement
  // ensuite — l'affichage ne doit jamais attendre le réseau ni en échouer.
  const [limits, setLimits] = useState<XtreamLimits | null>(() => readCachedLimits(playlist.id));
  useEffect(() => {
    const account = getXtreamAccount(playlist);
    if (!account) return;
    let cancelled = false;
    fetchXtreamLimits(playlist.id, account).then(value => { if (!cancelled) setLimits(value); }).catch(() => { /* limite inconnue : la ligne d'aide générique suffit */ });
    return () => { cancelled = true; };
  }, [playlist]);
  // Les panneaux Xtream refusent souvent plusieurs sessions HLS simultanées
  // (l'import met le HLS en premier format), là où le TS brut passe : TiviMate
  // multi-vues fonctionne ainsi. On joue donc la variante TS quand elle existe.
  const mosaicUrl = (channel: Channel) => channel.variants?.find(v => v.url.toLowerCase().endsWith('.ts'))?.url ?? channel.url;
  // Dispositions enregistrées (par liste) : chargées au montage, sauvegardées
  // dans IndexedDB — elles suivent les sauvegardes de l'application.
  const [layouts, setLayouts] = useState<MosaicLayout[]>([]);
  const [layoutName, setLayoutName] = useState('');
  useEffect(() => {
    let cancelled = false;
    void loadMosaicLayouts(playlist.id).then(l => { if (!cancelled) setLayouts(l); }).catch(() => { /* pas de dispositions : liste vierge */ });
    return () => { cancelled = true; };
  }, [playlist.id]);
  const saveLayout = async () => {
    try {
      setLayouts(await saveMosaicLayout(playlist.id, layoutName, selected.map(c => c.id)));
      setLayoutName('');
      toast.success('Disposition enregistrée.');
    } catch { toast.error('Impossible d’enregistrer la disposition.'); }
  };
  const loadLayout = (layout: MosaicLayout) => {
    const resolved = resolveLayout(layout, playlist);
    // Une disposition enregistrée ne peut pas réintroduire des groupes
    // verrouillés depuis : le contrôle parental s'applique aussi au chargement.
    const allowed = withoutLocked(resolved);
    setSelected(allowed);
    const blocked = resolved.length - allowed.length;
    const missing = layout.channelIds.length - resolved.length;
    if (blocked > 0) toast.info(`${blocked} chaîne${blocked > 1 ? 's' : ''} de la disposition est protégée par le contrôle parental.`);
    if (missing > 0) toast.info(`${missing} chaîne${missing > 1 ? 's' : ''} de la disposition n’est plus dans la liste.`);
  };
  const removeLayout = async (layout: MosaicLayout) => {
    try { setLayouts(await deleteMosaicLayout(playlist.id, layout.id)); }
    catch { toast.error('Impossible de supprimer la disposition.'); }
  };
  const overLimit = (limits?.maxConnections ?? null) !== null && selected.length > limits!.maxConnections!;
  // Lancement : dernière vérification du contrôle parental — le verrouillage
  // peut avoir changé depuis la sélection.
  const launch = async () => {
    setBusy(true);
    try {
      const playable = withoutLocked(selected);
      if (playable.length < 2) { toast.error('Mosaïque bloquée par le contrôle parental.'); return; }
      if (playable.length < selected.length) toast.info('Chaînes protégées exclues de la mosaïque.');
      await NativePlayerBridge.openMosaic(playable.map(c => ({ url: mosaicUrl(c), title: c.name })));
    } finally { setBusy(false); }
  };
  return <section className="space-y-4 text-white">
    {!NativePlayerBridge.isAvailable() && <p className="text-amber-300">La mosaïque est disponible dans l’application Android.</p>}
    <div className="sticky top-0 z-10 bg-neutral-950 rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap gap-2">{selected.map((c, i) => <Button key={c.id} variant="secondary" size="sm" onClick={() => toggle(c)} aria-label={`Retirer ${c.name}`}>{i + 1}. {c.name} ×</Button>)}</div>
      <Button className="w-full bg-primary hover:bg-primary/90" disabled={selected.length < 2 || busy || !NativePlayerBridge.isAvailable()} onClick={() => void launch()}>{busy ? 'Mosaïque en cours…' : `Lancer la mosaïque (${selected.length}/8)`}</Button>
      <div className="flex gap-2">
        <Input aria-label="Nom de la disposition" placeholder="Nom de la disposition…" className="min-w-0 flex-1" remoteActivation value={layoutName} onChange={e => setLayoutName(e.target.value)} />
        <Button variant="secondary" disabled={selected.length < 2} onClick={() => void saveLayout()}>Enregistrer</Button>
      </div>
      {layouts.length > 0 && <div className="flex flex-wrap gap-2">
        {layouts.map(l => <span key={l.id} className="flex items-center gap-1 rounded-full border border-neutral-800 bg-white/5 py-1 pl-3 pr-1 text-sm">
          <button type="button" className="text-left hover:text-primary" onClick={() => loadLayout(l)} title={`Charger ${l.name}`}>{l.name} · {l.channelIds.length}</button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label={`Supprimer la disposition ${l.name}`} onClick={() => void removeLayout(l)}>×</Button>
        </span>)}
      </div>}
      {limits?.maxConnections != null
        ? <p className={`text-sm ${overLimit ? 'text-amber-300' : 'text-neutral-400'}`}>Abonnement : {limits.maxConnections} connexion{limits.maxConnections > 1 ? 's' : ''} simultanée{limits.maxConnections > 1 ? 's' : ''}{limits.activeCons ? ` · ${limits.activeCons} active${limits.activeCons > 1 ? 's' : ''} actuellement` : ''}{overLimit ? ` — une mosaïque de ${selected.length} chaînes ouvre ${selected.length} flux en même temps : le fournisseur refusera les flux au-delà de ${limits.maxConnections}.` : '.'}</p>
        : <p className="text-sm text-neutral-400">Une mosaïque ouvre un flux par chaîne : l’abonnement doit autoriser autant de connexions simultanées.</p>}
    </div>
    <Input remoteActivation aria-label="Rechercher une chaîne pour la mosaïque" placeholder="Rechercher une chaîne…" value={search} onChange={e => { setSearch(e.target.value); setLimit(60); }} />
    <select aria-label="Groupe de chaînes" className="w-full bg-neutral-900 rounded-md p-3" value={group} onChange={e => { setGroup(e.target.value); setLimit(60); }}><option value="">Tous les groupes</option>{playlist.groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}</select>
    <p className="text-sm text-neutral-400">{filtered.length} chaînes · {selected.length} sélectionnées</p>
    <div className="grid sm:grid-cols-2 gap-2">{filtered.slice(0, limit).map(c => {
      const checked = selected.some(s => s.id === c.id);
      return <label key={c.id} className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${checked ? 'border-primary bg-primary/15' : 'border-neutral-900 bg-white/5'}`}><input className="h-5 w-5 shrink-0 accent-primary" type="checkbox" checked={checked} disabled={!checked && selected.length >= 8} onChange={() => toggle(c)} /><span className="min-w-0 truncate">{c.name}</span></label>;
    })}</div>
    {filtered.length > limit && <Button variant="secondary" onClick={() => setLimit(v => v + 60)}>Afficher davantage</Button>}
  </section>;
}
