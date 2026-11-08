package com.lecteur.iptv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import org.junit.Test;

public class ChannelNumberInputTest {
    @Test public void accepteLesNeufChiffresDuNumeroPersonnalise() {
        ChannelNumberInput input = new ChannelNumberInput();
        for (int digit = 1; digit <= 9; digit++) input.append(digit);
        assertEquals("123456789", input.toString());
        assertEquals(9, input.length());
    }

    @Test public void dixiemeChiffreCommenceUneNouvelleSaisie() {
        ChannelNumberInput input = new ChannelNumberInput();
        for (int digit = 1; digit <= 9; digit++) input.append(digit);
        input.append(0);
        assertEquals("0", input.toString());
    }

    @Test public void retourOuValidationVideLaSaisie() {
        ChannelNumberInput input = new ChannelNumberInput();
        input.append(1);
        input.append(2);
        input.clear();
        assertEquals(0, input.length());
        input.append(7);
        assertEquals("7", input.toString());
    }

    @Test public void normaliseLesZerosDeTeteSansRegex() {
        assertEquals("", ChannelNumberInput.normalizeNumber(null));
        assertEquals("", ChannelNumberInput.normalizeNumber("   "));
        assertEquals("7", ChannelNumberInput.normalizeNumber("007"));
        assertEquals("0", ChannelNumberInput.normalizeNumber("000"));
        assertEquals("18900", ChannelNumberInput.normalizeNumber(" 018900 "));
        assertEquals("12A", ChannelNumberInput.normalizeNumber(" 12A "));
        assertEquals("00A", ChannelNumberInput.normalizeNumber("00A"));
    }

    @Test public void indexeVingtMilleNumerosEnMoinsDeCinquanteMillisecondes() {
        ArrayList<String> numbers = new ArrayList<>(20_000);
        for (int i = 0; i < 20_000; i++) {
            numbers.add(String.format(Locale.ROOT, "%05d", i + 1));
        }
        long startNs = System.nanoTime();
        HashMap<String, Integer> index = ChannelNumberInput.buildNumberIndex(numbers);
        long elapsedMs = (System.nanoTime() - startNs) / 1_000_000L;
        assertEquals(20_000, index.size());
        assertEquals(Integer.valueOf(0), index.get("1"));
        assertEquals(Integer.valueOf(6), index.get("7"));
        assertEquals(Integer.valueOf(19_999), index.get("20000"));
        assertTrue("Indexation trop lente : " + elapsedMs + " ms", elapsedMs < 50);
    }
}
