package com.lecteur.iptv;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.LinkedHashMap;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.media.AudioManager;
import android.view.Choreographer;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.content.res.ColorStateList;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Format;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import java.util.List;
import java.util.Locale;
import android.content.pm.PackageManager;
import android.Manifest;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.documentfile.provider.DocumentFile;
import androidx.media3.common.MediaItem;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.TrackSelectionParameters;
import java.util.Collections;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import androidx.mediarouter.app.MediaRouteButton;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.Session;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;

import java.util.ArrayList;
import android.app.PictureInPictureParams;
import android.util.Rational;
import android.util.SparseArray;
import android.view.KeyEvent;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.text.SpannableString;
import android.text.Spannable;
import android.text.style.ForegroundColorSpan;
import java.text.SimpleDateFormat;
import java.util.Date;

@UnstableApi
public class NativePlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";

    /** Réglages de mémoire tampon : démarrage rapide en direct, confort conservé en VOD.
     *  Valeurs candidates à mesurer sur la box (protocole : 20 zappings, 30 min de lecture)
     *  avant de les figer ; un démarrage trop court augmente les coupures. */
    /** Fréquence d'affichage adaptée à la vidéo (réglage AFR), lue à l'ouverture. */
    private boolean afrEnabled;
    /** Reprises automatiques après une erreur transitoire (coupure réseau, serveur surchargé). */
    private static final int AUTO_RETRY_MAX = 2;
    /** Fenêtre de rafale P+/P− : les appuis suivant le premier coalescent en un seul tune. */
    private static final int ZAP_SETTLE_MS = 350;
    /** Durée d'affichage du bandeau de zap. */
    private static final int ZAP_OVERLAY_MS = 3000;

    private ExoPlayer player;
    private PlayerView playerView;
    private ProgressBar loadingBar;
    private LinearLayout topBar;
    private final Handler hideHandler = new Handler(Looper.getMainLooper());
    private boolean isControlsVisible = true;
    private int currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
    private String streamUrl;
    private String streamTitle;
    private Button retryButton;
    private ArrayList<String> channelUrls;
    private ArrayList<String> channelTitles;
    private int channelIndex = -1;
    /** Chaîne regardée juste avant : bouton « retour » et touche Dernière chaîne. */
    private int previousIndex = -1;
    /** Groupe et programmes à venir ([début, fin, titre]) de chaque chaîne du contexte de zapping. */
    private ArrayList<String> channelGroups;
    private ArrayList<JSONArray> channelPrograms;
    /** Numéro affiché de chaque chaîne du contexte (tvg-chno, sinon position dans la liste complète). */
    private ArrayList<String> channelNumbers;
    /** Logo (URL) de chaque chaîne du contexte : affiché dans le bandeau de zap. */
    private ArrayList<String> channelLogos;
    /** Taille de la liste complète côté page : au-delà du contexte, la page relance sur le numéro saisi. */
    private int channelTotal = 0;
    /** Numéro normalisé → premier index de chaîne : la saisie ne rescanne pas la liste
     *  (et ne rejoue pas une regex par entrée) à chaque chiffre tapé. */
    private final HashMap<String, Integer> numberIndex = new HashMap<>();
    /** Lecture de zaplist.tsv hors thread UI (démarrage à froid) : la fenêtre suffit à la première image. */
    private java.util.concurrent.ExecutorService fullListExecutor;
    /** Saisie du numéro de chaîne aux touches 0-9 de la télécommande (9 chiffres : numéros choisis). */
    private final ChannelNumberInput numberBuffer = new ChannelNumberInput();
    private final Handler numberHandler = new Handler(Looper.getMainLooper());
    private TextView numberOverlay;
    /** Bandeau de zap : logo, numéro · nom et programme en cours de la chaîne visée. */
    private LinearLayout zapOverlay;
    private ImageView zapLogo;
    private TextView zapHeadline, zapProgram;
    private final Handler zapHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideZapRunnable = () -> { if (zapOverlay != null) zapOverlay.setVisibility(View.GONE); };
    /** Cible cumulée des appuis P+/P− rapprochés : un seul tune à la fin de la rafale. */
    private int pendingZapTarget = -1;
    /** Vrai du premier appui P+/P− jusqu'à la fin de la fenêtre de rafale : le premier
     *  appui accorde immédiatement, les suivants coalescent pendant ZAP_SETTLE_MS. */
    private boolean zapBurst;
    private final Runnable zapCommitRunnable = this::commitPendingZap;
    /** Minuteur du tune de rafale, distinct de hideHandler : le masquage des commandes purge
     *  tout le minuteur de la barre (removeCallbacksAndMessages) et ne doit pas annuler le
     *  tune en attente (ex. deux appuis P+ puis OK avant la fin de la rafale). Il ne meurt
     *  qu'avec un nouveau zap, un saut direct ou la sortie (cancelPendingZap). */
    private final Handler zapCommitHandler = new Handler(Looper.getMainLooper());
    /** Chargeur de logos du bandeau : deux fils d'exécution et un cache mémoire, sans dépendance. */
    private static final int LOGO_CACHE_MAX_BYTES = 4 * 1024 * 1024;
    /** Cache borné en octets (et non en entrées) : un logo grand format ne chasse pas dix petits. */
    private final android.util.LruCache<String, android.graphics.Bitmap> logoCache = new android.util.LruCache<String, android.graphics.Bitmap>(LOGO_CACHE_MAX_BYTES) {
        @Override protected int sizeOf(String key, android.graphics.Bitmap value) { return value.getByteCount(); }
    };
    private java.util.concurrent.ExecutorService logoExecutor;
    /** Dernière chaîne visée : les téléchargements de logos périmés sortent de la file sans se lancer. */
    private final java.util.concurrent.atomic.AtomicInteger zapWantedTarget = new java.util.concurrent.atomic.AtomicInteger(-1);
    /** Numéro demandé hors du contexte chargé : rendu à la page à la fermeture. */
    private String jumpNumber;
    private LinearLayout infoBar;
    private LinearLayout infoTimeRow;
    private TextView infoChannel, infoNow, infoTimes, infoNext;
    private ProgressBar infoProgress;
    private Button btnPrevious;
    private FrameLayout channelPanel;
    private LinearLayout channelSheet;
    private ListView channelListView;
    private ChannelPanelAdapter channelAdapter;
    private LinearLayout groupChips;
    private String panelGroup = null;
    private boolean panelFavorites;
    private int[] favoriteChannels = new int[0];
    private ChannelPanelIndex panelIndex;
    private HorizontalScrollView groupChipsScroll;
    private NativeFavoriteStore favoriteStore;
    private boolean pipActive = false;
    private final SimpleDateFormat hourFormat = new SimpleDateFormat("HH:mm", Locale.FRANCE);
    /** Bouton recevant la sélection télécommande à l'ouverture des commandes (aucun effet de bord sur la lecture). */
    /** Ligne de programme en cours par chaîne : le panneau relit chaque ligne à chaque défilement,
     *  le cache évite de refaire le scan EPG et un format d'heure à chaque bind. */
    private final SparseArray<ProgramLine> programLineCache = new SparseArray<>();
    // ── Mesure de fluidité du panneau des chaînes (protocole box : appui prolongé Haut/Bas) ──
    private int panelFrameCount, panelJank32, panelJank50;
    private long panelWorstFrameMs, panelLastFrameNanos;

    /** Programme en cours d'une chaîne, avec sa fenêtre de validité temporelle. */
    private static class ProgramLine {
        long start, end;
        String text;
        boolean hasProgram;
    }

    /**
     * Archive d'une chaîne, telle que la page la connaît. Xtream : un modèle d'adresse
     * (`{minutes}`, `{start}`) et le fuseau du serveur, remplis à l'appui avec le programme
     * qui passe à ce moment-là. M3U : une adresse déjà calculée, limitée à son programme.
     */
    private static final class Catchup {
        final String template, timezone, url;
        final long urlStart, urlEnd;
        Catchup(String template, String timezone, String url, long urlStart, long urlEnd) {
            this.template = template; this.timezone = timezone; this.url = url;
            this.urlStart = urlStart; this.urlEnd = urlEnd;
        }
        boolean isAvailable() { return !template.isEmpty() || !url.isEmpty(); }
    }

    // Palette « Salle obscure » : un seul accent, l'orange du logo, qui sert aussi au direct.
    private static final int C_BG = PlayerOption.C_BG;
    private static final int C_CARD = PlayerOption.C_CARD;
    private static final int C_ELEV = PlayerOption.C_ELEV;
    private static final int C_TRACK = PlayerOption.C_TRACK;
    private static final int C_TEXT = PlayerOption.C_TEXT;
    private static final int C_MUTED = PlayerOption.C_MUTED;
    private static final int C_DIM = PlayerOption.C_DIM;
    private static final int C_ACCENT = PlayerOption.C_ACCENT;
    private static final int C_LIVE = PlayerOption.C_ACCENT;
    /** Vitesses proposées (films et séries). */
    private static final float[] SPEEDS = { 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f };
    /** Retard sur le direct à partir duquel le lecteur l'affiche et propose d'y revenir. */
    private static final long LIVE_DELAY_SHOWN_MS = 3_000;

    /** Interface télécommande (TV, box) : bandeau en rangées en bas, pas de barre en haut. */
    private boolean tvUi;
    private TvBand tvBand;
    private OptionsSheet optionsSheet;
    /** Dernière commande du bandeau utilisée : le focus y revient à la réouverture. */
    private String lastUsedKey;
    /** Bandeau d'infos seul, sans commandes ni focus, après un zapping (TV). */
    private boolean infoOnly;
    private LinearLayout seekRow;
    private ProgressBar seekBar;
    private TextView seekElapsed, seekRemaining;
    private TextView topSubtitle;
    private ImageButton btnOptions;
    private LinearLayout centerControls;
    private ImageButton btnCenterPause;
    private Button btnBackToLive;
    /** Téléphone : dernière commande de la barre d'infos, « Depuis le début » ou « Revenir au direct ». */
    private Button btnRestart;
    private TextView cornerBadge;
    private float playbackSpeed = 1f;
    /** Orientation sur téléphone : 0 automatique, 1 paysage, 2 verrouillée. */
    private int orientationMode;
    // ── Pause du direct ──
    /** Début de la pause en cours (horloge système), 0 en lecture. */
    private long pausedAtMs;
    /** Retard accumulé sur le direct par les pauses précédentes. */
    private long liveDelayMs;
    /** Le flux a lâché pendant la pause : la reprise repartira au direct. */
    private boolean liveLostWhilePaused;
    // ── Différé du programme en cours ──
    /** true : le lecteur joue l'archive du programme, pas le direct (la chaîne ne change pas). */
    private boolean archive;
    private long archiveStartMs, archiveEndMs;
    private String archiveUrl, archiveTitle;
    /** Archive annoncée par la page, par adresse de chaîne (liste : archive Xtream ou replay M3U). */
    private final HashMap<String, Catchup> catchupByUrl = new HashMap<>();
    private final Handler tickHandler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            updateInfoBar();
            updateCornerBadge();
            if (needsTicker()) tickHandler.postDelayed(this, 1000);
        }
    };
    private TextView tvTitle;
    private boolean vod;
    private boolean playWhenReady = true;
    private long positionMs;
    private long durationMs;
    private String mediaId;
    private final LinkedHashMap<String, JSONObject> visitedProgress = new LinkedHashMap<>();
    /** Ids d'épisodes (séries) : mediaId suit l'épisode en cours lors du zapping. */
    private ArrayList<String> episodeIds;
    /** true entre onResume et onPause : l'activity est réellement visible. */
    private boolean resumed = false;
    private MediaSession mediaSession;
    private CastContext castContext;
    private boolean casting = false;
    private SessionManagerListener<Session> castSessionListener;
    private Button btnRec;
    private boolean recording = false;
    private Recorder recorder;
    private String recordFolderUri;
    private ActivityResultLauncher<Intent> recordFolderLauncher;
    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private LinearLayout gestureHudLayout;
    private TextView gestureHudIcon;
    private TextView gestureHudValue;
    private ProgressBar gestureHudProgress;
    private Button btnSleep;
    private final Handler sleepHandler = new Handler(Looper.getMainLooper());
    private Runnable sleepTicker;
    private long sleepTargetTimeMs = 0L;
    private boolean sleepOnEnd = false;
    private final Handler nextEpisodeHandler = new Handler(Looper.getMainLooper());
    private LinearLayout nextEpisodePanel;
    private TextView nextEpisodeLabel;
    private TextView nextEpisodeCountdown;
    private View nextEpisodeProgress;
    private Button nextEpisodeWatch;
    private static final long NEXT_EPISODE_DELAY_MS = 8000;
    private ExoPlayer nextEpisodePlayer;
    private long nextEpisodeDeadline;
    private final Runnable nextEpisodeTicker = new Runnable() {
        @Override public void run() {
            if (!resumed || isFinishing() || player == null || player != nextEpisodePlayer || player.getPlaybackState() != Player.STATE_ENDED) {
                cancelNextEpisode();
                return;
            }
            long remaining = nextEpisodeDeadline - SystemClock.elapsedRealtime();
            if (remaining <= 0) { cancelNextEpisode(); switchChannel(1); return; }
            String title = channelTitles != null && channelIndex + 1 < channelTitles.size() ? channelTitles.get(channelIndex + 1) : "Épisode suivant";
            nextEpisodeLabel.setText(title);
            nextEpisodeCountdown.setText("dans " + ((remaining + 999) / 1000) + " s");
            nextEpisodeProgress.setScaleX(1f - (float) remaining / NEXT_EPISODE_DELAY_MS);
            nextEpisodeHandler.postDelayed(this, 200);
        }
    };
    private final Handler gestureHudHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideGestureHudRunnable = () -> {
        if (gestureHudLayout != null) gestureHudLayout.setVisibility(View.GONE);
    };
    private AudioManager audioManager;
    private float volumeAccumulator = 0.0f;
    private final Runnable checkpoint = new Runnable() {
        @Override public void run() { saveProgress(); progressHandler.postDelayed(this, 5000); }
    };

    // ── Panneau d'erreur : cause compréhensible + actions de récupération ──
    private LinearLayout errorPanel;
    private TextView errorText;
    private Button btnNextChannel;
    private Button btnVlc;

    // ── Diagnostics de lecture (compteurs de session, aucune URL retenue) ──
    private long sessionStartedAtMs;
    private int zapCount;
    /** Coupures de lecture : ancrées au passage en BUFFERING, comptées à la clôture (reprise,
     *  changement de média, libération du lecteur, fin de session) — jamais par un export
     *  intermédiaire, qui lit les compteurs sans arrêter la mesure. */
    private final RebufferTracker rebuffer = new RebufferTracker(SystemClock::elapsedRealtime);
    /** Temps de lecture effective, versé au journal d'usage de Découvrir (pauses et chargements exclus). */
    private final PlayTimeMeter playMeter = new PlayTimeMeter(SystemClock::elapsedRealtime);
    private long droppedFrames;
    private int errorCount;
    private String lastErrorCode;
    /** Remis à zéro à chaque changement de média : mesure le premier rendu du nouveau flux. */
    private boolean firstFrameLogged;
    /** Instant du dernier prepareMedia : donne zap_ms sur la première image du nouveau flux. */
    private long zapStartedAtMs;
    /** Tentatives automatiques restantes après une erreur transitoire. */
    private int autoRetriesLeft;
    private final Runnable autoRetryRunnable = new Runnable() {
        @Override public void run() {
            if (player != null && streamUrl != null && !isFinishing()) prepareMedia(streamUrl);
        }
    };
    private final Handler reconnectHandler = new Handler(Looper.getMainLooper());
    private String reconnectFailureMessage = "Le flux s'est arrêté.";
    private long reconnectStartedAtMs;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback connectivityCallback;
    private boolean networkConnected = true;
    private final LiveReconnectController liveReconnect = new LiveReconnectController(
        SystemClock::elapsedRealtime,
        new LiveReconnectController.Scheduler() {
            @Override public void postDelayed(Runnable task, long delayMs) { reconnectHandler.postDelayed(task, delayMs); }
            @Override public void removeCallbacks(Runnable task) { reconnectHandler.removeCallbacks(task); }
        },
        new LiveReconnectController.Listener() {
            @Override public void onRetry(int attempt) {
                if (!canRecoverLive()) { cancelLiveReconnect("inactive"); return; }
                android.util.Log.i("IPTV-Playback", "live_reconnect_attempt attempt=" + attempt
                    + " elapsed_ms=" + (SystemClock.elapsedRealtime() - reconnectStartedAtMs));
                pausedAtMs = 0; liveDelayMs = 0; liveLostWhilePaused = false;
                if (player != null) prepareMedia(streamUrl); else initPlayer(streamUrl);
            }
            @Override public void onExhausted() {
                android.util.Log.i("IPTV-Playback", "live_reconnect_exhausted elapsed_ms="
                    + (SystemClock.elapsedRealtime() - reconnectStartedAtMs));
                releasePlayer();
                if ((resumed || isInPipMode()) && !isFinishing() && !casting) showError(reconnectFailureMessage);
            }
        });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        android.util.Log.i("IPTV-Playback", "activity_created elapsed_ms=" + SystemClock.elapsedRealtime());
        // Début de la session de lecture pour le bilan (rebuffers, images perdues, erreurs).
        sessionStartedAtMs = SystemClock.elapsedRealtime();
        autoRetriesLeft = AUTO_RETRY_MAX;

        // Keep screen on while playing video
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        afrEnabled = PlayerOptions.afr(this);
        streamUrl = getIntent().getStringExtra(EXTRA_URL);
        streamTitle = getIntent().getStringExtra(EXTRA_TITLE);
        vod = getIntent().getBooleanExtra("vod", false);
        favoriteStore = new NativeFavoriteStore(this);
        // La page transmet le mode d'interface choisi (Auto, TV, Mobile) ; sinon, détection.
        tvUi = getIntent().hasExtra("tvUi") ? getIntent().getBooleanExtra("tvUi", false) : detectTelevision();
        orientationMode = vod && !tvUi ? 1 : 0;
        if (savedInstanceState != null) {
            playbackSpeed = savedInstanceState.getFloat("playbackSpeed", 1f);
            orientationMode = savedInstanceState.getInt("orientationMode", orientationMode);
            lastUsedKey = savedInstanceState.getString("lastUsedKey");
        }
        channelIndex =savedInstanceState != null ? savedInstanceState.getInt("channelIndex", -1) : getIntent().getIntExtra("channelIndex", -1);
        String path = getIntent().getStringExtra("channelFile");
        if (path != null) {
            try {
                File file = new File(path);
                if (!file.getCanonicalFile().getParentFile().equals(getCacheDir().getCanonicalFile()) || !file.getName().startsWith("zap-")) throw new Exception();
                StringBuilder json = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
                    char[] buffer = new char[8192]; int count;
                    while ((count = reader.read(buffer)) != -1) json.append(buffer, 0, count);
                }
                JSONArray entries = new JSONArray(json.toString());
                channelUrls = new java.util.ArrayList<>(); channelTitles = new java.util.ArrayList<>();
                channelGroups = new ArrayList<>(); channelPrograms = new ArrayList<>(); channelNumbers = new ArrayList<>(); channelLogos = new ArrayList<>();
                for (int i = 0; i < entries.length(); i++) {
                    JSONArray entry = entries.getJSONArray(i);
                    channelUrls.add(entry.getString(0)); channelTitles.add(entry.getString(1));
                    channelGroups.add(entry.length() > 2 ? entry.optString(2, "") : "");
                    JSONArray programs = entry.length() > 3 ? entry.optJSONArray(3) : null;
                    channelPrograms.add(programs != null ? programs : new JSONArray());
                    channelNumbers.add(entry.length() > 4 ? entry.optString(4, "") : "");
                    channelLogos.add(entry.length() > 5 ? entry.optString(5, "") : "");
                    JSONArray catchup = entry.length() > 6 ? entry.optJSONArray(6) : null;
                    if (catchup != null && catchup.length() >= 5) {
                        Catchup c = new Catchup(catchup.optString(0, ""), catchup.optString(1, ""),
                                catchup.optString(2, ""), catchup.optLong(3, 0), catchup.optLong(4, 0));
                        if (c.isAvailable()) catchupByUrl.put(channelUrls.get(i), c);
                    }
                }
                channelTotal = Math.max(channelUrls.size(), getIntent().getIntExtra("channelTotal", channelUrls.size()));
                if (channelIndex >= 0 && channelIndex < channelUrls.size()) {
                    streamUrl = channelUrls.get(channelIndex); streamTitle = channelTitles.get(channelIndex);
                }
                android.util.Log.i("IPTV-Playback", "zap_catchup channels=" + catchupByUrl.size()
                    + " current=" + catchupByUrl.containsKey(streamUrl));
            } catch (Exception ignored) { channelUrls = null; channelTitles = null; programLineCache.clear(); }
        }
        // Après une rotation, l'index sauvegardé désigne déjà la liste complète : l'adoption
        // reste bloquante (cet index ne désigne pas la fenêtre). Au démarrage à froid, elle
        // part en tâche de fond — la fenêtre de 300 chaînes suffit à lancer la première image.
        boolean savedFull = savedInstanceState != null && savedInstanceState.getBoolean("fullList", false);
        if (savedFull) {
            adoptFullList(true);
            // Index sauvegardé sur la liste complète devenue illisible : pas de zapping plutôt qu'une mauvaise chaîne.
            if (!fullListAdopted) channelUrls = null;
        } else {
            adoptFullListAsync();
        }
        if (channelUrls == null || channelTitles == null
                || channelUrls.size() != channelTitles.size()
                || channelIndex < 0 || channelIndex >= channelUrls.size()) {
            channelUrls = null; channelTitles = null; channelIndex = -1;
            channelGroups = null; channelPrograms = null; channelNumbers = null; channelLogos = null; channelTotal = 0;
            programLineCache.clear();
        }
        if (savedInstanceState != null) previousIndex = savedInstanceState.getInt("previousIndex", -1);
        if (vod) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        episodeIds = getIntent().getStringArrayListExtra("episodeIds");
        mediaId = getIntent().getStringExtra("mediaId");
        if (vod && episodeIds != null && channelIndex >= 0 && channelIndex < episodeIds.size()) {
            mediaId = episodeIds.get(channelIndex);
        }
        if (savedInstanceState != null) mediaId = savedInstanceState.getString("mediaId", mediaId);
        positionMs = getIntent().getLongExtra("startPositionMs", 0);
        if (savedInstanceState != null) {
            positionMs = savedInstanceState.getLong("positionMs", positionMs);
            playWhenReady = savedInstanceState.getBoolean("playWhenReady", true);
            try {
                JSONArray progress = new JSONArray(savedInstanceState.getString("visitedProgress", "[]"));
                for (int i = 0; i < progress.length(); i++) {
                    JSONObject entry = progress.getJSONObject(i);
                    visitedProgress.put(entry.getString("mediaId"), entry);
                }
            } catch (Exception ignored) {}
        } else if (vod && mediaId != null) {
            if (getIntent().getBooleanExtra("restart", false)) getSharedPreferences("vod", MODE_PRIVATE).edit().remove(mediaId).apply();
            else positionMs = getSharedPreferences("vod", MODE_PRIVATE).getLong(mediaId, positionMs);
        }
        if (streamTitle == null || streamTitle.isEmpty()) {
            streamTitle = getString(R.string.app_name);
        }

        if (streamUrl == null || streamUrl.isEmpty()) {
            Toast.makeText(this, "URL de flux manquante", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        // Index des numéros construit une fois pour la liste chargée (fenêtre ou complète).
        rebuildNumberIndex();
        createMediaSession();
        initCast();
        initRecorder();
        buildUI();
        hideSystemUI();
    }

    private void hideSystemUI() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            // Creating the decor view first is required on recent Android releases.
            // Window.getInsetsController() can crash before setContentView creates it.
            final WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
            );
        }
    }

    private void buildUI() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // PlayerView
        playerView = new PlayerView(this);
        FrameLayout.LayoutParams pvParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        pvParams.gravity = Gravity.CENTER;
        playerView.setLayoutParams(pvParams);
        // Téléphone, films et séries : contrôleur Media3 (barre de temps, lecture). Ses propres
        // réglages (vitesse, pistes) sont retirés : ils passent par le panneau Options. Sur TV,
        // le bandeau du bas remplace le contrôleur, pour suivre les règles de la télécommande.
        playerView.setUseController(vod && !tvUi);
        playerView.setFocusable(false);
        if (vod && !tvUi) {
            playerView.setShowSubtitleButton(false);
            playerView.setControllerShowTimeoutMs(3500);
            View settings = playerView.findViewById(androidx.media3.ui.R.id.exo_settings);
            if (settings != null) settings.setVisibility(View.GONE);
        }
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        root.addView(playerView);

        // Loading spinner
        loadingBar = new ProgressBar(this);
        FrameLayout.LayoutParams pbParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        pbParams.gravity = Gravity.CENTER;
        loadingBar.setLayoutParams(pbParams);
        root.addView(loadingBar);

        // Panneau d'erreur : cause lisible + reprise (réessayer, chaîne suivante, lecteur externe).
        // Largeur bornée et boutons empilés pleine largeur : en WRAP_CONTENT, le panneau suivait
        // la longueur du message et les deux boutons à poids 0 se tassaient jusqu'à couper
        // leur libellé hors du cadre (constaté sur TV).
        errorPanel = cappedColumn(400);
        errorPanel.setBackground(panelCard());
        errorPanel.setPadding(dp(24), dp(24), dp(24), dp(24));
        FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        errorParams.setMargins(dp(16), dp(16), dp(16), dp(16));
        errorPanel.setLayoutParams(errorParams);
        errorPanel.setVisibility(View.GONE);

        LinearLayout errorHead = new LinearLayout(this);
        errorHead.setOrientation(LinearLayout.HORIZONTAL);
        FrameLayout errorBadge = new FrameLayout(this);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setShape(GradientDrawable.OVAL);
        badgeBg.setColor(Color.argb(41, Color.red(PlayerOption.C_ERROR), Color.green(PlayerOption.C_ERROR), Color.blue(PlayerOption.C_ERROR)));
        errorBadge.setBackground(badgeBg);
        ImageView errorIcon = new ImageView(this);
        errorIcon.setImageResource(R.drawable.ic_player_alert);
        errorIcon.setImageTintList(ColorStateList.valueOf(PlayerOption.C_ERROR));
        errorIcon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        errorBadge.addView(errorIcon, new FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER));
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(dp(40), dp(40));
        badgeParams.setMarginEnd(dp(14));
        errorHead.addView(errorBadge, badgeParams);
        LinearLayout errorTexts = new LinearLayout(this);
        errorTexts.setOrientation(LinearLayout.VERTICAL);
        TextView errorTitle = new TextView(this);
        errorTitle.setText("Lecture impossible");
        errorTitle.setTextColor(C_TEXT);
        errorTitle.setTextSize(18);
        errorTitle.setTypeface(Typeface.DEFAULT_BOLD);
        errorTitle.setSingleLine(true);
        errorTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        errorTexts.addView(errorTitle);
        errorText = new TextView(this);
        errorText.setTextColor(C_MUTED);
        errorText.setTextSize(14);
        errorText.setLineSpacing(0, 1.15f);
        errorText.setMaxLines(3);
        errorText.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams errorTextParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        errorTextParams.topMargin = dp(4);
        errorTexts.addView(errorText, errorTextParams);
        errorHead.addView(errorTexts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        errorPanel.addView(errorHead);

        retryButton = panelButton("Réessayer la lecture", R.drawable.ic_player_replay, false, v -> {
            hideError();
            releasePlayer();
            initPlayer(streamUrl);
        });
        btnNextChannel = panelButton("Chaîne suivante", R.drawable.ic_player_next, false, v -> { hideError(); switchChannel(1); });
        btnVlc = panelButton("Ouvrir dans VLC", R.drawable.ic_player_external, false, v -> openInVlc());
        int errorGap = dp(20);
        for (Button b : new Button[] { retryButton, btnNextChannel, btnVlc }) {
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
            p.topMargin = errorGap;
            errorPanel.addView(b, p);
            errorGap = dp(8);
        }
        root.addView(errorPanel);

        // Barre du haut (téléphone) : retour, titre, puis trois icônes. Le reste est dans Options.
        topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        // Dégradé vers la transparence : l'image reste visible sous les commandes.
        topBar.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { Color.parseColor("#E60B0B0D"), Color.parseColor("#990B0B0D"), Color.TRANSPARENT }));
        topBar.setPadding(dp(8), dp(8), dp(8), dp(28));
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        buildPhoneTopBar();
        root.addView(topBar);
        // Sur TV, tout passe par le bandeau du bas, ouvert par OK.
        if (tvUi) topBar.setVisibility(View.GONE);
        // Floating Gesture HUD
        gestureHudLayout = new LinearLayout(this);
        gestureHudLayout.setOrientation(LinearLayout.VERTICAL);
        gestureHudLayout.setGravity(Gravity.CENTER);
        gestureHudLayout.setPadding(dp(24), dp(16), dp(24), dp(16));

        GradientDrawable hudBg = new GradientDrawable();
        hudBg.setColor(Color.parseColor("#F2141417")); // slate-900 / 90%
        hudBg.setCornerRadius(dp(16));
        hudBg.setStroke(dp(1), Color.parseColor("#26262D"));
        gestureHudLayout.setBackground(hudBg);

        gestureHudIcon = new TextView(this);
        gestureHudIcon.setTextColor(Color.parseColor("#A7A39C"));
        gestureHudIcon.setTextSize(15);
        gestureHudIcon.setTypeface(Typeface.DEFAULT_BOLD);
        gestureHudIcon.setGravity(Gravity.CENTER);
        gestureHudLayout.addView(gestureHudIcon);

        gestureHudValue = new TextView(this);
        gestureHudValue.setTextColor(C_ACCENT);
        gestureHudValue.setTextSize(22);
        gestureHudValue.setTypeface(Typeface.DEFAULT_BOLD);
        gestureHudValue.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams valParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        valParams.setMargins(0, dp(4), 0, 0);
        gestureHudValue.setLayoutParams(valParams);
        gestureHudLayout.addView(gestureHudValue);

        gestureHudProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        gestureHudProgress.setMax(100);
        LinearLayout.LayoutParams progParams = new LinearLayout.LayoutParams(dp(130), dp(6));
        progParams.setMargins(0, dp(12), 0, 0);
        gestureHudProgress.setLayoutParams(progParams);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            gestureHudProgress.setProgressTintBlendMode(android.graphics.BlendMode.SRC_IN);
            gestureHudProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(C_ACCENT));
        }
        gestureHudLayout.addView(gestureHudProgress);

        FrameLayout.LayoutParams hudParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        hudParams.gravity = Gravity.CENTER;
        gestureHudLayout.setLayoutParams(hudParams);
        gestureHudLayout.setVisibility(View.GONE);
        root.addView(gestureHudLayout);

        // Touch gestures for brightness, volume and +/-10s seek
        GestureDetector gestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent e) {
                return true;
            }

            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                toggleControls();
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                int width = playerView.getWidth();
                if (width <= 0) width = root.getWidth();
                if (e.getX() < width / 2.0f) {
                    seekRelative(-10_000);
                } else {
                    seekRelative(10_000);
                }
                return true;
            }

            @Override
            public boolean onFling(MotionEvent e1, MotionEvent e2, float velocityX, float velocityY) {
                if (e1 == null || e2 == null || vod || channelPanel == null) return false;
                int width = playerView.getWidth();
                if (width <= 0) width = root.getWidth();
                float dx = e2.getX() - e1.getX();
                float dy = e2.getY() - e1.getY();
                // Glisser vers la droite depuis le bord gauche : liste des chaînes.
                if (dx > dp(60) && Math.abs(dx) > Math.abs(dy) * 1.5f && e1.getX() < width * 0.3f) {
                    openChannelPanel();
                    return true;
                }
                return false;
            }

            @Override
            public boolean onScroll(MotionEvent e1, MotionEvent e2, float distanceX, float distanceY) {
                if (e1 == null || e2 == null) return false;

                int height = playerView.getHeight();
                if (height <= 0) height = root.getHeight();

                if (e1.getY() < dp(64) || e1.getY() > height - dp(84)) {
                    return false;
                }

                float absX = Math.abs(e2.getX() - e1.getX());
                float absY = Math.abs(e2.getY() - e1.getY());

                if (absY > absX && absY > dp(10)) {
                    int width = playerView.getWidth();
                    if (width <= 0) width = root.getWidth();
                    float delta = distanceY / (float) height;

                    if (e1.getX() < width / 2.0f) {
                        adjustBrightness(delta);
                    } else {
                        adjustVolume(delta);
                    }
                    return true;
                }
                return false;
            }
        });

        playerView.setOnTouchListener((v, event) -> {
            boolean handled = gestureDetector.onTouchEvent(event);
            if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
                volumeAccumulator = 0.0f;
            }
            return handled;
        });

        if (vod && !tvUi) {
            // Le contrôleur Media3 décide seul de son masquage (délai, fin de ses menus) :
            // la barre du haut et l'état interne le suivent, pour que le toucher suivant
            // rouvre bien les deux (lecture, progression, Options).
            playerView.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
                isControlsVisible = visibility == View.VISIBLE;
                topBar.animate().cancel();
                topBar.setAlpha(1.0f);
                topBar.setVisibility(visibility);
                if (visibility != View.VISIBLE) hideSystemUI();
            });
        }

        nextEpisodePanel = cappedColumn(440);
        nextEpisodePanel.setBackground(panelCard());
        nextEpisodePanel.setPadding(dp(24), dp(20), dp(24), dp(24));
        FrameLayout.LayoutParams nextParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        if (tvUi) nextParams.setMargins(dp(48), 0, dp(48), dp(92));
        else nextParams.setMargins(dp(16), 0, dp(16), dp(92));
        nextEpisodePanel.setLayoutParams(nextParams);
        LinearLayout nextHead = new LinearLayout(this);
        nextHead.setOrientation(LinearLayout.HORIZONTAL);
        nextHead.setGravity(Gravity.CENTER_VERTICAL);
        TextView nextKicker = new TextView(this);
        nextKicker.setText("ÉPISODE SUIVANT");
        nextKicker.setTextColor(C_ACCENT);
        nextKicker.setTextSize(12);
        nextKicker.setTypeface(Typeface.DEFAULT_BOLD);
        nextKicker.setLetterSpacing(0.06f);
        nextKicker.setSingleLine(true);
        nextKicker.setEllipsize(android.text.TextUtils.TruncateAt.END);
        nextHead.addView(nextKicker, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        nextEpisodeCountdown = new TextView(this);
        nextEpisodeCountdown.setTextColor(C_MUTED);
        nextEpisodeCountdown.setTextSize(13);
        nextEpisodeCountdown.setSingleLine(true);
        nextEpisodeCountdown.setFontFeatureSettings("tnum");
        LinearLayout.LayoutParams countdownParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        countdownParams.setMarginStart(dp(12));
        nextHead.addView(nextEpisodeCountdown, countdownParams);
        nextEpisodePanel.addView(nextHead);
        nextEpisodeLabel = new TextView(this);
        nextEpisodeLabel.setTextColor(C_TEXT);
        nextEpisodeLabel.setTextSize(18);
        nextEpisodeLabel.setTypeface(Typeface.DEFAULT_BOLD);
        nextEpisodeLabel.setMaxLines(2);
        nextEpisodeLabel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams nextLabelParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nextLabelParams.topMargin = dp(6);
        nextEpisodePanel.addView(nextEpisodeLabel, nextLabelParams);
        FrameLayout nextTrack = new FrameLayout(this);
        nextTrack.setBackground(rounded(C_TRACK, 2));
        nextEpisodeProgress = new View(this);
        nextEpisodeProgress.setBackground(rounded(C_ACCENT, 2));
        nextEpisodeProgress.setPivotX(0);
        nextEpisodeProgress.setScaleX(0);
        nextTrack.addView(nextEpisodeProgress, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4)));
        LinearLayout.LayoutParams trackParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4));
        trackParams.topMargin = dp(12);
        nextEpisodePanel.addView(nextTrack, trackParams);
        LinearLayout nextActions = new LinearLayout(this);
        nextEpisodeWatch = panelButton("Lire maintenant", 0, true, v -> { cancelNextEpisode(); switchChannel(1); });
        Button stay = panelButton("Rester ici", 0, true, v -> cancelNextEpisode());
        LinearLayout.LayoutParams watchParams = new LinearLayout.LayoutParams(0, dp(48), 1);
        watchParams.setMarginEnd(dp(8));
        nextActions.addView(nextEpisodeWatch, watchParams);
        nextActions.addView(stay, new LinearLayout.LayoutParams(0, dp(48), 1));
        LinearLayout.LayoutParams actionsParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actionsParams.topMargin = dp(16);
        nextEpisodePanel.addView(nextActions, actionsParams);
        nextEpisodePanel.setVisibility(View.GONE);
        root.addView(nextEpisodePanel);
        if (!vod) {
            if (!tvUi) buildCenterControls(root);
            buildInfoBar(root);
        } else if (tvUi) {
            buildInfoBar(root);
        }
        if (tvUi) buildTvBand(root);
        // Liste des chaînes (direct) ou des épisodes (série).
        if (channelUrls != null && (!vod || episodeIds != null)) {
            panelIndex = new ChannelPanelIndex(channelUrls.size(), channelGroups, channelUrls);
            buildChannelPanel(root);
        }
        if (!vod && channelUrls != null) { buildNumberOverlay(root); buildZapOverlay(root); }
        buildCornerBadge(root);
        if (!tvUi) {
            optionsSheet = new OptionsSheet(this, root, new OptionsSheet.Listener() {
                @Override public void onOpened() { hideHandler.removeCallbacksAndMessages(null); }
                @Override public void onClosed() { hideSystemUI(); scheduleHideControls(); }
            });
        }
        setContentView(root);
        updateInfoBar();
        if (tvUi) showInfoOnly(); else scheduleHideControls();
    }

    // ── Barre du haut et commandes du téléphone ─────────────────────

    private void buildPhoneTopBar() {
        topBar.addView(iconButton(R.drawable.ic_player_back, "Retour", v -> finish(), 44));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(4), 0, dp(8), 0);
        tvTitle = new TextView(this);
        tvTitle.setText(streamTitle);
        tvTitle.setTextSize(15);
        tvTitle.setTextColor(C_TEXT);
        tvTitle.setTypeface(Typeface.DEFAULT_BOLD);
        tvTitle.setSingleLine(true);
        tvTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titles.addView(tvTitle);
        topSubtitle = new TextView(this);
        topSubtitle.setTextSize(12);
        topSubtitle.setTextColor(C_MUTED);
        topSubtitle.setSingleLine(true);
        topSubtitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        topSubtitle.setVisibility(View.GONE);
        titles.addView(topSubtitle);
        topBar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // Chromecast : envoie le flux vers un téléviseur/écran compatible (HTTP uniquement).
        if (castContext != null && isHttpUrl(streamUrl)) {
            MediaRouteButton castButton = new MediaRouteButton(this);
            castButton.setContentDescription("Envoyer vers un écran (Chromecast)");
            CastButtonFactory.setUpMediaRouteButton(getApplicationContext(), castButton);
            topBar.addView(castButton, new LinearLayout.LayoutParams(dp(44), dp(44)));
        }
        if (pipSupported()) {
            topBar.addView(iconButton(R.drawable.ic_player_pip, "Image dans l'image", v -> enterPip(), 44));
        }
        btnOptions = iconButton(R.drawable.ic_player_options, "Options de lecture", v -> openOptions(), 44);
        topBar.addView(btnOptions);
    }

    /** Bouton icône : fond discret à l'appui, pastille blanche au focus (clavier, télécommande). */
    private ImageButton iconButton(int icon, String description, View.OnClickListener click, int sizeDp) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(icon);
        b.setContentDescription(description);
        b.setScaleType(android.widget.ImageView.ScaleType.CENTER);
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[] { android.R.attr.state_focused }, rounded(C_TEXT, 12));
        bg.addState(new int[] { android.R.attr.state_pressed }, rounded(C_TRACK, 12));
        bg.addState(new int[] {}, rounded(Color.TRANSPARENT, 12));
        b.setBackground(bg);
        b.setImageTintList(new ColorStateList(
            new int[][] { new int[] { android.R.attr.state_focused }, new int[] {} },
            new int[] { C_BG, C_TEXT }));
        b.setOnClickListener(click);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)));
        return b;
    }

    /** Pastille texte du téléphone (« Chaînes », « ↺ France 3 », « Revenir au direct »). */
    private Button phonePill(String label, int icon, String description, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setSingleLine(true);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(0); b.setMinimumHeight(0);
        b.setPadding(dp(14), 0, dp(14), 0);
        b.setStateListAnimator(null);
        b.setContentDescription(description);
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[] { android.R.attr.state_focused }, rounded(C_TEXT, 20));
        bg.addState(new int[] { android.R.attr.state_pressed }, rounded(C_TRACK, 20));
        bg.addState(new int[] {}, rounded(PlayerOption.C_PILL, 20));
        b.setBackground(bg);
        ColorStateList fg = new ColorStateList(
            new int[][] { new int[] { android.R.attr.state_focused }, new int[] {} },
            new int[] { C_BG, C_TEXT });
        b.setTextColor(fg);
        if (icon != 0) {
            android.graphics.drawable.Drawable d = androidx.core.content.ContextCompat.getDrawable(this, icon);
            if (d != null) d.setBounds(0, 0, dp(16), dp(16));
            b.setCompoundDrawablesRelative(d, null, null, null);
            b.setCompoundDrawablePadding(dp(6));
            androidx.core.widget.TextViewCompat.setCompoundDrawableTintList(b, fg);
        }
        b.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(40));
        lp.setMargins(dp(8), 0, 0, 0);
        b.setLayoutParams(lp);
        return b;
    }

    /** Centre de l'écran (téléphone, direct) : chaîne précédente, pause, chaîne suivante. */
    private void buildCenterControls(FrameLayout root) {
        centerControls = new LinearLayout(this);
        centerControls.setOrientation(LinearLayout.HORIZONTAL);
        centerControls.setGravity(Gravity.CENTER);
        if (channelUrls != null) {
            ImageButton up = iconButton(R.drawable.ic_player_up, "Chaîne précédente", v -> switchChannel(-1), 56);
            up.setBackground(roundedState(Color.parseColor("#590B0B0D"), 28));
            centerControls.addView(up);
        }
        btnCenterPause = iconButton(R.drawable.ic_player_pause, "Pause", v -> togglePause(), 64);
        btnCenterPause.setBackground(roundedState(Color.parseColor("#590B0B0D"), 32));
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(dp(64), dp(64));
        pp.setMargins(dp(36), 0, dp(36), 0);
        centerControls.addView(btnCenterPause, pp);
        if (channelUrls != null) {
            ImageButton down = iconButton(R.drawable.ic_player_down, "Chaîne suivante", v -> switchChannel(1), 56);
            down.setBackground(roundedState(Color.parseColor("#590B0B0D"), 28));
            centerControls.addView(down);
        }
        root.addView(centerControls, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    }

    private StateListDrawable roundedState(int color, int radiusDp) {
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[] { android.R.attr.state_focused }, rounded(C_TEXT, radiusDp));
        bg.addState(new int[] { android.R.attr.state_pressed }, rounded(C_TRACK, radiusDp));
        bg.addState(new int[] {}, rounded(color, radiusDp));
        return bg;
    }

    /** Retard sur le direct, visible bandeau fermé : discret, dans le coin. */
    private void buildCornerBadge(FrameLayout root) {
        cornerBadge = new TextView(this);
        cornerBadge.setTextSize(12);
        cornerBadge.setTypeface(Typeface.DEFAULT_BOLD);
        cornerBadge.setLetterSpacing(0.06f);
        cornerBadge.setTextColor(C_TEXT);
        cornerBadge.setPadding(dp(10), dp(5), dp(10), dp(5));
        cornerBadge.setBackground(rounded(Color.parseColor("#CC0B0B0D"), 8));
        cornerBadge.setVisibility(View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
        lp.setMargins(dp(tvUi ? 48 : 16), dp(tvUi ? 32 : 16), 0, 0);
        root.addView(cornerBadge, lp);
    }

    private void openOptions() {
        if (optionsSheet == null || pipActive) return;
        optionsSheet.show(settingOptions(), phoneActions());
    }

    /** Guide inconnu (chaîne hors de la fenêtre transmise avec la liste complète). */
    private static final JSONArray UNKNOWN_EPG = new JSONArray();
    private boolean fullListAdopted = false;

    /**
     * Remplace la fenêtre de 300 chaînes par la liste complète écrite par la page
     * (zaplist.tsv : clé puis « url, titre, groupe, numéro » par ligne, séparés par des
     * tabulations). Le guide reste celui de la fenêtre, recopié à sa place. En cas de
     * doute (clé, taille, chaîne en cours), la fenêtre reste en place.
     * <p>Version bloquante, réservée à la restauration après rotation (l'index sauvegardé
     * ne désigne pas la fenêtre) ; au démarrage à froid, voir {@link #adoptFullListAsync()}.
     */
    private void adoptFullList(boolean savedIndexIsFull) {
        String path = getIntent().getStringExtra("channelList");
        String key = getIntent().getStringExtra("listKey");
        int windowStart = getIntent().getIntExtra("windowStart", -1);
        if (path == null || key == null || channelUrls == null || channelIndex < 0 || windowStart < 0) return;
        long started = SystemClock.elapsedRealtime();
        try {
            File file = new File(path);
            if (!file.getCanonicalFile().getParentFile().equals(getCacheDir().getCanonicalFile()) || !file.getName().equals(NativePlayerPlugin.ZAP_LIST_NAME)) return;
            ArrayList<String> urls = new ArrayList<>(), titles = new ArrayList<>(), groups = new ArrayList<>(), numbers = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8), 1 << 16)) {
                if (!key.equals(reader.readLine())) return;
                String line;
                while ((line = reader.readLine()) != null) {
                    int a = line.indexOf('\t');
                    int b = a < 0 ? -1 : line.indexOf('\t', a + 1);
                    int c = b < 0 ? -1 : line.indexOf('\t', b + 1);
                    if (c < 0) return;
                    urls.add(line.substring(0, a)); titles.add(line.substring(a + 1, b));
                    groups.add(line.substring(b + 1, c)); numbers.add(line.substring(c + 1));
                }
            }
            // Indices de la fenêtre → indices de la liste complète.
            int current = savedIndexIsFull ? channelIndex : windowStart + channelIndex;
            int previous = previousIndex < 0 ? -1 : (savedIndexIsFull ? previousIndex : windowStart + previousIndex);
            if (current < 0 || current >= urls.size() || windowStart + channelUrls.size() > urls.size()) return;
            ArrayList<JSONArray> programs = new ArrayList<>(urls.size());
            for (int i = 0; i < urls.size(); i++) programs.add(UNKNOWN_EPG);
            if (channelPrograms != null) for (int i = 0; i < channelPrograms.size(); i++) programs.set(windowStart + i, channelPrograms.get(i));
            // Logos du bandeau : ceux de la fenêtre restent valables ; vide ailleurs (texte seul).
            ArrayList<String> logos = new ArrayList<>(urls.size());
            for (int i = 0; i < urls.size(); i++) logos.add("");
            if (channelLogos != null) for (int i = 0; i < channelLogos.size(); i++) logos.set(windowStart + i, channelLogos.get(i));
            // La chaîne lancée peut être une variante (autre qualité) de la ligne de la liste.
            if (!savedIndexIsFull && streamUrl != null) { urls.set(current, streamUrl); if (streamTitle != null) titles.set(current, streamTitle); }
            if (savedIndexIsFull) { streamUrl = urls.get(current); streamTitle = titles.get(current); }
            channelUrls = urls; channelTitles = titles; channelGroups = groups; channelNumbers = numbers; channelPrograms = programs; channelLogos = logos;
            channelIndex = current; previousIndex = previous; channelTotal = urls.size();
            programLineCache.clear();
            fullListAdopted = true;
            android.util.Log.i("IPTV-Playback", "zap_full_list channels=" + urls.size() + " load_ms=" + (SystemClock.elapsedRealtime() - started));
        } catch (Exception ignored) { /* la fenêtre reste en place */ }
    }

    /**
     * Adoption de la liste complète hors thread UI (démarrage à froid) : la lecture ligne à
     * ligne de zaplist.tsv — le seul gros fichier — se fait dans un executor et le thread UI
     * garde la fenêtre de 300 chaînes pour lancer la première image sans attendre. À la
     * publication, les index de fenêtre (chaîne courante, précédente, cible de rafale P+/P−)
     * sont transposés vers la liste complète ; si la fenêtre a disparu entre-temps, on renonce.
     */
    private void adoptFullListAsync() {
        String path = getIntent().getStringExtra("channelList");
        String key = getIntent().getStringExtra("listKey");
        final int windowStart = getIntent().getIntExtra("windowStart", -1);
        if (path == null || key == null || channelUrls == null || channelIndex < 0 || windowStart < 0) return;
        final long started = SystemClock.elapsedRealtime();
        if (fullListExecutor == null) fullListExecutor = java.util.concurrent.Executors.newSingleThreadExecutor();
        fullListExecutor.execute(() -> {
            ArrayList<String> urls = new ArrayList<>(), titles = new ArrayList<>(), groups = new ArrayList<>(), numbers = new ArrayList<>();
            try {
                File file = new File(path);
                if (!file.getCanonicalFile().getParentFile().equals(getCacheDir().getCanonicalFile()) || !file.getName().equals(NativePlayerPlugin.ZAP_LIST_NAME)) return;
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8), 1 << 16)) {
                    if (!key.equals(reader.readLine())) return;
                    String line;
                    while ((line = reader.readLine()) != null) {
                        int a = line.indexOf('\t');
                        int b = a < 0 ? -1 : line.indexOf('\t', a + 1);
                        int c = b < 0 ? -1 : line.indexOf('\t', b + 1);
                        if (c < 0) return;
                        urls.add(line.substring(0, a)); titles.add(line.substring(a + 1, b));
                        groups.add(line.substring(b + 1, c)); numbers.add(line.substring(c + 1));
                    }
                }
            } catch (Exception ignored) {
                return; // la fenêtre reste en place
            }
            final HashMap<String, Integer> builtIndex = ChannelNumberInput.buildNumberIndex(numbers);
            final ChannelPanelIndex builtPanelIndex = new ChannelPanelIndex(urls.size(), groups, urls);
            runOnUiThread(() -> publishFullList(urls, titles, groups, numbers, builtIndex, builtPanelIndex, windowStart, started));
        });
    }

    /** Publie sur le thread UI les listes lues hors thread : mêmes gardes et mêmes
     *  transpositions que adoptFullList, mais à partir de l'état courant — un zap P+/P−
     *  peut avoir eu lieu pendant la lecture du fichier. */
    private void publishFullList(ArrayList<String> urls, ArrayList<String> titles, ArrayList<String> groups, ArrayList<String> numbers, HashMap<String, Integer> builtIndex, ChannelPanelIndex builtPanelIndex, int windowStart, long started) {
        if (isFinishing() || isDestroyed() || channelUrls == null || channelTitles == null || channelIndex < 0) return;
        if (urls.isEmpty() || windowStart + channelUrls.size() > urls.size()) return;
        // Indices de la fenêtre → indices de la liste complète, à partir de l'état courant.
        int current = windowStart + channelIndex;
        int previous = previousIndex < 0 ? -1 : windowStart + previousIndex;
        if (current >= urls.size()) return;
        boolean panelOpen = isChannelPanelOpen();
        boolean listHadFocus = panelOpen && channelListView.hasFocus();
        boolean chipHadFocus = panelOpen && groupChips != null && groupChips.hasFocus();
        View focusedChip = chipHadFocus ? getCurrentFocus() : null;
        Object focusedChipTag = focusedChip != null ? focusedChip.getTag() : null;
        int selected = panelOpen ? channelListView.getSelectedItemPosition() : -1;
        int selectedChannel = selected >= 0 && selected < channelAdapter.getCount()
            ? windowStart + channelAdapter.channelAt(selected) : current;
        ArrayList<JSONArray> programs = new ArrayList<>(urls.size());
        for (int i = 0; i < urls.size(); i++) programs.add(UNKNOWN_EPG);
        if (channelPrograms != null) for (int i = 0; i < channelPrograms.size(); i++) programs.set(windowStart + i, channelPrograms.get(i));
        // Logos du bandeau : ceux de la fenêtre restent valables ; vide ailleurs (texte seul).
        ArrayList<String> logos = new ArrayList<>(urls.size());
        for (int i = 0; i < urls.size(); i++) logos.add("");
        if (channelLogos != null) for (int i = 0; i < channelLogos.size(); i++) logos.set(windowStart + i, channelLogos.get(i));
        // La chaîne lancée peut être une variante (autre qualité) de la ligne de la liste.
        if (streamUrl != null) {
            builtPanelIndex.replaceUrl(current, urls.get(current), streamUrl);
            urls.set(current, streamUrl);
            if (streamTitle != null) titles.set(current, streamTitle);
        }
        channelUrls = urls; channelTitles = titles; channelGroups = groups; channelNumbers = numbers; channelPrograms = programs; channelLogos = logos;
        channelIndex = current; previousIndex = previous; channelTotal = urls.size();
        if (pendingZapTarget >= 0) pendingZapTarget = windowStart + pendingZapTarget;
        programLineCache.clear();
        numberIndex.clear();
        if (builtIndex != null) numberIndex.putAll(builtIndex);
        fullListAdopted = true;
        panelIndex = builtPanelIndex;
        refreshFavoriteChannels();
        if (channelAdapter != null) {
            rebuildPanelGroups();
            channelAdapter.rebuild();
            if (panelOpen) {
                channelListView.setSelection(Math.max(0, channelAdapter.positionOf(selectedChannel)));
                if (listHadFocus) channelListView.requestFocus();
                else if (chipHadFocus) {
                    for (int i = 0; i < groupChips.getChildCount(); i++) {
                        View chip = groupChips.getChildAt(i);
                        if (java.util.Objects.equals(focusedChipTag, chip.getTag())) { chip.requestFocus(); break; }
                    }
                }
            }
        }
        android.util.Log.i("IPTV-Playback", "zap_full_list channels=" + urls.size() + " load_ms=" + (SystemClock.elapsedRealtime() - started));
    }

    private void switchChannel(int delta) {
        if (channelUrls == null || channelTitles == null || channelIndex < 0) return;
        int size = channelUrls.size();
        if (vod) {
            int nextVod = channelIndex + delta;
            if (nextVod < 0 || nextVod >= size) return;
            switchTo(nextVod);
            return;
        }
        // P+/P− : le premier appui accorde immédiatement (réactivité type TiviMate) ; les
        // appuis suivants de la rafale cumulent la cible, le bandeau suit aussitôt et le
        // tune n'a lieu qu'après ZAP_SETTLE_MS sans nouvel appui — un appui maintenu ne
        // prépare le flux qu'une seconde fois au lieu de re-préparer à chaque répétition.
        if (zapStartedAtMs == 0) zapStartedAtMs = SystemClock.elapsedRealtime();
        int base = pendingZapTarget >= 0 ? pendingZapTarget : channelIndex;
        int next = (base + delta + size) % size;
        if (!zapBurst) {
            switchTo(next);
            zapBurst = true;
            zapCommitHandler.removeCallbacks(zapCommitRunnable);
            zapCommitHandler.postDelayed(zapCommitRunnable, ZAP_SETTLE_MS);
            return;
        }
        pendingZapTarget = next;
        showZapOverlay(next);
        zapCommitHandler.removeCallbacks(zapCommitRunnable);
        zapCommitHandler.postDelayed(zapCommitRunnable, ZAP_SETTLE_MS);
    }

    private void switchTo(int next) {
        cancelNextEpisode();
        // Un saut direct (numéro validé, panneau) prime sur un zap P+/P− en attente.
        cancelPendingZap();
        if (channelUrls == null || channelTitles == null || channelIndex < 0) return;
        if (next < 0 || next >= channelUrls.size() || next == channelIndex) return;
        final boolean wasArchive = archive;
        cancelLiveReconnect("zap");
        if (recording) stopRecording();
        // Sauver la progression sous l'ancienne identité avant toute modification de mediaId.
        // Le faire après mediaId écraserait la position de l'épisode suivant.
        // Lecteur encore vivant : on le conserve (pas de recréation de codecs) ; sinon on nettoie.
        if (player != null) {
            saveProgress();
            progressHandler.removeCallbacksAndMessages(null);
        } else {
            releasePlayer();
        }
        if (vod) {
            positionMs = 0;
            durationMs = 0;
            playWhenReady = true;
            if (episodeIds != null && next < episodeIds.size()) {
                mediaId = episodeIds.get(next);
                // Reprendre la position mémorisée de cet épisode précis (et non celle du précédent).
                positionMs = getSharedPreferences("vod", MODE_PRIVATE).getLong(mediaId, 0);
            }
            // Une piste externe est propre à l'épisode choisi, jamais à toute la saison.
            getIntent().removeExtra("subtitleUrl");
            String subtitleFile = getIntent().getStringExtra("subtitleFile");
            if (subtitleFile != null) new File(subtitleFile).delete();
            getIntent().removeExtra("subtitleFile");
        }
        if (!vod) {
            previousIndex = channelIndex;
            // Nouvelle chaîne : elle démarre au direct, la pause, le retard et le différé sont abandonnés.
            leaveArchive();
            pausedAtMs = 0; liveDelayMs = 0; liveLostWhilePaused = false; playWhenReady = true;
        }
        channelIndex = next;
        streamUrl = channelUrls.get(next);
        streamTitle = channelTitles.get(next);
        if (tvTitle != null) tvTitle.setText(streamTitle);
        // En direct, le bandeau affiche déjà le nom de la chaîne ; sur TV, le bandeau du film aussi.
        if (vod && !tvUi) Toast.makeText(this, streamTitle, Toast.LENGTH_SHORT).show();
        updatePreviousButton();
        if (channelAdapter != null && isChannelPanelOpen()) channelAdapter.notifyDataSetChanged();
        if (player != null) {
            zapCount++;
            prepareMedia(streamUrl);
        } else {
            initPlayer(streamUrl);
        }
        // Le zap quitte le différé : la rangée Progression n'a plus lieu d'être.
        if (wasArchive && tvUi) rebuildBandRows();
        if (!vod) showZapOverlay(next);
        // TV : bandeau de commandes ouvert, il le reste ; sinon le bandeau de zap avec logo suffit, sans doublon en bas.
        if (tvUi && isChannelPanelOpen()) {
            updateInfoBar();
            updateCornerBadge();
        } else if (tvUi && !isControlsVisible) {
            if (vod) showInfoOnly();
            else { updateInfoBar(); updateCornerBadge(); }
        } else {
            showControls();
        }
    }

    /** Tune effectif à la fin d'une rafale P+/P− (cible cumulée, ou simple fin de fenêtre). */
    private void commitPendingZap() {
        int target = pendingZapTarget;
        pendingZapTarget = -1;
        zapBurst = false;
        if (target >= 0 && target != channelIndex) switchTo(target);
    }

    /** Annule un zap P+/P− en attente : sans ça, le tune survit à Home (activité plus visible). */
    private void cancelPendingZap() {
        zapCommitHandler.removeCallbacks(zapCommitRunnable);
        pendingZapTarget = -1;
        zapBurst = false;
    }

    private void openInVlc() {
        // Pause does not close the HTTP loading connection. Release before handoff.
        releasePlayer();
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            Uri uri = Uri.parse(streamUrl);
            String type = "video/*";
            String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(java.util.Locale.ROOT);
            if (path.endsWith(".m3u8")) type = "application/x-mpegurl";
            else if (path.endsWith(".ts")) type = "video/mp2t";
            intent.setDataAndType(uri, type);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra("title", streamTitle);
            Intent chooser = Intent.createChooser(intent, "Ouvrir avec...");
            startActivity(chooser);
        } catch (Exception e) {
            Toast.makeText(this, "Impossible d’ouvrir un lecteur externe", Toast.LENGTH_SHORT).show();
            showError("Impossible d’ouvrir un lecteur externe.");
        }
    }

    /** Téléphone, films et séries : les commandes sont celles du contrôleur Media3. */
    private boolean phoneVod() { return vod && !tvUi && playerView != null; }

    private void toggleControls() {
        // Le toucher est capté par nos gestes : le contrôleur Media3 ne le voit pas. Son état
        // réel (et non un indicateur interne qui a pu vieillir) décide d'ouvrir ou de fermer.
        boolean shown = phoneVod() ? playerView.isControllerFullyVisible() : isControlsVisible;
        if (shown) {
            hideControls();
        } else {
            showControls();
        }
    }

    private void showControls() {
        if (pipActive) return;
        if (phoneVod()) {
            // L'écouteur du contrôleur affiche la barre du haut et met l'état à jour.
            playerView.showController();
            refreshControls();
            return;
        }
        boolean wasOpen = isControlsVisible && !infoOnly;
        infoOnly = false;
        isControlsVisible = true;
        if (!tvUi) {
            topBar.animate().cancel();
            topBar.setVisibility(View.VISIBLE);
            topBar.animate().alpha(1.0f).setDuration(200).start();
            if (centerControls != null) {
                centerControls.animate().cancel();
                centerControls.setVisibility(View.VISIBLE);
                centerControls.animate().alpha(1.0f).setDuration(200).start();
            }
        }
        if (infoBar != null) {
            updateInfoBar();
            infoBar.animate().cancel();
            infoBar.setVisibility(View.VISIBLE);
            infoBar.animate().alpha(1.0f).setDuration(200).start();
        }
        if (tvBand != null) {
            tvBand.view().setVisibility(View.VISIBLE);
            tvBand.refresh();
            if (!wasOpen || !tvBand.hasFocus()) focusBandOnOpen();
        }
        refreshControls();
        scheduleHideControls();
        ensureTicker();
    }

    /** TV, après un zapping : nom et programme 4 s, sans commandes ni focus ; ▲ ▼ zappent encore. */
    private void showInfoOnly() {
        if (pipActive || infoBar == null) return;
        if (tvBand != null) { tvBand.closeList(false); tvBand.view().setVisibility(View.GONE); }
        isControlsVisible = false;
        infoOnly = true;
        updateInfoBar();
        infoBar.animate().cancel();
        infoBar.setVisibility(View.VISIBLE);
        infoBar.animate().alpha(1.0f).setDuration(200).start();
        updateCornerBadge();
        scheduleHideControls();
    }

    private void hideControls() {
        if (phoneVod()) {
            playerView.hideController();
            return;
        }
        isControlsVisible = false;
        infoOnly = false;
        if (tvBand != null) tvBand.closeList(false);
        if (infoBar != null) {
            infoBar.animate().cancel();
            infoBar.animate().alpha(0.0f).setDuration(300).withEndAction(() -> infoBar.setVisibility(View.GONE)).start();
        }
        if (centerControls != null) {
            centerControls.animate().cancel();
            centerControls.animate().alpha(0.0f).setDuration(300).withEndAction(() -> centerControls.setVisibility(View.GONE)).start();
        }
        topBar.animate().cancel();
        topBar.animate().alpha(0.0f).setDuration(300).withEndAction(() -> {
            topBar.setVisibility(View.GONE);
            hideSystemUI();
        }).start();
        updateCornerBadge();
    }

    private void scheduleHideControls() {
        // Téléphone, films et séries : le contrôleur Media3 gère son propre masquage.
        if (vod && !tvUi) return;
        hideHandler.removeCallbacksAndMessages(null);
        // TV : 8 s sans touche (4 s pour le bandeau d'infos seul) ; téléphone : 5 s.
        hideHandler.postDelayed(hideControlsRunnable, tvUi ? (infoOnly ? 4000 : 8000) : 5000);
    }

    /** Masquage différé, sauf pendant qu'une liste ou le panneau Options est ouvert, ou en pause :
     *  l'image arrêtée garde ses commandes. */
    private final Runnable hideControlsRunnable = new Runnable() {
        @Override public void run() {
            boolean hold = (tvBand != null && tvBand.isListOpen())
                || (optionsSheet != null && optionsSheet.isOpen())
                || (!infoOnly && isPaused())
                || (!tvUi && topBar != null && topBar.findFocus() != null);
            if (hold) { hideHandler.postDelayed(this, 2000); return; }
            hideControls();
        }
    };

    private void sizeToolbarButton(Button button, int widthDp) {
        button.setMinimumWidth(0);
        button.setMinWidth(0);
        button.setMinimumHeight(0);
        button.setMinHeight(0);
        button.setAllCaps(false);
        button.setPadding(dp(4), 0, dp(4), 0);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), dp(48)));
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    /** Carte des petits panneaux (erreur, épisode suivant). */
    private GradientDrawable panelCard() {
        GradientDrawable d = rounded(C_CARD, 16);
        d.setStroke(dp(1), PlayerOption.C_BORDER);
        return d;
    }

    /** Colonne qui remplit son parent jusqu'à maxDp : sur grand écran le panneau garde sa
     *  largeur, sur un téléphone étroit il rétrécit au lieu de déborder. */
    private LinearLayout cappedColumn(int maxDp) {
        LinearLayout column = new LinearLayout(this) {
            @Override protected void onMeasure(int widthSpec, int heightSpec) {
                int max = dp(maxDp);
                if (MeasureSpec.getSize(widthSpec) > max) widthSpec = MeasureSpec.makeMeasureSpec(max, MeasureSpec.EXACTLY);
                super.onMeasure(widthSpec, heightSpec);
            }
        };
        column.setOrientation(LinearLayout.VERTICAL);
        return column;
    }

    /** Bouton des petits panneaux : piste au repos, pastille blanche au focus et à l'appui.
     *  Libellé sur une ligne, coupé par « … » plutôt que de sortir du bouton. */
    private Button panelButton(String label, int icon, boolean centered, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(15);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        b.setSingleLine(true);
        b.setEllipsize(android.text.TextUtils.TruncateAt.END);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(0); b.setMinimumHeight(0);
        b.setStateListAnimator(null);
        b.setPadding(dp(centered ? 16 : 20), 0, dp(centered ? 16 : 20), 0);
        b.setGravity(Gravity.CENTER_VERTICAL | (centered ? Gravity.CENTER_HORIZONTAL : Gravity.START));
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[] { android.R.attr.state_focused }, rounded(C_TEXT, 24));
        bg.addState(new int[] { android.R.attr.state_pressed }, rounded(C_TEXT, 24));
        bg.addState(new int[] {}, rounded(C_TRACK, 24));
        b.setBackground(bg);
        ColorStateList fg = new ColorStateList(
            new int[][] { new int[] { android.R.attr.state_focused }, new int[] { android.R.attr.state_pressed }, new int[] {} },
            new int[] { C_BG, C_BG, C_TEXT });
        b.setTextColor(fg);
        if (icon != 0) {
            android.graphics.drawable.Drawable d = androidx.core.content.ContextCompat.getDrawable(this, icon);
            if (d != null) {
                d = d.mutate();
                d.setBounds(0, 0, dp(20), dp(20));
                d.setTintList(fg);
                b.setCompoundDrawablesRelative(d, null, null, null);
                b.setCompoundDrawablePadding(dp(centered ? 8 : 12));
            }
        }
        b.setOnClickListener(click);
        return b;
    }

    /** Fond à états (sélection télécommande, appui) + texte inversé tant que le bouton a le
     *  focus. Des fonds statiques ne montraient jamais le bouton sélectionné : la barre
     *  s'affichait mais restait inutilisable à la télécommande. */
    private void styleFocusable(Button button, int baseColor, int focusBg, int normalText) {
        GradientDrawable focused = rounded(focusBg, 24);
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] { android.R.attr.state_focused }, focused);
        states.addState(new int[] { android.R.attr.state_pressed }, focused);
        states.addState(new int[] {}, rounded(baseColor, 24));
        button.setBackground(states);
        button.setOnFocusChangeListener((v, hasFocus) -> {
            button.setTextColor(hasFocus ? C_BG : normalText);
            // VOD : le contrôleur Media3 s'efface après 3,5 s — pas pendant la navigation.
            if (vod && !tvUi && playerView != null) playerView.setControllerShowTimeoutMs(hasFocus ? 0 : 3500);
        });
        // Réapplique l'état courant : REC restylé alors qu'il a le focus (lancement au OK)
        // capturait sinon la couleur inversée sombre comme « normale » — texte sombre sur
        // fond sombre dès que la sélection repart. Couleur normale explicite, jamais lue.
        button.setTextColor(button.isFocused() ? C_BG : normalText);
    }

    private void updatePreviousButton() {
        if (btnPrevious == null) return;
        boolean available = previousIndex >= 0 && previousIndex != channelIndex && channelTitles != null && previousIndex < channelTitles.size();
        btnPrevious.setVisibility(available ? View.VISIBLE : View.GONE);
        if (available) {
            btnPrevious.setText(channelTitles.get(previousIndex));
            btnPrevious.setContentDescription("Revenir à " + channelTitles.get(previousIndex) + ", dernière chaîne regardée");
        }
    }

    // ── Bandeau du programme (direct) ────────────────────────────────

    private void buildInfoBar(FrameLayout root) {
        infoBar = new LinearLayout(this);
        infoBar.setOrientation(LinearLayout.VERTICAL);
        // TV : marges de sécurité des téléviseurs (environ 5 % de l'image).
        if (tvUi) infoBar.setPadding(dp(48), dp(72), dp(48), dp(28));
        else infoBar.setPadding(dp(20), dp(36), dp(20), dp(14));
        infoBar.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP,
            new int[] { Color.parseColor("#F50B0B0D"), Color.parseColor("#E60B0B0D"), Color.TRANSPARENT }));

        infoChannel = new TextView(this);
        infoChannel.setTextSize(tvUi ? 15 : 12);
        infoChannel.setTextColor(tvUi ? PlayerOption.C_SOFT : C_MUTED);
        infoChannel.setSingleLine(true);
        infoChannel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        infoChannel.setLetterSpacing(0.04f);
        infoBar.addView(infoChannel);

        infoNow = new TextView(this);
        infoNow.setTextSize(tvUi ? 26 : 19);
        infoNow.setTextColor(C_TEXT);
        infoNow.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        infoNow.setSingleLine(true);
        infoNow.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams nowParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nowParams.setMargins(0, dp(4), 0, 0);
        infoBar.addView(infoNow, nowParams);

        infoTimeRow = new LinearLayout(this);
        infoTimeRow.setOrientation(LinearLayout.HORIZONTAL);
        infoTimeRow.setGravity(Gravity.CENTER_VERTICAL);
        infoProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        infoProgress.setMax(1000);
        infoProgress.setProgressTintList(ColorStateList.valueOf(C_ACCENT));
        infoProgress.setProgressBackgroundTintList(ColorStateList.valueOf(Color.parseColor("#40F3F1ED")));
        LinearLayout.LayoutParams progressParams = tvUi
            ? new LinearLayout.LayoutParams(0, dp(4), 1f)
            : new LinearLayout.LayoutParams(dp(120), dp(4));
        progressParams.setMargins(0, 0, dp(12), 0);
        infoTimeRow.addView(infoProgress, progressParams);
        infoTimes = new TextView(this);
        infoTimes.setTextSize(tvUi ? 14 : 12);
        infoTimes.setTextColor(C_MUTED);
        infoTimes.setTypeface(Typeface.MONOSPACE);
        infoTimes.setSingleLine(true);
        infoTimeRow.addView(infoTimes);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowParams.setMargins(0, dp(10), 0, 0);
        infoBar.addView(infoTimeRow, rowParams);

        infoNext = new TextView(this);
        infoNext.setTextSize(tvUi ? 14 : 13);
        infoNext.setTextColor(C_DIM);
        infoNext.setSingleLine(true);
        infoNext.setEllipsize(android.text.TextUtils.TruncateAt.END);
        if (!tvUi && !vod) {
            // Téléphone : informations et raccourcis de lecture, puis navigation accessible au pouce.
            LinearLayout bottom = new LinearLayout(this);
            bottom.setOrientation(LinearLayout.HORIZONTAL);
            bottom.setGravity(Gravity.CENTER_VERTICAL);
            bottom.addView(infoNext, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            // « Depuis le début » et « Revenir au direct » occupent la même place : au plus
            // une des deux est visible, selon qu'on est au direct ou dans l'archive.
            btnRestart = phonePill("", R.drawable.ic_player_replay, "Regarder le programme depuis le début", v -> restartLiveFromStart());
            btnRestart.setVisibility(View.GONE);
            bottom.addView(btnRestart);
            btnBackToLive = phonePill("Revenir au direct", 0, "Revenir au direct", v -> backToLive());
            btnBackToLive.setVisibility(View.GONE);
            bottom.addView(btnBackToLive);
            if (channelUrls != null) {
                btnPrevious = phonePill("", R.drawable.ic_player_replay, "Revenir à la chaîne précédente", v -> { if (previousIndex >= 0) switchTo(previousIndex); });
                bottom.addView(btnPrevious);
                updatePreviousButton();
            }
            // Enregistrement du direct : bouton visible au-dessus de la navigation, à portée
            // de pouce pendant un match. Sur HLS, le Recorder repart de 3 segments en arrière
            // (≈ 15-20 s) : appuyé juste après l'action, le fichier contient le but et son
            // ralenti. Sur MPEG-TS, la capture part du direct.
            btnRec = phonePill("Enregistrer", R.drawable.ic_player_record, "Enregistrer le direct", v -> toggleRecording());
            btnRec.setVisibility(isHttpUrl(streamUrl) ? View.VISIBLE : View.GONE);
            bottom.addView(btnRec);
            LinearLayout.LayoutParams bottomParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            bottomParams.setMargins(0, dp(8), 0, 0);
            infoBar.addView(bottom, bottomParams);
            LinearLayout navigation = new LinearLayout(this);
            navigation.setOrientation(LinearLayout.HORIZONTAL);
            Button returnToChannels = phonePill("Retour aux chaînes", R.drawable.ic_player_back,
                    "Retour à la liste des chaînes", v -> finish());
            returnToChannels.setPadding(dp(8), 0, dp(8), 0);
            LinearLayout.LayoutParams returnParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
            navigation.addView(returnToChannels, returnParams);
            if (channelUrls != null) {
                Button browseChannels = phonePill("Parcourir", R.drawable.ic_player_list,
                        "Parcourir les chaînes sans quitter le lecteur", v -> openChannelPanel());
                LinearLayout.LayoutParams browseParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
                browseParams.setMargins(dp(8), 0, 0, 0);
                navigation.addView(browseChannels, browseParams);
            }
            LinearLayout.LayoutParams navigationParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            navigationParams.setMargins(0, dp(8), 0, 0);
            infoBar.addView(navigation, navigationParams);
        } else {
            LinearLayout.LayoutParams nextParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            nextParams.setMargins(0, dp(6), 0, 0);
            infoBar.addView(infoNext, nextParams);
        }
        if (vod) { infoTimeRow.setVisibility(View.GONE); infoNext.setVisibility(View.GONE); }

        infoBar.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        root.addView(infoBar);
    }

    private JSONArray programAt(int channel, int index) {
        if (channelPrograms == null || channel < 0 || channel >= channelPrograms.size()) return null;
        return channelPrograms.get(channel).optJSONArray(index);
    }

    /** Programme en cours à `now` pour une chaîne, ou -1. */
    private int currentProgramIndex(int channel, long now) {
        if (channelPrograms == null || channel < 0 || channel >= channelPrograms.size()) return -1;
        JSONArray programs = channelPrograms.get(channel);
        for (int i = 0; i < programs.length(); i++) {
            JSONArray p = programs.optJSONArray(i);
            if (p != null && p.optLong(0) <= now && now < p.optLong(1)) return i;
        }
        return -1;
    }

    private JSONArray nextProgram(int channel, long now) {
        if (channelPrograms == null || channel < 0 || channel >= channelPrograms.size()) return null;
        JSONArray programs = channelPrograms.get(channel);
        for (int i = 0; i < programs.length(); i++) {
            JSONArray p = programs.optJSONArray(i);
            if (p != null && p.optLong(0) > now) return p;
        }
        return null;
    }

    private String hour(long ms) {
        return hourFormat.format(new Date(ms));
    }

    /** Ligne de programme courante (cache par chaîne, validité temporelle) : le panneau
     *  relit chaque ligne à chaque défilement — sans cache, chaque bind refaisait le
     *  scan EPG complet et un format d'heure. */
    private ProgramLine programLineOf(int channel, long now) {
        ProgramLine line = programLineCache.get(channel);
        if (line != null && now >= line.start && now < line.end) return line;
        line = new ProgramLine();
        int index = currentProgramIndex(channel, now);
        JSONArray prog = index >= 0 ? programAt(channel, index) : null;
        if (prog != null) {
            line.start = prog.optLong(0);
            line.end = prog.optLong(1);
            line.hasProgram = true;
            line.text = hour(line.start) + "  " + prog.optString(2, "");
        } else {
            line.start = 0;
            JSONArray next = nextProgram(channel, now);
            line.end = next != null ? next.optLong(0) : Long.MAX_VALUE;
            line.hasProgram = false;
            line.text = channelGroups != null && channel >= 0 && channel < channelGroups.size() ? channelGroups.get(channel) : "";
        }
        programLineCache.put(channel, line);
        return line;
    }

    private void updateInfoBar() {
        if (vod) { updateVodHeader(); return; }
        long now = System.currentTimeMillis();
        String number = numberAt(channelIndex);
        // En différé, le bandeau décrit l'instant d'antenne regardé, pas l'heure courante :
        // progression, « reste » et programme affiché suivent la position dans l'archive.
        long watched = now;
        if (archive) {
            watched = Math.max(archiveStartMs, Math.min(archiveWatchedAtMs(), Math.max(archiveStartMs, archiveEndMs - 1)));
        }
        int current = currentProgramIndex(channelIndex, watched);
        JSONArray p = archive ? archiveProgram() : (current >= 0 ? programAt(channelIndex, current) : null);
        if (topSubtitle != null) {
            // Téléphone : la barre du haut porte le nom de la chaîne et le programme en cours.
            if (tvTitle != null) tvTitle.setText((number.isEmpty() ? "" : number + " · ") + streamTitle);
            String program = p != null ? p.optString(2, "") + " · " + hour(p.optLong(0)) + " – " + hour(p.optLong(1)) : "";
            topSubtitle.setText(program);
            topSubtitle.setVisibility(program.isEmpty() ? View.GONE : View.VISIBLE);
        }
        if (infoBar == null) return;
        String group = channelGroups != null && channelIndex >= 0 && channelIndex < channelGroups.size() ? channelGroups.get(channelIndex) : "";
        String badge = liveBadge();
        // Le retard chiffré reste au badge du coin : l'étiquette garde « DIFFÉRÉ », court.
        String word = archive ? (isPaused() ? "EN PAUSE" : "DIFFÉRÉ") : (badge == null ? "DIRECT" : badge);
        boolean muted = archive || badge == null || pausedAtMs > 0;
        String mark = isPaused() ? "❚❚" : "●";
        String state = mark + "  " + word;
        // Étiquette : état, numéro, catégorie. Le nom de la chaîne n'y figure que si le
        // grand titre affiche le programme — sans guide il répéterait le titre.
        StringBuilder headText = new StringBuilder(state);
        String[] headParts = { number, p != null ? streamTitle : "", group };
        for (String part : headParts) {
            if (!part.isEmpty()) headText.append("  ·  ").append(part);
        }
        String head = headText.toString();
        SpannableString label = new SpannableString(head);
        label.setSpan(new ForegroundColorSpan(muted ? C_DIM : C_LIVE), 0, mark.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        label.setSpan(new ForegroundColorSpan(C_TEXT), mark.length(), state.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        label.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), mark.length(), state.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        infoChannel.setText(label);

        if (p != null) {
            long start = p.optLong(0), end = p.optLong(1);
            infoNow.setText(p.optString(2, streamTitle));
            infoProgress.setProgress((int) Math.max(0, Math.min(1000, (watched - start) * 1000 / Math.max(1, end - start))));
            long remaining = Math.max(0, (end - watched + 59_999) / 60_000);
            infoTimes.setText(hour(start) + " – " + hour(end) + "  ·  reste " + formatMinutes(remaining));
            infoTimeRow.setVisibility(View.VISIBLE);
        } else {
            infoNow.setText(streamTitle);
            infoTimeRow.setVisibility(View.GONE);
        }
        if (seekRow != null && archive) updateSeekRow();
        // En différé, la ligne du bas dit ce qui passe en direct : c'est ce que « Revenir au
        // direct » fera rejoindre.
        int liveIndex = archive ? currentProgramIndex(channelIndex, now) : -1;
        JSONArray live = liveIndex >= 0 ? programAt(channelIndex, liveIndex) : null;
        JSONArray next = nextProgram(channelIndex, now);
        if (archive) {
            // Pas d'horaire ici : celui du programme en cours est déjà sur la ligne du
            // dessus, et « en direct » désigne bien souvent le même titre (on est dedans).
            infoNext.setText(live != null ? "En direct  ·  " + live.optString(2, "") : "En direct");
            infoNext.setVisibility(View.VISIBLE);
        } else if (next != null) {
            infoNext.setText("Ensuite  " + hour(next.optLong(0)) + "  ·  " + next.optString(2, ""));
            infoNext.setVisibility(View.VISIBLE);
        } else if (p == null && channelPrograms != null && channelIndex >= 0 && channelIndex < channelPrograms.size() && channelPrograms.get(channelIndex) != UNKNOWN_EPG) {
            infoNext.setText("Pas de guide pour cette chaîne");
            infoNext.setVisibility(View.VISIBLE);
        } else {
            infoNext.setVisibility(tvUi ? View.GONE : View.INVISIBLE);
        }
        if (btnBackToLive != null) btnBackToLive.setVisibility(isBehindLive() ? View.VISIBLE : View.GONE);
        if (btnRestart != null) btnRestart.setVisibility(canRestartArchive() ? View.VISIBLE : View.GONE);
        if (btnRec != null) btnRec.setVisibility(!archive && isHttpUrl(streamUrl) ? View.VISIBLE : View.GONE);
    }

    /** Barre de progression du bandeau TV : position dans le programme différé. */
    private void updateSeekRow() {
        long start = archiveStartMs, end = archiveEndMs;
        long position = Math.max(0, Math.min(archiveWatchedAtMs(), end) - start);
        long duration = Math.max(1, end - start);
        seekBar.setProgress((int) Math.min(1000, position * 1000 / duration));
        seekElapsed.setText(formatMs(position));
        seekRemaining.setText("−" + formatMs(Math.max(0, duration - position)));
    }

    /** TV, films et séries : titre, épisode, heure de fin, barre de progression. */
    private void updateVodHeader() {
        if (tvTitle != null) tvTitle.setText(streamTitle);
        if (infoBar == null) return;
        infoNow.setText(streamTitle);
        long position = player != null ? Math.max(0, player.getCurrentPosition()) : positionMs;
        long duration = player != null && player.getDuration() != C.TIME_UNSET ? player.getDuration() : durationMs;
        StringBuilder head = new StringBuilder();
        if (episodeIds != null && channelUrls != null && channelIndex >= 0) {
            head.append("Épisode ").append(channelIndex + 1).append(" sur ").append(channelUrls.size());
        }
        if (duration > 0) {
            long endsAt = System.currentTimeMillis() + (long) ((duration - position) / Math.max(0.25f, playbackSpeed));
            if (head.length() > 0) head.append("  ·  ");
            head.append("Fin à ").append(hour(endsAt));
        }
        infoChannel.setText(head);
        infoChannel.setVisibility(head.length() == 0 ? View.GONE : View.VISIBLE);
        if (seekBar != null) {
            seekBar.setProgress(duration > 0 ? (int) Math.min(1000, position * 1000 / duration) : 0);
            seekElapsed.setText(formatMs(position));
            seekRemaining.setText(duration > 0 ? "−" + formatMs(Math.max(0, duration - position)) : "");
        }
    }

    private static String formatMinutes(long minutes) {
        if (minutes < 60) return minutes + " min";
        return (minutes / 60) + " h " + String.format(Locale.FRANCE, "%02d", minutes % 60);
    }

    // ── Panneau des chaînes ──────────────────────────────────────────

    private void buildChannelPanel(FrameLayout root) {
        channelPanel = new FrameLayout(this);
        channelPanel.setBackgroundColor(Color.parseColor("#80000000"));
        channelPanel.setVisibility(View.GONE);
        channelPanel.setOnClickListener(v -> closeChannelPanel());

        channelSheet = new LinearLayout(this);
        channelSheet.setOrientation(LinearLayout.VERTICAL);
        channelSheet.setBackgroundColor(Color.parseColor("#F70B0B0D"));
        channelSheet.setClickable(true);
        channelSheet.setPadding(0, dp(16), 0, 0);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), 0, dp(12), dp(8));
        TextView title = new TextView(this);
        title.setText(vod ? "Épisodes" : "Chaînes");
        title.setTextSize(22);
        title.setTextColor(C_TEXT);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button close = new Button(this);
        close.setText("✕");
        close.setTextSize(15);
        close.setTextColor(C_MUTED);
        close.setContentDescription(vod ? "Fermer la liste des épisodes" : "Fermer la liste des chaînes");
        close.setOnClickListener(v -> closeChannelPanel());
        sizeToolbarButton(close, 44);
        close.setTextColor(C_MUTED);
        styleFocusable(close, C_CARD, C_TEXT, C_MUTED);
        header.addView(close, new LinearLayout.LayoutParams(dp(44), dp(44)));
        channelSheet.addView(header);

        groupChipsScroll = new HorizontalScrollView(this);
        groupChipsScroll.setHorizontalScrollBarEnabled(false);
        groupChips = new LinearLayout(this);
        groupChips.setOrientation(LinearLayout.HORIZONTAL);
        groupChips.setPadding(dp(16), dp(4), dp(16), dp(10));
        groupChipsScroll.addView(groupChips);
        channelSheet.addView(groupChipsScroll);
        rebuildPanelGroups();

        channelListView = new ListView(this);
        channelListView.setDivider(null);
        channelListView.setSelector(new android.graphics.drawable.ColorDrawable(C_TRACK));
        channelListView.setVerticalScrollBarEnabled(false);
        // Lignes sans image : le cache de défilement (bitmaps mémoire) ne sert à rien.
        channelListView.setScrollingCacheEnabled(false);
        channelAdapter = new ChannelPanelAdapter();
        channelListView.setAdapter(channelAdapter);
        channelListView.setOnItemClickListener((parent, view, position, id) -> {
            int target = channelAdapter.channelAt(position);
            if (!tvUi) closeChannelPanel();
            if (target != channelIndex) switchTo(target);
        });
        channelSheet.addView(channelListView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        int width = Math.min(dp(380), (int) (getResources().getDisplayMetrics().widthPixels * 0.86f));
        channelPanel.addView(channelSheet, new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.START));
        root.addView(channelPanel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void rebuildPanelGroups() {
        if (groupChips == null || panelIndex == null) return;
        List<String> groups = panelIndex.groups();
        if (panelGroup != null && !groups.contains(panelGroup)) panelGroup = null;
        groupChips.removeAllViews();
        groupChips.addView(groupChip("Toutes", null));
        if (!vod) groupChips.addView(groupChip("Favoris", null, true));
        for (String group : groups) groupChips.addView(groupChip(group, group));
        groupChipsScroll.setVisibility(!vod || groups.size() > 1 ? View.VISIBLE : View.GONE);
    }

    private Button groupChip(String label, String group) { return groupChip(label, group, false); }

    private Button groupChip(String label, String group, boolean favorites) {
        Button chip = new Button(this);
        chip.setText(label);
        chip.setAllCaps(false);
        chip.setTextSize(13);
        chip.setSingleLine(true);
        chip.setMinWidth(0); chip.setMinimumWidth(0); chip.setMinHeight(0); chip.setMinimumHeight(0);
        chip.setPadding(dp(14), 0, dp(14), 0);
        chip.setTag(favorites ? Boolean.TRUE : group == null ? "" : group);
        chip.setOnClickListener(v -> {
            panelFavorites = favorites;
            panelGroup = group;
            refreshGroupChips();
            channelAdapter.rebuild();
            channelListView.setSelection(Math.max(0, channelAdapter.positionOf(channelIndex)));
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36));
        params.setMargins(0, 0, dp(8), 0);
        chip.setLayoutParams(params);
        styleChip(chip, isPanelChipActive(chip));
        return chip;
    }

    private boolean isPanelChipActive(Button chip) {
        Object tag = chip.getTag();
        if (Boolean.TRUE.equals(tag)) return panelFavorites;
        return !panelFavorites && (panelGroup == null ? "".equals(tag) : panelGroup.equals(tag));
    }

    private void refreshFavoriteChannels() {
        favoriteChannels = panelIndex == null || vod ? new int[0] : panelIndex.favorites(favoriteStore.favoriteUrls());
    }

    /** Catégorie active : contour et texte orange (elle signale) ; focus : pastille blanche. */
    private void styleChip(Button chip, boolean active) {
        GradientDrawable bg = rounded(active ? C_ELEV : Color.TRANSPARENT, 18);
        bg.setStroke(dp(1), active ? C_ACCENT : Color.parseColor("#26F3F1ED"));
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] { android.R.attr.state_focused }, rounded(C_TEXT, 18));
        states.addState(new int[] { android.R.attr.state_pressed }, rounded(C_TEXT, 18));
        states.addState(new int[] {}, bg);
        chip.setBackground(states);
        final int normalText = active ? C_ACCENT : PlayerOption.C_SOFT;
        // Chip restylé pendant qu'il a le focus (sélection au OK → refreshGroupChips) :
        // garder l'inversion sombre tant que la pastille blanche de sélection est affichée.
        chip.setTextColor(chip.isFocused() ? C_BG : normalText);
        chip.setOnFocusChangeListener((v, hasFocus) -> chip.setTextColor(hasFocus ? C_BG : normalText));
    }

    /** TV, liste ouverte : ◀ va aux catégories, sur celle en cours. */
    private void focusActiveChip() {
        if (groupChips == null) return;
        for (int i = 0; i < groupChips.getChildCount(); i++) {
            Button chip = (Button) groupChips.getChildAt(i);
            if (isPanelChipActive(chip)) { chip.requestFocus(); return; }
        }
    }

    private void refreshGroupChips() {
        if (groupChips == null) return;
        for (int i = 0; i < groupChips.getChildCount(); i++) {
            Button chip = (Button) groupChips.getChildAt(i);
            styleChip(chip, isPanelChipActive(chip));
        }
    }

    private boolean isChannelPanelOpen() {
        return channelPanel != null && channelPanel.getVisibility() == View.VISIBLE;
    }

    private void openChannelPanel() {
        if (channelPanel == null || pipActive || isChannelPanelOpen()) return;
        hideHandler.removeCallbacksAndMessages(null);
        hideControls();
        // Ouvrir sur le groupe de la chaîne en cours.
        String group = channelGroups != null && channelIndex >= 0 && channelIndex < channelGroups.size() ? channelGroups.get(channelIndex) : "";
        panelFavorites = false;
        panelGroup = groupChips != null && !group.isEmpty() ? group : null;
        refreshFavoriteChannels();
        refreshGroupChips();
        channelAdapter.rebuild();
        channelSheet.animate().cancel();
        channelPanel.setVisibility(View.VISIBLE);
        channelSheet.setTranslationX(-channelSheet.getLayoutParams().width);
        channelSheet.animate().translationX(0).setDuration(180).start();
        int position = channelAdapter.positionOf(channelIndex);
        channelListView.setSelection(Math.max(0, position));
        channelListView.requestFocus();
        startPanelFrameSampling();
    }

    private void closeChannelPanel() {
        if (!isChannelPanelOpen()) return;
        stopPanelFrameSampling();
        channelSheet.animate().cancel();
        channelPanel.setVisibility(View.GONE);
        channelSheet.setTranslationX(-channelSheet.getWidth());
        hideSystemUI();
    }

    // ── Mesure de fluidité du panneau (protocole box : appui prolongé Haut/Bas) ──
    // Delta de chaque frame tant que le panneau est ouvert ; le bilan est loggué à la
    // fermeture. Uniquement des compteurs : aucune URL ni donnée du compte.
    private void startPanelFrameSampling() {
        // Un second postFrameCallback par-dessus un sampler déjà actif doublerait chaque
        // frame (comptes et relances) : retirer d'abord, toujours.
        Choreographer.getInstance().removeFrameCallback(panelFrameCallback);
        panelFrameCount = 0; panelJank32 = 0; panelJank50 = 0; panelWorstFrameMs = 0; panelLastFrameNanos = 0;
        Choreographer.getInstance().postFrameCallback(panelFrameCallback);
    }

    private void stopPanelFrameSampling() {
        Choreographer.getInstance().removeFrameCallback(panelFrameCallback);
        if (panelFrameCount > 0) {
            android.util.Log.i("IPTV-Playback", "panel_scroll frames=" + panelFrameCount + " jank32=" + panelJank32
                + " jank50=" + panelJank50 + " worst_ms=" + panelWorstFrameMs);
            // Compteurs consommés : sans remise à zéro, un second arrêt (onPause/onDestroy
            // après une fermeture normale du panneau) reloggerait un bilan périmé.
            panelFrameCount = 0; panelJank32 = 0; panelJank50 = 0; panelWorstFrameMs = 0;
        }
        panelLastFrameNanos = 0;
    }

    private final Choreographer.FrameCallback panelFrameCallback = new Choreographer.FrameCallback() {
        @Override public void doFrame(long frameTimeNanos) {
            if (panelLastFrameNanos != 0) {
                long ms = (frameTimeNanos - panelLastFrameNanos) / 1_000_000L;
                panelFrameCount++;
                if (ms > 32) { panelJank32++; if (ms > 50) panelJank50++; }
                if (ms > panelWorstFrameMs) panelWorstFrameMs = ms;
            }
            panelLastFrameNanos = frameTimeNanos;
            Choreographer.getInstance().postFrameCallback(this);
        }
    };

    private class ChannelPanelAdapter extends BaseAdapter {
        private int[] visible = new int[0];

        ChannelPanelAdapter() { rebuild(); }

        void rebuild() {
            visible = panelFavorites ? favoriteChannels : panelIndex == null ? new int[0] : panelIndex.channels(panelGroup);
            notifyDataSetChanged();
        }

        int channelAt(int position) { return visible[position]; }
        int positionOf(int channel) { return java.util.Arrays.binarySearch(visible, channel); }

        @Override public int getCount() { return visible.length; }
        @Override public Object getItem(int position) { return visible[position]; }
        @Override public long getItemId(int position) { return visible[position]; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            LinearLayout row;
            View edge;
            TextView name, program;
            if (convertView instanceof LinearLayout) {
                row = (LinearLayout) convertView;
                edge = row.getChildAt(0);
                LinearLayout texts = (LinearLayout) row.getChildAt(1);
                name = (TextView) texts.getChildAt(0);
                program = (TextView) texts.getChildAt(1);
            } else {
                row = new LinearLayout(NativePlayerActivity.this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setMinimumHeight(dp(58));
                edge = new View(NativePlayerActivity.this);
                edge.setBackgroundColor(C_ACCENT);
                row.addView(edge, new LinearLayout.LayoutParams(dp(3), ViewGroup.LayoutParams.MATCH_PARENT));
                LinearLayout texts = new LinearLayout(NativePlayerActivity.this);
                texts.setOrientation(LinearLayout.VERTICAL);
                texts.setGravity(Gravity.CENTER_VERTICAL);
                texts.setPadding(dp(17), dp(10), dp(20), dp(10));
                name = new TextView(NativePlayerActivity.this);
                name.setTextSize(15);
                name.setSingleLine(true);
                name.setEllipsize(android.text.TextUtils.TruncateAt.END);
                texts.addView(name);
                program = new TextView(NativePlayerActivity.this);
                program.setTextSize(13);
                program.setTextColor(C_DIM);
                program.setSingleLine(true);
                program.setEllipsize(android.text.TextUtils.TruncateAt.END);
                LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                pp.setMargins(0, dp(2), 0, 0);
                texts.addView(program, pp);
                row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
            }
            int channel = visible[position];
            boolean current = channel == channelIndex;
            name.setText(channelTitles.get(channel));
            name.setTextColor(current ? C_ACCENT : C_TEXT);
            // setTypeface relance la mise en page du texte : ne l'écrire que s'il change.
            if ((name.getTypeface() == Typeface.DEFAULT_BOLD) != current) name.setTypeface(current ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            edge.setVisibility(current ? View.VISIBLE : View.INVISIBLE);
            row.setBackgroundColor(current ? C_ELEV : Color.TRANSPARENT);
            ProgramLine line = programLineOf(channel, System.currentTimeMillis());
            program.setText(line.text);
            program.setVisibility(!line.hasProgram && line.text.isEmpty() ? View.GONE : View.VISIBLE);
            return row;
        }
    }

    // ── Image dans l'image ──────────────────────────────────────────

    private boolean pipSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private boolean isInPipMode() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode();
    }

    private void enterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !pipSupported() || casting || player == null) return;
        try {
            Rational ratio = new Rational(16, 9);
            VideoSize size = player.getVideoSize();
            if (size.width > 0 && size.height > 0) {
                float r = (float) size.width / size.height;
                if (r > 0.42f && r < 2.39f) ratio = new Rational(size.width, size.height);
            }
            enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(ratio).build());
        } catch (Exception e) {
            Toast.makeText(this, "Petite fenêtre indisponible sur cet appareil", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Bouton Accueil pendant la lecture : la vidéo continue en petite fenêtre.
        if (player != null && player.isPlaying() && !casting && getIntent().getBooleanExtra("autoPip", true)) enterPip();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        pipActive = isInPictureInPictureMode;
        if (playerView != null) {
            playerView.setUseController(vod && !tvUi && !isInPictureInPictureMode);
            if (isInPictureInPictureMode) playerView.hideController();
        }
        if (isInPictureInPictureMode) {
            hideHandler.removeCallbacksAndMessages(null);
            if (channelPanel != null) channelPanel.setVisibility(View.GONE);
            if (optionsSheet != null) optionsSheet.close();
            if (tvBand != null) tvBand.closeList(false);
            if (centerControls != null) centerControls.setVisibility(View.GONE);
            if (cornerBadge != null) cornerBadge.setVisibility(View.GONE);
            topBar.setVisibility(View.GONE);
            if (infoBar != null) infoBar.setVisibility(View.GONE);
            if (gestureHudLayout != null) gestureHudLayout.setVisibility(View.GONE);
            isControlsVisible = false;
        } else {
            hideSystemUI();
        }
    }

    // ── Télécommande et clavier ─────────────────────────────────────

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (!vod && channelUrls != null) {
            int digit = digitOf(keyCode);
            if (digit >= 0) { typeDigit(digit); return true; }
            if (numberBuffer.length() > 0 && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                    || keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER)) {
                commitNumber(); return true;
            }
            switch (keyCode) {
                case KeyEvent.KEYCODE_CHANNEL_UP:
                case KeyEvent.KEYCODE_PAGE_UP:
                    switchChannel(1); return true;
                case KeyEvent.KEYCODE_CHANNEL_DOWN:
                case KeyEvent.KEYCODE_PAGE_DOWN:
                    switchChannel(-1); return true;
                case KeyEvent.KEYCODE_LAST_CHANNEL:
                    if (previousIndex >= 0) switchTo(previousIndex);
                    return true;
                case KeyEvent.KEYCODE_GUIDE:
                case KeyEvent.KEYCODE_MENU:
                    if (isChannelPanelOpen()) closeChannelPanel(); else openChannelPanel();
                    return true;
                default:
                    break;
            }
            // Contrôles masqués : haut/bas zappent, OK affiche le bandeau, gauche ouvre la liste.
            // Sauf panneau d'erreur affiché : ses flèches doivent déplacer le focus entre ses
            // boutons empilés (constaté sur Hisense : ▼ depuis « Réessayer » zappait).
            if (!isControlsVisible && !isChannelPanelOpen() && !isErrorPanelShown()) {
                switch (keyCode) {
                    case KeyEvent.KEYCODE_DPAD_UP: switchChannel(-1); return true;
                    case KeyEvent.KEYCODE_DPAD_DOWN: switchChannel(1); return true;
                    case KeyEvent.KEYCODE_DPAD_LEFT: openChannelPanel(); return true;
                    case KeyEvent.KEYCODE_DPAD_CENTER:
                    case KeyEvent.KEYCODE_ENTER:
                    case KeyEvent.KEYCODE_DPAD_RIGHT:
                        showControls(); return true;
                    default: break;
                }
            }
        }
        if (isControlsVisible) scheduleHideControls();
        return super.onKeyDown(keyCode, event);
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    private void initPlayer(String url) {
        if (player != null || playerView == null) return;
        final long initializedAtMs = SystemClock.elapsedRealtime();
        hideError();
        loadingBar.setVisibility(View.VISIBLE);
        autoRetriesLeft = AUTO_RETRY_MAX;
        firstFrameLogged = false;
        zapStartedAtMs = 0;
        // Le lecteur ne sert qu'un type de contenu (direct ou VOD) : le réglage de
        // démarrage est choisi une fois pour toutes à la création.
        // Mémoire tampon choisie dans les réglages (Normale = valeurs historiques).
        DefaultLoadControl loadControl = PlayerOptions.loadControl(this, vod);

        DefaultHttpDataSource.Factory httpDataSourceFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent(PlayerOptions.userAgent(this))
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true);

        // Le DataSource par défaut délègue le HTTP au DataSource HTTP ci-dessus et
        // sait aussi lire content:// (clé USB/SD via SAF) et file:// (sous-titres).
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpDataSourceFactory);
        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(dataSourceFactory);

        player = new ExoPlayer.Builder(this, PlayerOptions.renderers(this))
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build();

        playerView.setPlayer(vod && !tvUi ? viewPlayer(player) : player);
        if (vod) player.setPlaybackParameters(new PlaybackParameters(playbackSpeed));
        TrackSelectionParameters.Builder trackParamsBuilder = player.getTrackSelectionParameters().buildUpon()
            .setPreferredAudioLanguage("fra");
        if (vod) {
            trackParamsBuilder
                .setPreferredTextLanguage("fra")
                .setPreferredTextRoleFlags(C.ROLE_FLAG_SUBTITLE)
                .setSelectUndeterminedTextLanguage(true);
        }
        player.setTrackSelectionParameters(trackParamsBuilder.build());

        player.addListener(new Player.Listener() {
            @Override
            public void onRenderedFirstFrame() {
                if (firstFrameLogged) return;
                firstFrameLogged = true;
                long now = SystemClock.elapsedRealtime();
                if (zapStartedAtMs > 0) {
                    android.util.Log.i("IPTV-Playback", "zap_first_frame zap_ms=" + (now - zapStartedAtMs));
                    zapStartedAtMs = 0;
                } else {
                    android.util.Log.i("IPTV-Playback", "first_frame elapsed_ms=" + now + " prepare_ms=" + (now - initializedAtMs));
                }
            }


            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState != Player.STATE_ENDED) cancelNextEpisode();
                if (playbackState == Player.STATE_BUFFERING) {
                    loadingBar.setVisibility(View.VISIBLE);
                } else if (playbackState == Player.STATE_READY) {
                    loadingBar.setVisibility(View.GONE);
                    // La lecture fonctionne : le quota de reprises automatiques repart à zéro.
                    autoRetriesLeft = AUTO_RETRY_MAX;
                    hideError();
                } else if (playbackState == Player.STATE_ENDED) {
                    loadingBar.setVisibility(View.GONE);
                    if (vod) saveProgress();
                    if (sleepOnEnd) {
                        Toast.makeText(NativePlayerActivity.this, "Fin de la vidéo : mise en veille", Toast.LENGTH_SHORT).show();
                        cancelSleepTimer();
                        finish();
                        return;
                    }
                    if (vod && episodeIds != null && channelUrls != null && channelIndex + 1 < channelUrls.size()) {
                        startNextEpisodeCountdown();
                    }
                    // Le programme rattrapé est fini : on rejoint le direct de la même chaîne,
                    // au lieu de laisser une image figée sur la dernière seconde de l'archive.
                    if (archive) {
                        backToLive();
                    } else if (!vod && !casting && playerView != null) {
                        // Un direct ne finit pas : le serveur a coupé (souvent après une longue pause).
                        if (pausedAtMs > 0) liveLostWhilePaused = true;
                        else if (canRecoverLive()) queueLiveReconnect("Le flux s'est arrêté.");
                    }
                }
                updateMediaSessionState();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) playMeter.start();
                else recordPlayTime(playMeter.stop());
                if (isPlaying && !vod && liveReconnect.isRecovering()) {
                    android.util.Log.i("IPTV-Playback", "live_reconnect_success elapsed_ms="
                        + (SystemClock.elapsedRealtime() - reconnectStartedAtMs));
                    liveReconnect.onPlaying();
                }
                updateMediaSessionState();
                refreshControls();
            }

            @Override public void onPlayWhenReadyChanged(boolean ready, int reason) {
                if (vod || player == null || ready != player.getPlayWhenReady()) return;
                playWhenReady = ready;
                // Différé : une pause est une pause de lecture, sans retard de direct à suivre.
                if (archive) return;
                if (!ready) {
                    if (pausedAtMs == 0) pausedAtMs = SystemClock.elapsedRealtime();
                    if (liveReconnect.isRecovering()) liveLostWhilePaused = true;
                    cancelLiveReconnect("paused");
                } else if (pausedAtMs > 0) {
                    liveDelayMs += SystemClock.elapsedRealtime() - pausedAtMs;
                    pausedAtMs = 0;
                }
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                // Pistes connues : Qualité apparaît, Audio et Sous-titres affichent la bonne valeur.
                refreshControls();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                progressHandler.removeCallbacks(autoRetryRunnable);
                errorCount++;
                lastErrorCode = String.valueOf(error.errorCode);
                loadingBar.setVisibility(View.GONE);
                // Direct en pause ou en retard : le flux n'a pas gardé la pause. Reprise au direct,
                // tout de suite si l'on regardait, au prochain « Lecture » si l'image est arrêtée.
                if (!vod && pausedAtMs > 0) { cancelLiveReconnect("paused"); liveLostWhilePaused = true; refreshControls(); return; }
                String cause = describeError(error);
                if (!vod && isTransientError(error) && canRecoverLive()) {
                    queueLiveReconnect(cause);
                    return;
                }
                if (!vod) cancelLiveReconnect("permanent_error");
                // Coupure réseau ou serveur surchargé : quelques reprises espacées avant d'abandonner.
                if (vod && autoRetriesLeft > 0 && isTransientError(error)) {
                    autoRetriesLeft--;
                    Toast.makeText(NativePlayerActivity.this,
                        "Nouvelle tentative (" + (AUTO_RETRY_MAX - autoRetriesLeft) + "/" + AUTO_RETRY_MAX + ")…", Toast.LENGTH_SHORT).show();
                    loadingBar.setVisibility(View.VISIBLE);
                    progressHandler.postDelayed(autoRetryRunnable, autoRetriesLeft == AUTO_RETRY_MAX - 1 ? 1_500 : 3_500);
                    return;
                }
                releasePlayer();
                showError(cause);
                // L'exception brute peut contenir l'URL du flux et ses identifiants : on ne l'affiche jamais.
                Toast.makeText(NativePlayerActivity.this, cause, Toast.LENGTH_LONG).show();
            }
        });

        // Bilan de lecture : interruptions et images perdues (les erreurs sont comptées dans le Listener).
        player.addAnalyticsListener(new AnalyticsListener() {
            @Override public void onPlaybackStateChanged(EventTime eventTime, int analyticsState) {
                if (!firstFrameLogged) return; // le chargement initial n'est pas une interruption
                if (analyticsState == Player.STATE_BUFFERING) {
                    rebuffer.open();
                } else {
                    rebuffer.close(); // reprise : la coupure est comptée pour sa durée complète
                }
            }
            @Override public void onDroppedVideoFrames(EventTime eventTime, int count, long elapsedCpuTimeMs) {
                droppedFrames += count;
            }
            // AFR : chaque nouvelle vidéo (zapping compris) peut changer de cadence.
            @Override public void onVideoInputFormatChanged(EventTime eventTime, Format format, androidx.media3.exoplayer.DecoderReuseEvaluation evaluation) {
                if (!afrEnabled) return;
                int mode = PlayerOptions.chooseDisplayMode(getWindowManager().getDefaultDisplay(), format.frameRate);
                if (mode != 0) PlayerOptions.applyDisplayMode(NativePlayerActivity.this, mode);
            }
        });

        loadMedia(url);
        if (mediaSession != null) { mediaSession.setActive(true); updateMediaSessionState(); }
        if (vod) { progressHandler.removeCallbacksAndMessages(null); progressHandler.postDelayed(checkpoint, 5000); }
    }

    /** Change de média sur le lecteur existant : pas de recréation de codecs, zapping plus court. */
    private void prepareMedia(String url) {
        if (player == null || playerView == null) { initPlayer(url); return; }
        // Une interruption ouverte appartient au média quitté : la clôturer ici, sinon son
        // chronomètre déborderait sur le chargement puis la lecture de la chaîne suivante.
        rebuffer.close();
        if (zapStartedAtMs == 0) zapStartedAtMs = SystemClock.elapsedRealtime();
        firstFrameLogged = false;
        hideError();
        loadingBar.setVisibility(View.VISIBLE);
        loadMedia(url);
        if (vod) { progressHandler.removeCallbacksAndMessages(null); progressHandler.postDelayed(checkpoint, 5000); }
    }

    /** Numéro du dernier média demandé : une résolution de portail arrivée trop tard est ignorée. */
    private int mediaRequest = 0;

    /**
     * Charge le média. Une chaîne de portail Stalker demande d'abord son lien de lecture
     * au portail (hors du fil principal) ; un zapping entre-temps rend ce lien caduc.
     */
    private void loadMedia(String url) {
        final int request = ++mediaRequest;
        if (!Stalker.is(url)) { applyMedia(url); return; }
        Stalker.resolveAsync(this, url, resolved -> {
            if (request != mediaRequest || player == null || isFinishing()) return;
            if (resolved == null) {
                if (liveReconnect.isRecovering() && canRecoverLive()) {
                    queueLiveReconnect("Le portail n’a pas donné de lien de lecture pour cette chaîne.");
                    return;
                }
                loadingBar.setVisibility(View.GONE);
                showError("Le portail n’a pas donné de lien de lecture pour cette chaîne.");
                return;
            }
            applyMedia(resolved);
        });
    }

    private void applyMedia(String url) {
        player.setMediaItem(buildMediaItem(url));
        if (vod && positionMs > 0) player.seekTo(positionMs);
        player.prepare();
        player.setPlayWhenReady(playWhenReady);
    }

    /** Média complet : flux + sous-titres externes propres à l'épisode VOD. */
    private MediaItem buildMediaItem(String url) {
        MediaItem.Builder builder = new MediaItem.Builder().setUri(Uri.parse(url));
        if (vod) {
            String subFile = getIntent().getStringExtra("subtitleFile");
            String subUrl = getIntent().getStringExtra("subtitleUrl");
            Uri subUri = null;
            if (subFile != null && !subFile.isEmpty()) {
                subUri = Uri.fromFile(new File(subFile));
            } else if (subUrl != null && !subUrl.isEmpty()) {
                subUri = Uri.parse(subUrl);
            }
            if (subUri != null) {
                String subPath = subUri.toString().toLowerCase(Locale.ROOT);
                String mime = subPath.endsWith(".vtt") ? MimeTypes.TEXT_VTT : MimeTypes.APPLICATION_SUBRIP;
                MediaItem.SubtitleConfiguration subConfig = new MediaItem.SubtitleConfiguration.Builder(subUri)
                    .setMimeType(mime)
                    .setLanguage("fr")
                    .setLabel("Français")
                    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                    .build();
                builder.setSubtitleConfigurations(Collections.singletonList(subConfig));
            }
        }
        return builder.build();
    }

    /** Causes identifiables d'un échec, exprimées pour l'utilisateur (jamais le message brut de l'exception). */
    private String describeError(PlaybackException error) {
        int code = error.errorCode;
        if (code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT) return "Délai dépassé : le serveur ne répond pas.";
        if (code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED) return "Réseau inaccessible : vérifie la connexion de la box.";
        int status = httpStatusOf(error);
        if (status == 401 || status == 403) return "Accès refusé (HTTP " + status + ") : vérifie l'abonnement ou le nombre d'appareils connectés.";
        if (status == 404 || status == 410) return "Flux introuvable (HTTP " + status + ").";
        if (status >= 500 && status < 600) return "Serveur indisponible (HTTP " + status + ").";
        if (status > 0) return "Flux indisponible (HTTP " + status + ").";
        if (code == PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND) return "Flux introuvable sur le serveur.";
        if (code == PlaybackException.ERROR_CODE_IO_NO_PERMISSION) return "Accès refusé à ce flux.";
        if (code == PlaybackException.ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED) return "Flux non chiffré refusé par Android.";
        if (code >= 3000 && code < 4000) return "Réponse du serveur illisible : ce flux ne semble pas être une vidéo.";
        if (code >= 4000 && code < 5000) return "Format incompatible avec cette box.";
        return "Lecture impossible (code " + code + ").";
    }

    /** Coupures passagères qui valent une reprise automatique : réseau, dépassement de temps, serveur 5xx. */
    private boolean isTransientError(PlaybackException error) {
        int status = httpStatusOf(error);
        if (status != 0) return LiveReconnectController.isRetryableHttpStatus(status);
        int code = error.errorCode;
        if (code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
            || code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW
            || code == PlaybackException.ERROR_CODE_TIMEOUT) return true;
        return false;
    }

    /** Code HTTP de la cause d'échec (0 si inconnu) : distingue abonnement, flux mort et serveur. */
    private static int httpStatusOf(Throwable error) {
        Throwable t = error;
        while (t != null) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) {
                return ((HttpDataSource.InvalidResponseCodeException) t).responseCode;
            }
            t = t.getCause() == t ? null : t.getCause();
        }
        return 0;
    }

    private void showError(String message) {
        if (errorPanel == null) return;
        errorText.setText(message);
        btnNextChannel.setVisibility(!vod && channelUrls != null && channelUrls.size() > 1 ? View.VISIBLE : View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
        if (tvUi) { hideControls(); retryButton.requestFocus(); }
        else showControls();
    }

    private void hideError() {
        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
    }

    private boolean isErrorPanelShown() {
        return errorPanel != null && errorPanel.getVisibility() == View.VISIBLE;
    }

    /** Bilan de session joint au résultat de l'activité (aucune URL ni identifiant).
     *  Lecture seule : appelé aussi à chaque sauvegarde de progression VOD (toutes les cinq
     *  secondes), il ne doit pas clôturer une coupure en cours — sinon chaque export la
     *  fragmenterait et, le temps restant perdu, une coupure longue serait sous-estimée.
     *  La clôture a lieu à la reprise, au changement de média, à la libération du lecteur
     *  et à la fin de session (finish). */
    private void attachStats(Intent result) {
        try {
            JSONObject stats = new JSONObject();
            stats.put("durationMs", Math.max(0, SystemClock.elapsedRealtime() - sessionStartedAtMs));
            stats.put("zaps", zapCount);
            stats.put("rebuffers", rebuffer.count());
            stats.put("rebufferMs", rebuffer.totalMs());
            stats.put("droppedFrames", droppedFrames);
            stats.put("errors", errorCount);
            if (lastErrorCode != null) stats.put("lastErrorCode", lastErrorCode);
            result.putExtra("stats", stats.toString());
        } catch (Exception ignored) {}
    }

    private void recordPlayTime(long playedMs) {
        UsageJournalStore.record(getApplicationContext(), vod ? UsageJournal.VOD : UsageJournal.LIVE, playedMs);
    }

    private void logSessionSummary() {
        // Garde finale : une coupure encore ouverte à la destruction doit figurer au résumé.
        rebuffer.close();
        android.util.Log.i("IPTV-Playback", "session_summary duration_ms=" + Math.max(0, SystemClock.elapsedRealtime() - sessionStartedAtMs)
            + " zaps=" + zapCount + " rebuffers=" + rebuffer.count() + " rebuffer_ms=" + rebuffer.totalMs()
            + " dropped_frames=" + droppedFrames + " errors=" + errorCount
            + (lastErrorCode != null ? " last_error=" + lastErrorCode : ""));
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    private boolean canRecoverLive() {
        return !vod && !archive && !casting && streamUrl != null && playWhenReady && pausedAtMs == 0
            && player != null && player.getPlayWhenReady()
            && (resumed || isInPipMode()) && !isFinishing() && !isDestroyed();
    }

    private void queueLiveReconnect(String cause) {
        if (!canRecoverLive()) { cancelLiveReconnect("inactive"); return; }
        boolean firstFailure = !liveReconnect.isRecovering();
        if (firstFailure) reconnectStartedAtMs = SystemClock.elapsedRealtime();
        reconnectFailureMessage = cause;
        if (!liveReconnect.onFailure()) return;
        loadingBar.setVisibility(View.VISIBLE);
        android.util.Log.i("IPTV-Playback", "live_reconnect_wait elapsed_ms="
            + (SystemClock.elapsedRealtime() - reconnectStartedAtMs) + " window_ms=180000");
        if (firstFailure) Toast.makeText(this, "Connexion interrompue · reprise automatique…", Toast.LENGTH_SHORT).show();
    }

    private void cancelLiveReconnect(String reason) {
        if (liveReconnect.isRecovering()) android.util.Log.i("IPTV-Playback", "live_reconnect_cancel reason=" + reason);
        liveReconnect.cancel();
    }

    @SuppressWarnings("deprecation")
    private boolean activeNetworkConnected() {
        if (connectivityManager == null) return true;
        NetworkInfo info = connectivityManager.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private void postConnectivityChanged(ConnectivityManager.NetworkCallback source) {
        reconnectHandler.post(() -> {
            if (connectivityCallback != source) return;
            boolean connected = activeNetworkConnected();
            if (connected == networkConnected) return;
            networkConnected = connected;
            android.util.Log.i("IPTV-Playback", "live_reconnect_network connected=" + connected);
            liveReconnect.onNetworkChanged(connected);
        });
    }

    private void startConnectivityMonitoring() {
        if (vod || connectivityCallback != null) return;
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;
        try {
            networkConnected = activeNetworkConnected();
            liveReconnect.onNetworkChanged(networkConnected);
            connectivityCallback = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) { postConnectivityChanged(this); }
                @Override public void onLost(Network network) { postConnectivityChanged(this); }
                @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) { postConnectivityChanged(this); }
            };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivityManager.registerDefaultNetworkCallback(connectivityCallback);
            } else {
                // API 22/23 : observer les interfaces, puis relire la connexion active pour ignorer
                // l'arrivée d'une interface secondaire lorsque le direct est déjà connecté.
                connectivityManager.registerNetworkCallback(new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), connectivityCallback);
            }
        } catch (RuntimeException unavailable) {
            connectivityCallback = null;
            android.util.Log.w("IPTV-Playback", "live_reconnect_network_monitor unavailable=" + unavailable.getClass().getSimpleName());
        }
    }

    private void stopConnectivityMonitoring() {
        ConnectivityManager.NetworkCallback callback = connectivityCallback;
        connectivityCallback = null;
        if (callback != null && connectivityManager != null) {
            try { connectivityManager.unregisterNetworkCallback(callback); } catch (RuntimeException ignored) {}
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        hideSystemUI();
        startConnectivityMonitoring();
        if (casting) return; // la lecture continue sur le Chromecast
        if (streamUrl != null && playerView != null && player == null) initPlayer(streamUrl);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // L'échantillonneur se relance à chaque frame : le laisser vivre après une sortie
        // panneau ouvert retiendrait l'activité en mémoire et travaillerait en arrière-plan.
        stopPanelFrameSampling();
        cancelNumberEntry();
        cancelPendingZap();
        hideZapOverlay();
        resumed = false;
        recordPlayTime(playMeter.flush());
        // En petite fenêtre, l'activity est en pause mais la vidéo doit continuer.
        if (isInPipMode()) return;
        stopConnectivityMonitoring();
        cancelLiveReconnect("background");
        cancelNextEpisode();
        // Pendant un cast, le lecteur local est déjà arrêté et le téléviseur prend le relais.
        if (casting) return;
        // Foreground-only live playback: close network and codec resources immédiatement.
        releasePlayer();
    }

    @Override
    protected void onStop() {
        super.onStop();
        stopConnectivityMonitoring();
        // Fenêtre PiP fermée par l'utilisateur : on quitte le lecteur.
        if (pipActive) { pipActive = false; releasePlayer(); finish(); return; }
        releasePlayer();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopConnectivityMonitoring();
        cancelLiveReconnect("destroy");
        reconnectHandler.removeCallbacksAndMessages(null);
        numberHandler.removeCallbacksAndMessages(null);
        zapHandler.removeCallbacksAndMessages(null);
        cancelPendingZap();
        if (logoExecutor != null) logoExecutor.shutdownNow();
        if (fullListExecutor != null) fullListExecutor.shutdownNow();
        logSessionSummary();
        cancelNextEpisode();
        if (isFinishing()) {
            String path = getIntent().getStringExtra("channelFile");
            if (path != null) new File(path).delete();
            String subPath = getIntent().getStringExtra("subtitleFile");
            if (subPath != null) new File(subPath).delete();
        }
        stopPanelFrameSampling(); // ceinture et bretelles : onPause devrait déjà l'avoir arrêté
        hideHandler.removeCallbacksAndMessages(null);
        tickHandler.removeCallbacksAndMessages(null);
        progressHandler.removeCallbacksAndMessages(null);
        cancelSleepTimer();
        gestureHudHandler.removeCallbacksAndMessages(null);
        if (recorder != null) { recorder.stop(); recorder = null; }
        releasePlayer();
        if (mediaSession != null) { mediaSession.setActive(false); mediaSession.release(); mediaSession = null; }
        if (castContext != null) {
            if (castSessionListener != null) {
                try { castContext.getSessionManager().removeSessionManagerListener(castSessionListener, Session.class); } catch (Exception ignored) {}
            }
            if (casting) {
                try { castContext.getSessionManager().endCurrentSession(false); } catch (Exception ignored) {}
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        saveProgress();
        state.putInt("channelIndex", channelIndex);
        state.putBoolean("fullList", fullListAdopted);
        state.putInt("previousIndex", previousIndex);
        state.putLong("positionMs", positionMs);
        state.putBoolean("playWhenReady", playWhenReady);
        state.putString("mediaId", mediaId);
        state.putFloat("playbackSpeed", playbackSpeed);
        state.putInt("orientationMode", orientationMode);
        state.putString("lastUsedKey", lastUsedKey);
        state.putString("visitedProgress", new JSONArray(visitedProgress.values()).toString());
        super.onSaveInstanceState(state);
    }

    @Override public void finish() {
        cancelLiveReconnect("finish");
        // Fin de session : une coupure encore en cours doit figurer au bilan (résultat et
        // résumé logcat), les exports intermédiaires ne l'ayant volontairement pas arrêtée.
        rebuffer.close();
        saveProgress();
        if (!vod && streamUrl != null) {
            Intent result = new Intent(); result.putExtra("channelUrl", streamUrl);
            if (jumpNumber != null) result.putExtra("jumpNumber", jumpNumber);
            attachStats(result); setResult(RESULT_OK, result);
        }
        super.finish();
    }

    private void saveProgress() {
        if (!vod) return;
        if (player != null) {
            long duration = player.getDuration();
            if (duration != C.TIME_UNSET) durationMs = Math.max(0, duration);
            positionMs = Math.max(0, player.getCurrentPosition());
            playWhenReady = player.getPlayWhenReady();
        }
        if (mediaId != null) {
            boolean completed = durationMs > 0 && durationMs - positionMs < 30000;
            getSharedPreferences("vod", MODE_PRIVATE).edit().putLong(mediaId, completed || positionMs < 10000 ? 0 : positionMs).apply();
        }
        Intent result = new Intent();
        boolean completed = (player != null && player.getPlaybackState() == Player.STATE_ENDED)
            || (durationMs > 0 && durationMs - positionMs < 30000);
        result.putExtra("completed", completed);
        result.putExtra("mediaId", mediaId);
        if (mediaId != null) {
            try {
                JSONObject progress = new JSONObject();
                progress.put("mediaId", mediaId); progress.put("positionMs", positionMs);
                progress.put("durationMs", durationMs); progress.put("completed", completed);
                visitedProgress.put(mediaId, progress);
                result.putExtra("progress", new JSONArray(visitedProgress.values()).toString());
            } catch (Exception ignored) {}
        }
        result.putExtra("positionMs", positionMs); result.putExtra("durationMs", durationMs);
        attachStats(result);
        setResult(RESULT_OK, result);
    }

    private void createMediaSession() {
        mediaSession = new MediaSession(this, "CedPlay");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { setPaused(false); }
            @Override public void onPause() { setPaused(true); }
            @Override public void onSeekTo(long pos) { if (player != null) player.seekTo(pos); }
        });
        MediaMetadata metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, streamTitle == null ? getString(R.string.app_name) : streamTitle)
            .build();
        mediaSession.setMetadata(metadata);
    }

    private void updateMediaSessionState() {
        if (mediaSession == null) return;
        boolean playing = player != null && player.isPlaying();
        long position = player != null ? Math.max(0, player.getCurrentPosition()) : 0;
        PlaybackState.Builder builder = new PlaybackState.Builder();
        if (playing) builder.setState(PlaybackState.STATE_PLAYING, position, 1.0f);
        else builder.setState(PlaybackState.STATE_PAUSED, position, 1.0f);
        builder.setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_SEEK_TO);
        mediaSession.setPlaybackState(builder.build());
    }

    private void initCast() {
        try {
            castContext = CastContext.getSharedInstance(this);
        } catch (Exception e) {
            // Google Play Services absent ou cast indisponible : pas de bouton cast.
            castContext = null;
            return;
        }
        castSessionListener = new SessionManagerListener<Session>() {
            @Override public void onSessionStarted(Session session, String sessionId) {
                cancelLiveReconnect("cast");
                casting = true;
                if (recording) stopRecording();
                releasePlayer();
                loadRemoteMedia(session);
                hideControls();
                Toast.makeText(NativePlayerActivity.this, "Lecture envoyée vers l'écran", Toast.LENGTH_SHORT).show();
            }
            @Override public void onSessionEnded(Session session, int error) {
                casting = false;
                if (isFinishing()) return;
                // Ne relance la lecture locale que si l'app est réellement visible :
                // sinon (app en arrière-plan), onResume s'en chargera au retour.
                if (resumed) {
                    if (player == null && streamUrl != null) initPlayer(streamUrl);
                    showControls();
                }
            }
            @Override public void onSessionStarting(Session session) {}
            @Override public void onSessionStartFailed(Session session, int error) {}
            @Override public void onSessionEnding(Session session) {}
            @Override public void onSessionResuming(Session session, String sessionId) {}
            @Override public void onSessionResumed(Session session, boolean wasSuspended) {}
            @Override public void onSessionResumeFailed(Session session, int error) {}
            @Override public void onSessionSuspended(Session session, int reason) {}
        };
        castContext.getSessionManager().addSessionManagerListener(castSessionListener, Session.class);
    }

    private void loadRemoteMedia(Session session) {
        if (!(session instanceof CastSession)) return;
        RemoteMediaClient client = ((CastSession) session).getRemoteMediaClient();
        if (client == null) return;
        com.google.android.gms.cast.MediaMetadata metadata =
            new com.google.android.gms.cast.MediaMetadata(com.google.android.gms.cast.MediaMetadata.MEDIA_TYPE_MOVIE);
        metadata.putString(com.google.android.gms.cast.MediaMetadata.KEY_TITLE, streamTitle == null ? getString(R.string.app_name) : streamTitle);
        MediaInfo mediaInfo = new MediaInfo.Builder(streamUrl)
            .setStreamType(vod ? MediaInfo.STREAM_TYPE_BUFFERED : MediaInfo.STREAM_TYPE_LIVE)
            .setContentType(castContentType(streamUrl))
            .setMetadata(metadata)
            .build();
        client.load(mediaInfo);
    }

    private String castContentType(String url) {
        String lower = url == null ? "" : url.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains(".m3u8")) return "application/x-mpegurl";
        if (lower.endsWith(".ts")) return "video/mp2t";
        if (lower.endsWith(".webm")) return "video/webm";
        return "video/mp4";
    }

    private boolean isHttpUrl(String url) {
        if (url == null) return false;
        String scheme = Uri.parse(url).getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    private void initRecorder() {
        recordFolderUri = getSharedPreferences("recorder", MODE_PRIVATE).getString("folder", null);
        recordFolderLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (result.getResultCode() != RESULT_OK) {
                    Toast.makeText(this, "Aucun dossier choisi", Toast.LENGTH_SHORT).show();
                    return;
                }
                Intent data = result.getData();
                Uri tree = data != null ? data.getData() : null;
                if (tree == null) {
                    Toast.makeText(this, "Aucun dossier choisi", Toast.LENGTH_SHORT).show();
                    return;
                }
                try {
                    getContentResolver().takePersistableUriPermission(tree,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {}
                recordFolderUri = tree.toString();
                getSharedPreferences("recorder", MODE_PRIVATE).edit().putString("folder", recordFolderUri).apply();
                startRecording();
            });
    }

    private void toggleRecording() {
        if (recording) {
            stopRecording();
            return;
        }
        if (recordFolderUri == null) {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            try { recordFolderLauncher.launch(intent); }
            catch (Exception e) { Toast.makeText(this, "Sélecteur de dossier indisponible", Toast.LENGTH_SHORT).show(); }
            return;
        }
        startRecording();
    }

    private void startRecording() {
        // Garde double : le booléen `recording` (retour asynchrone) ET l'instance
        // `recorder` (démarrage immédiat) — évite un double enregistrement au re-tap.
        if (recording || recorder != null || recordFolderUri == null || streamUrl == null) return;
        if (!isHttpUrl(streamUrl)) { Toast.makeText(this, "Enregistrement réservé aux flux HTTP", Toast.LENGTH_SHORT).show(); return; }
        DocumentFile dir = DocumentFile.fromTreeUri(this, Uri.parse(recordFolderUri));
        if (dir == null || !dir.canWrite()) {
            Toast.makeText(this, "Dossier d'enregistrement inaccessible en écriture", Toast.LENGTH_SHORT).show();
            recordFolderUri = null;
            return;
        }
        // Android 13+ : sans cette autorisation, aucune notification d'enregistrement.
        ensureNotificationPermission();
        final Recorder started = new Recorder(this);
        recorder = started;
        started.start(streamUrl, streamTitle, dir, new Recorder.Listener() {
            @Override public void onRecordStarted(String fileName) {
                if (recorder != started) return; // instance obsolète (arrêt puis redémarrage)
                recording = true;
                updateRecButton();
                Toast.makeText(NativePlayerActivity.this, "Enregistrement démarré : " + fileName, Toast.LENGTH_SHORT).show();
            }
            @Override public void onRecordStopped(String fileName, long bytes, boolean success) {
                if (recorder != started) return;
                recording = false;
                recorder = null;
                updateRecButton();
                Toast.makeText(NativePlayerActivity.this,
                    success ? "Enregistrement terminé : " + fileName : "Enregistrement annulé", Toast.LENGTH_SHORT).show();
            }
            @Override public void onRecordInterrupted(String fileName, long bytes) {
                if (recorder != started) return;
                recording = false;
                recorder = null;
                updateRecButton();
                Toast.makeText(NativePlayerActivity.this,
                    "Enregistrement interrompu (réseau ou stockage) : " + fileName, Toast.LENGTH_LONG).show();
            }
            @Override public void onRecordError(String message) {
                if (recorder != started) return;
                recording = false;
                recorder = null;
                updateRecButton();
                Toast.makeText(NativePlayerActivity.this, "Enregistrement impossible : " + message, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
    }

    private void stopRecording() {
        if (recorder != null) recorder.stop();
    }

    private void updateRecButton() {
        if (btnRec == null) return;
        // Pas d'enregistrement en différé : la pastille capte le direct, pas le programme relu.
        boolean available = !vod && !archive && isHttpUrl(streamUrl);
        btnRec.setVisibility(available ? View.VISIBLE : View.GONE);
        if (!available) return;
        // Pastille orange pendant la capture (comme le badge DIRECT), fond sombre au repos.
        btnRec.setText(recording ? "Arrêter" : "Enregistrer");
        btnRec.setContentDescription(recording ? "Arrêter l'enregistrement" : "Enregistrer le direct");
        styleFocusable(btnRec, recording ? C_LIVE : PlayerOption.C_PILL, C_TEXT, C_TEXT);
        refreshControls();
    }


    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideSystemUI();
        if (optionsSheet != null) optionsSheet.relayout();
        if (playerView != null) {
            // En mode portrait, forcer RESIZE_MODE_FIT pour que l'image ne soit jamais coupée
            if (newConfig.orientation == Configuration.ORIENTATION_PORTRAIT) {
                if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) {
                    currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
                    playerView.setResizeMode(currentResizeMode);
                }
            }
            playerView.requestLayout();
        }
    }


    private void startNextEpisodeCountdown() {
        cancelNextEpisode();
        if (!resumed || nextEpisodePanel == null) return;
        nextEpisodePlayer = player;
        nextEpisodeDeadline = SystemClock.elapsedRealtime() + NEXT_EPISODE_DELAY_MS;
        nextEpisodeProgress.setScaleX(0);
        nextEpisodePanel.setVisibility(View.VISIBLE);
        if (tvUi) {
            hideControls();
            nextEpisodeWatch.requestFocus();
        }
        nextEpisodeHandler.post(nextEpisodeTicker);
    }

    private void cancelNextEpisode() {
        nextEpisodeHandler.removeCallbacksAndMessages(null);
        nextEpisodePlayer = null;
        if (nextEpisodePanel != null) nextEpisodePanel.setVisibility(View.GONE);
    }

    // ── Saisie du numéro de chaîne ─────────────────────────────────

    private static int digitOf(int keyCode) {
        if (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9) return keyCode - KeyEvent.KEYCODE_0;
        if (keyCode >= KeyEvent.KEYCODE_NUMPAD_0 && keyCode <= KeyEvent.KEYCODE_NUMPAD_9) return keyCode - KeyEvent.KEYCODE_NUMPAD_0;
        return -1;
    }

    /** « 007 » et « 7 » désignent la même chaîne. */
    static String normalizeNumber(String value) {
        return ChannelNumberInput.normalizeNumber(value);
    }

    private String numberAt(int index) {
        if (channelNumbers == null || index < 0 || index >= channelNumbers.size()) return "";
        return channelNumbers.get(index).trim();
    }

    /** (Re)construit l'index numéro normalisé → premier index de chaîne. Changer de liste
     *  (fenêtre ↔ complète) est le seul moment où la table doit être refaite. */
    private void rebuildNumberIndex() {
        numberIndex.clear();
        if (channelNumbers == null) return;
        numberIndex.putAll(ChannelNumberInput.buildNumberIndex(channelNumbers));
    }

    private int indexOfNumber(String typed) {
        if (typed.isEmpty()) return -1;
        Integer hit = numberIndex.get(typed);
        return hit == null ? -1 : hit;
    }

    private void buildNumberOverlay(FrameLayout root) {
        numberOverlay = new TextView(this);
        numberOverlay.setTextColor(C_TEXT);
        numberOverlay.setTextSize(30);
        numberOverlay.setTypeface(Typeface.DEFAULT_BOLD);
        numberOverlay.setMaxLines(2);
        numberOverlay.setPadding(dp(22), dp(12), dp(22), dp(12));
        numberOverlay.setBackground(rounded(Color.argb(230, 20, 20, 23), 16));
        numberOverlay.setVisibility(View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END);
        lp.setMargins(dp(24), dp(24), dp(24), dp(24));
        root.addView(numberOverlay, lp);
    }

    private void typeDigit(int digit) {
        if (numberOverlay == null) return;
        // TV : taper un numéro ferme le bandeau.
        if (tvUi && isControlsVisible) hideControls();
        numberBuffer.append(digit);
        String typed = normalizeNumber(numberBuffer.toString());
        int match = indexOfNumber(typed);
        String name = match >= 0 && channelTitles != null ? channelTitles.get(match) : "";
        int split = numberBuffer.length();
        SpannableString text = new SpannableString(numberBuffer + (name.isEmpty() ? "" : "\n" + name));
        if (!name.isEmpty()) {
            text.setSpan(new ForegroundColorSpan(C_MUTED), split, text.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
            text.setSpan(new android.text.style.RelativeSizeSpan(0.5f), split, text.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        numberOverlay.setText(text);
        numberOverlay.setVisibility(View.VISIBLE);
        numberOverlay.bringToFront();
        numberHandler.removeCallbacksAndMessages(null);
        numberHandler.postDelayed(this::commitNumber, 1800);
    }

    private void commitNumber() {
        numberHandler.removeCallbacksAndMessages(null);
        String typed = normalizeNumber(numberBuffer.toString());
        numberBuffer.clear();
        if (typed.isEmpty() || channelUrls == null) { hideNumberOverlay(); return; }
        int found = indexOfNumber(typed);
        if (found >= 0) {
            hideNumberOverlay();
            if (found != channelIndex) switchTo(found);
            return;
        }
        if (channelTotal > channelUrls.size()) {
            // Chaîne hors du contexte chargé : la page la retrouve dans la liste complète et relance.
            jumpNumber = typed;
            finish();
            return;
        }
        if (numberOverlay != null) {
            numberOverlay.setText("Aucune chaîne n° " + typed);
            numberHandler.postDelayed(this::hideNumberOverlay, 1500);
        }
    }

    private void hideNumberOverlay() {
        if (numberOverlay != null) numberOverlay.setVisibility(View.GONE);
    }

    /** Bandeau de zap (haut-gauche ; sur téléphone, sous la barre de commandes) : logo, numéro · nom,
     *  programme en cours. Jamais focalisable : la télécommande reste à la page. */
    private void buildZapOverlay(FrameLayout root) {
        zapOverlay = new LinearLayout(this);
        zapOverlay.setOrientation(LinearLayout.HORIZONTAL);
        zapOverlay.setGravity(Gravity.CENTER_VERTICAL);
        zapOverlay.setPadding(dp(12), dp(8), dp(16), dp(8));
        zapOverlay.setBackground(rounded(Color.argb(235, 20, 20, 23), 12));
        zapLogo = new ImageView(this);
        zapLogo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        zapLogo.setVisibility(View.GONE);
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(dp(44), dp(44));
        logoLp.setMarginEnd(dp(12));
        zapOverlay.addView(zapLogo, logoLp);
        LinearLayout textCol = new LinearLayout(this);
        textCol.setOrientation(LinearLayout.VERTICAL);
        zapHeadline = new TextView(this);
        zapHeadline.setTextColor(C_TEXT);
        zapHeadline.setTextSize(17);
        zapHeadline.setTypeface(Typeface.DEFAULT_BOLD);
        zapHeadline.setMaxLines(1);
        zapHeadline.setMaxWidth(dp(340));
        zapProgram = new TextView(this);
        zapProgram.setTextColor(C_MUTED);
        zapProgram.setTextSize(13);
        zapProgram.setMaxLines(1);
        zapProgram.setMaxWidth(dp(340));
        textCol.addView(zapHeadline);
        textCol.addView(zapProgram);
        zapOverlay.addView(textCol, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        zapOverlay.setVisibility(View.GONE);
        // Téléphone : sous la barre de commandes, pour ne pas la chevaucher. TV : pas de barre
        // en haut, le bandeau monte dans le coin, à la marge de sécurité de l'écran (comme le
        // badge de retard).
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
        if (tvUi) lp.setMargins(dp(48), dp(32), dp(48), dp(24));
        else lp.setMargins(dp(24), dp(72), dp(24), dp(24));
        root.addView(zapOverlay, lp);
    }

    /** Affiche le bandeau sur la chaîne visée et programme son masquage. */
    private void showZapOverlay(int target) {
        if (zapOverlay == null || channelTitles == null || target < 0 || target >= channelTitles.size()) return;
        zapWantedTarget.set(target); // les téléchargements de logos périmés sortent de la file
        String number = numberAt(target);
        String name = channelTitles.get(target);
        String head = number.isEmpty() ? name : number + "  " + name;
        SpannableString text = new SpannableString(head);
        if (!number.isEmpty()) {
            text.setSpan(new ForegroundColorSpan(C_ACCENT), 0, number.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
            text.setSpan(new ForegroundColorSpan(C_TEXT), number.length(), head.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        zapHeadline.setText(text);
        ProgramLine line = programLineOf(target, System.currentTimeMillis());
        zapProgram.setText(line.hasProgram ? line.text
            : (channelGroups != null && target >= 0 && target < channelGroups.size() ? channelGroups.get(target) : ""));
        loadZapLogo(target);
        zapOverlay.setVisibility(View.VISIBLE);
        zapOverlay.bringToFront();
        zapHandler.removeCallbacks(hideZapRunnable);
        zapHandler.postDelayed(hideZapRunnable, ZAP_OVERLAY_MS);
    }

    private void hideZapOverlay() {
        zapHandler.removeCallbacks(hideZapRunnable);
        if (zapOverlay != null) zapOverlay.setVisibility(View.GONE);
    }

    /** Logo de la chaîne dans le bandeau : cache mémoire, deux fils d'exécution, échec ou URL
     *  vide → logo masqué (texte seul). Aucune URL dans les logs. */
    private void loadZapLogo(int target) {
        String url = channelLogos != null && target >= 0 && target < channelLogos.size() ? channelLogos.get(target) : "";
        zapLogo.setTag(url);
        if (url.isEmpty()) { zapLogo.setImageDrawable(null); zapLogo.setVisibility(View.GONE); return; }
        android.graphics.Bitmap cached = logoCache.get(url);
        if (cached != null) { zapLogo.setImageBitmap(cached); zapLogo.setVisibility(View.VISIBLE); return; }
        zapLogo.setImageDrawable(null);
        zapLogo.setVisibility(View.GONE);
        // Deux fils : un téléchargement déjà commencé ne retarde plus le suivant — les
        // demandes périmées sortent de toute façon de la file avant même de se connecter.
        if (logoExecutor == null) logoExecutor = java.util.concurrent.Executors.newFixedThreadPool(2);
        final ImageView view = zapLogo;
        logoExecutor.execute(() -> {
            // Une cible plus récente a été visée : on sort sans télécharger, la file passe
            // aussitôt à la demande à jour au lieu de tarder sur du périmé.
            if (target != zapWantedTarget.get()) return;
            android.graphics.Bitmap bitmap = null;
            try {
                java.net.HttpURLConnection connection = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                try (java.io.InputStream in = connection.getInputStream()) {
                    android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
                    options.inSampleSize = 2; // Les logos sont petits à l'écran : la moitié suffit.
                    bitmap = android.graphics.BitmapFactory.decodeStream(in, null, options);
                } finally {
                    connection.disconnect();
                }
            } catch (Exception ignored) { /* pas de logo : le bandeau reste textuel */ }
            final android.graphics.Bitmap result = bitmap;
            runOnUiThread(() -> {
                // Une autre chaîne a pu être visée pendant le chargement.
                if (!url.equals(view.getTag())) return;
                if (result != null) {
                    logoCache.put(url, result);
                    view.setImageBitmap(result);
                    view.setVisibility(View.VISIBLE);
                } else {
                    view.setImageDrawable(null);
                    view.setVisibility(View.GONE);
                }
            });
        });
    }

    /** Abandonne la saisie en cours : sans ça, le délai de validation survit à Home et
     *  change de chaîne (ou recrée le lecteur) alors que l'activité n'est plus visible. */
    private void cancelNumberEntry() {
        numberBuffer.clear();
        numberHandler.removeCallbacksAndMessages(null);
        hideNumberOverlay();
    }

    @Override
    public void onBackPressed() {
        if (numberBuffer.length() > 0) { cancelNumberEntry(); return; }
        if (nextEpisodePanel != null && nextEpisodePanel.getVisibility() == View.VISIBLE) { cancelNextEpisode(); return; }
        // Retour remonte d'un cran : liste des vitesses, puis panneau, puis lecteur.
        if (optionsSheet != null && optionsSheet.isOpen()) { optionsSheet.back(); return; }
        if (tvBand != null && tvBand.isListOpen()) { tvBand.closeList(true); scheduleHideControls(); return; }
        if (isChannelPanelOpen()) { closeChannelPanel(); return; }
        if (tvUi) {
            if (isControlsVisible) { hideControls(); return; }
            super.onBackPressed();
            return;
        }
        // Retour ferme d'abord les commandes (direct) ou le contrôleur (VOD) avant de quitter.
        if (isControlsVisible || (vod && playerView != null && playerView.isControllerFullyVisible())) {
            if (vod && playerView != null && playerView.isControllerFullyVisible()) playerView.hideController();
            hideControls();
            return;
        }
        super.onBackPressed();
    }

    private void releasePlayer() {
        cancelLiveReconnect("release");
        // Le média quitte la mémoire : le différé aussi. Revenir dans le lecteur repart au
        // direct plutôt que de rejouer une archive à sa première image.
        if (archive) { leaveArchive(); if (tvBand != null) rebuildBandRows(); }
        // Lecteur libéré (arrière-plan, erreur, destruction) : une interruption ouverte ne peut
        // plus se terminer normalement ; la clôturer pour ne pas gonfler une session ultérieure.
        rebuffer.close();
        recordPlayTime(playMeter.stop());
        cancelNextEpisode();
        progressHandler.removeCallbacksAndMessages(null);
        if (player != null) {
            saveProgress();
            playerView.setPlayer(null);
            player.release();
            player = null;
        }
        if (mediaSession != null) mediaSession.setActive(false);
    }

    private String formatAudioTrackLabel(Format format, int trackNumber) {
        StringBuilder sb = new StringBuilder();

        String langName = getLanguageDisplayName(format.language);
        if (langName != null && !langName.isEmpty()) {
            sb.append(langName);
        } else if (format.label != null && !format.label.trim().isEmpty()) {
            sb.append(format.label.trim());
        } else {
            sb.append("Piste ").append(trackNumber);
        }

        if (format.label != null && !format.label.trim().isEmpty() && !format.label.equalsIgnoreCase(langName)) {
            sb.append(" (").append(format.label.trim()).append(")");
        }

        if (format.channelCount > 0) {
            if (format.channelCount == 6) sb.append(" [5.1]");
            else if (format.channelCount == 8) sb.append(" [7.1]");
            else if (format.channelCount == 2) sb.append(" [Stéréo]");
            else if (format.channelCount == 1) sb.append(" [Mono]");
        }

        return sb.toString();
    }

    private String getLanguageDisplayName(String langCode) {
        if (langCode == null || langCode.isEmpty() || "und".equalsIgnoreCase(langCode)) {
            return null;
        }
        try {
            Locale locale = new Locale(langCode);
            String name = locale.getDisplayLanguage(Locale.FRENCH);
            if (name != null && !name.isEmpty()) {
                return Character.toUpperCase(name.charAt(0)) + name.substring(1);
            }
        } catch (Exception ignored) {}
        return langCode.toUpperCase(Locale.ROOT);
    }

    private void showGestureHud(String iconTitle, String value, int percent) {
        if (gestureHudLayout == null) return;
        gestureHudIcon.setText(iconTitle);
        gestureHudValue.setText(value);
        if (percent >= 0) {
            gestureHudProgress.setVisibility(View.VISIBLE);
            gestureHudProgress.setProgress(percent);
        } else {
            gestureHudProgress.setVisibility(View.GONE);
        }
        gestureHudLayout.setVisibility(View.VISIBLE);
        gestureHudHandler.removeCallbacks(hideGestureHudRunnable);
        gestureHudHandler.postDelayed(hideGestureHudRunnable, 800);
    }

    private void adjustBrightness(float delta) {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        float current = lp.screenBrightness;
        if (current < 0) {
            try {
                int sysBrightness = android.provider.Settings.System.getInt(
                    getContentResolver(),
                    android.provider.Settings.System.SCREEN_BRIGHTNESS
                );
                current = sysBrightness / 255.0f;
            } catch (Exception e) {
                current = 0.5f;
            }
        }
        float newBrightness = Math.max(0.01f, Math.min(1.0f, current + delta));
        lp.screenBrightness = newBrightness;
        getWindow().setAttributes(lp);

        int percent = Math.round(newBrightness * 100);
        showGestureHud("☀️  Luminosité", percent + " %", percent);
    }

    private void adjustVolume(float delta) {
        if (audioManager == null) {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        }
        if (audioManager == null) return;

        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);

        volumeAccumulator += delta * (float) max * 1.8f;
        int step = (int) volumeAccumulator;
        if (step != 0) {
            volumeAccumulator -= step;
            int newVol = Math.max(0, Math.min(max, current + step));
            if (newVol != current) {
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, newVol, 0);
            }
            int percent = max > 0 ? Math.round((newVol / (float) max) * 100) : 0;
            showGestureHud(newVol == 0 ? "🔇  Muet" : "🔊  Volume", percent + " %", percent);
        }
    }

    private void seekRelative(long deltaMs) {
        if (player == null) return;
        if (!vod && !player.isCurrentMediaItemSeekable()) {
            return;
        }
        long current = player.getCurrentPosition();
        long duration = player.getDuration();
        long target;
        if (duration > 0) {
            target = Math.max(0, Math.min(duration, current + deltaMs));
        } else {
            target = Math.max(0, current + deltaMs);
        }
        player.seekTo(target);
        String label = (deltaMs > 0 ? "⏩  +" : "⏪  −") + (Math.abs(deltaMs) / 1000) + " s";
        showGestureHud(label, formatMs(target), -1);
    }

    private String formatMs(long ms) {
        long totalSec = Math.max(0, ms / 1000);
        long hours = totalSec / 3600;
        long minutes = (totalSec % 3600) / 60;
        long seconds = totalSec % 60;
        if (hours > 0) {
            return String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds);
        } else {
            return String.format(Locale.US, "%02d:%02d", minutes, seconds);
        }
    }


    private void startSleepTimer(int minutes) {
        cancelSleepTimer();
        sleepTargetTimeMs = android.os.SystemClock.elapsedRealtime() + (minutes * 60_000L);
        sleepOnEnd = false;
        if (btnSleep != null) {
            styleFocusable(btnSleep, C_ACCENT, Color.WHITE, Color.WHITE);
            btnSleep.setText("🌙 " + minutes + "m");
        }

        sleepTicker = new Runnable() {
            @Override
            public void run() {
                long remainingMs = sleepTargetTimeMs - android.os.SystemClock.elapsedRealtime();
                if (remainingMs <= 0) {
                    Toast.makeText(NativePlayerActivity.this, "Mise en veille : arrêt de la lecture", Toast.LENGTH_LONG).show();
                    cancelSleepTimer();
                    saveProgress();
                    if (casting && castContext != null) {
                        CastSession session = castContext.getSessionManager().getCurrentCastSession();
                        if (session != null && session.getRemoteMediaClient() != null) session.getRemoteMediaClient().stop();
                    }
                    if (player != null) {
                        player.stop();
                    }
                    finish();
                    return;
                }
                int remMinutes = (int) Math.ceil(remainingMs / 60000.0);
                if (btnSleep != null) {
                    btnSleep.setText("🌙 " + remMinutes + "m");
                }
                sleepHandler.postDelayed(this, 15_000L);
            }
        };
        sleepHandler.postDelayed(sleepTicker, 15_000L);
    }

    private void cancelSleepTimer() {
        if (sleepTicker != null) {
            sleepHandler.removeCallbacks(sleepTicker);
            sleepTicker = null;
        }
        sleepTargetTimeMs = 0L;
        sleepOnEnd = false;
        if (btnSleep != null) {
            btnSleep.setText("Veille");
            styleFocusable(btnSleep, C_TRACK, C_ACCENT, Color.WHITE);
        }
    }

    // ── Détection TV (quand la page ne l'a pas transmise) ───────────

    private boolean detectTelevision() {
        try {
            android.app.UiModeManager ui = (android.app.UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            PackageManager pm = getPackageManager();
            return (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
                || pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                || !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN);
        } catch (Exception e) {
            return false;
        }
    }

    // ── Pause, reprise du direct et différé ─────────────────────────

    private boolean isPaused() {
        return player != null ? !player.getPlayWhenReady() : !playWhenReady;
    }

    /** Direct en pause ou en retard, ou archive du programme en cours. */
    private boolean isBehindLive() {
        return !vod && (archive || pausedAtMs > 0 || liveDelayMs >= LIVE_DELAY_SHOWN_MS);
    }

    private long currentLiveDelayMs() {
        return liveDelayMs + (pausedAtMs > 0 ? SystemClock.elapsedRealtime() - pausedAtMs : 0);
    }

    // ── Différé du programme en cours ───────────────────────────────

    /** Instant d'antenne regardé : début du programme + position dans l'archive. */
    private long archiveWatchedAtMs() {
        long position = player != null ? Math.max(0, player.getCurrentPosition()) : 0;
        return archiveStartMs + position;
    }

    /** Programme joué en différé, sous la même forme que ceux du guide. */
    private JSONArray archiveProgram() {
        JSONArray p = new JSONArray();
        p.put(archiveStartMs); p.put(archiveEndMs); p.put(archiveTitle != null ? archiveTitle : "");
        return p;
    }

    /** « Depuis le début » proposé : la chaîne a une archive et elle couvre le programme à l'antenne. */
    private boolean canRestartArchive() {
        if (vod || archive || casting || streamUrl == null) return false;
        Catchup c = catchupByUrl.get(streamUrl);
        if (c == null) return false;
        long now = System.currentTimeMillis();
        // Xtream : le programme est relu dans le guide transmis au moment de l'appui, donc
        // l'action reste juste même si la chaîne a changé d'émission depuis l'ouverture.
        if (!c.template.isEmpty()) return currentProgramIndex(channelIndex, now) >= 0;
        return now >= c.urlStart && now < c.urlEnd;
    }

    /**
     * Adresse de l'archive du programme à l'antenne maintenant, ou null. `window` reçoit le
     * début et la fin de ce programme : ils bornent la barre de progression du différé.
     */
    private String archiveUrlAt(long[] window) {
        Catchup c = catchupByUrl.get(streamUrl);
        if (c == null) return null;
        long now = System.currentTimeMillis();
        if (!c.template.isEmpty()) {
            int index = currentProgramIndex(channelIndex, now);
            JSONArray p = index >= 0 ? programAt(channelIndex, index) : null;
            if (p == null) return null;
            window[0] = p.optLong(0); window[1] = p.optLong(1);
            return timeshiftUrl(c, window[0], window[1]);
        }
        if (now < c.urlStart || now >= c.urlEnd) return null;
        window[0] = c.urlStart; window[1] = c.urlEnd;
        return c.url;
    }

    /** Adresse /timeshift/ : durée du programme en minutes, début à l'heure du serveur. */
    private static String timeshiftUrl(Catchup c, long start, long end) {
        long minutes = Math.max(1, (long) Math.ceil((end - start) / 60_000.0));
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd:HH-mm", Locale.ROOT);
        if (!c.timezone.isEmpty()) format.setTimeZone(java.util.TimeZone.getTimeZone(c.timezone));
        return c.template.replace("{minutes}", String.valueOf(minutes)).replace("{start}", format.format(new Date(start)));
    }

    private void leaveArchive() {
        archive = false; archiveStartMs = 0; archiveEndMs = 0; archiveUrl = null; archiveTitle = null;
    }

    /** Rejoue le programme à l'antenne depuis son début, sans quitter la chaîne ni le zap. */
    private void restartLiveFromStart() {
        if (vod || archive || casting) return;
        long[] window = new long[2];
        String url = archiveUrlAt(window);
        if (url == null) {
            Toast.makeText(this, "Différé indisponible pour ce programme.", Toast.LENGTH_SHORT).show();
            return;
        }
        archiveTitle = null;
        if (channelPrograms != null && channelIndex >= 0 && channelIndex < channelPrograms.size()) {
            JSONArray programs = channelPrograms.get(channelIndex);
            for (int i = 0; i < programs.length(); i++) {
                JSONArray p = programs.optJSONArray(i);
                if (p != null && p.optLong(0) == window[0] && p.optLong(1) == window[1]) { archiveTitle = p.optString(2, ""); break; }
            }
        }
        archive = true; archiveStartMs = window[0]; archiveEndMs = window[1]; archiveUrl = url;
        // Le différé n'est pas une pause du direct : aucun retard à mémoriser.
        pausedAtMs = 0; liveDelayMs = 0; liveLostWhilePaused = false; playWhenReady = true;
        cancelLiveReconnect("archive");
        cancelPendingZap();
        if (recording) stopRecording();
        if (player != null) prepareMedia(url); else initPlayer(url);
        lastUsedKey = "live";
        if (tvUi) rebuildBandRows();
        refreshControls();
        Toast.makeText(this, archiveTitle != null && !archiveTitle.isEmpty() ? "Depuis le début · " + archiveTitle : "Depuis le début",
            Toast.LENGTH_SHORT).show();
    }

    /** « EN PAUSE · 0:42 », « DIFFÉRÉ −0:42 », ou null au direct. */
    private String liveBadge() {
        if (vod) return null;
        if (archive) {
            long delay = Math.max(0, System.currentTimeMillis() - archiveWatchedAtMs());
            if (isPaused()) return "EN PAUSE · " + formatClock(delay);
            return delay >= 2_000 ? "DIFFÉRÉ −" + formatClock(delay) : "DIFFÉRÉ";
        }
        if (pausedAtMs > 0) return "EN PAUSE · " + formatClock(currentLiveDelayMs());
        if (liveDelayMs >= LIVE_DELAY_SHOWN_MS) return "DIFFÉRÉ −" + formatClock(liveDelayMs);
        return null;
    }

    private static String formatClock(long ms) {
        long seconds = Math.max(0, ms / 1000);
        if (seconds >= 3600) return String.format(Locale.FRANCE, "%d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60);
        return String.format(Locale.FRANCE, "%d:%02d", seconds / 60, seconds % 60);
    }

    private void togglePause() {
        setPaused(!isPaused());
    }

    /** Seuls « Pause » (qui devient « Lecture ») et la touche ⏯ mettent en pause. */
    private void setPaused(boolean pause) {
        if (player == null || casting) return;
        if (pause == isPaused()) return;
        if (pause) {
            if (!vod && !archive && liveReconnect.isRecovering()) liveLostWhilePaused = true;
            cancelLiveReconnect("paused");
            player.setPlayWhenReady(false);
            playWhenReady = false;
            if (!vod && !archive) pausedAtMs = SystemClock.elapsedRealtime();
        } else if (!vod && !archive && liveLostWhilePaused) {
            reconnectLive(true);
            return;
        } else {
            if (!vod && !archive && pausedAtMs > 0) {
                liveDelayMs += SystemClock.elapsedRealtime() - pausedAtMs;
                pausedAtMs = 0;
            }
            player.setPlayWhenReady(true);
            playWhenReady = true;
        }
        refreshControls();
        if (isControlsVisible) scheduleHideControls();
        // Reprise en différé : « Revenir au direct » arrive en tête, focus dessus.
        if (!pause && tvUi && isControlsVisible && tvBand != null && isBehindLive()) {
            tvBand.refresh();
            tvBand.focusKey("live");
        }
        ensureTicker();
    }

    private void backToLive() {
        if (archive) {
            // Le différé est un autre média : on rouvre le direct de la même chaîne.
            leaveArchive();
            pausedAtMs = 0; liveDelayMs = 0; liveLostWhilePaused = false; playWhenReady = true;
            cancelLiveReconnect("archive_live");
            if (player != null) prepareMedia(streamUrl); else initPlayer(streamUrl);
            if (tvUi) rebuildBandRows();
            Toast.makeText(this, "Retour au direct", Toast.LENGTH_SHORT).show();
            lastUsedKey = "pause";
            refreshControls();
            return;
        }
        boolean seekable = player != null && !liveLostWhilePaused
            && player.isCurrentMediaItemLive() && player.isCurrentMediaItemSeekable();
        if (seekable) {
            // Flux avec fenêtre de différé (HLS) : on saute au bord du direct, sans reconnexion.
            pausedAtMs = 0; liveDelayMs = 0;
            player.seekToDefaultPosition();
            player.setPlayWhenReady(true);
            playWhenReady = true;
        } else {
            reconnectLive(false);
        }
        lastUsedKey = "pause";
        refreshControls();
        if (tvUi && isControlsVisible && tvBand != null) tvBand.focusKey("pause");
    }

    /** Repart au direct en rouvrant le flux ; annonce pourquoi si la pause était trop longue. */
    private void reconnectLive(boolean announce) {
        // Les reconnexions postées (fin de direct, retard au direct) peuvent arriver après
        // onPause : ne pas recréer un lecteur fantôme en arrière-plan. En PiP l'activité
        // reste visible et le lecteur n'a pas été libéré — la reprise y est légitime.
        if ((!resumed && !isInPipMode()) || isFinishing() || isDestroyed()) return;
        cancelLiveReconnect("manual");
        pausedAtMs = 0; liveDelayMs = 0; liveLostWhilePaused = false;
        playWhenReady = true;
        progressHandler.removeCallbacks(autoRetryRunnable);
        hideError();
        if (player != null) prepareMedia(streamUrl); else initPlayer(streamUrl);
        if (announce) Toast.makeText(this, "Reprise au direct · la pause dépassait ce que le flux garde", Toast.LENGTH_LONG).show();
        refreshControls();
    }

    private boolean needsTicker() {
        if (pipActive) return false;
        if (!vod && (archive || pausedAtMs > 0 || liveDelayMs > 0)) return true;
        return vod && tvUi && isControlsVisible;
    }

    private void ensureTicker() {
        tickHandler.removeCallbacks(ticker);
        if (needsTicker()) tickHandler.post(ticker);
    }

    /** Bandeau fermé en différé : le retard reste affiché dans le coin. */
    private void updateCornerBadge() {
        if (cornerBadge == null) return;
        String badge = liveBadge();
        boolean show = badge != null && !pipActive && !isControlsVisible && !infoOnly;
        cornerBadge.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) {
            String mark = isPaused() ? "❚❚  " : "●  ";
            SpannableString text = new SpannableString(mark + badge);
            text.setSpan(new ForegroundColorSpan(C_DIM), 0, mark.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
            cornerBadge.setText(text);
        }
    }

    /** Relit tout ce qui affiche un état : pastilles, panneau Options, bouton central, badges. */
    private void refreshControls() {
        if (btnCenterPause != null) {
            boolean paused = isPaused();
            btnCenterPause.setImageResource(paused ? R.drawable.ic_player_play : R.drawable.ic_player_pause);
            btnCenterPause.setContentDescription(paused ? "Lecture" : "Pause");
        }
        if (tvBand != null) tvBand.refresh();
        if (optionsSheet != null) optionsSheet.refresh();
        updateInfoBar();
        updateCornerBadge();
    }

    // ── Bandeau TV ──────────────────────────────────────────────────

    private void buildTvBand(FrameLayout root) {
        tvBand = new TvBand(this, root, new TvBand.Host() {
            @Override public void onOptionUsed(PlayerOption option) { lastUsedKey = option.key; }
            @Override public void onListChanged(boolean open) { scheduleHideControls(); }
        });
        fillBandRows();
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(8), 0, 0);
        infoBar.addView(tvBand.view(), lp);
        tvBand.view().setVisibility(View.GONE);
    }

    /** Rangées du bandeau : la Progression n'existe qu'en VOD et en différé. */
    private void fillBandRows() {
        List<TvBand.Row> rows = new ArrayList<>();
        if (vod || archive) rows.add(new TvBand.Row("Progression", buildSeekRow(), null));
        rows.add(new TvBand.Row("Lecture", null, tvPlaybackOptions()));
        rows.add(new TvBand.Row("Réglages", null, settingOptions()));
        tvBand.setRows(rows);
    }

    /** Reconstruit le bandeau quand on entre ou sort du différé (rangée Progression, options). */
    private void rebuildBandRows() {
        if (tvBand == null) return;
        fillBandRows();
        // Bandeau fermé : ne pas lui donner le focus (il est invisible).
        if (isControlsVisible) focusBandOnOpen();
    }

    /** Rangée Progression : focusable ; ◀ ▶ reculent ou avancent, maintenir accélère. */
    private View buildSeekRow() {
        seekRow = new LinearLayout(this);
        seekRow.setOrientation(LinearLayout.HORIZONTAL);
        seekRow.setGravity(Gravity.CENTER_VERTICAL);
        seekRow.setFocusable(true);
        // OK sur la progression : pause ou reprise, comme ⏯.
        seekRow.setClickable(true);
        seekRow.setOnClickListener(v -> { lastUsedKey = "leading"; togglePause(); });
        seekRow.setPadding(dp(14), dp(10), dp(14), dp(10));
        seekRow.setContentDescription("Progression de la lecture");
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[] { android.R.attr.state_focused }, rounded(PlayerOption.C_PILL, 24));
        bg.addState(new int[] {}, rounded(Color.TRANSPARENT, 24));
        seekRow.setBackground(bg);
        seekElapsed = new TextView(this);
        seekElapsed.setTextSize(14);
        seekElapsed.setTextColor(PlayerOption.C_SOFT);
        seekElapsed.setTypeface(Typeface.MONOSPACE);
        seekRow.addView(seekElapsed);
        seekBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        seekBar.setMax(1000);
        seekBar.setProgressTintList(ColorStateList.valueOf(C_ACCENT));
        seekBar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.parseColor("#29FFFFFF")));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, dp(4), 1f);
        bp.setMargins(dp(16), 0, dp(16), 0);
        seekRow.addView(seekBar, bp);
        seekRemaining = new TextView(this);
        seekRemaining.setTextSize(14);
        seekRemaining.setTextColor(PlayerOption.C_SOFT);
        seekRemaining.setTypeface(Typeface.MONOSPACE);
        seekRow.addView(seekRemaining);
        seekRow.setOnFocusChangeListener((v, has) -> {
            // Au focus, la barre s'épaissit et passe en blanc : on voit ce que ◀ ▶ vont déplacer.
            ViewGroup.LayoutParams lp = seekBar.getLayoutParams();
            lp.height = dp(has ? 6 : 4);
            seekBar.setLayoutParams(lp);
            seekBar.setProgressTintList(ColorStateList.valueOf(has ? C_TEXT : C_ACCENT));
        });
        return seekRow;
    }

    /** Réouverture : dernière commande utilisée (ou sa voisine), sinon Chaînes / Pause. */
    private void focusBandOnOpen() {
        if (tvBand == null) return;
        if (isBehindLive() && pausedAtMs == 0 && tvBand.focusKey("live")) return;
        if (lastUsedKey != null && tvBand.focusPreferred(lastUsedKey)) return;
        if (!tvBand.focusKey(vod ? "pause" : "channels")) tvBand.focusKey("pause");
    }

    private void seekBy(int direction, int repeat) {
        // Maintenir la touche accélère : 10 s, puis 30 s, puis 1 min par pas.
        long step = repeat < 6 ? 10_000 : repeat < 20 ? 30_000 : 60_000;
        seekRelative(direction * step);
        updateInfoBar();
    }

    // ── Commandes partagées (Options du téléphone, bandeau TV) ───────

    /** Réglages : panneau Options (téléphone) et rangée Réglages (TV). */
    private List<PlayerOption> settingOptions() {
        List<PlayerOption> list = new ArrayList<>();
        if (vod) list.add(speedOption());
        list.add(audioOption());
        list.add(subtitleOption());
        list.add(formatOption());
        list.add(qualityOption());
        if (!tvUi) list.add(orientationOption());
        list.add(sleepOption());
        return list;
    }

    /** Actions du panneau Options, sous les réglages. */
    private List<PlayerOption> phoneActions() {
        List<PlayerOption> list = new ArrayList<>();
        if (vod) {
            list.add(PlayerOption.action("episodes", "Épisodes", this::openChannelPanel)
                .visible(() -> channelPanel != null).build());
            list.add(PlayerOption.action("next", "Épisode suivant", () -> switchChannel(1))
                .visible(this::hasNextEpisode).build());
            list.add(PlayerOption.action("restart", "Reprendre depuis le début", this::restartFromBeginning).build());
        } else {
            list.add(recordOption("Enregistrer le direct"));
        }
        list.add(PlayerOption.action("openWith", "Ouvrir avec… (VLC)", this::openInVlc).build());
        return list;
    }

    /** Rangée Lecture du bandeau TV. */
    private List<PlayerOption> tvPlaybackOptions() {
        List<PlayerOption> list = new ArrayList<>();
        if (!vod) {
            // En tête de la rangée Lecture : c'est un saut dans le programme, pas un réglage.
            // Il cède sa place à « Revenir au direct » dès que le différé est lancé.
            list.add(PlayerOption.action("restart", "Depuis le début", this::restartLiveFromStart)
                .icon(() -> R.drawable.ic_player_replay)
                .visible(this::canRestartArchive).build());
            list.add(PlayerOption.action("live", "Revenir au direct", this::backToLive)
                .visible(() -> isBehindLive() && pausedAtMs == 0).build());
        }
        list.add(PlayerOption.action("pause", "Pause", this::togglePause)
            .label(() -> isPaused() ? "Lecture" : "Pause")
            .icon(() -> isPaused() ? R.drawable.ic_player_play : R.drawable.ic_player_pause).build());
        if (!vod) {
            list.add(PlayerOption.action("channels", "Chaînes", this::openChannelPanel)
                .icon(() -> R.drawable.ic_player_list)
                .visible(() -> channelPanel != null).build());
            list.add(PlayerOption.action("previous", "Revenir à", () -> { if (previousIndex >= 0) switchTo(previousIndex); })
                .value(() -> previousIndex >= 0 && channelTitles != null && previousIndex < channelTitles.size() ? channelTitles.get(previousIndex) : null)
                .visible(() -> previousIndex >= 0 && previousIndex != channelIndex && channelTitles != null && previousIndex < channelTitles.size()).build());
            list.add(PlayerOption.action("reload", "Relancer le flux", this::reloadCurrentLive)
                .visible(() -> !archive).build());
            list.add(PlayerOption.action("favorite", "Ajouter aux favoris", this::toggleCurrentFavorite)
                .label(() -> favoriteStore.isFavorite(streamUrl) ? "Retirer des favoris" : "Ajouter aux favoris").build());
            list.add(recordOption("Enregistrer"));
        } else {
            list.add(PlayerOption.action("episodes", "Épisodes", this::openChannelPanel)
                .icon(() -> R.drawable.ic_player_list)
                .visible(() -> channelPanel != null).build());
            list.add(PlayerOption.action("next", "Suivant", () -> switchChannel(1))
                .value(() -> hasNextEpisode() ? "É" + (channelIndex + 2) : null)
                .visible(this::hasNextEpisode).build());
            list.add(PlayerOption.action("restart", "Depuis le début", this::restartFromBeginning).build());
        }
        list.add(PlayerOption.action("openWith", "Ouvrir avec…", this::openInVlc).build());
        return list;
    }

    private void reloadCurrentLive() {
        if (vod || streamUrl == null || casting) return;
        cancelPendingZap();
        reconnectLive(false);
        android.util.Log.i("IPTV-Playback", "manual_live_reload");
        Toast.makeText(this, "Flux relancé", Toast.LENGTH_SHORT).show();
    }

    private void toggleCurrentFavorite() {
        if (vod || streamUrl == null) return;
        boolean favorite = !favoriteStore.isFavorite(streamUrl);
        try {
            favoriteStore.setFavorite(streamUrl, favorite);
        } catch (IllegalStateException failure) {
            Toast.makeText(this, "Impossible d’enregistrer le favori", Toast.LENGTH_LONG).show();
            return;
        }
        refreshFavoriteChannels();
        if (panelFavorites && channelAdapter != null) channelAdapter.rebuild();
        refreshControls();
        Toast.makeText(this, favorite ? "Chaîne ajoutée aux favoris" : "Chaîne retirée des favoris", Toast.LENGTH_SHORT).show();
    }

    private boolean hasNextEpisode() {
        return vod && episodeIds != null && channelUrls != null && channelIndex >= 0 && channelIndex + 1 < channelUrls.size();
    }

    private void restartFromBeginning() {
        if (player == null) return;
        player.seekTo(0);
        player.setPlayWhenReady(true);
        playWhenReady = true;
        refreshControls();
    }

    private PlayerOption recordOption(String label) {
        return PlayerOption.action("record", label, this::toggleRecording)
            .label(() -> recording ? "Arrêter l'enregistrement" : label)
            .dot(C_LIVE)
            // En différé on regarde le programme, on ne capture pas le direct : pas d'ambiguïté.
            .visible(() -> isHttpUrl(streamUrl) && !archive).build();
    }

    private static String formatSpeed(float speed) {
        String text = String.format(Locale.FRANCE, "%.2f", speed).replaceAll("0+$", "").replaceAll(",$", "");
        return text + "×";
    }

    private PlayerOption speedOption() {
        return PlayerOption.list("speed", "Vitesse")
            .value(() -> formatSpeed(playbackSpeed))
            .choices(() -> {
                List<PlayerOption.Choice> out = new ArrayList<>();
                for (float speed : SPEEDS) {
                    final float value = speed;
                    out.add(new PlayerOption.Choice(formatSpeed(value), Math.abs(playbackSpeed - value) < 0.01f, () -> setSpeed(value)));
                }
                return out;
            }).build();
    }

    /** Vitesse gardée pendant toute la séance (épisodes suivants, pause, rotation) ;
     *  un autre film ou une autre série repart à 1×. */
    private void setSpeed(float speed) {
        playbackSpeed = speed;
        if (player != null) player.setPlaybackParameters(new PlaybackParameters(speed));
        updateInfoBar();
    }

    private boolean hasOverride(int trackType) {
        if (player == null) return false;
        for (TrackSelectionOverride o : player.getTrackSelectionParameters().overrides.values()) {
            if (o.getType() == trackType) return true;
        }
        return false;
    }

    private String trackLabel(Format format, int number, int trackType) {
        if (trackType == C.TRACK_TYPE_AUDIO) return formatAudioTrackLabel(format, number);
        String language = getLanguageDisplayName(format.language);
        if (language != null && format.label != null && !format.label.trim().isEmpty() && !format.label.equalsIgnoreCase(language)) {
            return language + " (" + format.label.trim() + ")";
        }
        if (language != null) return language;
        if (format.label != null && !format.label.trim().isEmpty()) return format.label.trim();
        return "Piste " + number;
    }

    /** Valeur affichée : langue de la piste en cours, sans détails. */
    private String selectedTrackName(int trackType) {
        if (player == null) return null;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != trackType) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSelected(i)) continue;
                Format f = group.getTrackFormat(i);
                String language = getLanguageDisplayName(f.language);
                if (language != null) return language;
                if (f.label != null && !f.label.trim().isEmpty()) return f.label.trim();
                return "Piste " + (i + 1);
            }
        }
        return null;
    }

    /** Pistes d'un type, avec l'action qui les choisit. */
    private List<PlayerOption.Choice> trackChoices(int trackType) {
        List<PlayerOption.Choice> out = new ArrayList<>();
        if (player == null) return out;
        int number = 1;
        boolean overridden = hasOverride(trackType);
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != trackType) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) { number++; continue; }
                final Tracks.Group g = group;
                final int index = i;
                boolean checked = (overridden || trackType == C.TRACK_TYPE_TEXT) && group.isTrackSelected(i);
                out.add(new PlayerOption.Choice(trackLabel(group.getTrackFormat(i), number++, trackType), checked, () -> {
                    if (player == null) return;
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .setTrackTypeDisabled(trackType, false)
                        .setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), Collections.singletonList(index)))
                        .build());
                }));
            }
        }
        return out;
    }

    private PlayerOption audioOption() {
        return PlayerOption.list("audio", "Audio")
            .value(() -> { String name = selectedTrackName(C.TRACK_TYPE_AUDIO); return name != null ? name : "Auto"; })
            .choices(() -> {
                List<PlayerOption.Choice> out = new ArrayList<>();
                out.add(new PlayerOption.Choice("Automatique (français d'abord)", !hasOverride(C.TRACK_TYPE_AUDIO), () -> {
                    if (player == null) return;
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .clearOverridesOfType(C.TRACK_TYPE_AUDIO).setPreferredAudioLanguage("fra").build());
                }));
                out.addAll(trackChoices(C.TRACK_TYPE_AUDIO));
                return out;
            }).build();
    }

    private boolean subtitlesOff() {
        if (player == null) return true;
        if (player.getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)) return true;
        return selectedTrackName(C.TRACK_TYPE_TEXT) == null;
    }

    private PlayerOption subtitleOption() {
        return PlayerOption.list("subtitles", "Sous-titres")
            .value(() -> subtitlesOff() ? "Désactivés" : selectedTrackName(C.TRACK_TYPE_TEXT))
            .choices(() -> {
                List<PlayerOption.Choice> out = new ArrayList<>();
                out.add(new PlayerOption.Choice("Désactivés", subtitlesOff(), () -> {
                    if (player == null) return;
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
                }));
                out.addAll(trackChoices(C.TRACK_TYPE_TEXT));
                return out;
            }).build();
    }

    private PlayerOption formatOption() {
        return PlayerOption.list("format", "Format")
            .value(() -> currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM ? "Zoom"
                : currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_FILL ? "Étiré" : "Ajusté")
            .choices(() -> {
                List<PlayerOption.Choice> out = new ArrayList<>();
                int[] modes = { AspectRatioFrameLayout.RESIZE_MODE_FIT, AspectRatioFrameLayout.RESIZE_MODE_ZOOM, AspectRatioFrameLayout.RESIZE_MODE_FILL };
                String[] names = { "Ajusté (image entière)", "Zoom (remplit l'écran)", "Étiré" };
                for (int i = 0; i < modes.length; i++) {
                    final int mode = modes[i];
                    out.add(new PlayerOption.Choice(names[i], currentResizeMode == mode, () -> {
                        currentResizeMode = mode;
                        if (playerView != null) playerView.setResizeMode(mode);
                    }));
                }
                return out;
            }).build();
    }

    /** Hauteurs vidéo distinctes proposées par le flux (plusieurs qualités : HLS adaptatif). */
    private List<int[]> videoHeights() {
        List<int[]> out = new ArrayList<>(); // [hauteur, index du groupe, index de piste]
        if (player == null) return out;
        List<Tracks.Group> groups = player.getCurrentTracks().getGroups();
        for (int g = 0; g < groups.size(); g++) {
            Tracks.Group group = groups.get(g);
            if (group.getType() != C.TRACK_TYPE_VIDEO) continue;
            for (int i = 0; i < group.length; i++) {
                int height = group.getTrackFormat(i).height;
                if (!group.isTrackSupported(i) || height <= 0) continue;
                boolean seen = false;
                for (int[] h : out) if (h[0] == height) { seen = true; break; }
                if (!seen) out.add(new int[] { height, g, i });
            }
        }
        Collections.sort(out, (a, b) -> b[0] - a[0]);
        return out;
    }

    private PlayerOption qualityOption() {
        return PlayerOption.list("quality", "Qualité")
            .visible(() -> videoHeights().size() > 1)
            .value(() -> {
                if (!hasOverride(C.TRACK_TYPE_VIDEO)) return "Auto";
                Format f = player != null ? player.getVideoFormat() : null;
                return f != null && f.height > 0 ? f.height + "p" : "Auto";
            })
            .choices(() -> {
                List<PlayerOption.Choice> out = new ArrayList<>();
                boolean auto = !hasOverride(C.TRACK_TYPE_VIDEO);
                out.add(new PlayerOption.Choice("Auto (selon le débit)", auto, () -> {
                    if (player == null) return;
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .clearOverridesOfType(C.TRACK_TYPE_VIDEO).build());
                }));
                Format current = player != null ? player.getVideoFormat() : null;
                List<Tracks.Group> groups = player != null ? player.getCurrentTracks().getGroups() : new ArrayList<>();
                for (int[] h : videoHeights()) {
                    final Tracks.Group group = groups.get(h[1]);
                    final int track = h[2];
                    boolean checked = !auto && current != null && current.height == h[0];
                    out.add(new PlayerOption.Choice(h[0] + "p", checked, () -> {
                        if (player == null) return;
                        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                            .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), Collections.singletonList(track)))
                            .build());
                    }));
                }
                return out;
            }).build();
    }

    private PlayerOption orientationOption() {
        String[] names = { "Auto", "Paysage", "Verrouillée" };
        return PlayerOption.list("orientation", "Orientation")
            .value(() -> names[orientationMode])
            .choices(() -> {
                List<PlayerOption.Choice> out = new ArrayList<>();
                String[] labels = { "Auto (suit le téléphone)", "Paysage", "Verrouillée (position actuelle)" };
                for (int i = 0; i < labels.length; i++) {
                    final int mode = i;
                    out.add(new PlayerOption.Choice(labels[i], orientationMode == mode, () -> {
                        orientationMode = mode;
                        setRequestedOrientation(mode == 1 ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            : mode == 2 ? ActivityInfo.SCREEN_ORIENTATION_LOCKED
                            : ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
                    }));
                }
                return out;
            }).build();
    }

    private PlayerOption sleepOption() {
        return PlayerOption.list("sleep", "Veille")
            .value(() -> {
                if (sleepOnEnd) return "Fin de la vidéo";
                if (sleepTargetTimeMs <= 0) return "Non";
                long remaining = sleepTargetTimeMs - SystemClock.elapsedRealtime();
                return "Dans " + Math.max(1, (remaining + 59_999) / 60_000) + " min";
            })
            .choices(() -> {
                List<PlayerOption.Choice> out = new ArrayList<>();
                boolean off = !sleepOnEnd && sleepTargetTimeMs <= 0;
                out.add(new PlayerOption.Choice("Non", off, this::cancelSleepTimer));
                for (int minutes : new int[] { 15, 30, 45, 60, 90 }) {
                    final int m = minutes;
                    out.add(new PlayerOption.Choice(minutes + " min", false, () -> startSleepTimer(m)));
                }
                if (vod) {
                    out.add(new PlayerOption.Choice("Fin de la vidéo", sleepOnEnd, () -> { cancelSleepTimer(); sleepOnEnd = true; }));
                }
                return out;
            }).build();
    }

    /** Lecteur vu par le contrôleur Media3 (téléphone, films) : sans ses réglages de vitesse et de
     *  pistes, qui passent par le panneau Options — sa liste de vitesses se bloquait au second choix. */
    private Player viewPlayer(ExoPlayer exo) {
        return new ForwardingPlayer(exo) {
            @Override public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                    .remove(Player.COMMAND_SET_SPEED_AND_PITCH)
                    .remove(Player.COMMAND_SET_TRACK_SELECTION_PARAMETERS)
                    .build();
            }
            @Override public boolean isCommandAvailable(int command) {
                if (command == Player.COMMAND_SET_SPEED_AND_PITCH || command == Player.COMMAND_SET_TRACK_SELECTION_PARAMETERS) return false;
                return super.isCommandAvailable(command);
            }
        };
    }

    // ── Télécommande : une touche fait une chose, selon ce qui est ouvert ──

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_MEDIA_PLAY || code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            // ⏯ partout, quel que soit ce qui est ouvert ; le bandeau reste comme il est.
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && player != null && !casting) {
                if (code == KeyEvent.KEYCODE_MEDIA_PLAY) setPaused(false);
                else if (code == KeyEvent.KEYCODE_MEDIA_PAUSE) setPaused(true);
                else togglePause();
                if (!tvUi && !isControlsVisible && !vod) showControls();
            }
            return true;
        }
        if (tvUi && handleTvKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    private boolean handleTvKey(KeyEvent event) {
        int code = event.getKeyCode();
        boolean up = code == KeyEvent.KEYCODE_DPAD_UP, down = code == KeyEvent.KEYCODE_DPAD_DOWN;
        boolean left = code == KeyEvent.KEYCODE_DPAD_LEFT, right = code == KeyEvent.KEYCODE_DPAD_RIGHT;
        boolean arrow = up || down || left || right;
        boolean ok = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER;
        if (!arrow && !ok) return false;
        if (pipActive || casting) return false;
        boolean pressed = event.getAction() == KeyEvent.ACTION_DOWN;
        // Panneaux qui gardent la navigation par défaut : erreur, épisode suivant, saisie d'un numéro.
        if (errorPanel != null && errorPanel.getVisibility() == View.VISIBLE && !isControlsVisible) return false;
        if (nextEpisodePanel != null && nextEpisodePanel.getVisibility() == View.VISIBLE) return false;
        if (ok && numberBuffer.length() > 0) return false;

        if (isChannelPanelOpen()) {
            // Liste des chaînes : ▲ ▼ parcourent, OK lance ; ◀ va aux catégories, ▶ ferme la liste.
            boolean inList = channelListView != null && channelListView.hasFocus();
            if (right && inList) { if (pressed) closeChannelPanel(); return true; }
            if (left && inList) {
                if (pressed && groupChips != null) focusActiveChip();
                return true;
            }
            return false;
        }

        if (tvBand != null && tvBand.isListOpen()) {
            // Liste d'un réglage : ▲ ▼ choisissent, OK applique, ◀ ▶ sans effet.
            if (!arrow) return false;
            if (pressed && (up || down)) tvBand.moveInList(up ? -1 : 1);
            scheduleHideControls();
            return true;
        }

        if (isControlsVisible) {
            scheduleHideControls();
            if (!arrow) return false; // OK : la commande sous le focus s'active.
            if (!pressed) return true;
            if (!tvBand.hasFocus()) { focusBandOnOpen(); return true; }
            View focused = getCurrentFocus();
            if (focused != null && focused == seekRow && (left || right)) {
                seekBy(left ? -1 : 1, event.getRepeatCount());
                lastUsedKey = "leading";
                return true;
            }
            if (up || down) tvBand.moveRow(up ? -1 : 1);
            else tvBand.moveInRow(left ? -1 : 1);
            return true;
        }

        // Rien d'ouvert.
        if (!pressed) return true;
        if (vod) {
            if (left || right) { seekBy(left ? -1 : 1, event.getRepeatCount()); return true; }
            if (up || down) {
                if (event.getRepeatCount() > 0) return true;
                showControls();
                if (tvBand != null) tvBand.focusLeading();
                return true;
            }
            if (event.getRepeatCount() == 0) showControls();
            return true;
        }
        if (channelUrls != null && (up || down)) { switchChannel(up ? -1 : 1); return true; }
        if (channelUrls != null && left) { openChannelPanel(); return true; }
        if ((ok || right) && event.getRepeatCount() == 0) showControls();
        return true;
    }
}
