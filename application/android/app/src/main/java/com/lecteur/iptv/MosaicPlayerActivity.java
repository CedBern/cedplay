package com.lecteur.iptv;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;

@UnstableApi
public class MosaicPlayerActivity extends AppCompatActivity {
    private ArrayList<String> urls;
    private ArrayList<String> titles;
    private final ArrayList<Tile> tiles = new ArrayList<>();
    private int selected = 0;
    private boolean expanded = false;
    private boolean resumed = false;
    private GridLayout grid;
    private TextView status;
    private Button expandButton;
    private LinearLayout toolbar;
    private final Handler handler = new Handler(Looper.getMainLooper());
    /** Démarrages décalés des tuiles : le handler des contrôles fait removeCallbacksAndMessages(null) et annulerait les démarrages en attente. */
    private final Handler startHandler = new Handler(Looper.getMainLooper());

    private static class Tile {
        FrameLayout root;
        PlayerView view;
        TextView label;
        ProgressBar loading;
        Button retry;
        ExoPlayer player;
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        urls = getIntent().getStringArrayListExtra("urls");
        titles = getIntent().getStringArrayListExtra("titles");
        if (urls == null || titles == null || urls.size() < 2 || urls.size() > 8 || titles.size() != urls.size()) { finish(); return; }
        if (state != null) { selected = Math.min(urls.size() - 1, Math.max(0, state.getInt("selected"))); expanded = state.getBoolean("expanded"); }
        buildUI();
        hideSystemUI();
    }

    private void buildUI() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        grid = new GridLayout(this);
        root.addView(grid, new FrameLayout.LayoutParams(-1, -1));
        for (int i = 0; i < urls.size(); i++) {
            final int index = i;
            Tile tile = new Tile();
            tile.root = new FrameLayout(this);
            tile.root.setPadding(dp(3), dp(3), dp(3), dp(3));
            tile.view = new PlayerView(this);
            tile.view.setUseController(false);
            tile.view.setKeepContentOnPlayerReset(false);
            tile.root.addView(tile.view, new FrameLayout.LayoutParams(-1, -1));
            tile.loading = new ProgressBar(this);
            FrameLayout.LayoutParams spinner = new FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER);
            tile.root.addView(tile.loading, spinner);
            tile.label = new TextView(this);
            tile.label.setTextColor(Color.WHITE); tile.label.setTextSize(11);
            tile.label.setSingleLine(true); tile.label.setPadding(dp(8), dp(4), dp(8), dp(4));
            tile.label.setBackgroundColor(0xBB0F172A);
            tile.root.addView(tile.label, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
            tile.retry = new Button(this); tile.retry.setText("Réessayer"); tile.retry.setTextSize(11);
            tile.retry.setVisibility(View.GONE);
            tile.root.addView(tile.retry, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
            tile.retry.setOnClickListener(v -> { if (resumed) { release(tile); start(index); } });
            tile.view.setOnClickListener(v -> select(index));
            tile.root.setOnClickListener(v -> select(index));
            tiles.add(tile);
        }
        toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(0xDD0F172A); toolbar.setPadding(dp(6), 0, dp(6), 0);
        Button back = button("←", v -> finish()); back.setContentDescription("Retour aux chaînes"); toolbar.addView(back);
        status = new TextView(this); status.setTextColor(Color.WHITE); status.setTextSize(12); status.setSingleLine(true);
        toolbar.addView(status, new LinearLayout.LayoutParams(0, -2, 1));
        expandButton = button("Agrandir", v -> { expanded = !expanded; layoutTiles(); showControls(); });
        toolbar.addView(expandButton);
        root.addView(toolbar, new FrameLayout.LayoutParams(-1, dp(48), Gravity.TOP));
        setContentView(root); layoutTiles(); showControls();
    }

    private Button button(String title, View.OnClickListener listener) {
        Button button = new Button(this); button.setText(title); button.setTextSize(11); button.setTextColor(Color.WHITE);
        button.setBackgroundColor(Color.TRANSPARENT); button.setOnClickListener(listener); return button;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void layoutTiles() {
        grid.removeAllViews();
        int count = expanded ? 1 : tiles.size();
        int columns = count <= 2 ? count : count <= 4 ? 2 : count <= 6 ? 3 : 4;
        int rows = (count + columns - 1) / columns;
        grid.setColumnCount(columns); grid.setRowCount(rows);
        int slot = 0;
        for (int i = 0; i < tiles.size(); i++) {
            Tile tile = tiles.get(i);
            if (expanded && i != selected) { tile.view.setVisibility(View.INVISIBLE); continue; }
            tile.view.setVisibility(View.VISIBLE);
            GridLayout.LayoutParams params = new GridLayout.LayoutParams(GridLayout.spec(slot / columns, 1f), GridLayout.spec(slot % columns, 1f));
            params.width = 0; params.height = 0;
            grid.addView(tile.root, params); slot++;
        }
        updateSelection();
        expandButton.setText(expanded ? "Grille" : "Agrandir");
    }

    private void select(int index) {
        selected = index;
        updateSelection(); showControls();
    }
    private void updateSelection() {
        for (int i = 0; i < tiles.size(); i++) {
            Tile tile = tiles.get(i); boolean audible = i == selected;
            tile.label.setText((audible ? "● Son · " : "") + titles.get(i));
            GradientDrawable border = new GradientDrawable(); border.setColor(Color.BLACK);
            border.setStroke(dp(audible ? 3 : 1), audible ? Color.rgb(168, 85, 247) : Color.rgb(30, 41, 59));
            tile.root.setBackground(border);
        }
        // Relinquish focus before the newly selected player requests it.
        for (int i = 0; i < tiles.size(); i++) if (i != selected) audio(tiles.get(i), false);
        audio(tiles.get(selected), true);
        status.setText(urls.size() + " chaînes · Son : " + titles.get(selected));
    }
    private void audio(Tile tile, boolean audible) {
        if (tile.player == null) return;
        tile.player.setAudioAttributes(AudioAttributes.DEFAULT, audible);
        tile.player.setVolume(audible ? 1f : 0f);
        tile.player.setTrackSelectionParameters(tile.player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, !audible).build());
    }

