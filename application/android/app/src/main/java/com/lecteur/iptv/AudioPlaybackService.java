package com.lecteur.iptv;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Service Android de lecture audio en arrière-plan (podcasts).
 * Pilote toute la lecture, la vitesse, les sauts (-15 s / +30 s), les commandes système
 * (écran verrouillé, casque, Bluetooth, appel téléphonique via AudioFocus) et la sauvegarde
 * périodique de la position et de la vitesse choisie dans {@link AudioProgressStore},
 * même lorsque l'interface WebView est en veille ou fermée.
 */
@UnstableApi
public class AudioPlaybackService extends MediaSessionService {
    public static final String ACTION_PLAY_EPISODE = "com.lecteur.iptv.action.PLAY_EPISODE";
    public static final String ACTION_PAUSE = "com.lecteur.iptv.action.PAUSE_AUDIO";
    public static final String ACTION_RESUME = "com.lecteur.iptv.action.RESUME_AUDIO";
    public static final String ACTION_STOP = "com.lecteur.iptv.action.STOP_AUDIO";
    public static final String ACTION_SEEK_TO = "com.lecteur.iptv.action.SEEK_TO_AUDIO";
    public static final String ACTION_SEEK_BY = "com.lecteur.iptv.action.SEEK_BY_AUDIO";
    public static final String ACTION_SET_SPEED = "com.lecteur.iptv.action.SET_SPEED_AUDIO";

    public static final long SEEK_BACK_MS = 15_000L;
    public static final long SEEK_FORWARD_MS = 30_000L;
    private static final long CHECKPOINT_INTERVAL_MS = 5_000L;

    public static class StateSnapshot {
        public final boolean active;
        public final String state; // "idle" | "loading" | "playing" | "paused" | "ended" | "error"
        public final String episodeId;
        public final String feedUrl;
        public final String audioUrl;
        public final String title;
        public final String podcastTitle;
        public final String artworkUrl;
        public final long positionMs;
        public final long durationMs;
        public final float speed;
        public final boolean playing;
        public final String error;

        public StateSnapshot(
                String state,
                String episodeId,
                String feedUrl,
                String audioUrl,
                String title,
                String podcastTitle,
                String artworkUrl,
                long positionMs,
                long durationMs,
                float speed,
                boolean playing,
                String error) {
            this.state = state == null ? "idle" : state;
            this.episodeId = episodeId == null ? "" : episodeId;
            this.feedUrl = feedUrl == null ? "" : feedUrl;
            this.audioUrl = audioUrl == null ? "" : audioUrl;
            this.title = title == null ? "" : title;
            this.podcastTitle = podcastTitle == null ? "" : podcastTitle;
            this.artworkUrl = artworkUrl == null ? "" : artworkUrl;
            this.positionMs = Math.max(0L, positionMs);
            this.durationMs = Math.max(0L, durationMs);
            this.speed = AudioProgressStore.clampSpeed(speed);
            this.playing = playing;
            this.error = error;
            this.active = !this.episodeId.isEmpty() && !"idle".equals(this.state);
        }

        public java.util.Map<String, Object> toMap() {
            java.util.LinkedHashMap<String, Object> map = new java.util.LinkedHashMap<>();
            map.put("active", active);
            map.put("state", state);
            map.put("episodeId", episodeId);
            map.put("feedUrl", feedUrl);
            map.put("audioUrl", audioUrl);
            map.put("title", title);
            map.put("podcastTitle", podcastTitle);
            map.put("artworkUrl", artworkUrl);
            map.put("positionMs", positionMs);
            map.put("durationMs", durationMs);
            map.put("speed", speed);
            map.put("playing", playing);
            if (error != null) map.put("error", error);
            return map;
        }
    }

    public interface StateListener {
        void onAudioState(StateSnapshot snapshot);
    }

    private static final List<StateListener> listeners = new CopyOnWriteArrayList<>();
    private static volatile AudioPlaybackService activeInstance;
    private static volatile StateSnapshot lastSnapshot = new StateSnapshot(
            "idle", "", "", "", "", "", "", 0L, 0L, 1.0f, false, null);

    public static void addListener(StateListener listener) {
        if (listener != null && !listeners.contains(listener)) listeners.add(listener);
    }

