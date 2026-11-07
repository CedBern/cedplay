import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  playlistToM3U,
  playlistToM3UAdvanced,
  downloadPlaylist,
  downloadPlaylistAdvanced,
  type AdvancedExportOptions,
} from '@/utils/m3uExport';
import type { PlaylistInfo, Channel } from '@/types/channel';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch1',
    name: 'TF1',
    url: 'http://example.com/tf1.m3u8',
    ...overrides,
  };
}

function makePlaylist(channels: Channel[]): PlaylistInfo {
  return {
    id: 'pl1',
    name: 'Ma liste',
    channels,
    groups: [],
  };
}

const parent = makeChannel({ id: 'parent', name: 'TF1', quality: 'FHD', tvgId: 'tvg1' });
const variant = makeChannel({ id: 'variant', name: 'TF1 SD', quality: 'SD', tvgId: 'tvg1', url: 'http://example.com/tf1.ts' });

describe('playlistToM3U', () => {
  it('reconstruit l\'en-tête et les attributs présents', () => {
    const pl = makePlaylist([
      makeChannel({
        tvgId: 'tvg1',
        tvgName: 'TF1 HD',
        logo: 'http://logo/tf1.png',
        group: 'Généralistes',
        duration: 10,
      }),
    ]);
    const out = playlistToM3U(pl);
    expect(out.split('\n')[0]).toBe('#EXTM3U');
    expect(out).toContain('#EXTINF:10 tvg-id="tvg1" tvg-name="TF1 HD" tvg-logo="http://logo/tf1.png" group-title="Généralistes",TF1');
    expect(out).toContain('http://example.com/tf1.m3u8');
  });

  it('omet les attributs absents et utilise la durée -1 par défaut', () => {
    const pl = makePlaylist([makeChannel()]);
    const out = playlistToM3U(pl);
    expect(out).toBe('#EXTM3U\n#EXTINF:-1,TF1\nhttp://example.com/tf1.m3u8');
  });

  it('ne génère pas de ligne URL si l\'URL est vide', () => {
    const pl = makePlaylist([makeChannel({ url: '' })]);
    const out = playlistToM3U(pl);
    expect(out).toBe('#EXTM3U\n#EXTINF:-1,TF1');
  });
});

describe('playlistToM3UAdvanced', () => {
  it('exporte les variantes avec annotation variant-of / variant-index', () => {
    const pl = makePlaylist([{ ...parent, variants: [variant] }]);
    const options: AdvancedExportOptions = { includeVariants: true, annotateVariants: true, includeQuality: true };
    const out = playlistToM3UAdvanced(pl, [], options);
    const lines = out.split('\n');
    expect(lines).toHaveLength(5); // header + parent + url + variant + url
    expect(lines[1]).toContain('quality="FHD"');
    expect(lines[3]).toContain('#EXTINF:-1');
    expect(lines[3]).toContain('quality="SD"');
    expect(lines[3]).toContain('variant-of="parent"');
    expect(lines[3]).toContain('variant-index="0"');
    expect(lines[4]).toBe('http://example.com/tf1.ts');
  });

  it('omet l\'annotation variant-of sans annotateVariants', () => {
    const pl = makePlaylist([{ ...parent, variants: [variant] }]);
    const out = playlistToM3UAdvanced(pl, [], { includeVariants: true });
    expect(out).toContain('tf1.ts');
    expect(out).not.toContain('variant-of');
  });

  it('n\'exporte pas les variantes sans includeVariants', () => {
    const pl = makePlaylist([{ ...parent, variants: [variant] }]);
    const out = playlistToM3UAdvanced(pl, [], {});
    expect(out).not.toContain('tf1.ts');
    expect(out).toContain('tf1.m3u8');
  });

  it('marque favorite="true" seulement pour les canaux favoris', () => {
    const pl = makePlaylist([parent]);
    const out = playlistToM3UAdvanced(pl, ['parent'], { includeFavorites: true });
    expect(out).toContain('favorite="true"');
    const out2 = playlistToM3UAdvanced(makePlaylist([makeChannel({ id: 'other', name: 'M6' })]), ['parent'], { includeFavorites: true });
    expect(out2).not.toContain('favorite');
  });

  it('onlyFavorites filtre le canal principal et ses variantes non favorites', () => {
    const favVariant = { ...variant, id: 'favVariant' };
    const pl = makePlaylist([{ ...parent, variants: [favVariant] }]);
    const out = playlistToM3UAdvanced(pl, ['favVariant'], { includeVariants: true, annotateVariants: true, onlyFavorites: true });
    // Le principal (non favori) est exclu, la variante favorite est gardée
    expect(out).not.toContain('tf1.m3u8');
    expect(out).toContain('tf1.ts');
    expect(out).toContain('variant-of="parent"');
  });

  it('ajoute quality="..." quand includeQuality est actif', () => {
    const out = playlistToM3UAdvanced(makePlaylist([parent]), [], { includeQuality: true });
    expect(out).toContain('quality="FHD"');
  });
});

describe('downloadPlaylist', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function stubBlobUrl() {
    const created: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    });
    created.push('blob:fake');
    return created;
  }

  it('sanitise le nom de fichier et déclenche le téléchargement', () => {
    vi.useFakeTimers();
    stubBlobUrl();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const pl: PlaylistInfo = { ...makePlaylist([makeChannel()]), name: 'Ma liste été!' };
    downloadPlaylist(pl);
    expect(clickSpy).toHaveBeenCalledOnce();
    const anchor = document.body.querySelector('a');
    // « été » → « é » hors [a-z0-9] de part et d'autre du « t » : chaque run non conforme donne un seul « _ »
    expect(anchor?.getAttribute('download')).toBe('Ma_liste_t_.m3u');
    vi.advanceTimersByTime(1100);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(document.body.querySelector('a')).toBeNull();
  });

  it('ajoute le suffixe des options avancées au nom de fichier', () => {
    vi.useFakeTimers();
    stubBlobUrl();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const pl = makePlaylist([{ ...parent, variants: [variant] }]);
    downloadPlaylistAdvanced(pl, [], { includeQuality: true, includeFavorites: true, includeVariants: true, onlyFavorites: true });
    const anchor = document.body.querySelector('a');
    expect(anchor?.getAttribute('download')).toBe('Ma_liste-quality_fav_variants_onlyFav.m3u');
    expect(clickSpy).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1100);
    expect(document.body.querySelector('a')).toBeNull();
  });
});
