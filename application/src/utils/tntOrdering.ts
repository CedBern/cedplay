import type { Channel, ChannelGroup } from '@/types/channel';

/**
 * Ordre d'affichage « comme sur la TNT » pour les listes de chaînes :
 * - les groupes français passent en tête de liste ;
 * - les généralistes françaises sont numérotées dans l'ordre de la TNT
 *   (numérotation Arcom en vigueur depuis le 6 juin 2025) : 1. TF1, 2. France 2… ;
 * - pour la discrétion, les noms commençant par un symbole (ponctuation, emoji)
 *   sont classés après le z, au lieu de remonter en tête de l'ordre alphabétique ;
 * - les groupes adultes (Adulte, XXX, +18…) passent après tout le reste, toujours.
 * Tout est dérivé du nom affiché : aucune donnée enregistrée n'est réécrite.
 */

/** Numérotation TNT française en vigueur depuis le 6 juin 2025 (Arcom). */
const TNT_FR: Array<{ num: number; test: RegExp }> = [
  // TF1 Séries Films avant TF1 : le préfixe le plus long d'abord.
  { num: 20, test: /^tf1 ?series ?films/ },
  { num: 1, test: /^tf1(?![a-z0-9])/ },
  { num: 2, test: /^france[ .·:_|-]*2(?![0-9])/ },
  { num: 3, test: /^france[ .·:_|-]*3(?![0-9])/ },
  { num: 4, test: /^france[ .·:_|-]*4(?![0-9])/ },
  { num: 5, test: /^france[ .·:_|-]*5(?![0-9])/ },
  { num: 6, test: /^m6(?: inter)?(?: (?:sd|hd|fhd|uhd|4k|8k|50fps|60fps))*(?: \(ts\))?$/ },
  { num: 7, test: /^arte(?![a-z0-9])/ },
  { num: 8, test: /^(lcp|public ?senat)(?![a-z0-9])/ },
  { num: 9, test: /^w9(?![a-z0-9])/ },
  { num: 10, test: /^tmc(?![a-z0-9])/ },
  { num: 11, test: /^tfx(?![a-z0-9])/ },
  { num: 12, test: /^gulli(?! ?max)(?![a-z0-9])/ },
  { num: 13, test: /^bfm ?tv(?![a-z0-9])/ },
  { num: 14, test: /^c ?news(?![a-z0-9])/ },
  { num: 15, test: /^lci(?![a-z0-9])/ },
  { num: 16, test: /^france[ .·:_|-]*info/ },
  { num: 17, test: /^c ?star(?: (?:sd|hd|fhd|uhd|4k|8k|50fps|60fps))*(?: \(ts\))?$/ },
  { num: 18, test: /^t18(?![a-z0-9])/ },
  { num: 19, test: /^novo ?19(?![a-z0-9])/ },
  { num: 21, test: /^l ?'? ?equipe(?![a-z0-9])/ },
  { num: 22, test: /^6 ?ter(?![a-z0-9])/ },
  { num: 23, test: /^rmc ?story(?![a-z0-9])/ },
  { num: 24, test: /^rmc ?decouverte(?![a-z0-9])/ },
  { num: 25, test: /^cherie ?25(?![a-z0-9])/ },
];

const stripAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizeName = (value: string) => stripAccents(value.toLowerCase()).replace(/\s+/g, ' ').trim();

/** Un nom qui commence par un symbole (ponctuation, emoji) plutôt que par une lettre ou un chiffre. */
const LEADING_SYMBOL = /^[^\p{L}\p{N}]/u;
export const symbolLedName = (name: string) => LEADING_SYMBOL.test(name.trim());

/** Numéro TNT d'une chaîne d'après son nom, ou null. Les noms commençant par un symbole
 * ou déjà numérotés (« 1. TF1 ») ne sont pas renumérotés. */
export function tntNumberFor(name: string): number | null {
  const trimmed = name.trim();
  if (!trimmed || symbolLedName(trimmed) || /^\d{1,2}[.)] /.test(trimmed)) return null;
  const normalized = normalizeName(trimmed);
  for (const entry of TNT_FR) if (entry.test.test(normalized)) return entry.num;
  // Étiquette de pays en préfixe (« FR | TF1 », « French - M6 »), sans toucher à « France 2 ».
  const stripped = normalized.replace(/^(fr|french)[ .·:_|>-]+/, '');
  if (stripped !== normalized) {
    for (const entry of TNT_FR) if (entry.test.test(stripped)) return entry.num;
  }
  return null;
}

