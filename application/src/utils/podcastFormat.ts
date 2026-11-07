/** Position lisible pour un lecteur (1:05, 1:02:30). */
export function formatAudioTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Durée d'épisode à la minute près : « 25 min », « 1 h 05 ». */
export function formatEpisodeLength(ms: number): string {
  const totalMin = Math.max(1, Math.round((ms || 0) / 60_000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Date courte : « Aujourd’hui », « Hier », « 29 oct. », l'année seulement si elle diffère. */
export function formatEpisodeDate(pubDate?: string, publishedAt?: number, now = new Date()): string {
  const ts = publishedAt || (pubDate ? Date.parse(pubDate) : 0);
  if (!ts || !Number.isFinite(ts)) return '';
  const date = new Date(ts);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  try {
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  } catch {
    return '';
  }
}
