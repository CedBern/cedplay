import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadSubtitleText,
  getCachedSubtitle,
  getSubtitleCacheKey,
  saveCachedSubtitle,
  searchSubtitles,
} from '@/utils/subtitles';
import { setMeta } from '@/utils/idb';

// NB : les requêtes sont dédupliquées en vol (memoFetch) et l'IMDb est mis en
// cache par titre — chaque test utilise donc des titres/URL uniques.

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handlers: Array<{ urlMatch: string; body: unknown }>) {
  const fetcher = vi.fn(async (url: string) => {
    const handler = handlers.find(h => url.includes(h.urlMatch));
    if (!handler) throw new Error(`URL inattendue : ${url}`);
    return { ok: true, json: async () => handler.body } as Response;
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('searchSubtitles', () => {
  it('renvoie une liste vide quand aucun identifiant IMDb n\'est résolvable', async () => {
    const fetcher = stubFetch([
      { urlMatch: 'cinemeta', body: { metas: [] } },
    ]);
    const tracks = await searchSubtitles({ title: 'FilmIntrouvableAudit1', year: '1999' });
    expect(tracks).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refuse un match ambigu (deux metas identiques) et ne cherche pas les sous-titres', async () => {
    const fetcher = stubFetch([
      { urlMatch: 'cinemeta', body: { metas: [
        { id: 'tt1', name: 'Film Ambigu Audit', releaseInfo: '2001' },
        { id: 'tt2', name: 'Film Ambigu Audit', releaseInfo: '2001' },
      ] } },
    ]);
    const tracks = await searchSubtitles({ title: 'Film Ambigu Audit', year: '2001' });
    expect(tracks).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requête le bridge OpenSubtitles et trie FR en tête avec formats corrects', async () => {
    const fetcher = stubFetch([
      { urlMatch: 'cinemeta', body: { metas: [{ id: 'tt999', name: 'Film Bridge Audit', releaseInfo: '2020' }] } },
      { urlMatch: 'opensubtitles-v3', body: { subtitles: [
        { id: '2', url: 'https://cdn.test/en.vtt', lang: 'eng' },
        { id: '1', url: 'https://cdn.test/fr.srt', lang: 'fre', movieReleaseName: 'FR Release' },
        { id: '3', url: '', lang: 'spa' }, // sans URL : ignoré
      ] } },
    ]);
    const tracks = await searchSubtitles({ title: 'Film Bridge Audit', year: '2020' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain('movie/top/search=Film%20Bridge%20Audit');
    expect(fetcher.mock.calls[1][0]).toBe('https://opensubtitles-v3.strem.io/subtitles/movie/tt999.json');
    expect(tracks.map(t => t.lang)).toEqual(['fr', 'en']);
    expect(tracks[0]).toMatchObject({ format: 'srt', name: 'FR Release', url: 'https://cdn.test/fr.srt', langLabel: 'Français' });
    expect(tracks[1]).toMatchObject({ format: 'vtt', url: 'https://cdn.test/en.vtt' });
  });

  it('cible le bon épisode pour une série (imdb:saison:épisode)', async () => {
    const fetcher = stubFetch([
      { urlMatch: 'cinemeta', body: { metas: [{ id: 'tt555', name: 'Série Audit', releaseInfo: '2021' }] } },
      { urlMatch: 'opensubtitles-v3', body: { subtitles: [{ id: '7', url: 'https://cdn.test/fr.srt', lang: 'fre' }] } },
    ]);
    const tracks = await searchSubtitles({ title: 'Série Audit', kind: 'series', season: 2, episode: 5 });
    expect(fetcher.mock.calls[0][0]).toContain('series/top/search=S%C3%A9rie%20Audit');
    expect(fetcher.mock.calls[1][0]).toBe('https://opensubtitles-v3.strem.io/subtitles/series/tt555:2:5.json');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].lang).toBe('fr');
  });
});

describe('downloadSubtitleText', () => {
  it('exige une clé API pour les fichiers officiels OpenSubtitles', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(downloadSubtitleText('https://api.opensubtitles.com/api/v1/download/77'))
      .rejects.toThrow('Clé OpenSubtitles nécessaire.');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejette si la réponse officielle n\'expose pas de lien', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(downloadSubtitleText('https://api.opensubtitles.com/api/v1/download/88', { openSubtitlesApiKey: 'k' }))
      .rejects.toThrow('Lien de sous-titres absent.');
  });

  it('télécharge le contenu du lien CDN résolu', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ link: 'https://dl.test/file.srt' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => '1\n00:00:01,000 --> 00:00:02,000\nTexte' });
    vi.stubGlobal('fetch', fetcher);
    const srt = await downloadSubtitleText('https://api.opensubtitles.com/api/v1/download/99', { openSubtitlesApiKey: 'k' });
    expect(srt).toContain('Texte');
    // 2e appel = CDN, sans en-tête Api-Key
    expect(fetcher.mock.calls[1][0]).toBe('https://dl.test/file.srt');
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Api-Key');
  });

  it('télécharge directement un lien non officiel sans POST', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => 'WEBVTT' });
    vi.stubGlobal('fetch', fetcher);
    const vtt = await downloadSubtitleText('https://cdn.test/direct.vtt');
    expect(vtt).toBe('WEBVTT');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('https://cdn.test/direct.vtt');
  });
});

describe('cache de sous-titres', () => {
  it('fait l\'aller-retour du cache par mediaKey et langue', async () => {
    await saveCachedSubtitle('media-audit', 'fr', '1\n00:00:01,000 --> 00:00:02,000\nSalut', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut');
    const cached = await getCachedSubtitle('media-audit', 'fr');
    expect(cached?.srt).toContain('Salut');
    expect(cached?.vtt).toContain('WEBVTT');
  });

  it('renvoie null si le vtt manque dans l\'entrée de cache', async () => {
    await setMeta(getSubtitleCacheKey('media-incomplete', 'fr'), { srt: 'srt seul', vtt: '', savedAt: 1 });
    await expect(getCachedSubtitle('media-incomplete', 'fr')).resolves.toBeNull();
  });

  it('renvoie null pour un mediaKey jamais enregistré', async () => {
    await expect(getCachedSubtitle('media-inexistant', 'fr')).resolves.toBeNull();
  });
});
