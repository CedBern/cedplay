package com.lecteur.iptv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class AudioProgressStoreTest {

    @Test
    public void restaureLaVitesseChoisieAvecLaPosition() {
        AudioProgressStore.SessionTracker tracker = new AudioProgressStore.SessionTracker();
        tracker.saveProgress(
                "ep-1",
                "https://example.test/feed.xml",
                "https://example.test/ep1.mp3",
                "Épisode 1",
                "Mon Podcast",
                "https://example.test/art.png",
                142_000L,
                1_800_000L,
                1.5f,
                false,
                1000L);

        // On passe à un autre épisode à 1.0x
        tracker.transitionToEpisode(
                142_000L,
                1_800_000L,
                1.5f,
                "ep-2",
                "https://example.test/feed.xml",
                "https://example.test/ep2.mp3",
                "Épisode 2",
                "Mon Podcast",
                "https://example.test/art.png",
                0L,
                1.0f,
                2000L);

        // Puis on reprend ep-1 sans forcer de position (-1) ni de vitesse (0f) :
        // il doit retrouver sa position 142 000 ms ET sa vitesse 1.5x.
        AudioProgressStore.Entry resumed = tracker.transitionToEpisode(
                30_000L,
                1_200_000L,
                1.0f,
                "ep-1",
                "https://example.test/feed.xml",
                "https://example.test/ep1.mp3",
                "Épisode 1",
                "Mon Podcast",
                "https://example.test/art.png",
                -1L,
                0f,
                3000L);

        assertNotNull(resumed);
        assertEquals(142_000L, resumed.positionMs);
        assertEquals(1.5f, resumed.speed, 0.001f);
    }

    @Test
    public void enregistreLaDernierePositionSousLeBonEpisodeAvantDePasserAuSuivant() {
        AudioProgressStore.SessionTracker tracker = new AudioProgressStore.SessionTracker();

        // Démarrage de l'épisode A à 0 ms, vitesse 1.25x
        tracker.transitionToEpisode(
                0L,
                0L,
                1.25f,
                "ep-A",
                "https://example.test/feed.xml",
                "https://example.test/a.mp3",
                "Épisode A",
                "Podcast Test",
                "",
                0L,
                1.25f,
                1000L);

        // L'épisode B avait déjà une progression antérieure à 95 000 ms (vitesse 1.5x)
        tracker.saveProgress(
                "ep-B",
                "https://example.test/feed.xml",
                "https://example.test/b.mp3",
                "Épisode B",
                "Podcast Test",
                "",
                95_000L,
                600_000L,
                1.5f,
                false,
                1500L);

        // On revient sur A qui avance jusqu'à 210 000 ms sur 900 000 ms à 1.25x
        tracker.transitionToEpisode(
                95_000L,
                600_000L,
                1.5f,
                "ep-A",
                "https://example.test/feed.xml",
                "https://example.test/a.mp3",
                "Épisode A",
                "Podcast Test",
                "",
                0L,
                1.25f,
                2000L);

        // Passage de A (à 210 000 ms) vers B (reprise automatique : explicitStartPositionMs = -1, explicitSpeed = 0)
        AudioProgressStore.Entry nextB = tracker.transitionToEpisode(
                210_000L,
                900_000L,
                1.25f,
                "ep-B",
                "https://example.test/feed.xml",
                "https://example.test/b.mp3",
                "Épisode B",
                "Podcast Test",
                "",
                -1L,
                0f,
                3000L);

        // Vérification 1 : A a bien gardé 210 000 ms et 1.25x sous "ep-A"
        AudioProgressStore.Entry savedA = tracker.getEntry("ep-A");
        assertNotNull(savedA);
        assertEquals("ep-A", savedA.episodeId);
        assertEquals(210_000L, savedA.positionMs);
        assertEquals(900_000L, savedA.durationMs);
        assertEquals(1.25f, savedA.speed, 0.001f);
        assertFalse(savedA.completed);

        // Vérification 2 : B n'a PAS été écrasé par la position de A ; il reprend à 95 000 ms et 1.5x
        assertNotNull(nextB);
        assertEquals("ep-B", nextB.episodeId);
        assertEquals(95_000L, nextB.positionMs);
        assertEquals(1.5f, nextB.speed, 0.001f);
    }

    @Test
    public void marqueUnEpisodeCommeTermineEnFinDeLectureToutEnGardantSaVitesse() {
        AudioProgressStore.SessionTracker tracker = new AudioProgressStore.SessionTracker();
        AudioProgressStore.Entry entry = tracker.saveProgress(
                "ep-fin",
                "https://example.test/feed.xml",
                "https://example.test/fin.mp3",
                "Épisode Fin",
                "Podcast Test",
                "",
                1_790_000L,
                1_800_000L,
                1.75f,
                true,
                5000L);

        assertTrue(entry.completed);
        assertEquals(0L, entry.positionMs);
        assertEquals(1.75f, entry.speed, 0.001f);
    }
}
