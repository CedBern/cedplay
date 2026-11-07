import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativePlayerBridge, RecordingsBridge, buildNativeZap, findChannelByNumber } from '@/utils/nativePlayer';
import { isPlaybackDelegated, onPlaybackDelegated, setPlaybackDelegated } from '@/utils/playbackOwnership';
import type { Channel } from '@/types/channel';
import { DEFAULT_USER_AGENT, setActiveUserAgent } from '@/utils/userAgent';

const mocks = vi.hoisted(() => ({
  platform: 'android', available: true,
  open: vi.fn(), openExternal: vi.fn(), openMosaic: vi.fn(), openVod: vi.fn(), error: vi.fn(), scheduleRecording: vi.fn(),
}));
const telemetry = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mocks.platform,
    isPluginAvailable: () => mocks.available,
  },
  registerPlugin: () => ({ open: mocks.open, openExternal: mocks.openExternal, openMosaic: mocks.openMosaic, openVod: mocks.openVod, scheduleRecording: mocks.scheduleRecording }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@/utils/telemetry/logger', () => ({ globalTelemetryLogger: { log: telemetry.log } }));

beforeEach(() => {
  mocks.platform = 'android'; mocks.available = true;
  vi.clearAllMocks(); setPlaybackDelegated(false);
  setActiveUserAgent(DEFAULT_USER_AGENT);
});
afterEach(() => setPlaybackDelegated(false));

describe('Passation au lecteur Android', () => {
  it.each(['web', 'ios'])('ne propose pas un plugin Android sur %s', async platform => {
    mocks.platform = platform;
    expect(NativePlayerBridge.isAvailable()).toBe(false);
    expect(await NativePlayerBridge.open('https://example.test/live.ts')).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('exige que le plugin soit enregistré', () => {
    mocks.available = false;
    expect(NativePlayerBridge.isAvailable()).toBe(false);
  });

  it.each(['open', 'openExternal'] as const)('arrête le web avant %s et verrouille les doubles clics jusqu’au retour Android', async method => {
    let finish!: () => void;
    const order: string[] = [];
    mocks[method].mockImplementation(() => {
      order.push('android');
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const unsubscribe = onPlaybackDelegated(() => order.push('stop-web'));
    const operation = NativePlayerBridge[method]('https://example.test/live.ts', 'Test');
    expect(order).toEqual(['stop-web', 'android']);
    expect(isPlaybackDelegated()).toBe(true);
    expect(await NativePlayerBridge.open('https://example.test/other.ts')).toBe(false);
    finish();
    expect(await operation).toBe(true);
    expect(isPlaybackDelegated()).toBe(false);
    unsubscribe();
  });

  it('signale un échec sans afficher les identifiants de l’URL', async () => {
    mocks.open.mockRejectedValue(new Error('https://private.test/user/password/1.ts'));
    expect(await NativePlayerBridge.open('https://private.test/user/password/1.ts')).toBe(false);
    expect(isPlaybackDelegated()).toBe(false);
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error.mock.calls[0]?.[0]).not.toContain('password');
  });

  it.each(['file:///secret', 'javascript:alert(1)', 'broken'])('refuse une adresse non HTTP : %s', async url => {
    expect(await NativePlayerBridge.open(url)).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(isPlaybackDelegated()).toBe(false);
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it('verrouille la mosaïque avant son ouverture et jusqu’à la fermeture de tous ses lecteurs', async () => {
    let finish!: () => void;
    mocks.openMosaic.mockImplementation(() => { expect(isPlaybackDelegated()).toBe(true); return new Promise<void>(resolve => { finish = resolve; }); });
    const operation = NativePlayerBridge.openMosaic([{ url: 'https://example.test/1.ts', title: '1' }, { url: 'https://example.test/2.ts', title: '2' }]);
    expect(await NativePlayerBridge.open('https://example.test/3.ts')).toBe(false);
    finish(); expect(await operation).toBe(true); expect(isPlaybackDelegated()).toBe(false);
  });
  it('refuse les sélections hors limites et les flux répétés', async () => {
    const stream = { url: 'https://example.test/1.ts', title: '1' };
    for (const streams of [[], [stream], [stream, stream], Array.from({ length: 9 }, (_, i) => ({ ...stream, url: `https://example.test/${i}.ts` }))]) expect(await NativePlayerBridge.openMosaic(streams)).toBe(false);
    expect(mocks.openMosaic).not.toHaveBeenCalled();
  });
  it('récupère la position VOD sans reprendre automatiquement le direct web', async () => {
    mocks.openVod.mockResolvedValue({ positionMs: 90000, durationMs: 3600000 });
    expect(await NativePlayerBridge.openVod('https://example.test/movie.mp4', 'Film', 'test-film', true)).toBe(true);
    expect(mocks.openVod).toHaveBeenCalledWith(expect.objectContaining({ startPositionMs: 0, restart: true }));
    expect(isPlaybackDelegated()).toBe(false);
    expect(JSON.parse(localStorage.getItem('vod_progress_test-film') || '{}').positionMs).toBe(90000);
  });

  it('transmet les sous-titres injectés à openVod', async () => {
    mocks.openVod.mockResolvedValue({ positionMs: 0, durationMs: 3600000 });
    await NativePlayerBridge.openVod('https://example.test/movie.mp4', 'Film', 'test-film-sub', false, {
      url: 'https://example.test/sub.srt',
      content: '1\n00:00:01,000 --> 00:00:02,000\nBonjour',
    });
    expect(mocks.openVod).toHaveBeenCalledWith(
      expect.objectContaining({
        subtitleUrl: 'https://example.test/sub.srt',
        subtitleContent: '1\n00:00:01,000 --> 00:00:02,000\nBonjour',
      })
    );
  });
});

it('renvoie seulement une chaîne appartenant au contexte et maintient le verrou pendant son traitement', async () => {
  const channels: Channel[] = Array.from({ length: 2501 }, (_, i) => ({ id: String(i), name: `Chaîne ${i}`, url: `https://example.test/${i}.ts` }));
  const zap = buildNativeZap(channels, channels[2001]);
  expect(zap.urls.length).toBeLessThanOrEqual(300);
  expect(zap.urls[zap.index]).toBe(channels[2001].url);
  expect(zap.titles[zap.index]).toBe(channels[2001].name);
  const nextTarget = zap.urls[zap.index + 1];
  mocks.open.mockResolvedValue({ channelUrl: nextTarget });
  const returned = vi.fn(() => expect(isPlaybackDelegated()).toBe(true));
  expect(await NativePlayerBridge.open(channels[2001].url, channels[2001].name, zap, returned)).toBe(true);
  expect(returned).toHaveBeenCalledWith(nextTarget);
  mocks.open.mockResolvedValue({ channelUrl: 'https://other.test/private' });
  returned.mockClear();
  await NativePlayerBridge.open(channels[2001].url, channels[2001].name, zap, returned);
  expect(returned).not.toHaveBeenCalled();
});

it('joint groupes et programmes à venir au contexte de zapping', () => {
  const now = Date.now();
  const channels = [
    { id: 'a', name: 'A', url: 'https://example.test/a', group: 'Info' },
    { id: 'b', name: 'B', url: 'https://example.test/b' },
  ];
  const epg = {
    a: [
      { id: 'p0', channelId: 'a', title: 'Fini', startTime: new Date(now - 7200_000), endTime: new Date(now - 3600_000) },
      { id: 'p1', channelId: 'a', title: 'En cours', startTime: new Date(now - 600_000), endTime: new Date(now + 600_000) },
      { id: 'p2', channelId: 'a', title: 'Ensuite', startTime: new Date(now + 600_000), endTime: new Date(now + 1200_000) },
    ],
  };
  const zap = buildNativeZap(channels, channels[0], 300, epg);
  expect(zap.groups).toEqual(['Info', '']);
  expect(zap.epg?.[0].map(p => p[2])).toEqual(['En cours', 'Ensuite']);
  expect(zap.epg?.[1]).toEqual([]);
});

it('garde les voisins quand la chaîne sélectionnée est une variante', () => {
  const variant = { id: 'a-hd', name: 'A HD', url: 'https://example.test/a-hd' };
  const base = { id: 'a', name: 'A', url: 'https://example.test/a', variants: [variant] };
  expect(buildNativeZap([base, { id: 'b', name: 'B', url: 'https://example.test/b' }], variant)).toEqual({ urls: [variant.url, 'https://example.test/b'], titles: ['A HD', 'B'], index: 0, start: 0, numbers: ['1', '2'], total: 2 });
});

describe('Numéros de chaîne', () => {
  const channels: Channel[] = Array.from({ length: 2501 }, (_, i) => ({ id: String(i), name: `Chaîne ${i}`, url: `https://example.test/${i}.ts` }));

  it('numérote le contexte avec tvg-chno, sinon la position dans la liste complète', () => {
    const list = [...channels];
    list[2000] = { ...list[2000], chno: '42' };
    const zap = buildNativeZap(list, list[2001]);
    expect(zap.total).toBe(2501);
    expect(zap.numbers?.length).toBe(zap.urls.length);
    expect(zap.numbers?.[zap.index]).toBe('2002');
    expect(zap.numbers?.[zap.index - 1]).toBe('42');
  });

  it('retrouve une chaîne par tvg-chno avant la position, zéros de tête ignorés', () => {
    const list = [
      { id: 'a', name: 'A', url: 'https://example.test/a', chno: '7' },
      { id: 'b', name: 'B', url: 'https://example.test/b' },
    ];
    expect(findChannelByNumber(list, '007')?.id).toBe('a');
    expect(findChannelByNumber(list, '2')?.id).toBe('b');
    expect(findChannelByNumber(list, '3')).toBeNull();
    expect(findChannelByNumber(list, '0')).toBeNull();
  });

  it('ne donne jamais à la position un numéro déjà porté par un tvg-chno lointain', () => {
    const list = [...channels];
    list[2000] = { ...list[2000], chno: '1' };
    const nearStart = buildNativeZap(list, list[0]);
    expect(nearStart.numbers?.[0]).toBe('');
    expect(nearStart.numbers).not.toContain('1');
    expect(findChannelByNumber(list, '1')?.id).toBe('2000');
    const nearFar = buildNativeZap(list, list[2000]);
    expect(nearFar.numbers?.[nearFar.index]).toBe('1');
  });

  it('garde un tvg-chno en double pour sa première chaîne seulement', () => {
    const list = [...channels];
    list[100] = { ...list[100], chno: '5' };
    list[1900] = { ...list[1900], chno: '005' };
    const zap = buildNativeZap(list, list[1900]);
    expect(zap.numbers?.[zap.index]).toBe('1901');
    expect(zap.numbers).not.toContain('5');
    expect(findChannelByNumber(list, '5')?.id).toBe('100');
  });

  it('chaque numéro transmis désigne pour la page la même chaîne que pour le lecteur', () => {
    const list = channels.map((c, i) => (i % 97 === 0 ? { ...c, chno: String((i * 7) % 3000) } : c));
    for (const at of [0, 150, 1234, 2400, 2500]) {
      const zap = buildNativeZap(list, list[at]);
      zap.numbers?.forEach((n, i) => {
        if (!n) return;
        expect(findChannelByNumber(list, n)?.url).toBe(zap.urls[i]);
      });
      const shown = (zap.numbers ?? []).filter(Boolean);
      expect(new Set(shown).size).toBe(shown.length);
    }
  });

  it('transmet les numéros au plugin et relance sur un numéro hors contexte après la fermeture', async () => {
    const zap = buildNativeZap(channels, channels[10]);
    mocks.open.mockResolvedValue({ channelUrl: channels[10].url, jumpNumber: '2400' });
    const jump = vi.fn(() => expect(isPlaybackDelegated()).toBe(false));
    expect(await NativePlayerBridge.open(channels[10].url, channels[10].name, zap, undefined, jump)).toBe(true);
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ channelNumbers: zap.numbers, channelTotal: 2501 }));
    expect(jump).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(jump).toHaveBeenCalledWith('2400');
  });

  it('ignore un numéro renvoyé invalide', async () => {
    const zap = buildNativeZap(channels, channels[10]);
    mocks.open.mockResolvedValue({ channelUrl: channels[10].url, jumpNumber: '12a' });
    const jump = vi.fn();
    await NativePlayerBridge.open(channels[10].url, channels[10].name, zap, undefined, jump);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(jump).not.toHaveBeenCalled();
  });
});

it('sauvegarde chaque épisode visité sous sa propre identité après zapping', async () => {
  localStorage.clear();
  mocks.openVod.mockResolvedValue({ mediaId: 'p:series:2', positionMs: 95000, durationMs: 300000,
    progress: [
      { mediaId: 'p:series:1', positionMs: 70000, durationMs: 300000 },
      { mediaId: 'p:series:2', positionMs: 95000, durationMs: 300000 },
      { mediaId: 'other:series:3', positionMs: 120000, durationMs: 300000 },
    ] });
  await NativePlayerBridge.openVod('https://example.test/1.mp4', 'Série', 'p:series:1', false, undefined,
    { urls: ['https://example.test/1.mp4', 'https://example.test/2.mp4'], titles: ['1', '2'], ids: ['p:series:1', 'p:series:2'], index: 0 });
  expect(JSON.parse(localStorage.getItem('vod_progress_p:series:1') || '{}').positionMs).toBe(70000);
  expect(JSON.parse(localStorage.getItem('vod_progress_p:series:2') || '{}').positionMs).toBe(95000);
  expect(localStorage.getItem('vod_progress_other:series:3')).toBeNull();
});

it('transmet la programmation d’un direct HLS à Android (capture des segments)', async () => {
  mocks.scheduleRecording.mockResolvedValueOnce({ id: 'r1' });
  const start = Date.now() + 60000;
  expect(await RecordingsBridge.schedule('https://example.test/live.m3u8', 'HLS', start, 60000)).toBe(true);
  expect(mocks.scheduleRecording).toHaveBeenCalledWith({ url: 'https://example.test/live.m3u8', title: 'HLS', startTimeMs: start, durationMs: 60000, userAgent: DEFAULT_USER_AGENT });
  expect(mocks.error).not.toHaveBeenCalled();
});

it('fige le User-Agent de A dans la programmation avant le passage à B', async () => {
  let finish!: (value: { id: string }) => void;
  mocks.scheduleRecording.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setActiveUserAgent('Lecteur-A');
  const operation = RecordingsBridge.schedule('https://example.test/a.ts', 'A', Date.now() + 60000, 60000);
  setActiveUserAgent('Lecteur-B');
  finish({ id: 'a' });
  expect(await operation).toBe(true);
  expect(mocks.scheduleRecording).toHaveBeenLastCalledWith(expect.objectContaining({ userAgent: 'Lecteur-A' }));
});

it('renvoie à la page un numéro lointain de neuf chiffres', async () => {
  const onJump = vi.fn();
  mocks.open.mockResolvedValueOnce({ jumpNumber: '123456789' });
  await NativePlayerBridge.open('https://example.test/a.ts', 'A', undefined, undefined, onJump);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(onJump).toHaveBeenCalledWith('123456789');
});

it('programme une série sans message quand Android refuse (mode silencieux)', async () => {
  mocks.scheduleRecording.mockRejectedValueOnce(new Error('Choisis d’abord un dossier'));
  expect(await RecordingsBridge.schedule('https://example.test/a.ts', 'A', Date.now() + 60000, 60000, { silent: true })).toBe(false);
  expect(mocks.error).not.toHaveBeenCalled();
  mocks.scheduleRecording.mockRejectedValueOnce(new Error('Choisis d’abord un dossier'));
  expect(await RecordingsBridge.schedule('https://example.test/a.ts', 'A', Date.now() + 60000, 60000)).toBe(false);
  expect(mocks.error).toHaveBeenCalledWith('Choisis d’abord un dossier');
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

it('journalise le bilan de session natif après une vidéo (diagnostic local sans identifiants)', async () => {
  localStorage.clear();
  mocks.openVod.mockResolvedValue({ positionMs: 0, durationMs: 3600000,
    stats: { durationMs: 120000, zaps: 4, rebuffers: 2, rebufferMs: 1800, droppedFrames: 9, errors: 1, lastErrorCode: '2004' } });
  expect(await NativePlayerBridge.openVod('https://example.test/movie.mp4', 'Film', 'stats-film', false)).toBe(true);
  await flush();
  expect(telemetry.log).toHaveBeenCalledWith('native-session', expect.objectContaining({
    durationMs: 120000, zaps: 4, rebuffers: 2, rebufferMs: 1800, droppedFrames: 9, lastErrorCode: '2004',
  }));
});

it('journalise aussi le bilan du direct et rien sans bilan', async () => {
  mocks.open.mockResolvedValue({ channelUrl: 'https://example.test/b', stats: { zaps: 12, rebuffers: 0 } });
  await NativePlayerBridge.open('https://example.test/a', 'A');
  await flush();
  expect(telemetry.log).toHaveBeenCalledWith('native-session', expect.objectContaining({ zaps: 12 }));
  telemetry.log.mockClear();
  mocks.open.mockResolvedValue({ channelUrl: 'https://example.test/b' });
  await NativePlayerBridge.open('https://example.test/a', 'A');
  await flush();
  expect(telemetry.log).not.toHaveBeenCalled();
});
it('transmet les logos au plugin et les omet quand aucune chaîne n’en porte', async () => {
  const withLogo: Channel[] = [
    { id: '1', name: 'Une', url: 'https://example.test/1.ts', logo: 'https://example.test/1.png' },
    { id: '2', name: 'Deux', url: 'https://example.test/2.ts' },
  ];
  const zapWithLogo = buildNativeZap(withLogo, withLogo[0]);
  expect(zapWithLogo.logos).toEqual(['https://example.test/1.png', '']);
  mocks.open.mockResolvedValueOnce({ channelUrl: withLogo[0].url });
  await NativePlayerBridge.open(withLogo[0].url, withLogo[0].name, zapWithLogo);
  expect(mocks.open).toHaveBeenLastCalledWith(expect.objectContaining({
    channelLogos: ['https://example.test/1.png', ''],
  }));

  const withoutLogo: Channel[] = [
    { id: '1', name: 'Une', url: 'https://example.test/1.ts' },
    { id: '2', name: 'Deux', url: 'https://example.test/2.ts' },
  ];
  const zapWithoutLogo = buildNativeZap(withoutLogo, withoutLogo[0]);
  expect(zapWithoutLogo.logos).toBeUndefined();
  mocks.open.mockResolvedValueOnce({ channelUrl: withoutLogo[0].url });
  await NativePlayerBridge.open(withoutLogo[0].url, withoutLogo[0].name, zapWithoutLogo);
  expect(mocks.open.mock.lastCall?.[0]).not.toHaveProperty('channelLogos');
});