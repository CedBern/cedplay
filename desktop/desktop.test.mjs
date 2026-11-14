import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { getFfmpegPath } from './config.mjs';
import { createDesktopServer } from './server.mjs';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(getFfmpegPath(), args, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

function readSseUntil(url, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('SSE timeout'));
    }, timeoutMs);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) {
            const lines = frame.split('\n');
            let event = 'message';
            let data = '';
            for (const line of lines) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            const parsed = JSON.parse(data);
            if (predicate(event, parsed)) {
              clearTimeout(timer);
              controller.abort();
              resolve({ event, data: parsed });
              return;
            }
          }
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

let tempRoot;
let mediaDir;
let dvrDir;
let distDir;
let dataDir;
let mkvPath;
let tsPath;
let srtPath;
let desktop;
let baseUrl;
let mockServer;
let mockUrl;

before(async () => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cedplay-desktop-test-'));
  mediaDir = path.join(tempRoot, 'media');
  dvrDir = path.join(tempRoot, 'dvr');
  distDir = path.join(tempRoot, 'dist');
  dataDir = path.join(tempRoot, 'data');
  mkdirSync(path.join(mediaDir, 'Films'), { recursive: true });
  mkdirSync(dvrDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });

  writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><head></head><body>OK</body></html>', 'utf8');

  mkvPath = path.join(mediaDir, 'Films', 'Sample.Movie.2026.mkv');
  tsPath = path.join(mediaDir, 'stream.ts');
  srtPath = path.join(mediaDir, 'Films', 'Sample.Movie.2026.fr.srt');
  writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:01,500\nBonjour CedPlay\n', 'utf8');

  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'ac3',
    mkvPath,
  ]);
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=520:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
    '-f', 'mpegts', tsPath,
  ]);

  const { readFileSync } = await import('node:fs');
  const tsBytes = readFileSync(tsPath);

  mockServer = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname === '/echo-ua') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ua: req.headers['user-agent'] || '' }));
      return;
    }
    if (u.pathname === '/epg.xml.gz') {
      const gz = gzipSync(Buffer.from('<tv><channel id="tf1"><display-name>TF1</display-name></channel></tv>', 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/x-gzip' });
      res.end(gz);
      return;
    }
    if (u.pathname === '/live/index.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:2.0,\nseg0.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    if (u.pathname === '/live/seg0.ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': tsBytes.length });
      res.end(tsBytes);
      return;
    }
    if (u.pathname === '/head-rejected') {
      if (req.method === 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(tsBytes.subarray(0, 512));
      return;
    }
    if (u.pathname === '/portal.php') {
      const action = u.searchParams.get('action');
      if (action === 'handshake') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ js: { token: 'TOK123' } }));
        return;
      }
      if (action === 'create_link') {
        assert.equal(req.headers.authorization, 'Bearer TOK123');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ js: { cmd: `ffmpeg ${mockUrl}/live/index.m3u8` } }));
        return;
      }
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockUrl = `http://127.0.0.1:${mockServer.address().port}`;

  desktop = createDesktopServer({ port: 0, distDir, dataDir });
  const started = await desktop.start();
  baseUrl = started.url;
});

after(async () => {
  await desktop?.stop();
  await new Promise((resolve) => mockServer?.close(resolve));
  rmSync(tempRoot, { recursive: true, force: true });
});

