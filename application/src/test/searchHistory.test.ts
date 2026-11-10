import { beforeEach, expect, it } from 'vitest';
import { SEARCH_HISTORY_MAX, clearSearchHistory, forgetSearch, readSearchHistory, rememberSearch } from '@/utils/searchHistory';

const KEY = 'cedplay_search_history';

beforeEach(() => localStorage.clear());

it('garde la requête la plus récente en tête et supprime les doublons', () => {
  rememberSearch('miserables');
  rememberSearch('Netflix');
  rememberSearch('MISERABLES');
  expect(readSearchHistory()).toEqual(['MISERABLES', 'Netflix']);
});

it('ignore les requêtes d’un seul caractère et les entrées illisibles', () => {
  rememberSearch(' a ');
  localStorage.setItem(KEY, JSON.stringify(['ok', 42, null, ' ', 'x']));
  expect(readSearchHistory()).toEqual(['ok']);
  localStorage.setItem(KEY, '{pas du json');
  expect(readSearchHistory()).toEqual([]);
});

it('plafonne l’historique', () => {
  for (let i = 0; i < SEARCH_HISTORY_MAX + 4; i += 1) rememberSearch(`requête ${i}`);
  const history = readSearchHistory();
  expect(history).toHaveLength(SEARCH_HISTORY_MAX);
  expect(history[0]).toBe(`requête ${SEARCH_HISTORY_MAX + 3}`);
});

it('retire une entrée, ou tout l’historique', () => {
  rememberSearch('arte');
  rememberSearch('canal');
  expect(forgetSearch('ARTE')).toEqual(['canal']);
  expect(clearSearchHistory()).toEqual([]);
  expect(readSearchHistory()).toEqual([]);
});
