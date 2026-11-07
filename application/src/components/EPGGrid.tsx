import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Bell, RotateCcw, SkipBack } from 'lucide-react';
import { isInArchive } from '@/utils/catchup';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Channel } from '@/types/channel';
import type { EPGState } from '@/hooks/useEPG';
import { EPGData, EPGProgram } from '@/types/epg';
import { formatTime } from '@/utils/epgXmltv';
import { CHANNEL_COL_WIDTH, PX_PER_MINUTE, buildHourTicks, guideRange, layoutProgram, normalizePrograms, nowOffsetInDay, rangeWidth } from '@/utils/epgGrid';
import { getReminders, addReminder, removeReminder, REMINDERS_EVENT, type EpgReminder } from '@/utils/reminders';
import { toast } from 'sonner';

interface EPGGridProps {
  channels: Channel[];
  epgData: EPGData | undefined;
  guideState?: EPGState;
  onRetry?: () => void;
  onConfigure?: () => void;
  currentChannel?: Channel;
  onSelectChannel: (channel: Channel) => void;
  /** Groupes adultes verrouillés (contrôle parental) : leurs lignes sont masquées. */
  lockedGroups?: string[] | undefined;
  unlocked?: boolean | undefined;
  /** Jours d'archive (catch-up) disponibles pour une chaîne, 0 sinon. */
  catchupDays?: ((channel: Channel) => number) | undefined;
  /** Lire une émission passée (ou l'émission en cours depuis son début). */
  onCatchup?: ((channel: Channel, program: EPGProgram) => void) | undefined;
}

const TIME_AXIS_HEIGHT = 44;
const ROW_HEIGHT = 64;
/** Colonne des chaînes plus étroite sur téléphone : plus d'heures visibles. */
const NARROW_COL_WIDTH = 112;
/** Marge (px) de programmes rendus de part et d'autre de la zone visible. */
const RENDER_BUFFER = 900;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayLabelOf = (date: Date) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
const shortDayOf = (date: Date) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' }).format(date);
const midnightOf = (date: Date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const isNarrowScreen = () => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)')?.matches) || false;

