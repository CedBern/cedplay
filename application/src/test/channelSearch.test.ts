import { describe, expect, it } from 'vitest';
import { createSearchIndex, searchChannels } from '@/utils/channelSearch';
const channels = [
  { id: 'a', name: 'Télé Québec', group: 'Canada', url: 'https://example.test/a' },
  { id: 'b', name: 'Ciné Monde', group: 'Films', url: 'https://example.test/b' },
  { id: 'c', name: '東京テレビ', group: '日本', url: 'https://example.test/c' },
];
const index = createSearchIndex(channels);
describe('Recherche dans les grandes listes', () => {
  it('recherche une portion de mot, plusieurs mots et les noms de groupes', () => {
    expect(searchChannels(index, 'tele que', 'precise').map(c => c.id)).toEqual(['a']);
    expect(searchChannels(index, 'films', 'precise').map(c => c.id)).toEqual(['b']);
    expect(searchChannels(index, 'tele films', 'precise')).toEqual([]);
  });
  it('conserve les alphabets non latins et ignore les accents', () => {
    expect(searchChannels(index, '日本', 'precise').map(c => c.id)).toEqual(['c']);
    expect(searchChannels(index, 'cine', 'precise').map(c => c.id)).toEqual(['b']);
  });
  it('tolère une faute en mode approché, sans l’étendre au mode précis', () => {
    expect(searchChannels(index, 'quebecx', 'precise')).toEqual([]);
    expect(searchChannels(index, 'quebecx', 'fuzzy').map(c => c.id)).toEqual(['a']);
    expect(searchChannels(index, 'zzzz', 'fuzzy')).toEqual([]);
  });
});
