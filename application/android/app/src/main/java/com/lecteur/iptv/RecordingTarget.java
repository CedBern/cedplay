package com.lecteur.iptv;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.core.content.ContextCompat;
import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Destination des enregistrements. Le dossier choisi sur le téléphone (SAF, clé USB ou SD)
 * reste prioritaire ; sans choix — cas de la box TV, où le sélecteur de dossier n'existe
 * pas — les captures vont dans <b>Films/CedPlay</b>, visible de tout gestionnaire de fichiers.
 * Android 9 et avant exigent l'autorisation de stockage pour ce dossier public : sans elle,
 * on se rabat sur le dossier de l'application, toujours accessible en écriture.
 */
final class RecordingTarget {

    /** Nom affiché du dossier par défaut. */
    static final String DEFAULT_NAME = "Films/CedPlay (par défaut)";
    private static final String DEFAULT_FOLDER = "CedPlay";
    private static final String PREFS = "recorder";

    /** Écriture d'un fichier : création, flux, suppression. */
    interface Target {
        /** Crée le fichier et renvoie son URI, ou null. */
        Uri create(String mime, String fileName);
        OutputStream open(Uri uri) throws IOException;
        void delete(Uri uri);
    }

    /** Un enregistrement listé (dossier choisi ou dossier par défaut). */
    static final class Item {
        String uri;
        String name;
        long size;
        long lastModified;
        Item(String uri, String name, long size, long lastModified) {
            this.uri = uri; this.name = name; this.size = size; this.lastModified = lastModified;
        }
    }

    private RecordingTarget() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** URI SAF du dossier choisi, ou null si l'application utilise son dossier par défaut. */
    static String chosenFolder(Context context) {
        String uri = prefs(context).getString("folder", null);
        return uri == null || uri.isEmpty() ? null : uri;
    }

    static String folderName(Context context) {
        return chosenFolder(context) != null
            ? prefs(context).getString("name", "Enregistrements")
            : DEFAULT_NAME;
    }

    /** Android 9 et avant : le dossier public Films/CedPlay demande l'autorisation de stockage. */
    static boolean needsStoragePermission(Context context) {
        return Build.VERSION.SDK_INT <= 28
            && chosenFolder(context) == null
            && ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED;
    }

