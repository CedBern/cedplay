import type { Channel } from '@/types/channel';
import type { EPGData, EPGProgram } from '@/types/epg';

export interface ProgramSearchResult {
  channel: Channel;
  program: EPGProgram;
  /** En cours, à venir, ou passé (seulement si un replay existe pour la chaîne). */
  when: 'now' | 'upcoming' | 'past';
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Cherche une émission dans le guide (titre, puis description et genre).
 * Ordre : en cours, à venir (chronologique), puis passées rejouables (récentes d'abord).
 * Les correspondances dans le titre passent avant celles du résumé.
 */
export function searchPrograms(
  epgData: EPGData | undefined,
  channels: Channel[],
  query: string,
  options: { now?: Date | undefined; catchupDays?: ((channel: Channel) => number) | undefined; limit?: number | undefined } = {},
): ProgramSearchResult[] {
  const terms = fold(query).split(' ').filter(t => t.length > 0);
  if (!epgData || !terms.length) return [];
  const now = (options.now ?? new Date()).getTime();
  const limit = options.limit ?? 80;
  const scored: Array<ProgramSearchResult & { score: number }> = [];
  for (const channel of channels) {
    const programs = epgData[channel.id];
    if (!programs?.length) continue;
    const archiveMs = (options.catchupDays?.(channel) ?? 0) * 86_400_000;
    for (const program of programs) {
      const end = program.endTime.getTime();
      const start = program.startTime.getTime();
      const past = end <= now;
      if (past && (archiveMs <= 0 || now - start > archiveMs)) continue;
      const title = fold(program.title);
      const inTitle = terms.every(t => title.includes(t));
      if (!inTitle) {
        const extra = fold(`${program.description ?? ''} ${program.category ?? ''}`);
        if (!terms.every(t => title.includes(t) || extra.includes(t))) continue;
      }
      const when = past ? 'past' : start <= now ? 'now' : 'upcoming';
      scored.push({ channel, program, when, score: inTitle ? 0 : 1 });
    }
  }
  const order = { now: 0, upcoming: 1, past: 2 } as const;
  scored.sort((a, b) => order[a.when] - order[b.when]
    || a.score - b.score
    || (a.when === 'past'
      ? b.program.startTime.getTime() - a.program.startTime.getTime()
      : a.program.startTime.getTime() - b.program.startTime.getTime()));
  return scored.slice(0, limit).map(({ score: _score, ...rest }) => rest);
}
