package com.lecteur.iptv;

import android.graphics.Color;

import java.util.ArrayList;
import java.util.List;

/**
 * Une commande du lecteur, décrite une seule fois et rendue deux fois : ligne du panneau
 * Options sur téléphone, pastille du bandeau sur TV. Soit une liste de valeurs (Vitesse,
 * Audio…), soit une action immédiate (Pause, Chaînes…).
 */
final class PlayerOption {

    /** Palette « Salle obscure » : un seul accent, celui du logo. */
    static final int C_BG = Color.parseColor("#0B0B0D");
    /* Couches alignées sur index.css (.dark) : environ 5 points de L* entre deux couches,
       sinon cartes et boutons se confondent sur une TV aux noirs écrasés. */
    static final int C_CARD = Color.parseColor("#18181C");
    static final int C_ELEV = Color.parseColor("#222228");
    static final int C_TRACK = Color.parseColor("#2E2E36");
    static final int C_BORDER = Color.parseColor("#2A2A31");
    /** Erreur : rouge distinct de l'orange, déjà pris par l'accent et le direct. */
    static final int C_ERROR = Color.parseColor("#E5484D");
    static final int C_TEXT = Color.parseColor("#F3F1ED");
    static final int C_SOFT = Color.parseColor("#C9C5BE");
    static final int C_MUTED = Color.parseColor("#A7A39C");
    static final int C_DIM = Color.parseColor("#8A8680");
    /** Orange du logo : signale (progression, valeur cochée, direct), ne remplit jamais un bouton. */
    static final int C_ACCENT = Color.parseColor("#FF5A36");
    /** Texte sur fond orange, si un jour il en faut un : noir (le blanc n'a que 3,1:1). */
    static final int C_ACCENT_FG = Color.parseColor("#0B0B0C");
    /** Fond d'une pastille au repos sur la vidéo. */
    static final int C_PILL = Color.parseColor("#1FFFFFFF");

    interface Text { String get(); }
    interface Flag { boolean get(); }
    interface Choices { List<Choice> get(); }
    /** Ressource d'icône (0 : aucune), relue à chaque rafraîchissement (Pause ↔ Lecture). */
    interface Icon { int get(); }

    static final class Choice {
        final String label;
        final boolean checked;
        final Runnable apply;
        Choice(String label, boolean checked, Runnable apply) {
            this.label = label; this.checked = checked; this.apply = apply;
        }
    }

    /** Identifiant stable : sert à reposer le focus sur la dernière commande utilisée. */
    final String key;
    final Text label;
    /** Valeur courante affichée à droite du libellé (null : aucune). */
    final Text value;
    final Choices choices;
    final Runnable action;
    final Flag visible;
    final Icon icon;
    /** Pastille de couleur avant le libellé (0 : aucune), ex. le point d'enregistrement. */
    final int dot;

    private PlayerOption(String key, Text label, Text value, Choices choices, Runnable action, Flag visible, Icon icon, int dot) {
        this.key = key; this.label = label; this.value = value; this.choices = choices;
        this.action = action; this.visible = visible; this.icon = icon; this.dot = dot;
    }

    static Builder list(String key, String label) { return new Builder(key, label); }
    static Builder action(String key, String label, Runnable action) { Builder b = new Builder(key, label); b.action = action; return b; }

    boolean isList() { return choices != null; }
    boolean isVisible() { return visible == null || visible.get(); }
    String valueText() { return value == null ? null : value.get(); }
    int iconRes() { return icon == null ? 0 : icon.get(); }

    static final class Builder {
        private final String key;
        private Text label;
        private Text value;
        private Choices choices;
        private Runnable action;
        private Flag visible;
        private Icon icon;
        private int dot;

        Builder(String key, String label) { this.key = key; this.label = () -> label; }
        Builder label(Text label) { this.label = label; return this; }
        Builder value(Text value) { this.value = value; return this; }
        Builder choices(Choices choices) { this.choices = choices; return this; }
        Builder visible(Flag visible) { this.visible = visible; return this; }
        Builder icon(Icon icon) { this.icon = icon; return this; }
        Builder dot(int color) { this.dot = color; return this; }
        PlayerOption build() { return new PlayerOption(key, label, value, choices, action, visible, icon, dot); }
    }

    /** Liste visible d'une rangée, dans l'ordre. */
    static List<PlayerOption> visibleOf(List<PlayerOption> options) {
        List<PlayerOption> out = new ArrayList<>();
        for (PlayerOption o : options) if (o.isVisible()) out.add(o);
        return out;
    }
}
