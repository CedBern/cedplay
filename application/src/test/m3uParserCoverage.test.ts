import { describe, expect, it, vi } from 'vitest';
import { M3UParser } from '@/utils/m3uParser';

const buildPlaylist = (entries: string[], name = 'Audit') =>
  M3UParser.parseM3U(`#EXTM3U\n${entries.join('\n')}`, name);

describe('M3UParser — métadonnées', () => {
  it('gère la virgule entre guillemets dans les attributs', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="a" group-title="News, Infos",Canal X',
      'http://example.com/x.m3u8',
    ]);
    const ch = pl.channels[0];
    expect(ch.name).toBe('Canal X');
    expect(ch.group).toBe('News, Infos');
    expect(ch.tvgId).toBe('a');
  });

  it('accepte les attributs logo/group sans préfixe tvg-', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 logo="http://l.png" group="Docs",Documentaire',
      'http://example.com/d.m3u8',
    ]);
    const ch = pl.channels[0];
    expect(ch.logo).toBe('http://l.png');
    expect(ch.group).toBe('Docs');
  });

  it('extrait la durée et retombe à -1 quand elle est absente', () => {
    const pl = buildPlaylist([
      '#EXTINF:12.5 tvg-id="d1",Film',
      'http://example.com/f.m3u8',
      '#EXTINF:-1 tvg-id="d2",Direct',
      'http://example.com/g.m3u8',
    ]);
    expect(pl.channels[0].duration).toBe(12.5);
    expect(pl.channels[1].duration).toBe(-1);
  });

  it('retire les balises HTML du nom (le texte interne est conservé)', () => {
    const pl = buildPlaylist([
      `#EXTINF:-1 tvg-id="s1",<b>TFO</b>`,
      'http://example.com/s.m3u8',
    ]);
    expect(pl.channels[0].name).toBe('TFO');
    // Limite actuelle du sanitize : seuls les tags sont retirés, le texte
    // interne d'un faux tag reste (comportement documenté, pas un échappement).
    const pl2 = buildPlaylist([
      `#EXTINF:-1 tvg-id="s2",<script>alert(1)</script>TFO`,
      'http://example.com/s2.m3u8',
    ]);
    expect(pl2.channels[0].name).toBe('alert(1)TFO');
  });

  it('nomme les canaux sans nom Channel N', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="anon1",',
      'http://example.com/anon.m3u8',
      '#EXTINF:-1 tvg-id="anon2",',
      'http://example.com/anon2.m3u8',
    ]);
    // Deux tvg-id différents : pas de fusion, noms générés distincts
    expect(pl.channels.map(c => c.name)).toEqual(['Channel 1', 'Channel 2']);
  });

  it('produit des IDs stables pour le même contenu et nom de liste', () => {
    const content = '#EXTM3U\n#EXTINF:-1 tvg-id="stable",Chaîne\nhttp://example.com/live.m3u8';
    const a = M3UParser.parseM3U(content, 'Liste A');
    const b = M3UParser.parseM3U(content, 'Liste A');
    expect(a.channels[0].id).toBe(b.channels[0].id);
    // Un nom de liste différent change l'ID (uuidv5 name-space)
    const c = M3UParser.parseM3U(content, 'Liste B');
    expect(c.channels[0].id).not.toBe(a.channels[0].id);
  });
});

describe('M3UParser — détection de qualité', () => {
  it('priorise la qualité du nom sur celle de l\'URL', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="q1",Chaîne 4K',
      'http://example.com/stream_1080.m3u8',
    ]);
    expect(pl.channels[0].quality).toBe('4K');
  });

  it('détecte FHD, HD et SD depuis l\'URL en repli', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="q2",Chaîne A',
      'http://example.com/stream_1080.m3u8',
      '#EXTINF:-1 tvg-id="q3",Chaîne B',
      'http://example.com/stream_720.m3u8',
      '#EXTINF:-1 tvg-id="q4",Chaîne C',
      'http://example.com/stream_480.m3u8',
    ]);
    expect(pl.channels[0].quality).toBe('FHD');
    expect(pl.channels[1].quality).toBe('HD');
    expect(pl.channels[2].quality).toBe('SD');
  });

  it('ne devine aucune qualité sans indice', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="q5",Chaîne Z',
      'http://example.com/stream.m3u8',
    ]);
    expect(pl.channels[0].quality).toBeUndefined();
  });
});

