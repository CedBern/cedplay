import { getSettingsFromDB, saveSettingsToDB, PersistedSettings, pushSettingsChangeLogEntry, updateSettingsMigrationStats, type SettingsChangeLogEntry } from '@/utils/idb';
import { redactSetting } from '@/utils/redact';
import { DEFAULT_WATCH_REGION, normalizeWatchRegion, normalizeWatchSubscriptions } from '@/data/watchRegions';
import { z } from 'zod';

const STORAGE_KEYS = {
  FAVORITES: 'iptv_favorites',
  PLAYLISTS: 'iptv_playlists',
  SETTINGS: 'iptv_settings',
  LAST_PLAYLIST: 'iptv_last_playlist'
};

// Miroir synchrone du thème pour le script inline d'index.html : les réglages
// définitifs vivent en IndexedDB, illisible avant le premier rendu.
// Hors STORAGE_KEYS : purgeLegacyKeys ne doit pas le supprimer.
const THEME_MIRROR_KEY = 'iptv_theme';

// Les jetons de lecture TMDB sont plus longs que les anciennes clés API v3.
const MAX_TMDB_CREDENTIAL_LENGTH = 4096;

// Empreinte PIN « sha256:<sel 32 hex>:<SHA-256 64 hex> » = 104 caractères ;
// l'ancien code en clair fait 4 à 8 chiffres. La limite basse (20) tronquait l'empreinte.
const MAX_PARENTAL_PIN_LENGTH = 128;

export interface AppSettings {
  volume: number;
  autoplay: boolean;
  theme: 'light' | 'dark';
  keyboardNavigation: boolean;
  compactModeDefault?: boolean;
  virtualizationEnabledDefault?: boolean;
  telemetryPersistence?: boolean; // persist telemetry events across sessions
  muteOnStart?: boolean; // start playback muted initially
  playbackRate?: number; // preferred playback speed
  autoLoadLastPlaylist?: boolean; // auto-load last used playlist on startup
  autoReconnect?: boolean; // resume the stream automatically after a network outage
  autoNextEpisode?: boolean; // web VOD : lancer l'épisode suivant à la fin de la lecture
  epgUrl?: string; // custom XMLTV URL for lists without a linked Xtream account
  tmdbApiKey?: string; // TMDB API key or read access token (enriched VOD info)
  watchRegion?: string; // pays des offres légales TMDB (code à deux lettres, Mexique par défaut)
  watchProviderIds?: number[]; // fournisseurs TMDB de ce pays retenus comme abonnements
  subtitlesEnabled?: boolean; // active la recherche et l'affichage des sous-titres
  subtitleAutoTranslate?: boolean; // traduit automatiquement les sous-titres vers le français si absent
  subtitlePreferredLang?: 'fr' | 'en' | 'es'; // langue préférée des sous-titres
  deeplApiKey?: string; // clé API DeepL optionnelle pour traduction haute fidélité
  openSubtitlesApiKey?: string; // clé API OpenSubtitles v3 optionnelle
  subdlApiKey?: string; // clé API SubDL optionnelle
  parentalControlEnabled?: boolean; // verrouille les groupes adultes derrière un code
  parentalPin?: string; // code PIN parental (4 à 8 chiffres) ou empreinte hachée « sha256:<sel>:<hex> »
  interfaceMode?: 'auto' | 'tv' | 'mobile'; // interface télécommande (TV) ou tactile ; auto = détectée
  tvPreview?: boolean; // ancien réglage aperçu (on/off) ; conservé pour la migration
  tvPreviewMode?: 'auto' | 'manual' | 'off'; // aperçu vidéo : au survol, via le bouton « Aperçu », ou désactivé
  proxyUrl?: string; // adresse du relais CORS pour les builds web hébergés (vide = relais local de développement)
  startOnLastChannel?: boolean; // relance la dernière chaîne regardée à l'ouverture de l'application
  playlistRefreshHours?: number; // actualisation automatique de la liste par URL (heures ; 0 = jamais)
  playerBuffer?: 'small' | 'normal' | 'large' | 'max'; // mémoire tampon du lecteur Android (direct)
  playerDecoder?: 'hardware' | 'software'; // décodeurs vidéo essayés en premier par le lecteur Android
  playerAfr?: boolean; // fréquence d'affichage adaptée à la vidéo (Android TV)
  traktToken?: string; // jeton d'accès OAuth Trakt.tv
  traktRefreshToken?: string; // jeton de rafraîchissement OAuth Trakt.tv
  traktExpiresAt?: number; // expiration du jeton (ms)
  traktUsername?: string; // nom d'utilisateur Trakt (@username)
  traktScrobble?: boolean; // synchronisation de la progression en direct vers Trakt
  traktSync?: boolean; // synchronisation de l'historique Trakt vers « Vu ailleurs »
  traktClientId?: string; // identifiant client Trakt personnalisé (facultatif)
  traktClientSecret?: string; // secret client Trakt personnalisé (facultatif)
  __version?: number; // internal version for migrations
}

