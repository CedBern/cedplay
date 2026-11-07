package com.lecteur.iptv;

/** Jeton d'une demande d'aperçu ; toutes les opérations restent sur le fil principal. */
final class PreviewRequestTracker {
    private long generation;

    long begin() { return ++generation; }
    void cancel() { generation++; }
    boolean isCurrent(long request) { return request == generation; }
}
