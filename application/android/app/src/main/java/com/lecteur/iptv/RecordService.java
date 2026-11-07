package com.lecteur.iptv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.documentfile.provider.DocumentFile;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Service au premier plan qui enregistre les flux programmés (DVR différé).
 * Plusieurs enregistrements peuvent tourner en même temps (deux émissions qui se
 * chevauchent, marges comprises). Chacun réutilise {@link Recorder} (TS brut ou
 * segments HLS) et s'arrête après sa durée ; le service s'arrête avec le dernier.
 */
public class RecordService extends Service {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_DURATION_MS = "durationMs";
    public static final String EXTRA_USER_AGENT = "userAgent";

    private static final int NOTIF_ID = 4001;
    /** Notifications de fin : une par enregistrement terminé, sans écraser l'indicateur en cours. */
    private static final int DONE_NOTIF_BASE = 4100;
    private static final String CHANNEL_ID = "recordings";

    private final Handler handler = new Handler(Looper.getMainLooper());
    /** Enregistrements en cours, dans l'ordre de démarrage (clé = jeton interne). */
    private final Map<String, Recorder> recorders = new LinkedHashMap<>();
    private final Map<String, String> titles = new LinkedHashMap<>();
    private final Map<String, String> urls = new LinkedHashMap<>();
    /** Heure d'arrêt prévue (0 = sans limite) et tâche d'arrêt de chaque enregistrement. */
    private final Map<String, Long> ends = new LinkedHashMap<>();
    private final Map<String, Runnable> stoppers = new LinkedHashMap<>();
    private PowerManager.WakeLock wakeLock;
    private int sequence = 0;
    private int doneCount = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String url = intent == null ? null : intent.getStringExtra(EXTRA_URL);
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        long durationMs = intent == null ? 0 : intent.getLongExtra(EXTRA_DURATION_MS, 0);
        if (title == null || title.isEmpty()) title = "Enregistrement";

        // Le service au premier plan doit s'annoncer immédiatement (API 26+).
        goForeground(buildNotification(ongoingText(title), true));

        // Même flux déjà en cours (double alarme, ou épisodes consécutifs qui se chevauchent
        // avec les marges) : on prolonge l'enregistrement au lieu d'ouvrir une seconde
        // connexion au fournisseur, souvent limité à une seule.
        if (url != null && urls.containsValue(url)) {
            for (Map.Entry<String, String> e : urls.entrySet()) {
                if (url.equals(e.getValue())) { extend(e.getKey(), durationMs); break; }
            }
            refreshOngoing();
            return START_NOT_STICKY;
        }
        if (url == null || url.isEmpty()) { finishIfIdle("Flux manquant"); return START_NOT_STICKY; }
        String folderUri = getSharedPreferences("recorder", MODE_PRIVATE).getString("folder", null);
        if (folderUri == null) { finishIfIdle("Aucun dossier d'enregistrement choisi"); return START_NOT_STICKY; }
        DocumentFile dir = DocumentFile.fromTreeUri(this, Uri.parse(folderUri));
        if (dir == null || !dir.canWrite()) { finishIfIdle("Dossier d'enregistrement inaccessible"); return START_NOT_STICKY; }

        // WakeLock partiel : le Doze ne doit pas geler la capture quand l'écran
        // est éteint. Relâché quand le dernier enregistrement s'arrête.
        acquireWakeLock();

        final String token = "rec-" + (++sequence);
        final String finalTitle = title;
        final Recorder started = new Recorder(this);
        recorders.put(token, started);
        titles.put(token, title);
        urls.put(token, url);
        refreshOngoing();
        String userAgent = intent == null ? null : intent.getStringExtra(EXTRA_USER_AGENT);
        started.start(url, title, dir, userAgent, new Recorder.Listener() {
            @Override public void onRecordStarted(String fileName) {
                if (recorders.get(token) != started) return;
                refreshOngoing();
            }
            @Override public void onRecordStopped(String fileName, long bytes, boolean success) {
                if (recorders.get(token) != started) return;
                finish(token, success ? "Enregistrement terminé : " + fileName : "Enregistrement annulé : " + finalTitle);
            }
            @Override public void onRecordError(String message) {
                if (recorders.get(token) != started) return;
                finish(token, "Enregistrement impossible (" + finalTitle + ") : " + message);
            }
        });

