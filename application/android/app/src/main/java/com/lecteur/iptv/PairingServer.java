package com.lecteur.iptv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Appairage par QR code : petit serveur HTTP ouvert sur le réseau local le temps de la connexion.
 * Le téléphone ouvre l'adresse du QR code, saisit les identifiants de l'abonnement, et le
 * téléviseur les reçoit, sans rien taper à la télécommande.
 * L'adresse contient un jeton tiré au hasard : sans lui, le serveur ne répond que 404.
 * Le trafic est en HTTP simple, il ne sort pas du réseau local.
 */
final class PairingServer {
    interface Listener { boolean onCredentials(String server, String username, String password); }

    /** Sans 0/o, 1/l/i : l'adresse reste recopiable à la main depuis l'écran. */
    private static final String TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
    private static final int TOKEN_LENGTH = 8;
    /** Au-delà, quelqu'un cherche le jeton : le serveur se ferme. */
    private static final int MAX_REJECTED = 30;
    private static final int SOCKET_TIMEOUT_MS = 5000;

    private final ServerSocket socket;
    private final String token;
    private final Listener listener;
    private final ExecutorService workers = new java.util.concurrent.ThreadPoolExecutor(2, 2, 0,
        java.util.concurrent.TimeUnit.MILLISECONDS, new java.util.concurrent.ArrayBlockingQueue<>(4));
    private final java.util.Set<Socket> clients = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final java.util.concurrent.ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean receiving = new java.util.concurrent.atomic.AtomicBoolean();
    static final long SESSION_MS = 5 * 60 * 1000;

    private final AtomicInteger rejected = new AtomicInteger();

    private PairingServer(ServerSocket socket, String token, Listener listener) {
        this.socket = socket; this.token = token; this.listener = listener;
    }

    static PairingServer start(InetAddress address, Listener listener) throws IOException {
        return start(address, listener, SESSION_MS);
    }

    static PairingServer start(InetAddress address, Listener listener, long lifetimeMs) throws IOException {
        SecureRandom random = new SecureRandom();
        StringBuilder token = new StringBuilder();
        for (int i = 0; i < TOKEN_LENGTH; i++) token.append(TOKEN_ALPHABET.charAt(random.nextInt(TOKEN_ALPHABET.length())));
        // Lié à l'adresse du réseau local seulement, sur un port libre choisi par le système.
        PairingServer server = new PairingServer(new ServerSocket(0, 8, address), token.toString(), listener);
        Thread thread = new Thread(server::acceptLoop, "pairing-accept");
        thread.setDaemon(true);
        thread.start();
        server.timer.schedule(server::stop, lifetimeMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        return server;
    }

    String url() {
        return "http://" + socket.getInetAddress().getHostAddress() + ":" + socket.getLocalPort() + "/" + token;
    }

    boolean isClosed() { return socket.isClosed(); }

    void stop() {
        try { socket.close(); } catch (IOException ignored) { /* déjà fermé */ }
        workers.shutdownNow();
        timer.shutdownNow();
        for (Socket client : clients) closeClient(client);
    }

    /** Adresse IPv4 du téléviseur sur le réseau local (Wi-Fi ou Ethernet) ; null hors réseau. */
    static InetAddress lanAddress() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback() || nif.isVirtual()) continue;
                for (InetAddress address : Collections.list(nif.getInetAddresses())) {
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) return address;
                }
            }
        } catch (Exception ignored) { /* interfaces illisibles : pas d'appairage */ }
        return null;
    }

    private void acceptLoop() {
        while (!socket.isClosed()) {
            try {
                Socket client = socket.accept();
                clients.add(client);
                try {
                    client.setSoTimeout(SOCKET_TIMEOUT_MS);
                    timer.schedule(() -> closeClient(client), 10000, java.util.concurrent.TimeUnit.MILLISECONDS);
                    workers.execute(() -> serve(client));
                } catch (IOException | RuntimeException e) { closeClient(client); }
            } catch (IOException | RuntimeException e) {
                if (socket.isClosed()) return;
            }
        }
    }

    private void closeClient(Socket client) {
        clients.remove(client);
        try { client.close(); } catch (IOException ignored) { }
    }

    private void serve(Socket client) {
        try (Socket c = client; InputStream in = c.getInputStream(); OutputStream out = c.getOutputStream()) {
            out.write(handle(in));
            out.flush();
        } catch (IOException ignored) { /* téléphone parti ou trop lent */ }
        finally { closeClient(client); }
    }

    private byte[] handle(InputStream in) throws IOException {
        PairingHttp.Request request = PairingHttp.parseHead(readHead(in));
        if (request == null) return PairingHttp.response(400, PairingHttp.messagePage("Demande illisible", "Scanne à nouveau le QR code affiché sur le téléviseur."));
        if (!request.path.equals("/" + token)) {
            // Le navigateur du téléphone demande l'icône de lui-même : ce n'est pas une tentative.
            if (!request.path.equals("/favicon.ico") && rejected.incrementAndGet() >= MAX_REJECTED) stop();
            return PairingHttp.response(404, PairingHttp.messagePage("Page introuvable", "Scanne le QR code affiché sur le téléviseur."));
        }
        if (request.method.equals("GET")) return PairingHttp.response(200, PairingHttp.formPage(null, "", "", ""));
        if (!request.method.equals("POST")) return PairingHttp.response(405, PairingHttp.messagePage("Demande refusée", "Scanne à nouveau le QR code."));
        if (request.contentLength > PairingHttp.MAX_BODY) return PairingHttp.response(413, PairingHttp.messagePage("Saisie trop longue", "Vérifie ce que tu as collé."));
        Map<String, String> form = PairingHttp.parseForm(new String(readExactly(in, request.contentLength), StandardCharsets.UTF_8));
        String server = value(form, "server"), username = value(form, "username"), password = value(form, "password");
        String error = PairingHttp.validate(server, username, password);
        if (error != null) return PairingHttp.response(400, PairingHttp.formPage(error, server, username, password));
        if (!receiving.compareAndSet(false, true)) return unavailable();
        try {
            if (!listener.onCredentials(server, username, password)) return unavailable();
        } finally { receiving.set(false); }
        return PairingHttp.response(200, PairingHttp.donePage());
    }

    private static byte[] unavailable() {
        return PairingHttp.response(409, PairingHttp.messagePage("Envoi non accepté",
            "Le téléviseur est occupé ou la saisie est invalide. Reviens au formulaire et réessaie. Aucun abonnement confirmé."));
    }

    private static String value(Map<String, String> form, String key) {
        String value = form.get(key);
        return value == null ? "" : value;
    }

    /** En-têtes jusqu'à la ligne vide ; null si elle n'arrive pas dans la limite. */
    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int matched = 0;
        while (head.size() < PairingHttp.MAX_HEAD) {
            int b = in.read();
            if (b < 0) return null;
            head.write(b);
            matched = (b == '\r' && (matched == 0 || matched == 2)) || (b == '\n' && (matched == 1 || matched == 3)) ? matched + 1 : (b == '\r' ? 1 : 0);
            if (matched == 4) return new String(head.toByteArray(), 0, head.size() - 4, StandardCharsets.ISO_8859_1);
        }
        return null;
    }

    private static byte[] readExactly(InputStream in, int length) throws IOException {
        byte[] body = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(body, read, length - read);
            if (n < 0) throw new java.io.EOFException("Incomplete body");
            read += n;
        }
        return read == length ? body : java.util.Arrays.copyOf(body, read);
    }
}
