package com.lecteur.iptv;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.TreeMap;

import org.junit.Test;

/** Journal d'usage de Découvrir : temps joué réel, par jour et par famille, 14 jours gardés. */
public class UsageJournalTest {

    @Test
    public void lesPausesEtLesChargementsNeComptentPas() {
        long[] now = { 0 };
        PlayTimeMeter meter = new PlayTimeMeter(() -> now[0]);
        meter.start();
        now[0] = 60_000;
        assertEquals(60_000, meter.stop()); // pause ou chargement à 1 min
        now[0] = 600_000;
        assertEquals(0, meter.stop()); // dix minutes de pause : rien
        meter.start();
        now[0] = 630_000;
        assertEquals(30_000, meter.stop());
    }

    @Test
    public void unSautDansLaVideoNAjouteQueLeTempsReellementEcoule() {
        long[] now = { 0 };
        PlayTimeMeter meter = new PlayTimeMeter(() -> now[0]);
        meter.start();
        now[0] = 10_000;
        // Saut de 40 minutes : le lecteur passe par le chargement, isPlaying devient faux.
        assertEquals(10_000, meter.stop());
        now[0] = 12_000;
        meter.start();
        now[0] = 15_000;
        assertEquals(3_000, meter.stop());
    }

    @Test
    public void unReleveIntermediaireNePerdNiNeCompteDeuxFois() {
        long[] now = { 0 };
        PlayTimeMeter meter = new PlayTimeMeter(() -> now[0]);
        meter.start();
        now[0] = 5_000;
        assertEquals(5_000, meter.flush());
        assertTrue(meter.isRunning());
        now[0] = 8_000;
        assertEquals(3_000, meter.stop());
        assertFalse(meter.isRunning());
    }

    @Test
    public void leJournalCumuleParJourEtParFamille() {
        String journal = UsageJournal.add("", "2026-11-08", UsageJournal.LIVE, 90_000, "2026-10-26");
        journal = UsageJournal.add(journal, "2026-11-08", UsageJournal.LIVE, 40_000, "2026-10-26");
        journal = UsageJournal.add(journal, "2026-11-08", UsageJournal.AUDIO, 5_000, "2026-10-26");
        TreeMap<String, long[]> days = UsageJournal.decode(journal);
        assertArrayEquals(new long[] { 130_000, 0, 5_000 }, days.get("2026-11-08"));
    }

    @Test
    public void seulsLesQuatorzeDerniersJoursSontGardes() {
        String journal = "2026-10-20|1000|0|0;2026-10-26|2000|0|0;2026-11-01|0|3000|0";
        journal = UsageJournal.add(journal, "2026-11-08", UsageJournal.VOD, 1_000, "2026-10-26");
        TreeMap<String, long[]> days = UsageJournal.decode(journal);
        assertFalse(days.containsKey("2026-10-20"));
        assertTrue(days.containsKey("2026-10-26"));
        assertEquals(3, days.size());
    }

    @Test
    public void uneLigneAbimeeEstIgnoreeSansPerdreLesAutres() {
        TreeMap<String, long[]> days = UsageJournal.decode("2026-11-07|1|2|3;n'importe quoi;2026-11-08|x|0|0");
        assertEquals(1, days.size());
        assertArrayEquals(new long[] { 1, 2, 3 }, days.get("2026-11-07"));
    }
}
