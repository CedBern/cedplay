import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayHistoryEntry } from '@/utils/idb';
import type { PlaylistInfo } from '@/types/channel';
import type { AdultVodFilter } from '@/hooks/useAdultVodCategories';
import * as xtreamCatalog from '@/utils/xtreamCatalog';
import { categoryCatalogCache, clearVodCategoryCache } from '@/utils/vodPosterCache';
import { readForYouSnapshot, saveForYouSnapshot } from '@/utils/discover';
import {
  feedHomeRecommendations,
  historySignature,
  resolveTargetCategoryIds,
  shouldRefreshRecommendations,
  watchedCategoryIds,
} from '@/utils/discoverRecommendations';

const playlist: PlaylistInfo = {
  id: 'liste-recs',
  name: 'Liste Test',
  channels: [],
  groups: [],
};

const account: xtreamCatalog.XtreamAccount = {
  server: 'https://iptv.example.test',
  username: 'user1',
  password: 'pass1',
};

const permissiveAdult: AdultVodFilter = {
  ready: true,
  isAdult: () => false,
};

const strictAdult: AdultVodFilter = {
  ready: true,
  isAdult: (_kind, categoryId) => categoryId === 'adult-cat',
};

beforeEach(() => {
  localStorage.clear();
  clearVodCategoryCache();
  vi.restoreAllMocks();
});

describe('historySignature & shouldRefreshRecommendations', () => {
  it('génère une signature vide sans visionnage qualifié', () => {
    expect(historySignature([], playlist.id, 'movie')).toBe('');
    const liveOnly: PlayHistoryEntry[] = [
      { channelId: 'live:1', ts: Date.now(), kind: 'live', name: 'TF1' },
    ];
    expect(historySignature(liveOnly, playlist.id, 'movie')).toBe('');
  });

  it('génère une signature déterministe pour les titres complétés ou commencés >= 1 min', () => {
    const history: PlayHistoryEntry[] = [
      {
        channelId: `vod:${playlist.id}:movie:10`,
        kind: 'vod',
        mediaKind: 'movie',
        playlistId: playlist.id,
        name: 'Inception',
        status: 'completed',
        positionMs: 600000,
        ts: 100,
      },
      {
        channelId: `vod:${playlist.id}:movie:20`,
        kind: 'vod',
        mediaKind: 'movie',
        playlistId: playlist.id,
        name: 'Interstellar',
        positionMs: 120000,
        ts: 200,
      },
    ];
    const sig1 = historySignature(history, playlist.id, 'movie');
    expect(sig1).toContain('vod:liste-recs:movie:20');
    expect(sig1).toContain('vod:liste-recs:movie:10');

    // Une progression de 30 secondes (même minute) ne change pas la signature
    const historySlightAdvance: PlayHistoryEntry[] = [
      { ...history[0] },
      { ...history[1], positionMs: 140000 },
    ];
    expect(historySignature(historySlightAdvance, playlist.id, 'movie')).toBe(sig1);

    // Une progression d'au moins une minute change la signature
    const historyAdvanceMin: PlayHistoryEntry[] = [
      { ...history[0] },
      { ...history[1], positionMs: 180000 },
    ];
    expect(historySignature(historyAdvanceMin, playlist.id, 'movie')).not.toBe(sig1);
  });

  it('détecte le besoin d’actualisation (cache vide, ancien cache sans sourceId, changement de signature)', () => {
    const history: PlayHistoryEntry[] = [
      {
        channelId: `vod:${playlist.id}:movie:10`,
        kind: 'vod',
        mediaKind: 'movie',
        playlistId: playlist.id,
        name: 'Inception',
        status: 'completed',
        ts: 100,
      },
    ];
    // 1. Cache vide -> true
    expect(shouldRefreshRecommendations(playlist.id, 'movie', history)).toBe(true);

    // 2. Cache avec item sans sourceId -> true (migration/amélioration pour « Parce que tu as regardé »)
    saveForYouSnapshot(playlist.id, [{ id: '1', name: 'Dune' }], 'movie');
    expect(shouldRefreshRecommendations(playlist.id, 'movie', history)).toBe(true);

    // 3. Cache avec sourceId et signature connue identique -> false
    saveForYouSnapshot(playlist.id, [{ id: '1', name: 'Dune', sourceId: `vod:${playlist.id}:movie:10` }], 'movie');
    const sig = historySignature(history, playlist.id, 'movie');
    expect(shouldRefreshRecommendations(playlist.id, 'movie', history, sig)).toBe(false);

    // 4. Si la signature change -> true
    expect(shouldRefreshRecommendations(playlist.id, 'movie', history, 'ancienne-sig')).toBe(true);
  });
});

