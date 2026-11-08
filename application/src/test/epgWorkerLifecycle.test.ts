import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseEPGInWorker } from '@/utils/epgWorker';
import { packEPGData } from '@/utils/epgPacked';
import type { Channel } from '@/types/channel';

class TestWorker {
  static instances: TestWorker[] = [];
  static throwOnPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn((_message: { channels: unknown }) => {
    if (TestWorker.throwOnPost) throw new DOMException('Message non clonable', 'DataCloneError');
  });
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

const xml = '<tv><programme channel="a" start="20261108110000 +0000" stop="20261108120000 +0000"><title>Résultat de repli</title></programme></tv>';
const channels: Channel[] = [{ id: 'c', name: 'Chaîne', tvgId: 'a', tvgName: 'Nom guide', tvgShift: 1, url: 'https://example.test/private', logo: 'https://example.test/logo', variants: [{ id: 'variant', name: 'Variante', url: 'https://example.test/variant' }] }];
const result = (title: string) => ({ c: [{ id: 'c_0', channelId: 'c', title, startTime: new Date(0), endTime: new Date(1000) }] });

beforeEach(() => { vi.useFakeTimers(); TestWorker.instances = []; TestWorker.throwOnPost = false; vi.stubGlobal('Worker', TestWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('envoie seulement les références EPG puis termine le worker avant de rendre le résultat', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = parseEPGInWorker(xml, channels, {}, controller.signal);
  const worker = TestWorker.instances[0];
  expect(worker.postMessage.mock.calls[0][0].channels).toEqual([{ id: 'c', name: 'Chaîne', tvgId: 'a', tvgName: 'Nom guide', tvgShift: 1 }]);
  worker.reply({ type: 'result', data: packEPGData(result('Premier')) });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(await pending).toEqual(result('Premier'));
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('isole deux analyses simultanées au lieu de rendre le résultat de l’autre liste', async () => {
  const first = parseEPGInWorker(xml, channels);
  const second = parseEPGInWorker(xml, channels);
  TestWorker.instances[1].reply({ type: 'result', data: packEPGData(result('Deuxième')) });
  expect(await second).toEqual(result('Deuxième'));
  expect(TestWorker.instances[0].terminate).not.toHaveBeenCalled();
  TestWorker.instances[0].reply({ type: 'result', data: packEPGData(result('Premier')) });
  expect(await first).toEqual(result('Premier'));
  expect(vi.getTimerCount()).toBe(0);
});

it('annule l’ancienne analyse sans repli et permet la nouvelle requête', async () => {
  const controller = new AbortController();
  const pending = parseEPGInWorker('XML invalide qui ferait échouer un repli', channels, {}, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const oldWorker = TestWorker.instances[0];
  controller.abort();
  await rejected;
  expect(oldWorker.terminate).toHaveBeenCalledOnce();
  expect(oldWorker.onmessage).toBeNull();
  expect(oldWorker.onerror).toBeNull();
  expect(oldWorker.onmessageerror).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  const next = parseEPGInWorker(xml, channels);
  TestWorker.instances[1].reply({ type: 'result', data: packEPGData(result('Nouvelle liste')) });
  expect(await next).toEqual(result('Nouvelle liste'));
});

it('ne crée pas de worker pour une demande déjà annulée', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(parseEPGInWorker(xml, channels, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(TestWorker.instances).toHaveLength(0);
});

it.each(['error', 'messageerror', 'timeout', 'worker-result-error', 'invalid-result'] as const)('libère le worker avant le repli après %s', async failure => {
  const pending = parseEPGInWorker(xml, channels);
  const worker = TestWorker.instances[0];
  if (failure === 'error') worker.onerror?.();
  if (failure === 'messageerror') worker.onmessageerror?.();
  if (failure === 'timeout') vi.advanceTimersByTime(60_000);
  if (failure === 'worker-result-error') worker.reply({ type: 'error' });
  if (failure === 'invalid-result') worker.reply({ type: 'result', data: {} });
  expect((await pending).c[0].title).toBe('Résultat de repli');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('libère aussi le worker si l’envoi initial ne peut pas être cloné', async () => {
  TestWorker.throwOnPost = true;
  const pending = parseEPGInWorker(xml, channels);
  expect((await pending).c[0].title).toBe('Résultat de repli');
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
