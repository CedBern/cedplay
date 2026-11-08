package com.lecteur.iptv;

/** Politique de reprise du direct, appelée uniquement sur le fil principal. */
final class LiveReconnectController {
    interface Clock { long nowMs(); }
    interface Scheduler {
        void postDelayed(Runnable task, long delayMs);
        void removeCallbacks(Runnable task);
    }
    interface Listener {
        void onRetry(int attempt);
        void onExhausted();
    }

    private static final long WINDOW_MS = 180_000;
    private static final long[] DELAYS_MS = {1_500, 3_500, 7_000, 15_000};
    private final Clock clock;
    private final Scheduler scheduler;
    private final Listener listener;
    private Runnable scheduled;
    private boolean recovering;
    private boolean inFlight;
    private boolean connected = true;
    private long deadlineMs;
    private int attempts;

    LiveReconnectController(Clock clock, Scheduler scheduler, Listener listener) {
        this.clock = clock;
        this.scheduler = scheduler;
        this.listener = listener;
    }

    boolean onFailure() {
        if (recovering && !inFlight) return true;
        if (!recovering) {
            recovering = true;
            deadlineMs = clock.nowMs() + WINDOW_MS;
            attempts = 0;
        }
        inFlight = false;
        schedule(DELAYS_MS[Math.min(attempts, DELAYS_MS.length - 1)]);
        return recovering;
    }

    void onNetworkChanged(boolean available) {
        boolean returned = !connected && available;
        connected = available;
        if (returned && recovering && !inFlight) schedule(0);
    }

    void onPlaying() { cancel(); }

    void cancel() {
        if (scheduled != null) scheduler.removeCallbacks(scheduled);
        scheduled = null;
        recovering = false;
        inFlight = false;
        attempts = 0;
    }

    boolean isRecovering() { return recovering; }

    static boolean isRetryableHttpStatus(int status) { return status >= 500 && status < 600; }

    private void schedule(long delayMs) {
        if (scheduled != null) scheduler.removeCallbacks(scheduled);
        long remaining = deadlineMs - clock.nowMs();
        if (remaining <= 0) { exhaust(); return; }
        scheduled = new Runnable() {
            @Override public void run() {
                // Une tâche déjà distribuée avant cancel() ne doit pas piloter le média suivant.
                if (scheduled != this || !recovering) return;
                scheduled = null;
                if (clock.nowMs() >= deadlineMs) { exhaust(); return; }
                if (inFlight) return;
                inFlight = true;
                attempts++;
                // Le serveur ou le lecteur peuvent rester muets : la fenêtre expire aussi en vol.
                schedule(deadlineMs - clock.nowMs());
                listener.onRetry(attempts);
            }
        };
        scheduler.postDelayed(scheduled, Math.min(delayMs, remaining));
    }

    private void exhaust() {
        cancel();
        listener.onExhausted();
    }
}
