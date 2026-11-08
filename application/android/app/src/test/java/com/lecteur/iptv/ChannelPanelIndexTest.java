package com.lecteur.iptv;

import static org.junit.Assert.*;
import java.util.AbstractList;
import java.util.Arrays;
import org.junit.Test;

public class ChannelPanelIndexTest {
    @Test public void conserveOrdreEtIndicesAbsolus() {
        ChannelPanelIndex index = new ChannelPanelIndex(5, Arrays.asList("Sport", "Info", "Sport", "", "Info"));
        assertArrayEquals(new int[] { 0, 1, 2, 3, 4 }, index.channels(null));
        assertArrayEquals(new int[] { 0, 2 }, index.channels("Sport"));
        assertArrayEquals(new int[] {}, index.channels("Absent"));
    }

    @Test public void reouvertureEtChangementDeFiltreNeRescannentPasVingtMilleChaines() {
        final int[] reads = { 0 };
        AbstractList<String> groups = new AbstractList<String>() {
            public int size() { return 20000; }
            public String get(int i) { reads[0]++; return i % 2 == 0 ? "Sport" : "Info"; }
        };
        ChannelPanelIndex index = new ChannelPanelIndex(groups.size(), groups);
        reads[0] = 0;
        for (int i = 0; i < 100; i++) assertEquals(10000, index.channels("Sport").length);
        assertEquals("aucune relecture du catalogue sur le thread UI", 0, reads[0]);
    }

    @Test public void indexDeFenetreEtIndexCompletRestentDistincts() {
        ChannelPanelIndex window = new ChannelPanelIndex(2, Arrays.asList("Info", "Info"));
        ChannelPanelIndex complete = new ChannelPanelIndex(5, Arrays.asList("Sport", "Sport", "Info", "Info", "Series"));
        assertArrayEquals(new int[] { 0, 1 }, window.channels("Info"));
        assertArrayEquals(new int[] { 2, 3 }, complete.channels("Info"));
    }

    @Test public void favorisConserventOrdreEtDoublonsDeLaListeSansRescannerLesUrls() {
        final int[] reads = { 0 };
        AbstractList<String> urls = new AbstractList<String>() {
            public int size() { return 20000; }
            public String get(int i) { reads[0]++; return "u" + (i % 10000); }
        };
        ChannelPanelIndex index = new ChannelPanelIndex(urls.size(), null, urls);
        reads[0] = 0;
        java.util.Set<String> favorites = new java.util.HashSet<>(Arrays.asList("u7", "u2", "absent"));
        assertArrayEquals(new int[] { 2, 7, 10002, 10007 }, index.favorites(favorites));
        favorites.remove("u2");
        assertArrayEquals(new int[] { 7, 10007 }, index.favorites(favorites));
        assertEquals(0, reads[0]);
        assertArrayEquals(new int[0], index.favorites(java.util.Collections.emptySet()));
    }

    @Test public void varianteAdopteeRemplaceUniquementSaPositionDansLesFavoris() {
        ChannelPanelIndex index = new ChannelPanelIndex(4, null, Arrays.asList("u0", "u1", "u1", "u3"));
        index.replaceUrl(1, "u1", "variant-u1");
        assertArrayEquals(new int[] { 1 }, index.favorites(java.util.Collections.singleton("variant-u1")));
        assertArrayEquals(new int[] { 2 }, index.favorites(java.util.Collections.singleton("u1")));
        index.replaceUrl(1, "variant-u1", "variant-u1");
        assertArrayEquals(new int[] { 1 }, index.favorites(java.util.Collections.singleton("variant-u1")));
    }
}