test('health, static HTML desktop injection, and origin guard', async () => {
  const health = await fetch(`${baseUrl}/api/desktop/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.desktop, true);
  assert.equal(health.ffmpeg, true);
  assert.equal(health.ffprobe, true);

  const html = await fetch(`${baseUrl}/`).then((r) => r.text());
  assert.match(html, /window\.__CEDPLAY_DESKTOP__=true/);

  const evil = await fetch(`${baseUrl}/api/desktop/health`, {
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(evil.status, 403);
});

test('http bridge forwards custom User-Agent, gunzips XMLTV, and rewrites m3u8', async () => {
  const uaRes = await fetch(`${baseUrl}/api/desktop/http`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${mockUrl}/echo-ua`,
      headers: { 'User-Agent': 'VLC/3.0.21' },
      responseType: 'json',
    }),
  }).then((r) => r.json());
  assert.equal(uaRes.status, 200);
  assert.equal(uaRes.data.ua, 'VLC/3.0.21');

  const gzRes = await fetch(`${baseUrl}/api/desktop/http`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${mockUrl}/epg.xml.gz`,
      gunzip: true,
      responseType: 'text',
    }),
  }).then((r) => r.json());
  assert.match(gzRes.data, /<display-name>TF1<\/display-name>/);

  const m3u8Res = await fetch(`${baseUrl}/api/desktop/proxy?url=${encodeURIComponent(`${mockUrl}/live/index.m3u8`)}`).then((r) => r.text());
  assert.match(m3u8Res, /\/api\/desktop\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Flive%2Fseg0\.ts/);
});

test('local library scan, SRT->VTT subtitle, byte-range stream, probe-media, and FFmpeg MKV+AC3 transmux', async () => {
  const pick = await fetch(`${baseUrl}/api/desktop/local/pick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: mediaDir }),
  }).then((r) => r.json());
  assert.ok(pick.folder?.uri?.startsWith('local://'));

  const scan = await fetch(`${baseUrl}/api/desktop/local/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((r) => r.json());
  const mkvItem = scan.files.find((f) => f.name.endsWith('.mkv'));
  assert.ok(mkvItem);
  assert.ok(mkvItem.subtitleUri);

  const sub = await fetch(`${baseUrl}/api/desktop/subtitle?uri=${encodeURIComponent(mkvItem.subtitleUri)}`).then((r) => r.text());
  assert.match(sub, /^WEBVTT/);
  assert.match(sub, /00:00:00\.000 --> 00:00:01\.500/);

  const rangeRes = await fetch(`${baseUrl}/api/desktop/local/file?uri=${encodeURIComponent(mkvItem.uri)}`, {
    headers: { Range: 'bytes=0-15' },
  });
  assert.equal(rangeRes.status, 206);
  const slice = Buffer.from(await rangeRes.arrayBuffer());
  assert.equal(slice.length, 16);

  const probe = await fetch(`${baseUrl}/api/desktop/probe-media?url=${encodeURIComponent(mkvItem.uri)}`).then((r) => r.json());
  assert.ok(probe.durationSec > 1.5);
  assert.equal(probe.videoCodec, 'h264');
  assert.equal(probe.audioCodec, 'ac3');

  const transmuxRes = await fetch(`${baseUrl}/api/desktop/transmux?url=${encodeURIComponent(mkvItem.uri)}`);
  assert.equal(transmuxRes.status, 200);
  const mp4 = Buffer.from(await transmuxRes.arrayBuffer());
  assert.ok(mp4.length > 4000);
  assert.ok(mp4.includes(Buffer.from('ftyp')));
  assert.ok(mp4.includes(Buffer.from('moov')));
  assert.ok(mp4.includes(Buffer.from('moof')));
});

test('stream probe & stalker resolve work end-to-end', async () => {
  const probed = await fetch(`${baseUrl}/api/desktop/probe-streams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: [
        `${mockUrl}/live/seg0.ts`,
        `${mockUrl}/head-rejected`,
        `${mockUrl}/missing`,
      ],
    }),
  }).then((r) => r.json());
  assert.deepEqual(probed.results.map((r) => r.ok), [true, true, false]);

  const stalker = await fetch(`${baseUrl}/api/desktop/stalker-resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      portalUrl: `${mockUrl}/portal.php`,
      mac: '00:1A:79:11:22:33',
      cmd: 'ffrt http://example.invalid/ch1',
    }),
  }).then((r) => r.json());
  assert.equal(stalker.url, `${mockUrl}/live/index.m3u8`);
});

test('DVR pick folder, instant FFmpeg capture, list, schedule, and delete work', async () => {
  const picked = await fetch(`${baseUrl}/api/desktop/recordings/pick-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dvrDir }),
  }).then((r) => r.json());
  assert.equal(picked.folder.name, 'dvr');

  const started = await fetch(`${baseUrl}/api/desktop/recordings/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${mockUrl}/live/seg0.ts`, title: 'Journal Test' }),
  }).then((r) => r.json());
  assert.ok(started.recording.id);

  await new Promise((r) => setTimeout(r, 900));

  await fetch(`${baseUrl}/api/desktop/recordings/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: started.recording.id }),
  });

  const list = await fetch(`${baseUrl}/api/desktop/recordings/list`).then((r) => r.json());
  assert.equal(list.files.length, 1);
  assert.ok(list.files[0].size > 1000);

  const schedRes = await fetch(`${baseUrl}/api/desktop/recordings/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${mockUrl}/live/seg0.ts`,
      title: 'Future Show',
      startTimeMs: Date.now() + 60000,
      durationMs: 60000,
    }),
  }).then((r) => r.json());
  assert.ok(schedRes.schedule.id);

  const scheds = await fetch(`${baseUrl}/api/desktop/recordings/schedules`).then((r) => r.json());
  assert.equal(scheds.schedules.length, 1);

  await fetch(`${baseUrl}/api/desktop/recordings/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: schedRes.schedule.id }),
  });
  await fetch(`${baseUrl}/api/desktop/recordings/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri: list.files[0].uri }),
  });
  const afterDel = await fetch(`${baseUrl}/api/desktop/recordings/list`).then((r) => r.json());
  assert.equal(afterDel.files.length, 0);
});

test('QR pairing & LAN sync servers round-trip via SSE events + ack', async () => {
  // Pairing
  const ssePair = readSseUntil(`${baseUrl}/api/desktop/events`, (ev) => ev === 'pairingCredentials');
  const pairStart = await fetch(`${baseUrl}/api/desktop/pairing/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: '127.0.0.1' }),
  }).then((r) => r.json());
  assert.match(pairStart.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-z0-9]+$/);

  const pairForm = await fetch(pairStart.url).then((r) => r.text());
  assert.match(pairForm, /Connecter ton abonnement/);

  const postPromise = fetch(pairStart.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ server: 'http://iptv.example:8080', username: 'ced', password: 'secret' }),
  });

  const pairEvent = await ssePair;
  assert.equal(pairEvent.data.username, 'ced');
  await fetch(`${baseUrl}/api/desktop/pairing/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: pairEvent.data.requestId, accepted: true }),
  });
  const pairDone = await postPromise.then((r) => r.text());
  assert.match(pairDone, /C’est envoyé/);
  await fetch(`${baseUrl}/api/desktop/pairing/stop`, { method: 'POST', body: '{}' });

  // LAN Sync
  const sseSync = readSseUntil(`${baseUrl}/api/desktop/events`, (ev) => ev === 'lanSyncRequest');
  const syncStart = await fetch(`${baseUrl}/api/desktop/lan-sync/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'abcd1234efgh5678', host: '127.0.0.1', preferredPort: 0 }),
  }).then((r) => r.json());
  assert.match(syncStart.url, /^http:\/\/127\.0\.0\.1:\d+\/sync\/abcd1234efgh5678$/);

  const info = await fetch(syncStart.url).then((r) => r.json());
  assert.equal(info.service, 'cedplay-lan-sync');

  const syncPost = fetch(syncStart.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, deviceId: 'phone', updatedAt: 10, vodHistory: [], watchlist: [] }),
  });
  const syncEvent = await sseSync;
  const merged = JSON.stringify({ version: 1, deviceId: 'desktop', updatedAt: 20, vodHistory: [], watchlist: [] });
  await fetch(`${baseUrl}/api/desktop/lan-sync/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: syncEvent.data.requestId, ok: true, mergedJson: merged }),
  });
  const syncResult = await syncPost.then((r) => r.json());
  assert.equal(syncResult.deviceId, 'desktop');
  await fetch(`${baseUrl}/api/desktop/lan-sync/stop`, { method: 'POST', body: '{}' });
});
