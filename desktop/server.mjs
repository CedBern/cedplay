import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_DESKTOP_PORT,
  DIST_DIR,
  createStateStore,
  getDataDir,
  getFfmpegPath,
  getFfprobePath,
  hasBinary,
  readJsonBody,
  sendJson,
} from './config.mjs';
import { handleFfmpegRoutes, killAllFfmpegChildren } from './ffmpeg.mjs';
import { handleHttpRoutes } from './httpBridge.mjs';
import { createLanServices } from './lanServers.mjs';
import { createLocalAndDvrService } from './localAndDvr.mjs';

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function isAllowedHost(hostHeader, port) {
  try {
    const parsed = new URL(`http://${hostHeader}`);
    return !parsed.username && !parsed.password && parsed.pathname === '/'
      && ['127.0.0.1', 'localhost'].includes(parsed.hostname.toLowerCase())
      && Number(parsed.port || 80) === port;
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin, hostHeader) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.origin === new URL(`http://${hostHeader}`).origin;
  } catch {
    return false;
  }
}

export function createDesktopServer({
  port = DEFAULT_DESKTOP_PORT,
  distDir = DIST_DIR,
  dataDir = getDataDir(),
  onStop = null,
} = {}) {
  const stateStore = createStateStore(dataDir);
  const sseClients = new Set();
  let lifecycleTimer = null;
  let stopped = false;

  const emitEvent = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      if (!client.writableEnded) {
        try {
          client.write(payload);
        } catch {
          sseClients.delete(client);
        }
      }
    }
  };

  const localAndDvr = createLocalAndDvrService(stateStore, emitEvent);
  const lanServices = createLanServices(emitEvent);
  let activePort = port;

  const serveStatic = (req, res, pathname) => {
    const cleanPath = decodeURIComponent(pathname.split('?')[0]);
    const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
    const candidate = path.resolve(distDir, rel);
    const rootResolved = path.resolve(distDir);
    const insideDist = candidate === rootResolved || candidate.startsWith(rootResolved + path.sep);

    let fileToServe = null;
    if (insideDist && existsSync(candidate) && statSync(candidate).isFile()) {
      fileToServe = candidate;
    } else if (!path.extname(rel)) {
      const indexFile = path.join(rootResolved, 'index.html');
      if (existsSync(indexFile)) fileToServe = indexFile;
    }

    if (!fileToServe) {
      sendJson(res, 404, { error: 'Ressource introuvable.' });
      return;
    }

    const ext = path.extname(fileToServe).toLowerCase();
    if (ext === '.html') {
      let html = readFileSync(fileToServe, 'utf8');
      const flagScript = '<script>window.__CEDPLAY_DESKTOP__=true;</script>';
      html = html.includes('</head>') ? html.replace('</head>', `${flagScript}</head>`) : flagScript + html;
      res.writeHead(200, {
        'Content-Type': STATIC_MIME['.html'],
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    const stat = statSync(fileToServe);
    res.writeHead(200, {
      'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': fileToServe.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(fileToServe).pipe(res);
  };

  const handleRequest = async (req, res) => {
    const hostHeader = req.headers.host;
    if (!hostHeader || !isAllowedHost(hostHeader, activePort)) {
      sendJson(res, 403, { error: 'Hôte refusé.' });
      return;
    }
    const urlObj = new URL(req.url || '/', `http://${hostHeader}`);

    if (urlObj.pathname.startsWith('/api/desktop')) {
      if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
        sendJson(res, 403, { error: 'Origine refusée.' });
        return;
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (urlObj.pathname === '/api/desktop/health' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          desktop: true,
          platform: process.platform,
          arch: process.arch,
          ffmpeg: hasBinary(getFfmpegPath()),
          ffprobe: hasBinary(getFfprobePath()),
          port: activePort,
        });
        return;
      }

      if (urlObj.pathname === '/api/desktop/lifecycle/retain' && req.method === 'POST') {
        if (lifecycleTimer) clearInterval(lifecycleTimer);
        lifecycleTimer = null;
        sendJson(res, 200, { ok: true });
        return;
      }

      if (urlObj.pathname === '/api/desktop/lifecycle/release' && req.method === 'POST') {
        const hasBackgroundWork = () => localAndDvr.hasBackgroundWork();
        sendJson(res, 200, {
          ok: true,
          backgroundWork: hasBackgroundWork(),
          activeCount: localAndDvr.listActive().length,
          scheduledCount: stateStore.get().schedules.length,
        });
        if (!lifecycleTimer) {
          lifecycleTimer = setInterval(() => {
            if (!hasBackgroundWork()) void stop();
          }, 250);
        }
        return;
      }

      if (urlObj.pathname === '/api/desktop/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (urlObj.pathname === '/api/desktop/player-options' && req.method === 'POST') {
        const body = await readJsonBody(req);
        stateStore.update((s) => ({
          ...s,
          playerOptions: {
            ...s.playerOptions,
            ...(typeof body.userAgent === 'string' ? { userAgent: body.userAgent } : {}),
            ...(typeof body.bufferMode === 'string' ? { bufferMode: body.bufferMode } : {}),
            ...(typeof body.decoder === 'string' ? { decoder: body.decoder } : {}),
            ...(typeof body.afr === 'boolean' ? { afr: body.afr } : {}),
          },
        }));
        sendJson(res, 200, { ok: true, playerOptions: stateStore.get().playerOptions });
        return;
      }

      try {
        if (await localAndDvr.handleRoutes(req, res, urlObj)) return;
        if (await lanServices.handleRoutes(req, res, urlObj)) return;
        if (await handleFfmpegRoutes(req, res, urlObj, { stateStore, resolveLocalPath: localAndDvr.resolveLocalPath })) return;
        if (await handleHttpRoutes(req, res, urlObj, stateStore)) return;
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, err?.statusCode || 500, { error: err?.message || 'Erreur interne desktop.' });
        }
        return;
      }

      sendJson(res, 404, { error: 'Route desktop inconnue.' });
      return;
    }

    serveStatic(req, res, urlObj.pathname);
  };

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, err?.statusCode || 500, { error: err?.message || 'Erreur interne desktop.' });
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  });

  const start = () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const addr = server.address();
      activePort = typeof addr === 'object' && addr ? addr.port : port;
      localAndDvr.startScheduler();
      resolve({ port: activePort, url: `http://127.0.0.1:${activePort}` });
    });
  });

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (lifecycleTimer) clearInterval(lifecycleTimer);
    lifecycleTimer = null;
    for (const client of sseClients) {
      try { client.end(); } catch { /* ignore */ }
    }
    sseClients.clear();
    killAllFfmpegChildren();
    await localAndDvr.stopAll();
    await lanServices.stopAll();
    server.closeIdleConnections?.();
    await new Promise((resolve) => {
      const t = setTimeout(() => { server.closeAllConnections?.(); resolve(); }, 500);
      server.close(() => { clearTimeout(t); resolve(); });
    });
    onStop?.();
  };

  return {
    server,
    stateStore,
    localAndDvr,
    lanServices,
    start,
    stop,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const desktop = createDesktopServer({
    onStop: () => setImmediate(() => process.exit(0)),
  });
  desktop.start()
    .then(({ url }) => {
      console.log(`[CedPlay Desktop] Serveur actif sur ${url}`);
    })
    .catch((err) => {
      console.error('[CedPlay Desktop] Démarrage impossible :', err?.message || err);
      process.exit(1);
    });

  const shutdown = () => {
    void desktop.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
