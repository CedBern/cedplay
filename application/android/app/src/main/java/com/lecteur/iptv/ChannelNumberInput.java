package com.lecteur.iptv;

import java.util.ArrayList;
import java.util.HashMap;

/** Saisie commune à tous les numéros acceptés dans la liste (jusqu'à neuf chiffres). */
final class ChannelNumberInput {
    private static final int MAX_DIGITS = 9;
    private final StringBuilder digits = new StringBuilder();

    void append(int digit) {
        if (digit < 0 || digit > 9) return;
        if (digits.length() >= MAX_DIGITS) clear();
        digits.append(digit);
    }

    int length() { return digits.length(); }
    void clear() { digits.setLength(0); }
    @Override public String toString() { return digits.toString(); }

    /** « 007 » et « 7 » désignent la même chaîne. Sans regex par entrée (20 000 chaînes sur TV). */
    static String normalizeNumber(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        int len = trimmed.length();
        if (len == 0) return "";
        int firstNonZero = -1;
        for (int i = 0; i < len; i++) {
            char c = trimmed.charAt(i);
            if (c < '0' || c > '9') return trimmed;
            if (c != '0' && firstNonZero < 0) firstNonZero = i;
        }
        return firstNonZero < 0 ? "0" : (firstNonZero == 0 ? trimmed : trimmed.substring(firstNonZero));
    }

    /** Construit l'index numéro normalisé → premier index de chaîne hors thread UI. */
    static HashMap<String, Integer> buildNumberIndex(ArrayList<String> numbers) {
        if (numbers == null || numbers.isEmpty()) return new HashMap<>();
        HashMap<String, Integer> index = new HashMap<>(Math.max(16, (int) (numbers.size() / 0.75f) + 1));
        for (int i = 0; i < numbers.size(); i++) {
            String normalized = normalizeNumber(numbers.get(i));
            if (!normalized.isEmpty()) index.putIfAbsent(normalized, i);
        }
        return index;
    }
}
