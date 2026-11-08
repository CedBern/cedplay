package com.lecteur.iptv;

import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Collections;
import java.util.HashMap;
import java.util.Set;
import java.util.Arrays;

final class ChannelPanelIndex {
    private static final int[] EMPTY = new int[0];
    private final int[] all;
    private final LinkedHashMap<String, int[]> byGroup = new LinkedHashMap<>();
    private final HashMap<String, ArrayList<Integer>> byUrl = new HashMap<>();
    ChannelPanelIndex(int count, List<String> groups) { this(count, groups, null); }
    ChannelPanelIndex(int count, List<String> groups, List<String> urls) {
        all = new int[count];
        LinkedHashMap<String, ArrayList<Integer>> rows = new LinkedHashMap<>();
        for (int i = 0; i < count; i++) {
            all[i] = i;
            if (urls != null && i < urls.size()) {
                String url = urls.get(i);
                ArrayList<Integer> positions = byUrl.get(url);
                if (positions == null) { positions = new ArrayList<>(); byUrl.put(url, positions); }
                positions.add(i);
            }
            String group = groups != null && i < groups.size() ? groups.get(i) : null;
            if (group == null || group.isEmpty()) continue;
            ArrayList<Integer> indices = rows.get(group);
            if (indices == null) { indices = new ArrayList<>(); rows.put(group, indices); }
            indices.add(i);
        }
        for (String group : rows.keySet()) {
            ArrayList<Integer> indices = rows.get(group);
            int[] result = new int[indices.size()];
            for (int i = 0; i < result.length; i++) result[i] = indices.get(i);
            byGroup.put(group, result);
        }
    }
    List<String> groups() { return Collections.unmodifiableList(new ArrayList<>(byGroup.keySet())); }
    int[] channels(String group) { return group == null ? all : byGroup.containsKey(group) ? byGroup.get(group) : EMPTY; }
    void replaceUrl(int channel, String previous, String replacement) {
        if (java.util.Objects.equals(previous, replacement)) return;
        ArrayList<Integer> oldRows = byUrl.get(previous);
        if (oldRows != null) {
            oldRows.remove(Integer.valueOf(channel));
            if (oldRows.isEmpty()) byUrl.remove(previous);
        }
        ArrayList<Integer> newRows = byUrl.get(replacement);
        if (newRows == null) { newRows = new ArrayList<>(); byUrl.put(replacement, newRows); }
        if (!newRows.contains(channel)) newRows.add(channel);
    }
    int[] favorites(Set<String> urls) {
        ArrayList<Integer> rows = new ArrayList<>();
        for (String url : urls) {
            ArrayList<Integer> positions = byUrl.get(url);
            if (positions != null) rows.addAll(positions);
        }
        int[] result = new int[rows.size()];
        for (int i = 0; i < result.length; i++) result[i] = rows.get(i);
        Arrays.sort(result);
        return result;
    }
}
