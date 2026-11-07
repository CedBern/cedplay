package com.lecteur.iptv;

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
}
