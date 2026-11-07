import { Channel } from '@/types/channel';

export const normalizeSearch = (value: string) => value.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function createSearchIndex(channels: Channel[]) {
  const tokens = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  const byId = new Map<string, Channel>();
  for (const channel of channels) {
    const name = normalizeSearch(channel.name);
    names.set(channel.id, name);
    byId.set(channel.id, channel);
    for (const token of `${name} ${normalizeSearch(channel.group || '')}`.split(/\s+/)) {
      if (!token) continue;
      if (!tokens.has(token)) tokens.set(token, new Set());
      tokens.get(token)!.add(channel.id);
    }
  }
  return { tokens, names, byId };
}

function oneEditAway(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

export function searchChannels(index: ReturnType<typeof createSearchIndex>, query: string, mode: 'precise' | 'fuzzy'): Channel[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return [...index.byId.values()];
  let matches: Set<string> | undefined;
  for (const queryToken of normalized.split(/\s+/)) {
    const tokenMatches = new Set<string>();
    for (const [token, ids] of index.tokens) {
      if (token.includes(queryToken) || (mode === 'fuzzy' && oneEditAway(token, queryToken))) {
        for (const id of ids) tokenMatches.add(id);
      }
    }
    matches = matches ? new Set([...matches].filter(id => tokenMatches.has(id))) : tokenMatches;
    if (!matches.size) return [];
  }
  return [...matches!].map(id => index.byId.get(id)!).sort((a, b) => {
    const an = index.names.get(a.id)!;
    const bn = index.names.get(b.id)!;
    return Number(bn.startsWith(normalized)) - Number(an.startsWith(normalized)) || an.localeCompare(bn);
  });
}
