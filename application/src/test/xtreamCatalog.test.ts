import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRequest, fetchXtreamLimits, getXtreamAccount, parseCatalog, parseCategories, parseDetails, readCachedLimits, readVodProgress, saveVodProgress, vodUrl } from '@/utils/xtreamCatalog';
import type { PlaylistInfo } from '@/types/channel';

const mocks = vi.hoisted(() => ({ native: false, get: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native }, CapacitorHttp: { get: mocks.get } }));
const account = { server: 'https://provider.test:8080', username: 'a user', password: 'p/a?ss' };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); mocks.native = false; });

describe('Catalogues Xtream', () => {
  it('normalise les identifiants numériques, illustrations et formats en rejetant les entrées invalides', () => {
    expect(parseCategories([{ category_id: 2, category_name: 'France' }, { category_id: '../../' }])).toEqual([{ id: '2', name: 'France' }]);
    const movies = parseCatalog([{ stream_id: 12, name: 'Film', category_id: 2, container_extension: 'MKV', stream_icon: 'javascript:alert(1)' }, { stream_id: 'bad' }], 'movie');
    expect(movies).toHaveLength(1);
    expect(movies[0]).toMatchObject({ id: '12', extension: 'mkv', poster: '', categoryId: '2' });
    expect(parseCatalog([{ series_id: '19', name: 'Série', cover: 'https://images.test/cover.jpg' }], 'series')[0]?.id).toBe('19');
    expect(() => parseCatalog({ user_info: { auth: 0 } }, 'movie')).toThrow();
  });
  it('tolère les fiches incomplètes, trie les saisons et conserve les épisodes lisibles', () => {
    const data = parseDetails({ info: { plot: 'Synopsis', releasedate: '2025' }, movie_data: { container_extension: 'mp4' }, episodes: { 2: [{ id: 30, title: 'Suite', episode_num: 2, container_extension: 'mkv' }], 1: [{ id: 10, title: 'Pilote', episode_num: 1, container_extension: 'mp4' }, { title: 'Sans id' }] } });
    expect(data.episodes.map(e => e.id)).toEqual(['10', '30']);
    expect(data.episodes[0]?.season).toBe('1');
    expect(data.extension).toBe('mp4');
    expect(parseDetails({}).episodes).toEqual([]);
  });
  it('construit les chemins films et épisodes sans confondre caractères de mot de passe et URL', () => {
    expect(vodUrl(account, 'movie', '12', 'MP4')).toBe('https://provider.test:8080/movie/a%20user/p%2Fa%3Fss/12.mp4');
    expect(vodUrl(account, 'series', '13', 'mkv')).toContain('/series/');
    expect(() => vodUrl(account, 'movie', '../12', 'mp4')).toThrow();
    expect(() => vodUrl(account, 'movie', '12', '')).toThrow();
  });
  it('ne rattache pas les anciens identifiants à une autre liste ou un autre serveur', () => {
    localStorage.setItem('xtream_last_server', account.server); localStorage.setItem('xtream_last_user', account.username); localStorage.setItem('xtream_last_pass', account.password);
    const playlist: PlaylistInfo = { id: 'p', name: `Xtream: ${account.username}`, groups: [], channels: [{ id: 'c', name: 'C', url: `${account.server}/live/a%20user/p%2Fa%3Fss/1.ts` }] };
    expect(getXtreamAccount(playlist)).toEqual(account);
    expect(getXtreamAccount({ ...playlist, name: 'Liste restaurée' })).toEqual(account);
    expect(getXtreamAccount({ ...playlist, channels: [{ id: 'x', name: 'X', url: 'https://other.test/live/a/1.ts' }] })).toBeNull();
  });
  it('retrouve un compte dans une liste restaurée sans identifiants globaux et refuse une liste multicomptes', () => {
    const playlist: PlaylistInfo = { id: 'restored', name: 'Restauration', groups: [], channels: [{ id: '1', name: 'A', url: 'https://provider.test/live/user/password/1.m3u8' }] };
    expect(getXtreamAccount(playlist)).toEqual({ server: 'https://provider.test', username: 'user', password: 'password' });
    expect(getXtreamAccount({ ...playlist, channels: [...playlist.channels, { id: '2', name: 'B', url: 'https://provider.test/live/other/password/2.ts' }] })).toBeNull();
  });
  it('ne prend pas une liste publique pour un abonnement à cause de quelques adresses en /live/', () => {
    const free = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `Libre ${i}`, url: `https://cdn${i}.test/chaine/index.m3u8` }));
    const lookalike = [31, 49, 13].map(n => ({ id: `s${n}`, name: `S ${n}`, url: `http://tv.streambox.test/live/demo/demo/${n}.m3u8` }));
    const playlist: PlaylistInfo = { id: 'cedplay-public-v1', name: 'Chaînes gratuites', groups: [], channels: [...free, ...lookalike] };
    expect(getXtreamAccount(playlist)).toBeNull();
  });
  it('utilise HTTP natif sur Android, masque les erreurs privées et ignore les retours annulés', async () => {
    mocks.native = true;
    mocks.get.mockResolvedValue({ status: 200, data: [{ category_id: '1' }] });
    expect(await catalogRequest(account, 'get_vod_categories')).toEqual([{ category_id: '1' }]);
    mocks.get.mockRejectedValue(new Error('https://private/password'));
    await expect(catalogRequest(account, 'get_vod_categories')).rejects.toThrow('Catalogue indisponible');
    const controller = new AbortController(); controller.abort();
    mocks.get.mockResolvedValue({ status: 200, data: [] });
    await expect(catalogRequest(account, 'get_series', {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('garde une reprise et efface un titre achevé sans partager les positions entre comptes', () => {
    saveVodProgress('p:movie:1', 125000, 3600000);
    expect(readVodProgress('p:movie:1')?.positionMs).toBe(125000);
    expect(readVodProgress('other:movie:1')).toBeNull();
    saveVodProgress('p:movie:1', 3590000, 3600000);
    expect(readVodProgress('p:movie:1')).toBeNull();
    saveVodProgress('p:movie:1', NaN, 0);
    expect(readVodProgress('p:movie:1')).toBeNull();
  });
  it('lit les limites du compte, les met en cache et traite 0 comme inconnu', async () => {
    mocks.native = true;
    mocks.get.mockResolvedValue({ status: 200, data: { user_info: { auth: 1, max_connections: '3', active_cons: 1 } } });
    expect(await fetchXtreamLimits('pl', account)).toMatchObject({ maxConnections: 3, activeCons: 1 });
    expect(readCachedLimits('pl')).toMatchObject({ maxConnections: 3, activeCons: 1 });
    // 0 = illimité / non renseigné chez la plupart des panneaux : inconnu, jamais d'avertissement à tort.
    mocks.get.mockResolvedValue({ status: 200, data: { user_info: { auth: 1, max_connections: 0 } } });
    const unlimited = await fetchXtreamLimits('pl2', account);
    expect(unlimited.maxConnections).toBeNull();
    expect(unlimited.activeCons).toBeNull();
    expect(readCachedLimits('inconnu')).toBeNull();
    localStorage.setItem('cedplay.xtreamLimits:corrompu', '{oops');
    expect(readCachedLimits('corrompu')).toBeNull();
  });

  it('distingue des identifiants refusés d’une panne réseau', async () => {
    mocks.native = true;
    mocks.get.mockResolvedValue({ status: 200, data: { user_info: { auth: 0 } } });
    await expect(catalogRequest(account, 'get_vod_categories')).rejects.toThrow('Identifiants refusés ou abonnement expiré');
  });

  it('borne une requête web muette au lieu d’attendre indéfiniment', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const pending = catalogRequest(account, 'get_vod_categories');
    const rejected = expect(pending).rejects.toThrow('délai dépassé');
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

 it.each([1, 2, 3])('inférence : exige une majorité stricte (%i flux Xtream sur quatre)', count => {
  const channels = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: 'Test', url: i < count ? `https://provider.test/live/user/password/${i}.ts` : `https://free.test/${i}.m3u8` }));
  const result = getXtreamAccount({ id: 'mixed', name: 'Mixte', groups: [], channels });
  expect(result).toEqual(count > 2 ? { server: 'https://provider.test', username: 'user', password: 'password' } : null);
});
it('un compte explicitement enregistré reste prioritaire dans une liste mixte', () => {
  localStorage.setItem('xtream_account_linked', JSON.stringify(account));
  expect(getXtreamAccount({ id: 'linked', name: 'Mixte', groups: [], channels: [{ id: 'free', name: 'Libre', url: 'https://free.test/live.m3u8' }] })).toEqual(account);
});
