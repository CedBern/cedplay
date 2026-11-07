package com.lecteur.iptv;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Persistance native des positions et vitesses d'écoute des podcasts.
 * Le service Android en est l'unique maître pendant la lecture (écran éteint ou page fermée) ;
 * l'interface React relit cet état au démarrage et au retour au premier plan.
 *
 * Règle critique de changement d'épisode :
 * lors du passage d'un épisode A à un épisode B, la dernière position et la vitesse de A
 * sont toujours enregistrées sous l'identifiant de A AVANT de basculer l'épisode actif sur B,
 * puis la position et la vitesse mémorisées de B (ou la vitesse courante par défaut) sont restaurées.
 */
public class AudioProgressStore {
    public static final String PREFS_NAME = "podcasts_progress";
    private static final String KEY_ENTRIES = "entries_v1";
    private static final String KEY_LAST_ACTIVE = "last_active_id";

    public static class Entry {
        public final String episodeId;
        public final String feedUrl;
        public final String audioUrl;
        public final String title;
        public final String podcastTitle;
        public final String artworkUrl;
        public final long positionMs;
        public final long durationMs;
        public final float speed;
        public final boolean completed;
        public final long updatedAt;

        public Entry(
                String episodeId,
                String feedUrl,
                String audioUrl,
                String title,
                String podcastTitle,
                String artworkUrl,
                long positionMs,
                long durationMs,
                float speed,
                boolean completed,
                long updatedAt) {
            this.episodeId = episodeId == null ? "" : episodeId;
            this.feedUrl = feedUrl == null ? "" : feedUrl;
            this.audioUrl = audioUrl == null ? "" : audioUrl;
            this.title = title == null ? "" : title;
            this.podcastTitle = podcastTitle == null ? "" : podcastTitle;
            this.artworkUrl = artworkUrl == null ? "" : artworkUrl;
            this.positionMs = Math.max(0L, positionMs);
            this.durationMs = Math.max(0L, durationMs);
            this.speed = clampSpeed(speed);
            this.completed = completed;
            this.updatedAt = updatedAt;
        }
    }

    /** Borne la vitesse entre 0.5x et 3.0x (1.0x par défaut si invalide). */
    public static float clampSpeed(float speed) {
        if (Float.isNaN(speed) || Float.isInfinite(speed) || speed <= 0f) return 1.0f;
        return Math.max(0.5f, Math.min(3.0f, Math.round(speed * 100f) / 100f));
    }

    /** Un épisode est considéré comme terminé s'il reste moins de 20 s sur une durée connue (> 60 s). */
    public static boolean isCompleted(long positionMs, long durationMs, boolean ended) {
        if (ended) return true;
        return durationMs >= 60_000L && durationMs - positionMs <= 20_000L;
    }

    /**
     * Cœur logique testable en mémoire (sans dépendance Android) :
     * gère l'enregistrement par épisode, la restauration de la vitesse avec la position,
     * et la transition atomique d'un épisode à un autre.
     */
    public static class SessionTracker {
        private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>();
        private String activeEpisodeId = null;

        public synchronized void loadEntries(List<Entry> initial, String lastActiveId) {
            entries.clear();
            if (initial != null) {
                for (Entry e : initial) {
                    if (e != null && !e.episodeId.isEmpty()) entries.put(e.episodeId, e);
                }
            }
            activeEpisodeId = lastActiveId;
        }

        public synchronized String getActiveEpisodeId() {
            return activeEpisodeId;
        }

        public synchronized Entry getEntry(String episodeId) {
            if (episodeId == null || episodeId.isEmpty()) return null;
            return entries.get(episodeId);
        }

        public synchronized List<Entry> getAllEntries() {
            return new ArrayList<>(entries.values());
        }