    public static void removeListener(StateListener listener) {
        if (listener != null) listeners.remove(listener);
    }

    /**
     * Renvoie l'état courant sans jamais interroger ExoPlayer hors du thread principal.
     * - Sur le thread principal : rafraîchit et mémorise l'instantané depuis ExoPlayer si le service tourne.
     * - Depuis un autre thread (ex. thread des plugins Capacitor) : renvoie `lastSnapshot` déjà mémorisé
     *   par le thread principal (ou l'entrée active d'AudioProgressStore si le service est arrêté).
     */
    public static StateSnapshot getCurrentSnapshot(Context context) {
        AudioPlaybackService instance = activeInstance;
        if (instance != null) {
            if (Looper.myLooper() == Looper.getMainLooper()) {
                StateSnapshot snap = instance.buildSnapshot(null);
                lastSnapshot = snap;
                return snap;
            }
            StateSnapshot cached = lastSnapshot;
            if (cached != null && cached.active) return cached;
        }
        // Service arrêté ou pas encore d'instantané actif : si un épisode était en cours dans AudioProgressStore, l'exposer en "paused"
        if (context != null) {
            AudioProgressStore.SessionTracker tracker = AudioProgressStore.tracker(context);
            String activeId = tracker.getActiveEpisodeId();
            AudioProgressStore.Entry entry = activeId != null ? tracker.getEntry(activeId) : null;
            if (entry != null && !entry.completed && !entry.audioUrl.isEmpty()) {
                return new StateSnapshot(
                        "paused",
                        entry.episodeId,
                        entry.feedUrl,
                        entry.audioUrl,
                        entry.title,
                        entry.podcastTitle,
                        entry.artworkUrl,
                        entry.positionMs,
                        entry.durationMs,
                        entry.speed,
                        false,
                        null);
            }
        }
        return lastSnapshot;
    }

    /** Interroge l'état sur le thread principal (celui d'ExoPlayer) et invoque le callback. */
    public static void getCurrentSnapshotAsync(Context context, StateListener callback) {
        if (callback == null) return;
        AudioPlaybackService instance = activeInstance;
        if (instance != null) {
            if (Looper.myLooper() == Looper.getMainLooper()) {
                callback.onAudioState(getCurrentSnapshot(context));
            } else {
                Context appCtx = context != null ? context.getApplicationContext() : null;
                instance.mainHandler.post(() -> callback.onAudioState(getCurrentSnapshot(appCtx)));
            }
            return;
        }
        callback.onAudioState(getCurrentSnapshot(context));
    }

    /** Met en pause l'audio immédiatement (ex. lancement d'une vidéo TV/VOD ou mosaïque) en sauvegardant la position. */
    public static void pauseIfPlaying(Context context) {
        AudioPlaybackService instance = activeInstance;
        if (instance != null) {
            instance.mainHandler.post(instance::pauseAndSave);
        }
    }

    private ExoPlayer player;
    private MediaSession mediaSession;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private String currentEpisodeId = "";
    private String currentFeedUrl = "";
    private String currentAudioUrl = "";
    private String currentTitle = "";
    private String currentPodcastTitle = "";
    private String currentArtworkUrl = "";
    private float currentSpeed = 1.0f;
    private String lastError = null;

    private final Runnable checkpointRunnable = new Runnable() {
        @Override
        public void run() {
            saveCurrentProgress(false);
            emitState();
            if (player != null && player.isPlaying()) {
                mainHandler.postDelayed(this, CHECKPOINT_INTERVAL_MS);
            }
        }
    };

    /**
     * Résout l'épisode à recharger lorsqu'une commande Reprendre arrive sur un lecteur vide
     * (y compris lorsque le service a été arrêté puis recréé avec `currentEpisodeId` vide).
     */
    static AudioProgressStore.Entry resolveSavedEntryForResume(
            AudioProgressStore.SessionTracker tracker,
            String currentEpisodeId) {
        if (tracker == null) return null;
        String targetId = (currentEpisodeId != null && !currentEpisodeId.isEmpty())
                ? currentEpisodeId
                : tracker.getActiveEpisodeId();
        if (targetId == null || targetId.isEmpty()) return null;
        AudioProgressStore.Entry saved = tracker.getEntry(targetId);
        if (saved == null || saved.audioUrl.isEmpty()) return null;
        return saved;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        ensurePlayer();
    }