// Zod schema for robust validation (keeps optional keys optional)
const appSettingsSchema = z.object({
  volume: z.number().min(0).max(1).default(0.8),
  autoplay: z.boolean().default(true),
  theme: z.enum(['light','dark']).default('dark'),
  keyboardNavigation: z.boolean().default(true),
  compactModeDefault: z.boolean().optional(),
  virtualizationEnabledDefault: z.boolean().optional(),
  telemetryPersistence: z.boolean().optional(),
  muteOnStart: z.boolean().optional(),
  playbackRate: z.number().min(0.5).max(2).optional(),
  autoLoadLastPlaylist: z.boolean().optional(),
  autoReconnect: z.boolean().optional(),
  autoNextEpisode: z.boolean().optional(),
  epgUrl: z.string().max(500).optional(),
  // Les jetons de lecture v4 TMDB font ~220 caractères : 200 les tronquait.
  tmdbApiKey: z.string().max(MAX_TMDB_CREDENTIAL_LENGTH).optional(),
  watchRegion: z.string().length(2).optional(),
  watchProviderIds: z.array(z.number().int().positive()).max(30).optional(),
  subtitlesEnabled: z.boolean().optional(),
  subtitleAutoTranslate: z.boolean().optional(),
  subtitlePreferredLang: z.enum(['fr', 'en', 'es']).optional(),
  deeplApiKey: z.string().max(200).optional(),
  openSubtitlesApiKey: z.string().max(200).optional(),
  subdlApiKey: z.string().max(200).optional(),
  parentalControlEnabled: z.boolean().optional(),
  parentalPin: z.string().max(MAX_PARENTAL_PIN_LENGTH).optional(),
  interfaceMode: z.enum(['auto', 'tv', 'mobile']).optional(),
  tvPreview: z.boolean().optional(),
  tvPreviewMode: z.enum(['auto', 'manual', 'off']).optional(),
  proxyUrl: z.string().max(300).optional(),
  startOnLastChannel: z.boolean().optional(),
  playlistRefreshHours: z.number().int().min(0).max(168).optional(),
  playerBuffer: z.enum(['small', 'normal', 'large', 'max']).optional(),
  playerDecoder: z.enum(['hardware', 'software']).optional(),
  playerAfr: z.boolean().optional(),
  traktToken: z.string().max(500).optional(),
  traktRefreshToken: z.string().max(500).optional(),
  traktExpiresAt: z.number().optional(),
  traktUsername: z.string().max(100).optional(),
  traktScrobble: z.boolean().optional(),
  traktSync: z.boolean().optional(),
  traktClientId: z.string().max(200).optional(),
  traktClientSecret: z.string().max(200).optional(),
  __version: z.number().optional()
});

// (Removed unused AppSettingsSchema alias after switching to safeParse)

/** Au-delà, l'écran de démarrage repart des réglages synchrones au lieu d'attendre
 *  une base bloquée par un autre onglet ou une migration impossible. */
const SETTINGS_LOAD_TIMEOUT_MS = 8_000;

class SettingsLoadTimeoutError extends Error {}

/**
 * Égalité de valeur pour la comparaison « les réglages ont-ils changé ? ».
 * Les tableaux (identifiants d'abonnements) sont neufs à chaque validation :
 * une comparaison par référence les ferait passer pour modifiés et déclencherait
 * une écriture à chaque démarrage.
 */
function sameSettingValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => value === b[index]);
  return false;
}

