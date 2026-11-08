import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  STALKER_MARK, connectPortal, downloadStalkerPlaylist, handshake, isStalkerUrl,
  normalizeMac, portalCandidates, stalkerAvailable, stalkerChannelUrl, stripCommand,
} from '@/utils/stalker';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
  CapacitorHttp: { get: vi.fn() },
}));

const get = vi.mocked(CapacitorHttp.get);
const isNative = vi.mocked(Capacitor.isNativePlatform);

/** Réponse CapacitorHttp minimale. */
const reply = (data: unknown, status = 200) => ({ status, data } as never);
const jsReply = (js: unknown) => reply({ js });
const httpError = (status: number) => reply({ js: null }, status);

type Handler = (params: URLSearchParams) => unknown;

/** Route les appels du portail par « type/action », comme un vrai serveur. */
function serve(routes: Record<string, Handler>) {
  get.mockImplementation(async (options: { url: string }) => {
    const url = new URL(options.url);
    const handler = routes[`${url.searchParams.get('type')}/${url.searchParams.get('action')}`];
    if (!handler) return httpError(404);
    const value = handler(url.searchParams);
    if (value && typeof value === 'object' && 'status' in value) return value as never;
    return jsReply(value);
  });
}

const handshakeRoutes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  'stb/handshake': () => ({ token: 'jeton-1' }),
  'stb/get_profile': () => ({}),
  ...extra,
});

const account = { portal: 'http://portal.test/portal.php', mac: '00:1A:79:AA:BB:CC' };

beforeEach(() => {
  get.mockReset();
  isNative.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stalker — utilitaires', () => {
  it('normalise une adresse MAC dans les deux notations', () => {
    expect(normalizeMac('00-1a-79-aa-bb-cc')).toBe('00:1A:79:AA:BB:CC');
    expect(normalizeMac(' 001a79aabbcc ')).toBe('00:1A:79:AA:BB:CC');
    expect(normalizeMac('00:1A:79:12:34')).toBe('');
    expect(normalizeMac('pas une mac')).toBe('');
  });

  it('propose les adresses d’API du portail', () => {
    expect(portalCandidates('portal.test')).toEqual([
      'http://portal.test/portal.php',
      'http://portal.test/server/load.php',
      'http://portal.test/stalker_portal/server/load.php',
      'http://portal.test/portal.php',
    ].filter((url, index, all) => all.indexOf(url) === index));
    expect(portalCandidates('https://portal.test/stalker_portal/c/'))
      .toEqual(['https://portal.test/stalker_portal/server/load.php', 'https://portal.test/stalker_portal/portal.php', 'https://portal.test/portal.php']);
    expect(portalCandidates('https://portal.test/stalker_portal/c/load.php'))
      .toEqual(['https://portal.test/stalker_portal/c/load.php']);
    expect(portalCandidates('https://portal.test/portal.php')).toEqual(['https://portal.test/portal.php']);
    expect(portalCandidates('   ')).toEqual([]);
    expect(portalCandidates('ftp://portal.test')).toEqual([]);
  });

  it('retire le préfixe de commande sans toucher à l’adresse', () => {
    expect(stripCommand('ffmpeg http://cdn.test/1.ts')).toBe('http://cdn.test/1.ts');
    expect(stripCommand('http://cdn.test/1.ts')).toBe('http://cdn.test/1.ts');
    expect(stripCommand('  /media/1.ts  ')).toBe('/media/1.ts');
  });

  it('note l’adresse de la chaîne avec ses données de résolution', () => {
    const cmd = 'ffmpeg http://cdn.test:8080/live/1.ts?token=abc';
    const url = stalkerChannelUrl(account, cmd, '101');
    expect(url.startsWith('http://cdn.test:8080/live/1.ts?token=abc' + STALKER_MARK)).toBe(true);
    const encoded = url.slice(url.indexOf(STALKER_MARK) + STALKER_MARK.length);
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    expect(payload).toEqual({ p: account.portal, m: account.mac, c: cmd });
  });

  it('masque une adresse locale derrière l’adresse lisible du portail', () => {
    const url = stalkerChannelUrl(account, 'ffmpeg http://127.0.0.1/live/1.ts', 'ch 1');
    expect(url.startsWith('http://portal.test/stalker/ch%201')).toBe(true);
    expect(stalkerChannelUrl(account, 'sans adresse', '42').startsWith('http://portal.test/stalker/42')).toBe(true);
  });

  it('reconnaît une chaîne de portail', () => {
    expect(isStalkerUrl(`x${STALKER_MARK}y`)).toBe(true);
    expect(isStalkerUrl('http://cdn.test/1.ts')).toBe(false);
  });

  it('n’est disponible que dans l’application Android', () => {
    expect(stalkerAvailable()).toBe(true);
    isNative.mockReturnValue(false);
    expect(stalkerAvailable()).toBe(false);
  });
});

