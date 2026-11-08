import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RecordingsBridge, LocalLibraryBridge, type LocalMedia, type ScheduledRecording,
} from '@/utils/nativePlayer';
import { formatFileSize } from '@/utils/localLibrary';
import type { Channel } from '@/types/channel';
import {
  CalendarClock, CircleDot, Clock, FolderOpen, Loader2, Play, Plus, RefreshCw, Repeat, Trash2,
} from 'lucide-react';
import {
  getRecordingPrefs, getSeriesRules, removeSeriesRule, saveRecordingPrefs, DEFAULT_RECORDING_PREFS, RECORDING_RULES_EVENT,
  type RecordingPrefs, type SeriesRule,
} from '@/utils/recordingRules';

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Convertit une valeur « datetime-local » (heure locale) en timestamp ms. */
function parseLocalDateTime(value: string): number {
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
}

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

interface RecordingsProps {
  channels: Channel[];
  /** Chaîne présélectionnée dans le formulaire de programmation (accès contextuel). */
  initialChannel?: Channel | undefined;
}

export function Recordings({ channels, initialChannel }: RecordingsProps) {
  const [folder, setFolder] = useState<{ uri: string; name: string } | null>(null);
  const [files, setFiles] = useState<LocalMedia[]>([]);
  const [schedules, setSchedules] = useState<ScheduledRecording[]>([]);
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Formulaire de programmation
  const [channelId, setChannelId] = useState(initialChannel?.id ?? '');
  const [channelSearch, setChannelSearch] = useState(initialChannel?.name ?? '');
  const [startLocal, setStartLocal] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  // Marges d'enregistrement depuis le guide et séries suivies.
  const [prefs, setPrefs] = useState<RecordingPrefs>(DEFAULT_RECORDING_PREFS);
  const [rules, setRules] = useState<SeriesRule[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => { void Promise.all([getRecordingPrefs(), getSeriesRules()]).then(([p, r]) => { if (!cancelled) { setPrefs(p); setRules(r); } }); };
    load();
    window.addEventListener(RECORDING_RULES_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(RECORDING_RULES_EVENT, load); };
  }, []);
  const updateMargin = (key: keyof RecordingPrefs, value: number) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void saveRecordingPrefs(next).catch(() => toast.error('Impossible d’enregistrer les marges.'));
  };

  const refresh = useCallback(async () => {
    setBusy(true);
    const f = await RecordingsBridge.getFolder();
    setFolder(f);
    if (f) {
      const list = await RecordingsBridge.list();
      setFiles([...list].sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0)));
    } else {
      setFiles([]);
    }
    const scheds = await RecordingsBridge.listScheduled();
    setSchedules([...scheds].sort((a, b) => a.startTimeMs - b.startTimeMs));
    setBusy(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh().finally(() => { if (!cancelled) setInitialized(true); });
    return () => { cancelled = true; };
  }, [refresh]);

  const pick = async () => {
    const f = await RecordingsBridge.pickFolder();
    if (f) await refresh();
  };

  const remove = async (uri: string) => {
    if (await RecordingsBridge.remove(uri)) await refresh();
  };

  const play = async (file: LocalMedia) => {
    await LocalLibraryBridge.playLocal(file.uri, file.name);
  };

  const visibleChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase();
    const base = q ? channels.filter(c => c.name.toLowerCase().includes(q)) : channels;
    return [...base].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [channels, channelSearch]);

  const submitSchedule = async () => {
    const channel = channels.find(c => c.id === channelId || c.variants?.some(v => v.id === channelId));
    const picked = channel?.variants?.find(v => v.id === channelId) ?? channel;
    if (!picked) { setChannelSearch(''); return; }
    if (!startLocal) { toast.error('Choisis une date et une heure de début.'); return; }
    const startTimeMs = parseLocalDateTime(startLocal);
    const durationMs = Math.max(1, Math.round(durationMin)) * 60000;
    if (!Number.isFinite(startTimeMs) || startTimeMs <= Date.now()) {
      toast.error('La date de début doit être dans le futur.');
      return;
    }
    setSubmitting(true);
    const ok = await RecordingsBridge.schedule(picked.url, picked.name, startTimeMs, durationMs);
    setSubmitting(false);
    if (ok) {
      setChannelId('');
      setStartLocal('');
      toast.success('Enregistrement programmé : ' + picked.name);
      await refresh();
    }
  };

  const upcoming = useMemo(() => schedules.filter(s => s.startTimeMs > Date.now()), [schedules]);

  if (!initialized && busy) {
    return <div className="flex items-center justify-center py-20 text-neutral-400"><Loader2 className="h-6 w-6 animate-spin mr-2" aria-hidden="true" /> Chargement…</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Programmation ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-neutral-900 bg-neutral-950 p-4 space-y-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-red-400" aria-hidden="true" /> Programmer un enregistrement
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs text-neutral-400" htmlFor="rec-channel-search">Chaîne</label>
            <Input
              id="rec-channel-search"
              placeholder="Rechercher une chaîne…"
              value={channelSearch}
              onChange={e => setChannelSearch(e.target.value)}
              autoComplete="off"
            />
            <select
              aria-label="Chaîne à enregistrer"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white"
            >
              <option value="">— Choisir —</option>
              {visibleChannels.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-neutral-400" htmlFor="rec-start">Début</label>
            <Input
              id="rec-start"
              type="datetime-local"
              value={startLocal}
              onChange={e => setStartLocal(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-neutral-400" htmlFor="rec-duration">Durée (minutes)</label>
            <Input
              id="rec-duration"
              type="number"
              min={1}
              value={durationMin}
              onChange={e => setDurationMin(Number(e.target.value))}
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={() => { void submitSchedule(); }}
              disabled={submitting || !channelId || !startLocal || !folder}
              className="w-full gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Programmer
            </Button>
          </div>
        </div>

        {!folder && <p className="text-xs text-amber-300">Choisis d’abord le dossier de destination ci-dessous pour programmer un enregistrement.</p>}

        {upcoming.length > 0 ? (
          <ul className="divide-y divide-neutral-900 border border-neutral-900 rounded-lg overflow-hidden">
            {upcoming.map(s => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/5">
                <span className="shrink-0 w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">{s.title}</span>
                  <span className="block text-xs text-neutral-400">
                    {formatDate(s.startTimeMs)} · <span className="font-mono">{formatDuration(s.durationMs)}</span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => { void RecordingsBridge.cancelScheduled(s.id).then(ok => { if (ok) void refresh(); }); }}
                  className="shrink-0 rounded-md p-2 text-neutral-400 hover:bg-red-500/20 hover:text-red-300"
                  aria-label={`Annuler ${s.title}`}
                  title="Annuler cette programmation"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-neutral-500">
            Aucune programmation à venir. Les enregistrements se déclenchent automatiquement à l'heure choisie, même si l'application n'est plus à l'écran.
          </p>
        )}
      </section>

      {/* ── Guide : marges et séries ─────────────────────────────────────── */}
      <section className="rounded-lg border border-neutral-900 bg-neutral-950 p-4 space-y-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <Repeat className="h-5 w-5 text-primary" aria-hidden="true" /> Depuis le guide
        </h2>
        <p className="text-xs text-neutral-400">Dans le guide, OK maintenu (ou clic) sur une émission ouvre sa fiche : « Enregistrer » ou « Enregistrer la série ». Les marges couvrent un programme qui commence en avance ou finit en retard.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-neutral-400" htmlFor="rec-margin-before">Marge avant (minutes)</label>
            <Input id="rec-margin-before" type="number" min={0} max={60} value={prefs.marginBeforeMin} onChange={e => updateMargin('marginBeforeMin', Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-400" htmlFor="rec-margin-after">Marge après (minutes)</label>
            <Input id="rec-margin-after" type="number" min={0} max={60} value={prefs.marginAfterMin} onChange={e => updateMargin('marginAfterMin', Number(e.target.value))} />
          </div>
        </div>
        {rules.length > 0 ? (
          <ul className="divide-y divide-neutral-900 border border-neutral-900 rounded-lg overflow-hidden" aria-label="Séries suivies">
            {rules.map(rule => (
              <li key={rule.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/5">
                <span className="shrink-0 w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center">
                  <Repeat className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">{rule.title}</span>
                  <span className="block text-xs text-neutral-400">{rule.channelName} · chaque diffusion</span>
                </span>
                <button
                  type="button"
                  onClick={() => { void removeSeriesRule(rule.id).then(() => toast.info(`Série « ${rule.title} » arrêtée.`)); }}
                  className="shrink-0 rounded-md p-2 text-neutral-400 hover:bg-red-500/20 hover:text-red-300"
                  aria-label={`Arrêter la série ${rule.title}`}
                  title="Arrêter la série (les programmations déjà posées restent)"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-neutral-500">Aucune série suivie. Les diffusions d’une série sont programmées à chaque mise à jour du guide, pour la semaine à venir.</p>
        )}
      </section>

      {/* ── Enregistrements terminés ───────────────────────────────────── */}
      {!folder ? (
        <div className="text-center py-16">
          <CircleDot className="h-14 w-14 mx-auto text-red-400 mb-4" aria-hidden="true" />
          <h2 className="text-white text-lg font-semibold mb-1">Tes enregistrements</h2>
          <p className="text-neutral-400 max-w-md mx-auto mb-6">
            Choisis un dossier (clé USB, disque dur ou carte SD) où sauvegarder les directs que tu enregistres ou programmes.
          </p>
          <Button onClick={() => { void pick(); }} className="gap-2">
            <FolderOpen className="h-4 w-4" aria-hidden="true" /> Choisir un dossier
          </Button>
        </div>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px] flex items-center gap-2 text-sm text-neutral-300">
              <CircleDot className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
              <span className="truncate">{folder.name}</span>
            </div>
            <Button onClick={() => { void pick(); }} variant="outline" className="border-neutral-800 text-white hover:bg-neutral-900 gap-2">
              <FolderOpen className="h-4 w-4" aria-hidden="true" /> Changer
            </Button>
            <Button onClick={() => { void refresh(); }} variant="outline" className="border-neutral-800 text-white hover:bg-neutral-900 gap-2" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} Actualiser
            </Button>
          </div>

          <p className="text-xs text-neutral-500">
            Les directs MPEG-TS sont enregistrés en .ts ; les directs HLS (.m3u8) sont capturés segment par segment (.ts, ou .mp4 pour les flux fMP4).
          </p>

          {files.length === 0 ? (
            <p className="text-neutral-400 py-16 text-center">
              Aucun enregistrement pour l'instant. Enregistre un direct depuis le lecteur Android (bouton REC), ou choisis une chaîne ci-dessus et programme un enregistrement.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-900 border border-neutral-900 rounded-lg overflow-hidden">
              {files.map(file => (
                <li key={file.uri} className="flex items-center gap-3 px-3 py-2 hover:bg-white/5">
                  <button
                    type="button"
                    onClick={() => { void play(file); }}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    title={`Lire ${file.name}`}
                  >
                    <span className="shrink-0 w-9 h-9 rounded-md bg-red-500/15 text-red-300 flex items-center justify-center">
                      <Play className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{file.name}</span>
                      <span className="block text-xs text-neutral-400">
                        {formatFileSize(file.size)}{file.lastModified ? ` · ${formatDate(file.lastModified)}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { void remove(file.uri); }}
                    className="shrink-0 rounded-md p-2 text-neutral-400 hover:bg-red-500/20 hover:text-red-300"
                    aria-label={`Supprimer ${file.name}`}
                    title={`Supprimer ${file.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