/** Grille des programmes (guide TV) : chaînes en lignes, horaires en colonnes. */
export function EPGGrid({ channels, epgData, currentChannel, onSelectChannel, guideState, onRetry, onConfigure, lockedGroups, unlocked, catchupDays, onCatchup }: EPGGridProps) {
  const [now, setNow] = useState(() => new Date());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(isNarrowScreen);
  // Zone visible (px) : seuls les programmes proches sont rendus.
  const [view, setView] = useState({ left: 0, width: Number.POSITIVE_INFINITY });

  // Rappels EPG (cloche sur un programme).
  const [reminders, setReminders] = useState<EpgReminder[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => { void getReminders().then(list => { if (!cancelled) setReminders(list); }); };
    load();
    window.addEventListener(REMINDERS_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(REMINDERS_EVENT, load); };
  }, []);
  const toggleReminder = async (channel: Channel, program: EPGProgram) => {
    const startTime = program.startTime.getTime();
    const reminded = reminders.some(r => r.channelId === channel.id && r.startTime === startTime);
    try {
      if (reminded) {
        await removeReminder(`${channel.id}:${startTime}`);
        toast.info('Rappel retiré.');
      } else {
        await addReminder({ channelId: channel.id, channelName: channel.name, title: program.title, startTime });
        toast.success(`Rappel : « ${program.title} » sur ${channel.name}.`);
      }
    } catch {
      toast.error('Impossible d’enregistrer le rappel.');
    }
  };

  // Rafraîchit « maintenant » chaque minute (ligne rouge + bascule de journée à minuit).
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.('(max-width: 639px)') : undefined;
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const colWidth = narrow ? NARROW_COL_WIDTH : CHANNEL_COL_WIDTH;

  const todayKey = midnightOf(now).getTime();

  // Chaînes affichables : contrôle parental, puis présence de programmes.
  const guideChannels = useMemo(() => {
    if (!epgData) return [];
    const locked = lockedGroups && !unlocked ? new Set(lockedGroups) : null;
    return channels.filter((channel) => (!locked || !locked.has(channel.group || '')) && (epgData[channel.id]?.length ?? 0) > 0);
  }, [channels, epgData, lockedGroups, unlocked]);

  // Plage continue : de minuit (ou du début de l'archive) à la fin des programmes connus.
  const range = useMemo(() => {
    let earliest: number | null = null;
    let latest: number | null = null;
    for (const channel of guideChannels) {
      const list = epgData![channel.id];
      const first = list[0].startTime.getTime();
      const last = list[list.length - 1].endTime.getTime();
      if (earliest === null || first < earliest) earliest = first;
      if (latest === null || last > latest) latest = last;
    }
    return guideRange(new Date(todayKey), earliest, latest, onCatchup ? 7 : 0);
  }, [guideChannels, epgData, todayKey, onCatchup]);
  const timelineWidth = rangeWidth(range);

  const rows = useMemo(() => guideChannels
    .map((channel) => ({
      channel,
      programs: normalizePrograms(epgData![channel.id]).filter((p) => p.startTime < range.end && p.endTime > range.start),
    }))
    .filter((r) => r.programs.length > 0), [guideChannels, epgData, range]);

  // Virtualisation des lignes : un guide de 1000+ chaînes ne doit pas créer des
  // milliers de nœuds DOM (ni les re-rendre chaque minute).
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    paddingStart: TIME_AXIS_HEIGHT,
    overscan: 10,
  });

  const hours = useMemo(() => buildHourTicks(range), [range]);
  const nowOffset = useMemo(() => nowOffsetInDay(now, range), [now, range]);
  const offsetOf = (date: Date) => ((date.getTime() - range.start.getTime()) / 60000) * PX_PER_MINUTE;

  // Suit le défilement horizontal (jour affiché, programmes à rendre).
  const hasGrid = !!epgData && guideState?.status !== 'absent' && guideState?.status !== 'error';
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // jsdom (tests) : pas de dimensions, tout est rendu.
        const width = el.clientWidth || Number.POSITIVE_INFINITY;
        setView((v) => (v.left === el.scrollLeft && v.width === width ? v : { left: el.scrollLeft, width }));
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [hasGrid]);

  // Ouvre la grille sur « maintenant » (une fois par plage).
  const positionedFor = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !rows.length || positionedFor.current === range.start.getTime()) return;
    positionedFor.current = range.start.getTime();
    el.scrollLeft = nowOffset !== null ? Math.max(0, nowOffset - 60 * PX_PER_MINUTE * 0.5) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length > 0, range.start.getTime()]);

  const scrollToOffset = (left: number) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(left, timelineWidth)), behavior: 'smooth' });
  };
  const scrollToNow = () => { if (nowOffset !== null) scrollToOffset(nowOffset - 30 * PX_PER_MINUTE); };

  // Jour affiché : celui de l'heure au bord gauche de la grille.
  const viewedDay = midnightOf(new Date(range.start.getTime() + (view.left / PX_PER_MINUTE) * 60000 + 60000));
  const prevDay = new Date(viewedDay.getTime() - DAY_MS / 2); const prevStart = midnightOf(prevDay);
  const nextStart = midnightOf(new Date(viewedDay.getTime() + DAY_MS * 1.5));
  const canPrev = viewedDay.getTime() > range.start.getTime();
  const canNext = nextStart.getTime() < range.end.getTime();
  const isToday = viewedDay.getTime() === todayKey;

  if (!epgData) {
    return (
      <div className="h-full flex items-center justify-center text-neutral-300 text-sm">
        Chargement du guide des programmes…
      </div>
    );
  }

  if (guideState?.status === 'absent' || guideState?.status === 'error') {
    return <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-4">
      <p role="status">{guideState.status === 'absent' ? 'Aucune source de guide configurée.' : 'Guide indisponible. Vérifie la connexion et la source EPG.'}</p>
      <div className="flex gap-2"><Button onClick={onRetry}>Réessayer</Button><Button variant="secondary" onClick={onConfigure}>Configurer le guide</Button></div>
    </div>;
  }

  return (
    <div className="h-full flex flex-col min-h-0 text-white">
      {guideState?.fetchedAt && <div className="flex flex-wrap items-center justify-between gap-2 mb-2 flex-wrap text-xs text-neutral-400">
        <span>{guideState.status === 'stale' ? 'Guide enregistré — actualisation impossible' : 'Guide actualisé'} · {new Date(guideState.fetchedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        <Button size="sm" variant="ghost" onClick={onRetry}>Actualiser</Button>
      </div>}
      {/* Navigation jour : fait défiler la frise continue jusqu'au jour voulu. */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 border-neutral-800 text-white hover:bg-neutral-900"
            aria-label="Jour précédent"
            disabled={!canPrev}
            onClick={() => scrollToOffset(offsetOf(prevStart))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span aria-live="polite" className="min-w-[150px] text-center text-sm font-medium capitalize">{dayLabelOf(viewedDay)}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 border-neutral-800 text-white hover:bg-neutral-900"
            aria-label="Jour suivant"
            disabled={!canNext}
            onClick={() => scrollToOffset(offsetOf(nextStart))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {nowOffset !== null && (
          <Button variant="outline" size="sm" className="h-9 border-neutral-800 text-white hover:bg-neutral-900" onClick={scrollToNow}>
            {isToday ? 'Maintenant' : "Aujourd'hui"}
          </Button>
        )}
      </div>

      {rows.length === 0 && <p role="status" className="py-6 text-sm text-neutral-300 text-center">Pas de programmes à afficher. Actualise le guide ou vérifie la source EPG.</p>}
      {/* Grille défilante */}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-auto overscroll-x-contain rounded-xl border border-neutral-900 bg-neutral-950">
        <div className="relative" style={{ width: colWidth + timelineWidth, height: Math.max(rowVirtualizer.getTotalSize(), TIME_AXIS_HEIGHT) }}>
          {/* Axe des heures (en-tête collant) */}
          <div className="dark-surface sticky top-0 z-30 flex bg-black" style={{ height: TIME_AXIS_HEIGHT, width: colWidth + timelineWidth }}>
            <div
              className="dark-surface sticky left-0 z-30 shrink-0 bg-black flex items-end border-r border-b border-neutral-900 px-3 pb-1.5 text-[11px] uppercase tracking-wide text-neutral-400"
              style={{ width: colWidth }}
            >
              {shortDayOf(viewedDay)}
            </div>
            <div className="relative border-b border-neutral-900" style={{ width: timelineWidth }}>
              {nowOffset !== null && <span aria-hidden="true" className="absolute bottom-0 z-[1] h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-live" style={{ left: nowOffset + 1 }} />}
              {hours.map((h) => {
                const left = offsetOf(h);
                if (left < view.left - RENDER_BUFFER || left > view.left + view.width + RENDER_BUFFER) return null;
                const midnight = h.getHours() === 0;
                return (
                  <div key={h.getTime()} className={`absolute top-0 bottom-0 border-l ${midnight ? 'border-primary/60' : 'border-neutral-800'}`} style={{ left }}>
                    <span className={`flex h-full items-end px-1.5 pb-1.5 font-mono text-xs ${midnight ? 'font-semibold capitalize text-primary' : 'text-neutral-400'}`}>
                      {midnight ? shortDayOf(h) : formatTime(h)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lignes des chaînes (virtualisées) */}
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const { channel, programs } = rows[virtualRow.index];
            const playing = currentChannel?.id === channel.id;
            return (
              <div
                key={channel.id}
                className="absolute left-0 top-0 flex border-b border-white/5"
                style={{ height: ROW_HEIGHT, width: colWidth + timelineWidth, transform: `translateY(${virtualRow.start}px)` }}
              >
                <button
                  type="button"
                  onClick={() => onSelectChannel(channel)}
                  className={`sticky left-0 z-10 shrink-0 flex flex-col items-start justify-center gap-0.5 border-r border-neutral-900 px-3 text-left hover:bg-accent ${
                    playing ? 'bg-card bg-[linear-gradient(hsl(var(--primary)/0.18),hsl(var(--primary)/0.18))]' : 'bg-neutral-950'
                  }`}
                  style={{ width: colWidth }}
                  title={channel.name}
                >
                  <span className={`w-full font-medium ${narrow ? 'line-clamp-2 text-xs leading-tight' : 'truncate text-sm'}`}>{channel.name}</span>
                  {playing && <span className="text-[10px] text-primary">En lecture</span>}
                </button>
                <div className="relative" style={{ width: timelineWidth }}>
                  {programs.map((p) => {
                    const layout = layoutProgram(p, range);
                    if (!layout || layout.left + layout.width < view.left - RENDER_BUFFER || layout.left > view.left + view.width + RENDER_BUFFER) return null;
                    const reminded = reminders.some(r => r.channelId === channel.id && r.startTime === p.startTime.getTime());
                    const isPast = p.endTime <= now;
                    const isCurrent = p.startTime <= now && now < p.endTime;
                    const archiveDays = onCatchup && catchupDays ? catchupDays(channel) : 0;
                    const replayable = archiveDays > 0 && isInArchive(p.startTime, archiveDays, now.getTime());
                    const activate = () => (isPast && replayable ? onCatchup!(channel, p) : onSelectChannel(channel));
                    const tone = isCurrent
                      ? 'border-primary/50 bg-secondary bg-[linear-gradient(hsl(var(--primary)/0.2),hsl(var(--primary)/0.2))] hover:bg-accent'
                      : isPast
                        ? replayable ? 'border-neutral-800 bg-card text-neutral-300 hover:bg-accent' : 'border-neutral-900 bg-card text-neutral-500'
                        : 'border-neutral-800 bg-secondary hover:bg-accent';
                    return (
                      <div
                        key={p.startTime.getTime()}
                        role="button"
                        tabIndex={0}
                        onClick={activate}
                        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(); } }}
                        aria-label={isPast && replayable ? `Revoir « ${p.title} » (${formatTime(p.startTime)})` : `${p.title}, ${formatTime(p.startTime)} – ${formatTime(p.endTime)}`}
                        className={`group absolute top-1 bottom-1 overflow-hidden rounded-lg border px-2 text-left cursor-pointer ${tone}`}
                        style={{ left: layout.left + 1, width: Math.max(layout.width - 2, 24) }}
                        title={`${formatTime(p.startTime)} – ${formatTime(p.endTime)} · ${p.title}${isPast && replayable ? ' · Revoir' : ''}`}
                      >
                        <span className="flex items-center gap-1 truncate text-xs font-medium leading-tight pr-5">
                          {isPast && replayable && <RotateCcw aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />}
                          <span className="truncate">{p.title}</span>
                        </span>
                        <span className="block truncate font-mono text-[10px] text-neutral-400 leading-tight">
                          {formatTime(p.startTime)} – {formatTime(p.endTime)}
                        </span>
                        {isCurrent && replayable && <button
                          type="button"
                          aria-label={`Regarder « ${p.title} » depuis le début`}
                          title="Depuis le début"
                          onClick={(e) => { e.stopPropagation(); onCatchup!(channel, p); }}
                          className="absolute top-1 right-1 rounded-full p-1 text-primary hover:bg-primary/20"
                        >
                          <SkipBack className="h-3.5 w-3.5" />
                        </button>}
                        {!isPast && !isCurrent && <button
                          type="button"
                          aria-label={reminded ? `Retirer le rappel pour « ${p.title} »` : `Rappel pour « ${p.title} » à ${formatTime(p.startTime)}`}
                          title={reminded ? 'Rappel activé : cliquer pour retirer' : 'Me prévenir au début de l’émission'}
                          onClick={(e) => { e.stopPropagation(); void toggleReminder(channel, p); }}
                          className={`absolute top-1 right-1 rounded p-1 transition ${reminded ? 'text-primary' : 'text-white/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white'}`}
                        >
                          <Bell className="h-3.5 w-3.5" />
                        </button>}
                      </div>
                    );
                  })}
                  {nowOffset !== null && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[1] border-l-2 border-live" style={{ left: nowOffset }} />}
                </div>
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}
