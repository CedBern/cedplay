import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { loadOfficialDocumentaries, officialDocumentaryCacheKey, officialDocumentaryUrl, OFFICIAL_DOCUMENTARY_CACHE_TTL, parseImagoCatalogue, parseImagoTitle, parseTV5Documentaries, readOfficialDocumentaryCache } from '@/utils/officialDocumentaries';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) }, CapacitorHttp: { get: vi.fn() } }));
const tv5 = '<a class="poster-card" href="/fr/documentaires/societe/fracture-americaine-3" aria-label="Fracture américaine - Documentaires"><img class="poster-image" src="https://assets.tv5mondeplus.com/imagescaler002/tv5monde/tv5mondeplus/assets/123/posters/abc.jpg?w=423"></a>';
const imago = (slug = 'ce-qui-compte') => `<div class="thumbnail" id="content-documentary-${slug}"><a href="/documentaires/${slug}"><img lazy-src="https://asset.vodify.fr/img/imago/content/documentary/cover/ce_qui_compte.jpg"></a><div class="info"><div class="line _1">Un sous-titre, pas le nom</div></div></div>`;
const detail = '<meta property="og:title" content="Ce qui compte"><h1 class="name">Ce qui compte</h1>';
const tv5Item = parseTV5Documentaries(tv5)[0]!;
const cache = (age = 0) => localStorage.setItem(officialDocumentaryCacheKey('tv5mondeplus'), JSON.stringify({ version: 1, source: 'tv5mondeplus', fetchedAt: Date.now() - age, items: [tv5Item] }));
const native = (data: string, status = 200) => ({ data, status, headers: {}, url: '' });
beforeEach(() => { localStorage.clear(); vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true); vi.mocked(CapacitorHttp.get).mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('extrait les cartes réelles TV5, conserve titre et affiche et dédoublonne', () => {
  expect(parseTV5Documentaries(tv5 + tv5)).toEqual([{ id: '/fr/documentaires/societe/fracture-americaine-3', title: 'Fracture américaine', url: 'https://www.tv5mondeplus.com/fr/documentaires/societe/fracture-americaine-3', image: 'https://assets.tv5mondeplus.com/imagescaler002/tv5monde/tv5mondeplus/assets/123/posters/abc.jpg?w=423' }]);
  expect(parseTV5Documentaries(Array.from({ length: 30 }, (_, i) => tv5.replace(/fracture-americaine-3/g, `film-${i}`)).join(''))).toHaveLength(12);
});
it('lit les candidats Imago sans prendre un sous-titre pour un titre; lit le nom sur la fiche', () => {
  const candidates = parseImagoCatalogue(imago() + imago());
  expect(candidates).toHaveLength(1); expect(candidates[0]).not.toHaveProperty('title');
  expect(parseImagoTitle(detail)).toBe('Ce qui compte');
  expect(parseImagoTitle('<meta property="og:title" content="Le vrai titre &amp; la mer">')).toBe('Le vrai titre & la mer');
  expect(parseImagoTitle('<div class="line _1">Sous-titre</div>')).toBe('');
});
it('rejette URL étrangères, URL actives, credentials, ports, queries et sources croisées', () => {
  for (const value of ['javascript:alert(1)', 'http://www.imagotv.fr/documentaires/film', 'https://www.imagotv.fr.evil.test/documentaires/film', 'https://user:pass@www.imagotv.fr/documentaires/film', 'https://www.imagotv.fr:444/documentaires/film', '/documentaires/film?redirect=evil', '/documentaires/film#evil']) expect(officialDocumentaryUrl('imagotv', value)).toBeUndefined();
  expect(officialDocumentaryUrl('tv5mondeplus', 'https://www.imagotv.fr/documentaires/film')).toBeUndefined();
  expect(officialDocumentaryUrl('imagotv', '/documentaires')).toBe('https://www.imagotv.fr/documentaires');
  expect(parseTV5Documentaries(tv5.replace('/fr/documentaires/societe/fracture-americaine-3', 'https://evil.test/film'))).toEqual([]);
  expect(parseImagoCatalogue(imago().replace('/documentaires/ce-qui-compte', 'https://evil.test/film'))).toEqual([]);
});
it('écarte les images étrangères et le HTML trop grand sans exécuter les scripts', () => {
  expect(parseTV5Documentaries(tv5.replace('assets.tv5mondeplus.com', 'evil.test'))[0]).not.toHaveProperty('image');
  expect(parseImagoCatalogue(imago().replace('asset.vodify.fr', 'evil.test'))[0]).not.toHaveProperty('image');
  expect(() => parseTV5Documentaries('x'.repeat(4_000_001))).toThrow();
  expect(() => parseImagoCatalogue('x'.repeat(1_000_001))).toThrow();
  expect(parseImagoTitle(detail + '<script>throw new Error("executed")</script>')).toBe('Ce qui compte');
});
it('ne tente aucun accès catalogue Web sans CORS, conserve les liens officiels côté UI', async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  expect(await loadOfficialDocumentaries('tv5mondeplus', new AbortController().signal)).toEqual([]);
  expect(await loadOfficialDocumentaries('imagotv', new AbortController().signal)).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled(); expect(CapacitorHttp.get).not.toHaveBeenCalled();
});
it('utilise un cache frais, valide version/source/données et ignore le stockage corrompu', async () => {
  cache(); expect(await loadOfficialDocumentaries('tv5mondeplus', new AbortController().signal)).toEqual([tv5Item]);
  expect(CapacitorHttp.get).not.toHaveBeenCalled();
  for (const wrong of ['{', 'null', JSON.stringify({ version: 1, source: 'imagotv', fetchedAt: Date.now(), items: [tv5Item] }), JSON.stringify({ version: 1, source: 'tv5mondeplus', fetchedAt: Date.now(), items: [{ ...tv5Item, url: 'https://evil.test/film' }] })]) {
    localStorage.setItem(officialDocumentaryCacheKey('tv5mondeplus'), wrong); expect(readOfficialDocumentaryCache('tv5mondeplus')).toBeNull();
  }
});
it('charge TV5 natif avec redirections bloquées et conserve le cache en panne indépendamment d’Imago', async () => {
  vi.mocked(CapacitorHttp.get).mockResolvedValueOnce(native(tv5));
  expect(await loadOfficialDocumentaries('tv5mondeplus', new AbortController().signal)).toEqual([tv5Item]);
  expect(CapacitorHttp.get).toHaveBeenCalledWith(expect.objectContaining({ disableRedirects: true, responseType: 'text', readTimeout: 12_000 }));
  expect(readOfficialDocumentaryCache('imagotv')).toBeNull();
  cache(OFFICIAL_DOCUMENTARY_CACHE_TTL + 1); vi.mocked(CapacitorHttp.get).mockRejectedValue(new Error('offline'));
  expect(await loadOfficialDocumentaries('tv5mondeplus', new AbortController().signal)).toEqual([tv5Item]);
  await expect(loadOfficialDocumentaries('imagotv', new AbortController().signal)).rejects.toThrow('offline');
});
it('charge les titres Imago sur fiches exactes et garde les réponses partielles', async () => {
  vi.mocked(CapacitorHttp.get).mockResolvedValueOnce(native(imago() + imago('autre-film'))).mockResolvedValueOnce(native(detail)).mockRejectedValueOnce(new Error('indisponible'));
  const items = await loadOfficialDocumentaries('imagotv', new AbortController().signal);
  expect(items).toHaveLength(1); expect(items[0]?.title).toBe('Ce qui compte');
  expect(CapacitorHttp.get).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: 'https://www.imagotv.fr/documentaires/ce-qui-compte' }));
  expect(readOfficialDocumentaryCache('imagotv')?.items).toEqual(items);
});
it('borne le parallélisme Imago à trois fiches, puis termine les suivantes', async () => {
  const pending: (() => void)[] = []; let running = 0; let maximum = 0;
  vi.mocked(CapacitorHttp.get).mockImplementation(async ({ url }) => {
    if (url.endsWith('/documentaires')) return native(Array.from({ length: 8 }, (_, i) => imago(`film-${i}`)).join(''));
    running++; maximum = Math.max(maximum, running);
    await new Promise<void>(resolve => { pending.push(() => { running--; resolve(); }); }); return native(detail);
  });
  const result = loadOfficialDocumentaries('imagotv', new AbortController().signal);
  for (let i = 0; i < 12; i++) { await new Promise(resolve => setTimeout(resolve, 0)); pending.splice(0).forEach(resolve => resolve()); }
  expect(await result).toHaveLength(8); expect(maximum).toBe(3);
});
it('annule le natif tardif sans écrire de cache ni lancer d’autres fiches', async () => {
  let resolve!: (value: ReturnType<typeof native>) => void;
  vi.mocked(CapacitorHttp.get).mockImplementation(() => new Promise(r => { resolve = r; }));
  const controller = new AbortController(); const result = loadOfficialDocumentaries('imagotv', controller.signal); controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' }); resolve(native(imago())); await Promise.resolve();
  expect(CapacitorHttp.get).toHaveBeenCalledTimes(1); expect(readOfficialDocumentaryCache('imagotv')).toBeNull();
});
it('annule Imago pendant trois fiches sans lancer la suite ni mémoriser les retours tardifs', async () => {
  const pending: ((value: ReturnType<typeof native>) => void)[] = [];
  vi.mocked(CapacitorHttp.get).mockImplementation(async ({ url }) => {
    if (url.endsWith('/documentaires')) return native(Array.from({ length: 8 }, (_, i) => imago(`film-${i}`)).join(''));
    return new Promise(resolve => { pending.push(resolve); });
  });
  const controller = new AbortController(); const result = loadOfficialDocumentaries('imagotv', controller.signal);
  await new Promise(resolve => setTimeout(resolve, 0)); expect(pending).toHaveLength(3); controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' }); pending.forEach(resolve => resolve(native(detail))); await new Promise(resolve => setTimeout(resolve, 0));
  expect(CapacitorHttp.get).toHaveBeenCalledTimes(4); expect(readOfficialDocumentaryCache('imagotv')).toBeNull();
});
it('borne une requête bloquée et refuse statut/volume invalides', async () => {
  vi.useFakeTimers(); cache(OFFICIAL_DOCUMENTARY_CACHE_TTL + 1); vi.mocked(CapacitorHttp.get).mockImplementation(() => new Promise(() => {}));
  const result = loadOfficialDocumentaries('tv5mondeplus', new AbortController().signal); await vi.advanceTimersByTimeAsync(12_000); expect(await result).toEqual([tv5Item]);
  vi.mocked(CapacitorHttp.get).mockResolvedValueOnce(native('redirect', 302)).mockResolvedValueOnce(native('é'.repeat(600_000)));
  await expect(loadOfficialDocumentaries('imagotv', new AbortController().signal)).rejects.toThrow();
  await expect(loadOfficialDocumentaries('imagotv', new AbortController().signal)).rejects.toThrow();
});
