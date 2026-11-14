package com.lecteur.iptv;

import android.content.SharedPreferences;
import org.junit.Test;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import static org.junit.Assert.*;

public class VodPositionResolutionTest {

    private static final class MemorySharedPreferences implements SharedPreferences {
        final Map<String, Object> data = new HashMap<>();

        @Override public Map<String, ?> getAll() { return data; }
        @Override public String getString(String key, String defValue) { return (String) data.getOrDefault(key, defValue); }
        @Override @SuppressWarnings("unchecked") public Set<String> getStringSet(String key, Set<String> defValues) { return (Set<String>) data.getOrDefault(key, defValues); }
        @Override public int getInt(String key, int defValue) { return (Integer) data.getOrDefault(key, defValue); }
        @Override public long getLong(String key, long defValue) {
            Object v = data.get(key);
            return v instanceof Long ? (Long) v : defValue;
        }
        @Override public float getFloat(String key, float defValue) { return (Float) data.getOrDefault(key, defValue); }
        @Override public boolean getBoolean(String key, boolean defValue) { return (Boolean) data.getOrDefault(key, defValue); }
        @Override public boolean contains(String key) { return data.containsKey(key); }
        @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
        @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}

        @Override public Editor edit() {
            return new Editor() {
                private final Map<String, Object> pending = new HashMap<>();
                private final java.util.Set<String> removals = new java.util.HashSet<>();
                private boolean clear = false;

                @Override public Editor putString(String key, String value) { pending.put(key, value); return this; }
                @Override public Editor putStringSet(String key, Set<String> values) { pending.put(key, values); return this; }
                @Override public Editor putInt(String key, int value) { pending.put(key, value); return this; }
                @Override public Editor putLong(String key, long value) { pending.put(key, value); return this; }
                @Override public Editor putFloat(String key, float value) { pending.put(key, value); return this; }
                @Override public Editor putBoolean(String key, boolean value) { pending.put(key, value); return this; }
                @Override public Editor remove(String key) { removals.add(key); return this; }
                @Override public Editor clear() { clear = true; return this; }
                @Override public boolean commit() { apply(); return true; }
                @Override public void apply() {
                    if (clear) data.clear();
                    for (String k : removals) data.remove(k);
                    data.putAll(pending);
                }
            };
        }
    }

    @Test
    public void intentStartPositionOverridesStaleSharedPreference() {
        MemorySharedPreferences prefs = new MemorySharedPreferences();
        prefs.data.put("p:movie:1", 42_000L);

        long resolved = VodPositionResolver.resolveInitialPosition(prefs, "p:movie:1", 1_800_000L, true, false);
        assertEquals(1_800_000L, resolved);
        assertEquals(1_800_000L, prefs.getLong("p:movie:1", -1L));
    }

    @Test
    public void zeroIntentStartPositionClearsStaleSharedPreference() {
        MemorySharedPreferences prefs = new MemorySharedPreferences();
        prefs.data.put("p:movie:1", 42_000L);

        long resolved = VodPositionResolver.resolveInitialPosition(prefs, "p:movie:1", 0L, true, false);
        assertEquals(0L, resolved);
        assertFalse(prefs.contains("p:movie:1"));
    }

    @Test
    public void fallsBackToSharedPreferenceOnlyWhenNoIntentExtra() {
        MemorySharedPreferences prefs = new MemorySharedPreferences();
        prefs.data.put("p:movie:1", 95_000L);

        long resolved = VodPositionResolver.resolveInitialPosition(prefs, "p:movie:1", 0L, false, false);
        assertEquals(95_000L, resolved);
    }

    @Test
    public void restartRemovesSharedPreferenceAndReturnsZero() {
        MemorySharedPreferences prefs = new MemorySharedPreferences();
        prefs.data.put("p:movie:1", 95_000L);

        long resolved = VodPositionResolver.resolveInitialPosition(prefs, "p:movie:1", 120_000L, true, true);
        assertEquals(0L, resolved);
        assertFalse(prefs.contains("p:movie:1"));
    }
}
