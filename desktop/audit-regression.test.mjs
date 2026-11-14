import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { getFfmpegPath, getFfprobePath, hasBinary, REPO_ROOT } from './config.mjs';
import { pathToLocalUri } from './localAndDvr.mjs';
import { sendDesktopNotification } from './notifications.mjs';
import { createDesktopServer } from './server.mjs';

const exec = promisify(execFile);
const proofRoot = path.resolve('preuves/desktop-audit-backend');
mkdirSync(proofRoot, { recursive: true });
const fixture = mkdtempSync(path.join(proofRoot, 'regression-'));
const bytes = '0123456789abcdefghijklmnopqrstuvwxyz';
let desktop;
let base;
let fileUrl;

before(async () => {
  writeFileSync(path.join(fixture, 'movie.mp4'), bytes);
  writeFileSync(path.join(fixture, 'movie.ass'), '[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.25,Default,,0,0,0,,{\\i1}Bonjour, CedPlay\\Nseconde ligne\n');
  writeFileSync(path.join(fixture, 'movie.ssa'), '[Script Info]\nScriptType: v4.00\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Texte SSA\n');
  desktop = createDesktopServer({ port: 0, dataDir: path.join(fixture, 'data') });
  desktop.stateStore.update((s) => ({ ...s, localFolders: [{ uri: pathToLocalUri(fixture), name: 'fixture' }], recordingsFolder: {uri:pathToLocalUri(fixture),name:'fixture'} }));
  base = (await desktop.start()).url;
  fileUrl = `${base}/api/desktop/local/file?uri=${encodeURIComponent(pathToLocalUri(path.join(fixture, 'movie.mp4')))}`;
});

after(async () => {
  await desktop?.stop();
  assert.ok(path.resolve(fixture).startsWith(proofRoot + path.sep));
  rmSync(fixture, { recursive: true, force: true });
});

test('rejects foreign Host and cross-port/scheme Origin without blocking same-origin requests', async () => {
  for (const target of [fileUrl, `${base}/`]) {
    const response = await new Promise((resolve, reject) => {
      http.get(target, { headers: { Host: 'rebind.example:4178' } }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      }).on('error', reject);
    });
    assert.equal(response, 403);
  }
  for (const origin of ['http://127.0.0.1:1', base.replace('http:', 'https:'), 'https://evil.example']) {
    const response = await fetch(`${base}/api/desktop/health`, { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    await response.arrayBuffer();
  }
  const accepted = await fetch(`${base}/api/desktop/health`, { headers: { Origin: base } });
  assert.equal(accepted.status, 200);
  await accepted.arrayBuffer();
});

test('malformed JSON and wrong body types return 400 while the server remains available', async () => {
  for (const body of ['{', 'null', '[]', '"string"']) {
    const rejected = await fetch(`${base}/api/desktop/player-options`, { method: 'POST', body });
    assert.equal(rejected.status, 400);
    await rejected.arrayBuffer();
  }
  const healthy = await fetch(`${base}/api/desktop/health`);
  assert.equal(healthy.status, 200);
  await healthy.arrayBuffer();
});

test('local file ranges include suffix, open-ended, HEAD, and unsatisfiable cases', async () => {
  for (const [range, expected, contentRange] of [
    ['bytes=-10', bytes.slice(-10), 'bytes 26-35/36'],
    ['bytes=-100', bytes, 'bytes 0-35/36'],
    ['bytes=30-', bytes.slice(30), 'bytes 30-35/36'],
    ['bytes=0-15', bytes.slice(0, 16), 'bytes 0-15/36'],
  ]) {
    const response = await fetch(fileUrl, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), contentRange);
    assert.equal(await response.text(), expected);
  }
  for (const range of ['bytes=-0', 'bytes=-', 'bytes=36-', 'bytes=20-10']) {
    const response = await fetch(fileUrl, { headers: { Range: range } });
    assert.equal(response.status, 416);
    await response.arrayBuffer();
  }
  const head = await fetch(fileUrl, { method: 'HEAD', headers: { Range: 'bytes=-10' } });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
});

