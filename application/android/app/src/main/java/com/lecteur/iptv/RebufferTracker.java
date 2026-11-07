package com.lecteur.iptv;

/**
 * Comptage des interruptions de lecture (rebuffering), isolé dans une classe sans dépendance
 * Android (horloge injectée) pour être vérifiable par un simple JUnit.
 *
 * Contrat de clôture : la coupure ouverte n'est comptabilisée qu'à la reprise de la lecture,
 * au changement de média, à la libération du lecteur ou à la fin de session — jamais par un
 * export intermédiaire. Les sauvegardes de progression VOD (toutes les cinq secondes) lisent
 * les compteurs sans arrêter la mesure : fermer la coupure à chaque export la fragmenterait
 * et, aucune nouvelle transition BUFFERING ne survenant pendant que la vidéo reste bloquée,
 * le temps restant serait perdu (coupure longue fortement sous-estimée).
 * Tous les appels ont lieu sur le thread principal.
 */
final class RebufferTracker {

    /** Source de temps injectable : SystemClock.elapsedRealtime() en production. */
    interface Clock { long nowMs(); }

    private final Clock clock;
    /** Coupure en cours ? État explicite : aucune valeur sentinelle de l'horloge ne peut le confondre. */
    private boolean open;
    /** Instant d'ouverture de la coupure en cours (significatif seulement si {@link #open}). */
    private long startedAtMs;
    private int count;
    private long totalMs;

    RebufferTracker(Clock clock) { this.clock = clock; }

    /** Ancre le début d'une coupure ; sans effet si une coupure est déjà ouverte. */
    void open() {
        if (open) return;
        open = true;
        startedAtMs = clock.nowMs();
    }

    /** Comptabilise la coupure ouverte (temps écoulé) et réarme le chronomètre ; sans effet si aucune coupure n'est ouverte. */
    void close() {
        if (!open) return;
        open = false;
        count++;
        totalMs += clock.nowMs() - startedAtMs;
    }

    /** Vrai tant que la mesure d'une coupure est en cours : les exports intermédiaires ne doivent pas l'arrêter. */
    boolean isOpen() { return open; }

    int count() { return count; }

    long totalMs() { return totalMs; }
}
