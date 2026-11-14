import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDesktopServer } from './server.mjs';
import {
  externalHttpUrl, parsePort, runtimePaths, sameOrigin,
  startElectronRuntime, testServerUrl, windowOptions,
} from './electron-runtime.mjs';

test('production uses stable origin and refuses an ephemeral or invalid port', () => {
  assert.equal(parsePort(undefined), 4178);
  assert.equal(parsePort('0', { allowZero: true }), 0);
  for (const invalid of ['0', '-1', '65536', '4178junk', '1.5']) assert.throws(() => parsePort(invalid));
});

test('fixture server override is absent in production and strictly loopback in tests', () => {
  assert.equal(testServerUrl('https://evil.example', false), null);
  assert.equal(testServerUrl('http://127.0.0.1:4321', true), 'http://127.0.0.1:4321');
  for (const invalid of ['http://localhost:4321', 'https://127.0.0.1:4321', 'http://127.0.0.1:4321/path', 'http://evil.example:4321', 'http://u:p@127.0.0.1:4321']) {
    assert.throws(() => testServerUrl(invalid, true));
  }
});

test('navigation and external opening cannot grant a protocol handler or another origin', () => {
  assert.equal(sameOrigin('http://127.0.0.1:4178/player', 'http://127.0.0.1:4178'), true);
  for (const url of ['http://localhost:4178', 'http://127.0.0.1:4179', 'file:///C:/Windows', 'http://u:p@127.0.0.1:4178']) {
    assert.equal(sameOrigin(url, 'http://127.0.0.1:4178'), false);
  }
  assert.equal(externalHttpUrl('https://www.arte.tv/fr/'), 'https://www.arte.tv/fr/');
  for (const url of ['file:///C:/x', 'javascript:alert(1)', 'ms-settings:', 'https://user:pass@example.org']) assert.equal(externalHttpUrl(url), null);
});

test('renderer stays sandboxed without any preload or Node capability', () => {
  const options = windowOptions().webPreferences;
  assert.equal(options.sandbox, true);
  assert.equal(options.contextIsolation, true);
  assert.equal(options.webSecurity, true);
  for (const key of ['nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag', 'allowRunningInsecureContent']) assert.equal(options[key], false);
  assert.equal(options.preload, undefined);
});

function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cedplay-runtime-'));
  const windows = [];
  const app = new EventEmitter();
  Object.assign(app, {
    getPath: () => root, getAppPath: () => root,
    setPath: (key, value) => { app[key] = value; }, setAppUserModelId: () => {},
    requestSingleInstanceLock: () => true, whenReady: async () => {},
    quit: () => { app.quitCount += 1; }, quitCount: 0,
    commandLine: { appendSwitch: (...args) => app.switches.push(args) }, switches: [],
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.dead = false; this.fullscreen = false;
      const contents = new EventEmitter();
      contents.session = {
        setPermissionRequestHandler: (handler) => { contents.requestPermission = handler; },
        setPermissionCheckHandler: (handler) => { contents.checkPermission = handler; },
        setDevicePermissionHandler: (handler) => { contents.devicePermission = handler; },
      };
      Object.assign(contents, { getURL: () => this.url, getOSProcessId: () => 12345, setWindowOpenHandler: (handler) => { contents.open = handler; } });
      this.webContents = contents; windows.push(this);
    }
    async loadURL(url) { this.url = url; }
    isDestroyed() { return this.dead; }
    isMinimized() { return false; }
    restore() {} show() {} focus() {}
    isFullScreen() { return this.fullscreen; }
    setFullScreen(value) { this.fullscreen = value; }
    close() { this.dead = true; this.emit('closed'); }
  }
  let tray;
  class Tray extends EventEmitter {
    constructor() { super(); tray = this; }
    setToolTip() {} setContextMenu(menu) { this.menu = menu; } destroy() { this.destroyed = true; }
  }
  const dialog = { responses: [], errors: [], showErrorBox: (...args) => dialog.errors.push(args), showMessageBox: async () => ({ response: dialog.responses.shift() ?? 0 }) };
  const opened = [];
  const electron = { app, BrowserWindow, Tray, nativeImage: { createFromPath: () => ({}) }, dialog, shell: { openExternal: async (url) => opened.push(url) }, Menu: { setApplicationMenu: () => {}, buildFromTemplate: (items) => items } };
  return { root, electron, windows, app, dialog, opened, tray: () => tray, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('Electron profile is isolated from the old browser and overrides remain explicit', () => {
  const h = harness();
  try {
    const paths = runtimePaths(h.app, { LOCALAPPDATA: h.root }, h.root);
    assert.equal(paths.profileDir, path.join(h.root, 'CedPlay', 'windows', 'profile'));
    assert.equal(paths.dataDir, path.join(h.root, 'CedPlay', 'desktop'));
    assert.equal(paths.ffmpegPath, path.join(h.root, 'bin', 'ffmpeg.exe'));
  } finally { h.cleanup(); }
});

test('fixture runtime denies popups, capture, external redirects and exits without killing the fixture', async () => {
  const h = harness();
  try {
    const env = { CEDPLAY_TEST_MODE: '1', CEDPLAY_TEST_SERVER_URL: 'http://127.0.0.1:4321', CEDPLAY_CDP_PORT: '9223', CEDPLAY_PROFILE_DIR: path.join(h.root, 'isolated'), CEDPLAY_TEST_READY_FILE: path.join(h.root, 'ready.json') };
    const runtime = await startElectronRuntime(h.electron, { env, resourcesPath: h.root });
    const window = runtime.getWindow();
    const contents = window.webContents;
    assert.equal(runtime.getServer(), null);
    assert.equal(h.app.userData, env.CEDPLAY_PROFILE_DIR);
    let permitted;
    contents.requestPermission(contents, 'media', (value) => { permitted = value; });
    assert.equal(permitted, false);
    assert.equal(contents.devicePermission(), false);
    assert.equal(contents.checkPermission(contents, 'fullscreen', window.url), true);
    assert.equal(contents.checkPermission(contents, 'fullscreen', 'https://evil.example'), false);
    assert.deepEqual(contents.open({ url: 'file:///C:/Windows' }), { action: 'deny' });
    assert.equal(h.opened.length, 0);
    h.dialog.responses.push(1);
    contents.open({ url: 'https://www.arte.tv/fr/' });
    await new Promise(setImmediate);
    assert.deepEqual(h.opened, ['https://www.arte.tv/fr/']);
    let prevented = false;
    contents.emit('will-redirect', { preventDefault: () => { prevented = true; } }, 'https://evil.example');
    assert.equal(prevented, true);
    contents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F11' });
    assert.equal(window.isFullScreen(), true);
    contents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'Escape' });
    assert.equal(window.isFullScreen(), false);
    const ready = JSON.parse(readFileSync(env.CEDPLAY_TEST_READY_FILE));
    assert.equal(ready.url, env.CEDPLAY_TEST_SERVER_URL);
    assert.equal(ready.rendererPid, 12345);
    assert.equal(ready.browserWindowSecurity.nodeIntegration, false);
    window.close();
    assert.equal(h.app.quitCount, 1);
    assert.equal(h.tray().destroyed, true);
  } finally { h.cleanup(); }
});

