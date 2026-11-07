package com.lecteur.iptv;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;

import static com.lecteur.iptv.PlayerOption.C_ACCENT;
import static com.lecteur.iptv.PlayerOption.C_CARD;
import static com.lecteur.iptv.PlayerOption.C_DIM;
import static com.lecteur.iptv.PlayerOption.C_MUTED;
import static com.lecteur.iptv.PlayerOption.C_TEXT;
import static com.lecteur.iptv.PlayerOption.C_TRACK;

/**
 * Panneau « Options » du lecteur sur téléphone : à droite en paysage, en bas en portrait.
 * Choisir une valeur l'applique aussitôt et revient à la liste des options, panneau ouvert :
 * on peut changer la vitesse deux fois de suite sans rien rouvrir. Retour ferme d'abord la
 * liste des valeurs, puis le panneau.
 */
final class OptionsSheet {

    interface Listener {
        void onOpened();
        void onClosed();
    }

    private final Context context;
    private final FrameLayout root;
    private final Listener listener;
    private FrameLayout scrim;
    private LinearLayout panel;
    private LinearLayout rows;
    private ScrollView scroll;
    private List<PlayerOption> settings;
    private List<PlayerOption> actions;
    /** Liste de valeurs ouverte (null : page principale). */
    private PlayerOption openList;
    private boolean landscape;

    OptionsSheet(Context context, FrameLayout root, Listener listener) {
        this.context = context;
        this.root = root;
        this.listener = listener;
    }

    boolean isOpen() { return scrim != null; }

    void show(List<PlayerOption> settings, List<PlayerOption> actions) {
        this.settings = settings;
        this.actions = actions;
        this.openList = null;
        if (scrim == null) {
            build();
            listener.onOpened();
            animateIn();
        }
        render();
    }

    /** Retour Android : liste des valeurs → options → fermé. */
    boolean back() {
        if (!isOpen()) return false;
        if (openList != null) { openList = null; render(); return true; }
        close();
        return true;
    }

    void close() {
        if (scrim == null) return;
        final FrameLayout closing = scrim;
        scrim = null;
        panel.animate().cancel();
        float dx = landscape ? panel.getWidth() : 0, dy = landscape ? 0 : panel.getHeight();
        panel.animate().translationX(dx).translationY(dy).setDuration(150)
            .withEndAction(() -> root.removeView(closing)).start();
        listener.onClosed();
    }

    /** Valeurs relues (piste choisie, minuteur qui avance, enregistrement démarré…). */
    void refresh() { if (isOpen()) render(); }

    /** Rotation : le panneau change de côté. */
    void relayout() {
        if (!isOpen()) return;
        PlayerOption list = openList;
        root.removeView(scrim);
        scrim = null;
        build();
        openList = list;
        render();
    }

    private int dp(int value) { return (int) (value * context.getResources().getDisplayMetrics().density); }

    private void build() {
        // Mesures de l'affichage (à jour dès la rotation, avant la mise en page du lecteur).
        int w = context.getResources().getDisplayMetrics().widthPixels;
        int h = context.getResources().getDisplayMetrics().heightPixels;
        landscape = context.getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE;

        scrim = new FrameLayout(context);
        scrim.setBackgroundColor(0x66000000);
        scrim.setOnClickListener(v -> close());

        panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setClickable(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(C_CARD);
        float r = dp(18);
        bg.setCornerRadii(landscape ? new float[] { r, r, 0, 0, 0, 0, r, r } : new float[] { r, r, r, r, 0, 0, 0, 0 });
        panel.setBackground(bg);
        panel.setPadding(dp(8), dp(12), dp(8), dp(12));

        scroll = new MaxHeightScrollView(context, landscape ? Integer.MAX_VALUE : (int) (h * 0.72f));
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        rows = new LinearLayout(context);
        rows.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(rows);
        panel.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, landscape ? ViewGroup.LayoutParams.MATCH_PARENT : ViewGroup.LayoutParams.WRAP_CONTENT));