describe('watchedCategoryIds & resolveTargetCategoryIds', () => {
  it('extrait les catégories des films vus par récence et exclut les adultes', () => {
    const history: PlayHistoryEntry[] = [
      {
        channelId: `vod:${playlist.id}:movie:1`,
        kind: 'vod',
        playlistId: playlist.id,
        mediaKind: 'movie',
        name: 'Film 1',
        categoryId: 'cat-action',
        status: 'completed',
        ts: 50,
      },
      {
        channelId: `vod:${playlist.id}:movie:2`,
        kind: 'vod',
        playlistId: playlist.id,
        mediaKind: 'movie',
        name: 'Film 2',
        categoryId: 'adult-cat',
        status: 'completed',
        ts: 80,
      },
      {
        channelId: `vod:${playlist.id}:movie:3`,
        kind: 'vod',
        playlistId: playlist.id,
        mediaKind: 'movie',
        name: 'Film 3',
        categoryId: 'cat-sci-fi',
        status: 'completed',
        ts: 100,
      },
    ];

    const cats = watchedCategoryIds(history, playlist.id, 'movie', strictAdult);
    // cat-sci-fi (ts: 100) puis cat-action (ts: 50), adult-cat est rejeté
    expect(cats).toEqual(['cat-sci-fi', 'cat-action']);
  });

  it('se replie sur les catégories générales si aucun film n’a de categoryId', async () => {
    const history: PlayHistoryEntry[] = [
      {
        channelId: `vod:${playlist.id}:movie:1`,
        kind: 'vod',
        playlistId: playlist.id,
        mediaKind: 'movie',
        name: 'Film Sans Categorie',
        status: 'completed',
        ts: 50,
      },
    ];

    const requestSpy = vi.spyOn(xtreamCatalog, 'catalogRequest').mockResolvedValue([
      { category_id: '1', category_name: 'test' },
      { category_id: '10', category_name: 'Top Films 2026' },
      { category_id: '20', category_name: 'Divers' },
    ]);

    const targets = await resolveTargetCategoryIds(account, playlist.id, 'movie', history, permissiveAdult);
    expect(targets).toEqual(['10']);
    expect(requestSpy).toHaveBeenCalledWith(account, 'get_vod_categories', {}, undefined);
  });
});

