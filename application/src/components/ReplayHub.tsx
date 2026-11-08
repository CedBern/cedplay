import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ExternalLink, Plus, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PlatformLogo } from '@/components/PlatformLogo';
import { NativePlayerBridge } from '@/utils/nativePlayer';
import { focusRemote } from '@/utils/remoteNavigation';
import { formatTime, getCurrentProgram } from '@/utils/epgXmltv';
import { formatDuration, formatReplayDate, matchReplayChannel, recentReplays, searchReplays, type RecentReplayItem, type ReplayItem } from '@/utils/replayFinder';
import { readMyPlatforms, writeMyPlatforms } from '@/utils/myPlatforms';
import { streamingPlatforms, type StreamingPlatform } from '@/data/streamingPlatforms';
import { replayChannels, replayPlatforms, type ReplayChannel } from '@/data/replayChannels';
import type { Channel } from '@/types/channel';
import type { EPGData, EPGProgram } from '@/types/epg';

type View = 'replay' | 'platforms';
type Filter = 'all' | NonNullable<StreamingPlatform['category']>;

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'svod', label: 'Cinéma et séries' },
  { key: 'tv', label: 'Chaînes TV' },
  { key: 'free', label: 'Gratuites' },
  { key: 'anime', label: 'Anime' },
  { key: 'sport', label: 'Sport' },
];

/** Ce que la recherche ouvre sur chaque site officiel. */
const siteSearchHint: Record<string, string> = {
  tf1plus: 'Page de l’émission',
  m6plus: 'Résultats de recherche · compte gratuit',
  francetv: 'Résultats de recherche',
  arte: 'Résultats de recherche',
};

/** Application officielle si elle est installée (Android), sinon le navigateur. */
function openExternal(url: string, label: string, name: string) {
  if (NativePlayerBridge.isAvailable()) {
    void NativePlayerBridge.openWeb(url, label).catch(() => toast.error(`Impossible d’ouvrir ${name}.`));
    return;
  }
  // « noopener » ferait toujours renvoyer null : on coupe le lien à la main.
  const win = window.open(url, '_blank');
  if (win) win.opener = null;
  else toast.error(`Impossible d’ouvrir ${name} (bloqueur de fenêtres).`);
}

/** OK de la télécommande (Entrée) : une bascule par appui, sans répétition si la touche reste enfoncée. */
const okToggles = (toggle: () => void) => (event: KeyboardEvent<HTMLButtonElement>) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) toggle();
};

export interface ReplayHubProps {
  /** Chaînes jouables de la liste active (groupes verrouillés déjà retirés). */
  channels: Channel[];
  epgData: EPGData | undefined;
  /** Jours d'archive du fournisseur pour une chaîne (0 : pas de replay). */
  catchupDays: (channel: Channel) => number;
  /** Lecture d'une émission passée dans l'app. */
  onCatchup: (channel: Channel, program: EPGProgram) => void;
  tvMode?: boolean;
}

/**
 * Replay et plateformes : le replay de la liste (lu dans l'app), le replay officiel des
 * chaînes et les plateformes de streaming (ouvertes dans leur application ou leur site).
 * Téléphone : deux vues. TV : une seule page en rangées, sans onglets à traverser.
 */
