import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { desktopHttp, isDesktopRuntime } from '@/utils/desktopBridge';

export interface SubtitleCue {
  id: number;
  startMs: number;
  endMs: number;
  startTime: string;
  endTime: string;
  text: string;
}

/** Convertit une chaîne de timestamp SRT "00:01:23,456" ou VTT "00:01:23.456" en millisecondes */
export function parseTimestamp(ts: string): number {
  const parts = ts.trim().replace(',', '.').split(':');
  if (parts.length < 2) return 0;
  let hours = 0;
  let minutes = 0;
  let secondsWithMs = 0;
  if (parts.length === 3) {
    hours = parseInt(parts[0], 10) || 0;
    minutes = parseInt(parts[1], 10) || 0;
    secondsWithMs = parseFloat(parts[2]) || 0;
  } else {
    minutes = parseInt(parts[0], 10) || 0;
    secondsWithMs = parseFloat(parts[1]) || 0;
  }
  return Math.round((hours * 3600 + minutes * 60 + secondsWithMs) * 1000);
}

/** Formate des millisecondes en format SRT "HH:MM:SS,mmm" */
export function formatTimestampSrt(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const milliseconds = safeMs % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/** Formate des millisecondes en format WebVTT "HH:MM:SS.mmm" */
export function formatTimestampVtt(ms: number): string {
  return formatTimestampSrt(ms).replace(',', '.');
}

/** Découpe et extrait les répliques d'un contenu SRT standard */
export function parseSrt(raw: string): SubtitleCue[] {
  if (!raw || typeof raw !== 'string') return [];
  // Normalise les retours chariots
  const cleaned = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = cleaned.split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    let timeLineIdx = lines.findIndex(line => line.includes('-->'));
    if (timeLineIdx < 0) continue;
    // Si la 1ère ligne est un numéro d'ordre (ex: "1")
    if (/^\d+$/.test(lines[0]) && lines.length >= 2 && lines[1].includes('-->')) {
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx];
    const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{3}|\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3}|\d{2}:\d{2}[,.]\d{3})/);
    if (!match) continue;

    const startTime = match[1];
    const endTime = match[2];
    const startMs = parseTimestamp(startTime);
    const endMs = parseTimestamp(endTime);
    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join('\n').trim();

    if (text) {
      cues.push({
        id: cues.length + 1,
        startMs,
        endMs,
        startTime: formatTimestampSrt(startMs),
        endTime: formatTimestampSrt(endMs),
        text,
      });
    }
  }

  return cues;
}

/** Génère un fichier SRT valide à partir de répliques */
export function cuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map((c, idx) => `${idx + 1}\n${formatTimestampSrt(c.startMs)} --> ${formatTimestampSrt(c.endMs)}\n${c.text}`)
    .join('\n\n');
}

