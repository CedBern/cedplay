import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { getParsedEPGCache, saveParsedEPGCache } from '@/utils/epg';
import * as idb from '@/utils/idb';
import type { EPGData } from '@/types/epg';

afterEach(() => vi.restoreAllMocks());

const start = Date.UTC(2026, 10, 8, 12);
const repeatedDescription = 'Un long résumé partagé avec des accents éèà et des détails. '.repeat(100);
const sample = (): EPGData => ({
  alpha: Array.from({ length: 100 }, (_, i) => ({
    id: `alpha_${start + i * 3_600_000}`,
    channelId: 'alpha',
    title: 'Titre partagé',
    description: repeatedDescription,
    category: 'Documentaire',
    startTime: new Date(start + i * 3_600_000),
    endTime: new Date(start + (i + 1) * 3_600_000),
  })),
  special: [{
    id: 'identité personnalisée', channelId: 'une autre chaîne', title: '',
    description: '', category: '', rating: '12',
    startTime: new Date(start - 3_600_000), endTime: new Date(start),
  }, {
    id: `special_${start}`, channelId: 'special', title: 'Sans champs facultatifs',
    startTime: new Date(start), endTime: new Date(start + 3_600_000),
  }],
  empty: [],
});

it('ne sérialise qu’une seule fois le long résumé partagé dans le cache du guide', async () => {
  const write = vi.spyOn(idb, 'setMeta');
  await saveParsedEPGCache('packed-cache-text', 'https://example.test/guide', 42, sample());
  const packedCall = write.mock.calls.find(([key]) => key === 'epgParsed_v2_packed-cache-text');
  const payload = packedCall?.[1];
  const serialized = JSON.stringify(payload);
  expect(serialized.split(repeatedDescription).length - 1).toBe(1);
  expect(packedCall?.[0]).toBe('epgParsed_v2_packed-cache-text');
});

it('restaure dates, ordre, champs absents, chaînes vides et identités personnalisées sans perte', async () => {
  const input = sample();
  await saveParsedEPGCache('packed-cache-roundtrip', 'https://example.test/guide', 43, input);
  const result = await getParsedEPGCache('packed-cache-roundtrip', 'https://example.test/guide', 43);
  expect(result === null).toBe(false);
  expect(result).toEqual(input);
  expect(result?.special?.[1]).not.toHaveProperty('description');
  expect(result?.alpha?.[0]?.startTime).toBeInstanceOf(Date);
  expect(await getParsedEPGCache('packed-cache-roundtrip', 'https://other.test/guide', 43)).toBeNull();
  expect(await getParsedEPGCache('packed-cache-roundtrip', 'https://example.test/guide', 44)).toBeNull();
});

it('ignore l’ancien cache volumineux sans demander son clonage à IndexedDB', async () => {
  await idb.setMeta('epgParsed_packed-cache-legacy', { fetchedAt: 44, url: 'https://example.test/guide', data: sample() });
  const read = vi.spyOn(idb, 'getMeta');
  expect(await getParsedEPGCache('packed-cache-legacy', 'https://example.test/guide', 44) === null).toBe(true);
  expect(read).not.toHaveBeenCalledWith('epgParsed_packed-cache-legacy');
  expect(await idb.getMeta('epgParsed_packed-cache-legacy')).toBeDefined();
});

it('garde le cache compact hors de la sauvegarde exportée', async () => {
  await saveParsedEPGCache('packed-cache-backup', 'https://example.test/guide', 45, sample());
  const backup = await idb.exportBackupFromDB();
  expect(backup.meta.some(entry => entry.key.startsWith('epgParsed_v2_'))).toBe(false);
});
