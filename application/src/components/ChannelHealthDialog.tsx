import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, CircleCheck, CircleX, EyeOff, RefreshCw, RotateCcw, Search, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  clearChannelHealth,
  describeFailure,
  loadChannelHealth,
  probeStreams,
  saveChannelHealth,
  type ChannelHealthRecord,
} from '@/utils/streamCheck';
import type { Channel, ChannelGroup, PlaylistInfo } from '@/types/channel';

export type HealthScope = 'categories' | 'favorites' | 'all';

export interface ChannelHealthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Playlist active */
  playlist?: PlaylistInfo;
  /** Toutes les playlists pour le choix multi-listes */
  allPlaylists?: PlaylistInfo[];
  onSelectPlaylist?: (playlist: PlaylistInfo) => void;
  /** Groupes personnalisés ou fournis */
  groups?: ChannelGroup[];
  /** Chaînes affichées (compatibilité ascendante) */
  visibleChannels?: Channel[];
  favoriteIds?: string[];
  hiddenChannelIds?: string[];
  onHide: (ids: string[]) => void;
  onShowAll: () => void;
  tvMode?: boolean;
}

function formatCheckedTime(timestamp: number): string {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "À l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Il y a ${diffHours} h`;
  const date = new Date(timestamp);
  return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function ChannelHealthDialog({
  open,
  onOpenChange,
  playlist,
  allPlaylists,
  onSelectPlaylist,
  groups,
  visibleChannels,
  favoriteIds = [],
  hiddenChannelIds = [],
  onHide,
  onShowAll,
  tvMode,
}: ChannelHealthDialogProps) {
  // Playlist active
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(playlist?.id ?? 'default');
  useEffect(() => {
    if (playlist?.id) setSelectedPlaylistId(playlist.id);
  }, [playlist?.id]);

  const activePlaylist = useMemo(() => {
    if (allPlaylists && allPlaylists.length > 0) {
      return allPlaylists.find(p => p.id === selectedPlaylistId) ?? playlist;
    }
    return playlist;
  }, [allPlaylists, selectedPlaylistId, playlist]);

  // Groupes disponibles pour cette liste
  const availableGroups = useMemo<ChannelGroup[]>(() => {
    if (activePlaylist?.groups && activePlaylist.groups.length > 0) {
      return activePlaylist.groups;
    }
    if (groups && groups.length > 0) {
      return groups;
    }
    if (visibleChannels && visibleChannels.length > 0) {
      const byName = new Map<string, Channel[]>();
      for (const ch of visibleChannels) {
        const gName = ch.group?.trim() || 'Général';
        const list = byName.get(gName) ?? [];
        list.push(ch);
        byName.set(gName, list);
      }
      return Array.from(byName.entries()).map(([name, chs]) => ({ name, channels: chs }));
    }
    return [];
  }, [activePlaylist, groups, visibleChannels]);

  // Chaînes disponibles
  const allAvailableChannels = useMemo<Channel[]>(() => {
    if (activePlaylist?.channels && activePlaylist.channels.length > 0) {
      return activePlaylist.channels;
    }
    if (visibleChannels && visibleChannels.length > 0) {
      return visibleChannels;
    }
    return availableGroups.flatMap(g => g.channels);
  }, [activePlaylist, visibleChannels, availableGroups]);

  // Favoris
  const favorites = useMemo(() => {
    const set = new Set(favoriteIds);
    return allAvailableChannels.filter(c => set.has(c.id));
  }, [allAvailableChannels, favoriteIds]);

  // État de persistance
  const [healthMap, setHealthMap] = useState<Record<string, ChannelHealthRecord>>({});
  const healthRef = useRef<Record<string, ChannelHealthRecord>>({});
  const activePlaylistId = activePlaylist?.id ?? 'default';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadChannelHealth(activePlaylistId).then(saved => {
      if (!cancelled) {
        const merged = { ...saved, ...healthRef.current };
        healthRef.current = merged;
        setHealthMap(merged);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, activePlaylistId]);

  // Scope (périmètre)
  const defaultScope: HealthScope = availableGroups.length > 1 ? 'categories' : (favorites.length > 0 ? 'favorites' : 'all');
  const [scope, setScope] = useState<HealthScope>(defaultScope);

  // Sélection des catégories
  const [selectedGroupNames, setSelectedGroupNames] = useState<Set<string>>(() => new Set(availableGroups.map(g => g.name)));
  const [groupSearch, setGroupSearch] = useState('');

  // Réinitialiser les catégories sélectionnées quand la playlist ou les groupes changent
  useEffect(() => {
    setSelectedGroupNames(new Set(availableGroups.map(g => g.name)));
  }, [availableGroups]);

  // Options de scan
  const [ignoreFailing, setIgnoreFailing] = useState(false);
  const [quickProbe, setQuickProbe] = useState(false);

  // État d'exécution
  const [running, setRunning] = useState(false);
  const [currentDone, setCurrentDone] = useState(0);
  const [currentTotal, setCurrentTotal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Réinitialisation à la fermeture
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setCurrentDone(0);
    setCurrentTotal(0);
  }, [open]);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Chaînes ciblées par le scope
  const targetChannels = useMemo<Channel[]>(() => {
    if (scope === 'favorites') return favorites;
    if (scope === 'categories') {
      return availableGroups
        .filter(g => selectedGroupNames.has(g.name))
        .flatMap(g => g.channels);
    }
    return allAvailableChannels;
  }, [scope, favorites, availableGroups, selectedGroupNames, allAvailableChannels]);

  // Catégorisation des chaînes selon healthMap
  const { responding, failing, untested } = useMemo(() => {
    const resp: Channel[] = [];
    const fail: { channel: Channel; record: ChannelHealthRecord }[] = [];
    const untest: Channel[] = [];

    for (const channel of targetChannels) {
      const rec = healthMap[channel.id];
      // Si l'enregistrement correspond exactement à l'URL actuelle
      if (rec && rec.url === channel.url) {
        if (rec.ok) resp.push(channel);
        else fail.push({ channel, record: rec });
      } else {
        untest.push(channel);
      }
    }
    return { responding: resp, failing: fail, untested: untest };
  }, [targetChannels, healthMap]);

  // Groupes filtrés par la recherche
  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return availableGroups;
    return availableGroups.filter(g => g.name.toLowerCase().includes(q));
  }, [availableGroups, groupSearch]);

  const toggleGroup = (name: string) => {
    setSelectedGroupNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllGroups = () => {
    setSelectedGroupNames(new Set(availableGroups.map(g => g.name)));
  };

  const deselectAllGroups = () => {
    setSelectedGroupNames(new Set());
  };

  // Lancement d'un scan pour une liste donnée de chaînes
  const runScan = async (channelsToProbe: Channel[]) => {
    if (!channelsToProbe.length) return;
    if (abortRef.current && !abortRef.current.signal.aborted) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setCurrentDone(0);
    setCurrentTotal(channelsToProbe.length);

    const timeoutMs = quickProbe ? 3500 : 6000;

    try {
      await probeStreams(
        channelsToProbe.map(c => c.url),
        (count, partial) => {
          if (abortRef.current !== controller) return;
          setCurrentDone(count);

          // Sauvegarde incrémentale par lot au fil de l'eau
          const now = Date.now();
          const batchUpdates: Record<string, ChannelHealthRecord> = {};
          partial.forEach((res, idx) => {
            const ch = channelsToProbe[idx];
            if (ch && res) {
              batchUpdates[ch.id] = {
                channelId: ch.id,
                url: ch.url,
                ok: res.ok,
                status: res.status,
                checkedAt: now,
              };
            }
          });

          const next = { ...healthRef.current, ...batchUpdates };
          healthRef.current = next;
          setHealthMap(next);
          void saveChannelHealth(activePlaylistId, next).catch(() => {});
        },
        controller.signal,
        { timeoutMs },
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  };

  // Retester une chaîne unique
  const retestSingleChannel = async (channel: Channel) => {
    try {
      const results = await probeStreams([channel.url]);
      const res = results[0];
      if (res) {
        const update: ChannelHealthRecord = {
          channelId: channel.id,
          url: channel.url,
          ok: res.ok,
          status: res.status,
          checkedAt: Date.now(),
        };
        const next = { ...healthRef.current, [channel.id]: update };
        healthRef.current = next;
        setHealthMap(next);
        void saveChannelHealth(activePlaylistId, next).catch(() => {});
      }
    } catch {
      // Échec silencieux
    }
  };

  const percent = currentTotal ? Math.round((currentDone / currentTotal) * 100) : 0;
  const testedCount = responding.length + failing.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={e => {
          if (!tvMode) return;
          e.preventDefault();
          const content = e.currentTarget as HTMLElement;
          if (content) content.scrollTop = 0;
          const first = content?.querySelector<HTMLElement>('[data-remote-start], [role="radio"][aria-checked="true"], button');
          first?.focus();
        }}
        className="flex max-h-[90dvh] max-w-xl flex-col gap-3 rounded-[20px] p-5"
      >
        <DialogHeader className="gap-1">
          <div className="flex items-center justify-between">
            <DialogTitle>Vérifier les chaînes</DialogTitle>
            {allPlaylists && allPlaylists.length > 1 && (
              <select
                aria-label="Sélectionner la playlist"
                value={selectedPlaylistId}
                onChange={e => {
                  const pl = allPlaylists.find(p => p.id === e.target.value);
                  if (pl) {
                    setSelectedPlaylistId(pl.id);
                    onSelectPlaylist?.(pl);
                  }
                }}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {allPlaylists.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <DialogDescription className="text-xs">
            Teste la disponibilité des serveurs et des liens. Ne valide ni le décodage vidéo ni l’audio.
          </DialogDescription>
        </DialogHeader>

        {/* Sélection du périmètre */}
        {!running && (
          <div role="radiogroup" aria-label="Chaînes à vérifier" className="grid grid-cols-3 gap-2">
            {availableGroups.length > 1 && (
              <button
                type="button"
                role="radio"
                aria-checked={scope === 'categories'}
                onClick={() => setScope('categories')}
                className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${
                  scope === 'categories' ? 'border-primary bg-primary/10' : 'border-neutral-800 hover:bg-accent/60'
                }`}
              >
                <span className="block text-xs font-medium text-foreground">Catégories</span>
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {selectedGroupNames.size} sélectionnée{selectedGroupNames.size > 1 ? 's' : ''}
                </span>
              </button>
            )}
            <button
              type="button"
              role="radio"
              aria-checked={scope === 'favorites'}
              onClick={() => setScope('favorites')}
              className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${
                scope === 'favorites' ? 'border-primary bg-primary/10' : 'border-neutral-800 hover:bg-accent/60'
              }`}
            >
              <span className="block text-xs font-medium text-foreground">Mes favoris</span>
              <span className="block font-mono text-[11px] text-muted-foreground">{favorites.length} chaînes</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={scope === 'all'}
              onClick={() => setScope('all')}
              className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${
                scope === 'all' ? 'border-primary bg-primary/10' : 'border-neutral-800 hover:bg-accent/60'
              }`}
            >
              <span className="block text-xs font-medium text-foreground">
                {availableGroups.length > 1 ? 'Toute la liste' : 'Groupes affichés'}
              </span>
              <span className="block font-mono text-[11px] text-muted-foreground">{allAvailableChannels.length} chaînes</span>
            </button>
          </div>
        )}

        {/* Panneau de sélection des catégories */}
        {!running && scope === 'categories' && availableGroups.length > 1 && (
          <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-950/50 p-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search aria-hidden="true" className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filtrer les catégories…"
                  value={groupSearch}
                  onChange={e => setGroupSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filteredGroups.length === 1 && !selectedGroupNames.has(filteredGroups[0].name)) {
                        toggleGroup(filteredGroups[0].name);
                      } else if (targetChannels.length > 0) {
                        const list = untested.length > 0 ? untested : targetChannels;
                        void runScan(list);
                      }
                    }
                  }}
                  className="h-8 pl-8 pr-3 text-xs"
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={selectAllGroups} className="h-8 px-2 text-xs">
                Tout cocher
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={deselectAllGroups} className="h-8 px-2 text-xs">
                Tout décocher
              </Button>
            </div>

            <div className="max-h-36 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {filteredGroups.map(g => {
                  const isChecked = selectedGroupNames.has(g.name);
                  return (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => toggleGroup(g.name)}
                      className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                        isChecked ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent/40'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {isChecked ? (
                          <CheckSquare aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <Square aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{g.name}</span>
                      </span>
                      <Badge variant="outline" className="ml-1 text-[10px] font-mono">
                        {g.channels.length}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800/80 pt-2">
              <div className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {selectedGroupNames.size} catégorie{selectedGroupNames.size > 1 ? 's' : ''}
                </span>{' '}
                · {targetChannels.length} chaîne{targetChannels.length > 1 ? 's' : ''} sélectionnée{targetChannels.length > 1 ? 's' : ''}
                {selectedGroupNames.size === 0 && <span className="ml-2 text-amber-400">Choisis au moins une catégorie</span>}
              </div>
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={targetChannels.length === 0}
                onClick={() => {
                  const list = untested.length > 0 ? untested : targetChannels;
                  void runScan(list);
                }}
                className="h-8 px-3 text-xs font-semibold"
              >
                Vérifier cette sélection ({targetChannels.length})
              </Button>
            </div>
          </div>
        )}

        {/* Barre de progression pendant le scan */}
        {running && (
          <div className="space-y-1.5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground">Vérification en cours…</span>
              <span className="font-mono text-muted-foreground">
                {currentDone} / {currentTotal} ({percent}%)
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-neutral-800"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progression de la vérification"
            >
              <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {/* Résumé de l'état des chaînes cibles */}
        {!running && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-800/80 bg-neutral-900/30 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground">
                {targetChannels.length} chaîne{targetChannels.length > 1 ? 's' : ''} ciblée{targetChannels.length > 1 ? 's' : ''}
              </span>
              {testedCount > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-emerald-400">{responding.length} répondent</span>
                  <span className="text-muted-foreground">·</span>
                  <span className={failing.length > 0 ? 'text-amber-400' : 'text-muted-foreground'}>
                    {failing.length} échec{failing.length > 1 ? 's' : ''}
                  </span>
                  {untested.length > 0 && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{untested.length} non vérifiée{untested.length > 1 ? 's' : ''}</span>
                    </>
                  )}
                </>
              )}
            </div>

            {testedCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  healthRef.current = {};
                  setHealthMap({});
                  void clearChannelHealth(activePlaylistId).catch(() => {});
                }}
                className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                title="Effacer l'historique des tests pour cette liste"
              >
                <RotateCcw aria-hidden="true" className="mr-1 h-3 w-3" />
                Effacer l’historique
              </Button>
            )}
          </div>
        )}

        {/* Options de scan */}
        {!running && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={ignoreFailing}
                onChange={e => setIgnoreFailing(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-900 text-primary focus:ring-primary"
              />
              <span>Ignorer les chaînes déjà en échec</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={quickProbe}
                onChange={e => setQuickProbe(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-900 text-primary focus:ring-primary"
              />
              <span>Vérification rapide (délai court 3,5 s)</span>
            </label>
          </div>
        )}

        {/* Liste des échecs */}
        {failing.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
            <div className="flex items-center justify-between text-xs font-medium text-foreground">
              <span>Chaînes en échec de vérification ({failing.length})</span>
              <span className="text-[11px] text-muted-foreground">Un échec ponctuel peut être temporaire</span>
            </div>
            <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto pr-1">
              {failing.map(({ channel, record }) => (
                <li
                  key={channel.id}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-2 hover:bg-neutral-900/60"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <CircleX aria-hidden="true" className="h-4 w-4 shrink-0 text-live" />
                    <div className="min-w-0 flex-1 truncate">
                      <div className="truncate text-xs font-medium text-foreground">{channel.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {channel.group && <span className="truncate">{channel.group}</span>}
                        <span>·</span>
                        <span>{describeFailure(record)}</span>
                        {record.checkedAt && (
                          <>
                            <span>·</span>
                            <span>{formatCheckedTime(record.checkedAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { void retestSingleChannel(channel); }}
                    className="h-7 shrink-0 px-2 text-[11px]"
                    title="Retester cette chaîne"
                  >
                    <RefreshCw aria-hidden="true" className="mr-1 h-3 w-3" />
                    Retester
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Message si toutes répondent */}
        {!running && testedCount > 0 && failing.length === 0 && (
          <p className="flex items-center gap-2 text-xs text-foreground">
            <CircleCheck aria-hidden="true" className="h-4 w-4 text-primary" />
            Toutes les chaînes vérifiées répondent.
          </p>
        )}

        {/* Barre d'actions inférieure */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-900 pt-3">
          {hiddenChannelIds.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={onShowAll}>
              Réafficher {hiddenChannelIds.length} masquée{hiddenChannelIds.length > 1 ? 's' : ''}
            </Button>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
                Arrêter
              </Button>
            ) : (
              <>
                {/* Reprise de scan : tester uniquement les non vérifiées */}
                {untested.length > 0 && testedCount > 0 && (
                  <Button
                    type="button"
                    variant="default"
                    disabled={!untested.length}
                    onClick={() => { void runScan(untested); }}
                  >
                    Vérifier les non testées ({untested.length})
                  </Button>
                )}

                {/* Retester uniquement les échecs */}
                {failing.length > 0 && (
                  <Button
                    type="button"
                    variant={untested.length === 0 ? 'default' : 'outline'}
                    onClick={() => { void runScan(failing.map(f => f.channel)); }}
                  >
                    <RefreshCw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
                    Retester les échecs ({failing.length})
                  </Button>
                )}

                {/* Bouton de premier lancement si aucune n'a été testée */}
                {testedCount === 0 && (
                  <Button
                    type="button"
                    variant="default"
                    disabled={!targetChannels.length}
                    onClick={() => { void runScan(targetChannels); }}
                  >
                    Lancer la vérification
                  </Button>
                )}

                {/* Tout revérifier */}
                {testedCount > 0 && (
                  <Button
                    type="button"
                    variant={untested.length === 0 && failing.length === 0 ? 'default' : 'outline'}
                    disabled={!targetChannels.length}
                    onClick={() => {
                      const list = ignoreFailing ? targetChannels.filter(c => !failing.some(f => f.channel.id === c.id)) : targetChannels;
                      void runScan(list);
                    }}
                  >
                    Tout revérifier ({targetChannels.length})
                  </Button>
                )}

                {/* Masquer les échecs */}
                {failing.length > 0 && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      onHide(failing.map(f => f.channel.id));
                    }}
                  >
                    <EyeOff aria-hidden="true" className="mr-1.5 h-4 w-4" />
                    Masquer {failing.length}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
