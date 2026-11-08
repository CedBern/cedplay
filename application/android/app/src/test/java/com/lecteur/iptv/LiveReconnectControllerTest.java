package com.lecteur.iptv;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class LiveReconnectControllerTest {
    private static final class Harness implements LiveReconnectController.Scheduler, LiveReconnectController.Listener {
        long now;
        long due;
        Runnable task;
        int attempts;
        int exhausted;
        final List<Long> retryTimes = new ArrayList<>();
        final LiveReconnectController controller = new LiveReconnectController(() -> now, this, this);
        @Override public void postDelayed(Runnable next, long delayMs) {
            assertNull("une seule tâche en attente", task);
            task = next;
            due = now + delayMs;
        }
        @Override public void removeCallbacks(Runnable next) { if (task == next) task = null; }
        @Override public void onRetry(int attempt) { attempts++; retryTimes.add(now); }
        @Override public void onExhausted() { exhausted++; }
        void advance(long ms) {
            long target = now + ms;
            while (task != null && due <= target) {
                now = due;
                Runnable next = task;
                task = null;
                next.run();
            }
            now = target;
        }
    }

    @Test public void uneCoupureDeTrenteSecondesNeDoitPasEpuiserLaReprise() {
        Harness h = new Harness();
        assertTrue(h.controller.onFailure());
        for (int i = 0; i < 4; i++) {
            h.advance(h.due - h.now);
            assertEquals(i + 1, h.attempts);
            assertTrue(h.controller.onFailure());
        }
        assertEquals(27000L, h.now);
        h.advance(3000);
        h.controller.onNetworkChanged(false);
        h.controller.onNetworkChanged(true);
        h.advance(0);
        assertEquals(5, h.attempts);
        assertEquals(0, h.exhausted);
        h.controller.onPlaying();
        assertFalse(h.controller.isRecovering());
        assertNull(h.task);
    }

    @Test public void lesDelaisSontCroissantsPuisBornesAQuinzeSecondes() {
        Harness h = new Harness();
        h.controller.onFailure();
        long[] delays = {1500, 3500, 7000, 15000, 15000, 15000};
        for (long expected : delays) {
            assertEquals(expected, h.due - h.now);
            h.advance(expected);
            h.controller.onFailure();
        }
    }

    @Test public void uneTentativeEnVolExpireMemeSansNouvelleErreur() {
        Harness h = new Harness();
        h.controller.onFailure();
        h.advance(1500);
        assertEquals(1, h.attempts);
        h.advance(178499);
        assertEquals(0, h.exhausted);
        h.advance(1);
        assertEquals(1, h.exhausted);
        assertFalse(h.controller.isRecovering());
        assertNull(h.task);
    }

    @Test public void lesErreursSuccessivesNeRepoussentPasLaDateLimite() {
        Harness h = new Harness();
        h.controller.onFailure();
        for (int i = 0; i < 30 && h.now < 180000 && h.exhausted == 0; i++) {
            h.advance(h.due - h.now);
            if (h.exhausted == 0) h.controller.onFailure();
        }
        assertEquals(180000, h.now);
        assertEquals(1, h.exhausted);
    }

    @Test public void lesErreursDupliqueesEtReseauxAnnexesNeDoublentPasLaTentative() {
        Harness h = new Harness();
        h.controller.onFailure();
        h.controller.onFailure();
        h.controller.onNetworkChanged(true);
        h.controller.onNetworkChanged(true);
        h.advance(1499);
        assertEquals(0, h.attempts);
        h.advance(1);
        h.controller.onNetworkChanged(false);
        h.controller.onNetworkChanged(true);
        h.advance(1000);
        assertEquals(1, h.attempts);
        assertEquals(180000, h.due);
    }

    @Test public void uneAnnulationInvalideAussiUnAncienCallbackDejaDistribue() {
        Harness h = new Harness();
        h.controller.onFailure();
        Runnable stale = h.task;
        h.controller.cancel();
        h.controller.onFailure();
        stale.run();
        assertEquals(0, h.attempts);
        h.advance(1500);
        assertEquals(1, h.attempts);
    }

    @Test public void leRetourDuReseauNArmeJamaisUneRepriseAnnulee() {
        Harness h = new Harness();
        h.controller.onFailure();
        h.controller.cancel();
        h.controller.onNetworkChanged(false);
        h.controller.onNetworkChanged(true);
        h.advance(180000);
        assertEquals(0, h.attempts);
        assertEquals(0, h.exhausted);
        assertNull(h.task);
    }

    @Test public void uneLectureReussieReinitialiseLaFenetreEtLesDelais() {
        Harness h = new Harness();
        h.controller.onFailure();
        h.advance(1500);
        h.controller.onPlaying();
        h.advance(200000);
        h.controller.onFailure();
        assertEquals(1500, h.due - h.now);
        h.advance(1500);
        h.advance(178500);
        assertEquals(1, h.exhausted);
    }

    @Test public void lesRefusEtFluxAbsentsNeSontPasDesErreursHttpTransitoires() {
        for (int status : new int[] {0, 200, 401, 403, 404, 410, 429, 600}) {
            assertFalse("HTTP " + status, LiveReconnectController.isRetryableHttpStatus(status));
        }
        assertTrue(LiveReconnectController.isRetryableHttpStatus(500));
        assertTrue(LiveReconnectController.isRetryableHttpStatus(503));
        assertTrue(LiveReconnectController.isRetryableHttpStatus(599));
    }
}
