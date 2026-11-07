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

/**
 * Service au premier plan qui enregistre un flux programmé (DVR différé).
 * Réutilise {@link Recorder} (TS brut ou HLS remuxé en MP4) et écrit dans le
 * dossier d'enregistrement SAF choisi par l'utilisateur. S'arrête après la durée
 * demandée ou à la fin de l'enregistrement.
 */
public class RecordService extends Service {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_DURATION_MS = "durationMs";

    private static final int NOTIF_ID = 4001;
    private static final String CHANNEL_ID = "recordings";

    private Recorder recorder;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String title = "Enregistrement";
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Ré-entrée (double alarme, relance JS) : ne pas écraser un enregistrement
        // en cours — l'ancien Recorder continuerait d'écrire en arrière-plan.
        if (recorder != null) {
            showNotification("Un enregistrement est déjà en cours : " + title);
            return START_NOT_STICKY;
        }
        String url = intent == null ? null : intent.getStringExtra(EXTRA_URL);
        title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        long durationMs = intent == null ? 0 : intent.getLongExtra(EXTRA_DURATION_MS, 0);
        if (title == null || title.isEmpty()) title = "Enregistrement";

        // Le service au premier plan doit s'annoncer immédiatement (API 26+).
        goForeground(buildNotification("Enregistrement en cours : " + title, true));

        if (url == null || url.isEmpty()) {
            stopRecording("Flux manquant");
            return START_NOT_STICKY;
        }
        String folderUri = getSharedPreferences("recorder", MODE_PRIVATE).getString("folder", null);
        if (folderUri == null) {
            stopRecording("Aucun dossier d'enregistrement choisi");
            return START_NOT_STICKY;
        }
        DocumentFile dir = DocumentFile.fromTreeUri(this, Uri.parse(folderUri));
        if (dir == null || !dir.canWrite()) {
            stopRecording("Dossier d'enregistrement inaccessible");
            return START_NOT_STICKY;
        }

        // WakeLock partiel : le Doze ne doit pas geler la capture quand l'écran
        // est éteint. Relâché dans tous les chemins d'arrêt.
        acquireWakeLock();

        final Recorder started = new Recorder(this);
        recorder = started;
        started.start(url, title, dir, new Recorder.Listener() {
            @Override public void onRecordStarted(String fileName) {
                if (recorder != started) return;
                showNotification("Enregistrement en cours : " + title);
            }
            @Override public void onRecordStopped(String fileName, long bytes, boolean success) {
                if (recorder != started) return;
                stopRecording(success ? "Enregistrement terminé : " + fileName : "Enregistrement annulé");
            }
            @Override public void onRecordError(String message) {
                if (recorder != started) return;
                stopRecording("Enregistrement impossible : " + message);
            }
        });

        if (durationMs > 0) {
            handler.postDelayed(() -> { if (recorder == started) started.stop(); }, durationMs);
        }
        return START_NOT_STICKY;
    }

    private void stopRecording(String message) {
        if (recorder != null) { recorder.stop(); recorder = null; }
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        // Le message final est une notification normale (non « en cours ») : elle
        // reste visible dans le tiroir après l'arrêt du service.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                // Sans autorisation de notification, on s'arrête simplement.
            } else {
                nm.notify(NOTIF_ID, buildNotification(message, false));
            }
        }
        stopSelf();
    }

    private void showNotification(String message) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(message, true));
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
        if (recorder != null) { recorder.stop(); recorder = null; }
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
