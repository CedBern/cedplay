import { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, CircleDot, CircleOff, Loader2, Play, Repeat, RotateCcw, SkipBack } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Channel } from '@/types/channel';
import type { EPGProgram } from '@/types/epg';
import { formatTime } from '@/utils/epgXmltv';
import { isInArchive } from '@/utils/catchup';
import { addReminder, getReminders, removeReminder, type EpgReminder } from '@/utils/reminders';
import { RecordingsBridge, type ScheduledRecording } from '@/utils/nativePlayer';
import {
  addSeriesRule, applySeriesRules, findScheduled, findSeriesRule, getRecordingPrefs, getSeriesRules, removeSeriesRule,
  scheduleProgramRecording, DEFAULT_RECORDING_PREFS, type RecordingPrefs, type SeriesRule,
} from '@/utils/recordingRules';
import type { EPGData } from '@/types/epg';

export interface ProgramSheetTarget { channel: Channel; program: EPGProgram }

interface ProgramSheetProps {
  playlistId: string;
  target: ProgramSheetTarget | null;
  onClose: () => void;
  /** Guide complet : une nouvelle série programme aussitôt ses prochaines diffusions. */
  epgData?: EPGData | undefined;
  channels?: Channel[] | undefined;
  catchupDays?: ((channel: Channel) => number) | undefined;
  onWatch: (channel: Channel) => void;
  onCatchup?: ((channel: Channel, program: EPGProgram) => void) | undefined;
}

interface Action { id: string; label: string; icon: JSX.Element; run: () => void | Promise<void>; tone?: 'danger' }

const dayLabel = (date: Date) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
const durationLabel = (ms: number) => {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;
};

