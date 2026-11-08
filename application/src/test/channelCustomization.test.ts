import { describe, expect, it } from 'vitest';
import {
  applyCustomization, cleanEdit, displayGroupOrder, duplicateNumbers, moveInList, numberChannels, sanitizeCustomization,
} from '@/utils/channelCustomization';
import { channelNumbering, findChannelByNumber } from '@/utils/nativePlayer';
import type { ChannelGroup } from '@/types/channel';

const ch = (id: string, group: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), url: `http://h.test/${id}`, group, ...extra });
const groups: ChannelGroup[] = [
  { name: 'Sport', channels: [ch('s1', 'Sport'), ch('s2', 'Sport'), ch('s3', 'Sport')] },
  { name: 'Info', channels: [ch('i1', 'Info', { chno: '15' })] },
  { name: 'Cinéma', channels: [ch('c1', 'Cinéma')] },
];

describe('personnalisation de la liste', () => {
  it('conserve le tri A–Z au rechargement et inclut les nouvelles chaînes sans modifier la source', () => {
    const source = [{ name: 'Test', channels: [ch('z', 'Test', { name: 'Zulu' }), ch('a10', 'Test', { name: 'Alpha 10' }), ch('a2', 'Test', { name: 'Alpha 2' })] }];
    const custom = sanitizeCustomization(JSON.parse(JSON.stringify({ edits: {}, channelSort: 'name', channelOrder: { Test: ['z', 'a10'] } })));
    expect(custom.channelSort).toBe('name');
    const updated = [...source[0].channels, ch('e', 'Test', { name: 'Éclair' })];
    const sorted = applyCustomization([{ name: 'Test', channels: updated }], custom)[0].channels;
    expect(sorted.map(c => c.id)).toEqual(['a2', 'a10', 'e', 'z']);
    expect(source[0].channels.map(c => c.id)).toEqual(['z', 'a10', 'a2']);
    expect(sorted.find(c => c.id === 'z')?.url).toBe(source[0].channels[0].url);
  });
  it('sans réglage, renvoie les groupes d’origine (même référence)', () => {
    expect(applyCustomization(groups, { edits: {} })).toBe(groups);
  });

  it('renomme, change le logo et le numéro sans toucher à l’id ni à l’adresse', () => {
    const out = applyCustomization(groups, { edits: { i1: { name: 'France Info', logo: 'https://l.test/fi.png', chno: '27' } } });
    const info = out.find(g => g.name === 'Info')!.channels[0]!;
    expect(info).toMatchObject({ id: 'i1', url: 'http://h.test/i1', name: 'France Info', logo: 'https://l.test/fi.png', chno: '27' });
    // La liste d'origine n'est pas modifiée.
    expect(groups[1]!.channels[0]!.name).toBe('I1');
  });

  it('applique l’ordre des chaînes d’un groupe ; les chaînes absentes de l’ordre suivent', () => {
    const out = applyCustomization(groups, { edits: {}, channelOrder: { Sport: ['s3', 's1'] } });
    expect(out[0]!.channels.map(c => c.id)).toEqual(['s3', 's1', 's2']);
  });

  it('applique l’ordre des groupes ; un groupe nouveau arrive à la fin, par ordre alphabétique', () => {
    const out = applyCustomization(groups, { edits: {}, groupOrder: ['Info', 'Sport'] });
    expect(out.map(g => g.name)).toEqual(['Info', 'Sport', 'Cinéma']);
    expect(displayGroupOrder(groups, { edits: {} }).map(g => g.name)).toEqual(['Cinéma', 'Info', 'Sport']);
  });

  it('numérote un groupe et le zapping numérique suit ces numéros', () => {
    const custom = numberChannels({ edits: {} }, ['s1', 's2', 's3'], 101);
    const flat = applyCustomization(groups, custom).flatMap(g => g.channels);
    expect(flat.slice(0, 3).map(c => c.chno)).toEqual(['101', '102', '103']);
    expect(findChannelByNumber(flat, '102')?.id).toBe('s2');
    expect(channelNumbering(flat).numbers[3]).toBe('15');
  });

  it('repère les numéros attribués deux fois', () => {
    expect([...duplicateNumbers([ch('a', 'x', { chno: '5' }), ch('b', 'x', { chno: '005' }), ch('c', 'x', { chno: '6' })])]).toEqual(['5']);
  });

  it('nettoie les données relues : champs vides, logo non http, numéro invalide', () => {
    expect(cleanEdit({ name: '  ', logo: 'javascript:alert(1)', chno: 'abc' })).toBeNull();
    expect(cleanEdit({ chno: '007' })).toEqual({ chno: '7' });
    const clean = sanitizeCustomization({ edits: { a: { name: ' A ' }, b: { name: '' } }, groupOrder: ['x', 'x', 3], channelOrder: { g: 'pas une liste' } });
    expect(clean).toEqual({ edits: { a: { name: 'A' } }, groupOrder: ['x'] });
    expect(sanitizeCustomization(null)).toEqual({ edits: {} });
  });

  it('déplace un élément d’une case ou en tête, sans sortir des bornes', () => {
    expect(moveInList(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveInList(['a', 'b', 'c'], 2, -Infinity)).toEqual(['c', 'a', 'b']);
    const same = ['a', 'b'];
    expect(moveInList(same, 0, -1)).toBe(same);
  });
});