/** Génère un fichier WebVTT valide à partir de répliques */
export function cuesToVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map((c, idx) => `${idx + 1}\n${formatTimestampVtt(c.startMs)} --> ${formatTimestampVtt(c.endMs)}\n${c.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** Ajuste le décalage temporel (synchronisation) des répliques */
export function shiftCues(cues: SubtitleCue[], offsetMs: number): SubtitleCue[] {
  if (offsetMs === 0) return cues;
  return cues.map((c) => {
    const startMs = Math.max(0, c.startMs + offsetMs);
    const duration = Math.max(500, c.endMs - c.startMs);
    const endMs = startMs + duration;
    return {
      ...c,
      startMs,
      endMs,
      startTime: formatTimestampSrt(startMs),
      endTime: formatTimestampSrt(endMs),
    };
  });
}

const CUE_DELIMITER = ' ___¶___ ';
const BR_DELIMITER = ' __BR__ ';

async function translateChunk(
  text: string,
  targetLang: string,
  deeplApiKey?: string
): Promise<string> {
  if (deeplApiKey?.trim()) {
    // DeepL API Free / Pro
    const isPro = !deeplApiKey.endsWith(':fx');
    const endpoint = isPro
      ? 'https://api.deepl.com/v2/translate'
      : 'https://api-free.deepl.com/v2/translate';
    const params = new URLSearchParams({
      text,
      target_lang: targetLang.toUpperCase(),
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `DeepL-Auth-Key ${deeplApiKey.trim()}` };

    let data: { translations?: { text?: string }[] };
    if (isDesktopRuntime()) {
      const res = await desktopHttp<unknown>({ url: endpoint, method: 'POST', body: params.toString(), headers, responseType: 'json' });
      if (res.status < 200 || res.status >= 300) throw new Error('Traduction indisponible');
      data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data as { translations?: { text?: string }[] };
    } else if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.post({ url: endpoint, data: params.toString(), headers });
      if (res.status < 200 || res.status >= 300) throw new Error('Traduction indisponible');
      data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } else {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: params.toString(),
      });
      if (!res.ok) throw new Error('Traduction indisponible');
      data = await res.json();
    }
    if (data?.translations?.[0]?.text) {
      return data.translations[0].text;
    }
  }

  // Moteur Google Translate gratuit universel (sans clé requise)
  const langCode = targetLang.toLowerCase().startsWith('fr') ? 'fr' : targetLang;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(langCode)}&dt=t&q=${encodeURIComponent(text)}`;

  if (isDesktopRuntime()) {
    const res = await desktopHttp<unknown>({
      url,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      responseType: 'json',
      timeoutMs: 15_000,
    });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((x: unknown) => (Array.isArray(x) && typeof x[0] === 'string' ? x[0] : '')).join('');
    }
  } else if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      connectTimeout: 10_000,
      readTimeout: 15_000,
    });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((x: unknown) => (Array.isArray(x) && typeof x[0] === 'string' ? x[0] : '')).join('');
    }
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((x: unknown) => (Array.isArray(x) && typeof x[0] === 'string' ? x[0] : '')).join('');
    }
  }

  throw new Error('Échec de la traduction');
}

/**
 * Traduit un tableau de répliques vers la langue cible (par défaut français).
 * Découpe en lots. Un échec ou une perte de séparateurs invalide la traduction
 * entière : une VO inchangée ne doit jamais être mise en cache comme traduction.
 */
export async function translateCues(
  cues: SubtitleCue[],
  targetLang = 'fr',
  options?: {
    onProgress?: ((percent: number) => void) | undefined;
    deeplApiKey?: string | undefined;
    batchSize?: number | undefined;
  }
): Promise<SubtitleCue[]> {
  if (!cues.length) return [];
  const batchSize = Math.max(10, Math.min(60, options?.batchSize || 30));
  const translatedCues: SubtitleCue[] = [];
  const total = cues.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = cues.slice(i, i + batchSize);
    const combined = batch
      .map((c) => c.text.replace(/\n/g, BR_DELIMITER))
      .join(CUE_DELIMITER);

    try {
      const translatedText = await translateChunk(combined, targetLang, options?.deeplApiKey);
      const parts = translatedText.split(new RegExp(`\\s*${CUE_DELIMITER.trim()}\\s*`, 'i'));
      if (parts.length !== batch.length || parts.some(part => !part.trim())) throw new Error('Répliques de traduction incomplètes');

      for (let j = 0; j < batch.length; j++) {
        const original = batch[j];
        const rawPart = parts[j] ?? original.text;
        const restored = rawPart
          .replace(new RegExp(`\\s*${BR_DELIMITER.trim()}\\s*`, 'gi'), '\n')
          .trim();
        translatedCues.push({
          ...original,
          text: restored || original.text,
        });
      }
    } catch {
      throw new Error('Traduction incomplète. Le sous-titre d’origine reste disponible.');
    }

    if (options?.onProgress) {
      const current = Math.min(total, i + batch.length);
      options.onProgress(Math.round((current / total) * 100));
    }
  }

  return translatedCues;
}

/** Traduit une chaîne SRT complète et renvoie le SRT et le WebVTT correspondants */
export async function translateSrt(
  srtContent: string,
  targetLang = 'fr',
  options?: {
    onProgress?: ((percent: number) => void) | undefined;
    deeplApiKey?: string | undefined;
    offsetMs?: number | undefined;
  }
): Promise<{ srt: string; vtt: string; cueCount: number }> {
  let cues = parseSrt(srtContent);
  if (!cues.length) throw new Error('Aucune réplique de sous-titre lisible.');
  if (options?.offsetMs) {
    cues = shiftCues(cues, options.offsetMs);
  }
  const translated = await translateCues(cues, targetLang, options);
  return {
    srt: cuesToSrt(translated),
    vtt: cuesToVtt(translated),
    cueCount: translated.length,
  };
}
