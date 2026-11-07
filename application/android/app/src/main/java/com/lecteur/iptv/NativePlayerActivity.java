package com.lecteur.iptv;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
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
import androidx.appcompat.app.AlertDialog;
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
    private static final int BUFFER_MIN_MS = 15_000;
    private static final int BUFFER_MAX_MS = 50_000;
    private static final int LIVE_BUFFER_FOR_PLAYBACK_MS = 1_200;
    private static final int LIVE_BUFFER_FOR_REBUFFER_MS = 3_000;
    private static final int VOD_BUFFER_FOR_PLAYBACK_MS = 2_500;
    private static final int VOD_BUFFER_FOR_REBUFFER_MS = 5_000;
    /** Reprises automatiques après une erreur transitoire (coupure réseau, serveur surchargé). */
    private static final int AUTO_RETRY_MAX = 2;

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
    /** Taille de la liste complète côté page : au-delà du contexte, la page relance sur le numéro saisi. */
    private int channelTotal = 0;
    /** Saisie du numéro de chaîne aux touches 0-9 de la télécommande. */
    private final StringBuilder numberBuffer = new StringBuilder();
    private final Handler numberHandler = new Handler(Looper.getMainLooper());
    private TextView numberOverlay;
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
    private boolean pipActive = false;
    private final SimpleDateFormat hourFormat = new SimpleDateFormat("HH:mm", Locale.FRANCE);
    /** Bouton recevant la sélection télécommande à l'ouverture des commandes (aucun effet de bord sur la lecture). */
    private Button btnAudio;
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

    // Palette « Salle obscure ».
    private static final int C_BG = Color.parseColor("#0B0B0D");
    private static final int C_CARD = Color.parseColor("#141417");
    private static final int C_ELEV = Color.parseColor("#1C1C21");
    private static final int C_TRACK = Color.parseColor("#26262D");
    private static final int C_TEXT = Color.parseColor("#F3F1ED");
    private static final int C_MUTED = Color.parseColor("#A7A39C");
    private static final int C_DIM = Color.parseColor("#8A8680");
    private static final int C_ACCENT = Color.parseColor("#F0B455");
    private static final int C_ACCENT_FG = Color.parseColor("#1A1206");
    private static final int C_LIVE = Color.parseColor("#FF5A4A");
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
            nextEpisodeLabel.setText("Épisode suivant dans " + ((remaining + 999) / 1000) + " s\n" + title);
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

        streamUrl = getIntent().getStringExtra(EXTRA_URL);
        streamTitle = getIntent().getStringExtra(EXTRA_TITLE);
        vod = getIntent().getBooleanExtra("vod", false);
        channelIndex = savedInstanceState != null ? savedInstanceState.getInt("channelIndex", -1) : getIntent().getIntExtra("channelIndex", -1);
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
                channelGroups = new ArrayList<>(); channelPrograms = new ArrayList<>(); channelNumbers = new ArrayList<>();
                for (int i = 0; i < entries.length(); i++) {
                    JSONArray entry = entries.getJSONArray(i);
                    channelUrls.add(entry.getString(0)); channelTitles.add(entry.getString(1));
                    channelGroups.add(entry.length() > 2 ? entry.optString(2, "") : "");
                    JSONArray programs = entry.length() > 3 ? entry.optJSONArray(3) : null;
                    channelPrograms.add(programs != null ? programs : new JSONArray());
                    channelNumbers.add(entry.length() > 4 ? entry.optString(4, "") : "");
                }
                channelTotal = Math.max(channelUrls.size(), getIntent().getIntExtra("channelTotal", channelUrls.size()));
                if (channelIndex >= 0 && channelIndex < channelUrls.size()) {
                    streamUrl = channelUrls.get(channelIndex); streamTitle = channelTitles.get(channelIndex);
                }
            } catch (Exception ignored) { channelUrls = null; channelTitles = null; programLineCache.clear(); }
        }
        if (channelUrls == null || channelTitles == null
                || channelUrls.size() != channelTitles.size()
                || channelIndex < 0 || channelIndex >= channelUrls.size()) {
            channelUrls = null; channelTitles = null; channelIndex = -1;
            channelGroups = null; channelPrograms = null; channelNumbers = null; channelTotal = 0;
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
        playerView.setUseController(vod);
        if (vod) { playerView.setShowSubtitleButton(true); playerView.setControllerShowTimeoutMs(3500); }
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
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER_HORIZONTAL);
        errorPanel.setBackground(rounded(C_CARD, 18));
        errorPanel.setPadding(dp(24), dp(16), dp(24), dp(16));
        FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        errorPanel.setLayoutParams(errorParams);
        errorPanel.setVisibility(View.GONE);
        errorText = new TextView(this);
        errorText.setTextColor(Color.WHITE);
        errorText.setTextSize(14);
        errorText.setGravity(Gravity.CENTER);
        errorText.setMaxLines(3);
        errorPanel.addView(errorText);
        retryButton = new Button(this);
        retryButton.setText("Réessayer la lecture");
        retryButton.setAllCaps(false);
        retryButton.setOnClickListener(v -> {
            hideError();
            releasePlayer();
            initPlayer(streamUrl);
        });
        errorPanel.addView(retryButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(52)));
        LinearLayout errorActions = new LinearLayout(this);
        errorActions.setOrientation(LinearLayout.HORIZONTAL);
        btnNextChannel = new Button(this);
        btnNextChannel.setText("Chaîne suivante");
        btnNextChannel.setAllCaps(false);
        btnNextChannel.setOnClickListener(v -> { hideError(); switchChannel(1); });
        errorActions.addView(btnNextChannel, new LinearLayout.LayoutParams(0, dp(52), 1));
        btnVlc = new Button(this);
        btnVlc.setText("Ouvrir dans VLC");
        btnVlc.setAllCaps(false);
        btnVlc.setOnClickListener(v -> openInVlc());
        errorActions.addView(btnVlc, new LinearLayout.LayoutParams(0, dp(52), 1));
        errorPanel.addView(errorActions);
        root.addView(errorPanel);

        // Top Toolbar
        topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        // Dégradé vers la transparence : l'image reste visible sous les commandes.
        topBar.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { Color.parseColor("#E60B0B0D"), Color.parseColor("#990B0B0D"), Color.TRANSPARENT }));
        topBar.setPadding(dp(12), dp(10), dp(12), dp(28));
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        topParams.gravity = Gravity.TOP;
        topBar.setLayoutParams(topParams);

        // Back button
        Button btnBack = new Button(this);
        btnBack.setText("←");
        btnBack.setContentDescription("Retour à la liste des chaînes");
        btnBack.setTextSize(18);
        btnBack.setTextColor(Color.WHITE);
        styleFocusable(btnBack, Color.TRANSPARENT, C_ACCENT, Color.WHITE);
        btnBack.setPadding(dp(4), 0, dp(12), 0);
        btnBack.setOnClickListener(v -> finish());
        sizeToolbarButton(btnBack, 44);
        topBar.addView(btnBack);

        // Title
        tvTitle = new TextView(this);
        tvTitle.setText(streamTitle);
        tvTitle.setTextSize(15);
        tvTitle.setTextColor(Color.WHITE);
        tvTitle.setTypeface(Typeface.DEFAULT_BOLD);
        tvTitle.setSingleLine(true);
        tvTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        tvTitle.setMinWidth(0);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.setMargins(0, 0, dp(8), 0);
        tvTitle.setMaxWidth(dp(130));
        tvTitle.setLayoutParams(titleParams);
        topBar.addView(tvTitle);
        // Action buttons container (with horizontal scrolling for narrow screens)
        HorizontalScrollView actionScrollView = new HorizontalScrollView(this);
        actionScrollView.setHorizontalScrollBarEnabled(false);
        actionScrollView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1.0f
        );
        actionScrollView.setLayoutParams(scrollParams);

        LinearLayout actionsLayout = new LinearLayout(this);
        actionsLayout.setOrientation(LinearLayout.HORIZONTAL);
        actionsLayout.setGravity(Gravity.CENTER_VERTICAL);
        actionScrollView.addView(actionsLayout);

        // Channel / Episode zapping
        if (channelUrls != null) {
            Button btnPrev = new Button(this);
            btnPrev.setText("‹");
            btnPrev.setContentDescription(vod ? "Épisode précédent" : "Chaîne précédente");
            btnPrev.setTextSize(16);
            btnPrev.setTextColor(Color.WHITE);
            styleFocusable(btnPrev, C_TRACK, C_ACCENT, Color.WHITE);
            btnPrev.setPadding(dp(8), dp(2), dp(8), dp(2));
            btnPrev.setOnClickListener(v -> switchChannel(-1));
            sizeToolbarButton(btnPrev, 44);
            actionsLayout.addView(btnPrev);

            Button btnNext = new Button(this);
            btnNext.setText("›");
            btnNext.setContentDescription(vod ? "Épisode suivant" : "Chaîne suivante");
            btnNext.setTextSize(16);
            btnNext.setTextColor(Color.WHITE);
            styleFocusable(btnNext, C_TRACK, C_ACCENT, Color.WHITE);
            LinearLayout.LayoutParams nextParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            nextParams.setMargins(dp(4), 0, 0, 0);
            btnNext.setLayoutParams(nextParams);
            btnNext.setPadding(dp(8), dp(2), dp(8), dp(2));
            btnNext.setOnClickListener(v -> switchChannel(1));
            sizeToolbarButton(btnNext, 44);
            ((LinearLayout.LayoutParams) btnNext.getLayoutParams()).setMargins(dp(4), 0, 0, 0);
            actionsLayout.addView(btnNext);

            if (!vod) {
                btnPrevious = toolbarButton("↺", "Revenir à la chaîne précédente", 44, C_TRACK, C_ACCENT, C_TEXT);
                btnPrevious.setOnClickListener(v -> { if (previousIndex >= 0) switchTo(previousIndex); });
                actionsLayout.addView(btnPrevious);
                updatePreviousButton();

                Button btnChannels = toolbarButton("Chaînes", "Ouvrir la liste des chaînes", 76, C_ACCENT, Color.WHITE, C_ACCENT_FG);
                btnChannels.setTypeface(Typeface.DEFAULT_BOLD);
                btnChannels.setOnClickListener(v -> openChannelPanel());
                actionsLayout.addView(btnChannels);
            }
        }

        if (pipSupported()) {
            Button btnPip = toolbarButton("PiP", "Réduire en petite fenêtre (image dans l'image)", 48, C_TRACK, C_ACCENT, C_TEXT);
            btnPip.setOnClickListener(v -> enterPip());
            actionsLayout.addView(btnPip);
        }

        // Audio track button (Multi-audio VF/VO)
        btnAudio = new Button(this);
        btnAudio.setText("Audio");
        btnAudio.setTextSize(11);
        btnAudio.setTextColor(Color.WHITE);
        styleFocusable(btnAudio, C_TRACK, C_ACCENT, Color.WHITE);
        btnAudio.setPadding(dp(8), dp(4), dp(8), dp(4));
        btnAudio.setContentDescription("Sélectionner la piste audio");
        btnAudio.setOnClickListener(v -> showAudioTrackDialog());
        sizeToolbarButton(btnAudio, 48);
        LinearLayout.LayoutParams audioParams = (LinearLayout.LayoutParams) btnAudio.getLayoutParams();
        audioParams.setMargins(dp(6), 0, 0, 0);
        btnAudio.setLayoutParams(audioParams);
        actionsLayout.addView(btnAudio);

        // Sleep Timer button
        btnSleep = new Button(this);
        btnSleep.setText("Veille");
        btnSleep.setTextSize(11);
        btnSleep.setTextColor(Color.WHITE);
        styleFocusable(btnSleep, C_TRACK, C_ACCENT, Color.WHITE);
        btnSleep.setPadding(dp(8), dp(4), dp(8), dp(4));
        btnSleep.setContentDescription("Minuteur de mise en veille");
        btnSleep.setOnClickListener(v -> showSleepTimerDialog());
        sizeToolbarButton(btnSleep, 52);
        LinearLayout.LayoutParams sleepParams = (LinearLayout.LayoutParams) btnSleep.getLayoutParams();
        sleepParams.setMargins(dp(6), 0, 0, 0);
        btnSleep.setLayoutParams(sleepParams);
        actionsLayout.addView(btnSleep);

        // Aspect ratio button
        Button btnRatio = new Button(this);
        btnRatio.setText("Format");
        btnRatio.setTextSize(11);
        btnRatio.setTextColor(Color.WHITE);
        styleFocusable(btnRatio, C_TRACK, C_ACCENT, Color.WHITE);
        btnRatio.setPadding(dp(8), dp(4), dp(8), dp(4));
        btnRatio.setContentDescription("Changer le format d'image");
        btnRatio.setOnClickListener(v -> toggleAspectRatio());
        sizeToolbarButton(btnRatio, 58);
        actionsLayout.addView(btnRatio);

        // Rotation plein écran (Paysage / Portrait)
        Button btnRotate = new Button(this);
        btnRotate.setText("⛶");
        btnRotate.setTextSize(13);
        btnRotate.setTextColor(Color.WHITE);
        styleFocusable(btnRotate, C_TRACK, C_ACCENT, Color.WHITE);
        btnRotate.setContentDescription("Basculer entre plein écran paysage et portrait");
        btnRotate.setOnClickListener(v -> toggleOrientation());
        sizeToolbarButton(btnRotate, 44);
        LinearLayout.LayoutParams rotParams = (LinearLayout.LayoutParams) btnRotate.getLayoutParams();
        rotParams.setMargins(dp(6), 0, 0, 0);
        btnRotate.setLayoutParams(rotParams);
        actionsLayout.addView(btnRotate);

        // VLC button
        Button btnVlc = new Button(this);
        btnVlc.setText("VLC");
        btnVlc.setTextSize(11);
        btnVlc.setTextColor(Color.WHITE);
        styleFocusable(btnVlc, C_TRACK, C_ACCENT, Color.WHITE);
        LinearLayout.LayoutParams vlcParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        vlcParams.setMargins(dp(8), 0, 0, 0);
        btnVlc.setLayoutParams(vlcParams);
        btnVlc.setPadding(dp(8), dp(4), dp(8), dp(4));
        btnVlc.setOnClickListener(v -> openInVlc());
        sizeToolbarButton(btnVlc, 48);
        actionsLayout.addView(btnVlc);


        // Enregistrement DVR : capture le direct en cours (TS brut ou HLS remuxé en MP4).
        if (!vod) {
            btnRec = new Button(this);
            btnRec.setText(recording ? "■" : "REC");
            btnRec.setTextSize(11);
            btnRec.setTextColor(Color.WHITE);
            styleFocusable(btnRec, recording ? C_LIVE : C_TRACK, C_ACCENT, Color.WHITE);
            btnRec.setPadding(dp(8), dp(4), dp(8), dp(4));
            btnRec.setContentDescription("Enregistrer le direct (DVR)");
            btnRec.setOnClickListener(v -> toggleRecording());
            sizeToolbarButton(btnRec, 52);
            LinearLayout.LayoutParams recParams = (LinearLayout.LayoutParams) btnRec.getLayoutParams();
            recParams.setMargins(dp(8), 0, 0, 0);
            btnRec.setLayoutParams(recParams);
            actionsLayout.addView(btnRec);
        }

        // Chromecast : envoie le flux vers un téléviseur/écran compatible (HTTP uniquement).
        if (castContext != null && isHttpUrl(streamUrl)) {
            MediaRouteButton castButton = new MediaRouteButton(this);
            castButton.setContentDescription("Envoyer vers un écran (Chromecast)");
            LinearLayout.LayoutParams castParams = new LinearLayout.LayoutParams(dp(48), dp(48));
            castParams.setMargins(dp(8), 0, 0, 0);
            castButton.setLayoutParams(castParams);
            CastButtonFactory.setUpMediaRouteButton(getApplicationContext(), castButton);
            actionsLayout.addView(castButton);
        }

        topBar.addView(actionScrollView);
        root.addView(topBar);
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
        gestureHudValue.setTextColor(Color.parseColor("#F0B455"));
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
            gestureHudProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#F0B455")));
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

        if (vod) {
            playerView.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
                topBar.setVisibility(visibility);
                // Sélection télécommande posée à l'affichage, comme pour le direct.
                if (visibility == View.VISIBLE) { if (btnAudio != null) btnAudio.requestFocus(); }
                else hideSystemUI();
            });
        }

        nextEpisodePanel = new LinearLayout(this);
        nextEpisodePanel.setOrientation(LinearLayout.VERTICAL);
        nextEpisodePanel.setBackground(rounded(C_CARD, 18));
        nextEpisodePanel.setPadding(dp(16), dp(12), dp(16), dp(12));
        FrameLayout.LayoutParams nextParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        nextParams.setMargins(dp(16), 0, dp(16), dp(92));
        nextEpisodePanel.setLayoutParams(nextParams);
        nextEpisodeLabel = new TextView(this);
        nextEpisodeLabel.setTextColor(Color.WHITE);
        nextEpisodeLabel.setTextSize(16);
        nextEpisodeLabel.setMaxLines(3);
        nextEpisodePanel.addView(nextEpisodeLabel);
        LinearLayout nextActions = new LinearLayout(this);
        Button stay = new Button(this);
        stay.setText("Rester ici");
        stay.setAllCaps(false);
        stay.setOnClickListener(v -> cancelNextEpisode());
        nextActions.addView(stay, new LinearLayout.LayoutParams(0, dp(52), 1));
        Button watchNext = new Button(this);
        watchNext.setText("Lire maintenant");
        watchNext.setAllCaps(false);
        watchNext.setOnClickListener(v -> { cancelNextEpisode(); switchChannel(1); });
        nextActions.addView(watchNext, new LinearLayout.LayoutParams(0, dp(52), 1));
        nextEpisodePanel.addView(nextActions);
        nextEpisodePanel.setVisibility(View.GONE);
        root.addView(nextEpisodePanel);
        if (!vod) {
            buildInfoBar(root);
            if (channelUrls != null) buildChannelPanel(root);
            if (channelUrls != null) buildNumberOverlay(root);
        }
        setContentView(root);
        updateInfoBar();
        scheduleHideControls();
    }

    private void switchChannel(int delta) {
        if (channelUrls == null || channelTitles == null || channelIndex < 0) return;
        int size = channelUrls.size();
        int next;
        if (vod) {
            next = channelIndex + delta;
            if (next < 0 || next >= size) return;
        } else {
            next = (channelIndex + delta + size) % size;
        }
        switchTo(next);
    }

    private void switchTo(int next) {
        cancelNextEpisode();
        if (channelUrls == null || channelTitles == null || channelIndex < 0) return;
        if (next < 0 || next >= channelUrls.size() || next == channelIndex) return;
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
        if (!vod) previousIndex = channelIndex;
        channelIndex = next;
        streamUrl = channelUrls.get(next);
        streamTitle = channelTitles.get(next);
        if (tvTitle != null) tvTitle.setText(streamTitle);
        // En direct, le bandeau affiche déjà le nom de la chaîne.
        if (vod) Toast.makeText(this, streamTitle, Toast.LENGTH_SHORT).show();
        updatePreviousButton();
        if (channelAdapter != null) channelAdapter.notifyDataSetChanged();
        if (player != null) {
            zapCount++;
            prepareMedia(streamUrl);
        } else {
            initPlayer(streamUrl);
        }
        showControls();
    }

    private void toggleOrientation() {
        int orientation = getResources().getConfiguration().orientation;
        if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
            Toast.makeText(this, "Mode portrait", Toast.LENGTH_SHORT).show();
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            Toast.makeText(this, "Plein écran paysage", Toast.LENGTH_SHORT).show();
        }
        scheduleHideControls();
    }

    private void toggleAspectRatio() {
        int orientation = getResources().getConfiguration().orientation;
        if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT) {
            if (orientation == Configuration.ORIENTATION_PORTRAIT) {
                currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
                Toast.makeText(this, "Format adapté (remplissage)", Toast.LENGTH_SHORT).show();
            } else {
                currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
                Toast.makeText(this, "Zoom plein écran", Toast.LENGTH_SHORT).show();
            }
        } else if (currentResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) {
            currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
            Toast.makeText(this, "Étiré", Toast.LENGTH_SHORT).show();
        } else {
            currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
            Toast.makeText(this, "Format original (ajusté)", Toast.LENGTH_SHORT).show();
        }
        playerView.setResizeMode(currentResizeMode);
        scheduleHideControls();
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

    private void toggleControls() {
        if (isControlsVisible) {
            hideControls();
        } else {
            showControls();
        }
    }

    private void showControls() {
        if (pipActive) return;
        topBar.animate().cancel();
        isControlsVisible = true;
        topBar.setVisibility(View.VISIBLE);
        topBar.animate().alpha(1.0f).setDuration(200).start();
        if (infoBar != null) {
            updateInfoBar();
            infoBar.animate().cancel();
            infoBar.setVisibility(View.VISIBLE);
            infoBar.animate().alpha(1.0f).setDuration(200).start();
        }
        scheduleHideControls();
        // La télécommande a une sélection visible dès l'ouverture : bouton sans effet de bord
        // sur la lecture ; les flèches atteignent ensuite toutes les options de la barre.
        if (btnAudio != null) btnAudio.requestFocus();
    }

    private void hideControls() {
        topBar.animate().cancel();
        isControlsVisible = false;
        if (infoBar != null) {
            infoBar.animate().cancel();
            infoBar.animate().alpha(0.0f).setDuration(300).withEndAction(() -> infoBar.setVisibility(View.GONE)).start();
        }
        topBar.animate().alpha(0.0f).setDuration(300).withEndAction(() -> {
            topBar.setVisibility(View.GONE);
            hideSystemUI();
        }).start();
    }

    private void scheduleHideControls() {
        if (vod) return;
        hideHandler.removeCallbacksAndMessages(null);
        // Le bandeau du programme reste un peu plus longtemps : il se lit.
        hideHandler.postDelayed(hideControlsRunnable, 5000);
    }

    /** Masquage différé : tant que la télécommande sélectionne un bouton de la barre, les
     *  commandes restent affichées (reprogrammation au lieu d'un masquage en pleine navigation). */
    private final Runnable hideControlsRunnable = new Runnable() {
        @Override public void run() {
            if (topBar != null && topBar.findFocus() != null) { hideHandler.postDelayed(this, 5000); return; }
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
            if (vod && playerView != null) playerView.setControllerShowTimeoutMs(hasFocus ? 0 : 3500);
        });
        // Réapplique l'état courant : REC restylé alors qu'il a le focus (lancement au OK)
        // capturait sinon la couleur inversée sombre comme « normale » — texte sombre sur
        // fond sombre dès que la sélection repart. Couleur normale explicite, jamais lue.
        button.setTextColor(button.isFocused() ? C_BG : normalText);
    }

    private Button toolbarButton(String label, String description, int widthDp, int color, int focusBg, int normalText) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(label.length() > 2 ? 12 : 16);
        b.setTextColor(normalText);
        b.setContentDescription(description);
        styleFocusable(b, color, focusBg, normalText);
        sizeToolbarButton(b, widthDp);
        ((LinearLayout.LayoutParams) b.getLayoutParams()).setMargins(dp(6), 0, 0, 0);
        return b;
    }

    private void updatePreviousButton() {
        if (btnPrevious == null) return;
        boolean available = previousIndex >= 0 && previousIndex != channelIndex;
        btnPrevious.setEnabled(available);
        btnPrevious.setAlpha(available ? 1f : 0.35f);
    }

    // ── Bandeau du programme (direct) ────────────────────────────────

    private void buildInfoBar(FrameLayout root) {
        infoBar = new LinearLayout(this);
        infoBar.setOrientation(LinearLayout.VERTICAL);
        infoBar.setPadding(dp(20), dp(36), dp(20), dp(18));
        infoBar.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP,
            new int[] { Color.parseColor("#F00B0B0D"), Color.parseColor("#B30B0B0D"), Color.TRANSPARENT }));

        infoChannel = new TextView(this);
        infoChannel.setTextSize(12);
        infoChannel.setTextColor(C_MUTED);
        infoChannel.setSingleLine(true);
        infoChannel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        infoChannel.setLetterSpacing(0.04f);
        infoBar.addView(infoChannel);

        infoNow = new TextView(this);
        infoNow.setTextSize(19);
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            infoProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(C_ACCENT));
            infoProgress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#40F3F1ED")));
        }
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(120), dp(4));
        progressParams.setMargins(0, 0, dp(10), 0);
        infoTimeRow.addView(infoProgress, progressParams);
        infoTimes = new TextView(this);
        infoTimes.setTextSize(12);
        infoTimes.setTextColor(C_MUTED);
        infoTimes.setTypeface(Typeface.MONOSPACE);
        infoTimes.setSingleLine(true);
        infoTimeRow.addView(infoTimes);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowParams.setMargins(0, dp(8), 0, 0);
        infoBar.addView(infoTimeRow, rowParams);

        infoNext = new TextView(this);
        infoNext.setTextSize(13);
        infoNext.setTextColor(C_DIM);
        infoNext.setSingleLine(true);
        infoNext.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams nextParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nextParams.setMargins(0, dp(6), 0, 0);
        infoBar.addView(infoNext, nextParams);

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
        if (infoBar == null) return;
        long now = System.currentTimeMillis();
        String group = channelGroups != null && channelIndex >= 0 && channelIndex < channelGroups.size() ? channelGroups.get(channelIndex) : "";
        String number = numberAt(channelIndex);
        String head = "●  DIRECT  ·  " + (number.isEmpty() ? "" : number + "  ") + streamTitle + (group.isEmpty() ? "" : "  ·  " + group);
        SpannableString label = new SpannableString(head);
        label.setSpan(new ForegroundColorSpan(C_LIVE), 0, 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        infoChannel.setText(label);

        int current = currentProgramIndex(channelIndex, now);
        JSONArray p = current >= 0 ? programAt(channelIndex, current) : null;
        if (p != null) {
            long start = p.optLong(0), end = p.optLong(1);
            infoNow.setText(p.optString(2, streamTitle));
            infoProgress.setProgress((int) Math.max(0, Math.min(1000, (now - start) * 1000 / Math.max(1, end - start))));
            long remaining = Math.max(0, (end - now + 59_999) / 60_000);
            infoTimes.setText(hour(start) + " – " + hour(end) + "  ·  reste " + formatMinutes(remaining));
            infoTimeRow.setVisibility(View.VISIBLE);
        } else {
            infoNow.setText(streamTitle);
            infoTimeRow.setVisibility(View.GONE);
        }
        JSONArray next = nextProgram(channelIndex, now);
        if (next != null) {
            infoNext.setText("Ensuite  " + hour(next.optLong(0)) + "  ·  " + next.optString(2, ""));
            infoNext.setVisibility(View.VISIBLE);
        } else if (p == null && channelPrograms != null) {
            infoNext.setText("Pas de guide pour cette chaîne");
            infoNext.setVisibility(View.VISIBLE);
        } else {
            infoNext.setVisibility(View.GONE);
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
        title.setText("Chaînes");
        title.setTextSize(22);
        title.setTextColor(C_TEXT);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button close = new Button(this);
        close.setText("✕");
        close.setTextSize(15);
        close.setTextColor(C_MUTED);
        close.setContentDescription("Fermer la liste des chaînes");
        close.setOnClickListener(v -> closeChannelPanel());
        sizeToolbarButton(close, 44);
        close.setTextColor(C_MUTED);
        styleFocusable(close, C_CARD, C_ACCENT, C_MUTED);
        header.addView(close, new LinearLayout.LayoutParams(dp(44), dp(44)));
        channelSheet.addView(header);

        // Filtres par groupe, dans l'ordre de la liste.
        ArrayList<String> groups = new ArrayList<>();
        if (channelGroups != null) for (String g : channelGroups) if (!g.isEmpty() && !groups.contains(g)) groups.add(g);
        if (groups.size() > 1) {
            HorizontalScrollView chipsScroll = new HorizontalScrollView(this);
            chipsScroll.setHorizontalScrollBarEnabled(false);
            groupChips = new LinearLayout(this);
            groupChips.setOrientation(LinearLayout.HORIZONTAL);
            groupChips.setPadding(dp(16), dp(4), dp(16), dp(10));
            groupChips.addView(groupChip("Toutes", null));
            for (String g : groups) groupChips.addView(groupChip(g, g));
            chipsScroll.addView(groupChips);
            channelSheet.addView(chipsScroll);
        }

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
            closeChannelPanel();
            if (target != channelIndex) switchTo(target);
        });
        channelSheet.addView(channelListView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        int width = Math.min(dp(380), (int) (getResources().getDisplayMetrics().widthPixels * 0.86f));
        channelPanel.addView(channelSheet, new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.START));
        root.addView(channelPanel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private Button groupChip(String label, String group) {
        Button chip = new Button(this);
        chip.setText(label);
        chip.setAllCaps(false);
        chip.setTextSize(13);
        chip.setSingleLine(true);
        chip.setMinWidth(0); chip.setMinimumWidth(0); chip.setMinHeight(0); chip.setMinimumHeight(0);
        chip.setPadding(dp(14), 0, dp(14), 0);
        chip.setTag(group == null ? "" : group);
        chip.setOnClickListener(v -> {
            panelGroup = group;
            refreshGroupChips();
            channelAdapter.rebuild();
            channelListView.setSelection(Math.max(0, channelAdapter.positionOf(channelIndex)));
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36));
        params.setMargins(0, 0, dp(8), 0);
        chip.setLayoutParams(params);
        styleChip(chip, group == null ? panelGroup == null : group.equals(panelGroup));
        return chip;
    }

    private void styleChip(Button chip, boolean active) {
        GradientDrawable bg = rounded(active ? C_TEXT : Color.TRANSPARENT, 18);
        if (!active) bg.setStroke(dp(1), Color.parseColor("#26F3F1ED"));
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] { android.R.attr.state_focused }, rounded(C_ACCENT, 18));
        states.addState(new int[] { android.R.attr.state_pressed }, rounded(C_ACCENT, 18));
        states.addState(new int[] {}, bg);
        chip.setBackground(states);
        final int normalText = active ? C_BG : Color.parseColor("#C9C5BE");
        // Chip resstylé pendant qu'il a le focus (sélection au OK → refreshGroupChips) :
        // garder l'inversion sombre tant que le fond ambré de sélection est affiché.
        chip.setTextColor(chip.isFocused() ? C_BG : normalText);
        chip.setOnFocusChangeListener((v, hasFocus) -> chip.setTextColor(hasFocus ? C_BG : normalText));
    }

    private void refreshGroupChips() {
        if (groupChips == null) return;
        for (int i = 0; i < groupChips.getChildCount(); i++) {
            Button chip = (Button) groupChips.getChildAt(i);
            String tag = (String) chip.getTag();
            styleChip(chip, panelGroup == null ? tag.isEmpty() : tag.equals(panelGroup));
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
        panelGroup = groupChips != null && !group.isEmpty() ? group : null;
        refreshGroupChips();
        channelAdapter.rebuild();
        channelPanel.setVisibility(View.VISIBLE);
        channelSheet.setTranslationX(-channelSheet.getLayoutParams().width);
        channelSheet.animate().translationX(0).setDuration(180).start();
        int position = channelAdapter.positionOf(channelIndex);
        channelListView.setSelection(Math.max(0, position - 2));
        channelListView.requestFocus();
        startPanelFrameSampling();
    }

    private void closeChannelPanel() {
        if (!isChannelPanelOpen()) return;
        stopPanelFrameSampling();
        channelSheet.animate().translationX(-channelSheet.getWidth()).setDuration(150)
            .withEndAction(() -> { channelPanel.setVisibility(View.GONE); hideSystemUI(); }).start();
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
        private final ArrayList<Integer> visible = new ArrayList<>();

        ChannelPanelAdapter() { rebuild(); }

        void rebuild() {
            visible.clear();
            if (channelUrls != null) {
                for (int i = 0; i < channelUrls.size(); i++) {
                    if (panelGroup == null || (channelGroups != null && panelGroup.equals(channelGroups.get(i)))) visible.add(i);
                }
            }
            notifyDataSetChanged();
        }

        int channelAt(int position) { return visible.get(position); }
        int positionOf(int channel) { return visible.indexOf(channel); }

        @Override public int getCount() { return visible.size(); }
        @Override public Object getItem(int position) { return visible.get(position); }
        @Override public long getItemId(int position) { return visible.get(position); }

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
            int channel = visible.get(position);
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
            playerView.setUseController(vod && !isInPictureInPictureMode);
            if (isInPictureInPictureMode) playerView.hideController();
        }
        if (isInPictureInPictureMode) {
            hideHandler.removeCallbacksAndMessages(null);
            if (channelPanel != null) channelPanel.setVisibility(View.GONE);
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
            if (!isControlsVisible && !isChannelPanelOpen()) {
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
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                BUFFER_MIN_MS,
                BUFFER_MAX_MS,
                vod ? VOD_BUFFER_FOR_PLAYBACK_MS : LIVE_BUFFER_FOR_PLAYBACK_MS,  // avant la première image
                vod ? VOD_BUFFER_FOR_REBUFFER_MS : LIVE_BUFFER_FOR_REBUFFER_MS   // avant la reprise après coupure
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();

        DefaultHttpDataSource.Factory httpDataSourceFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent("IPTVSmartersPro")
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true);

        // Le DataSource par défaut délègue le HTTP au DataSource HTTP ci-dessus et
        // sait aussi lire content:// (clé USB/SD via SAF) et file:// (sous-titres).
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpDataSourceFactory);
        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(dataSourceFactory);

        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build();

        playerView.setPlayer(player);
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
                }
                updateMediaSessionState();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updateMediaSessionState();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                progressHandler.removeCallbacks(autoRetryRunnable);
                errorCount++;
                lastErrorCode = String.valueOf(error.errorCode);
                loadingBar.setVisibility(View.GONE);
                String cause = describeError(error);
                // Coupure réseau ou serveur surchargé : quelques reprises espacées avant d'abandonner.
                if (autoRetriesLeft > 0 && isTransientError(error)) {
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
        });

        player.setMediaItem(buildMediaItem(url));
        if (vod && positionMs > 0) player.seekTo(positionMs);
        player.prepare();
        player.setPlayWhenReady(playWhenReady);
        if (mediaSession != null) { mediaSession.setActive(true); updateMediaSessionState(); }
        if (vod) { progressHandler.removeCallbacksAndMessages(null); progressHandler.postDelayed(checkpoint, 5000); }
    }

    /** Change de média sur le lecteur existant : pas de recréation de codecs, zapping plus court. */
    private void prepareMedia(String url) {
        if (player == null || playerView == null) { initPlayer(url); return; }
        // Une interruption ouverte appartient au média quitté : la clôturer ici, sinon son
        // chronomètre déborderait sur le chargement puis la lecture de la chaîne suivante.
        rebuffer.close();
        zapStartedAtMs = SystemClock.elapsedRealtime();
        firstFrameLogged = false;
        hideError();
        loadingBar.setVisibility(View.VISIBLE);
        player.setMediaItem(buildMediaItem(url));
        if (vod && positionMs > 0) player.seekTo(positionMs);
        player.prepare();
        player.setPlayWhenReady(playWhenReady);
        if (vod) { progressHandler.removeCallbacksAndMessages(null); progressHandler.postDelayed(checkpoint, 5000); }
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
        int code = error.errorCode;
        if (code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
            || code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW
            || code == PlaybackException.ERROR_CODE_TIMEOUT) return true;
        if (code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) {
            int status = httpStatusOf(error);
            return status >= 500 && status < 600;
        }
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
        showControls();
    }

    private void hideError() {
        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
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

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        hideSystemUI();
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
        resumed = false;
        // En petite fenêtre, l'activity est en pause mais la vidéo doit continuer.
        if (isInPipMode()) return;
        cancelNextEpisode();
        // Pendant un cast, le lecteur local est déjà arrêté et le téléviseur prend le relais.
        if (casting) return;
        // Foreground-only live playback: close network and codec resources immédiatement.
        releasePlayer();
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Fenêtre PiP fermée par l'utilisateur : on quitte le lecteur.
        if (pipActive) { pipActive = false; releasePlayer(); finish(); return; }
        releasePlayer();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        numberHandler.removeCallbacksAndMessages(null);
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
        state.putInt("previousIndex", previousIndex);
        state.putLong("positionMs", positionMs);
        state.putBoolean("playWhenReady", playWhenReady);
        state.putString("mediaId", mediaId);
        state.putString("visitedProgress", new JSONArray(visitedProgress.values()).toString());
        super.onSaveInstanceState(state);
    }

    @Override public void finish() {
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
            @Override public void onPlay() { if (player != null) player.play(); }
            @Override public void onPause() { if (player != null) player.pause(); }
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
        btnRec.setText(recording ? "■" : "REC");
        styleFocusable(btnRec, recording ? C_LIVE : C_TRACK, C_ACCENT, Color.WHITE);
    }


    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideSystemUI();
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
        nextEpisodeDeadline = SystemClock.elapsedRealtime() + 8000;
        nextEpisodePanel.setVisibility(View.VISIBLE);
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
        if (value == null) return "";
        String trimmed = value.trim();
        if (!trimmed.matches("\\d+")) return trimmed;
        String stripped = trimmed.replaceFirst("^0+", "");
        return stripped.isEmpty() ? "0" : stripped;
    }

    private String numberAt(int index) {
        if (channelNumbers == null || index < 0 || index >= channelNumbers.size()) return "";
        return channelNumbers.get(index).trim();
    }

    private int indexOfNumber(String typed) {
        if (channelNumbers == null || typed.isEmpty()) return -1;
        for (int i = 0; i < channelNumbers.size(); i++) {
            if (typed.equals(normalizeNumber(channelNumbers.get(i)))) return i;
        }
        return -1;
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
        if (numberBuffer.length() >= 5) numberBuffer.setLength(0);
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
        numberBuffer.setLength(0);
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

    /** Abandonne la saisie en cours : sans ça, le délai de validation survit à Home et
     *  change de chaîne (ou recrée le lecteur) alors que l'activité n'est plus visible. */
    private void cancelNumberEntry() {
        numberBuffer.setLength(0);
        numberHandler.removeCallbacksAndMessages(null);
        hideNumberOverlay();
    }

    @Override
    public void onBackPressed() {
        if (numberBuffer.length() > 0) { cancelNumberEntry(); return; }
        if (nextEpisodePanel != null && nextEpisodePanel.getVisibility() == View.VISIBLE) { cancelNextEpisode(); return; }
        if (isChannelPanelOpen()) { closeChannelPanel(); return; }
        // Retour ferme d'abord les commandes (direct) ou le contrôleur (VOD) avant de quitter.
        if (isControlsVisible || (vod && playerView != null && playerView.isControllerFullyVisible())) {
            if (vod && playerView != null && playerView.isControllerFullyVisible()) playerView.hideController();
            hideControls();
            return;
        }
        super.onBackPressed();
    }

    private void releasePlayer() {
        // Lecteur libéré (arrière-plan, erreur, destruction) : une interruption ouverte ne peut
        // plus se terminer normalement ; la clôturer pour ne pas gonfler une session ultérieure.
        rebuffer.close();
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

    private static class AudioTrackOption {
        final Tracks.Group group;
        final int trackIndex;
        final String label;
        final boolean isSelected;

        AudioTrackOption(Tracks.Group group, int trackIndex, String label, boolean isSelected) {
            this.group = group;
            this.trackIndex = trackIndex;
            this.label = label;
            this.isSelected = isSelected;
        }
    }

    private void showAudioTrackDialog() {
        if (player == null) return;
        Tracks tracks = player.getCurrentTracks();
        List<AudioTrackOption> options = new ArrayList<>();

        options.add(new AudioTrackOption(null, -1, "Automatique (Français prioritaire)", false));

        int selectedOptionIndex = 0;
        int trackCounter = 1;

        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() == C.TRACK_TYPE_AUDIO) {
                for (int i = 0; i < group.length; i++) {
                    Format format = group.getTrackFormat(i);
                    boolean isSelected = group.isTrackSelected(i);
                    String label = formatAudioTrackLabel(format, trackCounter++);
                    AudioTrackOption opt = new AudioTrackOption(group, i, label, isSelected);
                    options.add(opt);
                    if (isSelected) {
                        selectedOptionIndex = options.size() - 1;
                    }
                }
            }
        }

        if (options.size() <= 1) {
            Toast.makeText(this, "Une seule piste audio disponible sur ce flux", Toast.LENGTH_SHORT).show();
            return;
        }

        String[] items = new String[options.size()];
        for (int i = 0; i < options.size(); i++) {
            AudioTrackOption opt = options.get(i);
            items[i] = opt.label + (opt.isSelected ? "  ✓" : "");
        }

        // Le dialog fait partie de l'utilisation des commandes : pas de masquage pendant.
        hideHandler.removeCallbacksAndMessages(null);
        new AlertDialog.Builder(this)
            .setTitle("Piste audio (langue)")
            .setSingleChoiceItems(items, selectedOptionIndex, (dialog, which) -> {
                dialog.dismiss();
                if (which == 0) {
                    player.setTrackSelectionParameters(
                        player.getTrackSelectionParameters().buildUpon()
                            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                            .setPreferredAudioLanguage("fra")
                            .build()
                    );
                    Toast.makeText(this, "Audio : Automatique (Français prioritaire)", Toast.LENGTH_SHORT).show();
                } else {
                    AudioTrackOption chosen = options.get(which);
                    TrackSelectionOverride override = new TrackSelectionOverride(
                        chosen.group.getMediaTrackGroup(),
                        Collections.singletonList(chosen.trackIndex)
                    );
                    player.setTrackSelectionParameters(
                        player.getTrackSelectionParameters().buildUpon()
                            .setOverrideForType(override)
                            .build()
                    );
                    Toast.makeText(this, "Audio : " + chosen.label, Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton("Fermer", null)
            .setOnDismissListener(dialog -> scheduleHideControls())
            .show();
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
        String label = deltaMs > 0 ? "⏩  +10 s" : "⏪  -10 s";
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


    private void showSleepTimerDialog() {
        final String[] options;
        if (vod) {
            options = new String[] {
                "15 minutes",
                "30 minutes",
                "45 minutes",
                "60 minutes",
                "90 minutes",
                "Fin de la vidéo",
                "Désactiver le minuteur"
            };
        } else {
            options = new String[] {
                "15 minutes",
                "30 minutes",
                "45 minutes",
                "60 minutes",
                "90 minutes",
                "Désactiver le minuteur"
            };
        }

        // Le dialog fait partie de l'utilisation des commandes : pas de masquage pendant.
        hideHandler.removeCallbacksAndMessages(null);
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Minuteur de mise en veille");
        builder.setItems(options, (dialog, which) -> {
            String selected = options[which];
            if ("Désactiver le minuteur".equals(selected)) {
                cancelSleepTimer();
                Toast.makeText(this, "Minuteur de veille désactivé", Toast.LENGTH_SHORT).show();
            } else if ("Fin de la vidéo".equals(selected)) {
                cancelSleepTimer();
                sleepOnEnd = true;
                if (btnSleep != null) {
                    btnSleep.setText("🌙 Fin");
                    styleFocusable(btnSleep, C_ACCENT, Color.WHITE, Color.WHITE);
                }
                Toast.makeText(this, "Arrêt prévu à la fin de la vidéo", Toast.LENGTH_SHORT).show();
            } else {
                int minutes = 15;
                if (selected.startsWith("30")) minutes = 30;
                else if (selected.startsWith("45")) minutes = 45;
                else if (selected.startsWith("60")) minutes = 60;
                else if (selected.startsWith("90")) minutes = 90;
                startSleepTimer(minutes);
            }
        });
        builder.setNegativeButton("Annuler", null);
        builder.setOnDismissListener(dialog -> scheduleHideControls());
        builder.show();
    }

    private void startSleepTimer(int minutes) {
        cancelSleepTimer();
        sleepTargetTimeMs = android.os.SystemClock.elapsedRealtime() + (minutes * 60_000L);
        sleepOnEnd = false;
        if (btnSleep != null) {
            styleFocusable(btnSleep, C_ACCENT, Color.WHITE, Color.WHITE);
            btnSleep.setText("🌙 " + minutes + "m");
        }
        Toast.makeText(this, "Mise en veille dans " + minutes + " min", Toast.LENGTH_SHORT).show();

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

}
