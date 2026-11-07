import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORSProxy } from '@/utils/corsProxy';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CORSProxy.fetchWithProxy', () => {
  it('rejette une adresse non URL', async () => {
    await expect(CORSProxy.fetchWithProxy('pas une url')).rejects.toThrow('Adresse de playlist invalide.');
  });

  it('rejette les protocoles autres que HTTP/HTTPS', async () => {
    await expect(CORSProxy.fetchWithProxy('ftp://serveur/liste.m3u')).rejects.toThrow('Utilisez une adresse HTTP ou HTTPS.');
    await expect(CORSProxy.fetchWithProxy('file:///C:/liste.m3u')).rejects.toThrow('Utilisez une adresse HTTP ou HTTPS.');
  });

  it('renvoie le texte de la réponse en cas de succès', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => '#EXTM3U' });
    vi.stubGlobal('fetch', fetcher);
    await expect(CORSProxy.fetchWithProxy('http://serveur/liste.m3u')).resolves.toBe('#EXTM3U');
    expect(fetcher.mock.calls[0][0]).toBe('http://serveur/liste.m3u');
    // Le fetch direct ne doit pas transmettre de referrer
    expect(fetcher.mock.calls[0][1]).toMatchObject({ referrerPolicy: 'no-referrer' });
  });

  it('traduit tout échec HTTP en message d\'erreur mentionnant le statut', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '' }));
    await expect(CORSProxy.fetchWithProxy('https://serveur/liste.m3u')).rejects.toThrow('Import impossible : HTTP 403');
  });

  it('traduit tout échec réseau/CORS en message d\'import explicite', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(CORSProxy.fetchWithProxy('https://serveur/liste.m3u')).rejects.toThrow('Import impossible (connexion, accès ou CORS)');
  });

  it('avorte au bout de 15 s et rejette', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetcher);
    const promise = CORSProxy.fetchWithProxy('https://serveur/lent.m3u');
    const assertion = expect(promise).rejects.toThrow('Import impossible (connexion, accès ou CORS)');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it('respecte un signal externe déjà avorté', async () => {
    // Un fetch réel rejette immédiatement quand le signal est déjà aborté.
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(CORSProxy.fetchWithProxy('https://serveur/liste.m3u', { signal: controller.signal }))
      .rejects.toThrow('Import impossible (connexion, accès ou CORS)');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('CORSProxy helpers', () => {
  it('convertToHttps ne change que le protocole', () => {
    expect(CORSProxy.convertToHttps('http://x/y?u=1')).toBe('https://x/y?u=1');
    expect(CORSProxy.convertToHttps('https://x/y')).toBe('https://x/y');
  });

  it('isMixedContentIssue reste faux en page HTTP (cas jsdom)', () => {
    // jsdom est servi en http: : un import http:// n'est pas du mixed content
    expect(CORSProxy.isMixedContentIssue('http://serveur/liste.m3u')).toBe(false);
    expect(CORSProxy.isMixedContentIssue('https://serveur/liste.m3u')).toBe(false);
  });

  it('testConnectivity renvoie true sur succès HEAD et false sur échec', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', ok);
    await expect(CORSProxy.testConnectivity('https://serveur')).resolves.toBe(true);
    expect(ok.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });

    const ko = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', ko);
    await expect(CORSProxy.testConnectivity('https://serveur')).resolves.toBe(false);
  });
});
