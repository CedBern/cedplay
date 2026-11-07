import { useEffect, useMemo, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import type { PlaylistInfo, Channel } from '@/types/channel';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { fetchXtreamLimits, getXtreamAccount, readCachedLimits, type XtreamLimits } from '@/utils/xtreamCatalog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function MosaicPicker({ playlist, initialChannel, lockedGroups, unlocked }: { playlist: PlaylistInfo; initialChannel?: Channel; lockedGroups?: string[] | undefined; unlocked?: boolean | undefined }) {
  const [selected, setSelected] = useState<Channel[]>(initialChannel ? [initialChannel] : []);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [limit, setLimit] = useState(60);
  const [busy, setBusy] = useState(false);
  const debouncedSearch = useDebounce(search, 150);
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLocaleLowerCase();
    // Contrôle parental : les chaînes adultes sont exclues tant que le code
    // n'a pas été saisi (elles seraient sinon jouables en mosaïque).
    const locked = lockedGroups && !unlocked ? new Set(lockedGroups) : null;
    return playlist.channels.filter(c =>
      (!locked || !locked.has(c.group || '')) &&
      (!group || c.group === group) &&
      (!q || c.name.toLocaleLowerCase().includes(q))
    );
  }, [playlist, debouncedSearch, group, lockedGroups, unlocked]);
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
  const overLimit = (limits?.maxConnections ?? null) !== null && selected.length > limits!.maxConnections!;
  return <section className="space-y-4 text-white">
    {!NativePlayerBridge.isAvailable() && <p className="text-amber-300">La mosaïque est disponible dans l’application Android.</p>}
    <div className="sticky top-0 z-10 bg-neutral-950 rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap gap-2">{selected.map((c, i) => <Button key={c.id} variant="secondary" size="sm" onClick={() => toggle(c)} aria-label={`Retirer ${c.name}`}>{i + 1}. {c.name} ×</Button>)}</div>
      <Button className="w-full bg-primary hover:bg-primary/90" disabled={selected.length < 2 || busy || !NativePlayerBridge.isAvailable()} onClick={async () => { setBusy(true); try { await NativePlayerBridge.openMosaic(selected.map(c => ({ url: mosaicUrl(c), title: c.name }))); } finally { setBusy(false); } }}>{busy ? 'Mosaïque en cours…' : `Lancer la mosaïque (${selected.length}/8)`}</Button>
      {limits?.maxConnections != null
        ? <p className={`text-sm ${overLimit ? 'text-amber-300' : 'text-neutral-400'}`}>Abonnement : {limits.maxConnections} connexion{limits.maxConnections > 1 ? 's' : ''} simultanée{limits.maxConnections > 1 ? 's' : ''}{limits.activeCons ? ` · ${limits.activeCons} active${limits.activeCons > 1 ? 's' : ''} actuellement` : ''}{overLimit ? ` — une mosaïque de ${selected.length} chaînes ouvre ${selected.length} flux en même temps : le fournisseur refusera les flux au-delà de ${limits.maxConnections}.` : '.'}</p>
        : <p className="text-sm text-neutral-400">Une mosaïque ouvre un flux par chaîne : l’abonnement doit autoriser autant de connexions simultanées.</p>}
    </div>
    <Input aria-label="Rechercher une chaîne pour la mosaïque" placeholder="Rechercher une chaîne…" value={search} onChange={e => { setSearch(e.target.value); setLimit(60); }} />
    <select aria-label="Groupe de chaînes" className="w-full bg-neutral-900 rounded-md p-3" value={group} onChange={e => { setGroup(e.target.value); setLimit(60); }}><option value="">Tous les groupes</option>{playlist.groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}</select>
    <p className="text-sm text-neutral-400">{filtered.length} chaînes · {selected.length} sélectionnées</p>
    <div className="grid sm:grid-cols-2 gap-2">{filtered.slice(0, limit).map(c => {
      const checked = selected.some(s => s.id === c.id);
      return <label key={c.id} className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${checked ? 'border-primary bg-primary/15' : 'border-neutral-900 bg-white/5'}`}><input className="h-5 w-5 shrink-0 accent-primary" type="checkbox" checked={checked} disabled={!checked && selected.length >= 8} onChange={() => toggle(c)} /><span className="min-w-0 truncate">{c.name}</span></label>;
    })}</div>
    {filtered.length > limit && <Button variant="secondary" onClick={() => setLimit(v => v + 60)}>Afficher davantage</Button>}
  </section>;
}