/** Fiche d'une émission du guide et ses actions (regarder, revoir, enregistrer, série, rappel). */
export function ProgramSheet({ playlistId, target, onClose, epgData, channels, catchupDays, onWatch, onCatchup }: ProgramSheetProps) {
  const [reminders, setReminders] = useState<EpgReminder[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledRecording[]>([]);
  const [rules, setRules] = useState<SeriesRule[]>([]);
  const [prefs, setPrefs] = useState<RecordingPrefs>(DEFAULT_RECORDING_PREFS);
  const [busy, setBusy] = useState(false);
  const canRecord = RecordingsBridge.isAvailable();

  const reload = async () => {
    const [r, s, rl, p] = await Promise.all([getReminders(), RecordingsBridge.listScheduled(), getSeriesRules(), getRecordingPrefs()]);
    setReminders(r); setScheduled(s); setRules(rl); setPrefs(p);
  };
  useEffect(() => { if (target) void reload(); }, [target]);

  const actions = useMemo<Action[]>(() => {
    if (!target) return [];
    const { channel, program } = target;
    const now = Date.now();
    const start = program.startTime.getTime();
    const isPast = program.endTime.getTime() <= now;
    const isCurrent = start <= now && !isPast;
    const days = catchupDays?.(channel) ?? 0;
    const replayable = days > 0 && onCatchup && isInArchive(program.startTime, days, now);
    const list: Action[] = [];
    const close = (fn: () => void) => () => { onClose(); fn(); };
    if (isCurrent) list.push({ id: 'watch', label: 'Regarder', icon: <Play className="h-4 w-4" aria-hidden="true" />, run: close(() => onWatch(channel)) });
    if (replayable) {
      list.push(isPast
        ? { id: 'replay', label: 'Revoir', icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />, run: close(() => onCatchup!(channel, program)) }
        : { id: 'restart', label: 'Depuis le début', icon: <SkipBack className="h-4 w-4" aria-hidden="true" />, run: close(() => onCatchup!(channel, program)) });
    }
    if (!isPast && canRecord) {
      const existing = findScheduled(scheduled, channel, program);
      list.push(existing
        ? {
          id: 'record', label: 'Annuler l’enregistrement', tone: 'danger', icon: <CircleOff className="h-4 w-4" aria-hidden="true" />,
          run: async () => { if (await RecordingsBridge.cancelScheduled(existing.id)) { toast.info('Enregistrement annulé.'); await reload(); } },
        }
        : {
          id: 'record', label: isCurrent ? 'Enregistrer (dès maintenant)' : 'Enregistrer', icon: <CircleDot className="h-4 w-4 text-red-400" aria-hidden="true" />,
          run: async () => {
            if (await scheduleProgramRecording(channel, program, { prefs })) {
              toast.success(`Enregistrement programmé : « ${program.title} ».`);
              await reload();
            }
          },
        });
      const rule = findSeriesRule(rules, playlistId, channel.id, program.title);
      list.push(rule
        ? {
          id: 'series', label: 'Arrêter la série', icon: <Repeat className="h-4 w-4" aria-hidden="true" />,
          run: async () => { await removeSeriesRule(rule.id); toast.info(`Série « ${rule.title} » arrêtée. Les enregistrements déjà programmés restent.`); await reload(); },
        }
        : {
          id: 'series', label: 'Enregistrer la série', icon: <Repeat className="h-4 w-4" aria-hidden="true" />,
          run: async () => {
            await addSeriesRule(playlistId, channel, program.title);
            const added = channels && epgData ? await applySeriesRules(playlistId, channels, epgData) : 0;
            toast.success(added
              ? `Série « ${program.title} » : ${added} diffusion${added > 1 ? 's' : ''} programmée${added > 1 ? 's' : ''}.`
              : `Série « ${program.title} » suivie : les prochaines diffusions seront programmées.`);
            await reload();
          },
        });
    }
    if (!isPast && !isCurrent) {
      const reminded = reminders.some(r => r.channelId === channel.id && r.startTime === start);
      list.push(reminded
        ? { id: 'reminder', label: 'Retirer le rappel', icon: <BellOff className="h-4 w-4" aria-hidden="true" />, run: async () => { await removeReminder(`${channel.id}:${start}`); toast.info('Rappel retiré.'); await reload(); } }
        : { id: 'reminder', label: 'Me le rappeler', icon: <Bell className="h-4 w-4" aria-hidden="true" />, run: async () => { await addReminder({ channelId: channel.id, channelName: channel.name, title: program.title, startTime: start }); toast.success(`Rappel : « ${program.title} » à ${formatTime(program.startTime)}.`); await reload(); } });
      list.push({ id: 'live', label: 'Regarder la chaîne', icon: <Play className="h-4 w-4" aria-hidden="true" />, run: close(() => onWatch(channel)) });
    }
    if (isPast && !replayable) list.push({ id: 'live', label: 'Regarder la chaîne', icon: <Play className="h-4 w-4" aria-hidden="true" />, run: close(() => onWatch(channel)) });
    return list;
  }, [target, catchupDays, onCatchup, onWatch, onClose, canRecord, scheduled, rules, reminders, prefs, playlistId, channels, epgData]);

  const run = async (action: Action) => {
    if (busy) return;
    setBusy(true);
    try { await action.run(); } catch { toast.error('Action impossible.'); } finally { setBusy(false); }
  };

  const program = target?.program;
  const channel = target?.channel;
  const now = Date.now();
  const progress = program && program.startTime.getTime() <= now && program.endTime.getTime() > now
    ? Math.round(((now - program.startTime.getTime()) / (program.endTime.getTime() - program.startTime.getTime())) * 100)
    : null;

  return (
    <Dialog open={!!target} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-lg border-neutral-800 bg-neutral-950 text-white"
        // OK maintenu pour ouvrir la fiche : les répétitions de la touche ne doivent pas déclencher le premier bouton.
        onKeyDownCapture={e => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); } }}
      >
        {program && channel && <>
          <DialogHeader className="space-y-1 text-left">
            <p className="text-xs uppercase tracking-wide text-primary">{channel.name}</p>
            <DialogTitle className="text-xl leading-tight">{program.title}</DialogTitle>
            <DialogDescription className="text-sm text-neutral-300">
              <span className="capitalize">{dayLabel(program.startTime)}</span> · {formatTime(program.startTime)} – {formatTime(program.endTime)} · {durationLabel(program.endTime.getTime() - program.startTime.getTime())}
              {program.category ? ` · ${program.category}` : null}
            </DialogDescription>
          </DialogHeader>
          {progress !== null && <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-800" aria-hidden="true"><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div>}
          {program.description && <p className="max-h-40 overflow-y-auto text-sm leading-relaxed text-neutral-300">{program.description}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                autoFocus={index === 0}
                disabled={busy}
                onClick={() => { void run(action); }}
                className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${action.tone === 'danger' ? 'border-red-500/40 bg-red-500/10 hover:bg-red-500/20' : 'border-neutral-800 bg-white/5 hover:bg-white/10'}`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : action.icon}
                <span className="truncate">{action.label}</span>
              </button>
            ))}
          </div>
          {program.endTime.getTime() > now && (canRecord
            ? <p className="text-xs text-neutral-500">Marges d’enregistrement : {prefs.marginBeforeMin} min avant, {prefs.marginAfterMin} min après (réglables dans Enregistrements).</p>
            : <p className="text-xs text-neutral-500">L’enregistrement est disponible dans l’application Android.</p>)}
        </>}
      </DialogContent>
    </Dialog>
  );
}
