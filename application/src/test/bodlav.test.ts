import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { BODLAV_CACHE_KEY, BODLAV_CACHE_TTL, loadBodlavDocumentaries, parseBodlavCategory, parseBodlavDocumentaries, parseBodlavEntry, readBodlavCache } from '@/utils/bodlav';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) }, CapacitorHttp: { get: vi.fn() } }));

const category = 'https://bodlav.com/prefix-new/c/bodlav/26/0';
const item = { id: '123', title: 'Le documentaire & la mer', url: 'https://bodlav.com/prefix-new/b/bodlav/123', image: 'https://image.tmdb.org/t/p/w300/poster.jpg', year: '2026', language: 'VOSTFR' };
const card = (href = '/prefix-new/b/bodlav/123', kind = 'DOCUMENTAIRE', image = item.image) => `<a class="film-card" href="${href}"><img class="film-card-img" src="${image}" onerror="alert(1)"><button data-cat="${kind}"></button><div class="film-card-title">Le documentaire &amp; la mer</div><span class="trend-card-date">2026</span><span class="film-card-vostfr">VOSTFR</span></a>`;
const html = `<div id="cat-film-grid">${card()}</div><script>throw new Error('must never run')</script>`;
const cache = (age = 0) => localStorage.setItem(BODLAV_CACHE_KEY, JSON.stringify({ version: 1, fetchedAt: Date.now() - age, items: [item] }));
const response = (text: string, status = 200) => new Response(text, { status });

beforeEach(() => { localStorage.clear(); vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('catalogue documentaire Bodlav', () => {
  it('lit uniquement la grille réelle, conserve année/langue/affiche, dédoublonne et exclut les spectacles', () => {
    expect(parseBodlavDocumentaries(`<div id="cat-film-grid">${card()}${card()}${card('/prefix-new/b/bodlav/456', 'SPECTACLE')}</div>${card('/prefix-new/b/bodlav/789')}`, category)).toEqual([item]);
  });
  it('rejette les fiches étrangères, credentials, ports, protocoles actifs et liens malformés', () => {
    const bad = ['https://bodlav.com.evil.test/prefix-new/b/bodlav/123', 'https://user:pass@bodlav.com/prefix-new/b/bodlav/123', 'https://bodlav.com:444/prefix-new/b/bodlav/123', 'javascript:alert(1)', 'http://bodlav.com/prefix-new/b/bodlav/123', 'http://[', '/prefix-new/b/bodlav/123?redirect=evil'];
    expect(parseBodlavDocumentaries(`<div id="cat-film-grid">${bad.map(url => card(url)).join('')}</div>`, category)).toEqual([]);
    expect(() => parseBodlavDocumentaries(html, 'https://bodlav.com/prefix-new/c/bodlav/3/0')).toThrow();
  });
  it('écarte les images étrangères sans perdre la fiche', () => {
    const items = parseBodlavDocumentaries(`<div id="cat-film-grid">${card(undefined, undefined, 'https://image.tmdb.org.evil.test/t/p/w300/poster.jpg')}</div>`, category);
    expect(items).toEqual([{ id: item.id, title: item.title, url: item.url, year: item.year, language: item.language }]);
  });
  it('retrouve un préfixe changé et exige la rubrique Documentaire 26/0', () => {
    expect(parseBodlavEntry('<a id="bodlavc" href="a-new-prefix">Entrer</a>')).toBe('https://bodlav.com/a-new-prefix/home/bodlav');
    expect(parseBodlavCategory('<a href="/new/c/bodlav/3/0">Spectacle</a><a href="/new/c/bodlav/26/0"><svg></svg>Documentaire</a>', 'https://bodlav.com/new/home/bodlav')).toBe('https://bodlav.com/new/c/bodlav/26/0');
    expect(parseBodlavCategory('<a href="https://evil.test/new/c/bodlav/26/0">Documentaire</a>', category)).toBeUndefined();
    expect(() => parseBodlavEntry('<a id="bodlavc" href="https://evil.test/token">')).toThrow();
  });
  it('borne le nombre de titres et le corps HTML', () => {
    expect(parseBodlavDocumentaries(`<div id="cat-film-grid">${Array.from({ length: 40 }, (_, i) => card(`/new/b/bodlav/${i}`)).join('')}</div>`, category)).toHaveLength(12);
    expect(() => parseBodlavDocumentaries('x'.repeat(1_000_001), category)).toThrow();
  });
  it('utilise le cache frais sans requête réseau', async () => {
    cache(); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await loadBodlavDocumentaries(new AbortController().signal)).toEqual([item]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('valide les URL du cache et ignore le stockage illisible', () => {
    cache(); expect(readBodlavCache()?.items).toEqual([item]);
    localStorage.setItem(BODLAV_CACHE_KEY, JSON.stringify({ version: 1, fetchedAt: Date.now(), items: [{ ...item, url: 'https://evil.test/123' }] }));
    expect(readBodlavCache()).toBeNull();
    localStorage.setItem(BODLAV_CACHE_KEY, '{'); expect(readBodlavCache()).toBeNull();
  });
  it('actualise en trois requêtes HTTPS et mémorise le catalogue courant', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response('<a id="bodlavc" href="prefix-new">Entrer</a>')).mockResolvedValueOnce(response('<a href="/prefix-new/c/bodlav/26/0">Documentaire</a>')).mockResolvedValueOnce(response(html));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadBodlavDocumentaries(new AbortController().signal)).toEqual([item]);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['https://bodlav.com', 'https://bodlav.com/prefix-new/home/bodlav', category]);
    expect(readBodlavCache()?.items).toEqual([item]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });
  it('conserve le cache ancien sur panne, statut refusé ou HTML cassé', async () => {
    cache(BODLAV_CACHE_TTL + 1);
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('no', 503)).mockResolvedValueOnce(response('changed layout'));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 3; i++) expect(await loadBodlavDocumentaries(new AbortController().signal)).toEqual([item]);
  });
  it('borne une requête bloquée et revient au cache ancien', async () => {
    vi.useFakeTimers(); cache(BODLAV_CACHE_TTL + 1);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const result = loadBodlavDocumentaries(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toEqual([item]);
  });
  it('annule sans renvoyer le cache et sans écrire une réponse native tardive', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    cache(BODLAV_CACHE_TTL + 1); const initial = localStorage.getItem(BODLAV_CACHE_KEY);
    let resolve!: (value: { status: number; data: string; headers: Record<string, string>; url: string }) => void;
    const native = vi.spyOn(CapacitorHttp, 'get').mockImplementation(() => new Promise(r => { resolve = r; }));
    const controller = new AbortController();
    const pending = loadBodlavDocumentaries(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolve({ status: 200, data: '<a id="bodlavc" href="prefix-new">', headers: {}, url: 'https://bodlav.com' });
    await Promise.resolve();
    expect(native).toHaveBeenCalledTimes(1); expect(localStorage.getItem(BODLAV_CACHE_KEY)).toBe(initial);
  });
});