describe('stalker — connexion', () => {
  it('lit le jeton et tolère un profil refusé', async () => {
    serve({ 'stb/handshake': () => ({ token: 'jeton-1' }), 'stb/get_profile': () => httpError(500) });
    await expect(handshake(account)).resolves.toBe('jeton-1');
  });

  it('accepte une réponse texte contenant du JSON', async () => {
    serve({ 'stb/handshake': () => reply('{"js":{"token":"texte"}}'), 'stb/get_profile': () => ({}) });
    await expect(handshake(account)).resolves.toBe('texte');
  });

  it('signale un portail qui refuse la MAC', async () => {
    serve({ 'stb/handshake': () => httpError(401) });
    await expect(handshake(account)).rejects.toThrow('refuse cette adresse MAC');
  });

  it('signale une réponse illisible', async () => {
    serve({ 'stb/handshake': () => reply('<html>portail web</html>') });
    await expect(handshake(account)).rejects.toThrow('illisible');
  });

  it('signale un portail sans jeton', async () => {
    serve({ 'stb/handshake': () => ({}), 'stb/get_profile': () => ({}) });
    await expect(handshake(account)).rejects.toThrow('n’a pas accepté');
  });

  it('refuse la connexion hors Android et les adresses invalides', async () => {
    isNative.mockReturnValue(false);
    await expect(connectPortal('portal.test', '00:1A:79:AA:BB:CC')).rejects.toThrow('depuis l’application Android');
    isNative.mockReturnValue(true);
    await expect(connectPortal('portal.test', 'inconnue')).rejects.toThrow('Adresse MAC invalide');
    await expect(connectPortal('   ', '00:1A:79:AA:BB:CC')).rejects.toThrow('Adresse du portail invalide');
  });

  it('essaie les adresses suivantes quand la première refuse', async () => {
    serve({
      'stb/handshake': () => ({ token: 'jeton-1' }),
      'stb/get_profile': () => ({}),
    });
    get.mockImplementation(async (options: { url: string }) => {
      if (options.url.startsWith('http://portal.test/portal.php')) return httpError(401);
      return jsReply({ token: 'jeton-repli' });
    });
    const result = await connectPortal('portal.test', '00-1a-79-aa-bb-cc');
    expect(result.account.portal).toBe('http://portal.test/server/load.php');
    expect(result.account.mac).toBe('00:1A:79:AA:BB:CC');
    expect(result.token).toBe('jeton-repli');
  });

  it('remonte la dernière erreur quand toutes les adresses échouent', async () => {
    serve({ 'stb/handshake': () => httpError(503) });
    await expect(connectPortal('portal.test', '00:1A:79:AA:BB:CC')).rejects.toThrow('HTTP 503');
  });
});