    private void start(int index) {
        Tile tile = tiles.get(index);
        if (!resumed || tile.player != null) return;
        tile.retry.setVisibility(View.GONE); tile.loading.setVisibility(View.VISIBLE);
        try {
            DefaultLoadControl load = new DefaultLoadControl.Builder().setBufferDurationsMs(5000, 15000, 1500, 3000).setTargetBufferBytes(8 * 1024 * 1024).setPrioritizeTimeOverSizeThresholds(false).build();
            DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory().setUserAgent("IPTVSmartersPro").setConnectTimeoutMs(15000).setReadTimeoutMs(15000).setAllowCrossProtocolRedirects(true);
            ExoPlayer player = new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(http)).setLoadControl(load).setHandleAudioBecomingNoisy(true).build();
            tile.player = player; tile.view.setPlayer(player); audio(tile, index == selected);
            player.addListener(new Player.Listener() {
                @Override public void onPlaybackStateChanged(int state) {
                    if (tile.player != player) return;
                    tile.loading.setVisibility(state == Player.STATE_BUFFERING ? View.VISIBLE : View.GONE);
                    if (state == Player.STATE_READY) android.util.Log.i("IPTVMosaic", "tile=" + index + " ready");
                }
                @Override public void onRenderedFirstFrame() { android.util.Log.i("IPTVMosaic", "tile=" + index + " first-frame"); }
                @Override public void onPlayerError(PlaybackException error) {
                    if (tile.player != player) return;
                    // Nom d'erreur lisible pour le protocole box : 1xxx générique/timeout,
                    // 2xxx I/O (réseau OU statut HTTP), 3xxx analyse du flux, 4xxx décodeur.
                    // Le statut HTTP (403/404/503…) précise un refus du fournisseur.
                    // Jamais d'URL : les chemins de flux contiennent les identifiants du compte.
                    int httpStatus = httpStatusOf(error);
                    android.util.Log.w("IPTVMosaic", "tile=" + index + " error=" + error.getErrorCodeName()
                            + " (" + error.errorCode + ")" + (httpStatus > 0 ? " http=" + httpStatus : ""));
                    release(tile); tile.loading.setVisibility(View.GONE); tile.retry.setVisibility(View.VISIBLE);
                }
            });
            player.setMediaItem(MediaItem.fromUri(urls.get(index))); player.prepare(); player.play();
        } catch (RuntimeException error) {
            release(tile); tile.loading.setVisibility(View.GONE); tile.retry.setVisibility(View.VISIBLE);
        }
    }
    private void release(Tile tile) {
        ExoPlayer player = tile.player; tile.player = null; tile.view.setPlayer(null);
        if (player != null) player.release();
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
    private void releaseAll() { handler.removeCallbacksAndMessages(null); startHandler.removeCallbacksAndMessages(null); for (Tile tile : tiles) release(tile); }
    private void showControls() {
        toolbar.setVisibility(View.VISIBLE); handler.removeCallbacksAndMessages(null);
        handler.postDelayed(() -> { toolbar.setVisibility(View.GONE); hideSystemUI(); }, 5000);
    }
    private void hideSystemUI() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller != null) { controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars()); controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); }
        } else getWindow().getDecorView().setSystemUiVisibility(5894);
    }
    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if (hasFocus) hideSystemUI(); }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        // Ouvertures décalées : une rafale de connexions à la seconde peut déclencher
        // l'anti-flood du panneau Xtream, qui refuse alors les flux surnuméraires.
        for (int i = 0; i < tiles.size(); i++) {
            final int index = i;
            startHandler.postDelayed(() -> start(index), index * 250L);
        }
        hideSystemUI();
    }
    @Override protected void onPause() { resumed = false; releaseAll(); super.onPause(); }
    @Override protected void onDestroy() { releaseAll(); super.onDestroy(); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putInt("selected", selected); state.putBoolean("expanded", expanded); super.onSaveInstanceState(state); }
    @Override public void onBackPressed() { if (expanded) { expanded = false; layoutTiles(); showControls(); } else super.onBackPressed(); }
}
