import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseM3UInWorker } from '@/utils/parseWorker';

const CONTENT = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="a" group-title="Test",Chaîne A',
  'http://cdn.test/a.ts',
  '#EXTINF:-1 tvg-id="b" group-title="Test",Chaîne B',
  'http://cdn.test/b.ts',
].join('\n');

/** Double minimal du Worker : on pilote ses messages à la main. */
class FakeWorker {
  static last: FakeWorker | undefined;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown;
  terminated = false;

  constructor(public url: URL, public options: unknown) {
    FakeWorker.last = this;
  }

  postMessage(message: unknown) { this.posted = message; }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
  fail() { this.onerror?.(); }
}

afterEach(() => {
  FakeWorker.last = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseM3UInWorker — analyse hors du fil principal', () => {
  it('transmet la liste au worker et suit l’avancement', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const progress: number[] = [];
    const pending = parseM3UInWorker(CONTENT, 'Ma liste', percent => progress.push(percent));
    const worker = FakeWorker.last!;

    expect(worker.posted).toEqual({ type: 'parse', content: CONTENT, playlistName: 'Ma liste' });
    expect(worker.terminated).toBe(false);

    worker.emit({ type: 'progress', percent: 42 });
    expect(progress).toEqual([42]);

    const playlist = { id: 'p', name: 'Ma liste', channels: [], groups: [] };
    worker.emit({ type: 'result', playlist });

    await expect(pending).resolves.toEqual(playlist);
    expect(worker.terminated).toBe(true);
  });

  it('remonte le message d’erreur du worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pending = parseM3UInWorker(CONTENT, 'Ma liste', () => {});
    const worker = FakeWorker.last!;
    worker.emit({ type: 'error', message: 'Liste sans chaîne' });
    await expect(pending).rejects.toThrow('Liste sans chaîne');
    expect(worker.terminated).toBe(true);
  });

  it('replie sur le fil principal quand le worker plante', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pending = parseM3UInWorker(CONTENT, 'Ma liste', () => {});
    FakeWorker.last!.fail();
    const playlist = await pending;
    expect(playlist.name).toBe('Ma liste');
    expect(playlist.channels.map(channel => channel.name)).toEqual(['Chaîne A', 'Chaîne B']);
    expect(FakeWorker.last!.terminated).toBe(true);
  });

  it('replie sur le fil principal quand le worker est indisponible', async () => {
    vi.stubGlobal('Worker', undefined);
    const progress: number[] = [];
    const playlist = await parseM3UInWorker(CONTENT, 'Sans worker', percent => progress.push(percent));
    expect(playlist.channels).toHaveLength(2);
    expect(progress.at(-1)).toBe(100);
  });

  it('abandonne une analyse qui dépasse trois minutes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const pending = parseM3UInWorker(CONTENT, 'Ma liste', () => {});
    const rejection = expect(pending).rejects.toThrow('trop de temps');
    await vi.advanceTimersByTimeAsync(180_000);
    await rejection;
    expect(FakeWorker.last!.terminated).toBe(true);
  });
});