test('ASS and SSA sidecars produce actual WebVTT cues', async () => {
  for (const [name, expected] of [
    ['movie.ass', '00:00:01.500 --> 00:00:03.250\nBonjour, CedPlay\nseconde ligne'],
    ['movie.ssa', '00:00:01.000 --> 00:00:02.000\nTexte SSA'],
  ]) {
    const response = await fetch(`${base}/api/desktop/subtitle?uri=${encodeURIComponent(pathToLocalUri(path.join(fixture, name)))}`);
    assert.equal(response.status, 200);
    const vtt = await response.text();
    assert.ok(vtt.startsWith('WEBVTT\n'));
    assert.ok(vtt.includes(expected), vtt);
    assert.ok(!vtt.includes('Dialogue:'));
  }
});

test('probe exposes both audio languages and transmux selects the requested language', async () => {
  const source = path.join(fixture, 'bilingual.mkv');
  await exec(getFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=duration=1:size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'ac3',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=fra', source], { windowsHide: true });
  const uri = pathToLocalUri(source);
  const probe = await fetch(`${base}/api/desktop/probe-media?url=${encodeURIComponent(uri)}`).then((r) => r.json());
  assert.deepEqual(probe.audioTracks, [{ id: 0, label: 'eng' }, { id: 1, label: 'fra' }]);
  const response = await fetch(`${base}/api/desktop/transmux?url=${encodeURIComponent(uri)}&audioTrack=1`);
  assert.equal(response.status, 200);
  const output = path.join(fixture, 'french.mp4');
  writeFileSync(output, Buffer.from(await response.arrayBuffer()));
  const { stdout } = await exec(getFfprobePath(), ['-v', 'quiet', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'json', output], { windowsHide: true });
  assert.equal(JSON.parse(stdout).streams[0].tags.language, 'fra');
  for (const audioTrack of ['-1', '0.5', 'NaN']) {
    const invalid = await fetch(`${base}/api/desktop/transmux?url=${encodeURIComponent(uri)}&audioTrack=${audioTrack}`);
    assert.equal(invalid.status, 400);
    await invalid.arrayBuffer();
  }
});

test('embedded text subtitles are listed and extracted as WebVTT instead of reading the container as text', async () => {
  const subtitles = path.join(fixture, 'embedded.fr.srt');
  const source = path.join(fixture, 'embedded.mkv');
  writeFileSync(subtitles, '1\n00:00:00,100 --> 00:00:00,800\nBonjour embarque\n');
  await exec(getFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=duration=1:size=160x90:rate=10', '-i', subtitles,
    '-map', '0:v', '-map', '1:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:s', 'srt', '-metadata:s:s:0', 'language=fra', source], { windowsHide: true });
  const uri = encodeURIComponent(pathToLocalUri(source));
  const probe = await fetch(`${base}/api/desktop/probe-media?url=${uri}`).then((r) => r.json());
  assert.deepEqual(probe.subtitleTracks, [{ id: 0, label: 'fra' }]);
  const vtt = await fetch(`${base}/api/desktop/subtitle?uri=${uri}&track=0`).then((r) => r.text());
  assert.ok(vtt.startsWith('WEBVTT\n'));
  assert.match(vtt, /00:00[.]100 --> 00:00[.]800\nBonjour embarque/);
  for (const track of ['-1', '0.5', 'NaN']) {
    const invalid = await fetch(`${base}/api/desktop/subtitle?uri=${uri}&track=${track}`);
    assert.equal(invalid.status, 400);
    await invalid.arrayBuffer();
  }
});

test('binary health does not report missing PATH commands as available', () => {
  assert.equal(hasBinary('cedplay-nonexistent-binary-7ac384'), false);
  assert.equal(hasBinary(getFfmpegPath()), true);
});

