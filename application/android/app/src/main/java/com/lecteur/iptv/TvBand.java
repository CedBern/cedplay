package com.lecteur.iptv;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.Spannable;
import android.text.SpannableStringBuilder;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.core.widget.TextViewCompat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static com.lecteur.iptv.PlayerOption.C_ACCENT;
import static com.lecteur.iptv.PlayerOption.C_BG;
import static com.lecteur.iptv.PlayerOption.C_DIM;
import static com.lecteur.iptv.PlayerOption.C_ELEV;
import static com.lecteur.iptv.PlayerOption.C_MUTED;
import static com.lecteur.iptv.PlayerOption.C_PILL;
import static com.lecteur.iptv.PlayerOption.C_TEXT;

/**
 * Bandeau du lecteur TV : des rangées nommées (Progression, Lecture, Réglages) de pastilles.
 * ◀ ▶ restent dans la rangée, ▲ ▼ changent de rangée sur la commande la plus proche ; au bord,
 * rien ne se passe. OK sur un réglage ouvre sa liste au-dessus de la pastille : OK applique et
 * referme, le focus reste sur la pastille, qui affiche la nouvelle valeur.
 */
final class TvBand {

    interface Host {
        /** Une commande a servi : mémorisée pour la réouverture du bandeau. */
        void onOptionUsed(PlayerOption option);
        /** Une liste de valeurs s'ouvre ou se ferme (le bandeau ne se ferme pas seul pendant). */
        void onListChanged(boolean open);
    }

    static final class Row {
        final String title;
        /** Commande unique occupant toute la rangée (barre de progression), ou null. */
        final View leading;
        final List<PlayerOption> options;
        Row(String title, View leading, List<PlayerOption> options) {
            this.title = title; this.leading = leading; this.options = options;
        }
    }

    private static final int C_PILL_VALUE_FOCUSED = Color.parseColor("#4A4740");

    private final Context context;
    private final FrameLayout root;
    private final Host host;
    private final LinearLayout container;
    private final TextView hint;
    private final List<Row> rows = new ArrayList<>();
    /** Éléments focusables de chaque rangée, dans l'ordre (pastilles ou commande unique). */
    private final List<List<View>> rowItems = new ArrayList<>();
    private final Map<String, Button> pills = new LinkedHashMap<>();
    private final Map<Button, PlayerOption> optionOf = new LinkedHashMap<>();

    private View listCard;
    private Button listAnchor;
    private PlayerOption listOption;
    private final List<View> listItems = new ArrayList<>();

    TvBand(Context context, FrameLayout root, Host host) {
        this.context = context;
        this.root = root;
        this.host = host;
        container = new LinearLayout(context);
        container.setOrientation(LinearLayout.VERTICAL);
        hint = new TextView(context);
        hint.setTextSize(14);
        hint.setTextColor(C_MUTED);
        hint.setSingleLine(true);
        hint.setEllipsize(TextUtils.TruncateAt.END);
    }

    View view() { return container; }

    private int dp(int value) { return (int) (value * context.getResources().getDisplayMetrics().density); }

