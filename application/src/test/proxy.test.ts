import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProxyBase, DEFAULT_PROXY } from '@/utils/proxy';

// Le module lit uniquement StorageManager.getCachedSettings() : on le mock
// entièrement pour piloter chaque scénario.
const getCachedSettings = vi.fn();
vi.mock('@/utils/storage', () => ({
  StorageManager: { getCachedSettings: () => getCachedSettings() },
}));

beforeEach(() => {
  getCachedSettings.mockReset();
});

describe('getProxyBase', () => {
  it('renvoie le relais local par défaut sans réglage', () => {
    getCachedSettings.mockReturnValue({});
    expect(getProxyBase()).toBe(DEFAULT_PROXY);
    expect(DEFAULT_PROXY).toBe('http://127.0.0.1:5179');
  });

  it('réduit l\'adresse configurée à son origine (chemin strippé)', () => {
    getCachedSettings.mockReturnValue({ proxyUrl: 'https://mon-relais.example/chemin/long' });
    expect(getProxyBase()).toBe('https://mon-relais.example');
  });

  it('préfixe http:// pour une adresse sans schéma comme host:port', () => {
    getCachedSettings.mockReturnValue({ proxyUrl: 'https://relais.local:8080' });
    expect(getProxyBase()).toBe('https://relais.local:8080');
    getCachedSettings.mockReturnValue({ proxyUrl: 'relais.local:8080' });
    expect(getProxyBase()).toBe('http://relais.local:8080');
  });

  it('retombe sur le défaut pour une adresse invalide', () => {
    getCachedSettings.mockReturnValue({ proxyUrl: 'pas une url !!' });
    expect(getProxyBase()).toBe(DEFAULT_PROXY);
  });

  it('retombe sur le défaut si les réglages sont indisponibles', () => {
    getCachedSettings.mockImplementation(() => { throw new Error('idb indisponible'); });
    expect(getProxyBase()).toBe(DEFAULT_PROXY);
  });

  it('ignore une valeur vide ou espaces', () => {
    getCachedSettings.mockReturnValue({ proxyUrl: '   ' });
    expect(getProxyBase()).toBe(DEFAULT_PROXY);
  });
});
