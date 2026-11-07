import { afterEach, describe, expect, it, vi } from 'vitest';
import { M3UParser } from '@/utils/m3uParser';
import { CORSProxy } from '@/utils/corsProxy';

const list = (names: string[]) => '#EXTM3U\n' + names.map(name => `#EXTINF:-1 tvg-id="${name}" group-title="Test",${name}\nhttps://example.test/${name}.m3u8`).join('\n');
afterEach(() => vi.unstubAllGlobals());
describe('Reprise : identifiants et confidentialité des imports', () => {
  it('conserve les virgules du titre et celles des attributs cités', async () => {
    const text = '#EXTM3U\n#EXTINF:-1 group-title="Films, séries",Bonjour, le monde\nhttps://example.test/a';
    const result = M3UParser.parseM3U(text);
    expect(result.channels[0]).toMatchObject({ name: 'Bonjour, le monde', group: 'Films, séries' });
    expect((await M3UParser.parseM3UWithProgress(text)).channels).toEqual(result.channels);
  });
  it('ne fusionne pas les titres non latins ni les homonymes de groupes distincts', () => {
    const text = '#EXTM3U\n' + [['東京', 'JP'], ['大阪', 'JP'], ['Film', 'FR'], ['Film', 'EN']].map(([name, group], i) =>
      `#EXTINF:-1 group-title="${group}",${name}\nhttps://example.test/${i}`).join('\n');
    expect(M3UParser.parseM3U(text).channels).toHaveLength(4);
  });
  it('supprime les entrées identiques au lieu de créer des variantes à clés dupliquées', () => {
    const result = M3UParser.parseM3U(list(['Alpha', 'Alpha']));
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].variants || []).toHaveLength(0);
  });
  it('conserve les identifiants après insertion et réordonnancement', () => {
    const before = M3UParser.parseM3U(list(['Alpha', 'Beta']), 'Source');
    const after = M3UParser.parseM3U(list(['Gamma', 'Beta', 'Alpha']), 'Source');
    for (const channel of before.channels) expect(after.channels.find(c => c.name === channel.name)?.id).toBe(channel.id);
  });
  it('sépare deux sources et garde la parité des parseurs', async () => {
    const first = M3UParser.parseM3U(list(['Alpha']), 'Source A');
    const second = M3UParser.parseM3U(list(['Alpha']), 'Source B');
    const progressive = await M3UParser.parseM3UWithProgress(list(['Alpha']), 'Source A');
    expect(first.channels[0].id).not.toBe(second.channels[0].id);
    expect(first.channels).toEqual(progressive.channels);
  });
  it('distingue deux chaînes qui partagent la même URL vidéo', () => {
    const result = M3UParser.parseM3U(list(['Alpha', 'Beta']).replace('Beta.m3u8', 'Alpha.m3u8'));
    expect(new Set(result.channels.map(c => c.id)).size).toBe(2);
  });
  it('conserve toutes les variantes quand une meilleure qualité arrive', () => {
    const result = M3UParser.parseM3U('#EXTM3U\n' + ['SD', 'HD', 'FHD'].map(q => `#EXTINF:-1 tvg-id="a",Alpha ${q}\nhttps://example.test/${q}.m3u8`).join('\n'));
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].variants).toHaveLength(2);
  });
  it('ne contacte aucun relais après un refus du serveur', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('secret URL must not be echoed'));
    vi.stubGlobal('fetch', fetcher);
    await expect(CORSProxy.fetchWithProxy('https://example.test/list?password=secret')).rejects.toThrow('Aucun relais public');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://example.test/list?password=secret');
  });
  it('un fichier contenant une URL seule reste hors ligne', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await M3UParser.parseM3UWithProgress('https://example.test/private')).channels).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('un import URL masque les identifiants dans le nom de liste', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => list(['Alpha']) }));
    const result = await M3UParser.parseFromUrl('https://example.test/list?password=secret');
    expect(result.name).toContain('example.test'); expect(result.name).not.toContain('secret');
  });
  it('refuse les protocoles non web avant toute requête', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(CORSProxy.fetchWithProxy('file:///private')).rejects.toThrow('HTTP');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
