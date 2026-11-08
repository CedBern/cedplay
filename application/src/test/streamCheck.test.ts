import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMeta } from '@/utils/idb';
import {
  describeFailure, loadHiddenChannels, probeStreams, saveHiddenChannels,
} from '@/utils/streamCheck';

// Le pont natif est enregistré au chargement du module : on le remplace par un
// double pilotable pour couvrir le chemin Android comme le chemin web.
const state = vi.hoisted(() => ({
  platform: 'web',
  plugin: false,
  probeStreams: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => state.platform,
    isPluginAvailable: () => state.plugin,
  },
  registerPlugin: () => ({ probeStreams: state.probeStreams }),
}));

const PROXY = '/proxy?url=';
const streamResponse = (text: string, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }),
} as unknown as Response);

const urls = (count: number) => Array.from({ length: count }, (_, i) => `http://cdn.test/${i}.ts`);

beforeEach(() => {
  state.platform = 'web';
  state.plugin = false;
  state.probeStreams.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('streamCheck — diagnostic', () => {
  it('traduit chaque famille d’échec', () => {
    expect(describeFailure({ ok: false, status: 0 })).toBe('Ne répond pas');
    expect(describeFailure({ ok: false, status: 401 })).toBe('Accès refusé (401)');
    expect(describeFailure({ ok: false, status: 403 })).toBe('Accès refusé (403)');
    expect(describeFailure({ ok: false, status: 404 })).toBe('Introuvable (404)');
    expect(describeFailure({ ok: false, status: 410 })).toBe('Introuvable (410)');
    expect(describeFailure({ ok: false, status: 503 })).toBe('Erreur du serveur (503)');
    expect(describeFailure({ ok: false, status: 204 })).toBe('Réponse vide');
    expect(describeFailure({ ok: false, status: 302 })).toBe('Erreur 302');
  });
});

describe('streamCheck — adresses web', () => {
  it('déclare lisible un flux qui renvoie des octets', async () => {
    const fetcher = vi.fn().mockResolvedValue(streamResponse('#EXTM3U\n'));
    vi.stubGlobal('fetch', fetcher);
    await expect(probeStreams(['http://cdn.test/a.ts'])).resolves.toEqual([{ ok: true, status: 200 }]);
    const called = fetcher.mock.calls[0][0] as string;
    expect(called).toContain(PROXY);
    expect(called).toContain(encodeURIComponent('http://cdn.test/a.ts'));
  });

  it('refuse une page HTML servie à la place du flux', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('<html>abonnement expiré</html>')));
    await expect(probeStreams(['http://cdn.test/a.ts'])).resolves.toEqual([{ ok: false, status: 200 }]);
  });

  it('refuse une réponse vide ou sans corps', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: null })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: new ReadableStream({ start(controller) { controller.close(); } }),
      }));
    await expect(probeStreams(['http://cdn.test/a.ts', 'http://cdn.test/b.ts']))
      .resolves.toEqual([{ ok: false, status: 200 }, { ok: false, status: 200 }]);
  });

  it('rapporte le code HTTP d’un refus et une panne réseau', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, body: null })
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError')));
    await expect(probeStreams(['http://cdn.test/a.ts', 'http://cdn.test/b.ts']))
      .resolves.toEqual([{ ok: false, status: 404 }, { ok: false, status: 0 }]);
  });

  it('teste par lots de 24 et signale l’avancement', async () => {
    const fetcher = vi.fn().mockResolvedValue(streamResponse('ok'));
    vi.stubGlobal('fetch', fetcher);
    const progress: number[] = [];
    const results = await probeStreams(urls(30), done => progress.push(done));
    expect(results).toHaveLength(30);
    expect(progress).toEqual([24, 30]);
    expect(fetcher).toHaveBeenCalledTimes(30);
  });

  it('s’arrête entre deux lots quand on annule', async () => {
    const fetcher = vi.fn().mockResolvedValue(streamResponse('ok'));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(probeStreams(urls(30), undefined, controller.signal)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('streamCheck — pont natif Android', () => {
  it('passe par le test natif et complète les résultats manquants', async () => {
    state.platform = 'android';
    state.plugin = true;
    state.probeStreams.mockResolvedValue({ results: [{ ok: true, status: 200 }] });
    await expect(probeStreams(['http://cdn.test/a.ts', 'http://cdn.test/b.ts']))
      .resolves.toEqual([{ ok: true, status: 200 }, { ok: false, status: 0 }]);
    expect(state.probeStreams).toHaveBeenCalledWith({ urls: ['http://cdn.test/a.ts', 'http://cdn.test/b.ts'] });
  });

  it('retombe sur le test web si le pont natif est absent', async () => {
    state.platform = 'android';
    state.plugin = false;
    const fetcher = vi.fn().mockResolvedValue(streamResponse('ok'));
    vi.stubGlobal('fetch', fetcher);
    await probeStreams(['http://cdn.test/a.ts']);
    expect(state.probeStreams).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('streamCheck — chaînes masquées', () => {
  it('enregistre et relit la liste par liste', async () => {
    await saveHiddenChannels('p1', ['a', 'b']);
    await saveHiddenChannels('p2', ['c']);
    await expect(loadHiddenChannels('p1')).resolves.toEqual(['a', 'b']);
    await expect(loadHiddenChannels('p2')).resolves.toEqual(['c']);
    await expect(loadHiddenChannels('inconnue')).resolves.toEqual([]);
  });

  it('ignore les entrées qui ne sont pas des identifiants', async () => {
    await setMeta('hiddenChannels:p3', ['a', 3, null, { id: 'b' }]);
    await expect(loadHiddenChannels('p3')).resolves.toEqual(['a']);
  });

  it('renvoie une liste vide quand le stockage est illisible', async () => {
    await setMeta('hiddenChannels:p4', 'pas un tableau');
    await expect(loadHiddenChannels('p4')).resolves.toEqual([]);
  });
});
