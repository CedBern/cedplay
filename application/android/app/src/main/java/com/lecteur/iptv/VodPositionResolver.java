package com.lecteur.iptv;

import android.content.SharedPreferences;

final class VodPositionResolver {
    private VodPositionResolver() {}

    static long resolveInitialPosition(
        SharedPreferences vodPrefs,
        String mediaId,
        long intentPositionMs,
        boolean hasStartPos,
        boolean restart
    ) {
        if (restart) {
            vodPrefs.edit().remove(mediaId).apply();
            return 0L;
        }
        if (hasStartPos) {
            long normalized = Math.max(0L, intentPositionMs);
            SharedPreferences.Editor editor = vodPrefs.edit();
            if (normalized > 0L) editor.putLong(mediaId, normalized);
            else editor.remove(mediaId);
            editor.apply();
            return normalized;
        }
        return Math.max(0L, vodPrefs.getLong(mediaId, intentPositionMs));
    }
}
