import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistInfo } from '@/types/channel';
import { buildLiveChannel, canRefreshPlaylist, downloadXtreamLive, fetchLiveChannels, isXtreamLiveImport, readLiveSelection, saveLiveSelection } from '@/utils/xtreamLive';

vi.mock('@/utils/proxy', () => ({ getProxyBase: () => 'http://relais.test' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

const account = { server: 'http://serveur.test:8080', username: 'user', password: 'pass' };
const fetchMock = vi.fn();
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

/** Fournisseur simulé : catégories et chaînes par catégorie (null = catégorie en échec). */
function provider(categories: Array<[string, string]>, streams: Record<string, Array<[number, string]> | null>) {
  fetchMock.mockImplementation(async (url: unknown) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/xtream/categories')) return json(categories.map(([category_id, category_name]) => ({ category_id, category_name })));
    const list = streams[u.searchParams.get('category_id') ?? ''];
    return list ? json(list.map(([stream_id, name]) => ({ stream_id, name }))) : json({ error: 'x' }, false);
  });
}

function xtreamPlaylist(id: string, groups: Record<string, Array<[number, string]>>, format: 'm3u8' | 'ts' = 'm3u8'): PlaylistInfo {
  const all = Object.entries(groups).map(([name, list]) => ({
    name, channels: list.map(([sid, title]) => buildLiveChannel(account, { stream_id: sid, name: title }, name, format)),
  }));
  return { id, name: 'Xtream: user', channels: all.flatMap(g => g.channels), groups: all };
}

beforeEach(() => { localStorage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('Numérotation Xtream', () => {
  it('reprend le numéro du fournisseur (num) comme numéro de chaîne, ignore 0 et absence', () => {
    const withNum = buildLiveChannel(account, { stream_id: 10, name: 'Info 1', num: 42, stream_icon: 'http://i.test/a.png' }, 'FR | Info', 'm3u8');
    expect(withNum.chno).toBe('42');
    expect(withNum.logo).toBe('http://i.test/a.png');
    const zero = buildLiveChannel(account, { stream_id: 11, name: 'Info 2', num: 0 }, 'FR | Info', 'm3u8');
    expect(zero.chno).toBeUndefined();
    const none = buildLiveChannel(account, { stream_id: 12, name: 'Info 3' }, 'FR | Info', 'm3u8');
    expect(none.chno).toBeUndefined();
  });
});

describe('Actualisation des listes Xtream', () => {
  it('reprend les catégories choisies à l\'import, avec les mêmes identifiants de chaînes', async () => {
    const before = xtreamPlaylist('p1', { 'FR | Info': [[10, 'Info 1']] });
    saveLiveSelection('p1', { categoryIds: ['1'], format: 'm3u8' });
    provider([['1', 'FR | Info'], ['2', 'UK']], { '1': [[10, 'Info 1 HD'], [11, 'Info 2']], '2': [[20, 'BBC']] });

    const fresh = await downloadXtreamLive(before, account);
    expect(fresh.channels.map(c => c.name)).toEqual(['Info 1 HD', 'Info 2']);
    expect(fresh.channels[0].id).toBe(before.channels[0].id);
    expect(fresh.channels[0].url).toBe('http://serveur.test:8080/live/user/pass/10.m3u8');
    expect(fresh.groups.map(g => g.name)).toEqual(['FR | Info']);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('category_id=2'));
  });

  it('retrouve les catégories par le nom des groupes pour une liste importée avant, et mémorise le choix', async () => {
    const before = xtreamPlaylist('p1', { Sport: [[1, 'A'], [2, 'B']], Info: [[3, 'C']] }, 'ts');
    provider([['7', 'Info'], ['8', 'Sport'], ['9', 'Adultes']], { '7': [[3, 'C']], '8': [[1, 'A'], [2, 'B']], '9': [[5, 'X']] });

    const fresh = await downloadXtreamLive(before, account);
    expect(fresh.channels).toHaveLength(3);
    expect(fresh.channels.every(c => c.url.endsWith('.ts'))).toBe(true);
    expect(readLiveSelection('p1')).toEqual({ categoryIds: ['7', '8'], format: 'ts' });
  });

  it('garde l\'ancienne liste si une catégorie ne répond pas', async () => {
    const before = xtreamPlaylist('p1', { Sport: [[1, 'A']], Info: [[3, 'C']] });
    saveLiveSelection('p1', { categoryIds: ['7', '8'], format: 'm3u8' });
    provider([['7', 'Info'], ['8', 'Sport']], { '7': [[3, 'C']], '8': null });
    await expect(downloadXtreamLive(before, account)).rejects.toThrow('sans réponse');
  });

  it('refuse un appariement par nom qui ferait fondre la liste', async () => {
    const before = xtreamPlaylist('p1', { Sport: [[1, 'A'], [2, 'B'], [4, 'D']], Info: [[3, 'C']] });
    provider([['7', 'Info']], { '7': [[3, 'C']] });
    await expect(downloadXtreamLive(before, account)).rejects.toThrow('trop différente');
    expect(readLiveSelection('p1')).toBeNull();
  });

  it('garde l’ancienne liste si le fournisseur renvoie une liste tronquée, même avec des catégories mémorisées', async () => {
    const before = xtreamPlaylist('p1', { Info: Array.from({ length: 10 }, (_, i): [number, string] => [i + 1, `C${i + 1}`]) });
    saveLiveSelection('p1', { categoryIds: ['7'], format: 'm3u8' });
    provider([['7', 'Info']], { '7': [[1, 'C1'], [2, 'C2']] });
    await expect(downloadXtreamLive(before, account)).rejects.toThrow('2 chaînes au lieu de 10');
  });

  it('garde l’ancienne liste si une catégorie mémorisée a disparu chez le fournisseur', async () => {
    const before = xtreamPlaylist('p1', { Sport: [[1, 'A']], Info: [[3, 'C']] });
    saveLiveSelection('p1', { categoryIds: ['7', '8'], format: 'm3u8' });
    provider([['7', 'Info']], { '7': [[3, 'C']] });
    await expect(downloadXtreamLive(before, account)).rejects.toThrow('introuvable');
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('category_id='));
  });

  it('ne traite comme Xtream que les listes issues d\'une connexion', () => {
    const fromLogin = xtreamPlaylist('p1', { Info: [[3, 'C']] });
    expect(isXtreamLiveImport(fromLogin)).toBe(true);
    expect(canRefreshPlaylist(fromLogin)).toBe(true);
    const m3uFile = { ...fromLogin, id: 'p2', name: 'Mon fichier' };
    expect(isXtreamLiveImport(m3uFile)).toBe(false);
    expect(canRefreshPlaylist(m3uFile)).toBe(false);
    expect(canRefreshPlaylist({ ...m3uFile, url: 'https://example.test/liste.m3u' })).toBe(true);
    saveLiveSelection('p2', { categoryIds: ['1'], format: 'ts' });
    expect(isXtreamLiveImport(m3uFile)).toBe(true);
  });
});

describe('Annulation de l’import Xtream', () => {
  it('abandonne les requêtes en cours sans les compter comme catégories en échec', async () => {
    let calls = 0;
    fetchMock.mockImplementation((_url: unknown, init?: RequestInit) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const controller = new AbortController();
    const pending = fetchLiveChannels(account, [{ category_id: '1', category_name: 'FR' }], 'm3u8', undefined, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(calls).toBe(1);
  });
});
