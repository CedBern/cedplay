package com.lecteur.iptv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Serveur HTTP local dédié à la synchronisation bidirectionnelle (progression VOD + Ma liste)
 * entre appareils CedPlay sur le même réseau Wi-Fi / Ethernet.
 * Le jeton secret dans le chemin (/sync/<token>) protège contre les accès non appairés.
 */
final class LanSyncServer {
    interface SyncHandler {
        /** Retourne le JSON fusionné en cas de succès, ou null si la charge est invalide / refusée. */
        String onSync(String payloadJson);
    }

    static final int DEFAULT_PORT = 48123;
    static final int MAX_HEAD = 8192;
    static final int MAX_BODY = 2 * 1024 * 1024;
    private static final int MAX_REJECTED = 30;
    private static final int SOCKET_TIMEOUT_MS = 10_000;

    private final ServerSocket socket;
    private final String token;
    private final SyncHandler handler;
    private final ExecutorService workers = new ThreadPoolExecutor(
        2, 2, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(8));
    private final java.util.Set<Socket> clients = ConcurrentHashMap.newKeySet();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean syncing = new AtomicBoolean();
    private final AtomicInteger rejected = new AtomicInteger();

    private LanSyncServer(ServerSocket socket, String token, SyncHandler handler) {
        this.socket = socket;
        this.token = token;
        this.handler = handler;
    }

    static boolean isValidToken(String token) {
        return token != null && token.matches("[a-z0-9]{8,32}");
    }

    static LanSyncServer start(InetAddress address, String token, int preferredPort, SyncHandler handler) throws IOException {
        if (!isValidToken(token)) throw new IllegalArgumentException("Invalid sync token");
        ServerSocket ss;
        try {
            ss = new ServerSocket(preferredPort > 0 ? preferredPort : 0, 8, address);
        } catch (IOException e) {
            if (preferredPort > 0) {
                ss = new ServerSocket(0, 8, address);
            } else {
                throw e;
            }
        }
        LanSyncServer server = new LanSyncServer(ss, token, handler);
        Thread thread = new Thread(server::acceptLoop, "lan-sync-accept");
        thread.setDaemon(true);
        thread.start();
        return server;
    }

    String url() {
        return "http://" + socket.getInetAddress().getHostAddress() + ":" + socket.getLocalPort() + "/sync/" + token;
    }

    boolean isClosed() {
        return socket.isClosed();
    }

    void stop() {
        try { socket.close(); } catch (IOException ignored) { }
        workers.shutdownNow();
        timer.shutdownNow();
        for (Socket client : clients) closeClient(client);
    }

    private void acceptLoop() {
        while (!socket.isClosed()) {
            try {
                Socket client = socket.accept();
                clients.add(client);
                try {
                    client.setSoTimeout(SOCKET_TIMEOUT_MS);
                    timer.schedule(() -> closeClient(client), 15_000, TimeUnit.MILLISECONDS);
                    workers.execute(() -> serve(client));
                } catch (RuntimeException e) {
                    closeClient(client);
                }
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
        } catch (IOException ignored) {
        } finally {
            closeClient(client);
        }
    }

    private byte[] handle(InputStream in) throws IOException {
        String head = readHead(in);
        PairingHttp.Request request = PairingHttp.parseHead(head);
        if (request == null) {
            return jsonResponse(400, "{\"error\":\"bad_request\"}");
        }
        if (!request.path.equals("/sync/" + token)) {
            if (!request.path.equals("/favicon.ico") && rejected.incrementAndGet() >= MAX_REJECTED) stop();
            return jsonResponse(404, "{\"error\":\"not_found\"}");
        }
        if ("GET".equals(request.method)) {
            return jsonResponse(200, "{\"service\":\"cedplay-lan-sync\",\"version\":1}");
        }
        if (!"POST".equals(request.method)) {
            return jsonResponse(405, "{\"error\":\"method_not_allowed\"}");
        }
        if (request.contentLength < 0 || request.contentLength > MAX_BODY) {
            return jsonResponse(413, "{\"error\":\"payload_too_large\"}");
        }
        String body = new String(readExactly(in, request.contentLength), StandardCharsets.UTF_8);
        if (!syncing.compareAndSet(false, true)) {
            return jsonResponse(409, "{\"error\":\"sync_in_progress\"}");
        }
        try {
            String mergedJson = handler.onSync(body);
            if (mergedJson == null) {
                return jsonResponse(400, "{\"error\":\"invalid_or_rejected_payload\"}");
            }
            return jsonResponse(200, mergedJson);
        } finally {
            syncing.set(false);
        }
    }

    private static byte[] jsonResponse(int status, String json) {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        String reason = switch (status) {
            case 200 -> "OK";
            case 400 -> "Bad Request";
            case 404 -> "Not Found";
            case 405 -> "Method Not Allowed";
            case 409 -> "Conflict";
            case 413 -> "Payload Too Large";
            default -> "Error";
        };
        String headers = String.format(
            Locale.ROOT,
            "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: %d\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
            status, reason, body.length
        );
        byte[] head = headers.getBytes(StandardCharsets.ISO_8859_1);
        byte[] full = new byte[head.length + body.length];
        System.arraycopy(head, 0, full, 0, head.length);
        System.arraycopy(body, 0, full, head.length, body.length);
        return full;
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int matched = 0;
        while (head.size() < MAX_HEAD) {
            int b = in.read();
            if (b < 0) return null;
            head.write(b);
            matched = (b == '\r' && (matched == 0 || matched == 2)) || (b == '\n' && (matched == 1 || matched == 3))
                ? matched + 1
                : (b == '\r' ? 1 : 0);
            if (matched == 4) {
                return new String(head.toByteArray(), 0, head.size() - 4, StandardCharsets.ISO_8859_1);
            }
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