test('owned backend retains on open, release preserves work, explicit quit confirms then waits for stop', async () => {
  const h = harness();
  let callbacks;
  let stops = 0;
  let busy = true;
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true }; };
  try {
    const runtime = await startElectronRuntime(h.electron, {
      env: { CEDPLAY_TEST_MODE: '1', CEDPLAY_DESKTOP_PORT: '0', CEDPLAY_PROFILE_DIR: path.join(h.root, 'profile') }, resourcesPath: h.root, requireBundledBinaries: false,
      createServer: (options) => {
        callbacks = options;
        return { start: async () => ({ url: 'http://127.0.0.1:4322' }), localAndDvr: { hasBackgroundWork: () => busy }, stop: async () => { stops += 1; callbacks.onStop(); } };
      },
    });
    assert.equal(callbacks.port, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /lifecycle\/retain$/);
    runtime.getWindow().close();
    await new Promise(setImmediate);
    assert.match(calls[1], /lifecycle\/release$/);
    assert.equal(h.app.quitCount, 0);
    await runtime.requestQuit();
    assert.equal(stops, 0);
    await runtime.createWindow();
    assert.equal(h.windows.length, 2);
    assert.match(calls[2], /lifecycle\/retain$/);
    h.dialog.responses.push(1);
    await runtime.requestQuit();
    assert.equal(stops, 1);
    assert.equal(h.app.quitCount, 1);
    assert.equal(h.tray().destroyed, true);
    busy = false;
  } finally { globalThis.fetch = oldFetch; h.cleanup(); }
});

test('a second instance exits before backend or renderer initialization', async () => {
  const h = harness();
  try {
    h.app.requestSingleInstanceLock = () => false;
    assert.deepEqual(await startElectronRuntime(h.electron, { env: { LOCALAPPDATA: h.root }, resourcesPath: h.root }), { secondary: true });
    assert.equal(h.app.quitCount, 1);
    assert.equal(h.windows.length, 0);
  } finally { h.cleanup(); }
});

test('real backend survives window close with a reminder, reopens, then automatically stops after release', async () => {
  const h = harness();
  let server;
  try {
    const runtime = await startElectronRuntime(h.electron, {
      env: { CEDPLAY_TEST_MODE: '1', CEDPLAY_DESKTOP_PORT: '0', CEDPLAY_PROFILE_DIR: path.join(h.root, 'profile'), CEDPLAY_DATA_DIR: path.join(h.root, 'data') },
      resourcesPath: h.root, requireBundledBinaries: false,
      createServer: (options) => { server = createDesktopServer(options); return server; },
    });
    server.stateStore.update((state) => ({ ...state, reminders: [{ id: 'retained-reminder', channelId: 'channel', programTitle: 'Programme futur', start: Date.now() + 600000 }] }));
    runtime.getWindow().close();
    await new Promise((resolve) => setTimeout(resolve, 320));
    assert.equal(h.app.quitCount, 0);
    assert.equal(server.server.listening, true);
    await runtime.createWindow();
    server.stateStore.update((state) => ({ ...state, reminders: [] }));
    await new Promise((resolve) => setTimeout(resolve, 320));
    assert.equal(h.app.quitCount, 0);
    assert.equal(server.server.listening, true);
    runtime.getWindow().close();
    const deadline = Date.now() + 2000;
    while (h.app.quitCount === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(h.app.quitCount, 1);
    assert.equal(server.server.listening, false);
  } finally { await server?.stop(); h.cleanup(); }
});
