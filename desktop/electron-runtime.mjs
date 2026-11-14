import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Doit rester identique à `appId` dans windows/electron-builder.cjs : l'installateur
// grave cet identifiant dans les raccourcis (épinglage, regroupement de la barre des tâches).
export const APP_USER_MODEL_ID = 'fr.cedplay.desktop';

export function parsePort(value, { allowZero = false, fallback = 4178 } = {}) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error('Port CedPlay invalide.');
  const port = Number(value);
  if (!Number.isInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) throw new Error('Port CedPlay invalide.');
  return port;
}

export function testServerUrl(value, testMode) {
  if (!testMode || !value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Le serveur de test doit être une origine HTTP locale 127.0.0.1.');
  }
  return url.origin;
}

export function sameOrigin(candidate, origin) {
  try {
    const parsed = new URL(candidate);
    return parsed.origin === origin && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function externalHttpUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch { return null; }
}

export function windowOptions() {
  return {
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'CedPlay', backgroundColor: '#101117', show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false,
    },
  };
}

// Electron's session directory is separate from the former Chrome app profile.
export function runtimePaths(app, env, resourcesPath) {
  const localRoot = env.LOCALAPPDATA || app.getPath('appData');
  return {
    profileDir: path.resolve(env.CEDPLAY_PROFILE_DIR || path.join(localRoot, 'CedPlay', 'windows', 'profile')),
    dataDir: path.resolve(env.CEDPLAY_DATA_DIR || path.join(localRoot, 'CedPlay', 'desktop')),
    distDir: path.join(app.getAppPath(), 'application', 'dist'),
    ffmpegPath: path.join(resourcesPath, 'bin', 'ffmpeg.exe'),
    ffprobePath: path.join(resourcesPath, 'bin', 'ffprobe.exe'),
  };
}