/** Nom affiché : numéro TNT devant les généralistes françaises (« 1. TF1 »). */
export function tntDisplayName(name: string): string {
  const num = tntNumberFor(name);
  return num ? `${num}. ${name.trim()}` : name;
}

/** Groupes de chaînes français : FR, France, French, français, généralistes, TNT… */
const FRENCH_GROUP = /^(fr\b|fr[ .·:_|>-]|france|french|francais|generalistes?|tnt(?![a-z0-9]))/;
export const isFrenchGroupName = (name: string) => FRENCH_GROUP.test(normalizeName(name));

const FRENCH_RANK = 0;
const ALPHA_RANK = 1_000_000;
const SYMBOL_RANK = 2_000_000;
const ADULT_RANK = 3_000_000;

/** Groupes adultes : tout à la fin de la liste, après les symboles, pour la discrétion. */
const ADULT_GROUP = /(?:^| )(adultes?|adults?|pornos?|porn|xxx|erotiques?|\+18|18\+)(?:$| )/;
const isAdultGroupName = (name: string) => ADULT_GROUP.test(normalizeName(name));

function channelRank(name: string): number {
  const trimmed = name.trim();
  if (symbolLedName(trimmed)) return SYMBOL_RANK;
  return tntNumberFor(trimmed) ?? ALPHA_RANK;
}

/** Ordre des chaînes : généralistes TNT d'abord (1 → 25), puis A–Z, symboles après le z. */
export function compareChannelNames(a: string, b: string): number {
  const rank = channelRank(a) - channelRank(b);
  if (rank) return rank;
  return a.trim().localeCompare(b.trim(), 'fr', { numeric: true, sensitivity: 'base' });
}

function groupRank(name: string): number {
  if (isAdultGroupName(name)) return ADULT_RANK;
  if (symbolLedName(name)) return SYMBOL_RANK;
  return isFrenchGroupName(name) ? FRENCH_RANK : ALPHA_RANK;
}

/** Ordre des groupes : français en tête, puis A–Z, symboles après le z. */
export function compareGroupNames(a: string, b: string): number {
  const rank = groupRank(a) - groupRank(b);
  if (rank) return rank;
  return a.trim().localeCompare(b.trim(), 'fr', { numeric: true, sensitivity: 'base' });
}

interface OrderGuard {
  channelOrder?: Record<string, string[]> | undefined;
  channelSort?: 'name' | undefined;
}

function isProviderSectionTitle(name: string): boolean {
  const title = normalizeName(name).replace(/^(fr|french)(?:\s+-\s+|[ .·:_|>]+)/, '');
  return /^[-_=*]{2,}\s*[^\s].*[-_=*]{2,}$/.test(title);
}

/** Dans un groupe français sans ordre personnalisé, les généralistes TNT passent en tête
 * (1 → 25) et le reste du groupe conserve son ordre d'origine. Le tri A–Z (déjà TNT via
 * le comparateur) et l'ordre choisi dans Organiser priment. Les titres de section du
 * fournisseur délimitent les chaînes qui peuvent être réordonnées ensemble. */
export function orderFrenchGroupsForTnt(groups: ChannelGroup[], custom?: OrderGuard | undefined): ChannelGroup[] {
  if (custom?.channelSort === 'name') return groups;
  return groups.map(group => {
    if (!isFrenchGroupName(group.name) || custom?.channelOrder?.[group.name]?.length) return group;
    let numbered: Array<{ channel: Channel; num: number }> = [];
    let rest: Channel[] = [];
    const ordered: Channel[] = [];
    let hasNumbered = false;
    const flushSection = () => {
      numbered.sort((x, y) => x.num - y.num || x.channel.name.localeCompare(y.channel.name, 'fr', { numeric: true, sensitivity: 'base' }));
      ordered.push(...numbered.map(entry => entry.channel), ...rest);
      numbered = [];
      rest = [];
    };
    for (const channel of group.channels) {
      if (isProviderSectionTitle(channel.name)) {
        flushSection();
        ordered.push(channel);
        continue;
      }
      const num = symbolLedName(channel.name) ? null : tntNumberFor(channel.name);
      if (num) {
        hasNumbered = true;
        numbered.push({ channel, num });
      } else rest.push(channel);
    }
    if (!hasNumbered) return group;
    flushSection();
    return { ...group, channels: ordered };
  });
}
