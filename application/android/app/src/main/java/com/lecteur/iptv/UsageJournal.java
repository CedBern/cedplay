package com.lecteur.iptv;

import java.util.Map;
import java.util.TreeMap;

/**
 * Journal d'usage local de Découvrir : par jour, le temps de lecture effective de chaque
 * famille (direct, vidéo à la demande, podcasts). Rien ne quitte l'appareil ; seuls les
 * 14 derniers jours sont gardés.
 *
 * Format texte sans org.json (testable en JUnit pur) : « jour|direct|vod|audio » séparés par
 * des points-virgules, jour au format AAAA-MM-JJ, valeurs en millisecondes.
 */
final class UsageJournal {

    static final int LIVE = 0;
    static final int VOD = 1;
    static final int AUDIO = 2;
    static final int FAMILIES = 3;
    static final int KEEP_DAYS = 14;

    private UsageJournal() {}

    static TreeMap<String, long[]> decode(String encoded) {
        TreeMap<String, long[]> days = new TreeMap<>();
        if (encoded == null || encoded.isEmpty()) return days;
        for (String row : encoded.split(";")) {
            String[] parts = row.split("\\|");
            if (parts.length != FAMILIES + 1 || !isDay(parts[0])) continue;
            long[] values = new long[FAMILIES];
            boolean valid = true;
            for (int i = 0; i < FAMILIES; i++) {
                try {
                    values[i] = Math.max(0, Long.parseLong(parts[i + 1]));
                } catch (NumberFormatException e) {
                    valid = false;
                    break;
                }
            }
            if (valid) days.put(parts[0], values);
        }
        return days;
    }

    static String encode(Map<String, long[]> days) {
        StringBuilder out = new StringBuilder();
        for (Map.Entry<String, long[]> entry : days.entrySet()) {
            if (out.length() > 0) out.append(';');
            out.append(entry.getKey());
            for (long value : entry.getValue()) out.append('|').append(value);
        }
        return out.toString();
    }

    /**
     * Ajoute du temps joué au jour donné et retire les jours antérieurs à {@code oldestKeptDay}
     * (les dates AAAA-MM-JJ se comparent comme des chaînes).
     */
    static String add(String encoded, String day, int family, long playedMs, String oldestKeptDay) {
        TreeMap<String, long[]> days = decode(encoded);
        if (playedMs > 0 && family >= 0 && family < FAMILIES && isDay(day)) {
            long[] values = days.get(day);
            if (values == null) {
                values = new long[FAMILIES];
                days.put(day, values);
            }
            values[family] += playedMs;
        }
        if (oldestKeptDay != null) days.headMap(oldestKeptDay, false).clear();
        return encode(days);
    }

    static boolean isDay(String value) {
        return value != null && value.matches("\\d{4}-\\d{2}-\\d{2}");
    }
}
