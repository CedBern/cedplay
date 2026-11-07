package com.lecteur.iptv;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;

import androidx.documentfile.provider.DocumentFile;
import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Enregistrement « DVR » d'un flux en direct, 100 % légal : on n'enregistre que
 * les flux que l'utilisateur a lui-même ajoutés (playlists publiques légales ou
 * serveurs personnels).
 *
 * Deux chemins, selon le format du flux :
 *  - MPEG-TS brut (.ts)  → copie brute des octets vers un fichier .ts (lisible tel quel).
 *  - HLS (.m3u8)         → remux en MP4 via Media3 Transformer (sans ré-encodage).
 *
 * Le résultat est écrit dans un dossier SAF choisi par l'utilisateur (écriture).
 * Les rappels d'état sont émis sur le thread principal.
 */
@UnstableApi
public class Recorder {

    public interface Listener {
        /** L'enregistrement a démarré (nom du fichier créé). */
        void onRecordStarted(String fileName);
        /** L'enregistrement s'est arrêté (succès = fichier finalisé et lisible). */
        void onRecordStopped(String fileName, long bytes, boolean success);
        /** Échec : message lisible pour l'utilisateur. */
        void onRecordError(String message);
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean running = new AtomicBoolean(false);

    private Listener listener;
    private volatile String outputName;
    private volatile DefaultHttpDataSource tsSource;
    private volatile Transformer transformer;
    private volatile File hlsTmp;
    private HandlerThread workerThread;
    private Handler workerHandler;

    public Recorder(Context context) {
        this.context = context.getApplicationContext();
    }

    public boolean isRecording() {
        return running.get();
    }

    public void start(String url, String title, DocumentFile dir, Listener listener) {
        // Transformer.cancel() ne finalise pas un direct HLS : le fichier était
        // supprimé à l'arrêt. Ne pas annoncer un enregistrement qui sera perdu.
        if (isHls(url)) {
            main.post(() -> listener.onRecordError("Direct HLS non pris en charge. Choisis la variante MPEG-TS de la chaîne."));
            return;
        }
        if (!running.compareAndSet(false, true)) return;
        this.listener = listener;
        boolean hls = isHls(url);
        String safe = sanitize(title);
        outputName = safe + "_" + System.currentTimeMillis() + (hls ? ".mp4" : ".ts");

        workerThread = new HandlerThread("dvr-recorder");
        workerThread.start();
        workerHandler = new Handler(workerThread.getLooper());

        if (hls) workerHandler.post(() -> startHls(url, dir));
        else workerHandler.post(() -> {
            try { startTs(url, dir); }
            catch (Exception e) {
                running.set(false); quitWorker();
                main.post(() -> listener.onRecordError("dossier d'enregistrement inaccessible"));
            }
        });
    }

    public void stop() {
        if (!running.getAndSet(false)) return;
        // TS : fermer la source débloque immédiatement la boucle de lecture.
        if (tsSource != null) {
            try { tsSource.close(); } catch (Exception ignored) {}
        }
        // HLS : annuler le Transformer. Sur un flux réellement « live » (sans fin),
        // le MP4 ne peut pas être finalisé : on nettoie le fichier partiel.
        if (transformer != null) {
            try { transformer.cancel(); } catch (Exception ignored) {}
            transformer = null;
            final File tmp = hlsTmp;
            if (tmp != null) {
                try { if (tmp.exists()) tmp.delete(); } catch (Exception ignored) {}
            }
            final String name = outputName;
            quitWorker();
            main.post(() -> {
                if (listener != null) listener.onRecordStopped(name, 0, false);
            });
        }
    }

    /** Libère le HandlerThread : un thread fuirait sinon par enregistrement. */
    private void quitWorker() {
        final HandlerThread thread = workerThread;
        workerThread = null;
        workerHandler = null;
        if (thread != null) {
            try { thread.quitSafely(); } catch (Exception ignored) {}
        }
    }

    private boolean isHls(String url) {
        if (url == null) return false;
        return url.toLowerCase(Locale.ROOT).contains(".m3u8");
    }

    private String sanitize(String title) {
        if (title == null) title = "Enregistrement";
        String out = title.replaceAll("[^A-Za-z0-9\\-_ ]", "").replaceAll("\\s+", "_").replaceAll("^_+|_+$", "");
        return out == null || out.isEmpty() ? "Enregistrement" : out;
    }

