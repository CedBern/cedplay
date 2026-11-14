import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { getFfmpegPath, REPO_ROOT } from './config.mjs';
import { createDesktopServer } from './server.mjs';

const SCREENSHOT_DIR = path.join(REPO_ROOT, 'preuves', 'desktop-verification');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(getFfmpegPath(), args, { timeout: 25000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`));
      else resolve();
    });
  });
}

function findBrowserExe() {
  const edgeCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (const c of edgeCandidates) {
    if (existsSync(c) && !existsSync(path.join(path.dirname(c), 'msedge_IFEO.exe'))) {
      return c;
    }
  }
  const chromeCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  for (const c of chromeCandidates) {
    if (existsSync(c)) return c;
  }
  throw new Error('Aucun navigateur Chromium (Edge non bloqué / Chrome / Brave) trouvé.');
}

async function connectCdp(cdpPort, urlIncludes) {
  let targetWsUrl = '';
  for (let i = 0; i < 50; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
      const hit = list.find((t) => t.type === 'page' && String(t.url || '').includes(urlIncludes));
      if (hit?.webSocketDebuggerUrl) {
        targetWsUrl = hit.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* waiting for Edge CDP */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!targetWsUrl) throw new Error('Cible CDP Edge introuvable.');

  const ws = new WebSocket(targetWsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let seq = 1;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push(JSON.stringify(msg.params.args));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(msg.params.exceptionDetails));
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  // Une autre fenêtre Windows ne doit pas absorber le premier clic du test.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evalJs = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  };

  const screenshot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(SCREENSHOT_DIR, name), Buffer.from(data, 'base64'));
  };

  const waitFor = async (fnExpr, timeoutMs = 15000, label = fnExpr) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const val = await evalJs(fnExpr).catch(() => false);
      if (val) return val;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timeout attente UI: ${label}`);
  };

  const pressKey = async (key) => {
    const defs = {
      Escape: { code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
      ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
    };
    const extra = defs[key] || {};
    await send('Page.bringToFront');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, ...extra });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...extra });
  };

  const clickSelector = async (selector) => {
    await waitFor(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || getComputedStyle(el).pointerEvents === 'none') return false;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && el.contains(top);
    })()`, 12000, `click target visible: ${selector}`);
    const box = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`Élément introuvable: ${selector}`);
    await send('Page.bringToFront');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  };

  return { ws, send, evalJs, screenshot, waitFor, pressKey, clickSelector, consoleErrors, pageErrors };
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cedplay-e2e-'));
  const mediaDir = path.join(tempRoot, 'media');
  const dvrDir = path.join(tempRoot, 'dvr');
  const dataDir = path.join(tempRoot, 'data');
  const profileDir = path.join(tempRoot, 'edge-profile');
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(dvrDir, { recursive: true });
  mkdirSync(profileDir, { recursive: true });

  const mp4Path = path.join(mediaDir, 'Fixture.Film.2026.mp4');
  const mkvPath = path.join(mediaDir, 'Grand.Film.Desktop.2026.mkv');
  const tsPath = path.join(mediaDir, 'live.ts');
  const audioPath = path.join(tempRoot, 'podcast.mp3');
  const srtPath = path.join(mediaDir, 'Grand.Film.Desktop.2026.fr.srt');
  const embeddedSubtitlePath = path.join(tempRoot, 'embedded.fr.srt');
  writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:30,000\nSous-titre CedPlay vérifié\n', 'utf8');
  writeFileSync(embeddedSubtitlePath, '1\n00:00:00,000 --> 00:00:30,000\nSous-titre interne vérifié\n', 'utf8');

  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-c:a', 'libmp3lame', audioPath,
  ]);
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    mp4Path,
  ]);
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=30:size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=30',
    '-i', embeddedSubtitlePath,
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=fra',
    '-metadata:s:s:0', 'language=fra', '-c:s', 'srt',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'ac3',
    mkvPath,
  ]);
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=520:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-f', 'mpegts', tsPath,
  ]);

  const tsBytes = readFileSync(tsPath);
  const mp4Bytes = readFileSync(mp4Path);
  const audioBytes = readFileSync(audioPath);
  const posterSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#181214"/><circle cx="150" cy="180" r="64" fill="#FF5A36"/><text x="150" y="340" fill="#fff" font-size="28" font-family="sans-serif" text-anchor="middle">CEDPLAY</text></svg>';

  const nowMs = Date.now();
  const todayMidnight = new Date(nowMs);
  todayMidnight.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtXmltvTime = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
  const progStart = new Date(Math.max(todayMidnight.getTime(), nowMs - 900_000));
  const progEnd = new Date(Math.max(progStart.getTime() + 600_000, nowMs + 1_800_000));
  const nextEnd = new Date(progEnd.getTime() + 3_600_000);

  let liveHlsSeq = 1;
  let fixtureUrl = '';
  const fixtureServer = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/podcast.xml') {
      res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      res.end(`<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Podcast Desktop audit</title><description>Fixture locale</description><item><guid>desktop-audio-fixture</guid><title>Épisode audio de contrôle</title><enclosure url="${fixtureUrl}/podcast.mp3" type="audio/mpeg" length="${audioBytes.length}"/><itunes:duration>00:00:30</itunes:duration></item></channel></rss>`);
      return;
    }
    if (u.pathname === '/podcast.mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audioBytes.length });
      res.end(audioBytes);
      return;
    }
    if (u.pathname === '/poster.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(posterSvg);
      return;
    }
    if (u.pathname === '/live/ch1.m3u8' || u.pathname === '/live/ch2.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg0.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    if (u.pathname === '/live/seg0.ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': tsBytes.length });
      res.end(tsBytes);
      return;
    }
    if (u.pathname === '/movie.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': mp4Bytes.length, 'Accept-Ranges': 'bytes' });
      res.end(mp4Bytes);
      return;
    }
    if (u.pathname === '/playlist.m3u') {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8' });
      res.end([
        `#EXTM3U url-tvg="${fixtureUrl}/epg.xml"`,
        `#EXTINF:-1 tvg-id="tf1.fr" tvg-chno="1" tvg-logo="${fixtureUrl}/poster.svg" group-title="France HD",TF1 HD`,
        `${fixtureUrl}/live/ch1.m3u8`,
        `#EXTINF:-1 tvg-id="fr2.fr" tvg-chno="2" tvg-logo="${fixtureUrl}/poster.svg" group-title="France HD",France 2 HD`,
        `${fixtureUrl}/live/ch2.m3u8`,
        `#EXTINF:-1 tvg-id="arte.fr" tvg-chno="7" group-title="Culture",ARTE HD`,
        `${fixtureUrl}/movie.mp4`,
        `#EXTINF:-1 tvg-id="film.vod" group-title="VOD Cinéma",Grand Film Démo 2026`,
        `${fixtureUrl}/movie.mp4`,
      ].join('\n'));
      return;
    }
    if (u.pathname === '/epg.xml' || u.pathname === '/xmltv.php') {
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(`<tv>
        <channel id="tf1.fr"><display-name>TF1 HD</display-name></channel>
        <channel id="fr2.fr"><display-name>France 2 HD</display-name></channel>
        <programme start="${fmtXmltvTime(progStart)}" stop="${fmtXmltvTime(progEnd)}" channel="tf1.fr"><title lang="fr">Le Grand Direct Cinéma</title><desc>Édition spéciale Desktop Windows</desc></programme>
        <programme start="${fmtXmltvTime(progEnd)}" stop="${fmtXmltvTime(nextEnd)}" channel="tf1.fr"><title lang="fr">Soirée Documentaire</title></programme>
        <programme start="${fmtXmltvTime(progStart)}" stop="${fmtXmltvTime(progEnd)}" channel="fr2.fr"><title lang="fr">Journal de la Nuit</title><desc>Actualités en direct</desc></programme>
      </tv>`);
      return;
    }
    if (u.pathname === '/player_api.php') {
      const action = u.searchParams.get('action') || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (!action) {
        res.end(JSON.stringify({ user_info: { auth: 1, status: 'Active' }, server_info: { timezone: 'Europe/Paris' } }));
      } else if (action === 'get_live_categories') {
        res.end(JSON.stringify([{ category_id: '10', category_name: 'France HD' }]));
      } else if (action === 'get_live_streams') {
        res.end(JSON.stringify([
          { num: 1, name: 'TF1 HD', stream_id: 101, stream_icon: `${fixtureUrl}/poster.svg`, epg_channel_id: 'tf1.fr', category_id: '10' },
          { num: 2, name: 'France 2 HD', stream_id: 102, stream_icon: `${fixtureUrl}/poster.svg`, epg_channel_id: 'fr2.fr', category_id: '10' },
          { num: 3, name: 'France 3 HD', stream_id: 103, stream_icon: `${fixtureUrl}/poster.svg`, category_id: '10' },
          { num: 4, name: 'Arte HD', stream_id: 104, stream_icon: `${fixtureUrl}/poster.svg`, category_id: '10' },
        ]));
      } else if (action === 'get_vod_categories') {
        res.end(JSON.stringify([{ category_id: '20', category_name: 'Cinéma 4K' }]));
      } else if (action === 'get_vod_streams') {
        res.end(JSON.stringify([
          { stream_id: 201, name: 'Odyssee Salle Obscure', stream_icon: `${fixtureUrl}/poster.svg`, category_id: '20', container_extension: 'mp4', rating: '8.7' },
          { stream_id: 202, name: 'Documentaire Nordique', stream_icon: `${fixtureUrl}/poster.svg`, category_id: '20', container_extension: 'mp4', rating: '8.2' },
        ]));
      } else if (action === 'get_vod_info') {
        res.end(JSON.stringify({
          info: { plot: 'Un film de démonstration complet sous CedPlay Windows Desktop.', releasedate: '2026-11-01', duration: '01:45:00' },
          movie_data: { stream_id: 201, container_extension: 'mp4' },
        }));
      } else if (action === 'get_series_categories') {
        res.end(JSON.stringify([{ category_id: '30', category_name: 'Séries Originales' }]));
      } else if (action === 'get_series') {
        res.end(JSON.stringify([
          { series_id: 301, name: 'Les Chroniques Desktop', cover: `${fixtureUrl}/poster.svg`, category_id: '30', rating: '9.1' },
        ]));
      } else if (action === 'get_series_info') {
        res.end(JSON.stringify({
          info: { plot: 'Série vérifiée sur CedPlay Desktop Windows.', releaseDate: '2026' },
          episodes: {
            1: [
              { id: 3001, episode_num: 1, title: 'Épisode Pilote', container_extension: 'mp4' },
              { id: 3002, episode_num: 2, title: 'La Suite', container_extension: 'mp4' },
            ],
          },
        }));
      } else {
        res.end('[]');
      }
      return;
    }
    if (/\/(live|movie|series)\//.test(u.pathname)) {
      if (u.pathname.endsWith('/103.ts')) {
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
        let count = 0;
        const iv = setInterval(() => {
          if (res.writableEnded || res.destroyed || count >= 30) {
            clearInterval(iv);
            if (!res.writableEnded) res.end();
            return;
          }
          res.write(tsBytes);
          count += 1;
        }, 250);
        res.write(tsBytes);
        req.on('close', () => clearInterval(iv));
      } else if (u.pathname.endsWith('/103.m3u8')) {
        const seq = liveHlsSeq++;
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
        res.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${seq}\n#EXTINF:2.0,\n${fixtureUrl}/live/seg${seq}.ts\n`);
      } else if (u.pathname.endsWith('.m3u8')) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\n${fixtureUrl}/live/seg0.ts\n#EXT-X-ENDLIST\n`);
      } else if (u.pathname.endsWith('.ts')) {
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': tsBytes.length });
        res.end(tsBytes);
      } else {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': mp4Bytes.length, 'Accept-Ranges': 'bytes' });
        res.end(mp4Bytes);
      }
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}`;

  const notifLogPath = path.join(tempRoot, 'notifications.jsonl');
  process.env.CEDPLAY_DATA_DIR = dataDir;
  process.env.CEDPLAY_TEST_PICK_FOLDER = mediaDir;
  process.env.CEDPLAY_NOTIFICATION_LOG = notifLogPath;
  process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS = '1';
  const desktop = createDesktopServer({ port: 0, dataDir });
  const { port: desktopPort, url: desktopUrl } = await desktop.start();

  // Pré-configurer un dossier DVR et un dossier local via l'API Desktop
  await fetch(`${desktopUrl}/api/desktop/recordings/pick-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dvrDir }),
  });
  await fetch(`${desktopUrl}/api/desktop/local/pick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: mediaDir }),
  });

  const cdpPort = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      probe.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 19222));
    });
    probe.on('error', reject);
  });
  const browserExe = findBrowserExe();
  const edgeProc = spawn(browserExe, [
    `--app=${desktopUrl}/?desktop=1`,
    `--remote-debugging-port=${cdpPort}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,720',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    console.log(`[E2E] Connexion CDP sur port ${cdpPort} (${path.basename(browserExe)}) -> ${desktopUrl}`);
    cdp = await connectCdp(cdpPort, `127.0.0.1:${desktopPort}`);
    console.log('[E2E] Connecté au CDP');
    await cdp.waitFor('document.documentElement.classList.contains("tv-mode") && document.documentElement.classList.contains("desktop-mode")', 15000, 'desktop+tv classes');
    console.log('[E2E] Classes tv-mode + desktop-mode actives');

    await cdp.waitFor(`!!document.querySelector('[data-main-navigation] [role="tab"][aria-label="Plus"]')`, 15000, 'navigation ready');
    console.log('[E2E] Navigation prête, ouverture Plus -> Connexion Xtream');

    // Ouvrir Plus -> Connexion Xtream
    await cdp.clickSelector('[role="tab"][aria-label="Plus"]');
    await cdp.waitFor(`!!document.querySelector('[data-more-panel]')`, 10000, 'more panel initial');
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('[data-more-panel] button')).find(x => /Connexion Xtream/i.test(x.textContent || ''));
      btn?.click();
    })()`);

    await cdp.waitFor(`!!document.querySelector('input[placeholder*="serveur"]')`, 10000, 'xtream login dialog');
    await cdp.evalJs(`(() => {
      const setVal = (el, val) => {
        el.click();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const srv = document.querySelector('input[placeholder*="serveur"]');
      const usr = document.querySelector('input[placeholder="Identifiant"]');
      const pwd = document.querySelector('input[type="password"]');
      if (srv) setVal(srv, ${JSON.stringify(fixtureUrl)});
      if (usr) setVal(usr, 'demo');
      if (pwd) setVal(pwd, 'demo');
    })()`);

    await cdp.waitFor(`(() => {
      const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find(x => /Se connecter/i.test(x.textContent || ''));
      return b && !b.disabled;
    })()`, 5000, 'xtream submit enabled');
    await cdp.evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find(x => /Se connecter/i.test(x.textContent || ''));
      b?.click();
    })()`);

    await cdp.waitFor(`!!document.querySelector('[data-xtream-import]:not(:disabled)')`, 15000, 'xtream categories step');
    await cdp.clickSelector('[data-xtream-import]');
    await cdp.waitFor(`!document.querySelector('[role="dialog"]') && !!document.querySelector('[data-tv-live]')`, 15000, 'xtream playlist imported');
    console.log('[E2E] Playlist Xtream importée');

    // Onglet Découvrir
    await cdp.clickSelector('[role="tab"][aria-label="Découvrir"]');
    await cdp.waitFor(`!!document.querySelector('[data-discover-screen]')`, 12000, 'discover loaded');
    await new Promise((r) => setTimeout(r, 600));
    await cdp.screenshot('01-discover-dark.png');

    // Survol du rail gauche pour vérifier l'ouverture fluide à la souris
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500, y: 360 });
    await new Promise((r) => setTimeout(r, 80));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 240 });
    await cdp.waitFor(`document.querySelector('.tv-sidebar')?.getAttribute('data-expanded') === 'true'`, 3000, 'sidebar hover expand');
    await new Promise((r) => setTimeout(r, 250));
    const navExpanded = await cdp.evalJs(`document.querySelector('.tv-sidebar')?.getAttribute('data-expanded')`);
    assert.equal(navExpanded, 'true', 'Le rail gauche doit s’ouvrir au survol de la souris');
    await cdp.screenshot('02-sidebar-hover.png');

    // Quitter le rail à la souris et vérifier qu'il se referme
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 360 });
    await cdp.waitFor(`document.querySelector('.tv-sidebar')?.getAttribute('data-expanded') === 'false'`, 3000, 'sidebar hover collapse');
    await cdp.clickSelector('[role="tab"][aria-label="Direct"]');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 360 });
    await cdp.waitFor(`!!document.querySelector('[data-tv-live] [data-tv-row="0"]')`, 10000, 'tv-live row 0');
    await cdp.evalJs(`(() => {
      const row = document.querySelector('[data-tv-row="0"]');
      row?.focus();
    })()`);
    try {
      await cdp.waitFor(`(() => {
        const v = document.querySelector('[data-desktop-live-preview] video');
        return v && v.readyState >= 2 && v.videoWidth > 0;
      })()`, 12000, 'live preview decoding video frames');
    } catch (err) {
      const diag = await cdp.evalJs(`(() => {
        const p = document.querySelector('[data-desktop-live-preview]');
        const v = p?.querySelector('video');
        const col = document.querySelector('[data-tv-live]')?.getAttribute('data-tv-column');
        return { hasBox: !!p, col, activeTag: document.activeElement?.tagName, activeAttr: document.activeElement?.getAttribute('data-tv-row'), src: v?.src, readyState: v?.readyState, error: v?.error?.message || v?.error?.code || null };
      })()`);
      console.error('[E2E] Diagnostic live preview:', diag);
      throw err;
    }
    await cdp.screenshot('03-live-tv-3col-preview.png');

    // Lancer le lecteur Cinema Direct en plein écran
    await cdp.clickSelector('[data-tv-info="0"]');
    await cdp.waitFor(`(() => {
      const box = document.querySelector('[data-desktop-cinema-player="live"]');
      const v = box?.querySelector('video');
      return !!v && v.readyState >= 2 && v.videoWidth > 0 && !/Ouverture du lecteur/i.test(document.body.innerText);
    })()`, 12000, 'live cinema player decoding');
    await cdp.screenshot('04-live-cinema-player.png');

    // Fermer le lecteur Cinema Live via Escape
    await cdp.pressKey('Escape');
    await cdp.waitFor(`!document.querySelector('[data-desktop-cinema-player]')`, 5000, 'cinema player closed');

    await cdp.clickSelector('[data-tv-info][aria-label="Mosaïque"]');
    await cdp.waitFor(`document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length >= 2`, 5000, 'mosaic picker');
    await cdp.clickSelector('[role="dialog"] input[type="checkbox"]:not(:checked)');
    await cdp.evalJs(`(() => {
      const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => /Lancer la mosaïque/.test(b.textContent || ''));
      button?.click();
    })()`);
    await cdp.waitFor(`(() => {
      const box = document.querySelector('[data-desktop-mosaic-player]');
      const videos = Array.from(box?.querySelectorAll('video') || []);
      if (videos.length !== 2 || !videos.every(v => v.readyState >= 2 && v.videoWidth > 0)) return false;
      const close = Array.from(box.querySelectorAll('button')).find(b => /Quitter/.test(b.textContent || ''));
      const r = close?.getBoundingClientRect();
      const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && close.contains(hit);
    })()`, 15000, 'mosaic has two decoded videos and reachable foreground controls');
    await cdp.screenshot('11-mosaic-two-streams.png');
    await cdp.pressKey('Escape');
    await cdp.waitFor(`!document.querySelector('[data-desktop-mosaic-player]')`, 5000, 'mosaic player closed');
    await cdp.pressKey('Escape');
    await cdp.waitFor(`!document.querySelector('[role="dialog"]')`, 5000, 'mosaic picker closed');

    // Grille EPG complète : ouvrir Guide TV, vérifier les émissions XMLTV, poser un rappel synchronisé
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('[data-tv-live] button')).find(b => /Guide TV/i.test(b.textContent || ''));
      btn?.click();
    })()`);
    await cdp.waitFor(`(() => {
      const grid = document.querySelector('[data-guide-scroller]');
      const text = document.body.innerText;
      return !!grid && /Le Grand Direct Cinéma/.test(text) && /Soirée Documentaire/.test(text) && /Journal de la Nuit/.test(text);
    })()`, 15000, 'EPG grid displays XMLTV programs across channels');
    await cdp.evalJs(`(() => {
      const card = Array.from(document.querySelectorAll('[data-guide-scroller] [role="button"]')).find(el => /Soirée Documentaire/.test(el.getAttribute('aria-label') || ''));
      card?.click();
    })()`);
    await cdp.waitFor(`!!document.querySelector('[role="dialog"]') && /Soirée Documentaire/.test(document.querySelector('[role="dialog"]')?.textContent || '')`, 6000, 'EPG ProgramSheet open');
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => /Me le rappeler/i.test(b.textContent || ''));
      btn?.click();
    })()`);
    await cdp.waitFor(`!!document.querySelector('[role="dialog"]') && /Retirer le rappel/i.test(document.querySelector('[role="dialog"]')?.textContent || '')`, 8000, 'EPG reminder saved from ProgramSheet');
    const syncedReminders = await fetch(`${desktopUrl}/api/desktop/reminders`).then((r) => r.json());
    assert.ok(Array.isArray(syncedReminders.reminders) && syncedReminders.reminders.some((r) => /Soirée Documentaire/.test(r.title)), 'Rappel EPG synchronisé sur le serveur Desktop');
    await cdp.pressKey('Escape');
    await cdp.waitFor(`!document.querySelector('[role="dialog"]')`, 5000, 'ProgramSheet closed');
    await cdp.screenshot('13-epg-grid.png');
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /^Liste$/i.test((b.textContent || '').trim()));
      btn?.click();
    })()`);
    await cdp.waitFor(`!!document.querySelector('[data-tv-live]')`, 6000, 'returned from EPG grid to live list');
    console.log('[E2E] Grille EPG : chaînes, émissions XMLTV, fiche programme et rappel synchronisé vérifiés');

    // Onglet Films -> catalogue Xtream
    await cdp.clickSelector('[role="tab"][aria-label="Films"]');
    await cdp.waitFor(`!!document.querySelector('[data-tv-vod]') && /Odyssee/i.test(document.body.innerText)`, 12000, 'tv-vod films');
    await cdp.screenshot('05-vod-films.png');

    // Basculer sur USB / SD -> Bibliothèque locale -> lecture fichier MKV (AC3) via FFmpeg + sous-titre SRT
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /USB\\s*\\/\\s*SD/i.test(b.textContent || ''));
      btn?.click();
    })()`);
    await cdp.waitFor(`!!document.querySelector('input[placeholder*="Rechercher un fichier"]') && /Grand Film Desktop/i.test(document.body.innerText)`, 10000, 'local mkv listed');
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /Grand Film Desktop/i.test(b.textContent || ''));
      btn?.click();
    })()`);
    await cdp.waitFor(`(() => {
      const box = document.querySelector('[data-desktop-cinema-player="vod"]');
      const v = box?.querySelector('video');
      return !!v && v.readyState >= 2 && v.videoWidth > 0 && !/Ouverture du lecteur/i.test(box?.textContent || '');
    })()`, 15000, 'mkv ffmpeg transmux playing in VOD player');
    await cdp.waitFor(`document.querySelector('[data-desktop-cinema-player="vod"]')?.textContent.includes('Sous-titre CedPlay vérifié')`, 5000, 'subtitle cue actually displayed');
    await cdp.screenshot('07-vod-mkv-ffmpeg-subtitles.png');

    // Exercer le redémarrage FFmpeg et la sélection réelle de la seconde langue.
    await cdp.pressKey('ArrowRight');
    await cdp.waitFor(`(() => {
      const box = document.querySelector('[data-desktop-cinema-player="vod"]');
      const video = box?.querySelector('video');
      const position = box?.querySelector('input[aria-label="Position dans la vidéo"]');
      return video?.readyState >= 2 && video.videoWidth > 0 && Number(position?.value) >= 10;
    })()`, 15000, 'MKV seek keeps absolute timeline and decodes again');
    await cdp.waitFor(`document.querySelector('select[aria-label="Piste audio"]')?.options.length >= 2`, 15000, 'both source audio tracks exposed');
    await cdp.evalJs(`(() => {
      const select = document.querySelector('select[aria-label="Piste audio"]');
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await cdp.waitFor(`(() => {
      const box = document.querySelector('[data-desktop-cinema-player="vod"]');
      const video = box?.querySelector('video');
      const position = box?.querySelector('input[aria-label="Position dans la vidéo"]');
      return video?.src.includes('audioTrack=1') && video.readyState >= 2 && video.videoWidth > 0 && Number(position?.value) >= 10;
    })()`, 15000, 'second audio track streams without resetting playback position');
    await cdp.screenshot('09-mkv-seek-second-audio.png');
    console.log('[E2E] MKV : sous-titre affiché, recherche +10s et seconde piste audio décodée à la bonne position');
    await cdp.waitFor(`!!document.querySelector('select[aria-label="Piste de sous-titres"] option[value="0"]')`, 10000, 'embedded text subtitle offered');
    await cdp.evalJs(`(() => {
      const select = document.querySelector('select[aria-label="Piste de sous-titres"]');
      select.value = '0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await cdp.waitFor(`document.querySelector('[data-desktop-cinema-player="vod"]')?.textContent.includes('Sous-titre interne vérifié')`, 10000, 'embedded subtitle actually rendered at seek position');
    await cdp.screenshot('10-mkv-embedded-subtitle.png');

    await cdp.pressKey('Escape');
    await cdp.waitFor(`!document.querySelector('[data-desktop-cinema-player]')`, 5000, 'vod player closed');

    await cdp.clickSelector('[role="tab"][aria-label="Écouter"]');
    await cdp.waitFor(`!!document.querySelector('[data-podcasts-panel]')`, 10000, 'podcasts screen');
    await cdp.evalJs(`Array.from(document.querySelectorAll('[data-podcasts-panel] button')).find(b => /Coller un lien/.test(b.textContent || ''))?.click()`);
    await cdp.waitFor(`!!document.querySelector('input[aria-label="Lien ou adresse RSS du podcast"]')`, 5000, 'RSS input');
    await cdp.evalJs(`(() => {
      const input = document.querySelector('input[aria-label="Lien ou adresse RSS du podcast"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(fixtureUrl + '/podcast.xml')});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.clickSelector('button[aria-label="Ajouter depuis ce lien"]');
    await cdp.waitFor(`!!document.querySelector('button[aria-label="Écouter Épisode audio de contrôle"]')`, 12000, 'RSS episode imported');
    await cdp.clickSelector('button[aria-label="Écouter Épisode audio de contrôle"]');
    await cdp.waitFor(`!!document.querySelector('[data-mini-audio-player] button[aria-label="Pause audio"]') && Number(document.querySelector('[data-mini-audio-player] [role="progressbar"]')?.getAttribute('aria-valuenow')) > 0`, 10000, 'podcast decoded and playback time advances');
    await cdp.clickSelector('[data-mini-audio-player] button[aria-label="Pause audio"]');
    await cdp.waitFor(`!!document.querySelector('[data-mini-audio-player] button[aria-label="Reprendre audio"]')`, 5000, 'podcast paused');
    await cdp.clickSelector('[data-mini-audio-player] button[aria-label="Reprendre audio"]');
    await cdp.waitFor(`!!document.querySelector('[data-mini-audio-player] button[aria-label="Pause audio"]')`, 5000, 'podcast resumed');
    await cdp.screenshot('12-podcast-playing.png');
    await cdp.clickSelector('[data-mini-audio-player] button[aria-label="Fermer le lecteur audio"]');
    console.log('[E2E] Podcast : RSS importé, décodage MP3, progression réelle et pause/reprise validés');

    // Onglet Plus -> Enregistrements DVR par clic UI + Réglages en 1920x1080
    await cdp.clickSelector('[role="tab"][aria-label="Plus"]');
    await cdp.waitFor(`!!document.querySelector('[data-more-panel]')`, 10000, 'more panel');
    await cdp.screenshot('06-more-tools.png');

    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('[data-more-panel] button')).find(b => /Enregistrements/i.test(b.textContent || ''));
      btn?.click();
    })()`);
    await cdp.waitFor(`!!document.querySelector('select[aria-label="Chaîne à enregistrer"]')`, 10000, 'DVR recordings dialog');
    await cdp.evalJs(`(() => {
      const sel = document.querySelector('select[aria-label="Chaîne à enregistrer"]');
      const opt = Array.from(sel?.options || []).find(o => /France 3 HD/.test(o.textContent || ''));
      if (sel && opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => (b.textContent || '').trim() === 'Enregistrer');
      btn?.click();
    })()`);
    await cdp.waitFor(`/France 3 HD/.test(document.querySelector('[aria-label="Enregistrements en cours"]')?.textContent || '')`, 10000, 'DVR recording started via UI click');
    await new Promise((r) => setTimeout(r, 900));
    await cdp.screenshot('14-dvr-recordings.png');
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('[aria-label="Enregistrements en cours"] button')).find(b => /Arrêter/.test(b.textContent || ''));
      btn?.click();
    })()`);
    await cdp.waitFor(`!document.querySelector('[aria-label="Enregistrements en cours"]') && /France 3 HD/.test(document.querySelector('[role="dialog"]')?.textContent || '') && !/Aucun enregistrement pour l'instant/.test(document.querySelector('[role="dialog"]')?.textContent || '')`, 12000, 'DVR recording stopped and listed in UI');
    const dvrFiles = readdirSync(dvrDir).filter((name) => name.endsWith('.ts'));
    assert.ok(dvrFiles.length >= 1 && statSync(path.join(dvrDir, dvrFiles[0])).size > 1000, 'Fichier DVR .ts enregistré sur disque');
    const notifEntries = readFileSync(notifLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(notifEntries.some((e) => e.kind === 'recordingStarted' && /France 3 HD/.test(e.body)), 'Notification démarrage DVR émise');
    assert.ok(notifEntries.some((e) => e.kind === 'recordingStopped' && /France 3 HD/.test(e.body)), 'Notification fin DVR émise');
    console.log('[E2E] DVR UI : démarrage par clic, capture réelle .ts, arrêt UI, listing et notifications vérifiés');
    await cdp.pressKey('Escape');
    await cdp.waitFor(`!document.querySelector('[role="dialog"]')`, 5000, 'DVR dialog closed');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('[data-more-panel] button')).find(b => /Réglages/i.test(b.textContent || ''));
      btn?.click();
    })()`);
    await cdp.waitFor(`!!document.querySelector('[role="dialog"]') && /Réglages/i.test(document.querySelector('[role="dialog"]')?.textContent || '')`, 8000, 'settings dialog');
    await cdp.screenshot('08-settings-1920x1080.png');

    assert.equal(cdp.consoleErrors.length, 0, `Erreurs console inattendues: ${cdp.consoleErrors.join('; ')}`);
    assert.equal(cdp.pageErrors.length, 0, `Exceptions page inattendues: ${cdp.pageErrors.join('; ')}`);
    console.log('✅ E2E CedPlay Desktop Windows : Xtream, Découvrir, rail souris, Direct+Mosaïque, grille EPG + rappel, VOD/MKV FFmpeg (+10s, 2e audio, SRT + sous-titre embarqué), DVR par clic UI, Écouter/Podcast MP3, Plus & Réglages 1920x1080 vérifiés sur fixtures locales (0 erreur).');
  } catch (err) {
    if (cdp) {
      await cdp.screenshot('failure.png').catch(() => {});
      console.error('[E2E] UI failure:', await cdp.evalJs(`({ text: document.body.innerText.slice(-10000), dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(x => ({label:x.getAttribute('aria-label'),text:x.textContent?.slice(0,1500)})), errors: [] })`).catch(() => null));
    }
    throw err;
  } finally {
    try { await cdp?.send('Browser.close'); } catch { /* ignore */ }
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try {
      if (process.platform === 'win32' && edgeProc?.pid) {
        await new Promise((resolve) => execFile('taskkill', ['/PID', String(edgeProc.pid), '/T', '/F'], () => resolve()));
      } else {
        edgeProc.kill();
      }
    } catch { /* ignore */ }
    await desktop.stop();
    await new Promise((resolve) => fixtureServer.close(resolve));
    try { rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch { /* ignore locked profile */ }
  }
}

main().catch((err) => {
  console.error('❌ E2E CedPlay Desktop échec :', err);
  process.exit(1);
});
