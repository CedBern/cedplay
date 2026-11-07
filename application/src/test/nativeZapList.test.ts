import { beforeEach, expect, it, vi } from 'vitest';
import type { Channel } from '@/types/channel';

const mocks = vi.hoisted(() => ({ open: vi.fn(), setZapList: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
  registerPlugin: () => ({ open: mocks.open, setZapList: mocks.setZapList }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const { NativePlayerBridge, buildNativeZap, syncNativeZapList, zapListData } = await import('@/utils/nativePlayer');
const { setPlaybackDelegated } = await import('@/utils/playbackOwnership');

beforeEach(() => { vi.clearAllMocks(); setPlaybackDelegated(false); mocks.setZapList.mockResolvedValue(undefined); mocks.open.mockResolvedValue({}); });

const big: Channel[] = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, name: `Chaîne ${i}`, url: `http://h.test/${i}.ts`, group: i % 2 ? 'Sport' : 'Info' }));

it('écrit une ligne par chaîne, sans tabulation ni saut de ligne parasites', () => {
  const data = zapListData([
    { id: 'a', name: 'Nom\tavec\ntab', url: 'http://h.test/a', group: 'G', chno: '7' },
    { id: 'b', name: 'B', url: 'http://h.test/b' },
  ]);
  expect(data.split('\n')).toEqual(['http://h.test/a\tNom avec tab\tG\t7', 'http://h.test/b\tB\t\t2']);
});

it('ouvre le lecteur sur la liste complète une fois celle-ci transmise', async () => {
  // Avant la transmission : fenêtre de 300 chaînes seulement.
  expect(buildNativeZap(big, big[900]!).listKey).toBeUndefined();
  await syncNativeZapList(big);
  expect(mocks.setZapList).toHaveBeenCalledTimes(1);
  const sent = mocks.setZapList.mock.calls[0]![0] as { key: string; data: string; count: number };
  expect(sent.count).toBe(1000);
  expect(sent.data.split('\n')).toHaveLength(1000);
  // Même liste : rien n'est renvoyé.
  await syncNativeZapList(big);
  expect(mocks.setZapList).toHaveBeenCalledTimes(1);

  const zap = buildNativeZap(big, big[900]!);
  expect(zap.urls).toHaveLength(300);
  expect(zap).toMatchObject({ listKey: sent.key, listIndex: 900, start: 700, index: 200 });
  await NativePlayerBridge.open(big[900]!.url, big[900]!.name, zap);
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ listKey: sent.key, listIndex: 900, windowStart: 700, channelIndex: 200 }));
});

it('rend la chaîne regardée en dernier même hors de la fenêtre transmise', async () => {
  await syncNativeZapList(big);
  mocks.open.mockResolvedValue({ channelUrl: big[10]!.url });
  const onReturned = vi.fn();
  await NativePlayerBridge.open(big[900]!.url, big[900]!.name, buildNativeZap(big, big[900]!), onReturned);
  expect(onReturned).toHaveBeenCalledWith(big[10]!.url);
});

it('une autre liste (copie, filtre) ne réutilise pas la liste transmise', async () => {
  await syncNativeZapList(big);
  expect(buildNativeZap([...big], big[5]!).listKey).toBeUndefined();
});