export function ReplayHub({ channels, epgData, catchupDays, onCatchup, tvMode = false }: ReplayHubProps) {
  const [view, setView] = useState<View>('replay');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<Filter>('all');
  const [mine, setMine] = useState<string[]>(readMyPlatforms);
  const [choosing, setChoosing] = useState(false);
  const chooserOpener = useRef<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // « En ce moment », soirées terminées et fin d'archive suivent l'heure tant que la page reste ouverte.
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== 'hidden') setNow(Date.now()); };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const hasCatchup = useMemo(() => channels.some(c => catchupDays(c) > 0), [channels, catchupDays]);
  const recent = useMemo(() => recentReplays(channels, epgData, catchupDays, now), [channels, epgData, catchupDays, now]);
  const hits = useMemo(() => searchReplays(channels, epgData, catchupDays, deferredQuery, now), [channels, epgData, catchupDays, deferredQuery, now]);
  const searching = query.trim().length > 0;

  // Émission du moment de chaque chaîne de replay officiel, d'après le guide déjà chargé.
  const onAir = useMemo(() => {
    const map = new Map<string, EPGProgram>();
    if (!epgData) return map;
    const at = new Date(now);
    for (const channel of channels) {
      if (!epgData[channel.id]?.length) continue;
      const replayChannel = matchReplayChannel(channel);
      if (!replayChannel || map.has(replayChannel.id)) continue;
      const current = getCurrentProgram(channel.id, epgData, at);
      if (current) map.set(replayChannel.id, current);
    }
    return map;
  }, [channels, epgData, now]);

  const minePlatforms = useMemo(() => streamingPlatforms.filter(p => mine.includes(p.id)), [mine]);
  const otherPlatforms = useMemo(
    () => streamingPlatforms.filter(p => !mine.includes(p.id) && (filter === 'all' || p.category === filter)),
    [mine, filter],
  );
  const toggleMine = (id: string) => {
    const next = mine.includes(id) ? mine.filter(x => x !== id) : [...mine, id];
    setMine(next);
    writeMyPlatforms(next);
  };

  const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const openPlatform = (p: StreamingPlatform) => openExternal(p.url, p.name, p.name);
  const openChannel = (ch: ReplayChannel) => openExternal(ch.url, `Replay ${ch.name}`, ch.name);

  const sectionTitle = (id: string, title: string, hint?: string, action?: ReactNode) => (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 id={id} className={`${tvMode ? 'text-lg' : 'text-[17px]'} font-semibold text-foreground`}>{title}</h3>
        {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );

  const searchField = (
    <form role="search" className={`relative ${tvMode ? 'max-w-xl' : ''}`} onSubmit={e => {
      e.preventDefault();
      // Valider ferme le clavier. Sur TV, le focus reste sur le champ (sortie de saisie)
      // pour que les flèches repartent de là, et non du haut de la page.
      const field = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
      field?.blur();
      if (tvMode) field?.focus({ preventScroll: true });
    }}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        remoteActivation={tvMode}
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        enterKeyHint="search"
        placeholder="Chercher un programme…"
        aria-label="Chercher un programme"
        className="h-12 rounded-2xl border-border bg-card pl-10 pr-12 text-[15px] [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button type="button" aria-label="Effacer la recherche" onClick={() => setQuery('')} className={`absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground ${focus}`}>
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </form>
  );

  const replayCard = (item: RecentReplayItem) => (
    <button
      key={`${item.replayChannel.id}-${item.program.startTime.getTime()}`}
      type="button"
      onClick={() => onCatchup(item.channel, item.program)}
      aria-label={`Revoir « ${item.program.title} », ${item.replayChannel.name}, ${formatReplayDate(item.program.startTime, new Date(now))}`}
      className={`flex flex-col gap-2 rounded-2xl text-left ${tvMode ? 'p-1.5' : 'w-[220px] shrink-0 snap-start'} ${focus}`}
    >
      <span className="relative block aspect-video w-full overflow-hidden rounded-xl border border-border bg-secondary">
        <span className="absolute left-2 top-2 rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-semibold text-foreground">{item.replayChannel.name}</span>
        <span className="absolute bottom-2 left-2 rounded-md bg-background/85 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{formatDuration(item.program)}</span>
        <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-primary">
          <RotateCcw aria-hidden="true" className="h-[18px] w-[18px]" />
        </span>
      </span>
      <span className="min-w-0 px-0.5">
        <span className="block truncate text-[15px] font-semibold text-foreground">{item.program.title}</span>
        <span className="block text-[13px] text-muted-foreground">{formatReplayDate(item.program.startTime, new Date(now))}</span>
      </span>
    </button>
  );

  const recentSection = recent.length > 0 && (
    <section aria-labelledby="replay-recent" className="space-y-2.5">
      {sectionTitle('replay-recent', 'À revoir dans l’app', 'Replay de votre liste · soirées des grandes chaînes')}
      {tvMode
        ? <div className="grid grid-cols-4 gap-3">{recent.slice(0, 8).map(replayCard)}</div>
        : <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">{recent.map(replayCard)}</div>}
    </section>
  );

  const onAirLine = (ch: ReplayChannel) => {
    const current = onAir.get(ch.id);
    if (current) return `En ce moment : ${current.title}, jusqu’à ${formatTime(current.endTime)}`;
    return `Replay sur ${replayPlatforms.find(p => p.id === ch.platform)?.label ?? 'le site officiel'}`;
  };

  const channelsSection = (
    <section aria-labelledby="replay-channels" className="space-y-3">
      {sectionTitle('replay-channels', 'Replay des chaînes', 'S’ouvre dans l’application officielle si elle est installée')}
      {replayPlatforms.map(platform => {
        const list = replayChannels.filter(c => c.platform === platform.id);
        return (
          <div key={platform.id} className="space-y-2">
            <h4 className="px-1 text-[13px] font-semibold tracking-wide text-muted-foreground">{platform.label}</h4>
            {tvMode ? (
              <div className="grid grid-cols-5 gap-3">
                {list.map(ch => (
                  <button key={ch.id} type="button" onClick={() => openChannel(ch)} className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left">
                    <PlatformLogo platformId={ch.id} name={ch.name} size="lg" className="h-11 w-11 rounded-xl" />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-foreground">{ch.name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{onAir.get(ch.id)?.title ?? ch.note ?? platform.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <ul className="overflow-hidden rounded-[20px] border border-border bg-card">
                {list.map((ch, index) => (
                  <li key={ch.id} className={index > 0 ? 'border-t border-border' : ''}>
                    <button type="button" onClick={() => openChannel(ch)} className={`flex min-h-[62px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-accent/60 ${focus} focus-visible:ring-inset`}>
                      <PlatformLogo platformId={ch.id} name={ch.name} size="lg" className="h-11 w-11 rounded-xl" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-foreground">{ch.name}</span>
                        <span className="block truncate text-[13px] text-muted-foreground">{onAirLine(ch)}</span>
                        {ch.note && <span className="block text-[12px] text-muted-foreground">{ch.note}</span>}
                      </span>
                      <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );

  const hitRow = (item: ReplayItem) => (
    <li key={`${item.channel.id}-${item.program.startTime.getTime()}`}>
      <button
        type="button"
        onClick={() => onCatchup(item.channel, item.program)}
        className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-accent/60 ${focus}`}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <RotateCcw aria-hidden="true" className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-foreground">{item.program.title}</span>
          <span className="block truncate text-[13px] text-muted-foreground">{formatReplayDate(item.program.startTime, new Date(now))} · {item.channel.name} · <span className="font-mono">{formatDuration(item.program)}</span></span>
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-primary">Revoir</span>
      </button>
    </li>
  );

  const term = query.trim();
  const searchResults = searching && (
    <div className="space-y-6">
      {hasCatchup && (
        <section aria-labelledby="replay-hits" className="space-y-2">
          {sectionTitle('replay-hits', 'Dans votre liste', 'Lecture ici, dans l’app')}
          {term.length < 2
            ? <p className="px-1 text-sm text-muted-foreground">Encore une lettre…</p>
            : hits.length === 0
              ? <p className="px-1 text-sm text-muted-foreground">Rien dans le replay de votre liste pour « {term} ».</p>
              : <ul className={tvMode ? 'grid grid-cols-2 gap-x-4' : 'space-y-0.5'}>{hits.map(hitRow)}</ul>}
        </section>
      )}
      <section aria-labelledby="replay-sites" className="space-y-2.5">
        {sectionTitle('replay-sites', 'Sur les sites officiels', 'S’ouvre à l’extérieur')}
        <ul className={tvMode ? 'grid grid-cols-4 gap-3' : 'overflow-hidden rounded-[20px] border border-border bg-card'}>
          {replayPlatforms.map((platform, index) => (
            <li key={platform.id} className={!tvMode && index > 0 ? 'border-t border-border' : ''}>
              <button
                type="button"
                disabled={!term}
                onClick={() => openExternal(platform.programUrl(term), `Recherche ${platform.label}`, platform.label)}
                className={`flex min-h-[60px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-accent/60 ${tvMode ? 'rounded-2xl border border-border bg-card' : `${focus} focus-visible:ring-inset`}`}
              >
                <PlatformLogo platformId={platform.id} name={platform.label} size="md" className="h-10 w-10 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-foreground">{platform.label}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{siteSearchHint[platform.id] ?? 'Résultats de recherche'}</span>
                </span>
                <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  const platformTile = (p: StreamingPlatform) => (
    <button key={p.id} type="button" onClick={() => openPlatform(p)} className={`flex min-w-0 flex-col items-center gap-2 rounded-[18px] border border-border bg-card px-2 pb-3 pt-3.5 text-center transition-colors hover:bg-accent/60 ${focus}`}>
      <PlatformLogo platformId={p.id} name={p.name} size={tvMode ? 'xl' : 'lg'} className="rounded-2xl" />
      <span className="w-full truncate text-[13px] font-medium text-foreground">{p.name}</span>
    </button>
  );

  const editButton = (
    <Button variant="ghost" size="sm" onClick={() => setChoosing(true)} className="min-h-11 shrink-0 rounded-full px-3 text-[14px] font-medium text-primary hover:text-primary">
      {mine.length ? 'Modifier' : 'Choisir'}
    </Button>
  );

  const mineSection = (
    <section aria-labelledby="platforms-mine" className="space-y-2.5">
      {sectionTitle('platforms-mine', 'Mes plateformes', 'S’ouvrent dans leur application si elle est installée', tvMode ? undefined : editButton)}
      {minePlatforms.length === 0 && !tvMode ? (
        <button type="button" onClick={() => setChoosing(true)} className={`flex w-full items-center gap-3 rounded-[18px] border border-dashed border-border px-4 py-4 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 ${focus}`}>
          <SlidersHorizontal aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
          <span>Choisis celles que tu utilises : elles passeront en tête.</span>
        </button>
      ) : (
        <div className={`grid gap-2.5 ${tvMode ? 'grid-cols-6' : 'grid-cols-3 sm:grid-cols-4'}`}>
          {minePlatforms.map(platformTile)}
          {tvMode && (
            <button type="button" onClick={() => setChoosing(true)} className="flex min-w-0 flex-col items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-border px-2 py-3 text-center text-muted-foreground">
              <Plus aria-hidden="true" className="h-7 w-7" />
              <span className="text-[13px] font-medium">{mine.length ? 'Modifier' : 'Choisir mes plateformes'}</span>
            </button>
          )}
        </div>
      )}
    </section>
  );

  const othersSection = (
    <section aria-labelledby="platforms-others" className="space-y-2.5">
      {sectionTitle('platforms-others', minePlatforms.length ? 'Autres plateformes' : 'Toutes les plateformes')}
      {tvMode ? (
        <div className="grid grid-cols-6 gap-2.5">{streamingPlatforms.filter(p => !mine.includes(p.id)).map(platformTile)}</div>
      ) : (
        <>
          <div role="group" aria-label="Filtrer les plateformes" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {filters.map(f => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${focus} ${filter === f.key ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground hover:bg-accent/60'}`}
              >{f.label}</button>
            ))}
          </div>
          {otherPlatforms.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">Toutes les plateformes de ce filtre sont déjà dans les vôtres.</p>
          ) : (
            <ul className="overflow-hidden rounded-[20px] border border-border bg-card">
              {otherPlatforms.map((p, index) => (
                <li key={p.id} className={`flex items-center ${index > 0 ? 'border-t border-border' : ''}`}>
                  <button type="button" onClick={() => openPlatform(p)} className={`flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-3.5 text-left transition-colors hover:bg-accent/60 ${focus} focus-visible:ring-inset`}>
                    <PlatformLogo platformId={p.id} name={p.name} size="md" className="h-10 w-10 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-foreground">{p.name}</span>
                      {p.note && <span className="block truncate text-[13px] text-muted-foreground">{p.note}</span>}
                    </span>
                  </button>
                  <Button variant="ghost" size="icon" onClick={() => toggleMine(p.id)} aria-label={`Ajouter ${p.name} à mes plateformes`} className="mx-1.5 h-11 w-11 shrink-0 rounded-full">
                    <Plus aria-hidden="true" className="h-5 w-5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );

  const chooser = (
    <Dialog open={choosing} onOpenChange={setChoosing}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-border bg-card p-0 sm:max-w-md sm:rounded-3xl"
        onOpenAutoFocus={() => { chooserOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => {
          // Sans DialogTrigger, Radix ne sait pas où revenir : la télécommande retomberait sur les rubriques.
          const opener = chooserOpener.current;
          if (!opener?.isConnected) return;
          event.preventDefault();
          focusRemote(opener);
        }}
      >
        <DialogHeader className="space-y-1 p-5 pb-3 pr-12 text-left">
          <DialogTitle>Mes plateformes</DialogTitle>
          <DialogDescription>Coche celles que tu utilises : elles passent en tête.</DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 flex-1 overflow-y-auto px-5">
          {streamingPlatforms.map((p, index) => {
            const checked = mine.includes(p.id);
            return (
              <li key={p.id} className={index > 0 ? 'border-t border-border' : ''}>
                {/* Pas de Checkbox Radix : elle ignore Entrée, que les télécommandes envoient pour OK. */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleMine(p.id)}
                  onKeyDown={okToggles(() => toggleMine(p.id))}
                  className={`-mx-2 flex min-h-[56px] w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-accent/60 ${focus} focus-visible:ring-inset`}
                >
                  <PlatformLogo platformId={p.id} name={p.name} size="md" className="h-9 w-9 rounded-[10px]" />
                  <span className="flex-1 text-[15px] font-medium">{p.name}</span>
                  <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/60'}`}>
                    {checked && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border p-4">
          <Button onClick={() => setChoosing(false)} className="h-12 w-full rounded-full text-[15px] font-semibold">
            {mine.length ? `Terminé · ${mine.length} choisie${mine.length > 1 ? 's' : ''}` : 'Terminé'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (tvMode) {
    return (
      <div className="space-y-8 pb-16" data-replay-hub data-tv-mode="true">
        {searchField}
        {searching ? searchResults : <>
          {mineSection}
          {recentSection}
          {channelsSection}
          {othersSection}
        </>}
        {chooser}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-4" data-replay-hub data-tv-mode="false">
      <div role="group" aria-label="Vue" className="grid grid-cols-2 rounded-full border border-border bg-card p-1">
        {(['replay', 'platforms'] as const).map(v => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`min-h-10 rounded-full text-sm transition-colors ${focus} ${view === v ? 'bg-foreground font-semibold text-background' : 'font-medium text-muted-foreground hover:text-foreground'}`}
          >{v === 'replay' ? 'Replay' : 'Plateformes'}</button>
        ))}
      </div>
      {view === 'replay' ? <>
        {searchField}
        {searching ? searchResults : <>
          {recentSection}
          {channelsSection}
        </>}
      </> : <>
        {mineSection}
        {othersSection}
      </>}
      {chooser}
    </div>
  );
}
