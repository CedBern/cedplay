import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';
import { ChevronLeft, ChevronRight, Bell, CircleDot, Clock, Eye, RefreshCw, RotateCcw, Search, Settings2, SkipBack } from 'lucide-react';
import { isInArchive } from '@/utils/catchup';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Channel } from '@/types/channel';
import type { EPGState } from '@/hooks/useEPG';
import { EPGData, EPGProgram } from '@/types/epg';
import { formatTime } from '@/utils/epgXmltv';
import { CHANNEL_COL_WIDTH, PX_PER_MINUTE, buildHourTicks, guideRange, hasProgramInRange, layoutProgram, normalizePrograms, nowOffsetInDay, programsInRange, rangeWidth } from '@/utils/epgGrid';
import { getReminders, addReminder, removeReminder, REMINDERS_EVENT, type EpgReminder } from '@/utils/reminders';
import { toast } from 'sonner';
import { NativePlayerBridge, RecordingsBridge, type PreviewState, type ScheduledRecording } from '@/utils/nativePlayer';
import { RECORDING_RULES_EVENT } from '@/utils/recordingRules';
import { getCurrentProgram } from '@/utils/epgXmltv';
import { ProgramSheet, type ProgramSheetTarget } from '@/components/ProgramSheet';
import { GuideSearchDialog } from '@/components/GuideSearchDialog';

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
  /** Liste affichée : règles de série et fiche programme. */
  playlistId?: string | undefined;
  /** Interface télécommande : bandeau d'informations (et mini-lecteur) au-dessus de la grille. */
  tvMode?: boolean | undefined;
  /** Mini-lecteur Android de la chaîne survolée, avec le même mode que l'écran Direct. */
  preview?: boolean | undefined;
  previewMode?: 'auto' | 'manual' | 'off' | undefined;
  /** Liste / Grille / Lecteur, rendus dans le bandeau TV à côté de l'aperçu. */
  toolbar?: ReactNode;
  /** Réglages du guide (sources, association d'une chaîne). */
  onGuideSettings?: ((channel?: Channel) => void) | undefined;
}

/** Appui long sur OK (ms) : ouvre la fiche au lieu de lancer l'action. */
const LONG_PRESS_MS = 550;
/** Temps d'arrêt sur une chaîne avant de lancer le mini-lecteur. */
const PREVIEW_DELAY = 700;
const isActivationKey = (key: string) => key === 'Enter' || key === ' ';

const TIME_AXIS_HEIGHT = 44;
const ROW_HEIGHT = 56;
/** Aperçu TV : 16:9 à gauche du bandeau. La hauteur est calée pour que le bandeau
 * (aperçu + quatre lignes de texte + date) laisse **quatre lignes de chaînes** entières. */
const PREVIEW_HEIGHT = 132;
/** Colonne des chaînes plus étroite sur téléphone : plus d'heures visibles. */
const NARROW_COL_WIDTH = 112;
/** Marge (px) de programmes rendus de part et d'autre de la zone visible. */
const RENDER_BUFFER = 900;
const DAY_MS = 24 * 60 * 60 * 1000;

// Formateurs en cache au niveau module : construire un Intl.DateTimeFormat par appel
// coûtait cher, et le rendu de la grille les invoque pour chaque programme affiché.
const dayLabelFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
const dayLabelOf = (date: Date) => dayLabelFormat.format(date);
const shortDayOf = (date: Date) => shortDayFormat.format(date);
const midnightOf = (date: Date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const isNarrowScreen = () => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)')?.matches) || false;

interface ProgramCellProps {
  channel: Channel;
  program: EPGProgram;
  /** Position et largeur déjà calculées par layoutProgram (px). */
  left: number;
  width: number;
  isCurrent: boolean;
  isPast: boolean;
  reminded: boolean;
  recording: boolean;
  replayable: boolean;
  /** Émission d'entrée du guide (celle en cours sur la première ligne visible). */
  entry: boolean;
  /** Décalage (px) du texte collant au bord droit de la colonne des chaînes. */
  labelLeft: number;
  onSelectChannel: (channel: Channel) => void;
  onCatchup: ((channel: Channel, program: EPGProgram) => void) | undefined;
  setSheet: Dispatch<SetStateAction<ProgramSheetTarget | null>>;
  setFocused: Dispatch<SetStateAction<{ channel: Channel; program: EPGProgram | null } | null>>;
  toggleReminder: (channel: Channel, program: EPGProgram) => void | Promise<void>;
  /** Appui long sur OK, partagé par toutes les cellules (une seule pression à la fois). */
  pressRef: MutableRefObject<{ timer: number; long: boolean } | null>;
}

