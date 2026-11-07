package com.lecteur.iptv;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Portails Stalker / Ministra (connexion par adresse MAC). Les chaînes d'un portail
 * n'ont pas d'adresse fixe : la page les note « adresse#cedplay-stalker=… » (portail,
 * MAC et commande du portail, en base64) et le lien de lecture est demandé au portail
 * (create_link) juste avant de lire ou d'enregistrer. Jamais d'adresse ni de MAC en journal.
 */
final class Stalker {
    static final String MARK = "#cedplay-stalker=";
    private static final String STB_AGENT = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
    private static final long TOKEN_TTL_MS = 10 * 60_000;
    private static final Map<String, String> tokens = new HashMap<>();
    private static final Map<String, Long> tokenTimes = new HashMap<>();
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());

    private Stalker() {}

    static boolean is(String url) { return url != null && url.contains(MARK); }

    interface Callback { void done(String resolvedUrl); }

    /** Résout hors du fil principal ; le rappel arrive sur le fil principal (null en cas d'échec). */
    static void resolveAsync(Context context, String url, Callback callback) {
        final Context app = context.getApplicationContext();
        executor.execute(() -> {
            String resolved;
            try { resolved = resolve(app, url); } catch (Exception e) { resolved = null; }
            final String result = resolved;
            main.post(() -> callback.done(result));
        });
    }

    /** Lien de lecture à jour (appel réseau : jamais sur le fil principal). */
    static String resolve(Context context, String url) throws IOException {
        if (!is(url)) return url;
        String payload = url.substring(url.indexOf(MARK) + MARK.length());
        String portal, mac, cmd;
        try {
            JSONObject json = new JSONObject(new String(Base64.decode(payload, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP), StandardCharsets.UTF_8));
            portal = json.getString("p"); mac = json.getString("m"); cmd = json.getString("c");
        } catch (Exception e) { throw new IOException("Chaîne de portail illisible"); }
        if (!portal.startsWith("http://") && !portal.startsWith("https://")) throw new IOException("Portail invalide");
        String link = null;
        for (int attempt = 0; attempt < 2 && link == null; attempt++) {
            String token = token(context, portal, mac, attempt > 0);
            JSONObject js = request(context, portal, mac, token, "type=itv&action=create_link&cmd=" + enc(cmd) + "&series=&forced_storage=undefined&disable_ad=0&download=0");
            String value = js == null ? null : js.optString("cmd", null);
            if (value != null) link = stripPrefix(value);
            if (link != null && !(link.startsWith("http://") || link.startsWith("https://"))) link = null;
        }
        if (link == null) throw new IOException("Lien refusé par le portail");
        return link;
    }

    /** « ffmpeg http://… » → « http://… ». */
    static String stripPrefix(String cmd) {
        String value = cmd.trim();
        int space = value.indexOf(' ');
        if (space > 0 && !value.substring(0, space).contains("://")) value = value.substring(space + 1).trim();
        return value;
    }

    private static synchronized String token(Context context, String portal, String mac, boolean renew) throws IOException {
        String key = portal + "|" + mac;
        Long at = tokenTimes.get(key);
        if (!renew && at != null && System.currentTimeMillis() - at < TOKEN_TTL_MS) return tokens.get(key);
        JSONObject js = request(context, portal, mac, null, "type=stb&action=handshake&token=");
        String token = js == null ? null : js.optString("token", "");
        if (token == null || token.isEmpty()) throw new IOException("Portail : poignée de main refusée");
        // Certains portails n'activent le jeton qu'après la lecture du profil.
        try { request(context, portal, mac, token, "type=stb&action=get_profile&hd=1&num_banks=2&stb_type=MAG250&image_version=218&auth_second_step=0&not_valid_token=0&hw_version=1.7-BD-00"); }
        catch (IOException ignored) { /* profil facultatif */ }
        tokens.put(key, token);
        tokenTimes.put(key, System.currentTimeMillis());
        return token;
    }

    private static String enc(String value) {
        try { return URLEncoder.encode(value, "UTF-8"); } catch (Exception e) { return value; }
    }

    private static JSONObject request(Context context, String portal, String mac, String token, String query) throws IOException {
        URL url = new URL(portal + (portal.contains("?") ? "&" : "?") + query + "&JsHttpRequest=1-xml");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("User-Agent", STB_AGENT);
            conn.setRequestProperty("X-User-Agent", "Model: MAG250; Link: WiFi");
            conn.setRequestProperty("Cookie", "mac=" + enc(mac) + "; stb_lang=fr; timezone=" + enc(TimeZone.getDefault().getID()));
            String origin = url.getProtocol() + "://" + url.getAuthority();
            conn.setRequestProperty("Referer", origin + "/c/");
            if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            String body;
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int n; long total = 0;
                while ((n = in.read(buffer)) != -1) { out.write(buffer, 0, n); total += n; if (total > 2_000_000) throw new IOException("Réponse trop longue"); }
                body = out.toString("UTF-8");
            }
            JSONObject json = new JSONObject(body.trim());
            return json.optJSONObject("js");
        } catch (org.json.JSONException e) {
            throw new IOException("Réponse du portail illisible");
        } finally {
            conn.disconnect();
        }
    }
}
