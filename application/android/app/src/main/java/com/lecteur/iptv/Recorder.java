package com.lecteur.iptv;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;

import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Enregistrement « DVR » d'un flux en direct, 100 % légal : on n'enregistre que
 * les flux que l'utilisateur a lui-même ajoutés (playlists publiques légales ou
 * serveurs personnels).
 *
 * Deux chemins, selon le format du flux :
 *  - MPEG-TS brut (.ts) → copie brute des octets vers un fichier .ts (lisible tel quel).
 *  - HLS (.m3u8)        → capture des segments au fil de la liste de lecture : les
 *    segments MPEG-TS sont mis bout à bout (.ts), les segments fMP4 sont précédés de
 *    leur en-tête (.mp4 fragmenté). Chiffrement AES-128 pris en charge. Le fichier
 *    reste lisible à tout moment : un arrêt ne perd rien.
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
        /** L'enregistrement a été coupé par un incident (réseau, stockage) : le fichier partiel est conservé. */
        void onRecordInterrupted(String fileName, long bytes);
        /** Échec : message lisible pour l'utilisateur. */
        void onRecordError(String message);
    }

    /** Échec HLS avec un message destiné à l'utilisateur. */
    private static final class HlsException extends IOException {
        HlsException(String message) { super(message); }
    }

    /** Échecs réseau consécutifs tolérés avant d'abandonner (≈ 1 min sur un direct). */
    private static final int MAX_FAILURES = 12;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Object wake = new Object();

    private Listener listener;
    private volatile String outputName;
    /** Source réseau en cours de lecture : la fermer débloque immédiatement le fil de capture. */
    private volatile DefaultHttpDataSource activeSource;
    private HandlerThread workerThread;
    private Handler workerHandler;
    /** Fige la liste d'origine pour toutes les requêtes, y compris les segments HLS suivants. */
    private String userAgent = PlayerOptions.DEFAULT_USER_AGENT;

    public Recorder(Context context) {
        this.context = context.getApplicationContext();
    }

    public boolean isRecording() {
        return running.get();
    }

    public void start(String url, String title, RecordingTarget.Target target, Listener listener) {
        start(url, title, target, PlayerOptions.userAgent(context), listener);
    }

    public void start(String url, String title, RecordingTarget.Target target, String userAgent, Listener listener) {
        if (!running.compareAndSet(false, true)) return;
        this.userAgent = PlayerOptions.cleanUserAgent(userAgent);
        this.listener = listener;
        final String base = sanitize(title) + "_" + System.currentTimeMillis();
        outputName = base + ".ts";

        workerThread = new HandlerThread("dvr-recorder");
        workerThread.start();
        workerHandler = new Handler(workerThread.getLooper());

        workerHandler.post(() -> {
            try {
                // Portail Stalker : lien de lecture demandé au portail au début de l'enregistrement.
                String source;
                try { source = Stalker.resolve(context, url); }
                catch (IOException e) {
                    running.set(false);
                    main.post(() -> { if (this.listener != null) this.listener.onRecordError("le portail n'a pas donné de lien de lecture"); });
                    return;
                }
                if (isHls(source)) recordHls(source, target, base);
                else recordTs(source, target);
            } catch (Exception e) {
                running.set(false);
                main.post(() -> { if (this.listener != null) this.listener.onRecordError("dossier d'enregistrement inaccessible"); });
            } finally {
                quitWorker();
            }
        });
    }

    public void stop() {
        if (!running.getAndSet(false)) return;
        // Fermer la source débloque la lecture en cours ; réveiller l'attente entre deux segments.
        closeQuietly(activeSource);
        synchronized (wake) { wake.notifyAll(); }
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

    static boolean isHls(String url) {
        if (url == null) return false;
        // .m3u8, mais aussi ?output=m3u8 ou ?type=m3u8 (Xtream, Flussonic).
        return url.toLowerCase(Locale.ROOT).contains("m3u8");
    }

    private String sanitize(String title) {
        if (title == null) title = "Enregistrement";
        String out = title.replaceAll("[^A-Za-z0-9\\-_ ]", "").replaceAll("\\s+", "_").replaceAll("^_+|_+$", "");
        return out == null || out.isEmpty() ? "Enregistrement" : out;
    }

    private DefaultHttpDataSource newSource() {
        return new DefaultHttpDataSource.Factory()
            .setUserAgent(userAgent)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)
            .createDataSource();
    }

    private static void closeQuietly(DefaultHttpDataSource source) {
        if (source != null) {
            try { source.close(); } catch (Exception ignored) {}
        }
    }

    private void postStopped(String name, long bytes) {
        final boolean success = bytes > 0;
        main.post(() -> { if (listener != null) listener.onRecordStopped(name, bytes, success); });
    }

    /** Incident en cours d'enregistrement (réseau, stockage) : le fichier partiel est conservé mais signalé comme tronqué. */
    private void postInterrupted(String name, long bytes) {
        main.post(() -> { if (listener != null) listener.onRecordInterrupted(name, bytes); });
    }

    private void postError(String message) {
        main.post(() -> { if (listener != null) listener.onRecordError(message); });
    }

    // ── MPEG-TS : copie brute ────────────────────────────────────────────
    private void recordTs(String url, RecordingTarget.Target target) throws IOException {
        if (!running.get()) return;
        final String name = outputName;
        final Uri out = target.create("video/mp2t", name);
        if (out == null) { running.set(false); postError("création du fichier impossible"); return; }
        DefaultHttpDataSource source = newSource();
        activeSource = source;
        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        boolean opened = false;
        boolean interrupted = false;
        try (OutputStream os = target.open(out)) {
            if (os == null) { postError("ouverture du fichier impossible"); return; }
            opened = true;
            main.post(() -> { if (listener != null) listener.onRecordStarted(name); });
            try {
                source.open(new DataSpec(Uri.parse(url)));
                int read;
                while (running.get() && (read = source.read(buffer, 0, buffer.length)) != -1) {
                    os.write(buffer, 0, read);
                    total += read;
                }
            } catch (Exception e) {
                // Coupure réseau ou écriture impossible : les octets déjà écrits forment un .ts
                // lisible. `stop()` a posé running=false AVANT de fermer la source : running
                // encore vrai ici signifie un incident, pas un arrêt demandé.
                interrupted = running.get();
            }
            os.flush();
        } finally {
            closeQuietly(source);
            activeSource = null;
            running.set(false);
            if (interrupted) {
                if (total == 0) {
                    target.delete(out);
                    postError("enregistrement interrompu avant la première donnée (réseau ou stockage)");
                } else postInterrupted(name, total);
            } else if (opened) {
                if (total == 0) target.delete(out); // arrêt avant la première donnée : pas de fichier vide
                postStopped(name, total);
            }
        }
    }

    // ── HLS : capture des segments ───────────────────────────────────────

    static final class Segment {
        String uri;
        String keyMethod;
        String keyUri;
        byte[] iv;
        String mapUri;
    }

    static final class Variant {
        String uri;
        long bandwidth;
    }

    static final class Playlist {
        long mediaSequence;
        double targetDuration = 6;
        boolean endList;
        boolean byteRange;
        final List<Segment> segments = new ArrayList<>();
        final List<Variant> variants = new ArrayList<>();
    }

    private static final Pattern ATTR = Pattern.compile("([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)");

    private static Map<String, String> attributes(String line) {
        Map<String, String> out = new HashMap<>();
        int colon = line.indexOf(':');
        if (colon < 0) return out;
        Matcher m = ATTR.matcher(line.substring(colon + 1));
        while (m.find()) {
            String value = m.group(2);
            if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.substring(1, value.length() - 1);
            out.put(m.group(1), value);
        }
        return out;
    }

    private static String resolve(String base, String uri) {
        try { return new URL(new URL(base), uri).toString(); } catch (Exception e) { return uri; }
    }

    private static byte[] hexIv(String hex) {
        if (hex == null) return null;
        String h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.substring(2) : hex;
        if (h.length() > 32) h = h.substring(h.length() - 32);
        while (h.length() < 32) h = "0" + h;
        byte[] out = new byte[16];
        for (int i = 0; i < 16; i++) out[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    /** Analyse une liste HLS (maîtresse ou de médias) ; les adresses sont rendues absolues. */
    static Playlist parsePlaylist(String text, String baseUrl) {
        Playlist pl = new Playlist();
        String keyMethod = null, keyUri = null, mapUri = null;
        byte[] keyIv = null;
        boolean expectSegment = false;
        Variant pendingVariant = null;
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            if (line.startsWith("#EXT-X-STREAM-INF")) {
                pendingVariant = new Variant();
                String bw = attributes(line).get("BANDWIDTH");
                try { pendingVariant.bandwidth = bw == null ? 0 : Long.parseLong(bw.trim()); } catch (NumberFormatException ignored) {}
            } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
                try { pl.mediaSequence = Long.parseLong(line.substring(22).trim()); } catch (NumberFormatException ignored) {}
            } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
                try { pl.targetDuration = Double.parseDouble(line.substring(22).trim()); } catch (NumberFormatException ignored) {}
            } else if (line.startsWith("#EXT-X-ENDLIST")) {
                pl.endList = true;
            } else if (line.startsWith("#EXT-X-BYTERANGE")) {
                pl.byteRange = true;
            } else if (line.startsWith("#EXT-X-KEY:")) {
                Map<String, String> a = attributes(line);
                keyMethod = a.get("METHOD");
                keyUri = a.containsKey("URI") ? resolve(baseUrl, a.get("URI")) : null;
                keyIv = hexIv(a.get("IV"));
                if ("NONE".equalsIgnoreCase(keyMethod)) { keyMethod = null; keyUri = null; keyIv = null; }
            } else if (line.startsWith("#EXT-X-MAP:")) {
                String u = attributes(line).get("URI");
                mapUri = u == null ? null : resolve(baseUrl, u);
            } else if (line.startsWith("#EXTINF")) {
                expectSegment = true;
            } else if (!line.startsWith("#")) {
                if (pendingVariant != null) {
                    pendingVariant.uri = resolve(baseUrl, line);
                    pl.variants.add(pendingVariant);
                    pendingVariant = null;
                } else if (expectSegment) {
                    Segment s = new Segment();
                    s.uri = resolve(baseUrl, line);
                    s.keyMethod = keyMethod;
                    s.keyUri = keyUri;
                    s.iv = keyIv;
                    s.mapUri = mapUri;
                    pl.segments.add(s);
                    expectSegment = false;
                }
            }
        }
        return pl;
    }

    /** Lit une ressource complète ; renvoie aussi l'adresse finale (après redirections). */
    private byte[] fetch(String url, String[] finalUrl) throws IOException {
        DefaultHttpDataSource source = newSource();
        activeSource = source;
        try {
            source.open(new DataSpec(Uri.parse(url)));
            if (finalUrl != null) {
                Uri resolved = source.getUri();
                finalUrl[0] = resolved != null ? resolved.toString() : url;
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream(256 * 1024);
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = source.read(buffer, 0, buffer.length)) != -1) {
                if (!running.get()) throw new IOException("arrêt");
                bos.write(buffer, 0, read);
            }
            return bos.toByteArray();
        } finally {
            closeQuietly(source);
            activeSource = null;
        }
    }

    /** Télécharge la liste de lecture ; une liste maîtresse renvoie la variante au débit le plus élevé. */
    private Playlist loadMediaPlaylist(String url, String[] mediaUrl) throws IOException {
        String[] finalUrl = new String[1];
        Playlist pl = parsePlaylist(new String(fetch(url, finalUrl), StandardCharsets.UTF_8), finalUrl[0]);
        if (!pl.variants.isEmpty() && pl.segments.isEmpty()) {
            Variant best = pl.variants.get(0);
            for (Variant v : pl.variants) if (v.bandwidth > best.bandwidth) best = v;
            pl = parsePlaylist(new String(fetch(best.uri, finalUrl), StandardCharsets.UTF_8), finalUrl[0]);
        }
        mediaUrl[0] = finalUrl[0];
        return pl;
    }

    private byte[] decrypt(byte[] data, Segment s, long sequence, Map<String, byte[]> keys) throws IOException {
        if (s.keyMethod == null) return data;
        if (!"AES-128".equalsIgnoreCase(s.keyMethod) || s.keyUri == null) throw new HlsException("flux HLS chiffré non pris en charge");
        byte[] key = keys.get(s.keyUri);
        if (key == null) {
            key = fetch(s.keyUri, null);
            if (key.length != 16) throw new HlsException("clé de chiffrement illisible");
            keys.put(s.keyUri, key);
        }
        byte[] iv = s.iv;
        if (iv == null) {
            iv = new byte[16];
            for (int i = 15; i >= 8; i--) { iv[i] = (byte) (sequence & 0xff); sequence >>= 8; }
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
            return cipher.doFinal(data);
        } catch (Exception e) {
            throw new HlsException("déchiffrement impossible");
        }
    }

    private void pause(long ms) {
        synchronized (wake) {
            if (!running.get()) return;
            try { wake.wait(ms); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
    }

    private void recordHls(String url, RecordingTarget.Target target, String base) throws IOException {
        String[] mediaUrl = new String[1];
        Playlist pl;
        try {
            pl = loadMediaPlaylist(url, mediaUrl);
        } catch (Exception e) {
            running.set(false);
            postError(e instanceof HlsException ? e.getMessage() : "flux HLS inaccessible");
            return;
        }
        if (pl.byteRange) { running.set(false); postError("format HLS non pris en charge (plages d'octets)"); return; }
        if (pl.segments.isEmpty()) { running.set(false); postError("flux HLS vide"); return; }

        final boolean fmp4 = pl.segments.get(0).mapUri != null;
        final String name = base + (fmp4 ? ".mp4" : ".ts");
        outputName = name;
        final Uri out = target.create(fmp4 ? "video/mp4" : "video/mp2t", name);
        if (out == null) { running.set(false); postError("création du fichier impossible"); return; }

        long total = 0;
        String error = null;
        try (OutputStream os = target.open(out)) {
            if (os == null) { running.set(false); postError("ouverture du fichier impossible"); return; }
            main.post(() -> { if (listener != null) listener.onRecordStarted(name); });
            Map<String, byte[]> keys = new HashMap<>();
            String writtenMap = null;
            // Direct : partir près du bord (3 segments), comme un lecteur. Archive (liste finie) : depuis le début.
            long next = pl.endList ? pl.mediaSequence : Math.max(pl.mediaSequence, pl.mediaSequence + pl.segments.size() - 3);
            int failures = 0;
            while (running.get()) {
                // Segments manqués (liste trop courte ou retard) : reprendre au plus ancien disponible.
                if (next < pl.mediaSequence) next = pl.mediaSequence;
                for (int i = 0; i < pl.segments.size() && running.get(); i++) {
                    long sequence = pl.mediaSequence + i;
                    if (sequence < next) continue;
                    Segment s = pl.segments.get(i);
                    try {
                        if (s.mapUri != null && !s.mapUri.equals(writtenMap)) {
                            byte[] init = fetch(s.mapUri, null);
                            os.write(init);
                            total += init.length;
                            writtenMap = s.mapUri;
                        }
                        byte[] data = decrypt(fetch(s.uri, null), s, sequence, keys);
                        os.write(data);
                        total += data.length;
                        failures = 0;
                    } catch (HlsException e) {
                        throw e;
                    } catch (IOException e) {
                        if (!running.get()) break;
                        // Segment perdu : on passe au suivant plutôt que de bloquer l'enregistrement.
                        if (++failures > MAX_FAILURES) throw new HlsException("flux interrompu");
                    }
                    next = sequence + 1;
                }
                os.flush();
                if (!running.get() || (pl.endList && next >= pl.mediaSequence + pl.segments.size())) break;
                pause((long) Math.max(1000, Math.min(10_000, pl.targetDuration * 500)));
                if (!running.get()) break;
                try {
                    pl = loadMediaPlaylist(mediaUrl[0], mediaUrl);
                } catch (IOException e) {
                    if (!running.get()) break;
                    if (++failures > MAX_FAILURES) throw new HlsException("flux interrompu");
                    pause(2000);
                }
            }
            os.flush();
        } catch (HlsException e) {
            error = e.getMessage();
        } catch (IOException e) {
            if (running.get()) error = "écriture impossible";
        } finally {
            running.set(false);
        }
        if (error != null && total == 0) {
            target.delete(out);
            postError(error);
        } else if (error != null) {
            // Incident en cours d'enregistrement : ce qui a été capturé reste lisible,
            // mais l'utilisateur doit savoir que le fichier est tronqué.
            postInterrupted(name, total);
        } else {
            // Un arrêt volontaire garde ce qui a été capturé : le fichier est lisible.
            if (total == 0) target.delete(out); // arrêt avant la première donnée : pas de fichier vide
            postStopped(name, total);
        }
    }
}
