package com.lecteur.iptv;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class LanSyncServerTest {

    @Test
    public void getPostAndRejectWrongToken() throws Exception {
        LanSyncServer server = LanSyncServer.start(
            InetAddress.getLoopbackAddress(),
            "abcd2345efgh",
            0,
            payloadJson -> "{\"merged\":true,\"echo\":" + payloadJson + "}"
        );
        try {
            assertFalse(server.isClosed());

            // 1. GET sur la bonne URL
            HttpURLConnection getConn = (HttpURLConnection) new URL(server.url()).openConnection();
            getConn.setRequestMethod("GET");
            assertEquals(200, getConn.getResponseCode());
            assertTrue(readBody(getConn.getInputStream()).contains("cedplay-lan-sync"));

            // 2. POST avec payload JSON -> renvoie le JSON fusionné
            HttpURLConnection postConn = (HttpURLConnection) new URL(server.url()).openConnection();
            postConn.setRequestMethod("POST");
            postConn.setDoOutput(true);
            byte[] payload = "{\"hello\":1}".getBytes(StandardCharsets.UTF_8);
            postConn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream os = postConn.getOutputStream()) {
                os.write(payload);
            }
            assertEquals(200, postConn.getResponseCode());
            String resp = readBody(postConn.getInputStream());
            assertTrue(resp.contains("\"merged\":true"));
            assertTrue(resp.contains("\"hello\":1"));

            // 3. Mauvais jeton -> 404
            String badUrl = server.url().replace("abcd2345efgh", "wrongtoken99");
            HttpURLConnection badConn = (HttpURLConnection) new URL(badUrl).openConnection();
            badConn.setRequestMethod("GET");
            assertEquals(404, badConn.getResponseCode());
        } finally {
            server.stop();
        }
        assertTrue(server.isClosed());
    }

    private static String readBody(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        int n;
        while ((n = in.read(buf)) >= 0) {
            out.write(buf, 0, n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
