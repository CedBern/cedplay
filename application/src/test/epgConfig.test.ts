import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setMeta } from '@/utils/idb';
import {
  EPG_CONFIG_EVENT, emptyEpgConfig, epgConfigSignature, getEpgConfig, normalizeEpgUrl, saveEpgConfig,
} from '@/utils/epgConfig';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('epgConfig — adresses de guide', () => {
  it('accepte http(s) et rejette le reste', () => {
    expect(normalizeEpgUrl('  https://epg.test/guide.xml  ')).toBe('https://epg.test/guide.xml');
    expect(normalizeEpgUrl('http://epg.test')).toBe('http://epg.test/');
    expect(normalizeEpgUrl('ftp://epg.test/guide.xml')).toBeNull();
    expect(normalizeEpgUrl('pas une adresse')).toBeNull();
    expect(normalizeEpgUrl('   ')).toBeNull();
  });
});

describe('epgConfig — nettoyage', () => {
  it('nettoie les réglages enregistrés : dédoublonnage, plafonds et arrondis', async () => {
    const saved = await saveEpgConfig('liste-nettoyee', {
      extraUrls: [' https://a.test/g.xml ', 'https://a.test/g.xml', 'ftp://x.test/g.xml', 'pas une url'],
      offsetHours: 25,
      channels: {
        c1: { xmltvId: '  france2.fr  ' },
        c2: { shift: 1.26 },
        c3: { xmltvId: '   ' },
        c4: { xmltvId: 'x'.repeat(400) },
      },
    });

    expect(saved.extraUrls).toEqual(['https://a.test/g.xml']);
    expect(saved.offsetHours).toBe(0);
    expect(saved.channels.c1).toEqual({ xmltvId: 'france2.fr' });
    expect(saved.channels.c2).toEqual({ shift: 1.25 });
    expect(saved.channels.c3).toBeUndefined();
    expect(saved.channels.c4.xmltvId).toHaveLength(300);
    // Le nettoyage est aussi celui appliqué à la relecture.
    await expect(getEpgConfig('liste-nettoyee')).resolves.toEqual(saved);
  });

  it('plafonne le nombre de sources supplémentaires', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://epg.test/${i}.xml`);
    const saved = await saveEpgConfig('liste-plafond', { ...emptyEpgConfig(), extraUrls: urls });
    expect(saved.extraUrls).toHaveLength(10);
    expect(saved.extraUrls[0]).toBe(urls[0]);
  });

  it('ignore un contenu stocké illisible', async () => {
    await setMeta('epgConfig:illisible', 'pas un objet');
    await expect(getEpgConfig('illisible')).resolves.toEqual(emptyEpgConfig());
    await setMeta('epgConfig:partiel', { extraUrls: 'x', channels: 'y', offsetHours: 'z' });
    await expect(getEpgConfig('partiel')).resolves.toEqual(emptyEpgConfig());
  });

  it('annonce l’enregistrement aux écrans ouverts sur la liste', async () => {
    const listener = vi.fn();
    window.addEventListener(EPG_CONFIG_EVENT, listener);
    try {
      await saveEpgConfig('liste-evenement', { ...emptyEpgConfig(), offsetHours: 2 });
      expect(listener).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ playlistId: 'liste-evenement' });
    } finally {
      window.removeEventListener(EPG_CONFIG_EVENT, listener);
    }
  });

  it('propage un quota plein au lieu de faire croire à un succès', async () => {
    const listener = vi.fn();
    window.addEventListener(EPG_CONFIG_EVENT, listener);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota dépassé', 'QuotaExceededError');
    });
    try {
      await expect(saveEpgConfig('liste-quota', emptyEpgConfig())).rejects.toThrow('quota');
      expect(listener).not.toHaveBeenCalled();
    } finally {
      put.mockRestore();
      window.removeEventListener(EPG_CONFIG_EVENT, listener);
    }
  });
});

describe('epgConfig — empreinte du cache', () => {
  it('trie les associations et inclut le décalage global', () => {
    const config = {
      ...emptyEpgConfig(),
      offsetHours: 2,
      channels: { b: { xmltvId: 'x' }, a: { shift: 1 } },
    };
    expect(epgConfigSignature(config)).toBe('2|a=/1,b=x/');
    expect(epgConfigSignature(emptyEpgConfig())).toBe('0|');
  });
});
