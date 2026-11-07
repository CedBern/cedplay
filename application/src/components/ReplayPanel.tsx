import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ExternalLink, Info, Search } from 'lucide-react';
import { toast } from 'sonner';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { getCurrentProgram, getUpcomingProgram, formatTime } from '@/utils/epgXmltv';
import { replayChannels, replayPlatforms, type ReplayChannel } from '@/data/replayChannels';
import { PlatformLogo } from '@/components/PlatformLogo';
import type { PlaylistInfo } from '@/types/channel';
import type { EPGData } from '@/types/epg';

interface ReplayPanelProps {
  playlist: PlaylistInfo | null;
  epgData: EPGData | undefined;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/** Retrouve, dans l'EPG local déjà chargé, le programme « en ce moment / à suivre » d'un nom de chaîne. */
function useNowNext(playlist: PlaylistInfo | null, epgData: EPGData | undefined) {
  return useMemo(() => {
    const byName = new Map<string, { now: string | null; next: string | null; nowEnd: string | undefined }>();
    if (!epgData || !playlist) return byName;
    for (const channel of playlist.channels) {
      const programs = epgData[channel.id];
      if (!programs?.length) continue;
      const now = getCurrentProgram(channel.id, epgData);
      const next = getUpcomingProgram(channel.id, epgData);
      const markers = [channel.name, channel.tvgName, channel.tvgId].filter((x): x is string => !!x);
      for (const marker of markers) {
        const key = norm(marker);
        if (key && !byName.has(key)) {
          byName.set(key, { now: now?.title || null, next: next?.title || null, nowEnd: now ? formatTime(now.endTime) : undefined });
        }
      }
    }
    return byName;
  }, [playlist, epgData]);
}

export function ReplayPanel({ playlist, epgData }: ReplayPanelProps) {
  const nowNext = useNowNext(playlist, epgData);
  const [query, setQuery] = useState('');

  const programFor = (ch: ReplayChannel) => {
    for (const marker of ch.epgNames) {
      const key = norm(marker);
      const exact = nowNext.get(key);
      if (exact) return exact;
      for (const [k, v] of nowNext) if (k.includes(key)) return v;
    }
    return null;
  };

  const open = (ch: ReplayChannel) => {
    const label = `Replay ${ch.name}`;
    if (NativePlayerBridge.isAvailable()) {
      void NativePlayerBridge.openWeb(ch.url, label).catch(() => toast.error(`Impossible d'ouvrir ${ch.name}.`));
    } else {
      const win = window.open(ch.url, '_blank', 'noopener');
      if (!win) toast.error(`Impossible d'ouvrir ${ch.name} (bloqueur de fenêtres).`);
    }
  };

  const search = (platformId: string) => {
    const term = query.trim();
    if (!term) { toast.error('Saisis le nom d\u2019un programme.'); return; }
    const platform = replayPlatforms.find(p => p.id === platformId);
    if (!platform) return;
    const url = platform.programUrl(term);
    if (NativePlayerBridge.isAvailable()) {
      void NativePlayerBridge.openWeb(url, `Recherche ${platform.label}`).catch(() => toast.error(`Impossible d'ouvrir ${platform.label}.`));
    } else {
      const win = window.open(url, '_blank', 'noopener');
      if (!win) toast.error('Impossible d\u2019ouvrir (bloqueur de fenêtres).');
    }
  };

  return (
    <section className="space-y-4 text-white">
      <Card className="bg-primary/10 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-white flex items-center gap-2"><Info aria-hidden="true" className="h-4 w-4" />Replay officiel des chaînes françaises</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-neutral-300">
          <p>Chaque chaîne ouvre son replay <strong>officiel</strong> (application si installée sur le téléphone, sinon le site) : TF1+, M6+, france.tv et Arte.</p>
          <p className="text-xs text-neutral-400">Aucun flux piraté : la lecture se fait sur les plateformes légales des diffuseurs. M6+ demande la création d'un compte gratuit.</p>
        </CardContent>
      </Card>

      <Card className="border-neutral-900 bg-neutral-950/90">
        <CardHeader className="pb-2">
          <CardTitle className="text-white flex items-center gap-2"><Search aria-hidden="true" className="h-4 w-4" />Trouver un programme</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); search(replayPlatforms[0].id); }}>
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ex. : Koh-Lanta, Quotidien, Envoyé spécial…"
              className="flex-1 bg-neutral-900/60 border-neutral-800 text-white placeholder:text-neutral-500"
              aria-label="Nom du programme"
            />
          </form>
          <div className="flex flex-wrap gap-2">
            {replayPlatforms.map(platform => (
              <Button key={platform.id} size="sm" variant="secondary" className="min-h-10" onClick={() => search(platform.id)}>
                <Search aria-hidden="true" className="h-3.5 w-3.5 mr-1" />{platform.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-neutral-500">TF1+ ouvre directement la page du programme (dernier épisode). M6+, france.tv et Arte ouvrent leur recherche officielle.</p>
        </CardContent>
      </Card>

      {replayPlatforms.map(platform => {
        const channels = replayChannels.filter(c => c.platform === platform.id);
        return (
          <div key={platform.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <PlatformLogo platformId={platform.id} name={platform.label} size="sm" className="h-5 w-5 rounded" />
              <h3 className="text-sm font-semibold" style={{ color: platform.color }}>{platform.label}</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {channels.map(ch => {
                const prog = programFor(ch);
                return (
                  <div key={ch.id} className="rounded-lg border border-neutral-900 bg-white/5 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <PlatformLogo platformId={ch.platform || ch.id} name={ch.name} size="md" className="h-8 w-8 rounded-lg" />
                      <span className="text-sm font-medium truncate" title={ch.name}>{ch.name}</span>
                    </div>
                    {prog?.now && (
                      <p className="text-[11px] leading-tight text-neutral-400 line-clamp-2">
                        En ce moment : <span className="text-neutral-200">{prog.now}</span>{prog.nowEnd ? ` (jusqu'à ${prog.nowEnd})` : ''}
                      </p>
                    )}
                    {prog?.next && (
                      <p className="text-[11px] leading-tight text-neutral-500 line-clamp-1">À suivre : {prog.next}</p>
                    )}
                    {ch.note && <p className="text-[10px] text-amber-300/90">{ch.note}</p>}
                    <Button size="sm" variant="secondary" className="w-full" onClick={() => open(ch)}>
                      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 mr-1" />Replay
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-neutral-500">Le guide « en ce moment / à suivre » provient de l'EPG déjà chargé dans l'app (aucune source externe ajoutée). Il s'affiche dès qu'une liste avec guide est active.</p>
    </section>
  );
}
