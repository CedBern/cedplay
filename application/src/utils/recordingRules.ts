import { getMeta, setMeta } from '@/utils/idb';
import { RecordingsBridge, type ScheduledRecording } from '@/utils/nativePlayer';
import type { Channel } from '@/types/channel';
import type { EPGData, EPGProgram } from '@/types/epg';

/**
 * Enregistrement depuis le guide : marges avant/après et enregistrements de série.
 * Les programmations elles-mêmes vivent côté Android (alarmes) ; ce module calcule
 * les créneaux et garde les règles de série, rejouées à chaque mise à jour du guide.
 */

export interface RecordingPrefs {
  marginBeforeMin: number;
  marginAfterMin: number;
}

export interface SeriesRule {
  id: string;
  playlistId: string;
  channelId: string;
  channelName: string;
  title: string;
  createdAt: number;
  /** Émissions déjà programmées par la règle (chaîne:début), pour ne pas les reprogrammer après une annulation. */
  scheduled: string[];
}

export const RECORDING_RULES_EVENT = 'recording-rules-updated';
const PREFS_KEY = 'recordingPrefs';
const RULES_KEY = 'seriesRules';
export const DEFAULT_RECORDING_PREFS: RecordingPrefs = { marginBeforeMin: 2, marginAfterMin: 5 };
/** Horizon de programmation des séries : le guide couvre rarement plus d'une semaine. */
const SERIES_HORIZON_MS = 8 * 86_400_000;
/** Délai minimal avant le démarrage : l'alarme Android doit être posée dans le futur. */
const START_DELAY_MS = 5_000;

const emit = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECORDING_RULES_EVENT)); };
const clampMargin = (n: unknown, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(60, Math.max(0, v)) : fallback;
};

export async function getRecordingPrefs(): Promise<RecordingPrefs> {
  try {
    const saved = await getMeta<RecordingPrefs>(PREFS_KEY);
    return {
      marginBeforeMin: clampMargin(saved?.marginBeforeMin, DEFAULT_RECORDING_PREFS.marginBeforeMin),
      marginAfterMin: clampMargin(saved?.marginAfterMin, DEFAULT_RECORDING_PREFS.marginAfterMin),
    };
  } catch { return { ...DEFAULT_RECORDING_PREFS }; }
}

export async function saveRecordingPrefs(prefs: RecordingPrefs): Promise<RecordingPrefs> {
  const clean = { marginBeforeMin: clampMargin(prefs.marginBeforeMin, 0), marginAfterMin: clampMargin(prefs.marginAfterMin, 0) };
  await setMeta(PREFS_KEY, clean);
  emit();
  return clean;
}

/** Titre comparable d'une émission (casse, accents et espaces ignorés). */
export const seriesKey = (title: string) => title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const programKey = (channelId: string, program: EPGProgram) => `${channelId}:${program.startTime.getTime()}`;

/** Créneau à programmer, marges comprises ; null si l'émission est terminée. */
export function recordingWindow(program: EPGProgram, prefs: RecordingPrefs, now = Date.now()): { startTimeMs: number; durationMs: number } | null {
  const end = program.endTime.getTime() + prefs.marginAfterMin * 60_000;
  const start = Math.max(program.startTime.getTime() - prefs.marginBeforeMin * 60_000, now + START_DELAY_MS);
  if (end - start < 60_000) return null;
  return { startTimeMs: start, durationMs: end - start };
}

export const recordingTitle = (channel: Channel, program: EPGProgram) => `${program.title} (${channel.name})`;

/**
 * Une programmation Android correspond-elle à cette émission (même flux, créneau qui la
 * couvre entièrement) ? Couvrir seulement le début ne suffit pas : l'épisode précédent,
 * marge après comprise, déborde sur le suivant sans l'enregistrer jusqu'au bout.
 */
export function findScheduled(scheduled: ScheduledRecording[], channel: Channel, program: EPGProgram, now = Date.now()): ScheduledRecording | undefined {
  const urls = new Set([channel.url, ...(channel.variants ?? []).map(v => v.url)]);
  const start = program.startTime.getTime();
  const end = program.endTime.getTime();
  // Démarrage au plus une heure avant (marge) et au plus tard au début de l'émission, ou
  // pendant celle-ci si elle a été programmée en cours de diffusion ; fin après l'émission.
  const latestStart = Math.max(start + 60_000, Math.min(now + 60_000, end - 60_000));
  return scheduled.find(s => urls.has(s.url)
    && s.startTimeMs >= start - 60 * 60_000 && s.startTimeMs <= latestStart
    && s.startTimeMs + s.durationMs >= end);
}

