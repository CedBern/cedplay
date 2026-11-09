package com.lecteur.iptv;

/**
 * Temps de lecture effective : le chronomètre ne tourne que pendant que le lecteur
 * signale isPlaying (ni pause, ni chargement, ni recherche). Un saut dans la vidéo
 * déplace la position sans ajouter de temps. Sans dépendance Android (horloge injectée)
 * pour être vérifiable en JUnit. Tous les appels ont lieu sur le thread principal.
 */
final class PlayTimeMeter {

    interface Clock { long nowMs(); }

    private final Clock clock;
    private boolean running;
    private long startedAtMs;

    PlayTimeMeter(Clock clock) { this.clock = clock; }

    /** La lecture démarre ou reprend ; sans effet si le chronomètre tourne déjà. */
    void start() {
        if (running) return;
        running = true;
        startedAtMs = clock.nowMs();
    }

    /** La lecture s'arrête : rend le temps joué depuis le dernier relevé (0 si arrêté). */
    long stop() {
        if (!running) return 0;
        running = false;
        return Math.max(0, clock.nowMs() - startedAtMs);
    }

    /** Relevé intermédiaire : rend le temps joué et continue de mesurer si la lecture se poursuit. */
    long flush() {
        if (!running) return 0;
        long now = clock.nowMs();
        long played = Math.max(0, now - startedAtMs);
        startedAtMs = now;
        return played;
    }

    boolean isRunning() { return running; }
}
