package com.lecteur.iptv;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Outline;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

/**
 * Aperçu vidéo de l'écran Direct TV : un petit lecteur posé au-dessus de la WebView,
 * à l'emplacement réservé par la page. Il ne prend jamais le focus (la télécommande reste à la page).
 * Toutes les méthodes s'appellent sur le fil principal.
 */
@OptIn(markerClass = UnstableApi.class)
final class LivePreview {
    interface Listener { void onState(String state); }

    private final Activity activity;
    private final View webView;
    private final Listener listener;

    private FrameLayout box;
    private TextureView texture;
    private ExoPlayer player;
    private final PreviewRequestTracker requests = new PreviewRequestTracker();
    /** Flux en cours de lecture dans le lecteur. */
    private String playingUrl;
    private int videoWidth;
    private int videoHeight;

    /** Dernière demande de la page, rejouée au retour dans l'application. */
    private String requestUrl;
    private float[] rect;

    LivePreview(Activity activity, View webView, Listener listener) {
        this.activity = activity;
        this.webView = webView;
        this.listener = listener;
    }

    /** Position et taille en pixels CSS de la page ; dpr = rapport pixels écran / CSS. */
    void show(String url, float x, float y, float width, float height, float radius, float dpr) {
        requestUrl = url;
        rect = new float[] { x, y, width, height, radius, dpr };
        start();
    }

    /** Arrête le flux (la connexion au fournisseur se ferme) sans détruire le lecteur. */
    void stop() {
        requests.cancel();
        requestUrl = null;
        playingUrl = null;
        if (player != null) { player.stop(); player.clearMediaItems(); }
        if (box != null) box.setAlpha(0f);
    }

    /** Ferme tout : écran quitté ou aperçu désactivé. */
    void hide() {
        requestUrl = null;
        release();
    }

    /** Application en arrière-plan ou lecteur plein écran ouvert : libérer le flux, garder la demande. */
    void pause() { release(); }

    void resume() { if (requestUrl != null) start(); }

    private void start() {
        ViewGroup content = activity.findViewById(android.R.id.content);
        if (content == null || requestUrl == null || rect == null) return;
        float scale = rect[5] > 0 ? rect[5] : activity.getResources().getDisplayMetrics().density;
        int[] web = new int[2];
        int[] root = new int[2];
        webView.getLocationInWindow(web);
        content.getLocationInWindow(root);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            Math.max(1, Math.round(rect[2] * scale)), Math.max(1, Math.round(rect[3] * scale)), Gravity.TOP | Gravity.START);
        params.leftMargin = web[0] - root[0] + Math.round(rect[0] * scale);
        params.topMargin = web[1] - root[1] + Math.round(rect[1] * scale);
        final float radius = rect[4] * scale;

        if (box == null) {
            box = new FrameLayout(activity);
            box.setBackgroundColor(Color.BLACK);
            box.setFocusable(false);
            box.setClickable(false);
            box.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            box.setClipToOutline(true);
            box.setAlpha(0f);
            texture = new TextureView(activity);
            box.addView(texture, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
            content.addView(box, params);
        } else {
            box.setLayoutParams(params);
        }
        box.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            }
        });
        box.invalidateOutline();
        fitVideo();

        if (player != null && requestUrl.equals(playingUrl)) return;
        box.setAlpha(0f);
        videoWidth = 0;
        videoHeight = 0;
        if (player == null) createPlayer();
        playingUrl = requestUrl;
        final long request = requests.begin();
        final ExoPlayer requestedPlayer = player;
        listener.onState("loading");
        if (Stalker.is(requestUrl)) {
            // Portail Stalker : lien de lecture demandé au portail, ignoré si l'aperçu a changé de chaîne.
            Stalker.resolveAsync(activity, requestUrl, resolved -> {
                // Une ancienne réponse reste périmée même après un retour sur la même chaîne.
                if (!requests.isCurrent(request) || player != requestedPlayer) return;
                if (resolved == null) { listener.onState("error"); return; }
                player.setMediaItem(MediaItem.fromUri(resolved));
                player.prepare();
                player.play();
            });
            return;
        }
        player.setMediaItem(MediaItem.fromUri(playingUrl));
        player.prepare();
        player.play();
    }

    private void createPlayer() {
        DefaultLoadControl load = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(3_000, 10_000, 1_000, 2_000)
            .build();
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent(PlayerOptions.userAgent(activity))
            .setConnectTimeoutMs(10_000)
            .setReadTimeoutMs(10_000)
            .setAllowCrossProtocolRedirects(true);
        final ExoPlayer created = new ExoPlayer.Builder(activity, PlayerOptions.renderers(activity))
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
            .setLoadControl(load)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build();
        created.setVideoTextureView(texture);
        // Résolution plafonnée en SD pour l'aperçu : inutile de décoder du 1080p/4K dans quelques
        // centaines de pixels. Media3 choisit la variante la plus proche si le flux en propose
        // plusieurs ; mono-variante, le flux reste décodé tel quel.
        created.setTrackSelectionParameters(created.getTrackSelectionParameters().buildUpon()
            .setMaxVideoSizeSd()
            .build());
        created.addListener(new Player.Listener() {
            @Override public void onRenderedFirstFrame() {
                if (player != created || box == null) return;
                box.setAlpha(1f);
                listener.onState("playing");
            }
            @Override public void onVideoSizeChanged(VideoSize size) {
                if (player != created || size.width <= 0 || size.height <= 0) return;
                videoWidth = Math.round(size.width * (size.pixelWidthHeightRatio > 0 ? size.pixelWidthHeightRatio : 1f));
                videoHeight = size.height;
                fitVideo();
            }
            @Override public void onPlayerError(PlaybackException error) {
                if (player != created) return;
                android.util.Log.w("IPTV-Preview", "error=" + error.errorCode);
                requestUrl = null;
                release();
                listener.onState("error");
            }
        });
        player = created;
    }

    /** Image entière dans le cadre, bandes noires si le format diffère. */
    private void fitVideo() {
        if (box == null || texture == null) return;
        ViewGroup.LayoutParams outer = box.getLayoutParams();
        int width = outer.width, height = outer.height;
        if (videoWidth <= 0 || videoHeight <= 0 || width <= 0 || height <= 0) {
            texture.setLayoutParams(new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
            return;
        }
        float ratio = videoWidth / (float) videoHeight;
        int w = width, h = height;
        if (width / (float) height > ratio) w = Math.round(height * ratio);
        else h = Math.round(width / ratio);
        texture.setLayoutParams(new FrameLayout.LayoutParams(w, h, Gravity.CENTER));
    }

    private void release() {
        requests.cancel();
        ExoPlayer old = player;
        player = null;
        playingUrl = null;
        if (old != null) old.release();
        if (box != null) {
            ViewGroup parent = (ViewGroup) box.getParent();
            if (parent != null) parent.removeView(box);
        }
        box = null;
        texture = null;
    }
}