export class StorageManager {
  // In-memory cache to avoid repeated IndexedDB reads within a session
  private static _settingsCache: AppSettings | undefined;
  private static _loadingPromise: Promise<AppSettings> | undefined;
  private static _cacheHits = 0;
  private static _cacheLoads = 0; // actual DB/legacy loads
  private static _lastLoadTs: number | undefined;

  /** Test / maintenance helper to clear in-memory cache */
  static __resetCacheForTests(): void {
    this._settingsCache = undefined;
    this._loadingPromise = undefined;
    this._cacheHits = 0;
    this._cacheLoads = 0;
    this._lastLoadTs = undefined;
  }
  /** Lightweight cache metrics */
  static getSettingsCacheStats(): { hits: number; loads: number; lastLoadTs?: number } {
  const base = { hits: this._cacheHits, loads: this._cacheLoads } as { hits: number; loads: number; lastLoadTs?: number };
  if (this._lastLoadTs !== undefined) base.lastLoadTs = this._lastLoadTs;
  return base;
  }
  /**
   * LEGACY: Favorites moved to IndexedDB (idb.ts). These methods remain only for one-time migration.
   * Use getFavoritesFromDB/saveFavoritesToDB instead elsewhere.
   */
  static getFavorites(): string[] {
    const stored = localStorage.getItem(STORAGE_KEYS.FAVORITES);
    return stored ? JSON.parse(stored) : [];
  }

