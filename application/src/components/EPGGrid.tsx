import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { ChevronLeft, ChevronRight, Bell, CircleDot, Eye, RotateCcw, Search, Settings2, SkipBack } from 'lucide-react';
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
import { NativePlayerBridge, RecordingsBridge, type PreviewState, type ScheduledRecording } from '@/utils/nativePlayer';
import { findScheduled, RECORDING_RULES_EVENT } from '@/utils/recordingRules';
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
  /** Réglages du guide (sources, association d'une chaîne). */
  onGuideSettings?: ((channel?: Channel) => void) | undefined;
}

/** Appui long sur OK (ms) : ouvre la fiche au lieu de lancer l'action. */
const LONG_PRESS_MS = 550;
/** Temps d'arrêt sur une chaîne avant de lancer le mini-lecteur. */
const PREVIEW_DELAY = 700;
const isActivationKey = (key: string) => key === 'Enter' || key === ' ';

const TIME_AXIS_HEIGHT = 44;
const ROW_HEIGHT = 64;
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
  channel, program: p, left, width, isCurrent, isPast, reminded, recording, replayable,
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
      className={`group absolute top-1 bottom-1 overflow-hidden rounded-lg border px-2 text-left cursor-pointer ${tone}`}
      style={{ left: left + 1, width: Math.max(width - 2, 24) }}
      title={`${formatTime(p.startTime)} – ${formatTime(p.endTime)} · ${p.title}${isPast && replayable ? ' · Revoir' : ''}`}
    >
      <span className="flex items-center gap-1 truncate text-xs font-medium leading-tight pr-5">
        {isPast && replayable && <RotateCcw aria-hidden="true" className="h-3 w-3 shrink-0 text-primary" />}
        {recording && <CircleDot aria-hidden="true" className="h-3 w-3 shrink-0 text-red-400" />}
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
});

/** Grille des programmes (guide TV) : chaînes en lignes, horaires en colonnes. */
export function EPGGrid({ channels, epgData, currentChannel, onSelectChannel, guideState, onRetry, onConfigure, lockedGroups, unlocked, catchupDays, onCatchup, playlistId = '', tvMode = false, preview = false, previewMode = 'auto', onGuideSettings }: EPGGridProps) {
  const [now, setNow] = useState(() => new Date());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(isNarrowScreen);
  // Zone visible (px) : seuls les programmes proches sont rendus.
  const [view, setView] = useState({ left: 0, width: Number.POSITIVE_INFINITY });

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
  // Posé par Android au-dessus du cadre réservé ; actif seulement quand le focus est
  // dans la grille et qu'aucune fenêtre n'est ouverte (il passerait devant).
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [focusInside, setFocusInside] = useState(false);
  const [manualPreview, setManualPreview] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'waiting' | PreviewState>('idle');
  const previewActive = tvMode && preview && previewMode !== 'off';
  const focusedUrl = focused?.channel.url ?? null;
  useEffect(() => { setManualPreview(false); }, [focusedUrl]);
  const previewUrl = previewActive && focusInside && !sheet && !searchOpen && focusedUrl && (previewMode !== 'manual' || manualPreview) ? focusedUrl : null;
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
      <div className="flex gap-2"><Button onClick={onRetry}>Réessayer</Button><Button variant="secondary" onClick={onGuideSettings ? () => onGuideSettings() : onConfigure}>Configurer le guide</Button></div>
    </div>;
  }

  const banner = focused ?? (currentChannel ? { channel: currentChannel, program: getCurrentProgram(currentChannel.id, epgData) } : null);
  return (
    <div ref={rootRef} onFocus={onFocusIn} onBlur={onFocusOut} className="h-full flex flex-col min-h-0 text-white">
      {tvMode && <div className="mb-2 flex h-[168px] shrink-0 gap-3" data-guide-banner>
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-neutral-900 bg-neutral-950 p-3">
          {banner ? <>
            <p className="truncate text-xs uppercase tracking-wide text-primary">{banner.channel.name}</p>
            <p className="truncate text-lg font-semibold leading-tight">{banner.program?.title ?? 'Pas d’information de programme'}</p>
            {banner.program && <p className="font-mono text-xs text-neutral-400">{formatTime(banner.program.startTime)} – {formatTime(banner.program.endTime)}{banner.program.category ? ` · ${banner.program.category}` : ''}</p>}
            {banner.program?.description && <p className="mt-1 line-clamp-3 text-sm text-neutral-300">{banner.program.description}</p>}
          </> : <p className="text-sm text-neutral-400">Choisis une émission avec les flèches.</p>}
          <p className="mt-1 truncate text-[11px] text-neutral-500">OK : regarder ou fiche · OK maintenu : fiche de l’émission</p>
        </div>
        {previewActive && <div ref={previewRef} data-guide-preview={previewState} className="relative flex aspect-video h-full shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-black text-xs text-neutral-400">
          {previewState === 'error' ? 'Aperçu indisponible'
            : previewState === 'playing' ? ''
            : previewMode === 'manual' && !manualPreview ? (focused ? <button type="button" onClick={() => setManualPreview(true)} className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1.5 text-white hover:bg-white/10"><Eye className="h-4 w-4" aria-hidden="true" />Aperçu</button> : 'Aperçu')
            : previewState === 'idle' ? '' : 'Aperçu…'}
        </div>}
      </div>}
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
        <div className="flex items-center gap-1">
          {nowOffset !== null && (
            <Button variant="outline" size="sm" className="h-9 border-neutral-800 text-white hover:bg-neutral-900" onClick={scrollToNow}>
              {isToday ? 'Maintenant' : "Aujourd'hui"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9 border-neutral-800 text-white hover:bg-neutral-900" onClick={() => setSearchOpen(true)} aria-label="Rechercher une émission" title="Rechercher une émission">
            <Search className="h-4 w-4 sm:mr-1.5" aria-hidden="true" /><span className="hidden sm:inline">Rechercher</span>
          </Button>
          {onGuideSettings && <Button variant="outline" size="sm" className="h-9 border-neutral-800 text-white hover:bg-neutral-900" onClick={() => onGuideSettings()} aria-label="Réglages du guide" title="Sources, association des chaînes, décalage">
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </Button>}
        </div>
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
            // Jours d'archive propres à la chaîne : une lecture par ligne, plus par programme.
            const rowArchiveDays = onCatchup && catchupDays ? catchupDays(channel) : 0;
            return (
              <div
                key={channel.id}
                className="absolute left-0 top-0 flex border-b border-white/5"
                style={{ height: ROW_HEIGHT, width: colWidth + timelineWidth, transform: `translateY(${virtualRow.start}px)` }}
              >
                <button
                  type="button"
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
                  {programs.map((p) => {
                    // Filtre de fenêtre en temps : le layout n'est calculé que pour les
                    // programmes proches de la zone visible.
                    if (p.endTime.getTime() <= windowStartMs || p.startTime.getTime() >= windowEndMs) return null;
                    const layout = layoutProgram(p, range);
                    if (!layout) return null;
                    const reminded = reminders.some(r => r.channelId === channel.id && r.startTime === p.startTime.getTime());
                    const isPast = p.endTime <= now;
                    const isCurrent = p.startTime <= now && now < p.endTime;
                    const replayable = rowArchiveDays > 0 && isInArchive(p.startTime, rowArchiveDays, now.getTime());
                    const recording = !isPast && scheduled.length > 0 && !!findScheduled(scheduled, channel, p);
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
