package com.lecteur.iptv;

import static org.junit.Assert.assertEquals;
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
}