test('DVR subprocess startup errors leave the server running and clear the active recording', async () => {
  const previous = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = fixture;
  try {
    const started = await fetch(`${base}/api/desktop/recordings/start`, { method: 'POST', body: JSON.stringify({url:'http://127.0.0.1:1/synthetic.ts',title:'Invalid binary fixture'}) });
    await started.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const active = await fetch(`${base}/api/desktop/recordings/active`).then((r) => r.json());
    assert.equal(active.recordings.length, 0);
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
  }
});

test('retaining the application cancels a pending idle shutdown', async () => {
  const service = createDesktopServer({ port: 0, dataDir: path.join(fixture, 'retain-data') });
  const { url } = await service.start();
  try {
    const release = await fetch(`${url}/api/desktop/lifecycle/release`, { method: 'POST' });
    assert.equal(release.status, 200);
    await release.arrayBuffer();
    const retain = await fetch(`${url}/api/desktop/lifecycle/retain`, { method: 'POST' });
    assert.equal(retain.status, 200);
    await retain.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(service.server.listening, true);
  } finally {
    await service.stop();
  }
});

test('releasing the application preserves a scheduled real DVR capture and shuts down after completion', async () => {
  const source = path.join(fixture, 'dvr-source.ts');
  await exec(getFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=duration=2:size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mpegts', source], { windowsHide: true });
  const media = readFileSync(source);
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': media.length });
    res.end(media);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const dvrDir = path.join(fixture, 'background-recordings');
  mkdirSync(dvrDir);
  const service = createDesktopServer({ port: 0, dataDir: path.join(fixture, 'release-data') });
  service.stateStore.update((s) => ({ ...s, recordingsFolder: { uri: pathToLocalUri(dvrDir), name: 'fixture' } }));
  const { url } = await service.start();
  try {
    const schedule = await fetch(`${url}/api/desktop/recordings/schedule`, {
      method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${upstream.address().port}/source.ts`, title: 'Background DVR', startTimeMs: Date.now() + 1000, durationMs: 6000 }),
    });
    assert.equal(schedule.status, 200);
    await schedule.arrayBuffer();
    const release = await fetch(`${url}/api/desktop/lifecycle/release`, { method: 'POST' }).then((r) => r.json());
    assert.equal(release.backgroundWork, true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(service.server.listening, true);
    const deadline = Date.now() + 6000;
    while (service.server.listening && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(service.server.listening, false);
    assert.equal(service.stateStore.get().schedules.length, 0);
    const files = readdirSync(dvrDir).filter((name) => name.endsWith('.ts'));
    assert.equal(files.length, 1);
    assert.ok(statSync(path.join(dvrDir, files[0])).size > 1000);
  } finally {
    await service.stop();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('scheduled DVR and EPG reminders survive full server restart and trigger Windows notification hooks', async () => {
  const source = path.join(fixture, 'restart-source.ts');
  await exec(getFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=duration=2:size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mpegts', source], { windowsHide: true });
  const media = readFileSync(source);
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': media.length });
    res.end(media);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  const restartData = path.join(fixture, 'restart-data');
  const dvrDir = path.join(fixture, 'restart-recordings');
  const notifLog = path.join(fixture, 'notifications.jsonl');
  mkdirSync(restartData);
  mkdirSync(dvrDir);

  const prevLog = process.env.CEDPLAY_NOTIFICATION_LOG;
  const prevDisable = process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS;
  process.env.CEDPLAY_NOTIFICATION_LOG = notifLog;
  process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS = '1';

  const service1 = createDesktopServer({ port: 0, dataDir: restartData });
  service1.stateStore.update((s) => ({ ...s, recordingsFolder: { uri: pathToLocalUri(dvrDir), name: 'restart-dvr' } }));
  const { url: url1 } = await service1.start();
  const startAt = Date.now() + 900;
  let service2;
  try {
    const schedRes = await fetch(`${url1}/api/desktop/recordings/schedule`, {
      method: 'POST',
      body: JSON.stringify({ url: `http://127.0.0.1:${upstream.address().port}/live.ts`, title: 'Reprise Apres Redemarrage', startTimeMs: startAt, durationMs: 3500 }),
    });
    assert.equal(schedRes.status, 200);
    await schedRes.arrayBuffer();

    const remRes = await fetch(`${url1}/api/desktop/reminders/sync`, {
      method: 'POST',
      body: JSON.stringify({ reminders: [{ id: `101:${startAt}`, channelId: '101', channelName: 'TF1 HD', title: 'Emission Persistante', startTime: startAt }] }),
    });
    assert.equal(remRes.status, 200);
    await remRes.arrayBuffer();
  } finally {
    await service1.stop();
  }

  const persisted = JSON.parse(readFileSync(path.join(restartData, 'desktop-state.json'), 'utf8'));
  assert.equal(persisted.schedules.length, 1);
  assert.equal(persisted.reminders.length, 1);

  try {
    service2 = createDesktopServer({ port: 0, dataDir: restartData });
    await service2.start();
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const files = readdirSync(dvrDir).filter((name) => name.endsWith('.ts'));
      const active = service2.localAndDvr.listActive();
      const logReady = existsSync(notifLog) ? readFileSync(notifLog, 'utf8') : '';
      if (files.length >= 1 && active.length === 0 && service2.stateStore.get().schedules.length === 0
        && logReady.includes('"kind":"reminder"') && logReady.includes('"kind":"recordingStopped"')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const files = readdirSync(dvrDir).filter((name) => name.endsWith('.ts'));
    assert.equal(files.length, 1);
    assert.ok(statSync(path.join(dvrDir, files[0])).size > 1000);
    const entries = readFileSync(notifLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(entries.some((e) => e.kind === 'reminder' && e.title === 'TF1 HD' && e.body.includes('Emission Persistante')));
    assert.ok(entries.some((e) => e.kind === 'recordingStarted' && e.body === 'Reprise Apres Redemarrage'));
    assert.ok(entries.some((e) => e.kind === 'recordingStopped' && e.body === 'Reprise Apres Redemarrage'));
  } finally {
    if (prevLog === undefined) delete process.env.CEDPLAY_NOTIFICATION_LOG;
    else process.env.CEDPLAY_NOTIFICATION_LOG = prevLog;
    if (prevDisable === undefined) delete process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS;
    else process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS = prevDisable;
    await service2?.stop();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('a pending EPG reminder keeps the released application alive until delivery', async () => {
  const notifLog = path.join(fixture, 'reminder-only.jsonl');
  const prevLog = process.env.CEDPLAY_NOTIFICATION_LOG;
  const prevDisable = process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS;
  process.env.CEDPLAY_NOTIFICATION_LOG = notifLog;
  process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS = '1';
  const service = createDesktopServer({ port: 0, dataDir: path.join(fixture, 'reminder-only-data') });
  try {
    const { url } = await service.start();
    const startTime = Date.now() + 1200;
    await fetch(`${url}/api/desktop/reminders/sync`, {
      method: 'POST', body: JSON.stringify({ reminders: [{ id: 'reminder-only', channelId: '101', channelName: 'Fixture', title: 'Rappel seul', startTime }] }),
    }).then((r) => r.arrayBuffer());
    const release = await fetch(`${url}/api/desktop/lifecycle/release`, { method: 'POST' }).then((r) => r.json());
    assert.equal(release.backgroundWork, true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(service.server.listening, true);
    const deadline = Date.now() + 5000;
    while (service.server.listening && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(service.server.listening, false);
    const entries = readFileSync(notifLog, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(entries.filter((e) => e.kind === 'reminder').length, 1);
  } finally {
    await service.stop();
    if (prevLog === undefined) delete process.env.CEDPLAY_NOTIFICATION_LOG;
    else process.env.CEDPLAY_NOTIFICATION_LOG = prevLog;
    if (prevDisable === undefined) delete process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS;
    else process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS = prevDisable;
  }
});

test('an overdue reminder is delivered once across resync and a new server process', async () => {
  const dataDir = path.join(fixture, 'idempotent-reminders');
  const notifLog = path.join(fixture, 'idempotent-reminders.jsonl');
  const prevLog = process.env.CEDPLAY_NOTIFICATION_LOG;
  const prevDisable = process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS;
  process.env.CEDPLAY_NOTIFICATION_LOG = notifLog;
  process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS = '1';
  const reminders = [{ id: 'overdue-once', channelId: '101', channelName: 'Fixture', title: 'Une seule notification', startTime: Date.now() - 1000 }];
  const service = createDesktopServer({ port: 0, dataDir });
  let child;
  const sync = async (url) => {
    const response = await fetch(`${url}/api/desktop/reminders/sync`, { method: 'POST', body: JSON.stringify({ reminders }) });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  };
  const deliveredCount = () => readFileSync(notifLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter((e) => e.kind === 'reminder').length;
  try {
    const { url } = await service.start();
    await sync(url);
    await sync(url);
    assert.equal(deliveredCount(), 1, 'resync must not replay the same overdue reminder');
    await service.stop();

    child = spawn(process.execPath, [path.join(REPO_ROOT, 'desktop', 'server.mjs')], {
      env: { ...process.env, CEDPLAY_DESKTOP_PORT: '0', CEDPLAY_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const restartedUrl = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`server restart timeout: ${output}`)), 5000);
      child.once('error', (err) => { clearTimeout(timer); reject(err); });
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        const match = output.match(/Serveur actif sur (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    await sync(restartedUrl);
    assert.equal(deliveredCount(), 1, 'a fresh process must remember delivery');
    const exit = new Promise((resolve) => child.once('exit', resolve));
    await fetch(`${restartedUrl}/api/desktop/lifecycle/release`, { method: 'POST' }).then((r) => r.arrayBuffer());
    await exit;
  } finally {
    child?.kill();
    await service.stop();
    if (prevLog === undefined) delete process.env.CEDPLAY_NOTIFICATION_LOG;
    else process.env.CEDPLAY_NOTIFICATION_LOG = prevLog;
    if (prevDisable === undefined) delete process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS;
    else process.env.CEDPLAY_DISABLE_OS_NOTIFICATIONS = prevDisable;
  }
});

test('Windows native WinRT toast notification API delivers without error', { skip: process.platform !== 'win32' }, async () => {
  const result = await sendDesktopNotification({
    kind: 'test',
    title: 'CedPlay Desktop Audit',
    body: 'Notification système Windows vérifiée',
  });
  assert.equal(result.ok, true);
  assert.equal(result.osToastSent, true);
});

test('CedPlay.exe exits cleanly when closing loaded GUI window without active DVR and shuts down server', { skip: process.platform !== 'win32' || !existsSync(path.join(REPO_ROOT, 'CedPlay.exe')) }, async () => {
  const port = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
    });
    srv.on('error', reject);
  });
  const profileDir = path.join(fixture, 'gui-profile');
  const dataDir = path.join(fixture, 'gui-data');
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const launcher = spawn(path.join(REPO_ROOT, 'CedPlay.exe'), [], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CEDPLAY_DESKTOP_PORT: String(port),
      CEDPLAY_PROFILE_DIR: profileDir,
      CEDPLAY_DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  });

  try {
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/desktop/health`);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* waiting */
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(healthy, true, 'CedPlay.exe doit démarrer un serveur Desktop sain');

    const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CedPlayGuiTestHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    public const uint WM_CLOSE = 0x0010;
}
'@
$targetProfile = $env:CEDPLAY_TEST_PROFILE
$targetPort = $env:CEDPLAY_TEST_PORT
$closedTitle = $null
for ($try = 0; $try -lt 40; $try++) {
    $pids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe' OR Name='brave.exe'" |
        Where-Object { $_.CommandLine -like "*$targetPort*" -or $_.CommandLine -like "*$targetProfile*" } |
        Select-Object -ExpandProperty ProcessId)
    [CedPlayGuiTestHelper]::EnumWindows({
        param($hWnd, $lParam)
        if (-not [CedPlayGuiTestHelper]::IsWindowVisible($hWnd)) { return $true }
        $pidOut = [uint32]0
        [CedPlayGuiTestHelper]::GetWindowThreadProcessId($hWnd, [ref]$pidOut) | Out-Null
        if ($pids -contains [int]$pidOut) {
            $sb = [System.Text.StringBuilder]::new(256)
            [CedPlayGuiTestHelper]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            if ($sb.ToString() -like "*CedPlay*") {
                $script:closedTitle = $sb.ToString()
                [CedPlayGuiTestHelper]::PostMessage($hWnd, [CedPlayGuiTestHelper]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                return $false
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
    if ($closedTitle) { break }
    Start-Sleep -Milliseconds 200
}
if (-not $closedTitle) { throw "Fenetre CedPlay introuvable" }
Write-Output $closedTitle
`;
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-EncodedCommand', b64], {
      env: { ...process.env, CEDPLAY_TEST_PROFILE: profileDir, CEDPLAY_TEST_PORT: String(port) },
      timeout: 15000,
    });
    assert.match(stdout.trim(), /CedPlay/);

    const exitResult = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ exited: false, code: null }), 8000);
      launcher.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ exited: true, code });
      });
    });
    assert.equal(exitResult.exited, true, 'CedPlay.exe doit quitter après WM_CLOSE GUI');
    assert.equal(exitResult.code, 0);

    let alive = false;
    try {
      alive = (await fetch(`http://127.0.0.1:${port}/api/desktop/health`)).ok;
    } catch {
      alive = false;
    }
    assert.equal(alive, false, 'Le serveur Desktop doit s’arrêter après fermeture GUI sans DVR actif');
  } finally {
    try { launcher.kill(); } catch { /* ignore */ }
  }
});