describe('M3UParser — finalisation et déduplication', () => {
  it('regroupe les canaux sans groupe sous Ungrouped', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="u1",Sans groupe',
      'http://example.com/u.m3u8',
      '#EXTINF:-1 tvg-id="u2" group-title="News",Avec groupe',
      'http://example.com/n.m3u8',
    ]);
    const ungrouped = pl.groups.find(g => g.name === 'Ungrouped');
    expect(ungrouped?.channels).toHaveLength(1);
    expect(pl.groups.find(g => g.name === 'News')?.channels).toHaveLength(1);
  });

  it('compte totalChannelsBeforeDedup avant fusion', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="dup",Chaîne HD',
      'http://example.com/dup_hd.m3u8',
      '#EXTINF:-1 tvg-id="dup",Chaîne SD',
      'http://example.com/dup_sd.m3u8',
      '#EXTINF:-1 tvg-id="solo",Autre',
      'http://example.com/solo.m3u8',
    ]);
    expect(pl.totalChannelsBeforeDedup).toBe(3);
    expect(pl.channels).toHaveLength(2);
  });

  it('ne fusionne pas deux canaux de même nom mais de groupes différents', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="" group-title="News",Miroir',
      'http://example.com/m1.m3u8',
      '#EXTINF:-1 tvg-id="" group-title="Sport",Miroir',
      'http://example.com/m2.m3u8',
    ]);
    expect(pl.channels).toHaveLength(2);
    expect(pl.groups).toHaveLength(2);
  });

  it('garde la meilleure qualité comme canal principal et le reste en variantes', () => {
    const pl = buildPlaylist([
      '#EXTINF:-1 tvg-id="rank",Chaîne SD',
      'http://example.com/rank_480.m3u8',
      '#EXTINF:-1 tvg-id="rank",Chaîne FHD',
      'http://example.com/rank_1080.m3u8',
    ]);
    expect(pl.channels).toHaveLength(1);
    const main = pl.channels[0];
    expect(main.quality).toBe('FHD');
    expect(main.variants).toHaveLength(1);
    expect(main.variants?.[0].quality).toBe('SD');
  });
});

describe('M3UParser — lignes ignorées et progression', () => {
  it('ignore une URL sans #EXTINF précédent', () => {
    const pl = buildPlaylist([
      'http://example.com/orphelin.m3u8',
      '#EXTINF:-1 tvg-id="ok1",Valide',
      'http://example.com/ok.m3u8',
    ]);
    expect(pl.channels).toHaveLength(1);
    expect(pl.channels[0].url).toBe('http://example.com/ok.m3u8');
  });

  it('rejette un batchSize invalide', async () => {
    await expect(M3UParser.parseM3UWithProgress('#EXTM3U', 'X', undefined, 0))
      .rejects.toThrow('Taille de lot invalide.');
  });

  it('remonte une progression croissante jusqu\'à 100 %', async () => {
    const lines = ['#EXTM3U'];
    for (let i = 1; i <= 40; i++) {
      lines.push(`#EXTINF:-1 tvg-id="p${i}",Chaîne ${i}`, `http://example.com/p${i}.m3u8`);
    }
    const onProgress = vi.fn();
    const pl = await M3UParser.parseM3UWithProgress(lines.join('\n'), 'Progression', onProgress, 10);
    expect(pl.channels).toHaveLength(40);
    expect(onProgress).toHaveBeenCalled();
    const percents = onProgress.mock.calls.map(c => c[0] as number);
    expect(percents[0]).toBeGreaterThan(0);
    expect(percents[percents.length - 1]).toBe(100);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    // Le dernier callback transmet le nombre final de canaux
    expect(onProgress.mock.calls[onProgress.mock.calls.length - 1][1]).toBe(40);
  });

  it('exclut les #EXTINF sans URL', async () => {
    const pl = await M3UParser.parseM3UWithProgress(
      '#EXTM3U\n#EXTINF:-1 tvg-id="nourl",Fantôme\n#EXTINF:-1 tvg-id="url1",Réel\nhttp://example.com/reel.m3u8',
      'Sans URL'
    );
    expect(pl.channels).toHaveLength(1);
    expect(pl.channels[0].name).toBe('Réel');
  });
});

describe('M3UParser — import par URL', () => {
  it('rejette une réponse HTML (page web au lieu d\'une playlist)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Erreur 404</body></html>',
    }));
    await expect(M3UParser.parseFromUrlWithProgress('https://serveur/liste.m3u8'))
      .rejects.toThrow('Le serveur ne renvoie pas une liste de chaînes M3U.');
    vi.unstubAllGlobals();
  });

  it('rejette un contenu sans #EXTINF', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '#EXTM3U\njuste du texte',
    }));
    await expect(M3UParser.parseFromUrlWithProgress('https://serveur/liste.m3u8'))
      .rejects.toThrow('Le serveur ne renvoie pas une liste de chaînes M3U.');
    vi.unstubAllGlobals();
  });

  it('nomme la liste d\'après le hostname seul (sans credentials)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '#EXTM3U\n#EXTINF:-1 tvg-id="h1",Chaîne H\nhttp://example.com/h.m3u8',
    }));
    const pl = await M3UParser.parseFromUrlWithProgress('https://serveur.example:8080/get.php?username=u&password=p');
    expect(pl.name).toBe('Liste — serveur.example');
    expect(pl.name).not.toContain('password');
    vi.unstubAllGlobals();
  });
});
