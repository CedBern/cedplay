package com.lecteur.iptv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-planifie les enregistrements programmés après un redémarrage de
 * l'appareil (les alarmes AlarmManager sont perdues au reboot).
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        ScheduleStore.rescheduleAll(context);
    }
}
