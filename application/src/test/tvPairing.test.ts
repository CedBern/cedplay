import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePairedCredentials, openPairing, pairingAvailable } from '@/utils/tvPairing';

const native = vi.hoisted(() => ({
  platform: 'android',
  startPairing: vi.fn(),
  stopPairing: vi.fn(),
  acknowledgePairing: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
  emit: (() => {}) as (data: unknown) => void,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => native.platform, isPluginAvailable: () => true },
  registerPlugin: () => ({
    startPairing: native.startPairing,
    stopPairing: native.stopPairing,
    acknowledgePairing: native.acknowledgePairing,
    addListener: native.addListener,
  }),
}));

const URL_1 = 'http://192.168.1.20:40123/k7m2q9xd';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  native.platform = 'android';
  native.startPairing.mockResolvedValue({ url: URL_1 });
  native.stopPairing.mockResolvedValue(undefined);
  native.acknowledgePairing.mockResolvedValue(undefined);
  native.addListener.mockImplementation(async (_event: string, listener: (data: unknown) => void) => {
    native.emit = listener;
    return { remove: native.remove };
  });
});

describe('Appairage par QR code', () => {
  it('met en forme les identifiants saisis sur le téléphone', () => {
    expect(normalizePairedCredentials({ server: ' http://serveur.test:8080/ ', username: ' marie ', password: 'p&a=ss' }))
      .toEqual({ server: 'http://serveur.test:8080', username: 'marie', password: 'p&a=ss' });
    // Adresse tapée sans http:// : le cas courant sur un clavier de téléphone.
    expect(normalizePairedCredentials({ server: 'serveur.test:8080', username: 'marie', password: 'secret' })?.server).toBe('http://serveur.test:8080');
    expect(normalizePairedCredentials({ server: 'https://serveur.test/player_api.php', username: 'marie', password: 'secret' })?.server).toBe('https://serveur.test');
  });

  it('tire les identifiants d’un lien M3U complet collé dans le serveur', () => {
    expect(normalizePairedCredentials({ server: 'http://serveur.test:8080/get.php?username=marie&password=p%26ss&type=m3u_plus&output=ts', username: '', password: '' }))
      .toEqual({ server: 'http://serveur.test:8080', username: 'marie', password: 'p&ss' });
  });

  it('refuse une saisie incomplète ou illisible', () => {
    expect(normalizePairedCredentials({ server: 'http://serveur.test', username: 'marie', password: '' })).toBeNull();
    expect(normalizePairedCredentials({ server: '', username: 'marie', password: 'secret' })).toBeNull();
    expect(normalizePairedCredentials({ server: 'http://', username: 'marie', password: 'secret' })).toBeNull();
    expect(normalizePairedCredentials({ server: 12 as unknown as string })).toBeNull();
    expect(normalizePairedCredentials(null)).toBeNull();
  });

  it('donne l’adresse à afficher, transmet les identifiants reçus et ferme par adresse', async () => {
    const onCredentials = vi.fn();
    const onUrl = vi.fn();
    const close = openPairing(onCredentials, onUrl);
    await flush();
    expect(onUrl).toHaveBeenCalledWith(URL_1);
    native.emit({ server: 'http://serveur.test', username: 'marie', password: '' });
    expect(onCredentials).not.toHaveBeenCalled();
    native.emit({ server: 'http://serveur.test', username: 'marie', password: 'secret' });
    expect(onCredentials).toHaveBeenCalledWith({ server: 'http://serveur.test', username: 'marie', password: 'secret' });
    close();
    expect(native.stopPairing).toHaveBeenCalledWith({ url: URL_1 });
    expect(native.remove).toHaveBeenCalledTimes(1);
    native.emit({ server: 'http://serveur.test', username: 'marie', password: 'secret' });
    expect(onCredentials).toHaveBeenCalledTimes(1);
  });

  it('accuse réception au téléphone selon ce que le téléviseur a fait des identifiants', async () => {
    const onCredentials = vi.fn();
    openPairing(onCredentials, vi.fn());
    await flush();
    const valid = { server: 'http://serveur.test', username: 'marie', password: 'secret' };

    onCredentials.mockReturnValueOnce(true);
    native.emit({ ...valid, requestId: 'r1' });
    expect(native.acknowledgePairing).toHaveBeenLastCalledWith({ requestId: 'r1', accepted: true });

    // Téléviseur occupé : le téléphone ne doit pas afficher « C’est envoyé ».
    onCredentials.mockReturnValueOnce(false);
    native.emit({ ...valid, requestId: 'r2' });
    expect(native.acknowledgePairing).toHaveBeenLastCalledWith({ requestId: 'r2', accepted: false });

    // Saisie inexploitable : refusée sans être transmise au dialogue.
    native.emit({ server: 'http://', username: 'marie', password: 'secret', requestId: 'r3' });
    expect(native.acknowledgePairing).toHaveBeenLastCalledWith({ requestId: 'r3', accepted: false });
    expect(onCredentials).toHaveBeenCalledTimes(2);
  });

  it('fermé avant la réponse d’Android : n’affiche rien et n’ouvre pas de serveur', async () => {
    const onUrl = vi.fn();
    const close = openPairing(vi.fn(), onUrl);
    close();
    await flush();
    expect(onUrl).not.toHaveBeenCalled();
    expect(native.startPairing).not.toHaveBeenCalled();
    expect(native.stopPairing).not.toHaveBeenCalled();
    expect(native.remove).toHaveBeenCalledTimes(1);
  });

  it('fermé pendant l’ouverture du serveur : il est refermé dès qu’Android répond', async () => {
    let answer: (value: { url: string }) => void = () => {};
    native.startPairing.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
    const onUrl = vi.fn();
    const close = openPairing(vi.fn(), onUrl);
    await flush();
    close();
    expect(native.stopPairing).not.toHaveBeenCalled();
    answer({ url: URL_1 });
    await flush();
    expect(native.stopPairing).toHaveBeenCalledWith({ url: URL_1 });
    expect(onUrl).not.toHaveBeenCalled();
  });

  it('sans réseau local ou avec une adresse inattendue : pas de QR code', async () => {
    const onUrl = vi.fn();
    native.startPairing.mockRejectedValueOnce(new Error('Aucun réseau local'));
    openPairing(vi.fn(), onUrl);
    await flush();
    native.startPairing.mockResolvedValueOnce({ url: 'https://ailleurs.test/page' });
    openPairing(vi.fn(), onUrl);
    await flush();
    expect(onUrl).not.toHaveBeenCalled();
  });

  it('hors Android : rien n’est ouvert', async () => {
    native.platform = 'web';
    expect(pairingAvailable()).toBe(false);
    openPairing(vi.fn(), vi.fn())();
    await flush();
    expect(native.addListener).not.toHaveBeenCalled();
  });
});
