package com.lecteur.iptv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class PairingServerTest {
    private final List<String[]> received = new ArrayList<>();
    private PairingServer server;
    private URI url;

    @Before public void demarre() throws Exception {
        server = PairingServer.start(InetAddress.getLoopbackAddress(),
            (s, u, p) -> { synchronized (received) { received.add(new String[] { s, u, p }); } return true; });
        url = URI.create(server.url());
    }

    @After public void arrete() { server.stop(); }

    private String send(String request) throws Exception {
        try (Socket socket = new Socket(url.getHost(), url.getPort())) {
            socket.getOutputStream().write(request.getBytes(StandardCharsets.UTF_8));
            socket.getOutputStream().flush();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            InputStream in = socket.getInputStream();
            byte[] buffer = new byte[4096];
            for (int n; (n = in.read(buffer)) >= 0;) out.write(buffer, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private String post(String path, String body) throws Exception {
        return send("POST " + path + " HTTP/1.1\r\nHost: tv\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: "
            + body.getBytes(StandardCharsets.UTF_8).length + "\r\n\r\n" + body);
    }

    @Test public void adresseAvecJetonDeHuitCaracteresRecopiables() {
        assertTrue(server.url(), url.getPath().matches("/[a-hjkmnp-z2-9]{8}"));
    }

    @Test public void sertLeFormulaireAuTelephoneQuiScanneLeCode() throws Exception {
        String response = send("GET " + url.getPath() + " HTTP/1.1\r\nHost: tv\r\n\r\n");
        assertTrue(response.startsWith("HTTP/1.1 200 OK"));
        assertTrue(response.contains("name=\"server\""));
        assertTrue(response.contains("Cache-Control: no-store"));
        assertTrue(response.contains("type=\"password\""));
    }

    @Test public void transmetLesIdentifiantsSaisisSurLeTelephone() throws Exception {
        String response = post(url.getPath(), "server=http%3A%2F%2Fserveur.test%3A8080&username=+marie+&password=p%26a%3Dss%2B1");
        assertTrue(response.startsWith("HTTP/1.1 200 OK"));
        assertTrue(response.contains("C’est envoyé"));
        assertEquals(1, received.size());
        assertEquals("http://serveur.test:8080", received.get(0)[0]);
        assertEquals("marie", received.get(0)[1]);
        assertEquals("p&a=ss+1", received.get(0)[2]);
    }

    @Test public void accepteUnLienM3uCompletSansLesAutresChamps() throws Exception {
        post(url.getPath(), "server=http%3A%2F%2Fserveur.test%2Fget.php%3Fusername%3Dmarie%26password%3Dsecret%26type%3Dm3u_plus&username=&password=");
        assertEquals(1, received.size());
        assertEquals("http://serveur.test/get.php?username=marie&password=secret&type=m3u_plus", received.get(0)[0]);
    }

    @Test public void redemandeUneSaisieIncompleteSansRienTransmettre() throws Exception {
        String response = post(url.getPath(), "server=http%3A%2F%2Fserveur.test&username=%22marie%3C&password=");
        assertTrue(response.startsWith("HTTP/1.1 400"));
        assertTrue(response.contains("Indique l’identifiant et le mot de passe."));
        // La saisie est réaffichée, échappée.
        assertTrue(response.contains("value=\"&quot;marie&lt;\""));
        assertEquals(0, received.size());
    }

    @Test public void neRepondRienDUtileSansLeJeton() throws Exception {
        assertTrue(send("GET / HTTP/1.1\r\nHost: tv\r\n\r\n").startsWith("HTTP/1.1 404"));
        String response = post("/aaaaaaaa", "server=http%3A%2F%2Fx.test&username=a&password=b");
        assertTrue(response.startsWith("HTTP/1.1 404"));
        assertFalse(response.contains("name=\"server\""));
        assertEquals(0, received.size());
    }

    @Test public void refuseUnEnvoiDemesureEtUneRequeteIllisible() throws Exception {
        assertTrue(send("POST " + url.getPath() + " HTTP/1.1\r\nContent-Length: 999999\r\n\r\n").startsWith("HTTP/1.1 413"));
        assertTrue(send("n'importe quoi\r\n\r\n").startsWith("HTTP/1.1 400"));
        assertEquals(0, received.size());
    }

    @Test public void seFermeQuandLeJetonEstCherche() throws Exception {
        for (int i = 0; i < 30; i++) { try { send("GET /essai" + i + " HTTP/1.1\r\n\r\n"); } catch (java.io.IOException ignored) { } }
        assertTrue(server.isClosed());
    }

    @Test public void lIconeDemandeeParLeNavigateurNeCompteJamaisCommeUneTentative() throws Exception {
        for (int i = 0; i < 40; i++) send("GET /favicon.ico HTTP/1.1\r\n\r\n");
        assertFalse(server.isClosed());
    }

    @Test public void leMotDePasseNEstJamaisRenvoyeAuTelephone() throws Exception {
        String response = post(url.getPath(), "server=http%3A%2F%2Fserveur.test&username=&password=tressecret");
        assertTrue(response.startsWith("HTTP/1.1 400"));
        assertFalse(response.contains("tressecret"));
        assertEquals(0, received.size());
    }

    @Test public void neConfirmePasUnEnvoiQueLeTeleviseurNAPasAccepte() throws Exception {
        server.stop();
        server = PairingServer.start(InetAddress.getLoopbackAddress(), (s, u, p) -> false);
        url = URI.create(server.url());
        String response = post(url.getPath(), "server=http%3A%2F%2Fserveur.test&username=marie&password=secret");
        assertTrue(response.startsWith("HTTP/1.1 409"));
        assertTrue(response.contains("Envoi non accepté"));
        assertFalse(response.contains("C’est envoyé"));
    }

    @Test public void refuseUnDeuxiemeEnvoiTantQueLePremierAttendLeTeleviseur() throws Exception {
        server.stop();
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        server = PairingServer.start(InetAddress.getLoopbackAddress(), (s, u, p) -> {
            entered.countDown();
            try { return release.await(5, java.util.concurrent.TimeUnit.SECONDS); }
            catch (InterruptedException e) { return false; }
        });
        url = URI.create(server.url());
        String body = "server=http%3A%2F%2Fserveur.test&username=marie&password=secret";
        java.util.concurrent.ExecutorService first = java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            java.util.concurrent.Future<String> pending = first.submit(() -> post(url.getPath(), body));
            assertTrue(entered.await(3, java.util.concurrent.TimeUnit.SECONDS));
            assertTrue(post(url.getPath(), body).startsWith("HTTP/1.1 409"));
            release.countDown();
            assertTrue(pending.get(5, java.util.concurrent.TimeUnit.SECONDS).startsWith("HTTP/1.1 200 OK"));
        } finally { release.countDown(); first.shutdownNow(); }
    }

    @Test public void seFermeSeulALExpiration() throws Exception {
        server.stop();
        server = PairingServer.start(InetAddress.getLoopbackAddress(), (s, u, p) -> true, 150);
        assertFalse(server.isClosed());
        for (int i = 0; i < 40 && !server.isClosed(); i++) Thread.sleep(50);
        assertTrue(server.isClosed());
    }

    /** Vrai si le serveur a coupé la connexion (fin de flux ou erreur), faux s'il la garde ouverte. */
    private static boolean coupee(Socket socket) throws Exception {
        socket.setSoTimeout(2000);
        try { return socket.getInputStream().read() < 0; }
        catch (java.net.SocketTimeoutException e) { return false; }
        catch (java.io.IOException e) { return true; }
    }

    @Test public void lArretCoupeLesConnexionsEnCours() throws Exception {
        try (Socket idle = new Socket(url.getHost(), url.getPort())) {
            Thread.sleep(200);
            server.stop();
            assertTrue(coupee(idle));
        }
    }

    @Test public void coupeLesConnexionsAuDelaDeLaFileDAttente() throws Exception {
        // 2 en traitement et 4 en attente : la septième connexion muette est coupée aussitôt.
        List<Socket> idle = new ArrayList<>();
        try {
            for (int i = 0; i < 7; i++) { idle.add(new Socket(url.getHost(), url.getPort())); Thread.sleep(50); }
            assertTrue(coupee(idle.get(6)));
        } finally { for (Socket socket : idle) socket.close(); }
    }

    @Test public void litLesEnTetesEtLesFormulaires() {
        PairingHttp.Request request = PairingHttp.parseHead("POST /abc?x=1 HTTP/1.1\r\ncontent-LENGTH: 12\r\nHost: tv");
        assertEquals("POST", request.method);
        assertEquals("/abc", request.path);
        assertEquals(12, request.contentLength);
        assertNull(PairingHttp.parseHead("GET /abc"));
        assertNull(PairingHttp.parseHead("GET /abc HTTP/1.1\r\nContent-Length: -4"));
        Map<String, String> form = PairingHttp.parseForm("a=1&b=%E9t%C3%A9&c=%zz&=vide&d");
        assertEquals("1", form.get("a"));
        assertFalse(form.containsKey("c"));
        assertEquals(2, form.size());
    }
}