for (const inputPath of ['/live/103.m3u8', '/live/103']) {
test(`DVR captures live HLS ${inputPath} without HTTP reconnect stall`, async () => {
  const recDir = mkdtempSync(path.join(proofRoot, 'hls-rec-'));
  const tsSegment = path.join(recDir, 'seg.ts');
  await exec(getFfmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=520:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-f', 'mpegts', tsSegment,
  ], { windowsHide: true });
  const segBytes = readFileSync(tsSegment);

  let hlsBase = '';
  let seq = 1;
  const hlsServer = http.createServer((req, res) => {
    if (req.url !== '/seg.ts') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
      res.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${seq++}\n#EXTINF:1.0,\n${hlsBase}/seg.ts\n`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': segBytes.length });
    res.end(segBytes);
  });
  await new Promise((resolve) => hlsServer.listen(0, '127.0.0.1', resolve));
  hlsBase = `http://127.0.0.1:${hlsServer.address().port}`;

  const dvrSubDir = path.join(recDir, 'captures');
  mkdirSync(dvrSubDir, { recursive: true });
  const srv = createDesktopServer({ port: 0, dataDir: path.join(recDir, 'data') });
  try {
    const { url } = await srv.start();
    await fetch(`${url}/api/desktop/recordings/pick-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dvrSubDir }),
    });
    const started = await fetch(`${url}/api/desktop/recordings/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${hlsBase}${inputPath}`, title: 'Direct HLS Test' }),
    }).then((r) => r.json());
    assert.ok(started.recording?.id);

    await new Promise((r) => setTimeout(r, 900));
    const stopRes = await fetch(`${url}/api/desktop/recordings/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: started.recording.id }),
    }).then((r) => r.json());
    assert.equal(stopRes.ok, true);

    const listed = await fetch(`${url}/api/desktop/recordings/list`).then((r) => r.json());
    assert.equal(listed.files.length, 1);
    assert.ok(listed.files[0].size > 1000);
  } finally {
    await srv.stop();
    await new Promise((resolve) => hlsServer.close(resolve));
    rmSync(recDir, { recursive: true, force: true });
  }
});
}