  static setFavorites(channelIds: string[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(channelIds));
    } catch { /* stockage plein ou désactivé */ }
  }

  static toggleFavorite(channelId: string): void {
    const favorites = this.getFavorites();
    const index = favorites.indexOf(channelId);
    
    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(channelId);
    }
    
    this.setFavorites(favorites);
  }

  static isFavorite(channelId: string): boolean {
    return this.getFavorites().includes(channelId);
  }


  static defaultSettings(): AppSettings {
    return {
      volume: 0.8,
  autoplay: true,
      theme: 'dark',
      keyboardNavigation: true,
      compactModeDefault: false,
      virtualizationEnabledDefault: true,
      telemetryPersistence: true,
  muteOnStart: true,
  playbackRate: 1,
  autoLoadLastPlaylist: true,
  autoReconnect: true,
  autoNextEpisode: true,
  epgUrl: '',
  tmdbApiKey: '',
  watchRegion: DEFAULT_WATCH_REGION,
  watchProviderIds: [],
  subtitlesEnabled: true,
  subtitleAutoTranslate: true,
  subtitlePreferredLang: 'fr',
  deeplApiKey: '',
  openSubtitlesApiKey: '',
  subdlApiKey: '',
  parentalControlEnabled: false,
  parentalPin: '',
  proxyUrl: '',
  tvPreviewMode: 'auto',
  startOnLastChannel: false,
  playlistRefreshHours: 24,
  traktToken: '',
  traktRefreshToken: '',
  traktExpiresAt: 0,
  traktUsername: '',
  traktScrobble: true,
  traktSync: true,
  traktClientId: '',
  traktClientSecret: '',
  __version: 11
    };
  }

  // Legacy synchronous getter (used at startup). It will be replaced asynchronously by loadSettingsAsync usage.
  static getSettings(): AppSettings {
    try {
      const legacy = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return legacy ? { ...this.defaultSettings(), ...JSON.parse(legacy) } : this.defaultSettings();
    } catch {
      return this.defaultSettings();
    }
  }

  /** Réglages en mémoire (chargés de façon asynchrone), sinon repli synchrone. */
  static getCachedSettings(): AppSettings {
    return this._settingsCache ?? this.getSettings();
  }

  static async loadSettingsAsync(force = false): Promise<AppSettings> {
  if (!force && this._settingsCache) { this._cacheHits += 1; return this._settingsCache; }
    if (!force && this._loadingPromise) return this._loadingPromise;
    const loading = (async () => {
    if (this._settingsCache && !force) { // should have returned earlier; defensive
      this._cacheHits += 1; return this._settingsCache;
    }
    const dbSettings = await getSettingsFromDB();
    if (dbSettings) {
      // Repair / validate persisted settings (older versions may have invalid fields)
      const repaired = this.validateSettings(dbSettings as AppSettings);
      // If repaired differs (shallow compare) persist migration for future fast loads
      const differs = (() => {
        const keys = new Set<keyof AppSettings>([...Object.keys(repaired), ...Object.keys(dbSettings)] as (keyof AppSettings)[]);
        for (const k of keys) {
          if (!sameSettingValue((dbSettings as Partial<AppSettings>)[k], repaired[k])) return true;
        }
        return false;
      })();
      if (differs) {
        try {
          await saveSettingsToDB(repaired as PersistedSettings);
          await updateSettingsMigrationStats(true);
          const migrationEntry: SettingsChangeLogEntry = { ts: Date.now(), changes: { migration: true }, reason: 'migration' };
          const fromV = dbSettings.__version;
          if (fromV !== undefined) migrationEntry.fromVersion = fromV;
          if (repaired.__version !== undefined) migrationEntry.toVersion = repaired.__version;
          await pushSettingsChangeLogEntry(migrationEntry);
        } catch { /* ignore persistence migration errors */ }
      }
  this._settingsCache = Object.freeze({ ...repaired });
  this._cacheLoads += 1;
  this._lastLoadTs = Date.now();
  return this._settingsCache;
    }
    // migrate legacy if exists
    const legacy = this.getSettings();
    await saveSettingsToDB(legacy);
  this._settingsCache = Object.freeze({ ...legacy });
  this._cacheLoads += 1;
  this._lastLoadTs = Date.now();
  return this._settingsCache;
    })();
    // La promesse PARTAGÉE est la version protégée : sans cela, seul le premier
    // appelant profitait du délai et du secours, et les appelants suivants
    // (App et le lecteur au montage) restaient bloqués sur IndexedDB.
    const shared: { promise?: Promise<AppSettings> } = {};
    const protectedLoad = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SettingsLoadTimeoutError()), SETTINGS_LOAD_TIMEOUT_MS);
      });
      try {
        return await Promise.race([loading, timeout]);
      } catch (error) {
        // Une base inaccessible (ouverture bloquée, VersionError, quota) ne doit pas
        // laisser l'application sur un écran de chargement éternel : les réglages
        // synchrones de localStorage permettent de démarrer, une lecture ultérieure
        // pourra réessayer.
        if (error instanceof SettingsLoadTimeoutError) {
          console.warn('[storage] Lecture des réglages trop lente : réglages de secours utilisés.');
        } else {
          console.warn('[storage] Réglages illisibles : réglages de secours utilisés.', error);
        }
        return this.getFallbackSettings();
      } finally {
        clearTimeout(timer);
        if (this._loadingPromise === shared.promise) this._loadingPromise = undefined;
      }
    })();
    shared.promise = protectedLoad;
    this._loadingPromise = protectedLoad;
    return protectedLoad;
  }

  /** Réglages de secours quand IndexedDB est muette ou en erreur. Le miroir de
   *  thème reste prioritaire : le repli synchrone peut être plus ancien que le
   *  dernier choix de l'utilisateur (au démarrage, il précède le chargement). */
  private static getFallbackSettings(): AppSettings {
    const base = this._settingsCache ?? this.getSettings();
    const mirror = this.getThemeMirror();
    return mirror && mirror !== base.theme ? { ...base, theme: mirror } : base;
  }

  static async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = this._settingsCache ? (this._cacheHits += 1, this._settingsCache) : await this.loadSettingsAsync();
    const merged: AppSettings = this.validateSettings(this.mergePartial(current, settings));
    // Compute diff for changelog (only keys provided that changed)
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settings) as [keyof AppSettings, unknown][]) {
      // Clés API et PIN parental : seule l'occurrence du changement est journalisée, jamais la valeur.
      if (v !== undefined && current[k] !== merged[k]) diff[k] = redactSetting(k as string, merged[k]);
    }
    // If nothing actually changed, avoid unnecessary write + changelog entry
    if (Object.keys(diff).length === 0) {
      return current; // no-op
    }
    await saveSettingsToDB(merged as PersistedSettings);
    if (Object.keys(diff).length) {
      try {
  const entry: SettingsChangeLogEntry = { ts: Date.now(), changes: diff, reason: 'user' };
        if (current.__version !== undefined) entry.fromVersion = current.__version;
        if (merged.__version !== undefined) entry.toVersion = merged.__version;
        await pushSettingsChangeLogEntry(entry);
      } catch {/* ignore */}
    }
  this._settingsCache = Object.freeze({ ...merged });
  return this._settingsCache;
  }

  /** Reset all settings back to defaults (logs reason 'reset'). */
  static async resetSettings(): Promise<AppSettings> {
    const defaults = this.defaultSettings();
    await saveSettingsToDB(defaults as PersistedSettings);
    try {
      const entry: SettingsChangeLogEntry = { ts: Date.now(), changes: { reset: true }, reason: 'reset', ...(defaults.__version !== undefined ? { toVersion: defaults.__version } : {}) };
      await pushSettingsChangeLogEntry(entry);
    } catch { /* ignore */ }
    this._settingsCache = Object.freeze({ ...defaults });
    return this._settingsCache;
  }

  static getLastPlaylist(): string | null {
    return localStorage.getItem(STORAGE_KEYS.LAST_PLAYLIST);
  }

  static setLastPlaylist(playlistName: string): void {
    try {
      localStorage.setItem(STORAGE_KEYS.LAST_PLAYLIST, playlistName);
    } catch { /* stockage plein ou désactivé */ }
  }

  /** Miroir synchrone du thème, lu par le script inline d'index.html au démarrage. */
  static setThemeMirror(theme: 'light' | 'dark'): void {
    try {
      localStorage.setItem(THEME_MIRROR_KEY, theme);
    } catch { /* stockage plein ou désactivé : le thème s'appliquera après le chargement */ }
  }

  static getThemeMirror(): 'light' | 'dark' | null {
    try {
      const value = localStorage.getItem(THEME_MIRROR_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * Optional cleanup to remove legacy localStorage keys after successful migration.
   * Safe to call; ignores missing keys.
   */
  static purgeLegacyKeys(): void {
    try {
      Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    } catch {/* ignore */}
  }

  /** Basic sanitization/validation for settings prior to persistence */
  private static validateSettings(s: AppSettings): AppSettings {
    const parsed = appSettingsSchema.safeParse(s);
    if (parsed.success) {
      const p = parsed.data;
      const base: AppSettings = {
        volume: p.volume,
        autoplay: p.autoplay,
        theme: p.theme,
        keyboardNavigation: p.keyboardNavigation,
        ...(p.compactModeDefault !== undefined ? { compactModeDefault: p.compactModeDefault } : {}),
        ...(p.virtualizationEnabledDefault !== undefined ? { virtualizationEnabledDefault: p.virtualizationEnabledDefault } : {}),
        ...(p.telemetryPersistence !== undefined ? { telemetryPersistence: p.telemetryPersistence } : {}),
  ...(p.muteOnStart !== undefined ? { muteOnStart: p.muteOnStart } : {}),
  ...(p.playbackRate !== undefined ? { playbackRate: p.playbackRate } : {}),
  ...(p.autoLoadLastPlaylist !== undefined ? { autoLoadLastPlaylist: p.autoLoadLastPlaylist } : {}),
  ...(p.autoReconnect !== undefined ? { autoReconnect: p.autoReconnect } : {}),
  ...(p.autoNextEpisode !== undefined ? { autoNextEpisode: p.autoNextEpisode } : {}),
  ...(p.epgUrl !== undefined ? { epgUrl: p.epgUrl } : {}),
  ...(p.tmdbApiKey !== undefined ? { tmdbApiKey: p.tmdbApiKey } : {}),
  // Toujours présents : les installations antérieures n'ont pas ces clés.
  watchRegion: normalizeWatchRegion(p.watchRegion),
  watchProviderIds: normalizeWatchSubscriptions(p.watchProviderIds),
  ...(p.subtitlesEnabled !== undefined ? { subtitlesEnabled: p.subtitlesEnabled } : {}),
  ...(p.subtitleAutoTranslate !== undefined ? { subtitleAutoTranslate: p.subtitleAutoTranslate } : {}),
  ...(p.subtitlePreferredLang !== undefined ? { subtitlePreferredLang: p.subtitlePreferredLang } : {}),
  ...(p.deeplApiKey !== undefined ? { deeplApiKey: p.deeplApiKey } : {}),
  ...(p.openSubtitlesApiKey !== undefined ? { openSubtitlesApiKey: p.openSubtitlesApiKey } : {}),
  ...(p.subdlApiKey !== undefined ? { subdlApiKey: p.subdlApiKey } : {}),
        ...(p.parentalControlEnabled !== undefined ? { parentalControlEnabled: p.parentalControlEnabled } : {}),
        ...(p.parentalPin !== undefined ? { parentalPin: p.parentalPin } : {}),
        ...(p.interfaceMode !== undefined ? { interfaceMode: p.interfaceMode } : {}),
        ...(p.proxyUrl !== undefined ? { proxyUrl: p.proxyUrl } : {}),
        ...(p.tvPreview !== undefined ? { tvPreview: p.tvPreview } : {}),
        ...(p.tvPreviewMode !== undefined ? { tvPreviewMode: p.tvPreviewMode } : {}),
        ...(p.startOnLastChannel !== undefined ? { startOnLastChannel: p.startOnLastChannel } : {}),
        ...(p.playlistRefreshHours !== undefined ? { playlistRefreshHours: p.playlistRefreshHours } : {}),
        ...(p.playerBuffer !== undefined ? { playerBuffer: p.playerBuffer } : {}),
        ...(p.playerDecoder !== undefined ? { playerDecoder: p.playerDecoder } : {}),
        ...(p.playerAfr !== undefined ? { playerAfr: p.playerAfr } : {}),
        ...(p.traktToken !== undefined ? { traktToken: p.traktToken } : {}),
        ...(p.traktRefreshToken !== undefined ? { traktRefreshToken: p.traktRefreshToken } : {}),
        ...(p.traktExpiresAt !== undefined ? { traktExpiresAt: p.traktExpiresAt } : {}),
        ...(p.traktUsername !== undefined ? { traktUsername: p.traktUsername } : {}),
        ...(p.traktScrobble !== undefined ? { traktScrobble: p.traktScrobble } : {}),
        ...(p.traktSync !== undefined ? { traktSync: p.traktSync } : {}),
        ...(p.traktClientId !== undefined ? { traktClientId: p.traktClientId } : {}),
        ...(p.traktClientSecret !== undefined ? { traktClientSecret: p.traktClientSecret } : {}),
        ...(p.__version !== undefined ? { __version: p.__version } : {})
      };
      return this.migrateIfNeeded(base);
    }
    // Fallback: reconstruct a safe, complete object merging sanitized existing values with defaults
    const base = this.defaultSettings();
    const coerceBool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
    const safe: AppSettings = {
      volume: typeof s.volume === 'number' && !Number.isNaN(s.volume) ? Math.min(1, Math.max(0, s.volume)) : base.volume,
      autoplay: coerceBool(s.autoplay, base.autoplay),
      theme: s.theme === 'light' ? 'light' : 'dark',
      keyboardNavigation: coerceBool(s.keyboardNavigation, base.keyboardNavigation),
      compactModeDefault: coerceBool(s.compactModeDefault, base.compactModeDefault as boolean),
      virtualizationEnabledDefault: coerceBool(s.virtualizationEnabledDefault, base.virtualizationEnabledDefault as boolean),
      telemetryPersistence: coerceBool(s.telemetryPersistence, base.telemetryPersistence as boolean),
      muteOnStart: coerceBool(s.muteOnStart, base.muteOnStart as boolean),
      playbackRate: typeof s.playbackRate === 'number' && !Number.isNaN(s.playbackRate) ? Math.min(2, Math.max(0.5, s.playbackRate)) : (base.playbackRate as number),
      autoLoadLastPlaylist: coerceBool(s.autoLoadLastPlaylist, base.autoLoadLastPlaylist as boolean),
      autoReconnect: coerceBool(s.autoReconnect, base.autoReconnect as boolean),
      autoNextEpisode: coerceBool(s.autoNextEpisode, base.autoNextEpisode as boolean),
      epgUrl: typeof s.epgUrl === 'string' ? String(s.epgUrl).slice(0, 500) : (base.epgUrl as string),
      // Large marge : les jetons de lecture v4 TMDB dépassent 200 caractères.
      tmdbApiKey: typeof s.tmdbApiKey === 'string' ? String(s.tmdbApiKey).slice(0, MAX_TMDB_CREDENTIAL_LENGTH) : (base.tmdbApiKey as string),
      watchRegion: normalizeWatchRegion(s.watchRegion),
      watchProviderIds: normalizeWatchSubscriptions(s.watchProviderIds),
      subtitlesEnabled: coerceBool(s.subtitlesEnabled, base.subtitlesEnabled as boolean),
      subtitleAutoTranslate: coerceBool(s.subtitleAutoTranslate, base.subtitleAutoTranslate as boolean),
      subtitlePreferredLang: s.subtitlePreferredLang === 'en' || s.subtitlePreferredLang === 'es' ? s.subtitlePreferredLang : 'fr',
      deeplApiKey: typeof s.deeplApiKey === 'string' ? String(s.deeplApiKey).slice(0, 200) : '',
      openSubtitlesApiKey: typeof s.openSubtitlesApiKey === 'string' ? String(s.openSubtitlesApiKey).slice(0, 200) : '',
      subdlApiKey: typeof s.subdlApiKey === 'string' ? String(s.subdlApiKey).slice(0, 200) : '',
      parentalControlEnabled: coerceBool(s.parentalControlEnabled, false),
      parentalPin: typeof s.parentalPin === 'string' ? String(s.parentalPin).slice(0, MAX_PARENTAL_PIN_LENGTH) : '',
      ...(s.interfaceMode === 'auto' || s.interfaceMode === 'tv' || s.interfaceMode === 'mobile'
        ? { interfaceMode: s.interfaceMode }
        : (base.interfaceMode !== undefined ? { interfaceMode: base.interfaceMode } : {})),
      proxyUrl: typeof s.proxyUrl === 'string' ? String(s.proxyUrl).slice(0, 300) : '',
      tvPreview: coerceBool(s.tvPreview, base.tvPreview as boolean),
      tvPreviewMode: s.tvPreviewMode === 'manual' || s.tvPreviewMode === 'off' || s.tvPreviewMode === 'auto' ? s.tvPreviewMode : 'auto',
      startOnLastChannel: coerceBool(s.startOnLastChannel, false),
      playlistRefreshHours: typeof s.playlistRefreshHours === 'number' && Number.isInteger(s.playlistRefreshHours) && s.playlistRefreshHours >= 0 && s.playlistRefreshHours <= 168 ? s.playlistRefreshHours : 24,
      ...(s.playerBuffer === 'small' || s.playerBuffer === 'normal' || s.playerBuffer === 'large' || s.playerBuffer === 'max'
        ? { playerBuffer: s.playerBuffer }
        : (base.playerBuffer !== undefined ? { playerBuffer: base.playerBuffer } : {})),
      ...(s.playerDecoder === 'hardware' || s.playerDecoder === 'software'
        ? { playerDecoder: s.playerDecoder }
        : (base.playerDecoder !== undefined ? { playerDecoder: base.playerDecoder } : {})),
      playerAfr: coerceBool(s.playerAfr, base.playerAfr as boolean),
      traktToken: typeof s.traktToken === 'string' ? String(s.traktToken).slice(0, 500) : '',
      traktRefreshToken: typeof s.traktRefreshToken === 'string' ? String(s.traktRefreshToken).slice(0, 500) : '',
      traktExpiresAt: typeof s.traktExpiresAt === 'number' && !Number.isNaN(s.traktExpiresAt) ? s.traktExpiresAt : 0,
      traktUsername: typeof s.traktUsername === 'string' ? String(s.traktUsername).slice(0, 100) : '',
      traktScrobble: coerceBool(s.traktScrobble, true),
      traktSync: coerceBool(s.traktSync, true),
      traktClientId: typeof s.traktClientId === 'string' ? String(s.traktClientId).slice(0, 200) : '',
      traktClientSecret: typeof s.traktClientSecret === 'string' ? String(s.traktClientSecret).slice(0, 200) : '',
      __version: 11
    };
    return this.migrateIfNeeded(safe);
  }

  // Future migration hook (currently only ensures version stamp)
  private static migrateIfNeeded(s: AppSettings): AppSettings {
    // v1 -> v2
    if (!s.__version || s.__version < 2) {
      if (s.telemetryPersistence === undefined) s.telemetryPersistence = true;
      s.__version = 2;
    }
    // v2 -> v3 (new fields + new defaults)
    if (s.__version < 3) {
      if (s.muteOnStart === undefined) s.muteOnStart = true;
      if (s.playbackRate === undefined) s.playbackRate = 1;
      if (s.autoLoadLastPlaylist === undefined) s.autoLoadLastPlaylist = true;
      if (s.autoplay === undefined) s.autoplay = true; // don't override user's existing false
      s.__version = 3;
    }
    // v3 -> v4 (reprise réseau automatique + adresse XMLTV personnalisée)
    if (s.__version < 4) {
      if (s.autoReconnect === undefined) s.autoReconnect = true;
      if (s.epgUrl === undefined) s.epgUrl = '';
      s.__version = 4;
    }
    // v4 -> v5 (clé API TMDB pour les fiches enrichies)
    if (s.__version < 5) {
      if (s.tmdbApiKey === undefined) s.tmdbApiKey = '';
      s.__version = 5;
    }
    // v5 -> v6 (recherche et traduction de sous-titres FR/EN/ES-MX)
    if (s.__version < 6) {
      if (s.subtitlesEnabled === undefined) s.subtitlesEnabled = true;
      if (s.subtitleAutoTranslate === undefined) s.subtitleAutoTranslate = true;
      if (s.subtitlePreferredLang === undefined) s.subtitlePreferredLang = 'fr';
      if (s.deeplApiKey === undefined) s.deeplApiKey = '';
      if (s.openSubtitlesApiKey === undefined) s.openSubtitlesApiKey = '';
      if (s.subdlApiKey === undefined) s.subdlApiKey = '';
      s.__version = 6;
    }
    // v6 -> v7 (contrôle parental par code PIN)
    if (s.__version < 7) {
      if (s.parentalControlEnabled === undefined) s.parentalControlEnabled = false;
      if (s.parentalPin === undefined) s.parentalPin = '';
      s.__version = 7;
    }
    // v7 -> v8 (relais CORS pour builds hébergés)
    if (s.__version < 8) {
      if (s.proxyUrl === undefined) s.proxyUrl = '';
      s.__version = 8;
    }
    // v8 -> v9 (mode d'aperçu vidéo : automatique, manuel ou désactivé ; remplace le booléen tvPreview)
    if (s.__version < 9) {
      if (s.tvPreviewMode === undefined) s.tvPreviewMode = s.tvPreview === false ? 'off' : 'auto';
      s.__version = 9;
    }
    // v9 -> v10 (démarrage sur la dernière chaîne, actualisation automatique de la liste)
    if (s.__version < 10) {
      if (s.startOnLastChannel === undefined) s.startOnLastChannel = false;
      if (s.playlistRefreshHours === undefined) s.playlistRefreshHours = 24;
      s.__version = 10;
    }
    // v10 -> v11 (connexion personnelle Trakt.tv : jetons, scrobble et synchro historique)
    if (s.__version < 11) {
      if (s.traktToken === undefined) s.traktToken = '';
      if (s.traktRefreshToken === undefined) s.traktRefreshToken = '';
      if (s.traktExpiresAt === undefined) s.traktExpiresAt = 0;
      if (s.traktUsername === undefined) s.traktUsername = '';
      if (s.traktScrobble === undefined) s.traktScrobble = true;
      if (s.traktSync === undefined) s.traktSync = true;
      if (s.traktClientId === undefined) s.traktClientId = '';
      if (s.traktClientSecret === undefined) s.traktClientSecret = '';
      s.__version = 11;
    }
    if (s.playbackRate !== undefined) s.playbackRate = Math.min(2, Math.max(0.5, s.playbackRate));
    return s;
  }

  /** Merge partial updates while ignoring undefined (so user can send sparse objects safely) */
  private static mergePartial(base: AppSettings, partial: Partial<AppSettings>): AppSettings {
    const result: AppSettings = { ...base };
    for (const [k, v] of Object.entries(partial) as [keyof AppSettings, unknown][]) {
      if (v !== undefined) Object.assign(result, { [k]: v });
    }
    return result;
  }
}