/** Cellule d'un programme, mémoïsée : le défilement de la grille ne re-rend plus que les
 * cellules qui entrent dans la fenêtre — l'état (en cours, passé, rappel, enregistrement)
 * passe en props primitives pour que la comparaison superficielle suffise. */
const ProgramCell = memo(function ProgramCell({
  channel, program: p, left, width, isCurrent, isPast, reminded, recording, replayable, entry, labelLeft,
  onSelectChannel, onCatchup, setSheet, setFocused, toggleReminder, pressRef,
}: ProgramCellProps) {
  const openSheet = () => setSheet({ channel, program: p });
  // En cours : la chaîne ; passée rejouable : le replay ; sinon la fiche de l'émission.
  const activate = () => (isCurrent ? onSelectChannel(channel) : isPast && replayable ? onCatchup!(channel, p) : openSheet());
  const tone = isCurrent
    ? 'border-primary/50 bg-secondary bg-[linear-gradient(hsl(var(--primary)/0.2),hsl(var(--primary)/0.2))] hover:bg-accent'
    : isPast
      ? replayable ? 'border-neutral-800 bg-card text-neutral-300 hover:bg-accent' : 'border-neutral-900 bg-card text-neutral-500'
      : 'border-neutral-800 bg-secondary hover:bg-accent';
  return (
    <div
      role="button"
      tabIndex={0}
      data-program-start={p.startTime.getTime()}
      {...(entry ? { 'data-guide-entry': '' } : {})}
      onClick={activate}
      onContextMenu={(e) => { e.preventDefault(); openSheet(); }}
      onFocus={(e) => { if (e.target === e.currentTarget) setFocused({ channel, program: p }); }}
      // Appui court sur OK : action ; appui long : fiche (comme sur les box IPTV).
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || !isActivationKey(e.key)) return;
        e.preventDefault();
        if (e.repeat || pressRef.current) return;
        const state = { timer: 0, long: false };
        // La fiche prend le focus : le relâchement de OK arrivera ailleurs. L'appui est
        // donc terminé ici ; les répétitions et le relâchement sont ignorés par la fiche.
        state.timer = window.setTimeout(() => {
          state.long = true;
          if (pressRef.current === state) pressRef.current = null;
          openSheet();
        }, LONG_PRESS_MS);
        pressRef.current = state;
      }}
      onKeyUp={(e) => {
        if (e.target !== e.currentTarget || !isActivationKey(e.key) || !pressRef.current) return;
        e.preventDefault();
        const { timer, long } = pressRef.current;
        pressRef.current = null;
        window.clearTimeout(timer);
        if (!long) activate();
      }}
      onBlur={() => { if (pressRef.current) { window.clearTimeout(pressRef.current.timer); pressRef.current = null; } }}
      aria-label={isPast && replayable ? `Revoir « ${p.title} » (${formatTime(p.startTime)})` : `${p.title}, ${formatTime(p.startTime)} – ${formatTime(p.endTime)}${recording ? ', enregistrement programmé' : ''}`}
      className={`group absolute top-1 bottom-1 rounded-lg border px-2 text-left cursor-pointer ${tone}`}
      style={{ left: left + 1, width: Math.max(width - 2, 24) }}
      title={`${formatTime(p.startTime)} – ${formatTime(p.endTime)} · ${p.title}${isPast && replayable ? ' · Revoir' : ''}`}
    >
      {/* Le texte colle au bord droit de la colonne quand l'émission a commencé
          avant la fenêtre : au lieu de « 1 » et « grammes », le titre et l'heure
          restent lisibles. Il reprend sa place dès que le début de la case entre
          dans la vue. */}
      <div className="sticky w-max max-w-full" style={{ left: labelLeft }}>
        <span className="flex items-center gap-1 truncate text-xs font-medium leading-tight pr-5">
          {isPast && replayable && <RotateCcw aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />}
          {recording && <CircleDot aria-hidden="true" className="h-3 w-3 shrink-0 text-red-400" />}
          <span className="truncate">{p.title}</span>
        </span>
        <span className="block truncate tabular-nums text-[11px] text-neutral-400 leading-tight">
          {formatTime(p.startTime)} – {formatTime(p.endTime)}
        </span>
      </div>
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
});

