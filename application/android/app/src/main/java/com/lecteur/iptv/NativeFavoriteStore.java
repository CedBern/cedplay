package com.lecteur.iptv;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Journal privé : un favori posé dans le lecteur survit à la suspension de la WebView. */
final class NativeFavoriteStore {
    static final String ACTION_CHANGED = "com.lecteur.iptv.FAVORITE_CHANGED";
    private static final Object LOCK = new Object();
    private final Context context;
    private final SharedPreferences prefs;

    NativeFavoriteStore(Context context) {
        this.context = context.getApplicationContext();
        prefs = this.context.getSharedPreferences("native_favorites", Context.MODE_PRIVATE);
    }

    private JSONObject pending() {
        try { return new JSONObject(prefs.getString("pending", "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    boolean isFavorite(String url) {
        synchronized (LOCK) {
            JSONObject change = pending().optJSONObject(url);
            return change != null ? change.optBoolean("favorite")
                : prefs.getStringSet("snapshot", java.util.Collections.emptySet()).contains(url);
        }
    }

    Set<String> favoriteUrls() {
        synchronized (LOCK) {
            Set<String> result = new HashSet<>(prefs.getStringSet("snapshot", java.util.Collections.emptySet()));
            JSONObject changes = pending();
            java.util.Iterator<String> urls = changes.keys();
            while (urls.hasNext()) {
                String url = urls.next();
                JSONObject change = changes.optJSONObject(url);
                if (change == null) continue;
                if (change.optBoolean("favorite")) result.add(url); else result.remove(url);
            }
            return result;
        }
    }

    void setFavorite(String url, boolean favorite) {
        if (url == null || url.isEmpty()) return;
        synchronized (LOCK) {
            try {
                long revision = prefs.getLong("revision", 0) + 1;
                JSONObject changes = pending();
                changes.put(url, new JSONObject().put("favorite", favorite).put("revision", revision));
                if (!prefs.edit().putString("pending", changes.toString()).putLong("revision", revision).commit())
                    throw new IllegalStateException("Favori non enregistré");
            } catch (org.json.JSONException e) { throw new IllegalStateException("Favori non enregistré", e); }
        }
        context.sendBroadcast(new Intent(ACTION_CHANGED).setPackage(context.getPackageName()));
    }

    void setSnapshot(Set<String> urls) {
        synchronized (LOCK) { prefs.edit().putStringSet("snapshot", new HashSet<>(urls)).apply(); }
    }

    JSONArray changes() {
        synchronized (LOCK) {
            JSONArray result = new JSONArray();
            JSONObject changes = pending();
            java.util.Iterator<String> urls = changes.keys();
            while (urls.hasNext()) {
                String url = urls.next();
                JSONObject change = changes.optJSONObject(url);
                if (change == null) continue;
                try { result.put(new JSONObject().put("channelUrl", url)
                    .put("favorite", change.optBoolean("favorite")).put("revision", change.optLong("revision"))); }
                catch (org.json.JSONException ignored) { }
            }
            return result;
        }
    }

    void acknowledge(JSONArray entries) {
        synchronized (LOCK) {
            JSONObject changes = pending();
            Set<String> snapshot = new HashSet<>(prefs.getStringSet("snapshot", java.util.Collections.emptySet()));
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.optJSONObject(i);
                if (entry == null) continue;
                String url = entry.optString("channelUrl");
                JSONObject current = changes.optJSONObject(url);
                // Un second appui pendant l'écriture IndexedDB doit rester à traiter.
                if (current != null && current.optLong("revision") == entry.optLong("revision", -1)) {
                    if (current.optBoolean("favorite")) snapshot.add(url); else snapshot.remove(url);
                    changes.remove(url);
                }
            }
            prefs.edit().putString("pending", changes.toString()).putStringSet("snapshot", snapshot).apply();
        }
    }
}