    private void ensurePlayer() {
        if (player != null) return;
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(PlayerOptions.userAgent(this))
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(20_000)
                .setAllowCrossProtocolRedirects(true);
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .build();

        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .setSeekBackIncrementMs(SEEK_BACK_MS)
                .setSeekForwardIncrementMs(SEEK_FORWARD_MS)
                .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) {
                    saveCurrentProgress(true);
                } else if (playbackState == Player.STATE_READY) {
                    lastError = null;
                    saveCurrentProgress(false);
                }
                emitState();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                mainHandler.removeCallbacks(checkpointRunnable);
                if (isPlaying) {
                    mainHandler.postDelayed(checkpointRunnable, CHECKPOINT_INTERVAL_MS);
                } else {
                    saveCurrentProgress(false);
                }
                emitState();
            }

            @Override
            public void onPlaybackParametersChanged(PlaybackParameters playbackParameters) {
                currentSpeed = AudioProgressStore.clampSpeed(playbackParameters.speed);
                saveCurrentProgress(false);
                emitState();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                lastError = "Impossible de lire cet épisode (" + error.errorCode + ").";
                saveCurrentProgress(false);
                emitState();
            }
        });

        // Redirige aussi les commandes Suivant / Précédent du casque / écran verrouillé vers +30s / -15s
        // pour éviter qu'un appui sur le bouton du casque ne coupe l'épisode lorsqu'un seul média est chargé.
        ForwardingPlayer sessionPlayer = new ForwardingPlayer(player) {
            @Override
            public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .add(Player.COMMAND_SEEK_BACK)
                        .add(Player.COMMAND_SEEK_FORWARD)
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                if (command == Player.COMMAND_SEEK_BACK
                        || command == Player.COMMAND_SEEK_FORWARD
                        || command == Player.COMMAND_SEEK_TO_NEXT
                        || command == Player.COMMAND_SEEK_TO_PREVIOUS) {
                    return true;
                }
                return super.isCommandAvailable(command);
            }

            @Override
            public void seekToNext() {
                seekRelative(SEEK_FORWARD_MS);
            }

            @Override
            public void seekToNextMediaItem() {
                seekRelative(SEEK_FORWARD_MS);
            }

            @Override
            public void seekToPrevious() {
                seekRelative(-SEEK_BACK_MS);
            }

            @Override
            public void seekToPreviousMediaItem() {
                seekRelative(-SEEK_BACK_MS);
            }
        };

        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivity = PendingIntent.getActivity(
                this, 0, openApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        mediaSession = new MediaSession.Builder(this, sessionPlayer)
                .setSessionActivity(sessionActivity)
                .build();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        if (intent != null && intent.getAction() != null) {
            ensurePlayer();
            String action = intent.getAction();
            switch (action) {
                case ACTION_PLAY_EPISODE:
                    handlePlayEpisodeIntent(intent);
                    break;
                case ACTION_PAUSE:
                    pauseAndSave();
                    break;
                case ACTION_RESUME:
                    resumePlayback();
                    break;
                case ACTION_STOP:
                    stopAndSave();
                    break;
                case ACTION_SEEK_TO:
                    seekToPosition(intent.getLongExtra("positionMs", 0L));
                    break;
                case ACTION_SEEK_BY:
                    seekRelative(intent.getLongExtra("deltaMs", 0L));
                    break;
                case ACTION_SET_SPEED:
                    setSpeed(intent.getFloatExtra("speed", 1.0f));
                    break;
                default:
                    break;
            }
        }
        return START_STICKY;
    }

    private void handlePlayEpisodeIntent(Intent intent) {
        String episodeId = intent.getStringExtra("episodeId");
        String audioUrl = intent.getStringExtra("audioUrl");
        if (episodeId == null || episodeId.isEmpty() || audioUrl == null || audioUrl.isEmpty()) return;

        String feedUrl = intent.getStringExtra("feedUrl");
        String title = intent.getStringExtra("title");
        String podcastTitle = intent.getStringExtra("podcastTitle");
        String artworkUrl = intent.getStringExtra("artworkUrl");
        long explicitStartPos = intent.getLongExtra("startPositionMs", -1L);
        float explicitSpeed = intent.getFloatExtra("speed", 0f);

        // Si le même épisode est déjà chargé dans le lecteur et qu'aucun saut explicite n'est demandé,
        // on reprend simplement la lecture (et met à jour la vitesse si précisée).
        if (episodeId.equals(currentEpisodeId) && player != null && player.getMediaItemCount() > 0
                && player.getPlaybackState() != Player.STATE_IDLE && player.getPlaybackState() != Player.STATE_ENDED) {
            if (explicitSpeed > 0f) setSpeed(explicitSpeed);
            if (explicitStartPos >= 0L) player.seekTo(explicitStartPos);
            player.setPlayWhenReady(true);
            emitState();
            return;
        }

        // Transition atomique : sauvegarde l'épisode précédent sous son propre identifiant AVANT
        // de basculer currentEpisodeId, puis récupère la position et la vitesse de reprise du nouvel épisode.
        long prevPos = 0L;
        long prevDur = 0L;
        if (!currentEpisodeId.isEmpty() && player != null && player.getMediaItemCount() > 0) {
            prevPos = Math.max(0L, player.getCurrentPosition());
            long d = player.getDuration();
            if (d != C.TIME_UNSET && d > 0) prevDur = d;
        }

        AudioProgressStore.SessionTracker tracker = AudioProgressStore.tracker(this);
        AudioProgressStore.Entry target = tracker.transitionToEpisode(
                prevPos,
                prevDur,
                currentSpeed,
                episodeId,
                feedUrl,
                audioUrl,
                title,
                podcastTitle,
                artworkUrl,
                explicitStartPos,
                explicitSpeed,
                System.currentTimeMillis());
        AudioProgressStore.persist(this);

        currentEpisodeId = target.episodeId;
        currentFeedUrl = target.feedUrl;
        currentAudioUrl = target.audioUrl;
        currentTitle = target.title;
        currentPodcastTitle = target.podcastTitle;
        currentArtworkUrl = target.artworkUrl;
        currentSpeed = target.speed;
        lastError = null;

        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .setTitle(currentTitle)
                .setArtist(currentPodcastTitle)
                .setAlbumTitle(currentPodcastTitle);
        if (!currentArtworkUrl.isEmpty()) {
            try {
                meta.setArtworkUri(Uri.parse(currentArtworkUrl));
            } catch (Exception ignored) {}
        }

        MediaItem item = new MediaItem.Builder()
                .setMediaId(currentEpisodeId)
                .setUri(Uri.parse(currentAudioUrl))
                .setMediaMetadata(meta.build())
                .build();

        player.setPlaybackParameters(new PlaybackParameters(currentSpeed));
        if (target.positionMs > 0L) {
            player.setMediaItem(item, target.positionMs);
        } else {
            player.setMediaItem(item);
        }
        player.prepare();
        player.setPlayWhenReady(true);
        emitState();
    }

    private void pauseAndSave() {
        if (player != null) {
            player.setPlayWhenReady(false);
            saveCurrentProgress(false);
            emitState();
        }
    }

    private void resumePlayback() {
        if (player == null) return;
        if (player.getMediaItemCount() == 0) {
            // Recharger depuis AudioProgressStore si le lecteur était vide
            // (y compris après recréation du service où currentEpisodeId est vide : on reprend lastActiveEpisodeId)
            AudioProgressStore.Entry saved = resolveSavedEntryForResume(
                    AudioProgressStore.tracker(this),
                    currentEpisodeId);
            if (saved != null) {
                Intent reload = new Intent(ACTION_PLAY_EPISODE);
                reload.putExtra("episodeId", saved.episodeId);
                reload.putExtra("feedUrl", saved.feedUrl);
                reload.putExtra("audioUrl", saved.audioUrl);
                reload.putExtra("title", saved.title);
                reload.putExtra("podcastTitle", saved.podcastTitle);
                reload.putExtra("artworkUrl", saved.artworkUrl);
                reload.putExtra("startPositionMs", saved.positionMs);
                reload.putExtra("speed", saved.speed);
                handlePlayEpisodeIntent(reload);
                return;
            }
            return;
        }
        if (player.getPlaybackState() == Player.STATE_ENDED) {
            player.seekTo(0L);
        } else if (player.getPlaybackState() == Player.STATE_IDLE && player.getMediaItemCount() > 0) {
            player.prepare();
        }
        player.setPlayWhenReady(true);
        emitState();
    }

    private void stopAndSave() {
        mainHandler.removeCallbacks(checkpointRunnable);
        saveCurrentProgress(false);
        AudioProgressStore.tracker(this).clearActiveEpisodeId();
        AudioProgressStore.persist(this);
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
        currentEpisodeId = "";
        currentAudioUrl = "";
        lastError = null;
        emitState();
        stopSelf();
    }

    private void seekToPosition(long positionMs) {
        if (player == null || player.getMediaItemCount() == 0) return;
        long duration = player.getDuration();
        long clamped = Math.max(0L, duration != C.TIME_UNSET && duration > 0 ? Math.min(duration, positionMs) : positionMs);
        player.seekTo(clamped);
        saveCurrentProgress(false);
        emitState();
    }

    private void seekRelative(long deltaMs) {
        if (player == null || player.getMediaItemCount() == 0) return;
        seekToPosition(player.getCurrentPosition() + deltaMs);
    }

    private void setSpeed(float speed) {
        currentSpeed = AudioProgressStore.clampSpeed(speed);
        if (player != null) {
            player.setPlaybackParameters(new PlaybackParameters(currentSpeed));
        }
        saveCurrentProgress(false);
        emitState();
    }

    private void saveCurrentProgress(boolean ended) {
        if (currentEpisodeId == null || currentEpisodeId.isEmpty() || player == null || player.getMediaItemCount() == 0) {
            return;
        }
        long pos = Math.max(0L, player.getCurrentPosition());
        long dur = player.getDuration();
        long validDur = (dur != C.TIME_UNSET && dur > 0) ? dur : 0L;
        AudioProgressStore.tracker(this).saveProgress(
                currentEpisodeId,
                currentFeedUrl,
                currentAudioUrl,
                currentTitle,
                currentPodcastTitle,
                currentArtworkUrl,
                pos,
                validDur,
                currentSpeed,
                ended,
                System.currentTimeMillis());
        AudioProgressStore.persist(this);
    }

    private StateSnapshot buildSnapshot(@Nullable String errorOverride) {
        if (player == null || currentEpisodeId.isEmpty() || player.getMediaItemCount() == 0) {
            return new StateSnapshot("idle", "", "", "", "", "", "", 0L, 0L, currentSpeed, false, errorOverride);
        }
        int playbackState = player.getPlaybackState();
        boolean playing = player.isPlaying();
        String state;
        String err = errorOverride != null ? errorOverride : lastError;
        if (err != null) {
            state = "error";
        } else if (playbackState == Player.STATE_BUFFERING) {
            state = "loading";
        } else if (playbackState == Player.STATE_ENDED) {
            state = "ended";
        } else if (playing) {
            state = "playing";
        } else {
            state = "paused";
        }
        long pos = Math.max(0L, player.getCurrentPosition());
        long dur = player.getDuration();
        long validDur = (dur != C.TIME_UNSET && dur > 0) ? dur : 0L;
        if (validDur == 0L) {
            AudioProgressStore.Entry saved = AudioProgressStore.tracker(this).getEntry(currentEpisodeId);
            if (saved != null) validDur = saved.durationMs;
        }
        return new StateSnapshot(
                state,
                currentEpisodeId,
                currentFeedUrl,
                currentAudioUrl,
                currentTitle,
                currentPodcastTitle,
                currentArtworkUrl,
                pos,
                validDur,
                currentSpeed,
                playing,
                err);
    }

    private void emitState() {
        StateSnapshot snap = buildSnapshot(null);
        lastSnapshot = snap;
        for (StateListener listener : listeners) {
            try {
                listener.onAudioState(snap);
            } catch (Exception ignored) {}
        }
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        saveCurrentProgress(false);
        if (player == null || !player.getPlayWhenReady() || player.getMediaItemCount() == 0) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        saveCurrentProgress(false);
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (activeInstance == this) activeInstance = null;
        super.onDestroy();
    }
}