    // ── MPEG-TS : copie brute ────────────────────────────────────────────
    private void startTs(String url, DocumentFile dir) {
        if (!running.get()) { quitWorker(); return; }
        DocumentFile out = dir.createFile("video/mp2t", outputName);
        if (out == null) {
            main.post(() -> { if (listener != null) listener.onRecordError("création du fichier impossible"); });
            running.set(false);
            quitWorker();
            return;
        }
        DefaultHttpDataSource source = new DefaultHttpDataSource.Factory()
            .setUserAgent("IPTVSmartersPro")
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)
            .createDataSource();
        tsSource = source;
        byte[] buffer = new byte[64 * 1024];
        final long[] total = { 0 };
        final String name = outputName;
        main.post(() -> { if (listener != null) listener.onRecordStarted(name); });
        try {
            source.open(new DataSpec(Uri.parse(url)));
            try (OutputStream os = context.getContentResolver().openOutputStream(out.getUri(), "w")) {
                if (os == null) {
                    main.post(() -> { if (listener != null) listener.onRecordError("ouverture du fichier impossible"); });
                    return;
                }
                int read;
                while (running.get() && (read = source.read(buffer, 0, buffer.length)) != -1) {
                    os.write(buffer, 0, read);
                    total[0] += read;
                }
                os.flush();
            }
            // Arrêt volontaire : les octets déjà écrits forment un .ts lisible.
            main.post(() -> { if (listener != null) listener.onRecordStopped(name, total[0], total[0] > 0); });
        } catch (Exception e) {
            main.post(() -> { if (listener != null) listener.onRecordStopped(name, total[0], total[0] > 0); });
        } finally {
            try { source.close(); } catch (Exception ignored) {}
            tsSource = null;
            running.set(false);
            quitWorker();
        }
    }

    // ── HLS : remux en MP4 ───────────────────────────────────────────────
    private void startHls(String url, DocumentFile dir) {
        if (!running.get()) return;
        final File tmp = new File(context.getCacheDir(), "dvr-" + outputName + ".part");
        hlsTmp = tmp;
        final String name = outputName;
        try {
            Transformer t = new Transformer.Builder(context)
                .setListener(new Transformer.Listener() {
                    @Override
                    public void onCompleted(Composition composition, ExportResult exportResult) {
                        finalizeHls(tmp, dir, name);
                    }

                    @Override
                    public void onError(Composition composition, ExportResult exportResult, ExportException exception) {
                        final boolean wasRunning = running.get();
                        running.set(false);
                        try { if (tmp.exists()) tmp.delete(); } catch (Exception ignored) {}
                        quitWorker();
                        if (wasRunning) {
                            main.post(() -> {
                                if (listener != null) listener.onRecordError("remux impossible");
                            });
                        }
                    }
                })
                .build();
            transformer = t;
            if (!running.get()) { t.cancel(); return; }
            MediaItem mediaItem = new MediaItem.Builder().setUri(url).build();
            EditedMediaItem edited = new EditedMediaItem.Builder(mediaItem).build();
            EditedMediaItemSequence sequence = new EditedMediaItemSequence(Collections.singletonList(edited));
            Composition composition = new Composition.Builder(sequence).build();
            main.post(() -> { if (listener != null) listener.onRecordStarted(name); });
            t.start(composition, tmp.getAbsolutePath());
        } catch (Exception e) {
            running.set(false);
            quitWorker();
            main.post(() -> { if (listener != null) listener.onRecordError("remux impossible"); });
        }
    }

    private void finalizeHls(File tmp, DocumentFile dir, String name) {
        long size = 0;
        boolean ok = false;
        try {
            size = tmp.length();
            if (size > 0) {
                DocumentFile out = dir.createFile("video/mp4", name);
                if (out != null) {
                    try (InputStream in = new FileInputStream(tmp);
                         OutputStream os = context.getContentResolver().openOutputStream(out.getUri(), "w")) {
                        if (os != null) {
                            byte[] buffer = new byte[64 * 1024];
                            int read;
                            while ((read = in.read(buffer)) != -1) os.write(buffer, 0, read);
                            os.flush();
                            ok = true;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        try { if (tmp.exists()) tmp.delete(); } catch (Exception ignored) {}
        final boolean success = ok && size > 0;
        final long bytes = success ? size : 0;
        final boolean wasRunning = running.getAndSet(false);
        quitWorker();
        if (!wasRunning) {
            // Arrêt demandé pendant la finalisation : on ne notifie pas deux fois.
            return;
        }
        main.post(() -> { if (listener != null) listener.onRecordStopped(name, bytes, success); });
    }
}