        /**
         * Enregistre l'état de l'épisode indiqué.
         * Si l'épisode est terminé, la position de reprise est ramenée à 0 (pour pouvoir le réécouter),
         * mais sa vitesse choisie et son statut `completed = true` sont conservés.
         */
        public synchronized Entry saveProgress(
                String episodeId,
                String feedUrl,
                String audioUrl,
                String title,
                String podcastTitle,
                String artworkUrl,
                long positionMs,
                long durationMs,
                float speed,
                boolean ended,
                long nowMs) {
            if (episodeId == null || episodeId.isEmpty()) return null;
            Entry prev = entries.get(episodeId);
            String resolvedFeed = (feedUrl != null && !feedUrl.isEmpty()) ? feedUrl : (prev != null ? prev.feedUrl : "");
            String resolvedAudio = (audioUrl != null && !audioUrl.isEmpty()) ? audioUrl : (prev != null ? prev.audioUrl : "");
            String resolvedTitle = (title != null && !title.isEmpty()) ? title : (prev != null ? prev.title : "");
            String resolvedPodcast = (podcastTitle != null && !podcastTitle.isEmpty()) ? podcastTitle : (prev != null ? prev.podcastTitle : "");
            String resolvedArt = (artworkUrl != null && !artworkUrl.isEmpty()) ? artworkUrl : (prev != null ? prev.artworkUrl : "");
            long resolvedDuration = durationMs > 0 ? durationMs : (prev != null ? prev.durationMs : 0L);
            float resolvedSpeed = speed > 0f ? clampSpeed(speed) : (prev != null ? prev.speed : 1.0f);
            boolean completed = isCompleted(positionMs, resolvedDuration, ended);
            long savedPos = completed ? 0L : Math.max(0L, positionMs);

            Entry updated = new Entry(
                    episodeId,
                    resolvedFeed,
                    resolvedAudio,
                    resolvedTitle,
                    resolvedPodcast,
                    resolvedArt,
                    savedPos,
                    resolvedDuration,
                    resolvedSpeed,
                    completed,
                    nowMs);
            entries.put(episodeId, updated);
            activeEpisodeId = episodeId;
            return updated;
        }

        /**
         * Bascule proprement de l'épisode en cours vers un nouvel épisode :
         * 1. Si un épisode différent est actif, sa dernière position (`currentPositionMs`) et sa vitesse
         *    (`currentSpeed`) sont d'abord enregistrées sous SON propre `activeEpisodeId`.
         * 2. L'épisode actif devient `nextEpisodeId`.
         * 3. Renvoie l'entrée de `nextEpisodeId` avec sa position de reprise et sa vitesse restaurée
         *    (priorité : `explicitSpeed` si > 0, sinon vitesse sauvegardée de `nextEpisodeId`, sinon `currentSpeed` ou 1.0x).
         */
        public synchronized Entry transitionToEpisode(
                long currentPositionMs,
                long currentDurationMs,
                float currentSpeed,
                String nextEpisodeId,
                String nextFeedUrl,
                String nextAudioUrl,
                String nextTitle,
                String nextPodcastTitle,
                String nextArtworkUrl,
                long explicitStartPositionMs,
                float explicitSpeed,
                long nowMs) {
            if (activeEpisodeId != null && !activeEpisodeId.isEmpty() && !activeEpisodeId.equals(nextEpisodeId)) {
                Entry currentEntry = entries.get(activeEpisodeId);
                if (currentEntry != null) {
                    saveProgress(
                            activeEpisodeId,
                            currentEntry.feedUrl,
                            currentEntry.audioUrl,
                            currentEntry.title,
                            currentEntry.podcastTitle,
                            currentEntry.artworkUrl,
                            currentPositionMs,
                            currentDurationMs > 0 ? currentDurationMs : currentEntry.durationMs,
                            currentSpeed > 0f ? currentSpeed : currentEntry.speed,
                            false,
                            nowMs);
                }
            }

            Entry savedNext = entries.get(nextEpisodeId);
            long resumePos = explicitStartPositionMs >= 0
                    ? explicitStartPositionMs
                    : (savedNext != null ? savedNext.positionMs : 0L);
            float resumeSpeed = explicitSpeed > 0f
                    ? clampSpeed(explicitSpeed)
                    : (savedNext != null ? savedNext.speed : (currentSpeed > 0f ? clampSpeed(currentSpeed) : 1.0f));
            long nextDuration = savedNext != null ? savedNext.durationMs : 0L;

            Entry nextEntry = new Entry(
                    nextEpisodeId,
                    nextFeedUrl != null && !nextFeedUrl.isEmpty() ? nextFeedUrl : (savedNext != null ? savedNext.feedUrl : ""),
                    nextAudioUrl != null && !nextAudioUrl.isEmpty() ? nextAudioUrl : (savedNext != null ? savedNext.audioUrl : ""),
                    nextTitle != null && !nextTitle.isEmpty() ? nextTitle : (savedNext != null ? savedNext.title : ""),
                    nextPodcastTitle != null && !nextPodcastTitle.isEmpty() ? nextPodcastTitle : (savedNext != null ? savedNext.podcastTitle : ""),
                    nextArtworkUrl != null && !nextArtworkUrl.isEmpty() ? nextArtworkUrl : (savedNext != null ? savedNext.artworkUrl : ""),
                    resumePos,
                    nextDuration,
                    resumeSpeed,
                    false,
                    nowMs);
            entries.put(nextEpisodeId, nextEntry);
            activeEpisodeId = nextEpisodeId;
            return nextEntry;
        }
    }

