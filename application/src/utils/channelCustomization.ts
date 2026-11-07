import { getMeta, setMeta } from '@/utils/idb';
import type { Channel, ChannelGroup } from '@/types/channel';

/**
 * Personnalisation d'une liste, sans toucher à la liste source : nom, logo et numéro
 * d'une chaîne, ordre des groupes et ordre des chaînes dans un groupe. Le guide reste
 * associé par l'id de la chaîne : un renommage ne le casse pas.
 */
export interface ChannelEdit {
  name?: string;
  logo?: string;
  /** Numéro de télécommande choisi (remplace tvg-chno). */
  chno?: string;
}

export interface ListCustomization {
  edits: Record<string, ChannelEdit>;
  /** Ordre choisi des groupes ; absent = ordre alphabétique. */
  groupOrder?: string[];
  /** Ordre choisi des chaînes, par nom de groupe (ids). */
  channelOrder?: Record<string, string[]>;
}

export const EMPTY_CUSTOMIZATION: ListCustomization = { edits: {} };
const storageKey = (playlistId: string) => `listCustomization:${playlistId}`;

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
export const cleanNumber = (value: unknown) => {
  const text = cleanText(value, 9);
  return /^\d{1,9}$/.test(text) && Number(text) > 0 ? String(Number(text)) : '';
};
const stringList = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** Une modification vide (tous les champs effacés) n'est pas gardée. */
export function cleanEdit(edit: ChannelEdit | undefined): ChannelEdit | null {
  if (!edit) return null;
  const name = cleanText(edit.name, 120);
  const logo = cleanText(edit.logo, 2000);
  const chno = cleanNumber(edit.chno);
  const out: ChannelEdit = {};
  if (name) out.name = name;
  if (logo && /^(https?:|data:image\/)/i.test(logo)) out.logo = logo;
  if (chno) out.chno = chno;
  return Object.keys(out).length ? out : null;
}

export function sanitizeCustomization(raw: unknown): ListCustomization {
  if (!raw || typeof raw !== 'object') return { edits: {} };
  const source = raw as Partial<Record<keyof ListCustomization, unknown>>;
  const edits: Record<string, ChannelEdit> = {};
  if (source.edits && typeof source.edits === 'object') {
    for (const [id, edit] of Object.entries(source.edits as Record<string, ChannelEdit>)) {
      const clean = cleanEdit(edit);
      if (clean) edits[id] = clean;
    }
  }
  const out: ListCustomization = { edits };
  const groupOrder = stringList(source.groupOrder);
  if (groupOrder.length) out.groupOrder = [...new Set(groupOrder)];
  if (source.channelOrder && typeof source.channelOrder === 'object') {
    const orders: Record<string, string[]> = {};
    for (const [group, ids] of Object.entries(source.channelOrder as Record<string, unknown>)) {
      const list = [...new Set(stringList(ids))];
      if (list.length) orders[group] = list;
    }
    if (Object.keys(orders).length) out.channelOrder = orders;
  }
  return out;
}

export async function loadCustomization(playlistId: string): Promise<ListCustomization> {
  try { return sanitizeCustomization(await getMeta<unknown>(storageKey(playlistId))); }
  catch { return { edits: {} }; }
}

export async function saveCustomization(playlistId: string, value: ListCustomization): Promise<ListCustomization> {
  const clean = sanitizeCustomization(value);
  await setMeta(storageKey(playlistId), clean);
  return clean;
}

export function applyEdit(channel: Channel, edit: ChannelEdit | undefined): Channel {
  if (!edit) return channel;
  return {
    ...channel,
    ...(edit.name ? { name: edit.name } : {}),
    ...(edit.logo ? { logo: edit.logo } : {}),
    ...(edit.chno ? { chno: edit.chno } : {}),
  };
}

/** Trie selon un ordre choisi ; les éléments absents de l'ordre suivent, dans leur ordre d'origine. */
function orderBy<T>(items: T[], order: string[] | undefined, keyOf: (item: T) => string, fallback?: (a: T, b: T) => number): T[] {
  if (!order?.length) return fallback ? [...items].sort(fallback) : items;
  const rank = new Map(order.map((k, i) => [k, i]));
  const listed = items.filter(i => rank.has(keyOf(i))).sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
  const rest = items.filter(i => !rank.has(keyOf(i)));
  return [...listed, ...(fallback ? rest.sort(fallback) : rest)];
}

export const byGroupName = (a: ChannelGroup, b: ChannelGroup) => a.name.localeCompare(b.name, 'fr');

/**
 * Groupes affichés après personnalisation. Sans ordre de groupes choisi, l'ordre
 * d'origine est conservé (l'affichage les trie alors par nom, comme avant).
 */
export function applyCustomization(groups: ChannelGroup[], custom: ListCustomization): ChannelGroup[] {
  const hasEdits = Object.keys(custom.edits).length > 0;
  const orders = custom.channelOrder;
  if (!hasEdits && !orders && !custom.groupOrder) return groups;
  const mapped = groups.map(group => {
    const order = orders?.[group.name];
    if (!hasEdits && !order) return group;
    const edited = hasEdits ? group.channels.map(c => applyEdit(c, custom.edits[c.id])) : group.channels;
    return { ...group, channels: orderBy(edited, order, c => c.id) };
  });
  return custom.groupOrder ? orderBy(mapped, custom.groupOrder, g => g.name, byGroupName) : mapped;
}

/** Ordre d'affichage des groupes : choisi, sinon alphabétique. */
export function displayGroupOrder(groups: ChannelGroup[], custom: ListCustomization): ChannelGroup[] {
  return orderBy(groups, custom.groupOrder, g => g.name, byGroupName);
}

/** Déplace un élément d'une case (delta -1 / +1) ou en tête (delta = -Infinity). */
export function moveInList<T>(list: T[], index: number, delta: number): T[] {
  const target = delta === -Infinity ? 0 : index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length || target === index) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

/** Numérote les chaînes d'un groupe à partir de `first`, dans l'ordre affiché. */
export function numberChannels(custom: ListCustomization, channelIds: string[], first: number): ListCustomization {
  const edits = { ...custom.edits };
  channelIds.forEach((id, i) => { edits[id] = { ...edits[id], chno: String(first + i) }; });
  return { ...custom, edits };
}

/** Numéros attribués deux fois (le premier dans l'ordre gagne au zapping). */
export function duplicateNumbers(channels: Channel[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of channels) {
    const n = cleanNumber(c.chno);
    if (!n) continue;
    if (seen.has(n)) dup.add(n); else seen.add(n);
  }
  return dup;
}
