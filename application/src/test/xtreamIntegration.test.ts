import { describe, expect, it } from 'vitest';
import { getPlaybackUrl } from '@/hooks/useVideoPlayer';

describe('Intégration Xtream & Proxy', () => {
  it('laisse intactes les adresses locales, les tests et les blobs', () => {
    expect(getPlaybackUrl('http://127.0.0.1:5178/verification.m3u')).toBe('http://127.0.0.1:5178/verification.m3u');
    expect(getPlaybackUrl('http://localhost:5178/stream.mp4')).toBe('http://localhost:5178/stream.mp4');
    expect(getPlaybackUrl('https://example.test/stream.m3u8')).toBe('https://example.test/stream.m3u8');
    expect(getPlaybackUrl('blob:http://127.0.0.1:5178/abc-123')).toBe('blob:http://127.0.0.1:5178/abc-123');
  });

  it('route les flux distants externes vers le proxy local 5179', () => {
    const rawUrl = 'http://maxhd.org:8080/live/user/pass/1158.ts';
    const proxied = getPlaybackUrl(rawUrl);
    expect(proxied).toBe(`http://127.0.0.1:5179/proxy?url=${encodeURIComponent(rawUrl)}`);
  });

  it('gère correctement les adresses invalides sans lancer d’exception', () => {
    expect(getPlaybackUrl('not-a-valid-url')).toBe('not-a-valid-url');
  });
});
