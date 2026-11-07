package com.lecteur.iptv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Contrôle ciblé (revue du 2026-11-06) : une coupure longue traversant plusieurs
 * sauvegardes de progression VOD doit rester une seule coupure, comptée pour sa
 * durée complète — les exports intermédiaires lisent les compteurs sans arrêter
 * la mesure, la clôture étant réservée à la reprise, au changement de média ou
 * à la libération du lecteur.
 */
public class RebufferTrackerTest {

    @Test
    public void uneCoupureDeDixSecondesTraversantPlusieursExportsIntermediairesResteUneSeuleCoupureDeDixSecondes() {
        long[] now = { 0 };
        RebufferTracker rebuffer = new RebufferTracker(() -> now[0]);

        rebuffer.open(); // la vidéo se bloque à t = 0
        // Sauvegardes de progression à 3 s, 6 s et 9 s : lecture seule, la mesure continue.
        now[0] = 3000;
        assertTrue(rebuffer.isOpen());
        assertEquals(0, rebuffer.count());
        assertEquals(0, rebuffer.totalMs());
        now[0] = 6000;
        assertTrue(rebuffer.isOpen());
        assertEquals(0, rebuffer.count());
        assertEquals(0, rebuffer.totalMs());
        now[0] = 9000;
        assertTrue(rebuffer.isOpen());
        assertEquals(0, rebuffer.count());
        assertEquals(0, rebuffer.totalMs());

        now[0] = 10000; // reprise de la lecture à t = 10 s
        rebuffer.close();
        assertEquals(1, rebuffer.count());
        assertEquals(10000, rebuffer.totalMs());
        assertFalse(rebuffer.isOpen());
    }

    @Test
    public void clotureSansCoupureOuverteEstSansEffet() {
        long[] now = { 0 };
        RebufferTracker rebuffer = new RebufferTracker(() -> now[0]);
        rebuffer.close();
        assertEquals(0, rebuffer.count());
        assertEquals(0, rebuffer.totalMs());
    }

    @Test
    public void reouverturePendantUneCoupureNeChangePasLancre() {
        long[] now = { 0 };
        RebufferTracker rebuffer = new RebufferTracker(() -> now[0]);

        rebuffer.open();
        now[0] = 2000;
        rebuffer.open(); // l'ancre ne doit pas être reposée pendant une coupure ouverte
        now[0] = 4000;
        rebuffer.close();
        assertEquals(1, rebuffer.count());
        assertEquals(4000, rebuffer.totalMs());
    }

    @Test
    public void coupuresSuccessivesSadditionnent() {
        long[] now = { 0 };
        RebufferTracker rebuffer = new RebufferTracker(() -> now[0]);

        rebuffer.open();
        now[0] = 4000;
        rebuffer.close();
        now[0] = 10000;
        rebuffer.open();
        now[0] = 15000;
        rebuffer.close();
        assertEquals(2, rebuffer.count());
        assertEquals(9000, rebuffer.totalMs());
    }
}
