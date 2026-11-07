package com.lecteur.iptv;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class PreviewRequestTrackerTest {
    @Test public void uneReponseApresArretEstIgnoree() {
        PreviewRequestTracker requests = new PreviewRequestTracker();
        long a = requests.begin();
        requests.cancel();
        assertFalse(requests.isCurrent(a));
    }

    @Test public void uneReponseDeAApresPassageABEstIgnoree() {
        PreviewRequestTracker requests = new PreviewRequestTracker();
        long a = requests.begin();
        long b = requests.begin();
        assertFalse(requests.isCurrent(a));
        assertTrue(requests.isCurrent(b));
    }

    @Test public void retourSurLaMemeChaineNeReactivePasSaPremiereReponse() {
        PreviewRequestTracker requests = new PreviewRequestTracker();
        long premierA = requests.begin();
        requests.begin(); // B
        long secondA = requests.begin();
        assertFalse(requests.isCurrent(premierA));
        assertTrue(requests.isCurrent(secondA));
    }

    @Test public void pausePuisRepriseInvalideLaDemandeAvantPause() {
        PreviewRequestTracker requests = new PreviewRequestTracker();
        long avantPause = requests.begin();
        requests.cancel();
        long apresReprise = requests.begin();
        assertFalse(requests.isCurrent(avantPause));
        assertTrue(requests.isCurrent(apresReprise));
    }
}