/** Programme l'enregistrement d'une émission (marges comprises). */
export async function scheduleProgramRecording(channel: Channel, program: EPGProgram, options: { silent?: boolean; prefs?: RecordingPrefs } = {}): Promise<boolean> {
  const prefs = options.prefs ?? await getRecordingPrefs();
  const slot = recordingWindow(program, prefs);
  if (!slot) return false;
  return RecordingsBridge.schedule(channel.url, recordingTitle(channel, program), slot.startTimeMs, slot.durationMs, { silent: options.silent === true });
}

export async function getSeriesRules(): Promise<SeriesRule[]> {
  try {
    const saved = await getMeta<SeriesRule[]>(RULES_KEY);
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

async function saveSeriesRules(rules: SeriesRule[]): Promise<void> {
  await setMeta(RULES_KEY, rules);
  emit();
}

export function findSeriesRule(rules: SeriesRule[], playlistId: string, channelId: string, title: string): SeriesRule | undefined {
  const key = seriesKey(title);
  return rules.find(r => r.playlistId === playlistId && r.channelId === channelId && seriesKey(r.title) === key);
}

export async function addSeriesRule(playlistId: string, channel: Channel, title: string): Promise<SeriesRule> {
  const rules = await getSeriesRules();
  const existing = findSeriesRule(rules, playlistId, channel.id, title);
  if (existing) return existing;
  const rule: SeriesRule = {
    id: `${playlistId}:${channel.id}:${seriesKey(title)}`,
    playlistId, channelId: channel.id, channelName: channel.name, title, createdAt: Date.now(), scheduled: [],
  };
  await saveSeriesRules([...rules, rule]);
  return rule;
}

export async function removeSeriesRule(id: string): Promise<void> {
  const rules = await getSeriesRules();
  await saveSeriesRules(rules.filter(r => r.id !== id));
}

/**
 * Programme les prochaines diffusions des séries suivies, d'après le guide chargé.
 * Une émission déjà programmée (par la règle ou à la main) n'est pas reprogrammée.
 * Renvoie le nombre de nouvelles programmations.
 */
export async function applySeriesRules(playlistId: string, channels: Channel[], epgData: EPGData | undefined, now = Date.now()): Promise<number> {
  if (!epgData || !RecordingsBridge.isAvailable()) return 0;
  const rules = (await getSeriesRules()).filter(r => r.playlistId === playlistId);
  if (!rules.length) return 0;
  const byId = new Map(channels.map(c => [c.id, c]));
  const prefs = await getRecordingPrefs();
  let scheduledNow = await RecordingsBridge.listScheduled();
  let added = 0;
  const all = await getSeriesRules();
  let changed = false;
  for (const rule of rules) {
    const channel = byId.get(rule.channelId);
    const programs = channel ? epgData[channel.id] : undefined;
    if (!channel || !programs?.length) continue;
    const key = seriesKey(rule.title);
    const done = new Set(rule.scheduled);
    for (const program of programs) {
      const start = program.startTime.getTime();
      if (start <= now || start > now + SERIES_HORIZON_MS || seriesKey(program.title) !== key) continue;
      const pk = programKey(channel.id, program);
      if (done.has(pk)) continue;
      // Déjà programmée à la main, ou programmée maintenant : marquée faite. Un échec
      // (dossier absent…) sera retenté à la prochaine mise à jour du guide.
      const already = !!findScheduled(scheduledNow, channel, program, now);
      if (!already && !(await scheduleProgramRecording(channel, program, { silent: true, prefs }))) continue;
      if (!already) { added++; scheduledNow = await RecordingsBridge.listScheduled(); }
      done.add(pk);
      changed = true;
    }
    // Garder seulement les clés récentes : la liste ne grossit pas indéfiniment.
    const target = all.find(r => r.id === rule.id);
    if (target) target.scheduled = [...done].filter(k => Number(k.slice(k.lastIndexOf(':') + 1)) > now - 86_400_000);
  }
  if (changed) await saveSeriesRules(all);
  return added;
}