describe('feedHomeRecommendations', () => {
  it('ne fait rien sans graine de visionnage', async () => {
    const requestSpy = vi.spyOn(xtreamCatalog, 'catalogRequest');
    const result = await feedHomeRecommendations({
      account,
      playlist,
      kind: 'movie',
      history: [],
      adult: permissiveAdult,
    });
    expect(result).toBe(false);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('charge la catégorie cible, calcule et enregistre Pour toi sans requête globale', async () => {
    const sourceId = `vod:${playlist.id}:movie:1`;
    const history: PlayHistoryEntry[] = [
      {
        channelId: sourceId,
        kind: 'vod',
        playlistId: playlist.id,
        mediaKind: 'movie',
        name: 'Inception',
        categoryId: 'cat-sf',
        status: 'completed',
        ts: 100,
      },
    ];

    const requestSpy = vi.spyOn(xtreamCatalog, 'catalogRequest').mockImplementation((_acc, action, params) => {
      if (action === 'get_vod_streams' && params?.category_id === 'cat-sf') {
        return Promise.resolve([
          { stream_id: 1, name: 'Inception', category_id: 'cat-sf', container_extension: 'mp4' },
          { stream_id: 2, name: 'Interstellar', category_id: 'cat-sf', container_extension: 'mp4' },
          { stream_id: 3, name: 'Tenet', category_id: 'cat-sf', container_extension: 'mp4' },
        ]);
      }
      return Promise.reject(new Error(`Action inattendue ${action}`));
    });

    const result = await feedHomeRecommendations({
      account,
      playlist,
      kind: 'movie',
      history,
      adult: permissiveAdult,
    });

    expect(result).toBe(true);

    // Vérifie qu'aucune requête globale get_vod_streams sans category_id n'a été émise
    const globalCalls = requestSpy.mock.calls.filter(call => call[1] === 'get_vod_streams' && !call[2]?.category_id);
    expect(globalCalls).toHaveLength(0);

    // Vérifie que les items sont bien dans categoryCatalogCache
    const cacheKey = `${playlist.id}:${account.server}:movie:cat-sf`;
    expect(categoryCatalogCache.has(cacheKey)).toBe(true);

    // Vérifie que les recommandations sont enregistrées dans le snapshot
    const snapshot = readForYouSnapshot(playlist.id, 'movie');
    expect(snapshot.length).toBeGreaterThan(0);
    // Inception étant complété, il est exclu des suggestions. Interstellar et Tenet doivent être là.
    expect(snapshot.some(item => item.name === 'Interstellar')).toBe(true);
    // Chaque recommandation issue de la catégorie porte le sourceId
    const interstellar = snapshot.find(item => item.name === 'Interstellar');
    expect(interstellar?.sourceId).toBe(sourceId);
    expect(interstellar?.reason).toMatch(/Même catégorie que « Inception »/);
  });

  it('s’amorce avec les graines externes (Trakt / Vu ailleurs) quand l’historique local est vide', async () => {
    const traktSourceId = 'trakt:movie:27205';
    const externalWatches: PlayHistoryEntry[] = [
      {
        channelId: traktSourceId,
        kind: 'vod',
        mediaKind: 'movie',
        name: 'Inception',
        platform: 'trakt',
        tmdbId: 27205,
        status: 'completed',
        ts: Date.now(),
      },
    ];

    vi.spyOn(xtreamCatalog, 'catalogRequest').mockImplementation((_acc, action) => {
      if (action === 'get_vod_categories') {
        return Promise.resolve([
          { category_id: '10', category_name: 'Top Films' },
        ]);
      }
      if (action === 'get_vod_streams') {
        return Promise.resolve([
          { stream_id: 1, name: 'Inception', category_id: '10', container_extension: 'mp4', tmdb_id: 27205 },
          { stream_id: 2, name: 'Interstellar', category_id: '10', container_extension: 'mp4' },
        ]);
      }
      return Promise.reject(new Error(`Action inattendue ${action}`));
    });

    const result = await feedHomeRecommendations({
      account,
      playlist,
      kind: 'movie',
      history: [], // AUCUN visionnage local dans CedPlay
      externalWatches,
      adult: permissiveAdult,
    });

    expect(result).toBe(true);
    const snapshot = readForYouSnapshot(playlist.id, 'movie');
    expect(snapshot.length).toBeGreaterThan(0);
    // Interstellar est recommandé d'après Inception
    const rec = snapshot.find(item => item.name === 'Interstellar');
    expect(rec).toBeDefined();
    // Le sourceId pointe vers la graine Trakt d'origine pour alimenter « Parce que tu as regardé »
    expect(rec?.sourceId).toBe(traktSourceId);
  });

  it('persiste la signature après calcul et détecte un changement sans lastKnownSignature', async () => {
    const sourceId = `vod:${playlist.id}:movie:1`;
    const history: PlayHistoryEntry[] = [
      {
        channelId: sourceId,
        kind: 'vod',
        playlistId: playlist.id,
        mediaKind: 'movie',
        name: 'Inception',
        categoryId: 'cat-sf',
        status: 'completed',
        ts: 100,
      },
    ];

    vi.spyOn(xtreamCatalog, 'catalogRequest').mockResolvedValue([
      { stream_id: 1, name: 'Inception', category_id: 'cat-sf', container_extension: 'mp4' },
      { stream_id: 2, name: 'Interstellar', category_id: 'cat-sf', container_extension: 'mp4' },
    ]);

    await feedHomeRecommendations({ account, playlist, kind: 'movie', history, adult: permissiveAdult });
    // Même signature sans lastKnownSignature -> pas de recalcul inutile
    expect(shouldRefreshRecommendations(playlist.id, 'movie', history)).toBe(false);

    // Ajout d'un nouveau visionnage -> détecté même sans lastKnownSignature (après remontage)
    const updatedHistory: PlayHistoryEntry[] = [
      ...history,
      {
        channelId: `vod:${playlist.id}:movie:3`,
        kind: 'vod',
        playlistId: playlist.id,
        mediaKind: 'movie',
        name: 'Tenet',
        categoryId: 'cat-sf',
        status: 'completed',
        ts: 200,
      },
    ];
    expect(shouldRefreshRecommendations(playlist.id, 'movie', updatedHistory)).toBe(true);
  });
});
