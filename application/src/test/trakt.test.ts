import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestDeviceCode,
  pollDeviceToken,
  refreshTraktToken,
  getValidTraktAccessToken,
  fetchTraktUserProfile,
  fetchTraktHistory,
  traktHistoryToWatchEntries,
  syncTraktHistory,
  scrobbleTrakt,
  parseSeasonAndEpisode,
  maybeScrobbleTrakt,
  resetScrobbleSessions,
  getPendingTraktScrobbles,
  enqueuePendingTraktScrobble,
  clearPendingTraktScrobbles,
  flushPendingTraktScrobbles,
  isTraktConnected,
  TraktError,
  type TraktHistoryItem,
} from '@/utils/trakt';
import * as idb from '@/utils/idb';

describe('trakt integration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetScrobbleSessions();
    clearPendingTraktScrobbles();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearPendingTraktScrobbles();
  });

  it('isTraktConnected détecte la présence du token', () => {
    expect(isTraktConnected(null)).toBe(false);
    expect(isTraktConnected({})).toBe(false);
    expect(isTraktConnected({ traktToken: '' })).toBe(false);
    expect(isTraktConnected({ traktToken: '   ' })).toBe(false);
    expect(isTraktConnected({ traktToken: 'valid-token' })).toBe(true);
  });

  it('requestDeviceCode demande et renvoie le code appareil', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        device_code: 'dev-123',
        user_code: 'WD48-NKQ5',
        verification_url: 'https://trakt.tv/activate',
        expires_in: 600,
        interval: 5,
      }),
    } as unknown as Response);

    const res = await requestDeviceCode('custom-client');
    expect(res).toEqual({
      device_code: 'dev-123',
      user_code: 'WD48-NKQ5',
      verification_url: 'https://trakt.tv/activate',
      expires_in: 600,
      interval: 5,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.trakt.tv/oauth/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'custom-client' }),
    });
  });

  it('requestDeviceCode lève une exception descriptive en cas d’erreur HTTP', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid Client ID',
    } as unknown as Response);

    await expect(requestDeviceCode('bad-id')).rejects.toThrow(/401.*Invalid Client ID/);
  });

  it('pollDeviceToken gère les différents statuts de polling', async () => {
    // 1. Success 200
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        access_token: 'acc-123',
        token_type: 'bearer',
        expires_in: 7200,
        refresh_token: 'ref-123',
        scope: 'public',
        created_at: 1000,
      }),
    } as unknown as Response);

    const res200 = await pollDeviceToken('code-1', 'client-1', 'secret-1');
    expect(res200).toEqual({
      status: 'success',
      tokens: {
        access_token: 'acc-123',
        token_type: 'bearer',
        expires_in: 7200,
        refresh_token: 'ref-123',
        scope: 'public',
        created_at: 1000,
      },
    });

    // 2. Pending 400
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 400 } as unknown as Response);
    expect(await pollDeviceToken('code-1')).toEqual({ status: 'pending' });

    // 3. Expired 404 & 410
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 404 } as unknown as Response);
    expect(await pollDeviceToken('code-1')).toEqual({ status: 'expired' });

    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 410 } as unknown as Response);
    expect(await pollDeviceToken('code-1')).toEqual({ status: 'expired' });

    // 4. Denied 418
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 418 } as unknown as Response);
    expect(await pollDeviceToken('code-1')).toEqual({ status: 'denied' });

    // 5. Slow down 429
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ status: 429 } as unknown as Response);
    expect(await pollDeviceToken('code-1')).toEqual({ status: 'slow_down' });
  });

  it('refreshTraktToken renouvelle les jetons via POST /oauth/token', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'new-acc-999',
        token_type: 'bearer',
        expires_in: 7200,
        refresh_token: 'new-ref-999',
        scope: 'public',
        created_at: 2000,
      }),
    } as unknown as Response);

    const res = await refreshTraktToken('old-ref', 'my-client', 'my-secret');
    expect(res.access_token).toBe('new-acc-999');
    expect(res.refresh_token).toBe('new-ref-999');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.trakt.tv/oauth/token', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: 'old-ref',
        client_id: 'my-client',
        grant_type: 'refresh_token',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        client_secret: 'my-secret',
      }),
    }));
  });

  it('getValidTraktAccessToken renouvelle si le jeton est proche de l’expiration', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'fresh-acc',
        token_type: 'bearer',
        expires_in: 7200,
        refresh_token: 'fresh-ref',
        scope: 'public',
        created_at: Math.floor(Date.now() / 1000),
      }),
    } as unknown as Response);

    const onUpdate = vi.fn();
    // Expirant dans 2 minutes
    const settings = {
      traktToken: 'expiring-token',
      traktRefreshToken: 'valid-refresh',
      traktExpiresAt: Date.now() + 120_000,
    };

    const token = await getValidTraktAccessToken(settings, onUpdate);
    expect(token).toBe('fresh-acc');
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        traktToken: 'fresh-acc',
        traktRefreshToken: 'fresh-ref',
      }),
    );
  });

  it('fetchTraktUserProfile récupère les données de profil', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        username: 'ced_fan',
        name: 'Cédric',
        vip: true,
      }),
    } as unknown as Response);

    const user = await fetchTraktUserProfile('token-abc', 'client-xyz');
    expect(user).toEqual({
      username: 'ced_fan',
      name: 'Cédric',
      vip: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.trakt.tv/users/me', {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': 'client-xyz',
        Authorization: 'Bearer token-abc',
      },
    });
  });

  it('fetchTraktHistory lève une TraktError en cas de 401 ou 403', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as unknown as Response);

    await expect(fetchTraktHistory('bad-token')).rejects.toThrow(TraktError);
    await expect(fetchTraktHistory('bad-token')).rejects.toThrow(/401/);
  });

  it('fetchTraktHistory fusionne films et épisodes et trie par date décroissante', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/sync/history/movies')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 1,
              watched_at: '2026-11-10T12:00:00.000Z',
              type: 'movie',
              movie: { title: 'Dune: Part Two', year: 2024, ids: { tmdb: 693134 } },
            },
          ],
        } as unknown as Response;
      }
      if (url.includes('/sync/history/episodes')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 2,
              watched_at: '2026-11-12T15:00:00.000Z',
              type: 'episode',
              show: { title: 'Severance', ids: { tmdb: 95396 } },
              episode: { season: 1, number: 1, title: 'Good News About Hell' },
            },
          ],
        } as unknown as Response;
      }
      return { ok: false, status: 400 } as unknown as Response;
    });

    const items = await fetchTraktHistory('token-abc');
    expect(items).toHaveLength(2);
    // Le plus récent d'abord (Severance le 12/11, puis Dune le 10/11)
    expect(items[0].type).toBe('episode');
    expect(items[0].show?.title).toBe('Severance');
    expect(items[1].type).toBe('movie');
    expect(items[1].movie?.title).toBe('Dune: Part Two');
  });

  it('traktHistoryToWatchEntries associe l’identifiant TMDB de la série à tmdbId (et non celui de l’épisode)', () => {
    const raw: TraktHistoryItem[] = [
      {
        id: 1,
        watched_at: '2026-11-10T12:00:00.000Z',
        action: 'watch',
        type: 'movie',
        movie: {
          title: 'Inception',
          year: 2010,
          ids: { tmdb: 27205 },
        },
      },
      {
        id: 2,
        watched_at: '2026-11-11T20:00:00.000Z',
        action: 'watch',
        type: 'episode',
        show: {
          title: 'Breaking Bad',
          year: 2008,
          ids: { tmdb: 1396 },
        },
        episode: {
          season: 2,
          number: 5,
          title: 'Breakage',
          ids: { tmdb: 62089 },
        },
      },
    ];

    const entries = traktHistoryToWatchEntries(raw);
    expect(entries).toHaveLength(2);

    expect(entries[0]).toMatchObject({
      channelId: 'trakt:movie:27205',
      channelName: 'Inception',
      name: 'Inception',
      mediaKind: 'movie',
      platform: 'trakt',
      sourceId: '27205',
      tmdbId: 27205,
      year: '2010',
      completed: true,
    });

    // L'entrée de série DOIT avoir tmdbId = 1396 (show TMDB ID) pour le profil de goût
    expect(entries[1]).toMatchObject({
      channelId: 'trakt:series:1396:s2e5',
      channelName: 'Breaking Bad S2E5 · Breakage',
      name: 'Breaking Bad',
      episodeName: 'Breakage',
      mediaKind: 'series',
      platform: 'trakt',
      sourceId: '1396',
      tmdbId: 1396,
      episodeTmdbId: 62089,
      season: 2,
      episode: 5,
      year: '2008',
      completed: true,
    });
  });

  it('syncTraktHistory intègre et sauvegarde les visionnages dans externalWatches', async () => {
    const existing: idb.PlayHistoryEntry[] = [
      { channelId: 'existing:1', ts: 1000, name: 'Old', platform: 'netflix' },
    ];
    vi.spyOn(idb, 'getExternalWatches').mockResolvedValue(existing);
    const saveSpy = vi.spyOn(idb, 'saveExternalWatches').mockResolvedValue();

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/movies')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 10,
              watched_at: '2026-11-12T10:00:00.000Z',
              type: 'movie',
              movie: { title: 'Gladiator II', year: 2024, ids: { tmdb: 558449 } },
            },
          ],
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });

    const result = await syncTraktHistory('token-abc');
    expect(result.added).toBe(1);
    expect(result.total).toBe(2);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Gladiator II', platform: 'trakt' }),
        expect.objectContaining({ name: 'Old', platform: 'netflix' }),
      ]),
    );
  });

  it('scrobbleTrakt envoie les bonnes requêtes et refuse le scrobble de série sans épisode connu', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);

    // Film
    const okMovie = await scrobbleTrakt(
      'start',
      { kind: 'movie', title: 'Oppenheimer', year: 2023, tmdbId: 872585, progress: 15 },
      'tok-1',
    );
    expect(okMovie).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.trakt.tv/scrobble/start', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
      body: JSON.stringify({
        movie: { title: 'Oppenheimer', year: 2023, ids: { tmdb: 872585 } },
        progress: 15,
      }),
    }));

    // Série avec numéros explicites
    const okSeries = await scrobbleTrakt(
      'stop',
      { kind: 'series', title: 'Succession', season: 4, episode: 3, progress: 85 },
      'tok-1',
    );
    expect(okSeries).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.trakt.tv/scrobble/stop', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
      body: JSON.stringify({
        show: { title: 'Succession' },
        episode: { season: 4, number: 3 },
        progress: 85,
      }),
    }));

    // Série sans épisode ni saison : ne scrobble PAS un faux S01E01
    const noEp = await scrobbleTrakt(
      'start',
      { kind: 'series', title: 'Unknown Ep Show', progress: 10 },
      'tok-1',
    );
    expect(noEp).toBe(false);

    // Série avec numéro d'épisode mais sans saison connue : NE REPLIE PAS sur S01E05
    const epWithoutSeason = await scrobbleTrakt(
      'start',
      { kind: 'series', title: 'Unknown Season Show', episode: 5, progress: 10 },
      'tok-1',
    );
    expect(epWithoutSeason).toBe(false);

    // Tolérance d'erreur réseau
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network fail'));
    const failed = await scrobbleTrakt(
      'pause',
      { kind: 'movie', title: 'Test', progress: 50 },
      'tok-1',
    );
    expect(failed).toBe(false);
  });

  it('scrobbleTrakt retente avec un jeton renouvelé en cas de 401 si un callback onUnauthorized est fourni', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ status: 401 } as unknown as Response);
      }
      return Promise.resolve({ status: 201 } as unknown as Response);
    });

    const onUnauthorized = vi.fn().mockResolvedValue('new-fresh-token');
    const ok = await scrobbleTrakt(
      'start',
      { kind: 'movie', title: 'Dune', progress: 10 },
      'expired-token',
      undefined,
      onUnauthorized,
    );

    expect(ok).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      'https://api.trakt.tv/scrobble/start',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-fresh-token' }),
      }),
    );
  });

  it('parseSeasonAndEpisode ne fait aucun repli aveugle sur S01E01', () => {
    expect(parseSeasonAndEpisode('S02E05')).toEqual({ season: 2, episode: 5 });
    expect(parseSeasonAndEpisode('Breaking Bad s1e3')).toEqual({ season: 1, episode: 3 });
    expect(parseSeasonAndEpisode('Titre 3x12')).toEqual({ season: 3, episode: 12 });
    expect(parseSeasonAndEpisode('Épisode 8')).toEqual({ episode: 8 });
    expect(parseSeasonAndEpisode('Titre sans rien')).toEqual({});
    expect(parseSeasonAndEpisode(undefined)).toEqual({});
  });

  it('maybeScrobbleTrakt protège contre les doublons via une clé stable même si entry.ts varie', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };

    const sessionId = 'session-web-stable-123';

    // Premier tick à 5s (ts = 1000)
    const tick1 = {
      channelId: 'vod:demo:series:99',
      name: 'The Bear',
      season: 2,
      episode: 6,
      episodeName: 'Fishes',
      mediaKind: 'series' as const,
      ts: 1000,
    };
    const started = await maybeScrobbleTrakt(tick1, 10000, 1800000, false, settings, sessionId);
    expect(started).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Deuxième tick à 10s avec ts modifié (ex: Date.now() = 6000) : NE DOIT PAS renvoyer start
    globalThis.fetch = vi.fn();
    const tick2 = { ...tick1, ts: 6000 };
    const secondCall = await maybeScrobbleTrakt(tick2, 15000, 1800000, false, settings, sessionId);
    expect(secondCall).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Troisième tick à 85% de progression : envoie stop UNE SEULE FOIS
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);
    const tick3 = { ...tick1, ts: 1500000 };
    const stopped = await maybeScrobbleTrakt(tick3, 1600000, 1800000, false, settings, sessionId);
    expect(stopped).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Quatrième tick à 90% : ne re-scrobble pas stop
    globalThis.fetch = vi.fn();
    const tick4 = { ...tick1, ts: 1700000 };
    const stoppedAgain = await maybeScrobbleTrakt(tick4, 1700000, 1800000, false, settings, sessionId);
    expect(stoppedAgain).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('maybeScrobbleTrakt ne bloque pas définitivement la session en cas d’erreur réseau temporaire et retente', async () => {
    // 1er appel à 5s : panne réseau
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Erreur réseau temporaire'));

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };
    const sessionId = 'session-network-retry-test';
    const entry = {
      channelId: 'vod:movie:retry',
      name: 'Gladiator II',
      mediaKind: 'movie' as const,
      ts: 1000,
    };

    const firstAttempt = await maybeScrobbleTrakt(entry, 6000, 7200000, false, settings, sessionId);
    expect(firstAttempt).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // 2e appel à 10s : réseau rétabli, doit retenter et réussir !
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);
    const secondAttempt = await maybeScrobbleTrakt(entry, 10000, 7200000, false, settings, sessionId);
    expect(secondAttempt).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.trakt.tv/scrobble/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maybeScrobbleTrakt renouvelle automatiquement un jeton expiré avant de scrobbler', async () => {
    // Jeton expiré il y a 1 heure avec refresh token
    const settings = {
      traktToken: 'token-perime',
      traktRefreshToken: 'valid-refresh-token',
      traktExpiresAt: Date.now() - 3600 * 1000,
      traktScrobble: true,
    };
    const onSettingsUpdated = vi.fn();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth/token')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            access_token: 'brand-new-token',
            refresh_token: 'next-refresh-token',
            expires_in: 7776000,
            created_at: Math.floor(Date.now() / 1000),
            token_type: 'bearer',
            scope: 'public',
          }),
        } as unknown as Response);
      }
      if (url.includes('/scrobble/start')) {
        return Promise.resolve({ status: 201 } as unknown as Response);
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const entry = {
      channelId: 'vod:movie:token-refresh',
      name: 'Interstellar',
      mediaKind: 'movie' as const,
      ts: 1000,
    };

    const ok = await maybeScrobbleTrakt(
      entry,
      6000,
      10000000,
      false,
      settings,
      'session-token-refresh',
      onSettingsUpdated,
    );

    expect(ok).toBe(true);
    expect(onSettingsUpdated).toHaveBeenCalledWith(expect.objectContaining({
      traktToken: 'brand-new-token',
      traktRefreshToken: 'next-refresh-token',
    }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.trakt.tv/scrobble/start',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer brand-new-token' }),
      }),
    );
  });

  it('maybeScrobbleTrakt en mode fermé (Android/fermeture lecteur) ne scrobble pas si < 5s et envoie stop après visionnage réel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };
    const entry = {
      channelId: 'vod:movie:real-playback',
      name: 'Inception',
      mediaKind: 'movie' as const,
      ts: 1000,
    };

    // Cas 1 : Lancement avorté / annulé après 2 secondes (position < 5s) -> aucun scrobble
    const cancelled = await maybeScrobbleTrakt(
      entry,
      2000,
      7200000,
      false,
      settings,
      'session-cancel',
      undefined,
      true, // isClosed: true
    );
    expect(cancelled).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Cas 2 : Visionnage réel de 30 minutes (25%) puis fermeture du lecteur natif -> envoie stop avec 25%
    const stopped = await maybeScrobbleTrakt(
      entry,
      1800000,
      7200000,
      false,
      settings,
      'session-real-stop',
      undefined,
      true, // isClosed: true
    );
    expect(stopped).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.trakt.tv/scrobble/stop',
      expect.objectContaining({
        body: JSON.stringify({
          movie: { title: 'Inception' },
          progress: 25,
        }),
      }),
    );
  });

  it('maybeScrobbleTrakt verrouille immédiatement avant le premier await et élimine tout appel concurrent simultané', async () => {
    // Simule une requête avec latence réseau
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 20));
      return { status: 201 } as unknown as Response;
    });

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };
    const entry = {
      channelId: 'vod:movie:race-test',
      name: 'Dune Part Two',
      mediaKind: 'movie' as const,
      ts: 1000,
    };
    const sessionId = 'session-concurrent-race-1';

    // Deux appels déclenchés simultanément dans le même cycle d'événements
    const [call1, call2] = await Promise.all([
      maybeScrobbleTrakt(entry, 10000, 7200000, false, settings, sessionId),
      maybeScrobbleTrakt(entry, 10000, 7200000, false, settings, sessionId),
    ]);

    // Un seul doit avoir acquis le verrou et exécuté la requête, le second doit être neutralisé
    expect([call1, call2]).toContain(true);
    expect([call1, call2]).toContain(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('maybeScrobbleTrakt distingue position et temps réellement regardé : reprise à 40 min avec fermeture immédiate ne scrobble pas', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };
    const entry = {
      channelId: 'vod:movie:resume-test',
      name: 'Oppenheimer',
      mediaKind: 'movie' as const,
      ts: 1000,
    };

    // Cas 1 : Reprise à 40 min (2 400 000 ms), fermeture immédiate après 1,2s (watchDurationMs = 1200)
    // Malgré positionMs >= 5000, le temps réellement regardé dans la session est < 5s -> aucun scrobble !
    const instantClose = await maybeScrobbleTrakt(
      entry,
      2401200,
      10800000,
      false,
      settings,
      'session-resume-instant',
      undefined,
      true, // isClosed
      1200, // watchDurationMs
    );
    expect(instantClose).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Cas 2 : Reprise à 40 min, visionnage effectif de 30 secondes puis fermeture
    const genuineWatched = await maybeScrobbleTrakt(
      entry,
      2430000,
      10800000,
      false,
      settings,
      'session-resume-watched',
      undefined,
      true, // isClosed
      30000, // watchDurationMs = 30s
    );
    expect(genuineWatched).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.trakt.tv/scrobble/stop',
      expect.objectContaining({
        body: JSON.stringify({
          movie: { title: 'Oppenheimer' },
          progress: 23,
        }),
      }),
    );
  });

  it('maybeScrobbleTrakt retente jusqu’à 2 fois à la fermeture et enregistre dans la file d’attente hors-ligne si le réseau échoue', async () => {
    // Panne réseau sur toutes les tentatives
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    const settings = {
      traktToken: 'token-active',
      traktClientId: 'my-client-id',
      traktScrobble: true,
    };
    const entry = {
      channelId: 'vod:movie:offline-stop',
      name: 'Arrival',
      mediaKind: 'movie' as const,
      ts: 1000,
    };

    const result = await maybeScrobbleTrakt(
      entry,
      3600000,
      7200000,
      false,
      settings,
      'session-offline-close',
      undefined,
      true, // isClosed: true
      60000, // watchDurationMs = 60s
    );

    // L'appel direct échoue
    expect(result).toBe(false);
    // Mais il a retenté 2 fois (1 initial + 2 retries = 3 appels)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    // Et l'élément a été sauvegardé dans la file d'attente hors-ligne !
    const pending = getPendingTraktScrobbles();
    expect(pending).toHaveLength(1);
    expect(pending[0].sessionKey).toBe('session-offline-close');
    expect(pending[0].action).toBe('stop');

    // Le réseau revient : flushPendingTraktScrobbles rejoue l'élément
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);
    const flushedCount = await flushPendingTraktScrobbles(settings);
    expect(flushedCount).toBe(1);
    expect(getPendingTraktScrobbles()).toHaveLength(0);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.trakt.tv/scrobble/stop',
      expect.objectContaining({
        headers: expect.objectContaining({ 'trakt-api-key': 'my-client-id' }),
      }),
    );
  });

  it('maybeScrobbleTrakt empêche tout start pendant ou après un stop à 85% de progression', async () => {
    const requestedEndpoints: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      await new Promise(r => setTimeout(r, 20));
      requestedEndpoints.push(url);
      return { status: 201 } as unknown as Response;
    });

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };
    const entry = {
      channelId: 'vod:movie:stop-start-race',
      name: 'Blade Runner 2049',
      mediaKind: 'movie' as const,
      ts: 1000,
    };
    const sessionId = 'session-stop-start-race';

    // À 85 % de progression (6 120 000 / 7 200 000 ms), deux appels concurrents arrivent dans le même tick
    const [call1, call2] = await Promise.all([
      maybeScrobbleTrakt(entry, 6120000, 7200000, false, settings, sessionId, undefined, false, 60000),
      maybeScrobbleTrakt(entry, 6120000, 7200000, false, settings, sessionId, undefined, false, 60000),
    ]);

    // Un seul appel doit avoir envoyé 'stop', et aucun appel ne doit avoir basculé vers 'start'
    expect([call1, call2]).toContain(true);
    expect([call1, call2]).toContain(false);
    expect(requestedEndpoints).toEqual(['https://api.trakt.tv/scrobble/stop']);

    // Un tick suivant ne doit jamais pouvoir envoyer 'start' après un stop
    const postStopTick = await maybeScrobbleTrakt(entry, 6150000, 7200000, false, settings, sessionId, undefined, false, 70000);
    expect(postStopTick).toBe(false);
    expect(requestedEndpoints).toHaveLength(1);
  });

  it('flushPendingTraktScrobbles refuse de vidanger si traktScrobble est désactivé', async () => {
    globalThis.fetch = vi.fn();
    enqueuePendingTraktScrobble({
      action: 'stop',
      payload: { kind: 'movie', title: 'The Matrix', progress: 100 },
      sessionKey: 'session-matrix-disabled',
      timestamp: Date.now(),
    });

    // Option traktScrobble: false dans les réglages
    const settings = {
      traktToken: 'token-active',
      traktScrobble: false,
    };

    const count = await flushPendingTraktScrobbles(settings);
    expect(count).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // L'élément reste en attente et n'a pas été envoyé en fraude
    expect(getPendingTraktScrobbles()).toHaveLength(1);
  });

  it('flushPendingTraktScrobbles ne perd pas d’élément ajouté pendant le vidage et mutualise les appels concurrents', async () => {
    let resolveFirstScrobble: (res: Response) => void;
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveFirstScrobble = resolve as (res: Response) => void;
    }));

    enqueuePendingTraktScrobble({
      action: 'stop',
      payload: { kind: 'movie', title: 'Pulp Fiction', progress: 95 },
      sessionKey: 'session-pulp-1',
      timestamp: Date.now(),
    });

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };

    // Lancement de deux vidages simultanés (mutualisation par promesse active)
    const flushPromise1 = flushPendingTraktScrobbles(settings);
    const flushPromise2 = flushPendingTraktScrobbles(settings);

    // Pendant que la première requête est en vol, un autre média se ferme hors-ligne
    enqueuePendingTraktScrobble({
      action: 'stop',
      payload: { kind: 'movie', title: 'Kill Bill', progress: 50 },
      sessionKey: 'session-killbill-2',
      timestamp: Date.now(),
    });

    // Laisser la microtâche atteindre fetch
    await new Promise(r => setTimeout(r, 10));
    // Résolution du premier appel réseau
    resolveFirstScrobble!({ status: 201 } as unknown as Response);

    const [res1, res2] = await Promise.all([flushPromise1, flushPromise2]);
    // Les deux promesses ont partagé le même traitement sans dupliquer les requêtes
    expect(res1).toBe(1);
    expect(res2).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // L'élément ajouté pendant le vidage est TOUJOURS présent et n'a pas été écrasé !
    const remaining = getPendingTraktScrobbles();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionKey).toBe('session-killbill-2');

    // Le vidage suivant évacue ce deuxième élément sans encombre
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 201 } as unknown as Response);
    const secondFlush = await flushPendingTraktScrobbles(settings);
    expect(secondFlush).toBe(1);
    expect(getPendingTraktScrobbles()).toHaveLength(0);
  });

  it('maybeScrobbleTrakt diffère puis envoie le stop si le lecteur ferme pendant un start en cours', async () => {
    let resolveStart!: (value: Response) => void;
    const requestedEndpoints: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      requestedEndpoints.push(url);
      if (url.endsWith('/scrobble/start')) {
        return new Promise<Response>(resolve => { resolveStart = resolve; });
      }
      return Promise.resolve({ status: 201 } as unknown as Response);
    });

    const settings = {
      traktToken: 'token-active',
      traktScrobble: true,
    };
    const entry = {
      channelId: 'vod:movie:close-during-start',
      name: 'Interstellar',
      mediaKind: 'movie' as const,
      ts: 1000,
    };
    const sessionId = 'session-close-during-start';

    // 1. Le start démarre et reste en vol
    const startPromise = maybeScrobbleTrakt(entry, 10000, 7200000, false, settings, sessionId, undefined, false, 10000);
    await new Promise(r => setTimeout(r, 10));
    expect(requestedEndpoints).toEqual(['https://api.trakt.tv/scrobble/start']);

    // 2. Pendant que le start est en vol, le lecteur ferme (isClosed = true)
    const stopPromise = maybeScrobbleTrakt(entry, 45000, 7200000, false, settings, sessionId, undefined, true, 45000);
    // Le stop ne doit pas partir avant la fin du start
    expect(requestedEndpoints).toEqual(['https://api.trakt.tv/scrobble/start']);

    // 3. Le start se termine : le stop différé doit partir automatiquement dans la foulée
    resolveStart({ status: 201 } as unknown as Response);
    const [started, stopped] = await Promise.all([startPromise, stopPromise]);

    expect(started).toBe(true);
    expect(stopped).toBe(true);
    expect(requestedEndpoints).toEqual([
      'https://api.trakt.tv/scrobble/start',
      'https://api.trakt.tv/scrobble/stop',
    ]);
  });

  it('déduplique les appels concurrents à getValidTraktAccessToken pendant un rafraîchissement', async () => {
    let refreshCalls = 0;
    let resolveRefresh!: (res: Response) => void;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth/token')) {
        refreshCalls += 1;
        return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
      }
      return Promise.reject(new Error(`URL inattendue: ${url}`));
    });

    const settings = {
      traktToken: 'expiring-token',
      traktRefreshToken: 'shared-refresh-token',
      traktExpiresAt: Date.now() + 60_000, // expire dans 1 min (< 10 min)
      traktClientId: 'client-id',
    };

    const p1 = getValidTraktAccessToken(settings);
    const p2 = getValidTraktAccessToken(settings);
    await new Promise(r => setTimeout(r, 10));
    expect(refreshCalls).toBe(1);

    resolveRefresh({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'fresh-token',
        refresh_token: 'fresh-refresh',
        expires_in: 7200,
        created_at: Math.floor(Date.now() / 1000),
        token_type: 'bearer',
        scope: 'public',
      }),
    } as unknown as Response);

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe('fresh-token');
    expect(t2).toBe('fresh-token');
    expect(refreshCalls).toBe(1);
  });
});