        ends.put(token, durationMs > 0 ? System.currentTimeMillis() + durationMs : 0L);
        scheduleStop(token, durationMs);
        return START_NOT_STICKY;
    }

    private void scheduleStop(String token, long delayMs) {
        Runnable previous = stoppers.remove(token);
        if (previous != null) handler.removeCallbacks(previous);
        if (delayMs <= 0) return;
        final Recorder recorder = recorders.get(token);
        Runnable stopper = () -> { if (recorder != null && recorders.get(token) == recorder) recorder.stop(); };
        stoppers.put(token, stopper);
        handler.postDelayed(stopper, delayMs);
    }

    /** Repousse la fin d'un enregistrement en cours pour couvrir une nouvelle programmation. */
    private void extend(String token, long durationMs) {
        Long end = ends.get(token);
        if (end == null || end == 0L) return; // sans limite : rien à prolonger
        long now = System.currentTimeMillis();
        long newEnd = durationMs > 0 ? now + durationMs : 0L;
        if (newEnd != 0L && newEnd <= end) return;
        ends.put(token, newEnd);
        scheduleStop(token, newEnd == 0L ? 0 : newEnd - now);
    }

    private String ongoingText(String fallbackTitle) {
        if (recorders.isEmpty()) return "Enregistrement en cours : " + fallbackTitle;
        if (recorders.size() == 1) return "Enregistrement en cours : " + titles.values().iterator().next();
        return recorders.size() + " enregistrements en cours";
    }

    private void refreshOngoing() {
        if (recorders.isEmpty()) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(ongoingText(""), true));
    }

    /** Un enregistrement est fini : message de fin, puis arrêt du service s'il n'en reste aucun. */
    private void finish(String token, String message) {
        Recorder recorder = recorders.remove(token);
        titles.remove(token);
        urls.remove(token);
        ends.remove(token);
        Runnable stopper = stoppers.remove(token);
        if (stopper != null) handler.removeCallbacks(stopper);
        if (recorder != null) recorder.stop();
        if (recorders.isEmpty()) {
            stopEverything(message);
        } else {
            notifyDone(message);
            refreshOngoing();
        }
    }

    /** Erreur avant tout démarrage : n'arrête le service que si rien d'autre n'enregistre. */
    private void finishIfIdle(String message) {
        if (recorders.isEmpty()) stopEverything(message);
        else { notifyDone(message); refreshOngoing(); }
    }

    private void stopEverything(String message) {
        for (Recorder r : recorders.values()) r.stop();
        recorders.clear();
        titles.clear();
        urls.clear();
        ends.clear();
        stoppers.clear();
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        // Le message final est une notification normale (non « en cours ») : elle
        // reste visible dans le tiroir après l'arrêt du service.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        }
        if (canNotify()) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification(message, false));
        }
        stopSelf();
    }

    private void notifyDone(String message) {
        if (!canNotify()) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(DONE_NOTIF_BASE + (doneCount++ % 50), buildNotification(message, false));
    }

    private boolean canNotify() {
        return Build.VERSION.SDK_INT < 33
            || checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private Notification buildNotification(String text, boolean ongoing) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_stat_cedplay)
            .setContentTitle(getString(R.string.app_name) + " — DVR")
            .setContentText(text)
            .setContentIntent(openAppIntent())
            .setPriority(Notification.PRIORITY_LOW);
        if (ongoing) builder.setOngoing(true);
        else builder.setAutoCancel(true);
        return builder.build();
    }

    private PendingIntent openAppIntent() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) return null;
        return PendingIntent.getActivity(this, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Enregistrements DVR", NotificationManager.IMPORTANCE_LOW);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private void goForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lecteuriptv:dvr");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire();
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        for (Recorder r : recorders.values()) r.stop();
        recorders.clear();
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