    static Target target(Context context) {
        String chosen = chosenFolder(context);
        if (chosen != null) {
            DocumentFile dir = DocumentFile.fromTreeUri(context, Uri.parse(chosen));
            if (dir != null && dir.canWrite()) return new SafTarget(context, dir);
        }
        if (Build.VERSION.SDK_INT >= 29) return new MediaStoreTarget(context);
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
            return new FileTarget(publicDir());
        }
        return new FileTarget(appDir(context));
    }

    static List<Item> list(Context context) {
        List<Item> out = new ArrayList<>();
        String chosen = chosenFolder(context);
        if (chosen != null) {
            try {
                DocumentFile dir = DocumentFile.fromTreeUri(context, Uri.parse(chosen));
                if (dir != null && dir.canRead()) collect(dir.listFiles(), out);
            } catch (Exception ignored) {}
            return out;
        }
        if (Build.VERSION.SDK_INT >= 29) {
            collectMediaStore(context, out);
            return out;
        }
        File dir = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            ? publicDir() : appDir(context);
        collectFiles(dir, out);
        // Les captures faites avant l'autorisation de stockage restent visibles.
        if (!dir.equals(appDir(context))) collectFiles(appDir(context), out);
        return out;
    }

    private static void collectFiles(File dir, List<Item> out) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (!f.isFile() || !isRecordingName(f.getName())) continue;
            out.add(new Item(Uri.fromFile(f).toString(), f.getName(), f.length(), f.lastModified()));
        }
    }

    static boolean delete(Context context, String uriString) {
        if (uriString == null || uriString.isEmpty()) return false;
        Uri uri = Uri.parse(uriString);
        try {
            if ("content".equals(uri.getScheme()) && !"com.android.externalstorage.documents".equals(uri.getAuthority())) {
                return context.getContentResolver().delete(uri, null, null) > 0;
            }
            DocumentFile file = DocumentFile.fromSingleUri(context, uri);
            if (file != null && file.exists()) return file.delete();
            if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
                File f = new File(uri.getPath());
                return f.exists() && f.delete();
            }
        } catch (Exception ignored) {}
        return false;
    }

    private static void collect(DocumentFile[] children, List<Item> out) {
        if (children == null) return;
        for (DocumentFile f : children) {
            if (f == null || f.isDirectory()) continue;
            String name = f.getName();
            if (name == null || !isRecordingName(name)) continue;
            out.add(new Item(f.getUri().toString(), name, f.length(), f.lastModified()));
        }
    }

    private static void collectMediaStore(Context context, List<Item> out) {
        Uri collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        String[] projection = {
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DATE_MODIFIED,
        };
        String selection = MediaStore.Video.Media.RELATIVE_PATH + " = ?";
        String[] args = { Environment.DIRECTORY_MOVIES + "/" + DEFAULT_FOLDER + "/" };
        try (Cursor cursor = context.getContentResolver().query(collection, projection, selection, args, null)) {
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                String name = cursor.getString(1);
                if (name == null || !isRecordingName(name)) continue;
                out.add(new Item(
                    ContentUris.withAppendedId(collection, id).toString(),
                    name,
                    cursor.getLong(2),
                    cursor.getLong(3) * 1000L));
            }
        } catch (Exception ignored) {}
    }

    private static boolean isRecordingName(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".ts") || lower.endsWith(".mp4") || lower.endsWith(".m4v");
    }

    private static File publicDir() {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), DEFAULT_FOLDER);
    }

    private static File appDir(Context context) {
        File base = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (base == null) base = context.getFilesDir();
        return new File(base, DEFAULT_FOLDER);
    }

    // ── Écritures ────────────────────────────────────────────────────

    private static final class SafTarget implements Target {
        private final Context context;
        private final DocumentFile dir;
        SafTarget(Context context, DocumentFile dir) { this.context = context; this.dir = dir; }
        @Override public Uri create(String mime, String fileName) {
            DocumentFile file = dir.createFile(mime, fileName);
            return file != null ? file.getUri() : null;
        }
        @Override public OutputStream open(Uri uri) throws IOException {
            return context.getContentResolver().openOutputStream(uri, "w");
        }
        @Override public void delete(Uri uri) {
            try {
                ContentResolver resolver = context.getContentResolver();
                resolver.delete(uri, null, null);
            } catch (Exception ignored) {}
        }
    }

    /** Android 10 et plus : le dossier public sans autorisation, par MediaStore. */
    private static final class MediaStoreTarget implements Target {
        private final Context context;
        MediaStoreTarget(Context context) { this.context = context; }
        @Override public Uri create(String mime, String fileName) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Video.Media.MIME_TYPE, mime);
            values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + DEFAULT_FOLDER);
            try {
                return context.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
            } catch (Exception e) {
                return null;
            }
        }
        @Override public OutputStream open(Uri uri) throws IOException {
            return context.getContentResolver().openOutputStream(uri, "w");
        }
        @Override public void delete(Uri uri) {
            try { context.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
        }
    }

    /** Android 9 et avant : écriture directe dans un dossier de fichiers. */
    private static final class FileTarget implements Target {
        private final File dir;
        FileTarget(File dir) { this.dir = dir; }
        @Override public Uri create(String mime, String fileName) {
            if (!dir.exists() && !dir.mkdirs()) return null;
            File file = new File(dir, fileName);
            try {
                if (!file.exists() && !file.createNewFile()) return null;
            } catch (IOException e) {
                return null;
            }
            return Uri.fromFile(file);
        }
        @Override public OutputStream open(Uri uri) throws IOException {
            if (uri.getPath() == null) throw new IOException("chemin invalide");
            return new FileOutputStream(new File(uri.getPath()));
        }
        @Override public void delete(Uri uri) {
            if (uri.getPath() == null) return;
            File file = new File(uri.getPath());
            if (file.exists()) file.delete();
        }
    }
}
