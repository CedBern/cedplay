import { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Channel, PlaylistInfo } from '@/types/channel';
import type { EPGData } from '@/types/epg';
import type { AppSettings } from '@/utils/storage';
import { getEPGUrl, getSecondaryEPGUrls, loadGuideChannels, type GuideChannelOption } from '@/utils/epg';
import { getEpgConfig, normalizeEpgUrl, saveEpgConfig, emptyEpgConfig, type EpgConfig } from '@/utils/epgConfig';
import { getXtreamAccount } from '@/utils/xtreamCatalog';

interface EpgSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: PlaylistInfo;
  settings: AppSettings;
  epgData: EPGData | undefined;
  /** Chaîne à associer directement (depuis le guide). */
  initialChannel?: Channel | null | undefined;
}

/** Adresse affichée sans identifiants ni paramètres (les adresses Xtream contiennent le mot de passe). */
const displayUrl = (url: string) => { try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return url; } };
const SHIFTS = Array.from({ length: 49 }, (_, i) => (i - 24) / 2);
const shiftLabel = (h: number) => (h === 0 ? 'Aucun' : `${h > 0 ? '+' : '−'}${Math.abs(h).toString().replace('.', ',')} h`);
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Réglages du guide d'une liste : sources, décalage horaire et association chaîne ↔ guide. */
export function EpgSettingsDialog({ open, onOpenChange, playlist, settings, epgData, initialChannel }: EpgSettingsDialogProps) {
  const [config, setConfig] = useState<EpgConfig>(emptyEpgConfig);
  const [newUrl, setNewUrl] = useState('');
  const [tab, setTab] = useState<'sources' | 'channels'>('sources');
  const [channelQuery, setChannelQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [guideChannels, setGuideChannels] = useState<GuideChannelOption[] | null>(null);
  const [guideQuery, setGuideQuery] = useState('');
  const [loadingGuide, setLoadingGuide] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getEpgConfig(playlist.id).then(setConfig);
    setEditing(initialChannel ?? null);
    setTab(initialChannel ? 'channels' : 'sources');
    setGuideQuery('');
  }, [open, playlist.id, initialChannel]);

  // Liste des chaînes du guide : lue dans les caches, au premier besoin seulement.
  useEffect(() => {
    if (!open || !editing || guideChannels || loadingGuide) return;
    setLoadingGuide(true);
    void loadGuideChannels(playlist, settings, config.extraUrls)
      .then(setGuideChannels)
      .catch(() => setGuideChannels([]))
      .finally(() => setLoadingGuide(false));
  }, [open, editing, guideChannels, loadingGuide, playlist, settings, config.extraUrls]);
  useEffect(() => { setGuideChannels(null); }, [playlist.id, config.extraUrls.join('|')]);

  const save = async (next: EpgConfig, message?: string) => {
    try {
      setConfig(await saveEpgConfig(playlist.id, next));
      if (message) toast.success(message);
    } catch { toast.error('Impossible d’enregistrer les réglages du guide.'); }
  };

  const automatic = useMemo(() => {
    const primary = getEPGUrl(playlist, settings);
    const list: Array<{ url: string; label: string }> = [];
    if (primary) list.push({ url: primary, label: getXtreamAccount(playlist) ? 'Compte Xtream' : 'Réglages' });
    for (const url of getSecondaryEPGUrls(playlist, settings)) {
      list.push({ url, label: playlist.epgUrls?.includes(url) ? 'Annoncé par la liste' : 'Réglages' });
    }
    return list;
  }, [playlist, settings]);

  const addUrl = () => {
    const url = normalizeEpgUrl(newUrl);
    if (!url) { toast.error('Adresse invalide : elle doit commencer par http:// ou https://.'); return; }
    if (automatic.some(s => s.url === url) || config.extraUrls.includes(url)) { toast.info('Cette source est déjà utilisée.'); return; }
    setNewUrl('');
    void save({ ...config, extraUrls: [...config.extraUrls, url] }, 'Source ajoutée : le guide va être rechargé.');
  };

  const channels = useMemo(() => {
    const q = fold(channelQuery.trim());
    return playlist.channels.filter(c =>
      (!q || fold(c.name).includes(q))
      && (!onlyMissing || !epgData?.[c.id]?.length)).slice(0, 200);
  }, [playlist.channels, channelQuery, onlyMissing, epgData]);

  const guideMatches = useMemo(() => {
    if (!guideChannels) return [];
    const q = fold(guideQuery.trim());
    return (q ? guideChannels.filter(g => fold(g.name).includes(q) || fold(g.id).includes(q)) : guideChannels).slice(0, 150);
  }, [guideChannels, guideQuery]);

  const setOverride = (channel: Channel, patch: { xmltvId?: string | null; shift?: number | null }) => {
    const current = { ...(config.channels[channel.id] ?? {}) };
    if (patch.xmltvId !== undefined) { if (patch.xmltvId === null) delete current.xmltvId; else current.xmltvId = patch.xmltvId; }
    if (patch.shift !== undefined) { if (patch.shift === null) delete current.shift; else current.shift = patch.shift; }
    const nextChannels = { ...config.channels };
    if (current.xmltvId === undefined && current.shift === undefined) delete nextChannels[channel.id];
    else nextChannels[channel.id] = current;
    void save({ ...config, channels: nextChannels });
  };

  const tabClass = (active: boolean) => `min-h-10 rounded-full px-4 text-sm font-medium ${active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`;
  const override = editing ? config.channels[editing.id] : undefined;
  const guideName = (id: string) => guideChannels?.find(g => g.id === id)?.name ?? id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col border-neutral-800 bg-neutral-950 text-white">
        <DialogHeader>
          <DialogTitle>Réglages du guide</DialogTitle>
          <DialogDescription className="text-neutral-400">Pour la liste « {playlist.name} ».</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1" role="group" aria-label="Rubrique">
          <button type="button" className={tabClass(tab === 'sources')} aria-pressed={tab === 'sources'} onClick={() => setTab('sources')}>Sources</button>
          <button type="button" className={tabClass(tab === 'channels')} aria-pressed={tab === 'channels'} onClick={() => setTab('channels')}>Association des chaînes</button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto space-y-4 pr-1">
          {tab === 'sources' && <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Sources utilisées</h3>
              <p className="text-xs text-neutral-400">Les guides sont fusionnés : pour chaque chaîne, la première source qui a des programmes l’emporte.</p>
              <ul className="divide-y divide-neutral-900 rounded-lg border border-neutral-900">
                {automatic.map(source => (
                  <li key={source.url} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate" title={displayUrl(source.url)}>{displayUrl(source.url)}</span>
                    <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300">{source.label}</span>
                  </li>
                ))}
                {config.extraUrls.map(url => (
                  <li key={url} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate" title={displayUrl(url)}>{displayUrl(url)}</span>
                    <button type="button" aria-label={`Retirer ${displayUrl(url)}`} className="rounded p-2 text-neutral-400 hover:bg-red-500/20 hover:text-red-300"
                      onClick={() => { void save({ ...config, extraUrls: config.extraUrls.filter(u => u !== url) }, 'Source retirée.'); }}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {!automatic.length && !config.extraUrls.length && <li className="px-3 py-2 text-sm text-neutral-400">Aucune source pour l’instant.</li>}
              </ul>
              <form className="flex gap-2" onSubmit={e => { e.preventDefault(); addUrl(); }}>
                <Input type="url" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://…/guide.xml.gz" aria-label="Adresse d’un guide XMLTV"
                  className="flex-1 bg-neutral-900/60 border-neutral-800 text-white placeholder:text-neutral-500" />
                <Button type="submit" className="min-h-10 gap-1"><Plus className="h-4 w-4" aria-hidden="true" />Ajouter</Button>
              </form>
            </section>
            <section className="space-y-2">
              <label htmlFor="epg-offset" className="text-sm font-semibold">Décalage horaire de la liste</label>
              <p className="text-xs text-neutral-400">À utiliser si tous les programmes sont décalés. S’ajoute au tvg-shift de chaque chaîne.</p>
              <select id="epg-offset" value={config.offsetHours} onChange={e => { void save({ ...config, offsetHours: Number(e.target.value) }); }}
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white">
                {SHIFTS.map(h => <option key={h} value={h}>{shiftLabel(h)}</option>)}
              </select>
            </section>
          </>}

          {tab === 'channels' && !editing && <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={channelQuery} onChange={e => setChannelQuery(e.target.value)} placeholder="Rechercher une chaîne…" aria-label="Chaîne de la liste"
                className="flex-1 min-w-[180px] bg-neutral-900/60 border-neutral-800 text-white placeholder:text-neutral-500" />
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />Sans guide
              </label>
            </div>
            <ul className="divide-y divide-neutral-900 rounded-lg border border-neutral-900">
              {channels.map(channel => {
                const o = config.channels[channel.id];
                const has = (epgData?.[channel.id]?.length ?? 0) > 0;
                return (
                  <li key={channel.id}>
                    <button type="button" onClick={() => { setEditing(channel); setGuideQuery(''); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none">
                      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                      {o?.xmltvId && <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">Manuel</span>}
                      {o?.shift !== undefined && <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px]">{shiftLabel(o.shift)}</span>}
                      <span className={`shrink-0 text-[11px] ${has ? 'text-emerald-400' : 'text-neutral-500'}`}>{has ? 'Guide' : 'Sans guide'}</span>
                    </button>
                  </li>
                );
              })}
              {!channels.length && <li className="px-3 py-2 text-sm text-neutral-400">Aucune chaîne.</li>}
            </ul>
          </section>}

          {tab === 'channels' && editing && <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="border-neutral-800 text-white hover:bg-neutral-900" onClick={() => setEditing(null)}>Toutes les chaînes</Button>
              <span className="min-w-0 truncate font-semibold">{editing.name}</span>
            </div>
            <p className="text-sm text-neutral-300">
              Guide actuel : {override?.xmltvId ? <strong>{guideName(override.xmltvId)}</strong> : <span>automatique{editing.tvgId ? ` (tvg-id « ${editing.tvgId} »)` : ' (par le nom)'}</span>}
            </p>
            <div className="space-y-1">
              <label htmlFor="epg-channel-shift" className="text-xs text-neutral-400">Décalage pour cette chaîne</label>
              <select id="epg-channel-shift" value={override?.shift ?? ''} onChange={e => setOverride(editing, { shift: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white">
                <option value="">{editing.tvgShift ? `Celui de la liste (${shiftLabel(editing.tvgShift)})` : 'Celui de la liste'}</option>
                {SHIFTS.map(h => <option key={h} value={h}>{shiftLabel(h)}</option>)}
              </select>
            </div>
            <Input value={guideQuery} onChange={e => setGuideQuery(e.target.value)} placeholder="Chercher la chaîne dans le guide…" aria-label="Chaîne du guide"
              className="bg-neutral-900/60 border-neutral-800 text-white placeholder:text-neutral-500" />
            {loadingGuide && <p className="flex items-center gap-2 text-sm text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Lecture du guide…</p>}
            <ul className="divide-y divide-neutral-900 rounded-lg border border-neutral-900">
              {override?.xmltvId && <li><button type="button" onClick={() => { setOverride(editing, { xmltvId: null }); toast.info('Association automatique rétablie.'); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none">Revenir à l’association automatique</button></li>}
              {guideMatches.map(g => (
                <li key={g.id}>
                  <button type="button" onClick={() => { setOverride(editing, { xmltvId: g.id }); toast.success(`${editing.name} → ${g.name}`); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none ${override?.xmltvId === g.id ? 'text-primary' : ''}`}>
                    <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className="max-w-[40%] shrink-0 truncate text-[11px] text-neutral-500">{g.id}</span>
                  </button>
                </li>
              ))}
              {guideChannels && !guideMatches.length && <li className="px-3 py-2 text-sm text-neutral-400">Aucune chaîne du guide ne correspond.</li>}
            </ul>
          </section>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