export async function startElectronRuntime(electron, {
  env = process.env, resourcesPath = process.resourcesPath,
  createServer = null, requireBundledBinaries = true,
} = {}) {
  const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell } = electron;
  const testMode = env.CEDPLAY_TEST_MODE === '1';
  const paths = runtimePaths(app, env, resourcesPath);
  mkdirSync(paths.profileDir, { recursive: true });
  app.setPath('userData', paths.profileDir);
  app.setAppUserModelId(APP_USER_MODEL_ID);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return { secondary: true };
  }
  const port = parsePort(env.CEDPLAY_DESKTOP_PORT, { allowZero: testMode });
  const externalServer = testServerUrl(env.CEDPLAY_TEST_SERVER_URL, testMode);
  if (testMode && env.CEDPLAY_CDP_PORT) {
    app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
    app.commandLine.appendSwitch('remote-debugging-port', String(parsePort(env.CEDPLAY_CDP_PORT)));
  }
  if (requireBundledBinaries && !externalServer) {
    for (const binary of [paths.ffmpegPath, paths.ffprobePath]) {
      if (!existsSync(binary)) throw new Error(`Composant Windows manquant : ${path.basename(binary)}. Réinstallez CedPlay.`);
    }
  }
  env.FFMPEG_PATH = paths.ffmpegPath;
  env.FFPROBE_PATH = paths.ffprobePath;
  env.CEDPLAY_DATA_DIR = paths.dataDir;
  let server = null;
  let origin = externalServer;
  let window = null;
  let tray = null;
  let quitAllowed = false;
  let quitPrompt = false;
  let opening = null;
  let externalPrompt = false;

  const finish = () => {
    quitAllowed = true;
    tray?.destroy();
    tray = null;
    app.quit();
  };
  const backgroundWork = () => Boolean(server?.localAndDvr.hasBackgroundWork());
  const lifecycle = async (action) => {
    if (!server || quitAllowed) return;
    const response = await fetch(`${origin}/api/desktop/lifecycle/${action}`, {
      method: 'POST', headers: { Origin: origin }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Impossible de mettre à jour le travail en arrière-plan.');
  };
  const showRuntimeError = (error) => {
    dialog.showErrorBox('CedPlay', error?.message || String(error));
  };
  const requestQuit = async () => {
    if (quitAllowed || quitPrompt) return;
    quitPrompt = true;
    try {
      if (backgroundWork()) {
        const options = {
          type: 'question', title: 'Quitter CedPlay ?',
          message: 'Des enregistrements ou rappels sont encore en cours ou programmés.',
          detail: 'Quitter interrompt les tâches en cours. Les programmations conservées reprendront au prochain lancement.',
          buttons: ['Continuer en arrière-plan', 'Quitter CedPlay'], defaultId: 0, cancelId: 0,
        };
        const result = window && !window.isDestroyed()
          ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
        if (result.response !== 1) return;
      }
      if (server) await server.stop();
      else finish();
    } catch (error) { showRuntimeError(error); }
    finally { quitPrompt = false; }
  };
  const offerExternal = async (candidate) => {
    const target = externalHttpUrl(candidate);
    if (!target || externalPrompt) return;
    externalPrompt = true;
    try {
      const options = {
        type: 'question', title: 'Ouvrir un site externe ?',
        message: 'Ouvrir ce lien dans votre navigateur ?', detail: target,
        buttons: ['Annuler', 'Ouvrir'], defaultId: 0, cancelId: 0,
      };
      const result = window && !window.isDestroyed()
        ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      if (result.response === 1) await shell.openExternal(target);
    } catch (error) { showRuntimeError(error); }
    finally { externalPrompt = false; }
  };

  const writeReady = () => {
    if (!testMode || !env.CEDPLAY_TEST_READY_FILE) return;
    const destination = path.resolve(env.CEDPLAY_TEST_READY_FILE);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify({
      url: origin, pid: process.pid, processPid: process.pid, execPath: process.execPath,
      rendererPid: window?.webContents.getOSProcessId(),
      profileDir: paths.profileDir, dataDir: paths.dataDir, appPath: app.getAppPath(),
      resourcesPath, appRoot: app.getAppPath(), ffmpegPath: paths.ffmpegPath, ffprobePath: paths.ffprobePath,
      versions: process.versions, sandbox: true, contextIsolation: true, nodeIntegration: false,
      externalTestServer: Boolean(externalServer), browserWindowSecurity: windowOptions().webPreferences,
    }, null, 2));
  };
  const createWindow = async () => {
    if (quitAllowed) return null;
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
      return window;
    }
    if (opening) return opening;
    opening = (async () => {
      await lifecycle('retain');
      const created = new BrowserWindow({ ...windowOptions(), icon: path.join(app.getAppPath(), 'desktop', 'cedplay.ico') });
      window = created;
      const session = created.webContents.session;
      session.setPermissionRequestHandler((contents, permission, callback) => {
        callback(contents === created.webContents && permission === 'fullscreen' && sameOrigin(contents.getURL(), origin));
      });
      session.setPermissionCheckHandler((contents, permission, requestingOrigin) => (
        contents === created.webContents && permission === 'fullscreen' && sameOrigin(requestingOrigin, origin)
      ));
      session.setDevicePermissionHandler(() => false);
      created.webContents.setWindowOpenHandler(({ url }) => {
        void offerExternal(url);
        return { action: 'deny' };
      });
      created.webContents.on('will-navigate', (event, url) => {
        if (!sameOrigin(url, origin)) { event.preventDefault(); void offerExternal(url); }
      });
      created.webContents.on('will-redirect', (event, url) => {
        if (!sameOrigin(url, origin)) event.preventDefault();
      });
      created.webContents.on('will-frame-navigate', (event) => {
        if (!sameOrigin(event.url, origin)) event.preventDefault();
      });
      created.webContents.on('will-attach-webview', (event) => event.preventDefault());
      created.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        if (input.key === 'F11') {
          event.preventDefault(); created.setFullScreen(!created.isFullScreen());
        } else if (input.key === 'Escape' && created.isFullScreen()) {
          event.preventDefault(); created.setFullScreen(false);
        }
      });
      created.on('closed', () => {
        if (window === created) window = null;
        if (quitAllowed) return;
        if (!server) finish();
        else void lifecycle('release').catch((error) => {
          showRuntimeError(error);
          void createWindow().catch(showRuntimeError);
        });
      });
      await created.loadURL(origin);
      if (!created.isDestroyed()) { created.show(); created.focus(); writeReady(); }
      return created;
    })().finally(() => { opening = null; });
    return opening;
  };

  app.on('second-instance', () => { void app.whenReady().then(createWindow).catch(showRuntimeError); });
  app.on('activate', () => { void createWindow().catch(showRuntimeError); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', (event) => {
    if (!quitAllowed) { event.preventDefault(); void requestQuit(); }
  });
  await app.whenReady();
  if (!externalServer) {
    const factory = createServer || (await import('./server.mjs')).createDesktopServer;
    server = factory({ port, distDir: paths.distDir, dataDir: paths.dataDir, onStop: finish });
    const started = await server.start();
    origin = started.url;
  }
  Menu.setApplicationMenu(null);
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'desktop', 'cedplay.ico'));
  tray = new Tray(icon);
  tray.setToolTip('CedPlay — rappels et enregistrements');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir CedPlay', click: () => { void createWindow().catch(showRuntimeError); } },
    { type: 'separator' },
    { label: 'Quitter CedPlay', click: () => { void requestQuit(); } },
  ]));
  tray.on('double-click', () => { void createWindow().catch(showRuntimeError); });
  await createWindow();
  return { secondary: false, paths, url: origin, createWindow, requestQuit, getWindow: () => window, getServer: () => server };
}