describe('stalker — liste des chaînes', () => {
  it('range les chaînes par genre, déduplique et résout les logos', async () => {
    serve(handshakeRoutes({
      'itv/get_genres': () => [{ id: '1', title: 'Infos' }, { id: '2' }],
      'itv/get_all_channels': () => ({
        data: [
          { id: '101', name: ' TF1 ', number: '1', cmd: 'ffmpeg http://cdn.test/1.ts', logo: 'logos/tf1.png', tv_genre_id: '1' },
          { id: '102', name: 'Arte', cmd: 'ffmpeg http://cdn.test/2.ts', logo: 'http://img.test/arte.png', tv_genre_id: '2' },
          { id: '102', name: 'Doublon', cmd: 'ffmpeg http://cdn.test/2.ts' },
          { id: '', name: 'Sans identifiant', cmd: 'ffmpeg http://cdn.test/3.ts' },
          { id: '103', name: 'Sans commande' },
          { id: '104', name: '   ', cmd: 'ffmpeg http://cdn.test/4.ts' },
          { id: '105', name: 'Numéro bizarre', number: '1a', cmd: 'ffmpeg http://cdn.test/5.ts', tv_genre_id: '1' },
        ],
      }),
    }));

    const playlist = await downloadStalkerPlaylist(account);

    expect(playlist.channels.map(c => c.name)).toEqual(['TF1', 'Arte', 'Numéro bizarre']);
    expect(playlist.channels[0]).toMatchObject({
      group: 'Infos', chno: '1', logo: 'http://portal.test/stalker_portal/misc/logos/320/logos/tf1.png',
    });
    expect(playlist.channels[1]).toMatchObject({ group: 'Sans groupe', logo: 'http://img.test/arte.png' });
    expect(playlist.channels[1].chno).toBeUndefined();
    expect(playlist.channels[2].chno).toBeUndefined();
    expect(playlist.channels[0].id).toMatch(/^stk[a-z0-9]+_101$/);
    expect(playlist.groups.map(g => [g.name, g.channels.length])).toEqual([['Infos', 2], ['Sans groupe', 1]]);
    expect(playlist.stalker).toEqual(account);
    expect(playlist.name).toBe('Portail portal.test');
  });

  it('utilise le nom demandé et la liste paginée en repli', async () => {
    const pages = {
      1: [{ id: '1', name: 'Une', cmd: 'ffmpeg http://cdn.test/1.ts' }, { id: '2', name: 'Deux', cmd: 'ffmpeg http://cdn.test/2.ts' }],
      2: [{ id: '3', name: 'Trois', cmd: 'ffmpeg http://cdn.test/3.ts' }],
    };
    const progress: number[] = [];
    serve(handshakeRoutes({
      'itv/get_genres': () => [],
      'itv/get_all_channels': () => ({ data: [] }),
      'itv/get_ordered_list': params => {
        const page = Number(params.get('p'));
        return { data: pages[page as 1 | 2] ?? [], total_items: 3 };
      },
    }));

    const playlist = await downloadStalkerPlaylist(account, ' Maison ', count => progress.push(count));

    expect(playlist.name).toBe('Maison');
    expect(playlist.channels).toHaveLength(3);
    expect(progress).toEqual([2, 3]);
  });

  it('échoue proprement quand le portail ne renvoie aucune chaîne', async () => {
    serve(handshakeRoutes({
      'itv/get_genres': () => [],
      'itv/get_all_channels': () => ({ data: [] }),
      'itv/get_ordered_list': () => ({ data: [], total_items: 0 }),
    }));
    await expect(downloadStalkerPlaylist(account)).rejects.toThrow('aucune chaîne');
  });

  it('se passe d’une liste de genres indisponible', async () => {
    serve(handshakeRoutes({
      'itv/get_genres': () => httpError(500),
      'itv/get_all_channels': () => [{ id: '1', name: 'Une', cmd: 'ffmpeg http://cdn.test/1.ts' }],
    }));
    const playlist = await downloadStalkerPlaylist(account);
    expect(playlist.groups).toEqual([{ name: 'Sans groupe', channels: playlist.channels }]);
  });
});