    void setRows(List<Row> newRows) {
        rows.clear();
        rows.addAll(newRows);
        rowItems.clear();
        pills.clear();
        optionOf.clear();
        container.removeAllViews();
        for (Row row : rows) {
            LinearLayout line = new LinearLayout(context);
            line.setOrientation(LinearLayout.HORIZONTAL);
            line.setGravity(Gravity.CENTER_VERTICAL);
            TextView title = new TextView(context);
            title.setText(row.title.toUpperCase(Locale.FRANCE));
            title.setTextSize(12);
            title.setLetterSpacing(0.08f);
            title.setTypeface(Typeface.DEFAULT_BOLD);
            title.setTextColor(C_DIM);
            line.addView(title, new LinearLayout.LayoutParams(dp(102), ViewGroup.LayoutParams.WRAP_CONTENT));
            List<View> items = new ArrayList<>();
            if (row.leading != null) {
                line.addView(row.leading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                items.add(row.leading);
                // Chaîne l'écouteur existant (épaisseur de la barre au focus) avec l'aide en bas.
                final View.OnFocusChangeListener own = row.leading.getOnFocusChangeListener();
                row.leading.setOnFocusChangeListener((v, has) -> { if (own != null) own.onFocusChange(v, has); if (has) updateHint(); });
            } else {
                HorizontalScrollView scroll = new HorizontalScrollView(context);
                scroll.setHorizontalScrollBarEnabled(false);
                scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
                scroll.setClipToPadding(false);
                LinearLayout strip = new LinearLayout(context);
                strip.setOrientation(LinearLayout.HORIZONTAL);
                strip.setPadding(0, dp(2), dp(24), dp(2));
                for (PlayerOption option : row.options) {
                    Button pill = pill(option);
                    strip.addView(pill);
                    items.add(pill);
                }
                scroll.addView(strip);
                line.addView(scroll, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            }
            rowItems.add(items);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, dp(10), 0, 0);
            container.addView(line, lp);
        }
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.setMargins(dp(102), dp(16), 0, 0);
        container.addView(hint, hp);
        refresh();
    }

    // ── Pastilles ────────────────────────────────────────────────────

    private Button pill(PlayerOption option) {
        Button b = new Button(context);
        b.setAllCaps(false);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(0); b.setMinimumHeight(0);
        b.setTextSize(16);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        b.setSingleLine(true);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(20), 0, dp(20), 0);
        b.setCompoundDrawablePadding(dp(10));
        b.setStateListAnimator(null);
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[] { android.R.attr.state_focused }, rounded(C_TEXT));
        bg.addState(new int[] { android.R.attr.state_pressed }, rounded(C_TEXT));
        bg.addState(new int[] {}, rounded(C_PILL));
        b.setBackground(bg);
        ColorStateList fg = new ColorStateList(
            new int[][] { new int[] { android.R.attr.state_focused }, new int[] {} },
            new int[] { C_BG, C_TEXT });
        b.setTextColor(fg);
        TextViewCompat.setCompoundDrawableTintList(b, fg);
        b.setOnFocusChangeListener((v, has) -> { render(b); if (has) updateHint(); });
        b.setOnClickListener(v -> activate(b));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        lp.setMargins(0, 0, dp(10), 0);
        b.setLayoutParams(lp);
        pills.put(option.key, b);
        optionOf.put(b, option);
        return b;
    }

    private GradientDrawable rounded(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(24));
        return d;
    }

    private void render(Button b) {
        PlayerOption o = optionOf.get(b);
        if (o == null) return;
        boolean focused = b.isFocused();
        SpannableStringBuilder text = new SpannableStringBuilder();
        if (o.dot != 0) {
            text.append("●  ");
            text.setSpan(new ForegroundColorSpan(o.dot), 0, 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        text.append(o.label.get());
        String value = o.valueText();
        if (value != null && !value.isEmpty()) {
            int start = text.length();
            text.append("  ").append(value);
            text.setSpan(new ForegroundColorSpan(focused ? C_PILL_VALUE_FOCUSED : C_MUTED), start, text.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
            text.setSpan(new StyleSpan(Typeface.NORMAL), start, text.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        b.setText(text);
        int icon = o.iconRes();
        Drawable d = icon != 0 ? ContextCompat.getDrawable(context, icon) : null;
        if (d != null) d.setBounds(0, 0, dp(20), dp(20));
        b.setCompoundDrawablesRelative(d, null, null, null);
        b.setContentDescription(value == null || value.isEmpty() ? o.label.get() : o.label.get() + " : " + value);
    }

    /** Relit libellés, valeurs et visibilité ; garde un focus valide si une pastille disparaît. */
    void refresh() {
        View focused = root.findFocus();
        String lostKey = null;
        int lostRow = -1, lostIndex = -1;
        for (Map.Entry<Button, PlayerOption> e : optionOf.entrySet()) {
            Button b = e.getKey();
            boolean visible = e.getValue().isVisible();
            if (!visible && b == focused) {
                lostKey = e.getValue().key;
                lostRow = rowOf(b);
                lostIndex = rowItems.get(lostRow).indexOf(b);
            }
            b.setVisibility(visible ? View.VISIBLE : View.GONE);
            render(b);
        }
        if (lostKey != null) focusNear(lostRow, lostIndex);
        if (container.getVisibility() == View.VISIBLE) updateHint();
    }

    // ── Focus ────────────────────────────────────────────────────────

    boolean focusKey(String key) {
        Button b = pills.get(key);
        if (b == null || b.getVisibility() != View.VISIBLE || !optionOf.get(b).isVisible()) return false;
        return b.requestFocus();
    }

    /** Dernière commande utilisée, sinon sa voisine dans la même rangée. */
    boolean focusPreferred(String key) {
        if (key == null) return false;
        if ("leading".equals(key)) return focusLeading();
        if (focusKey(key)) return true;
        Button b = pills.get(key);
        if (b == null) return false;
        int row = rowOf(b);
        return row >= 0 && focusNear(row, rowItems.get(row).indexOf(b));
    }

    boolean focusLeading() {
        for (List<View> items : rowItems) {
            if (items.size() == 1 && optionOf.get(items.get(0)) == null && items.get(0).getVisibility() == View.VISIBLE) {
                return items.get(0).requestFocus();
            }
        }
        return false;
    }

    String focusedKey() {
        View f = root.findFocus();
        PlayerOption o = f instanceof Button ? optionOf.get(f) : null;
        if (o != null) return o.key;
        return rowOf(f) >= 0 ? "leading" : null;
    }

    boolean hasFocus() { return rowOf(root.findFocus()) >= 0; }

    private boolean focusNear(int row, int index) {
        List<View> items = rowItems.get(row);
        for (int d = 1; d < items.size(); d++) {
            for (int i : new int[] { index - d, index + d }) {
                if (i >= 0 && i < items.size() && items.get(i).getVisibility() == View.VISIBLE) return items.get(i).requestFocus();
            }
        }
        return false;
    }

    private int rowOf(View v) {
        if (v == null) return -1;
        for (int r = 0; r < rowItems.size(); r++) if (rowItems.get(r).contains(v)) return r;
        return -1;
    }

    private List<View> visibleItems(int row) {
        List<View> out = new ArrayList<>();
        for (View v : rowItems.get(row)) if (v.getVisibility() == View.VISIBLE) out.add(v);
        return out;
    }

    /** ▲ ▼ : rangée voisine, commande la plus proche horizontalement. Au bord : rien. */
    void moveRow(int direction) {
        View f = root.findFocus();
        int r = rowOf(f);
        if (r < 0) return;
        int[] at = new int[2];
        f.getLocationOnScreen(at);
        float center = at[0] + f.getWidth() / 2f;
        for (int i = r + direction; i >= 0 && i < rowItems.size(); i += direction) {
            List<View> items = visibleItems(i);
            if (items.isEmpty()) continue;
            View best = null;
            float bestDistance = Float.MAX_VALUE;
            for (View v : items) {
                v.getLocationOnScreen(at);
                float distance = Math.abs(at[0] + v.getWidth() / 2f - center);
                if (distance < bestDistance) { bestDistance = distance; best = v; }
            }
            if (best != null) best.requestFocus();
            return;
        }
    }

    /** ◀ ▶ : commande voisine dans la rangée. Au bord : rien. */
    void moveInRow(int direction) {
        View f = root.findFocus();
        int r = rowOf(f);
        if (r < 0) return;
        List<View> items = visibleItems(r);
        int i = items.indexOf(f) + direction;
        if (i >= 0 && i < items.size()) items.get(i).requestFocus();
    }

    // ── Activation et liste de valeurs ───────────────────────────────

    private void activate(Button b) {
        PlayerOption o = optionOf.get(b);
        if (o == null) return;
        if (o.isList()) { openList(o, b); return; }
        host.onOptionUsed(o);
        if (o.action != null) o.action.run();
    }

    boolean isListOpen() { return listCard != null; }

    private void openList(PlayerOption option, Button anchor) {
        closeList(false);
        List<PlayerOption.Choice> choices = option.choices.get();
        if (choices.isEmpty()) return;
        listOption = option;
        listAnchor = anchor;
        listItems.clear();

        LinearLayout list = new LinearLayout(context);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(8), dp(8), dp(8), dp(8));
        View toFocus = null;
        for (PlayerOption.Choice choice : choices) {
            View item = listItem(choice);
            list.addView(item);
            listItems.add(item);
            if (choice.checked) toFocus = item;
        }
        if (toFocus == null) toFocus = listItems.get(0);

        ScrollView card = new ScrollView(context);
        card.setVerticalScrollBarEnabled(false);
        card.setOverScrollMode(View.OVER_SCROLL_NEVER);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(C_ELEV);
        bg.setCornerRadius(dp(16));
        card.setBackground(bg);
        card.setElevation(dp(16));
        card.addView(list);

        int[] a = new int[2], r = new int[2];
        anchor.getLocationInWindow(a);
        root.getLocationInWindow(r);
        int width = Math.max(dp(220), anchor.getWidth());
        int left = Math.max(dp(16), Math.min(a[0] - r[0], root.getWidth() - width - dp(16)));
        int bottom = root.getHeight() - (a[1] - r[1]) + dp(12);
        int maxHeight = Math.max(dp(120), a[1] - r[1] - dp(32));
        int natural = choices.size() * dp(42) + dp(16);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(width, Math.min(natural, maxHeight), Gravity.BOTTOM | Gravity.START);
        lp.setMargins(left, 0, 0, bottom);
        root.addView(card, lp);
        listCard = card;
        final View first = toFocus;
        first.requestFocus();
        card.post(() -> { if (listCard == card) card.requestChildFocus(list, first); });
        updateHint();
        host.onListChanged(true);
    }

    private View listItem(PlayerOption.Choice choice) {
        LinearLayout item = new LinearLayout(context);
        item.setOrientation(LinearLayout.HORIZONTAL);
        item.setGravity(Gravity.CENTER_VERTICAL);
        item.setPadding(dp(14), 0, dp(14), 0);
        item.setFocusable(true);
        item.setClickable(true);
        StateListDrawable bg = new StateListDrawable();
        GradientDrawable on = new GradientDrawable();
        on.setColor(C_TEXT);
        on.setCornerRadius(dp(10));
        bg.addState(new int[] { android.R.attr.state_focused }, on);
        bg.addState(new int[] { android.R.attr.state_pressed }, on);
        bg.addState(new int[] {}, new GradientDrawable());
        item.setBackground(bg);
        TextView label = new TextView(context);
        label.setText(choice.label);
        label.setTextSize(16);
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        if (choice.checked) label.setTypeface(Typeface.DEFAULT_BOLD);
        item.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView check = new TextView(context);
        check.setText(choice.checked ? "✓" : "");
        check.setTextSize(16);
        check.setTypeface(Typeface.DEFAULT_BOLD);
        item.addView(check);
        View.OnFocusChangeListener colors = (v, has) -> {
            label.setTextColor(has ? C_BG : C_TEXT);
            check.setTextColor(has ? C_BG : C_ACCENT);
        };
        item.setOnFocusChangeListener(colors);
        colors.onFocusChange(item, false);
        item.setContentDescription(choice.label + (choice.checked ? ", choisi" : ""));
        item.setOnClickListener(v -> {
            PlayerOption option = listOption;
            choice.apply.run();
            closeList(true);
            if (option != null) host.onOptionUsed(option);
            refresh();
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40));
        lp.setMargins(0, dp(1), 0, dp(1));
        item.setLayoutParams(lp);
        return item;
    }

    /** ▲ ▼ dans la liste ouverte. Au bord : rien. */
    void moveInList(int direction) {
        int i = listItems.indexOf(root.findFocus());
        int next = i < 0 ? 0 : i + direction;
        if (next >= 0 && next < listItems.size()) listItems.get(next).requestFocus();
    }

    /** Ferme la liste ; le focus revient sur la pastille du réglage. */
    void closeList(boolean refocusAnchor) {
        if (listCard == null) return;
        root.removeView(listCard);
        listCard = null;
        listItems.clear();
        Button anchor = listAnchor;
        listAnchor = null;
        listOption = null;
        if (refocusAnchor && anchor != null && anchor.getVisibility() == View.VISIBLE) anchor.requestFocus();
        updateHint();
        host.onListChanged(false);
    }

    // ── Aide en bas du bandeau ───────────────────────────────────────

    private void updateHint() {
        SpannableStringBuilder s = new SpannableStringBuilder();
        if (listCard != null) {
            key(s, "▲ ▼", "Choisir");
            key(s, "OK", "Appliquer");
            key(s, "Retour", "Fermer sans changer");
        } else {
            View f = root.findFocus();
            PlayerOption o = f instanceof Button ? optionOf.get(f) : null;
            boolean onLeading = o == null && rowOf(f) >= 0;
            key(s, "◀ ▶", onLeading ? "Reculer · avancer (maintenir pour accélérer)" : "Choisir dans la rangée");
            key(s, "▲ ▼", "Changer de rangée");
            if (o != null) key(s, "OK", (o.isList() ? "Ouvrir « " : "« ") + o.label.get() + " »");
            else if (onLeading) key(s, "OK", "Pause · lecture");
            key(s, "Retour", "Fermer le bandeau");
        }
        hint.setText(s);
    }

    private static void key(SpannableStringBuilder s, String keys, String what) {
        if (s.length() > 0) s.append("      ");
        int start = s.length();
        s.append(keys);
        s.setSpan(new ForegroundColorSpan(C_TEXT), start, s.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        s.setSpan(new StyleSpan(Typeface.BOLD), start, s.length(), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
        s.append("  ").append(what);
    }
}
