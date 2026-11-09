package com.lecteur.iptv;

import android.content.Context;
import android.content.SharedPreferences;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** Persistance du journal d'usage dans les préférences privées de l'application. */
final class UsageJournalStore {

    private static final String PREFS = "usage_journal";
    private static final String KEY = "days";

    private UsageJournalStore() {}

    static synchronized void record(Context context, int family, long playedMs) {
        if (context == null || playedMs <= 0) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Calendar now = Calendar.getInstance();
        String today = format(now.getTime());
        now.add(Calendar.DAY_OF_YEAR, -(UsageJournal.KEEP_DAYS - 1));
        String oldest = format(now.getTime());
        String next = UsageJournal.add(prefs.getString(KEY, ""), today, family, playedMs, oldest);
        prefs.edit().putString(KEY, next).apply();
    }

    static synchronized String read(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "");
    }

    static synchronized void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply();
    }

    private static String format(Date date) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(date);
    }
}
