package com.lecteur.iptv;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.Display;
import android.view.WindowManager;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;

import java.util.ArrayList;
import java.util.List;

/**
 * Réglages du lecteur choisis dans l'application (User-Agent de la liste ouverte,
 * mémoire tampon, décodage, fréquence d'affichage). Gardés ici pour le lecteur, l'aperçu,
 * la mosaïque et les enregistrements programmés, qui démarrent parfois sans la page.
 */
@OptIn(markerClass = UnstableApi.class)
final class PlayerOptions {
    static final String DEFAULT_USER_AGENT = "IPTVSmartersPro";
    private static final String PREFS = "cedplay_player";

    private PlayerOptions() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context context, String userAgent, String buffer, String decoder, boolean afr) {
        prefs(context).edit()
            .putString("userAgent", cleanUserAgent(userAgent))
            .putString("buffer", buffer)
            .putString("decoder", decoder)
            .putBoolean("afr", afr)
            .apply();
    }

    /** ASCII imprimable seulement : un autre caractère ferait échouer chaque requête. */
    static String cleanUserAgent(String value) {
        if (value == null) return DEFAULT_USER_AGENT;
        String text = value.trim();
        if (text.isEmpty() || text.length() > 200) return DEFAULT_USER_AGENT;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < 0x20 || c > 0x7e) return DEFAULT_USER_AGENT;
        }
        return text;
    }

    static String userAgent(Context context) {
        return cleanUserAgent(prefs(context).getString("userAgent", DEFAULT_USER_AGENT));
    }

    static boolean softwareDecoding(Context context) {
        return "software".equals(prefs(context).getString("decoder", "hardware"));
    }

    static boolean afr(Context context) {
        return prefs(context).getBoolean("afr", false);
    }

    /**
     * Mémoire tampon : [minimum, maximum, avant la première image, avant la reprise] en ms.
     * Le direct démarre vite ; la vidéo à la demande garde un démarrage un peu plus prudent.
     */
    static DefaultLoadControl loadControl(Context context, boolean vod) {
        String profile = prefs(context).getString("buffer", "normal");
        int min, max, start, resume;
        int targetBytes = -1;
        switch (profile == null ? "normal" : profile) {
            case "small": min = 5_000; max = 20_000; start = 800; resume = 2_000; break;
            case "large": min = 30_000; max = 90_000; start = 2_500; resume = 5_000; targetBytes = 64 * 1024 * 1024; break;
            case "max": min = 50_000; max = 120_000; start = 4_000; resume = 8_000; targetBytes = 96 * 1024 * 1024; break;
            default: min = 15_000; max = 50_000; start = 1_200; resume = 3_000; break;
        }
        if (vod) { start = Math.max(start, 2_500); resume = Math.max(resume, 5_000); }
        DefaultLoadControl.Builder builder = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(min, max, start, resume);
        // Grands tampons : plafond en octets (une box n'a pas la mémoire de 2 min de 4K).
        if (targetBytes > 0) builder.setTargetBufferBytes(targetBytes).setPrioritizeTimeOverSizeThresholds(false);
        else builder.setPrioritizeTimeOverSizeThresholds(true);
        return builder.build();
    }

    /** Décodeurs : matériel d'abord (défaut) ou logiciel d'abord ; repli sur l'autre en cas d'échec. */
    static DefaultRenderersFactory renderers(Context context) {
        DefaultRenderersFactory factory = new DefaultRenderersFactory(context).setEnableDecoderFallback(true);
        if (softwareDecoding(context)) factory.setMediaCodecSelector(SOFTWARE_FIRST);
        return factory;
    }

    private static final MediaCodecSelector SOFTWARE_FIRST = (mimeType, secure, tunneling) -> {
        List<MediaCodecInfo> all = MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, secure, tunneling);
        List<MediaCodecInfo> software = new ArrayList<>();
        List<MediaCodecInfo> hardware = new ArrayList<>();
        for (MediaCodecInfo info : all) {
            // Le son reste sur les décodeurs habituels : le réglage ne vise que l'image.
            if (mimeType != null && mimeType.startsWith("video/") && info.softwareOnly) software.add(info);
            else hardware.add(info);
        }
        software.addAll(hardware);
        return software;
    };

    /**
     * Fréquence d'affichage adaptée à la vidéo (AFR) : même définition d'écran, rafraîchissement
     * multiple exact de la cadence (25 → 50 Hz, 29,97 → 59,94 Hz, 23,976 → 23,976 Hz).
     * Renvoie l'identifiant du mode choisi, 0 si rien ne convient.
     */
    static int chooseDisplayMode(Display display, float frameRate) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || display == null || !(frameRate > 1f)) return 0;
        Display.Mode current = display.getMode();
        Display.Mode best = null;
        int bestRatio = Integer.MAX_VALUE;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() != current.getPhysicalWidth() || mode.getPhysicalHeight() != current.getPhysicalHeight()) continue;
            float ratio = mode.getRefreshRate() / frameRate;
            int rounded = Math.round(ratio);
            if (rounded < 1 || Math.abs(ratio - rounded) > 0.01f) continue;
            // Les films (23,976 / 24 i/s) gardent leur cadence ; ailleurs, pas sous 47 Hz (scintillement).
            boolean film = frameRate < 24.5f;
            if (!film && mode.getRefreshRate() < 47f) continue;
            if (rounded < bestRatio) { best = mode; bestRatio = rounded; }
        }
        return best == null ? 0 : best.getModeId();
    }

    /** Applique le mode à la fenêtre ; 0 rend la main au mode par défaut du téléviseur. */
    static void applyDisplayMode(Activity activity, int modeId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        WindowManager.LayoutParams params = activity.getWindow().getAttributes();
        if (params.preferredDisplayModeId == modeId) return;
        params.preferredDisplayModeId = modeId;
        activity.getWindow().setAttributes(params);
    }
}
