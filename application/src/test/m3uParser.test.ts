import { describe, it, expect } from 'vitest';
import { M3UParser } from '@/utils/m3uParser';

const sample = `#EXTM3U\n#EXTINF:-1 tvg-id="id1" tvg-name="Channel 1" group-title="Group A",Channel 1 1080p\nhttp://example.com/stream1.m3u8\n#EXTINF:-1 tvg-id="id1" tvg-name="Channel 1" group-title="Group A",Channel 1 720p\nhttp://example.com/stream1_alt.m3u8\n#EXTINF:-1 tvg-id="id2" group-title="Group B",Channel 2 4K\nhttp://example.com/stream2.m3u8`;

describe('M3UParser', () => {
  it('parses and deduplicates variants', () => {
    const pl = M3UParser.parseM3U(sample, 'Test');
    expect(pl.channels.length).toBe(2); // id1 merged, id2 separate
    const primary = pl.channels.find(c => c.tvgId === 'id1');
    // Either primary has variants or another channel referencing same tvgId should not exist
    expect(primary).toBeTruthy();
  const variantCount = primary?.variants ? primary.variants.length : 0;
  expect(variantCount).toBeGreaterThan(0);
  });

  it('récupère le numéro de chaîne tvg-chno pour le zapping numérique', () => {
    const withChno = `#EXTM3U\n#EXTINF:-1 tvg-id="a" tvg-chno="42" group-title="News",News 24\nhttp://example.com/news.m3u8\n#EXTINF:-1 tvg-id="b" group-title="News",Sans numéro\nhttp://example.com/other.m3u8`;
    const pl = M3UParser.parseM3U(withChno, 'Chno');
    const numbered = pl.channels.find(c => c.tvgId === 'a');
    const unnumbered = pl.channels.find(c => c.tvgId === 'b');
    expect(numbered?.chno).toBe('42');
    expect(unnumbered?.chno).toBeUndefined();
  });
});