        FrameLayout.LayoutParams lp = landscape
            ? new FrameLayout.LayoutParams(Math.min(dp(360), (int) (w * 0.55f)), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.END)
            : new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        scrim.addView(panel, lp);
        root.addView(scrim, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void animateIn() {
        panel.post(() -> {
            if (landscape) panel.setTranslationX(panel.getWidth()); else panel.setTranslationY(panel.getHeight());
            panel.animate().translationX(0).translationY(0).setDuration(180).start();
        });
    }

    private void render() {
        rows.removeAllViews();
        if (openList != null) {
            rows.addView(header("‹   " + openList.label.get(), v -> { openList = null; render(); }));
            for (PlayerOption.Choice choice : openList.choices.get()) {
                final PlayerOption.Choice c = choice;
                rows.addView(row(c.label, c.checked ? "✓" : "", c.checked, 0, v -> {
                    c.apply.run();
                    // La valeur est appliquée : retour à la liste, panneau ouvert, valeur à jour.
                    openList = null;
                    render();
                }));
            }
            scroll.scrollTo(0, 0);
            return;
        }
        rows.addView(header("Options", null));
        for (PlayerOption o : settings) {
            if (!o.isVisible()) continue;
            final PlayerOption option = o;
            String value = o.valueText();
            rows.addView(row(o.label.get(), value == null ? "" : value, false, 0, v -> {
                if (option.isList()) { openList = option; render(); }
                else if (option.action != null) option.action.run();
            }));
        }
        boolean divided = false;
        for (PlayerOption o : actions) {
            if (!o.isVisible()) continue;
            if (!divided) { rows.addView(divider()); divided = true; }
            final PlayerOption option = o;
            rows.addView(row(o.label.get(), "", false, o.dot, v -> {
                close();
                if (option.action != null) option.action.run();
            }));
        }
    }

    private View header(String text, View.OnClickListener back) {
        TextView t = new TextView(context);
        t.setText(back == null ? text.toUpperCase(java.util.Locale.FRANCE) : text);
        t.setTextSize(back == null ? 12 : 15);
        t.setLetterSpacing(back == null ? 0.08f : 0f);
        t.setTextColor(back == null ? C_DIM : C_TEXT);
        t.setTypeface(back == null ? Typeface.DEFAULT_BOLD : Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setGravity(Gravity.CENTER_VERTICAL);
        t.setPadding(dp(12), 0, dp(12), 0);
        t.setMinHeight(dp(back == null ? 36 : 48));
        if (back != null) {
            t.setBackground(rowBackground());
            t.setOnClickListener(back);
            t.setFocusable(true);
            t.setContentDescription("Revenir aux options");
        }
        return t;
    }

    private View row(String label, String value, boolean checked, int dot, View.OnClickListener click) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(48));
        row.setPadding(dp(12), 0, dp(12), 0);
        row.setBackground(rowBackground());
        row.setClickable(true);
        row.setFocusable(true);
        row.setOnClickListener(click);

        if (dot != 0) {
            View d = new View(context);
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(dot);
            d.setBackground(circle);
            LinearLayout.LayoutParams dp8 = new LinearLayout.LayoutParams(dp(8), dp(8));
            dp8.setMargins(0, 0, dp(10), 0);
            row.addView(d, dp8);
        }
        TextView l = new TextView(context);
        l.setText(label);
        l.setTextSize(15);
        l.setTextColor(C_TEXT);
        l.setSingleLine(true);
        l.setEllipsize(TextUtils.TruncateAt.END);
        if (checked) l.setTypeface(Typeface.DEFAULT_BOLD);
        row.addView(l, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (!value.isEmpty()) {
            TextView v = new TextView(context);
            v.setText(value);
            v.setTextSize(14);
            v.setTextColor(checked ? C_ACCENT : C_MUTED);
            if (checked) v.setTypeface(Typeface.DEFAULT_BOLD);
            v.setSingleLine(true);
            v.setEllipsize(TextUtils.TruncateAt.END);
            v.setMaxWidth(dp(170));
            LinearLayout.LayoutParams vp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            vp.setMargins(dp(12), 0, 0, 0);
            row.addView(v, vp);
        }
        row.setContentDescription(value.isEmpty() || "✓".equals(value) ? label + (checked ? ", choisi" : "") : label + " : " + value);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(1), 0, dp(1));
        row.setLayoutParams(lp);
        return row;
    }

    private View divider() {
        View d = new View(context);
        d.setBackgroundColor(C_TRACK);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        lp.setMargins(dp(12), dp(8), dp(12), dp(8));
        d.setLayoutParams(lp);
        return d;
    }

    private StateListDrawable rowBackground() {
        StateListDrawable states = new StateListDrawable();
        GradientDrawable pressed = new GradientDrawable();
        pressed.setColor(C_TRACK);
        pressed.setCornerRadius(dp(10));
        states.addState(new int[] { android.R.attr.state_pressed }, pressed);
        states.addState(new int[] { android.R.attr.state_focused }, pressed);
        states.addState(new int[] {}, new GradientDrawable());
        return states;
    }

    /** Défilement plafonné : le panneau du bas ne couvre jamais toute l'image en portrait. */
    private static final class MaxHeightScrollView extends ScrollView {
        private final int maxHeight;
        MaxHeightScrollView(Context context, int maxHeight) { super(context); this.maxHeight = maxHeight; }
        @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            if (maxHeight != Integer.MAX_VALUE) {
                heightMeasureSpec = MeasureSpec.makeMeasureSpec(maxHeight, MeasureSpec.AT_MOST);
            }
            super.onMeasure(widthMeasureSpec, heightMeasureSpec);
        }
    }
}
