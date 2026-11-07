package com.lecteur.iptv;

import android.annotation.SuppressLint;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.ContextCompat;
import androidx.tvprovider.media.tv.ChannelLogoUtils;
import androidx.tvprovider.media.tv.PreviewProgram;
import androidx.tvprovider.media.tv.TvContractCompat;
import androidx.tvprovider.media.tv.WatchNextProgram;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Écran d'accueil Android TV : une rangée « CedPlay · Favoris » (chaîne de présentation)
 * et les dernières chaînes regardées dans « À suivre » (Watch Next). Chaque vignette relance
 * la chaîne par lecteuriptv://channel?id=…, le même chemin que les raccourcis de l'icône.
 * Tout échec (lanceur sans ces rangées, téléphone) est silencieux.
 */
@SuppressLint("RestrictedApi")
final class HomeScreen {
    private static final String PREFS = "cedplay_home";
    private static final int MAX_FAVORITES = 30;
    private static final int MAX_WATCH_NEXT = 3;

    private HomeScreen() {}

    static boolean supported(Context context) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }

    private static Uri launchUri(Context context, String channelId) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("lecteuriptv://channel?id=" + Uri.encode(channelId)));
        intent.setClass(context, MainActivity.class);
        return Uri.parse(intent.toUri(Intent.URI_INTENT_SCHEME));
    }

    private static Uri appUri(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        return Uri.parse(intent.toUri(Intent.URI_INTENT_SCHEME));
    }

    /** Logo de la chaîne s'il est en ligne, sinon la bannière de l'application. */
    private static Uri poster(Context context, String logo) {
        if (logo != null && (logo.startsWith("http://") || logo.startsWith("https://"))) return Uri.parse(logo);
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + context.getPackageName() + "/" + R.drawable.tv_banner);
    }

    /** Remplace les vignettes de la rangée Favoris (30 au plus, dans l'ordre des favoris). */
    static void publishFavorites(Context context, JSONArray items) {
        if (!supported(context)) return;
        ContentResolver resolver = context.getContentResolver();
        try {
            long channelId = ensureChannel(context);
            if (channelId < 0) return;
            resolver.delete(TvContractCompat.buildPreviewProgramsUriForChannel(channelId), null, null);
            int count = Math.min(items.length(), MAX_FAVORITES);
            for (int i = 0; i < count; i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", ""), name = item.optString("name", "").trim();
                if (id.isEmpty() || name.isEmpty()) continue;
                PreviewProgram program = new PreviewProgram.Builder()
                    .setChannelId(channelId)
                    .setType(TvContractCompat.PreviewPrograms.TYPE_CHANNEL)
                    .setTitle(name)
                    .setPosterArtUri(poster(context, item.optString("logo", null)))
                    .setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_16_9)
                    .setIntentUri(launchUri(context, id))
                    .setInternalProviderId(id)
                    .setLive(true)
                    .setWeight(MAX_FAVORITES - i)
                    .build();
                resolver.insert(TvContractCompat.PreviewPrograms.CONTENT_URI, program.toContentValues());
            }
        } catch (Exception e) {
            android.util.Log.w("CedPlay-Home", "favorites " + e.getClass().getSimpleName());
        }
    }

    /** Rangée de l'application : créée une fois, gardée par son identifiant. */
    private static long ensureChannel(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        ContentResolver resolver = context.getContentResolver();
        long saved = prefs.getLong("channelId", -1);
        if (saved >= 0) {
            try (Cursor cursor = resolver.query(TvContractCompat.buildChannelUri(saved), null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) return saved;
            } catch (Exception ignored) { /* rangée supprimée par l'utilisateur : la recréer */ }
        }
        androidx.tvprovider.media.tv.Channel channel = new androidx.tvprovider.media.tv.Channel.Builder()
            .setType(TvContractCompat.Channels.TYPE_PREVIEW)
            .setDisplayName("CedPlay · Favoris")
            .setAppLinkIntentUri(appUri(context))
            .build();
        Uri uri = resolver.insert(TvContractCompat.Channels.CONTENT_URI, channel.toContentValues());
        if (uri == null) return -1;
        long id = ContentUris.parseId(uri);
        Bitmap logo = iconBitmap(context);
        if (logo != null) ChannelLogoUtils.storeChannelLogo(context, id, logo);
        // Première rangée de l'application : affichée sans confirmation sur l'accueil Android TV.
        TvContractCompat.requestChannelBrowsable(context, id);
        prefs.edit().putLong("channelId", id).apply();
        return id;
    }

    private static Bitmap iconBitmap(Context context) {
        Drawable drawable = ContextCompat.getDrawable(context, R.mipmap.ic_launcher);
        if (drawable == null) return null;
        Bitmap bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, 256, 256);
        drawable.draw(canvas);
        return bitmap;
    }

    /** Dernière chaîne regardée en tête de « À suivre » ; seules les 3 dernières restent. */
    static void addWatchNext(Context context, String id, String name, String logo) {
        if (!supported(context) || id == null || id.isEmpty() || name == null || name.trim().isEmpty()) return;
        ContentResolver resolver = context.getContentResolver();
        try {
            // Nos entrées, de la plus récente à la plus ancienne ; celle de cette chaîne est remplacée.
            java.util.ArrayList<Long> ours = new java.util.ArrayList<>();
            try (Cursor cursor = resolver.query(TvContractCompat.WatchNextPrograms.CONTENT_URI,
                    new String[] { TvContractCompat.WatchNextPrograms._ID, TvContractCompat.WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID },
                    null, null, TvContractCompat.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS + " DESC")) {
                while (cursor != null && cursor.moveToNext()) {
                    long rowId = cursor.getLong(0);
                    if (id.equals(cursor.getString(1))) resolver.delete(TvContractCompat.buildWatchNextProgramUri(rowId), null, null);
                    else ours.add(rowId);
                }
            }
            for (int i = MAX_WATCH_NEXT - 1; i < ours.size(); i++) resolver.delete(TvContractCompat.buildWatchNextProgramUri(ours.get(i)), null, null);
            WatchNextProgram program = new WatchNextProgram.Builder()
                .setType(TvContractCompat.WatchNextPrograms.TYPE_CHANNEL)
                .setWatchNextType(TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
                .setLastEngagementTimeUtcMillis(System.currentTimeMillis())
                .setTitle(name.trim())
                .setPosterArtUri(poster(context, logo))
                .setPosterArtAspectRatio(TvContractCompat.WatchNextPrograms.ASPECT_RATIO_16_9)
                .setIntentUri(launchUri(context, id))
                .setInternalProviderId(id)
                .setLive(true)
                .build();
            resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, program.toContentValues());
        } catch (Exception e) {
            android.util.Log.w("CedPlay-Home", "watch next " + e.getClass().getSimpleName());
        }
    }
}
