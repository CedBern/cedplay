package com.lecteur.iptv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Stockage local (SharedPreferences) des enregistrements programmés.
 * Structure légère : id, url, titre, heure de début (epoch ms), durée (ms).
 */
public final class ScheduleStore {

    private static final String PREFS = "schedules";
    private static final String KEY = "items";

    private ScheduleStore() {}

    public static JSONArray load(Context context) {
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]");
        try { return new JSONArray(raw); } catch (Exception e) { return new JSONArray(); }
    }

    private static void save(Context context, JSONArray array) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply();
    }

    public static void add(Context context, JSONObject entry) {
        JSONArray array = load(context);
        array.put(entry);
        save(context, array);
    }

    public static boolean remove(Context context, String id) {
        JSONArray array = load(context);
        JSONArray next = new JSONArray();
        boolean removed = false;
        for (int i = 0; i < array.length(); i++) {
            JSONObject o = array.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) { removed = true; continue; }
            next.put(o);
        }
        if (removed) save(context, next);
        return removed;
    }

    /**
     * Re-pose les alarmes de toutes les programmations à venir (après un
     * redémarrage de l'appareil). Les programmations passées sont retirées.
     */
    public static void rescheduleAll(Context context) {
        JSONArray array = load(context);
        long now = System.currentTimeMillis();
        JSONArray kept = new JSONArray();
        boolean changed = false;
        for (int i = 0; i < array.length(); i++) {
            JSONObject o = array.optJSONObject(i);
            if (o == null) { changed = true; continue; }
            long start = o.optLong("startTimeMs");
            if (start <= now) { changed = true; continue; }
            kept.put(o);
            ScheduledRecordReceiver.setAlarm(context, o.optString("id"), start,
                o.optString("url"), o.optString("title"), o.optLong("durationMs"));
        }
        if (changed) save(context, kept);
    }
}
