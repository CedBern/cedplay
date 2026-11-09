package com.lecteur.iptv;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.JsonWriter;
import java.io.File;
import java.io.OutputStreamWriter;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    /** Analyse des dossiers hors du thread principal (grosses clés USB). */
    private static final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
    private static final int LOCAL_SCAN_LIMIT = 2000;
    private static final String[] VIDEO_EXTENSIONS = {
        "mp4", "mkv", "avi", "mov", "m4v", "ts", "m2ts", "mts", "webm",
        "mpg", "mpeg", "flv", "wmv", "3gp", "3g2", "vob", "divx", "ogv", "f4v"
    };

    /** Liste complète de zapping (url, titre, groupe, numéro par ligne), écrite une fois par changement de liste. */
    static final String ZAP_LIST_NAME = "zaplist.tsv";
    private static String zapListKey = null;
    private static int zapListSize = 0;

    @PluginMethod
    public void setZapList(PluginCall call) {
        String key = call.getString("key");
        String data = call.getString("data");
        int count = call.getInt("count", 0);
        if (key == null || key.isEmpty() || key.indexOf('\n') >= 0 || data == null || count <= 0) { call.reject("Liste vide"); return; }
        File target = new File(getContext().getCacheDir(), ZAP_LIST_NAME);
        File temp = new File(getContext().getCacheDir(), ZAP_LIST_NAME + ".tmp");
        try (OutputStreamWriter writer = new OutputStreamWriter(new FileOutputStream(temp), StandardCharsets.UTF_8)) {
            writer.write(key);
            writer.write('\n');
            writer.write(data);
        } catch (Exception e) {
            temp.delete();
            call.reject("Écriture impossible");
            return;
        }
        if (!temp.renameTo(target)) { temp.delete(); zapListKey = null; call.reject("Écriture impossible"); return; }
        zapListKey = key;
        zapListSize = count;
        call.resolve();
    }

    @PluginMethod
    public void open(PluginCall call) {
        // Mesures sans URL, titre ou identifiant de compte.
        android.util.Log.i("IPTV-Playback", "launch_requested elapsed_ms=" + android.os.SystemClock.elapsedRealtime());
        String url = call.getString("url");
        String title = call.getString("title", getContext().getString(R.string.app_name));
        if (!isHttpUrl(url)) {
            call.reject("URL HTTP ou HTTPS requise");
            return;
        }

        File channelFile = null;
        try {
            Intent intent = new Intent(getContext(), NativePlayerActivity.class);
            intent.putExtra(NativePlayerActivity.EXTRA_URL, url);
            intent.putExtra(NativePlayerActivity.EXTRA_TITLE, title);
            putTvUi(call, intent);
            // Le contexte reste dans le cache privé : aucune grande liste dans le message Binder.
            JSArray urls = call.getArray("channelUrls", null);
            JSArray titles = call.getArray("channelTitles", null);
            int index = call.getInt("channelIndex", -1);
            if (urls != null && titles != null && urls.length() == titles.length()
                    && index >= 0 && index < urls.length()) {
                ArrayList<String> urlList = new ArrayList<>();
                ArrayList<String> titleList = new ArrayList<>();
                for (int i = 0; i < urls.length(); i++) {
                    String u = urls.optString(i);
                    if (!isHttpUrl(u)) { urlList = null; break; }
                    urlList.add(u);
                    titleList.add(titles.optString(i, "Chaîne " + (i + 1)));
                }
                if (urlList != null && url.equals(urlList.get(index))) {
                    // Groupes et programmes (facultatifs) : alimentent le bandeau et le panneau des chaînes.
                    JSArray groups = call.getArray("channelGroups", null);
                    JSArray epg = call.getArray("channelEpg", null);
                    JSArray numbers = call.getArray("channelNumbers", null);
                    JSArray logos = call.getArray("channelLogos", null);
                    if (groups != null && groups.length() != urlList.size()) groups = null;
                    if (epg != null && epg.length() != urlList.size()) epg = null;
                    if (numbers != null && numbers.length() != urlList.size()) numbers = null;
                    if (logos != null && logos.length() != urlList.size()) logos = null;
                    channelFile = File.createTempFile("zap-", ".json", getContext().getCacheDir());
                    try (JsonWriter writer = new JsonWriter(new OutputStreamWriter(new FileOutputStream(channelFile), StandardCharsets.UTF_8))) {
                        writer.beginArray();
                        for (int i = 0; i < urlList.size(); i++) {
                            writer.beginArray().value(urlList.get(i)).value(titleList.get(i));
                            writer.value(groups != null ? groups.optString(i, "") : "");
                            writer.beginArray();
                            org.json.JSONArray programs = epg != null ? epg.optJSONArray(i) : null;
                            if (programs != null) {
                                for (int j = 0; j < programs.length() && j < 8; j++) {
                                    org.json.JSONArray p = programs.optJSONArray(j);
                                    if (p == null || p.length() < 3) continue;
                                    writer.beginArray().value(p.optLong(0)).value(p.optLong(1)).value(p.optString(2, "")).endArray();
                                }
                            }
                            writer.endArray();
                            writer.value(numbers != null ? numbers.optString(i, "") : "");
                            writer.value(logos != null ? logos.optString(i, "") : "");
                            writer.endArray();
                        }
                        writer.endArray();
                    }
                    intent.putExtra("channelFile", channelFile.getAbsolutePath());
                    intent.putExtra("channelIndex", index);
                    intent.putExtra("channelTotal", Math.max(urlList.size(), call.getInt("channelTotal", urlList.size())));
                    // Liste complète déjà transmise : le lecteur zappe sur toutes les chaînes ; la
                    // fenêtre ci-dessus reste le repli (et porte le guide des chaînes voisines).
                    String listKey = call.getString("listKey");
                    int listIndex = call.getInt("listIndex", -1);
                    int windowStart = call.getInt("windowStart", -1);
                    if (listKey != null && listKey.equals(zapListKey) && listIndex >= 0 && listIndex < zapListSize
                            && windowStart >= 0 && windowStart + index == listIndex) {
                        intent.putExtra("channelList", new File(getContext().getCacheDir(), ZAP_LIST_NAME).getAbsolutePath());
                        intent.putExtra("listKey", listKey);
                        intent.putExtra("listIndex", listIndex);
                        intent.putExtra("windowStart", windowStart);
                    }
                }
            }
            if (call.getData() != null) {
                call.getData().remove("channelUrls");
                call.getData().remove("channelTitles");
                call.getData().remove("channelGroups");
                call.getData().remove("channelEpg");
                call.getData().remove("channelNumbers");
                call.getData().remove("channelLogos");
            }
            launchPlayer(call, intent);
        } catch (Exception e) {
            if (channelFile != null) channelFile.delete();
            call.reject("Impossible de lancer le lecteur natif");
        }
    }

    @PluginMethod
    public void openMosaic(PluginCall call) {
        JSArray streams = call.getArray("streams");
        if (streams == null || streams.length() < 2 || streams.length() > 8) { call.reject("Choisir 2 à 8 chaînes"); return; }
        ArrayList<String> urls = new ArrayList<>();
        ArrayList<String> titles = new ArrayList<>();
        HashSet<String> seen = new HashSet<>();
        for (int i = 0; i < streams.length(); i++) {
            JSONObject stream = streams.optJSONObject(i);
            String url = stream == null ? null : stream.optString("url");
            if (!isHttpUrl(url) || !seen.add(url)) { call.reject("Flux invalide ou répété"); return; }
            urls.add(url); titles.add(stream.optString("title", "Chaîne " + (i + 1)));
        }
        try {
            Intent intent = new Intent(getContext(), MosaicPlayerActivity.class);
            intent.putStringArrayListExtra("urls", urls); intent.putStringArrayListExtra("titles", titles);
            if (call.getData() != null) {
                call.getData().remove("streams");
            }
            launchPlayer(call, intent);
        } catch (Exception e) { call.reject("Impossible de lancer la mosaïque"); }
    }

    @PluginMethod
    public void openVod(PluginCall call) {
        String url = call.getString("url");
        if (!isHttpUrl(url)) { call.reject("URL HTTP ou HTTPS requise"); return; }
        try {
            Intent intent = new Intent(getContext(), NativePlayerActivity.class);
            intent.putExtra(NativePlayerActivity.EXTRA_URL, url);
            intent.putExtra(NativePlayerActivity.EXTRA_TITLE, call.getString("title", "Vidéo"));
            intent.putExtra("vod", true);
            putTvUi(call, intent);
            intent.putExtra("mediaId", call.getString("mediaId", ""));
            intent.putExtra("startPositionMs", Math.max(0, call.getDouble("startPositionMs", 0.0).longValue()));
            intent.putExtra("restart", call.getBoolean("restart", false));
            // Support season episodes list if provided (for series next/previous episode)
            JSArray urls = call.getArray("channelUrls", null);
            JSArray titles = call.getArray("channelTitles", null);
            JSArray ids = call.getArray("episodeIds", null);
            int index = call.getInt("channelIndex", -1);
            if (urls != null && titles != null && urls.length() == titles.length()
                    && index >= 0 && index < urls.length()) {
                ArrayList<String> urlList = new ArrayList<>();
                ArrayList<String> titleList = new ArrayList<>();
                for (int i = 0; i < urls.length(); i++) {
                    String u = urls.optString(i);
                    if (!isHttpUrl(u)) { urlList = null; break; }
                    urlList.add(u);
                    titleList.add(titles.optString(i, "Épisode " + (i + 1)));
                }
                if (urlList != null && url.equals(urlList.get(index))) {
                    File channelFile = File.createTempFile("zap-", ".json", getContext().getCacheDir());
                    try (JsonWriter writer = new JsonWriter(new OutputStreamWriter(new FileOutputStream(channelFile), StandardCharsets.UTF_8))) {
                        writer.beginArray();
                        for (int i = 0; i < urlList.size(); i++) {
                            writer.beginArray().value(urlList.get(i)).value(titleList.get(i)).endArray();
                        }
                        writer.endArray();
                    }
                    intent.putExtra("channelFile", channelFile.getAbsolutePath());
                    intent.putExtra("channelIndex", index);
                    if (ids != null && ids.length() == urlList.size()) {
                        ArrayList<String> idList = new ArrayList<>();
                        for (int i = 0; i < ids.length(); i++) idList.add(ids.optString(i, ""));
                        intent.putStringArrayListExtra("episodeIds", idList);
                    }
                }
            }
            String subtitleContent = call.getString("subtitleContent");
            if (subtitleContent != null && !subtitleContent.trim().isEmpty()) {
                File subFile = File.createTempFile("sub-", ".srt", getContext().getCacheDir());
                try (OutputStreamWriter writer = new OutputStreamWriter(new FileOutputStream(subFile), StandardCharsets.UTF_8)) {
                    writer.write(subtitleContent);
                }
                intent.putExtra("subtitleFile", subFile.getAbsolutePath());
            } else {
                String subtitleUrl = call.getString("subtitleUrl");
                if (subtitleUrl != null && !subtitleUrl.trim().isEmpty()) {
                    intent.putExtra("subtitleUrl", subtitleUrl);
                }
            }
            if (call.getData() != null) {
                call.getData().remove("channelUrls");
                call.getData().remove("channelTitles");
                call.getData().remove("episodeIds");
                call.getData().remove("subtitleContent");
            }
            launchPlayer(call, intent);
        } catch (Exception e) { call.reject("Impossible de lancer la vidéo"); }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", getContext().getString(R.string.app_name));
        if (!isHttpUrl(url)) {
            call.reject("URL HTTP ou HTTPS requise");
            return;
        }
        // Portail Stalker : le lecteur externe reçoit le lien de lecture demandé au portail.
        if (Stalker.is(url)) {
            Stalker.resolveAsync(getContext(), url, resolved -> {
                if (resolved == null) call.reject("Le portail n'a pas donné de lien de lecture");
                else launchExternal(call, resolved, title);
            });
            return;
        }
        launchExternal(call, url, title);
    }

    private void launchExternal(PluginCall call, String url, String title) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            Uri uri = Uri.parse(url);
            String type = "video/*";
            String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(java.util.Locale.ROOT);
            if (path.endsWith(".m3u8")) type = "application/x-mpegurl";
            else if (path.endsWith(".ts")) type = "video/mp2t";
            intent.setDataAndType(uri, type);
            intent.putExtra("title", title);
            Intent chooser = Intent.createChooser(intent, "Ouvrir avec...");
            launchPlayer(call, chooser);
        } catch (Exception e) {
            call.reject("Impossible de lancer le lecteur externe");
        }
    }

    /** Mode d'interface de la page (réglage Auto / TV / Mobile) : le lecteur adopte le même. */
    private static void putTvUi(PluginCall call, Intent intent) {
        Boolean tvUi = call.getBoolean("tvUi");
        if (tvUi != null) intent.putExtra("tvUi", tvUi.booleanValue());
    }

    private boolean isHttpUrl(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
            && uri.getHost() != null && !uri.getHost().isEmpty();
    }

    @PluginMethod
    public void openWeb(PluginCall call) {
        String url = call.getString("url");
        if (!isHttpUrl(url)) {
            call.reject("URL HTTP ou HTTPS requise");
            return;
        }
        Uri uri = Uri.parse(url);
        // Paquets candidats transmis par le web (applications officielles de la plateforme).
        JSArray packages = call.getArray("packages", null);
        java.util.List<String> candidates = new ArrayList<>();
        if (packages != null) {
            try {
                for (int i = 0; i < packages.length(); i++) {
                    String pkg = packages.getString(i);
                    if (pkg != null && !pkg.trim().isEmpty()) candidates.add(pkg.trim());
                }
            } catch (Exception e) {
                // JSON illisible : on retombe sur le navigateur seul.
            }
        }
        Boolean allowAppHome = call.getBoolean("allowAppHome");
        PackageManager pm = getContext().getPackageManager();
        for (String pkg : candidates) {
            // 1. La page exacte est gérée par l'app (App Links vérifiés) : on l'ouvre dedans.
            try {
                Intent appIntent = new Intent(Intent.ACTION_VIEW, uri);
                appIntent.setPackage(pkg);
                if (appIntent.resolveActivity(pm) != null) {
                    appIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(appIntent);
                    call.resolve();
                    return;
                }
            } catch (Exception ignored) {
                // App non résolue : on passe au paquet suivant ou au navigateur.
            }
            // 2. Page non gérée : quand c'est demandé (tuile de plateforme), ouvrir quand
            //    même l'application à son accueil plutôt que la page web. Les applications
            //    TV ne déclarent que LEANBACK_LAUNCHER : essayer les deux.
            if (Boolean.TRUE.equals(allowAppHome)) {
                try {
                    Intent home = pm.getLaunchIntentForPackage(pkg);
                    if (home == null) home = pm.getLeanbackLaunchIntentForPackage(pkg);
                    if (home != null) {
                        home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(home);
                        call.resolve();
                        return;
                    }
                } catch (Exception ignored) {
                    // Paquet suivant ou navigateur.
                }
            }
        }
        try {
            // Aucune app officielle (ou page gérée) : navigateur par défaut, comme avant.
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Impossible d'ouvrir le lien");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Bibliothèque locale (USB / disque dur / carte SD) — Storage Access Framework.
    // Lecture des fichiers vidéo de l'utilisateur uniquement, aucun flux tiers.
    // ─────────────────────────────────────────────────────────────────────

    private SharedPreferences localPrefs() {
        return getContext().getSharedPreferences("local_library", Context.MODE_PRIVATE);
    }

    private org.json.JSONArray loadLocalFolders() {
        String raw = localPrefs().getString("folders", "[]");
        try { return new org.json.JSONArray(raw); } catch (Exception e) { return new org.json.JSONArray(); }
    }

    private void saveLocalFolders(org.json.JSONArray folders) {
        localPrefs().edit().putString("folders", folders.toString()).apply();
    }

    private String folderDisplayName(Uri treeUri) {
        String name = null;
        try {
            DocumentFile doc = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (doc != null) name = doc.getName();
        } catch (Exception ignored) {}
        if (name == null || name.trim().isEmpty()) name = treeUri.getLastPathSegment();
        if (name == null || name.trim().isEmpty()) name = "Stockage";
        return name;
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            startActivityForResult(call, intent, "folderPicked");
        } catch (Exception e) {
            call.reject("Impossible d'ouvrir le sélecteur de dossier");
        }
    }

    @PluginMethod
    public void listFolders(PluginCall call) {
        JSArray folders = new JSArray();
        org.json.JSONArray stored = loadLocalFolders();
        for (int i = 0; i < stored.length(); i++) {
            org.json.JSONObject f = stored.optJSONObject(i);
            if (f == null) continue;
            JSObject o = new JSObject();
            o.put("uri", f.optString("uri"));
            o.put("name", f.optString("name", "Stockage"));
            folders.put(o);
        }
        JSObject value = new JSObject();
        value.put("folders", folders);
        call.resolve(value);
    }

    @PluginMethod
    public void removeFolder(PluginCall call) {
        String uri = call.getString("uri");
        org.json.JSONArray stored = loadLocalFolders();
        org.json.JSONArray next = new org.json.JSONArray();
        for (int i = 0; i < stored.length(); i++) {
            org.json.JSONObject f = stored.optJSONObject(i);
            if (f != null && !uri.equals(f.optString("uri"))) next.put(f);
        }
        saveLocalFolders(next);
        try {
            getContext().getContentResolver().releasePersistableUriPermission(
                Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void scanLibrary(PluginCall call) {
        final String folderUri = call.getString("uri", null);
        final org.json.JSONArray stored = loadLocalFolders();
        if (folderUri == null && stored.length() == 0) {
            call.reject("Aucun dossier ajouté");
            return;
        }
        call.setKeepAlive(true);
        scanExecutor.execute(() -> {
            JSArray files = new JSArray();
            int[] count = { 0 };
            int[] truncated = { 0 };
            try {
                if (folderUri != null) {
                    DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(folderUri));
                    if (root != null && root.canRead()) scanDirectory(root, files, count, LOCAL_SCAN_LIMIT, truncated);
                } else {
                    for (int i = 0; i < stored.length(); i++) {
                        if (count[0] >= LOCAL_SCAN_LIMIT) { truncated[0] = 1; break; }
                        org.json.JSONObject f = stored.optJSONObject(i);
                        if (f == null) continue;
                        DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(f.optString("uri")));
                        if (root != null && root.canRead()) scanDirectory(root, files, count, LOCAL_SCAN_LIMIT, truncated);
                    }
                }
                final JSObject value = new JSObject();
                value.put("files", files);
                value.put("count", files.length());
                value.put("truncated", truncated[0] == 1);
                // Le bridge peut être détruit (app fermée) : ne pas planter le thread.
                final com.getcapacitor.Bridge bridge = getBridge();
                if (bridge != null) bridge.executeOnMainThread(() -> call.resolve(value));
            } catch (Exception e) {
                final com.getcapacitor.Bridge bridge = getBridge();
                if (bridge != null) bridge.executeOnMainThread(() -> call.reject("Analyse du dossier impossible"));
            }
        });
    }

    private void scanDirectory(DocumentFile dir, JSArray files, int[] count, int limit, int[] truncated) {
        DocumentFile[] children = dir.listFiles();
        HashMap<String, String> subs = new HashMap<>();
        ArrayList<DocumentFile> subdirs = new ArrayList<>();
        for (DocumentFile f : children) {
            if (f == null) continue;
            if (f.isDirectory()) { subdirs.add(f); continue; }
            String name = f.getName();
            if (name == null) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".srt") || lower.endsWith(".vtt")) {
                subs.put(lower.substring(0, lower.lastIndexOf('.')), f.getUri().toString());
            }
        }
        for (DocumentFile f : children) {
            if (f == null || f.isDirectory()) continue;
            if (count[0] >= limit) { truncated[0] = 1; return; }
            String name = f.getName();
            if (name == null || !isVideoFile(name)) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            String base = lower.substring(0, lower.lastIndexOf('.'));
            try {
                JSObject entry = new JSObject();
                entry.put("uri", f.getUri().toString());
                entry.put("name", name);
                entry.put("size", f.length());
                entry.put("lastModified", f.lastModified());
                if (subs.containsKey(base)) entry.put("subtitleUri", subs.get(base));
                files.put(entry);
                count[0]++;
            } catch (Exception ignored) {}
        }
        for (DocumentFile sub : subdirs) {
            if (count[0] >= limit) { truncated[0] = 1; return; }
            scanDirectory(sub, files, count, limit, truncated);
        }
    }

    private boolean isVideoFile(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0) return false;
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        for (String e : VIDEO_EXTENSIONS) if (e.equals(ext)) return true;
        return false;
    }

    @PluginMethod
    public void playLocal(PluginCall call) {
        String uri = call.getString("uri");
        String title = call.getString("title", "Vidéo locale");
        if (uri == null || uri.isEmpty()) { call.reject("Fichier invalide"); return; }
        try {
            Intent intent = new Intent(getContext(), NativePlayerActivity.class);
            intent.putExtra(NativePlayerActivity.EXTRA_URL, uri);
            intent.putExtra(NativePlayerActivity.EXTRA_TITLE, title);
            intent.putExtra("vod", true);
            putTvUi(call, intent);
            intent.putExtra("mediaId", "local:" + uri);
            String subUri = call.getString("subtitleUri");
            if (subUri != null && !subUri.isEmpty()) intent.putExtra("subtitleUrl", subUri);
            launchPlayer(call, intent);
        } catch (Exception e) {
            call.reject("Impossible de lire ce fichier");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Enregistrements DVR — dossier SAF en écriture + liste des fichiers.
    // On n'écrit que les flux enregistrés par l'utilisateur, rien d'autre.
    // ─────────────────────────────────────────────────────────────────────

    private SharedPreferences recorderPrefs() {
        return getContext().getSharedPreferences("recorder", Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void pickRecordingsFolder(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            startActivityForResult(call, intent, "recordingsFolderPicked");
        } catch (Exception e) {
            call.reject("Impossible d'ouvrir le sélecteur de dossier");
        }
    }

    @PluginMethod
    public void getRecordingsFolder(PluginCall call) {
        String uri = recorderPrefs().getString("folder", null);
        if (uri == null) { call.resolve(); return; }
        JSObject value = new JSObject();
        value.put("uri", uri);
        value.put("name", recorderPrefs().getString("name", "Enregistrements"));
        call.resolve(value);
    }

    @PluginMethod
    public void listRecordings(PluginCall call) {
        // L'IO SAF (listFiles) peut bloquer plusieurs secondes sur une clé lente :
        // on la déporte hors du thread principal.
        call.setKeepAlive(true);
        scanExecutor.execute(() -> {
            String uri = recorderPrefs().getString("folder", null);
            JSArray files = new JSArray();
            try {
                if (uri != null) {
                    DocumentFile dir = DocumentFile.fromTreeUri(getContext(), Uri.parse(uri));
                    if (dir != null && dir.canRead()) {
                        DocumentFile[] children = dir.listFiles();
                        if (children != null) {
                            for (DocumentFile f : children) {
                                if (f == null || f.isDirectory()) continue;
                                String name = f.getName();
                                if (name == null) continue;
                                String lower = name.toLowerCase(Locale.ROOT);
                                if (!lower.endsWith(".ts") && !lower.endsWith(".mp4") && !lower.endsWith(".m4v")) continue;
                                JSObject o = new JSObject();
                                o.put("uri", f.getUri().toString());
                                o.put("name", name);
                                o.put("size", f.length());
                                o.put("lastModified", f.lastModified());
                                files.put(o);
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
            JSObject value = new JSObject();
            value.put("files", files);
            final com.getcapacitor.Bridge bridge = getBridge();
            if (bridge != null) bridge.executeOnMainThread(() -> call.resolve(value));
        });
    }

    @PluginMethod
    public void deleteRecording(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) { call.reject("Fichier invalide"); return; }
        try {
            DocumentFile f = DocumentFile.fromSingleUri(getContext(), Uri.parse(uri));
            if (f != null && f.delete()) call.resolve();
            else call.reject("Suppression impossible");
        } catch (Exception e) {
            call.reject("Suppression impossible");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Enregistrements programmés — AlarmManager + service au premier plan.
    // Le flux (légal, ajouté par l'utilisateur) est capturé à l'heure prévue,
    // même si l'application n'est plus à l'écran.
    // ─────────────────────────────────────────────────────────────────────

    @PluginMethod
    public void scheduleRecording(PluginCall call) {
        String url = call.getString("url");
        String userAgent = PlayerOptions.cleanUserAgent(call.getString("userAgent", PlayerOptions.userAgent(getContext())));
        String title = call.getString("title", "Enregistrement");
        long startTimeMs = call.getLong("startTimeMs", 0L);
        long durationMs = call.getLong("durationMs", 0L);
        if (!isHttpUrl(url)) { call.reject("URL HTTP ou HTTPS requise"); return; }
        if (startTimeMs <= System.currentTimeMillis()) { call.reject("La date de début doit être dans le futur"); return; }
        if (durationMs <= 0) { call.reject("Durée invalide"); return; }
        try {
            String folder = recorderPrefs().getString("folder", null);
            DocumentFile directory = folder == null ? null : DocumentFile.fromTreeUri(getContext(), Uri.parse(folder));
            if (directory == null || !directory.canWrite()) {
                call.reject("Choisis d'abord un dossier d'enregistrement accessible."); return;
            }
        } catch (Exception e) { call.reject("Dossier d'enregistrement inaccessible."); return; }

        String id = java.util.UUID.randomUUID().toString();
        try {
            org.json.JSONObject entry = new org.json.JSONObject();
            entry.put("id", id);
            entry.put("url", url);
            entry.put("title", title);
            entry.put("startTimeMs", startTimeMs);
            entry.put("durationMs", durationMs);
            entry.put("userAgent", userAgent);
            ScheduleStore.add(getContext(), entry);
        } catch (Exception e) {
            call.reject("Impossible d'enregistrer la programmation");
            return;
        }
        try {
            ScheduledRecordReceiver.setAlarm(getContext(), id, startTimeMs, url, title, durationMs, userAgent);
        } catch (Exception e) {
            ScheduleStore.remove(getContext(), id);
            call.reject("Impossible de programmer l'alarme");
            return;
        }
        // Android 13+ : notifications nécessaires pour suivre l'enregistrement.
        ensureNotificationPermission();
        // Android 12+ : proposer les alarmes exactes pour un déclenchement fiable
        // (sinon l'enregistrement peut être retardé ou bloqué en arrière-plan).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
                if (am != null && !am.canScheduleExactAlarms()) {
                    Intent permissionIntent = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                    permissionIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
                    permissionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(permissionIntent);
                }
            } catch (Exception ignored) {}
        }
        JSObject value = new JSObject();
        value.put("id", id);
        call.resolve(value);
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        Activity activity = getActivity();
        if (activity == null) return;
        if (activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
    }

    @PluginMethod
    public void listScheduledRecordings(PluginCall call) {
        JSArray out = new JSArray();
        org.json.JSONArray array = ScheduleStore.load(getContext());
        for (int i = 0; i < array.length(); i++) {
            org.json.JSONObject o = array.optJSONObject(i);
            if (o == null) continue;
            JSObject item = new JSObject();
            item.put("id", o.optString("id"));
            item.put("url", o.optString("url"));
            item.put("title", o.optString("title"));
            item.put("startTimeMs", o.optLong("startTimeMs"));
            item.put("durationMs", o.optLong("durationMs"));
            out.put(item);
        }
        JSObject value = new JSObject();
        value.put("schedules", out);
        call.resolve(value);
    }

    @PluginMethod
    public void cancelScheduledRecording(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) { call.reject("Identifiant invalide"); return; }
        try { cancelAlarm(id); } catch (Exception ignored) {}
        ScheduleStore.remove(getContext(), id);
        call.resolve();
    }

    private void cancelAlarm(String id) {
        ScheduledRecordReceiver.cancelAlarm(getContext(), id);
    }

    @ActivityCallback
    private void recordingsFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) { call.resolve(); return; }
        Intent data = result.getData();
        Uri treeUri = data != null ? data.getData() : null;
        if (treeUri == null) { call.reject("Aucun dossier sélectionné"); return; }
        try {
            getContext().getContentResolver().takePersistableUriPermission(treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {}
        String name = folderDisplayName(treeUri);
        recorderPrefs().edit().putString("folder", treeUri.toString()).putString("name", name).apply();
        JSObject value = new JSObject();
        value.put("uri", treeUri.toString());
        value.put("name", name);
        call.resolve(value);
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) { call.resolve(); return; }
        Intent data = result.getData();
        Uri treeUri = data != null ? data.getData() : null;
        if (treeUri == null) { call.reject("Aucun dossier sélectionné"); return; }
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        String name = folderDisplayName(treeUri);
        org.json.JSONArray folders = loadLocalFolders();
        boolean already = false;
        for (int i = 0; i < folders.length(); i++) {
            org.json.JSONObject f = folders.optJSONObject(i);
            if (f != null && treeUri.toString().equals(f.optString("uri"))) { already = true; break; }
        }
        if (!already) {
            org.json.JSONObject entry = new org.json.JSONObject();
            try { entry.put("uri", treeUri.toString()); entry.put("name", name); } catch (Exception ignored) {}
            folders.put(entry);
            saveLocalFolders(folders);
        }
        JSObject value = new JSObject();
        value.put("uri", treeUri.toString());
        value.put("name", name);
        call.resolve(value);
    }

    @ActivityCallback
    private void playerClosed(PluginCall call, ActivityResult result) {
        playerOpen = false;
        getActivity().runOnUiThread(() -> { if (preview != null) preview.resume(); });
        if (call == null) return;
        Intent data = result.getData();
        if (data != null && data.hasExtra("positionMs")) {
            JSObject value = new JSObject();
            value.put("positionMs", data.getLongExtra("positionMs", 0));
            value.put("durationMs", data.getLongExtra("durationMs", 0));
            value.put("completed", data.getBooleanExtra("completed", false));
            value.put("mediaId", data.getStringExtra("mediaId"));
            try { value.put("progress", new JSArray(data.getStringExtra("progress"))); } catch (Exception ignored) {}
            putStats(value, data);
            call.resolve(value);
        } else if (data != null && data.hasExtra("channelUrl")) {
            JSObject value = new JSObject();
            value.put("channelUrl", data.getStringExtra("channelUrl"));
            if (data.hasExtra("jumpNumber")) value.put("jumpNumber", data.getStringExtra("jumpNumber"));
            putStats(value, data);
            call.resolve(value);
        } else call.resolve();
    }

    /** Bilan de lecture du lecteur natif (aucune URL ni identifiant), si présent. */
    private static void putStats(JSObject value, Intent data) {
        String stats = data.getStringExtra("stats");
        if (stats == null) return;
        try { value.put("stats", new JSObject(stats)); } catch (Exception ignored) {}
    }

    // ── Vérification des chaînes (liens hors service) ─────────────────

    private static final ExecutorService probeExecutor = Executors.newFixedThreadPool(6);

    /**
     * Teste un lot d'adresses : quelques octets suffisent à savoir si le flux répond.
     * Aucune adresse n'est journalisée (elles contiennent souvent les identifiants du compte).
     */
    @PluginMethod
    public void probeStreams(PluginCall call) {
        JSArray urls = call.getArray("urls", null);
        if (urls == null || urls.length() == 0 || urls.length() > 60) { call.reject("Lot d'adresses invalide"); return; }
        final int count = urls.length();
        final String[] list = new String[count];
        for (int i = 0; i < count; i++) list[i] = urls.optString(i, "");
        new Thread(() -> {
            java.util.List<java.util.concurrent.Future<int[]>> futures = new ArrayList<>();
            for (String u : list) futures.add(probeExecutor.submit(() -> probeOne(u)));
            JSArray results = new JSArray();
            for (int i = 0; i < count; i++) {
                JSObject r = new JSObject();
                int[] outcome;
                try { outcome = futures.get(i).get(20, java.util.concurrent.TimeUnit.SECONDS); }
                catch (Exception e) { outcome = new int[] { 0, 0 }; }
                r.put("ok", outcome[0] == 1);
                r.put("status", outcome[1]);
                results.put(r);
            }
            JSObject value = new JSObject();
            value.put("results", results);
            call.resolve(value);
        }).start();
    }

    /** [1 si le flux répond, code HTTP final (0 = pas de réponse)]. */
    private int[] probeOne(String raw) {
        if (!isHttpUrl(raw)) return new int[] { 0, 0 };
        String current = raw;
        // Portail Stalker : on vérifie le lien que donne le portail (refus = chaîne en échec).
        if (Stalker.is(raw)) {
            try { current = Stalker.resolve(getContext(), raw); }
            catch (java.io.IOException e) { return new int[] { 0, 0 }; }
        }
        for (int hop = 0; hop < 5; hop++) {
            java.net.HttpURLConnection conn = null;
            try {
                conn = (java.net.HttpURLConnection) new java.net.URL(current).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.setRequestProperty("User-Agent", PlayerOptions.userAgent(getContext()));
                conn.setRequestProperty("Range", "bytes=0-4095");
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String location = conn.getHeaderField("Location");
                    if (location == null) return new int[] { 0, code };
                    current = new java.net.URL(new java.net.URL(current), location).toString();
                    continue;
                }
                if (code < 200 || code >= 300) return new int[] { 0, code };
                byte[] buffer = new byte[4096];
                int read = 0;
                try (java.io.InputStream in = conn.getInputStream()) {
                    int n;
                    while (read < buffer.length && (n = in.read(buffer, read, buffer.length - read)) > 0) read += n;
                }
                if (read <= 0) return new int[] { 0, code };
                String head = new String(buffer, 0, Math.min(read, 16), StandardCharsets.ISO_8859_1).trim();
                // Une playlist HLS vide ou une page d'erreur HTML ne compte pas comme un flux.
                if (head.startsWith("<")) return new int[] { 0, code };
                return new int[] { 1, code };
            } catch (Exception e) {
                return new int[] { 0, 0 };
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        return new int[] { 0, 0 };
    }

    // ── Aperçu vidéo de l'écran Direct TV ──────────────────────────────

    private LivePreview preview;
    /** Un lecteur plein écran (ou en image dans l'image) a la main : pas d'aperçu en parallèle. */
    private volatile boolean playerOpen = false;

    private void launchPlayer(PluginCall call, Intent intent) {
        playerOpen = true;
        AudioPlaybackService.pauseIfPlaying(getContext());
        getActivity().runOnUiThread(() -> { if (preview != null) preview.pause(); });
        try {
            startActivityForResult(call, intent, "playerClosed");
        } catch (RuntimeException e) {
            playerOpen = false;
            throw e;
        }
    }

    private LivePreview preview() {
        if (preview == null) {
            preview = new LivePreview(getActivity(), getBridge().getWebView(), state -> {
                JSObject data = new JSObject();
                data.put("state", state);
                notifyListeners("previewState", data);
            });
        }
        return preview;
    }

    @PluginMethod
    public void showPreview(PluginCall call) {
        String url = call.getString("url");
        Double x = call.getDouble("x"), y = call.getDouble("y");
        Double width = call.getDouble("width"), height = call.getDouble("height");
        double radius = call.getDouble("radius", 0.0);
        double dpr = call.getDouble("dpr", 0.0);
        if (!isHttpUrl(url) || x == null || y == null || width == null || height == null || width <= 0 || height <= 0) {
            call.reject("Aperçu invalide");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (playerOpen) { call.resolve(); return; }
            AudioPlaybackService.pauseIfPlaying(getContext());
            try {
                preview().show(url, x.floatValue(), y.floatValue(), width.floatValue(), height.floatValue(), (float) radius, (float) dpr);
                call.resolve();
            } catch (RuntimeException e) {
                if (preview != null) preview.hide();
                call.reject("Aperçu indisponible");
            }
        });
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (preview != null) preview.stop(); call.resolve(); });
    }

    @PluginMethod
    public void hidePreview(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (preview != null) preview.hide(); call.resolve(); });
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (preview != null) preview.pause();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (preview != null && !playerOpen) preview.resume();
    }

    private final AudioPlaybackService.StateListener audioListener = snapshot -> {
        notifyListeners("audioState", snapshotToJS(snapshot));
    };

    private final BroadcastReceiver favoriteReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            notifyListeners("favoritesChanged", new JSObject());
        }
    };

    @PluginMethod
    public void getFavoriteChanges(PluginCall call) {
        JSObject result = new JSObject();
        result.put("entries", new NativeFavoriteStore(getContext()).changes());
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledgeFavoriteChanges(PluginCall call) {
        new NativeFavoriteStore(getContext()).acknowledge(call.getArray("entries", new JSArray()));
        call.resolve();
    }

    @PluginMethod
    public void setFavoritesSnapshot(PluginCall call) {
        JSArray urls = call.getArray("urls", new JSArray());
        HashSet<String> valid = new HashSet<>();
        for (int i = 0; i < urls.length(); i++) {
            String url = urls.optString(i);
            if (isHttpUrl(url)) valid.add(url);
        }
        new NativeFavoriteStore(getContext()).setSnapshot(valid);
        call.resolve();
    }

    @Override
    public void load() {
        super.load();
        AudioPlaybackService.addListener(audioListener);
        ContextCompat.registerReceiver(getContext(), favoriteReceiver,
            new IntentFilter(NativeFavoriteStore.ACTION_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        AudioPlaybackService.removeListener(audioListener);
        getContext().unregisterReceiver(favoriteReceiver);
        if (preview != null) preview.hide();
        super.handleOnDestroy();
    }

    // ── Lecture audio en arrière-plan (podcasts) ────────────────────────

    static JSObject snapshotToJS(AudioPlaybackService.StateSnapshot s) {
        JSObject obj = new JSObject();
        for (java.util.Map.Entry<String, Object> entry : s.toMap().entrySet()) {
            obj.put(entry.getKey(), entry.getValue());
        }
        return obj;
    }

    private void sendAudioAction(Intent intent) {
        Context ctx = getContext();
        String action = intent.getAction();
        boolean mayStartPlayback = AudioPlaybackService.ACTION_PLAY_EPISODE.equals(action)
                || AudioPlaybackService.ACTION_RESUME.equals(action);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mayStartPlayback) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
    }

    @PluginMethod
    public void playAudioEpisode(PluginCall call) {
        String episodeId = call.getString("episodeId");
        String audioUrl = call.getString("audioUrl");
        if (episodeId == null || episodeId.isEmpty() || !isHttpUrl(audioUrl)) {
            call.reject("Adresse d'épisode invalide");
            return;
        }
        // Coupe l'aperçu vidéo TV si actif : pas de double son.
        getActivity().runOnUiThread(() -> { if (preview != null) preview.stop(); });
        Intent intent = new Intent(getContext(), AudioPlaybackService.class);
        intent.setAction(AudioPlaybackService.ACTION_PLAY_EPISODE);
        intent.putExtra("episodeId", episodeId);
        intent.putExtra("audioUrl", audioUrl);
        intent.putExtra("feedUrl", call.getString("feedUrl", ""));
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("podcastTitle", call.getString("podcastTitle", ""));
        intent.putExtra("artworkUrl", call.getString("artworkUrl", ""));
        Double startPos = call.getDouble("startPositionMs");
        if (startPos != null) intent.putExtra("startPositionMs", startPos.longValue());
        Float speed = call.getFloat("speed");
        if (speed != null && speed > 0f) intent.putExtra("speed", speed.floatValue());
        sendAudioAction(intent);
        call.resolve(snapshotToJS(AudioPlaybackService.getCurrentSnapshot(getContext())));
    }

    @PluginMethod
    public void pauseAudio(PluginCall call) {
        Intent intent = new Intent(getContext(), AudioPlaybackService.class);
        intent.setAction(AudioPlaybackService.ACTION_PAUSE);
        sendAudioAction(intent);
        call.resolve();
    }

    @PluginMethod
    public void resumeAudio(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (preview != null) preview.stop(); });
        Intent intent = new Intent(getContext(), AudioPlaybackService.class);
        intent.setAction(AudioPlaybackService.ACTION_RESUME);
        sendAudioAction(intent);
        call.resolve();
    }

    @PluginMethod
    public void stopAudio(PluginCall call) {
        Intent intent = new Intent(getContext(), AudioPlaybackService.class);
        intent.setAction(AudioPlaybackService.ACTION_STOP);
        sendAudioAction(intent);
        call.resolve();
    }

    @PluginMethod
    public void seekAudioTo(PluginCall call) {
        Double pos = call.getDouble("positionMs", 0.0);
        Intent intent = new Intent(getContext(), AudioPlaybackService.class);
        intent.setAction(AudioPlaybackService.ACTION_SEEK_TO);
        intent.putExtra("positionMs", pos != null ? pos.longValue() : 0L);
        sendAudioAction(intent);
        call.resolve();
    }

    @PluginMethod
    public void seekAudioBy(PluginCall call) {
        Double delta = call.getDouble("deltaMs", 0.0);
        Intent intent = new Intent(getContext(), AudioPlaybackService.class);
        intent.setAction(AudioPlaybackService.ACTION_SEEK_BY);
        intent.putExtra("deltaMs", delta != null ? delta.longValue() : 0L);
        sendAudioAction(intent);
        call.resolve();
    }

    @PluginMethod
    public void setAudioSpeed(PluginCall call) {
        Float speed = call.getFloat("speed", 1.0f);
        Intent intent = new Intent(getContext(), AudioPlaybackService.class);
        intent.setAction(AudioPlaybackService.ACTION_SET_SPEED);
        intent.putExtra("speed", speed != null ? speed.floatValue() : 1.0f);
        sendAudioAction(intent);
        call.resolve();
    }

    @PluginMethod
    public void getAudioState(PluginCall call) {
        AudioPlaybackService.getCurrentSnapshotAsync(getContext(), snapshot -> {
            call.resolve(snapshotToJS(snapshot));
        });
    }

    /** Journal d'usage local de Découvrir (14 jours, temps de lecture effective par famille). */
    @PluginMethod
    public void getUsageJournal(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("days", UsageJournalStore.read(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void clearUsageJournal(PluginCall call) {
        UsageJournalStore.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getAudioProgressAll(PluginCall call) {
        JSArray entries = new JSArray();
        for (AudioProgressStore.Entry e : AudioProgressStore.tracker(getContext()).getAllEntries()) {
            JSObject obj = new JSObject();
            obj.put("episodeId", e.episodeId);
            obj.put("feedUrl", e.feedUrl);
            obj.put("audioUrl", e.audioUrl);
            obj.put("title", e.title);
            obj.put("podcastTitle", e.podcastTitle);
            obj.put("artworkUrl", e.artworkUrl);
            obj.put("positionMs", e.positionMs);
            obj.put("durationMs", e.durationMs);
            obj.put("speed", e.speed);
            obj.put("completed", e.completed);
            obj.put("updatedAt", e.updatedAt);
            entries.put(obj);
        }
        JSObject res = new JSObject();
        res.put("entries", entries);
        res.put("lastActiveEpisodeId", AudioProgressStore.tracker(getContext()).getActiveEpisodeId());
        call.resolve(res);
    }

    // ── Raccourcis de l'icône (appui long) : chaînes favorites ────────

    /** Réglages du lecteur choisis dans l'application (User-Agent de la liste ouverte, tampon, décodage, AFR). */
    @PluginMethod
    public void setPlayerOptions(PluginCall call) {
        String buffer = call.getString("buffer", "normal");
        String decoder = call.getString("decoder", "hardware");
        if (!java.util.Arrays.asList("small", "normal", "large", "max").contains(buffer)) buffer = "normal";
        if (!"software".equals(decoder)) decoder = "hardware";
        PlayerOptions.save(getContext(), call.getString("userAgent", PlayerOptions.DEFAULT_USER_AGENT), buffer, decoder, Boolean.TRUE.equals(call.getBoolean("afr", false)));
        call.resolve();
    }

    /** Android TV : rangée « CedPlay · Favoris » sur l'écran d'accueil. */
    @PluginMethod
    public void setHomeFavorites(PluginCall call) {
        HomeScreen.publishFavorites(getContext(), call.getArray("items", new JSArray()));
        call.resolve();
    }

    /** Android TV : dernière chaîne regardée dans « À suivre ». */
    @PluginMethod
    public void addWatchNext(PluginCall call) {
        HomeScreen.addWatchNext(getContext(), call.getString("id"), call.getString("name"), call.getString("logo"));
        call.resolve();
    }

    /** Téléviseur ou box Android TV : mode d'interface TV ou fonction leanback/sans écran tactile. */
    @PluginMethod
    public void isTelevision(PluginCall call) {
        boolean tv = false;
        try {
            android.app.UiModeManager ui = (android.app.UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            tv = (ui != null && ui.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)
                || pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
                || pm.hasSystemFeature("android.software.leanback_only")
                || !pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_TOUCHSCREEN);
        } catch (Exception ignored) { /* détection impossible : interface mobile */ }
        JSObject result = new JSObject();
        result.put("tv", tv);
        call.resolve(result);
    }

    /**
     * Remplace les raccourcis dynamiques par les favoris donnés (4 au plus).
     * Chaque raccourci rouvre l'application avec lecteuriptv://channel?id=…
     */
    @PluginMethod
    public void setChannelShortcuts(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) { call.resolve(); return; }
        try {
            android.content.pm.ShortcutManager manager = getContext().getSystemService(android.content.pm.ShortcutManager.class);
            if (manager == null) { call.resolve(); return; }
            JSArray items = call.getArray("items", new JSArray());
            ArrayList<android.content.pm.ShortcutInfo> shortcuts = new ArrayList<>();
            int max = Math.min(items.length(), Math.min(4, manager.getMaxShortcutCountPerActivity()));
            for (int i = 0; i < max; i++) {
                org.json.JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                String name = item.optString("name", "").trim();
                if (id.isEmpty() || name.isEmpty()) continue;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("lecteuriptv://channel?id=" + Uri.encode(id)));
                intent.setClass(getContext(), MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                String shortLabel = name.length() > 12 ? name.substring(0, 11) + "…" : name;
                shortcuts.add(new android.content.pm.ShortcutInfo.Builder(getContext(), "fav-" + i)
                    .setShortLabel(shortLabel)
                    .setLongLabel(name.length() > 25 ? name.substring(0, 24) + "…" : name)
                    .setIcon(android.graphics.drawable.Icon.createWithResource(getContext(), R.mipmap.ic_launcher))
                    .setIntent(intent)
                    .setRank(i)
                    .build());
            }
            manager.setDynamicShortcuts(shortcuts);
            call.resolve();
        } catch (Exception e) {
            call.reject("Raccourcis indisponibles");
        }
    }
}
