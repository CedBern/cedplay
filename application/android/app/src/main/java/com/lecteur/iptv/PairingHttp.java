package com.lecteur.iptv;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Appairage par QR code : lecture des requêtes et pages servies au téléphone.
 * Sans dépendance Android, pour être testé sur la JVM.
 */
final class PairingHttp {
    static final int MAX_HEAD = 8192;
    static final int MAX_BODY = 4096;
    static final int MAX_FIELD = 1024;

    static final class Request {
        final String method;
        final String path;
        final int contentLength;
        Request(String method, String path, int contentLength) {
            this.method = method; this.path = path; this.contentLength = contentLength;
        }
    }

    private PairingHttp() {}

    /** Ligne de requête et en-têtes ; null si la requête n'est pas lisible. */
    static Request parseHead(String head) {
        if (head == null) return null;
        String[] lines = head.split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length != 3 || !first[2].startsWith("HTTP/1.")) return null;
        String path = first[1];
        int query = path.indexOf('?');
        if (query >= 0) path = path.substring(0, query);
        if (!path.startsWith("/")) return null;
        int length = 0;
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon <= 0) continue;
            if (!lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT).equals("content-length")) continue;
            try { length = Integer.parseInt(lines[i].substring(colon + 1).trim()); }
            catch (NumberFormatException e) { return null; }
            if (length < 0) return null;
        }
        return new Request(first[0], path, length);
    }

    /** Champs d'un formulaire application/x-www-form-urlencoded, sans les espaces de bord. */
    static Map<String, String> parseForm(String body) {
        Map<String, String> fields = new HashMap<>();
        if (body == null) return fields;
        for (String pair : body.split("&")) {
            int equals = pair.indexOf('=');
            if (equals <= 0) continue;
            try {
                String value = URLDecoder.decode(pair.substring(equals + 1), "UTF-8").trim();
                if (value.length() <= MAX_FIELD) fields.put(URLDecoder.decode(pair.substring(0, equals), "UTF-8"), value);
            } catch (UnsupportedEncodingException | IllegalArgumentException ignored) { /* champ illisible : ignoré */ }
        }
        return fields;
    }

    /**
     * Message à afficher au téléphone si la saisie ne suffit pas, sinon null.
     * Un lien M3U complet (…get.php?username=…&password=…) collé dans Serveur suffit à lui seul.
     */
    static String validate(String server, String username, String password) {
        if (server.isEmpty()) return "Indique l’adresse du serveur.";
        String lower = server.toLowerCase(Locale.ROOT);
        boolean link = lower.contains("username=") && lower.contains("password=");
        if (!link && (username.isEmpty() || password.isEmpty())) return "Indique l’identifiant et le mot de passe.";
        return null;
    }

    static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String page(String body) {
        return "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            + "<title>CedPlay</title><style>"
            + "body{margin:0;background:#0a0a0a;color:#f5f5f5;font:17px/1.4 system-ui,sans-serif}"
            + "main{max-width:440px;margin:0 auto;padding:28px 20px}"
            + "h1{font-size:24px;margin:0 0 6px}p{color:#a3a3a3;margin:0 0 20px}"
            + "label{display:block;font-size:14px;color:#d4d4d4;margin:16px 0 6px}"
            + "input{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;border:1px solid #404040;background:#171717;color:#fff;font-size:17px}"
            + "button{width:100%;margin-top:24px;padding:16px;border:0;border-radius:12px;background:#FF5A36;color:#fff;font-size:18px;font-weight:600}"
            + ".error{color:#fda4af;margin:0 0 8px}.hint{font-size:13px;margin:6px 0 0}"
            + "</style></head><body><main>" + body + "</main></body></html>";
    }

    static String formPage(String error, String server, String username, String password) {
        String field = " autocapitalize=\"none\" autocorrect=\"off\" autocomplete=\"off\" spellcheck=\"false\" maxlength=\"" + MAX_FIELD + "\"";
        return page("<h1>Connecter ton abonnement</h1>"
            + "<p>Ce que tu saisis ici part directement vers ton téléviseur, sur ton réseau.</p>"
            + (error == null ? "" : "<p class=\"error\">" + escape(error) + "</p>")
            + "<form method=\"post\">"
            + "<label for=\"s\">Adresse du serveur</label>"
            + "<input id=\"s\" name=\"server\" inputmode=\"url\" placeholder=\"http://serveur.com:8080\" value=\"" + escape(server) + "\"" + field + ">"
            + "<p class=\"hint\">Tu peux aussi coller ici ton lien M3U complet : le reste est alors inutile.</p>"
            + "<label for=\"u\">Identifiant</label>"
            + "<input id=\"u\" name=\"username\" value=\"" + escape(username) + "\"" + field + ">"
            + "<label for=\"p\">Mot de passe</label>"
            + "<input id=\"p\" name=\"password\" type=\"password\" value=\"" + "" + "\"" + field + ">"
            + "<button type=\"submit\">Envoyer au téléviseur</button></form>");
    }

    static String donePage() {
        return page("<h1>C’est envoyé</h1><p>Regarde ton téléviseur : la connexion démarre. Tu peux fermer cette page.</p>");
    }

    static String messagePage(String title, String text) {
        return page("<h1>" + escape(title) + "</h1><p>" + escape(text) + "</p>");
    }

    static byte[] response(int status, String html) {
        String reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 404 ? "Not Found"
            : status == 409 ? "Conflict" : status == 405 ? "Method Not Allowed" : "Payload Too Large";
        byte[] body = html.getBytes(StandardCharsets.UTF_8);
        byte[] head = ("HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: text/html; charset=utf-8\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Referrer-Policy: no-referrer\r\n"
            + "X-Content-Type-Options: nosniff\r\n"
            + "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'\r\n"
            + "Connection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
        byte[] out = new byte[head.length + body.length];
        System.arraycopy(head, 0, out, 0, head.length);
        System.arraycopy(body, 0, out, head.length, body.length);
        return out;
    }
}
