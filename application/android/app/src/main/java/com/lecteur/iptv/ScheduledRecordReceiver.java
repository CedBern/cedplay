package com.lecteur.iptv;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

/**
 * Déclenché par l'alarme (AlarmManager) au moment programmé : retire la
 * programmation de la liste et démarre {@link RecordService} au premier plan.
 * Expose aussi les méthodes statiques de pose/annulation d'alarme, partagées
 * avec le pont Capacitor et la re-planification au redémarrage (BootReceiver).
 */
public class ScheduledRecordReceiver extends BroadcastReceiver {

    public static final String ACTION = "com.lecteur.iptv.SCHEDULED_RECORD";
    private static final String CHANNEL_ID = "recordings";

    @Override
    public void onReceive(Context context, Intent intent) {
        String url = intent.getStringExtra("url");
        String title = intent.getStringExtra("title");
        long durationMs = intent.getLongExtra("durationMs", 0);
        String scheduleId = intent.getStringExtra("scheduleId");

        Intent service = new Intent(context, RecordService.class);
        service.putExtra(RecordService.EXTRA_URL, url);
        service.putExtra(RecordService.EXTRA_TITLE, title);
        service.putExtra(RecordService.EXTRA_DURATION_MS, durationMs);
        service.putExtra(RecordService.EXTRA_USER_AGENT,
            PlayerOptions.cleanUserAgent(intent.getStringExtra("userAgent")));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
            // Le service a démarré : la programmation est consommée.
            if (scheduleId != null) ScheduleStore.remove(context, scheduleId);
        } catch (Exception e) {
            // Android 12+ : démarrage de service au premier plan interdit en
            // arrière-plan quand l'alarme est inexacte (autorisation absente).
            // On prévient l'utilisateur et la programmation reste visible dans l'app.
            notifyFailure(context, title);
        }
    }

    /** Pose l'alarme de l'enregistrement programmé (exacte si autorisée). */
    public static void setAlarm(Context context, String id, long startTimeMs, String url, String title, long durationMs, String userAgent) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(context, ScheduledRecordReceiver.class);
        intent.setAction(ACTION);
        intent.setData(Uri.parse("iptvrec://" + id));
        intent.putExtra("scheduleId", id);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        intent.putExtra("durationMs", durationMs);
        intent.putExtra("userAgent", PlayerOptions.cleanUserAgent(userAgent));
        PendingIntent pi = PendingIntent.getBroadcast(context, id.hashCode(),
            intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Alarme exacte si autorisée, sinon alarme approximative (doze-friendly).
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if (exact) {
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, startTimeMs, pi);
                return;
            } catch (SecurityException ignored) {}
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, startTimeMs, pi);
    }

    public static void cancelAlarm(Context context, String id) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(context, ScheduledRecordReceiver.class);
        intent.setAction(ACTION);
        intent.setData(Uri.parse("iptvrec://" + id));
        PendingIntent pi = PendingIntent.getBroadcast(context, id.hashCode(),
            intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
    }

    private void notifyFailure(Context context, String title) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "Enregistrements DVR", NotificationManager.IMPORTANCE_HIGH));
            }
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
            builder.setSmallIcon(context.getApplicationInfo().icon)
                .setContentTitle("Enregistrement programmé impossible")
                .setContentText((title == null ? "Une chaîne" : title)
                    + " : Android a bloqué le démarrage en arrière-plan. Ouvre l'app et autorise les alarmes exactes.")
                .setAutoCancel(true)
                .setPriority(Notification.PRIORITY_HIGH);
            nm.notify(4002, builder.build());
        } catch (Exception ignored) {}
    }
}