/** Grille des programmes (guide TV) : chaînes en lignes, horaires en colonnes. */
export function EPGGrid({ channels, epgData, currentChannel, onSelectChannel, guideState, onRetry, onConfigure, lockedGroups, unlocked, catchupDays, onCatchup, playlistId = '', tvMode = false, preview = false, previewMode = 'auto', toolbar, onGuideSettings }: EPGGridProps) {
  const [now, setNow] = useState(() => new Date());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(isNarrowScreen);
  // Zone visible (px) : seuls les programmes proches sont rendus. La largeur est bornée
  // dès la première peinture (sinon Infinity rendait les 7 jours de chaque ligne visible,
  // soit plusieurs secondes de DOM avant que l'effet de défilement ne corrige la mesure).
  // jsdom n'a pas matchMedia : Infinity y laisse tous les programmes rendus aux tests.
  const [view, setView] = useState(() => ({
    left: 0,
    width: typeof (window as unknown as { matchMedia?: unknown }).matchMedia === 'function' ? window.innerWidth : Number.POSITIVE_INFINITY,
  }));

  // Rappels EPG (cloche sur un programme). Callback mémoïsé : les cellules sont mémoïsées,
  // un handler recréé à chaque rendu les ferait toutes se re-rendre au défilement.
  const [reminders, setReminders] = useState<EpgReminder[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => { void getReminders().then(list => { if (!cancelled) setReminders(list); }); };
    load();
    window.addEventListener(REMINDERS_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(REMINDERS_EVENT, load); };
  }, []);
  const toggleReminder = useCallback(async (channel: Channel, program: EPGProgram) => {
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
  }, [reminders]);

  // Programmations Android (pastille rouge sur les émissions à enregistrer).
  const [scheduled, setScheduled] = useState<ScheduledRecording[]>([]);
  const reloadScheduled = useCallback(() => {
    if (!RecordingsBridge.isAvailable()) return;
    void RecordingsBridge.listScheduled().then(setScheduled);
  }, []);
  useEffect(() => {
    reloadScheduled();
    window.addEventListener(RECORDING_RULES_EVENT, reloadScheduled);
    return () => window.removeEventListener(RECORDING_RULES_EVENT, reloadScheduled);
  }, [reloadScheduled]);

  // Programmations indexées par URL : la pastille rouge est testée pour chaque émission
  // affichée ; sans index, chaque test reconstruisait un Set d'URLs de la chaîne.
  const scheduledByUrl = useMemo(() => {
    const map = new Map<string, ScheduledRecording[]>();
    for (const s of scheduled) {
      const list = map.get(s.url);
      if (list) list.push(s);
      else map.set(s.url, [s]);
    }
    return map;
  }, [scheduled]);
  const isScheduled = useCallback((channel: Channel, program: EPGProgram): boolean => {
    const start = program.startTime.getTime();
    const end = program.endTime.getTime();
    // Mêmes bornes que findScheduled : démarrage au plus une heure avant, au plus tard
    // pendant l'émission, fin après la fin de l'émission.
    const latestStart = Math.max(start + 60_000, Math.min(Date.now() + 60_000, end - 60_000));
    const matches = (url: string) => {
      const list = scheduledByUrl.get(url);
      if (!list) return false;
      for (const s of list) {
        if (s.startTimeMs >= start - 60 * 60_000 && s.startTimeMs <= latestStart && s.startTimeMs + s.durationMs >= end) return true;
      }
      return false;
    };
    if (matches(channel.url)) return true;
    for (const v of channel.variants ?? []) if (matches(v.url)) return true;
    return false;
  }, [scheduledByUrl]);

  // Fiche programme, recherche, émission survolée (bandeau TV).
  const [sheet, setSheet] = useState<ProgramSheetTarget | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focused, setFocused] = useState<{ channel: Channel; program: EPGProgram | null } | null>(null);
  const closeSheet = useCallback(() => { setSheet(null); reloadScheduled(); }, [reloadScheduled]);
  const press = useRef<{ timer: number; long: boolean } | null>(null);
  useEffect(() => () => { if (press.current) window.clearTimeout(press.current.timer); }, []);

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

  // ── Mini-lecteur (Android) ─────────────────────────────────────────────
  // Le cadre 16:9 vit dans le bandeau du guide, au-dessus de la grille : il ne
  // recouvre plus aucune émission. Il est posé par Android au-dessus de la WebView ;
  // on l'arrête dès que le focus quitte le guide (il passerait devant les menus).
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [focusInside, setFocusInside] = useState(false);
  const [manualPreview, setManualPreview] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'waiting' | PreviewState>('idle');
  const previewActive = tvMode && preview && previewMode !== 'off';
  // Sans émission ciblée, le bandeau montre la chaîne en cours de lecture.
  const bandChannel = focused?.channel ?? currentChannel ?? null;
  const bandProgram = focused?.program ?? (currentChannel && epgData ? getCurrentProgram(currentChannel.id, epgData) : null);
  // Une émission à venir n'est pas à l'antenne : lancer le direct de la chaîne donnerait
  // l'image d'un autre programme sous ce titre. Le cadre annonce alors l'heure.
  const bandProgramIsFuture = !!bandProgram && bandProgram.startTime.getTime() > now.getTime();
  const focusedUrl = bandChannel?.url ?? null;
  useEffect(() => { setManualPreview(false); }, [focusedUrl]);
  const previewUrl = previewActive && focusInside && !sheet && !searchOpen && focusedUrl && !bandProgramIsFuture && (previewMode !== 'manual' || manualPreview) ? focusedUrl : null;
  const requested = useRef<string | null>(null);
  const sendPreview = useCallback((url: string) => {
    const box = previewRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    requested.current = url;
    void NativePlayerBridge.showPreview({ url, x: box.left, y: box.top, width: box.width, height: box.height, radius: 12, dpr: window.devicePixelRatio || 1 });
  }, []);
  useEffect(() => {
    if (!previewActive) return;
    const unsubscribe = NativePlayerBridge.onPreviewState(setPreviewState);
    // Un défilement produit des dizaines d'événements par seconde ; chacun mesurait le
    // cadre et rappelait le pont natif. Une seule relance par image suffit.
    let frame = 0;
    const relayout = () => {
      if (frame || !requested.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (requested.current) sendPreview(requested.current);
      });
    };
    window.addEventListener('resize', relayout);
    window.addEventListener('scroll', relayout, true);
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', relayout);
      window.removeEventListener('scroll', relayout, true);
      requested.current = null;
      void NativePlayerBridge.hidePreview();
    };
  }, [previewActive, sendPreview]);
  useEffect(() => {
    if (!previewActive) return;
    requested.current = null;
    void NativePlayerBridge.stopPreview();
    if (!previewUrl) { setPreviewState('idle'); return; }
    setPreviewState('waiting');
    const t = window.setTimeout(() => sendPreview(previewUrl), PREVIEW_DELAY);
    return () => window.clearTimeout(t);
  }, [previewActive, previewUrl, sendPreview]);
  const onFocusIn = () => setFocusInside(true);
  const onFocusOut = () => { window.setTimeout(() => setFocusInside(!!rootRef.current?.contains(document.activeElement)), 0); };

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
      programs: normalizePrograms(epgData![channel.id]),
    }))
    .filter((r) => hasProgramInRange(r.programs, range.start, range.end)), [guideChannels, epgData, range]);

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
  // Fenêtre visible convertie en temps : les programmes hors fenêtre sont écartés avant
  // tout calcul de layout (avant, layoutProgram tournait pour chaque programme de la ligne).
  const rangeStartMs = range.start.getTime();
  const windowStartMs = rangeStartMs + ((view.left - RENDER_BUFFER) / PX_PER_MINUTE) * 60000;
  const windowEndMs = rangeStartMs + ((view.left + view.width + RENDER_BUFFER) / PX_PER_MINUTE) * 60000;

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
  }, [rows.length > 0, range.start.getTime(), colWidth]);

  const scrollToOffset = (left: number) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(left, timelineWidth)), behavior: 'smooth' });
  };
  // « Maintenant » ramène 30 min de contexte avant l'instant présent.
  const scrollToNow = () => { if (nowOffset !== null) scrollToOffset(nowOffset - 30 * PX_PER_MINUTE); };

  // Jour affiché : celui de l'heure au bord gauche de la frise. L'origine de la
  // frise est déjà décalée de la colonne des chaînes dans le DOM.
  const viewedDay = midnightOf(new Date(range.start.getTime() + (view.left / PX_PER_MINUTE) * 60000 + 60000));
  const prevDay = new Date(viewedDay.getTime() - DAY_MS / 2); const prevStart = midnightOf(prevDay);
  const nextStart = midnightOf(new Date(viewedDay.getTime() + DAY_MS * 1.5));
  const canPrev = viewedDay.getTime() > range.start.getTime();
  const canNext = nextStart.getTime() < range.end.getTime();
  const isToday = viewedDay.getTime() === todayKey;

  // ── Navigation dans la grille ─────────────────────────────────────────
  // La colonne des chaînes reste collée à gauche. Le focus ne doit plus s'y
  // perdre : gauche/droite parcourent les émissions de la ligne et le
  // défilement amène toujours la case à droite de la colonne, jamais dessous.
  const [pendingFocus, setPendingFocus] = useState<{ channelId: string; start: number } | null>(null);
  const findCell = useCallback((channelId: string, start: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    for (const row of Array.from(scroller.querySelectorAll<HTMLElement>('[data-guide-row]'))) {
      if (row.getAttribute('data-guide-row') !== channelId) continue;
      return row.querySelector<HTMLElement>(`[data-program-start="${start}"]`);
    }
    return null;
  }, []);
  const focusCell = useCallback((el: HTMLElement) => {
    el.focus({ preventScroll: true });
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const box = el.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    const leftEdge = frame.left + colWidth + 6;
    const rightEdge = frame.right - 6;
    if (box.left < leftEdge) scroller.scrollLeft += box.left - leftEdge;
    else if (box.right > rightEdge && box.width <= rightEdge - leftEdge) scroller.scrollLeft += box.right - rightEdge;
  }, [colWidth]);
  // Une case hors de la fenêtre rendue n'existe pas encore : après le
  // défilement, le rendu suivant la monte et l'effet la focalise.
  useEffect(() => {
    if (!pendingFocus) return;
    const el = findCell(pendingFocus.channelId, pendingFocus.start);
    if (!el) return;
    setPendingFocus(null);
    focusCell(el);
  }, [pendingFocus, view.left, view.width, findCell, focusCell]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  // Première ligne réellement visible (la virtualisation garde aussi des lignes
  // d'avance hors écran) : son émission en cours sert de porte d'entrée.
  const scrollTopNow = scrollerRef.current?.scrollTop ?? 0;
  const firstVisibleRow = virtualRows.find((v) => v.start + ROW_HEIGHT > scrollTopNow)?.index ?? 0;

  // Les boutons Liste/Grille/Lecteur sont dans le bandeau au-dessus de la grille :
  // Bas entre par l'émission en cours au lieu de viser la case située sous le bouton.
  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (sheet || searchOpen) return;
    const target = event.target as HTMLElement;
    // Depuis la barre d'outils du guide, Bas entre par l'émission en cours :
    // sans cela la géométrie visait la case située sous le bouton (19 h).
    if (event.key === 'ArrowDown' && !target.closest('[data-guide-scroller]')) {
      const entry = scrollerRef.current?.querySelector<HTMLElement>('[data-guide-entry]');
      if (entry) { event.preventDefault(); event.stopPropagation(); focusCell(entry); }
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const cell = target.closest<HTMLElement>('[data-program-start]');
    if (!cell) return;
    const rowEl = cell.closest<HTMLElement>('[data-guide-row]');
    const channelId = rowEl?.getAttribute('data-guide-row');
    const row = channelId ? rows.find((r) => r.channel.id === channelId) : undefined;
    if (!row) return;
    const start = Number(cell.getAttribute('data-program-start'));
    const index = row.programs.findIndex((p) => p.startTime.getTime() === start);
    if (index < 0) return;
    const next = row.programs[index + (event.key === 'ArrowLeft' ? -1 : 1)];
    event.preventDefault();
    event.stopPropagation();
    // Bord de la frise : on reste sur l'émission au lieu de sauter au nom.
    if (!next) return;
    const layout = layoutProgram(next, range);
    if (!layout) return;
    const mounted = findCell(row.channel.id, next.startTime.getTime());
    if (mounted) { focusCell(mounted); return; }
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollLeft = Math.max(0, layout.left - colWidth - 6);
    setPendingFocus({ channelId: row.channel.id, start: next.startTime.getTime() });
  };

  const guideUpdatedLabel = guideState?.fetchedAt
    ? `${guideState.status === 'stale' ? 'Guide enregistré — actualisation impossible' : 'Guide actualisé'} · ${new Date(guideState.fetchedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : null;

  const bandProgramCurrent = !!bandProgram && bandProgram.startTime <= now && now < bandProgram.endTime;
  // Progression et temps restant : lus d'un coup d'œil, sans ouvrir la fiche.
  const bandProgress = bandProgram && bandProgramCurrent
    ? Math.min(100, Math.max(0, ((now.getTime() - bandProgram.startTime.getTime()) / Math.max(60_000, bandProgram.endTime.getTime() - bandProgram.startTime.getTime())) * 100))
    : null;
  const bandRemainingMin = bandProgram && bandProgramCurrent
    ? Math.max(1, Math.ceil((bandProgram.endTime.getTime() - now.getTime()) / 60_000))
    : null;
  // Heure de la dernière actualisation du guide : seule information de fraîcheur utile
  // à la télécommande ; le détail complet reste dans l'infobulle du bouton.
  const refreshTime = guideState?.fetchedAt
    ? new Date(guideState.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;
  const bandStatus = !bandProgram ? null : bandProgramCurrent ? 'live' : bandProgramIsFuture ? 'future' : 'past';

  // Commandes de date : à droite du bandeau sur TV (la grille récupère la ligne entière
  // au-dessus d'elle), sur leur propre ligne au-dessus de la grille sur téléphone.
  const dateNav = (
    <div className="flex items-center gap-0.5">
      <Button
        variant="outline"
        size="sm"
        className={`${tvMode ? 'h-7 w-7 bg-neutral-900/60' : 'h-9 w-9'} rounded-full p-0 border-neutral-800 text-white hover:bg-neutral-900`}
        aria-label="Jour précédent"
        disabled={!canPrev}
        onClick={() => scrollToOffset(offsetOf(prevStart))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span aria-live="polite" className={`text-center font-semibold capitalize ${tvMode ? 'min-w-[132px] text-[13px]' : 'min-w-[160px] text-[15px]'}`}>{dayLabelOf(viewedDay)}</span>
      <Button
        variant="outline"
        size="sm"
        className={`${tvMode ? 'h-7 w-7 bg-neutral-900/60' : 'h-9 w-9'} rounded-full p-0 border-neutral-800 text-white hover:bg-neutral-900`}
        aria-label="Jour suivant"
        disabled={!canNext}
        onClick={() => scrollToOffset(offsetOf(nextStart))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
  const dateActions = (
    <div className="flex items-center gap-1">
      {nowOffset !== null && (
        <Button variant="outline" size="sm" className={`${tvMode ? 'h-7 rounded-full bg-neutral-900/60 px-3 text-[13px]' : 'h-9 rounded-full'} border-neutral-800 text-white hover:bg-neutral-900`} onClick={scrollToNow}>
          {isToday ? 'Maintenant' : "Aujourd'hui"}
        </Button>
      )}
      <Button variant="outline" size="sm" className={`${tvMode ? 'h-7 w-7 bg-neutral-900/60' : 'h-9 w-9'} rounded-full p-0 border-neutral-800 text-white hover:bg-neutral-900`} onClick={() => setSearchOpen(true)} aria-label="Rechercher une émission" title="Rechercher une émission">
        <Search className="h-4 w-4" aria-hidden="true" /><span className={tvMode ? 'sr-only' : 'hidden sm:inline'}>Rechercher</span>
      </Button>
      {onGuideSettings && <Button variant="outline" size="sm" className={`${tvMode ? 'h-7 w-7 bg-neutral-900/60' : 'h-9 w-9'} rounded-full p-0 border-neutral-800 text-white hover:bg-neutral-900`} onClick={() => onGuideSettings()} aria-label="Réglages du guide" title="Sources, association des chaînes, décalage">
        <Settings2 className="h-4 w-4" aria-hidden="true" />
      </Button>}
    </div>
  );

  // Bandeau TV : l'aperçu 16:9 à gauche (comme la direction B), et à sa droite quatre
  // lignes qui remplissent toute la largeur — vues + fraîcheur, chaîne/état + date,
  // titre, horaires/progression. Sa hauteur laisse quatre lignes de chaînes entières.
  const band = tvMode ? (
    <div data-guide-band className="mb-1 flex shrink-0 items-stretch gap-3 rounded-2xl border border-neutral-800 bg-[linear-gradient(180deg,#1b1b1b,#151515)] pr-3">
      {previewActive ? (
        // L'aperçu touche le bord gauche et les bords haut/bas du cadre : ses angles
        // reprennent le rayon du bandeau, sans bordure propre (celle du cadre suffit).
        <div ref={previewRef} data-guide-preview={previewState} style={{ height: PREVIEW_HEIGHT, aspectRatio: '16 / 9' }} className="flex shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-l-2xl rounded-r-xl bg-black text-[11px] text-neutral-400">
          {previewState === 'error' ? 'Aperçu indisponible'
            : bandProgramIsFuture && bandProgram
              ? <span className="flex flex-col items-center gap-0.5 text-center">
                <Clock className="h-4 w-4 opacity-60" aria-hidden="true" />
                <span className="text-sm font-medium leading-none text-white">À {formatTime(bandProgram.startTime)}</span>
                <span className="text-[10px] leading-none">Programme à venir</span>
              </span>
            : previewState === 'playing' ? ''
            : previewMode === 'manual' && !manualPreview
              ? <button type="button" onClick={() => setManualPreview(true)} className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1.5 text-white hover:bg-white/10"><Eye className="h-4 w-4" aria-hidden="true" />Aperçu</button>
              : previewState === 'idle' ? <span className="flex items-center gap-1.5 opacity-60"><Eye className="h-4 w-4" aria-hidden="true" />Aperçu</span>
              : 'Aperçu…'}
        </div>
      ) : toolbar && <div className="flex shrink-0 items-center pl-3">{toolbar}</div>}
      {/* Le sélecteur s'aligne sur le haut de l'aperçu, très légèrement en dessous, et
          les horaires sur son bas : l'espace restant sépare la barre de vues du nom. */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-0.5 pt-1 pb-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {previewActive && toolbar}
          {refreshTime && (
            <button
              type="button"
              onClick={onRetry}
              aria-label="Actualiser"
              title={guideUpdatedLabel ?? 'Actualiser le guide'}
              className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] tabular-nums hover:bg-white/10 ${guideState?.status === 'stale' ? 'text-amber-300' : 'text-neutral-500'}`}
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />{refreshTime}
            </button>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {bandChannel && <span className="truncate text-[11px] uppercase tracking-[0.07em] text-neutral-400">{bandChannel.name}</span>}
          {bandStatus === 'live' && <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-primary"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />En direct</span>}
          {bandStatus === 'future' && <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-neutral-300">À venir</span>}
          {bandStatus === 'past' && <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-neutral-400">Terminé</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2">{dateNav}{dateActions}</span>
        </div>
        <span className="line-clamp-2 text-[15px] font-semibold leading-[1.2] text-white">{bandProgram ? bandProgram.title : bandChannel?.name ?? ''}</span>
        {bandProgram && (
          <div className="flex min-w-0 items-center gap-2 text-[11px] tabular-nums text-neutral-400">
            <span className="shrink-0">{formatTime(bandProgram.startTime)} – {formatTime(bandProgram.endTime)}</span>
            {bandProgress !== null && <span aria-hidden="true" className="h-1 min-w-[96px] max-w-[360px] flex-1 overflow-hidden rounded-full bg-neutral-700"><span className="block h-full rounded-full bg-primary" style={{ width: `${bandProgress}%` }} /></span>}
            {bandRemainingMin !== null && <span className="shrink-0 text-neutral-500">{bandRemainingMin >= 60 ? `reste ${Math.floor(bandRemainingMin / 60)} h ${String(bandRemainingMin % 60).padStart(2, '0')}` : `reste ${bandRemainingMin} min`}</span>}
          </div>
        )}
      </div>
    </div>
  ) : null;

  if (!epgData) {
    return (
      <div ref={rootRef} onFocus={onFocusIn} onBlur={onFocusOut} onKeyDown={onGridKeyDown} data-remote-self className="relative h-full flex flex-col min-h-0 text-white">
        {band}
        <div className="flex flex-1 items-center justify-center text-neutral-300 text-sm">
          Chargement du guide des programmes…
        </div>
      </div>
    );
  }

  if (guideState?.status === 'absent' || guideState?.status === 'error') {
    return <div ref={rootRef} onFocus={onFocusIn} onBlur={onFocusOut} onKeyDown={onGridKeyDown} data-remote-self className="relative h-full flex flex-col min-h-0 text-white">
      {band}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-4">
        <p role="status">{guideState.status === 'absent' ? 'Aucune source de guide configurée.' : 'Guide indisponible. Vérifie la connexion et la source EPG.'}</p>
        <div className="flex gap-2"><Button onClick={onRetry}>Réessayer</Button><Button variant="secondary" onClick={onGuideSettings ? () => onGuideSettings() : onConfigure}>Configurer le guide</Button></div>
      </div>
    </div>;
  }

  return (
    <div ref={rootRef} onFocus={onFocusIn} onBlur={onFocusOut} onKeyDown={onGridKeyDown} data-remote-self className="relative h-full flex flex-col min-h-0 text-white">
      {band}
      {!tvMode && guideUpdatedLabel && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
        <span className="truncate">{guideUpdatedLabel}</span>
        <Button size="sm" variant="ghost" onClick={onRetry}>Actualiser</Button>
      </div>}
      {/* Navigation jour : sur téléphone elle garde sa propre ligne au-dessus de la
          grille ; sur TV elle est dans le bandeau, ce qui rend une ligne de guide. */}
      {!tvMode && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {dateNav}
          {dateActions}
        </div>
      )}

      {rows.length === 0 && <p role="status" className="py-6 text-sm text-neutral-300 text-center">Pas de programmes à afficher. Actualise le guide ou vérifie la source EPG.</p>}
      {/* Grille défilante. L'aperçu est dans le bandeau du dessus : aucune case n'est recouverte. */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollerRef} data-guide-scroller className="h-full overflow-auto overscroll-x-contain rounded-xl border border-neutral-900 bg-neutral-950">
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
                    <span className={`flex h-full items-end px-1.5 pb-1.5 tabular-nums text-xs ${midnight ? 'font-semibold capitalize text-primary' : 'text-neutral-400'}`}>
                      {midnight ? shortDayOf(h) : formatTime(h)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lignes des chaînes (virtualisées) */}
          {virtualRows.map((virtualRow) => {
            const { channel, programs } = rows[virtualRow.index];
            const playing = currentChannel?.id === channel.id;
            // Jours d'archive propres à la chaîne : une lecture par ligne, plus par programme.
            const rowArchiveDays = onCatchup && catchupDays ? catchupDays(channel) : 0;
            const entryProgram = virtualRow.index === firstVisibleRow
              ? programs.find((p) => p.startTime <= now && now < p.endTime)
                ?? programs.find((p) => p.endTime.getTime() > windowStartMs && p.startTime.getTime() < windowEndMs)
              : undefined;
            // Tranche visible par dichotomie : le layout n'est calculé que pour les
            // émissions proches de la fenêtre, sans balayer toute la journée à chaque ligne.
            const { start: visibleStart, end: visibleEnd } = programsInRange(programs, windowStartMs, windowEndMs);
            const visiblePrograms = programs.slice(visibleStart, visibleEnd);
            return (
              <div
                key={channel.id}
                data-guide-row={channel.id}
                className="absolute left-0 top-0 flex border-b border-white/5"
                style={{ height: ROW_HEIGHT, width: colWidth + timelineWidth, transform: `translateY(${virtualRow.start}px)` }}
              >
                <button
                  type="button"
                  // Les noms restent visibles et cliquables, mais ne captent plus le
                  // focus de la télécommande : gauche ouvre le programme précédent.
                  tabIndex={-1}
                  onClick={() => onSelectChannel(channel)}
                  onFocus={() => setFocused({ channel, program: getCurrentProgram(channel.id, epgData) })}
                  onContextMenu={onGuideSettings ? (e) => { e.preventDefault(); onGuideSettings(channel); } : undefined}
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
                  {visiblePrograms.map((p) => {
                    const layout = layoutProgram(p, range);
                    if (!layout) return null;
                    const reminded = reminders.some(r => r.channelId === channel.id && r.startTime === p.startTime.getTime());
                    const isPast = p.endTime <= now;
                    const isCurrent = p.startTime <= now && now < p.endTime;
                    const replayable = rowArchiveDays > 0 && isInArchive(p.startTime, rowArchiveDays, now.getTime());
                    const recording = !isPast && scheduled.length > 0 && isScheduled(channel, p);
                    return (
                      <ProgramCell
                        key={p.startTime.getTime()}
                        channel={channel}
                        program={p}
                        left={layout.left}
                        width={layout.width}
                        isCurrent={isCurrent}
                        isPast={isPast}
                        reminded={reminded}
                        recording={recording}
                        replayable={replayable}
                        entry={p === entryProgram}
                        labelLeft={colWidth + 8}
                        onSelectChannel={onSelectChannel}
                        onCatchup={onCatchup}
                        setSheet={setSheet}
                        setFocused={setFocused}
                        toggleReminder={toggleReminder}
                        pressRef={press}
                      />
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
      <ProgramSheet
        playlistId={playlistId}
        target={sheet}
        onClose={closeSheet}
        epgData={epgData}
        channels={channels}
        catchupDays={catchupDays}
        onWatch={onSelectChannel}
        onCatchup={onCatchup}
      />
      <GuideSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        channels={guideChannels}
        epgData={epgData}
        catchupDays={onCatchup ? catchupDays : undefined}
        onPick={(channel, program) => { setSearchOpen(false); setSheet({ channel, program }); }}
      />
    </div>
  );
}