    private static SessionTracker sharedTracker;

    public static synchronized SessionTracker tracker(Context context) {
        if (sharedTracker == null) {
            sharedTracker = new SessionTracker();
            loadFromPrefs(context, sharedTracker);
        }
        return sharedTracker;
    }

    public static synchronized void persist(Context context) {
        if (sharedTracker == null || context == null) return;
        try {
            JSONArray array = new JSONArray();
            for (Entry e : sharedTracker.getAllEntries()) {
                JSONObject obj = new JSONObject();
                obj.put("episodeId", e.episodeId);
                obj.put("feedUrl", e.feedUrl);
                obj.put("audioUrl", e.audioUrl);
                obj.put("title", e.title);
                obj.put("podcastTitle", e.podcastTitle);
                obj.put("artworkUrl", e.artworkUrl);
                obj.put("positionMs", e.positionMs);
                obj.put("durationMs", e.durationMs);
                obj.put("speed", e.speed);
                obj.put("completed", e.completed);
                obj.put("updatedAt", e.updatedAt);
                array.put(obj);
            }
            SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString(KEY_ENTRIES, array.toString())
                    .putString(KEY_LAST_ACTIVE, sharedTracker.getActiveEpisodeId())
                    .apply();
        } catch (Exception ignored) {}
    }

    private static void loadFromPrefs(Context context, SessionTracker target) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_ENTRIES, "[]");
            String lastActive = prefs.getString(KEY_LAST_ACTIVE, null);
            JSONArray array = new JSONArray(raw);
            List<Entry> list = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.optJSONObject(i);
                if (obj == null) continue;
                String id = obj.optString("episodeId", "");
                if (id.isEmpty()) continue;
                list.add(new Entry(
                        id,
                        obj.optString("feedUrl", ""),
                        obj.optString("audioUrl", ""),
                        obj.optString("title", ""),
                        obj.optString("podcastTitle", ""),
                        obj.optString("artworkUrl", ""),
                        obj.optLong("positionMs", 0L),
                        obj.optLong("durationMs", 0L),
                        (float) obj.optDouble("speed", 1.0),
                        obj.optBoolean("completed", false),
                        obj.optLong("updatedAt", 0L)));
            }
            target.loadEntries(list, lastActive);
        } catch (Exception ignored) {}
    }
}
