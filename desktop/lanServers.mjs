import { randomBytes } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import { readJsonBody, sendJson } from './config.mjs';

const MAX_FIELD = 1024;
const DEFAULT_LAN_SYNC_PORT = 48123;

export function discoverLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!Array.isArray(list)) continue;
    const lowerName = name.toLowerCase();
    const virtualPenalty = /(virtual|vmware|vbox|hyper-v|vethernet|wsl|loopback|docker|bluetooth)/.test(lowerName) ? 10 : 0;
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      const rfc1918Bonus = info.address.startsWith('192.168.') ? 0 : info.address.startsWith('10.') ? 1 : 2;
      candidates.push({ address: info.address, score: virtualPenalty + rfc1918Bonus });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.address || '127.0.0.1';
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pairingPage(body) {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>CedPlay</title><style>'
    + 'body{margin:0;background:#0a0a0a;color:#f5f5f5;font:17px/1.4 system-ui,sans-serif}'
    + 'main{max-width:440px;margin:0 auto;padding:28px 20px}'
    + 'h1{font-size:24px;margin:0 0 6px}p{color:#a3a3a3;margin:0 0 20px}'
    + 'label{display:block;font-size:14px;color:#d4d4d4;margin:16px 0 6px}'
    + 'input{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;border:1px solid #404040;background:#171717;color:#fff;font-size:17px}'
    + 'button{width:100%;margin-top:24px;padding:16px;border:0;border-radius:12px;background:#FF5A36;color:#fff;font-size:18px;font-weight:600;cursor:pointer}'
    + '.error{color:#fda4af;margin:0 0 8px}.hint{font-size:13px;margin:6px 0 0}'
    + '</style></head><body><main>' + body + '</main></body></html>';
}

function pairingFormHtml(error, server, username) {
  const attrs = ` autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" maxlength="${MAX_FIELD}"`;
  return pairingPage(
    '<h1>Connecter ton abonnement</h1>'
    + '<p>Ce que tu saisis ici part directement vers CedPlay Desktop sur ton réseau.</p>'
    + (error ? `<p class="error">${escapeHtml(error)}</p>` : '')
    + '<form method="post">'
    + '<label for="s">Adresse du serveur</label>'
    + `<input id="s" name="server" inputmode="url" placeholder="http://serveur.com:8080" value="${escapeHtml(server)}"${attrs}>`
    + '<p class="hint">Tu peux aussi coller ici ton lien M3U complet : le reste est alors inutile.</p>'
    + '<label for="u">Identifiant</label>'
    + `<input id="u" name="username" value="${escapeHtml(username)}"${attrs}>`
    + '<label for="p">Mot de passe</label>'
    + `<input id="p" name="password" type="password" value=""${attrs}>`
    + '<button type="submit">Envoyer vers CedPlay</button></form>',
  );
}

function validatePairingInput(server, username, password) {
  if (!server) return 'Indique l’adresse du serveur.';
  const lower = server.toLowerCase();
  const isFullLink = lower.includes('username=') && lower.includes('password=');
  if (!isFullLink && (!username || !password)) return 'Indique l’identifiant et le mot de passe.';
  return null;
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

function listenOnPreferredPort(server, host, preferredPort) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (preferredPort > 0) {
        server.removeListener('error', onError);
        server.once('error', reject);
        server.listen(0, host, () => resolve(server.address()));
        return;
      }
      reject(err);
    };
    server.once('error', onError);
    server.listen(preferredPort, host, () => {
      server.removeListener('error', onError);
      resolve(server.address());
    });
  });
}

async function readTextBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('Payload too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createLanServices(emitEvent) {
  let pairingSession = null;
  let lanSyncSession = null;
  const pendingPairingAcks = new Map();
  const pendingSyncAcks = new Map();

  const stopPairing = async () => {
    const current = pairingSession;
    pairingSession = null;
    if (!current) return;
    current.server.closeIdleConnections?.();
    await new Promise((resolve) => {
      const t = setTimeout(() => { current.server.closeAllConnections?.(); resolve(); }, 400);
      current.server.close(() => { clearTimeout(t); resolve(); });
    });
  };

  const stopLanSync = async () => {
    const current = lanSyncSession;
    lanSyncSession = null;
    if (!current) return;
    current.server.closeIdleConnections?.();
    await new Promise((resolve) => {
      const t = setTimeout(() => { current.server.closeAllConnections?.(); resolve(); }, 400);
      current.server.close(() => { clearTimeout(t); resolve(); });
    });
  };

  const startPairing = async (hostOverride) => {
    await stopPairing();
    const host = hostOverride || discoverLanIp();
    const secret = randomBytes(6).toString('hex');

    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname !== `/${secret}`) {
        sendHtml(res, 404, pairingPage('<h1>Page introuvable</h1><p>Scanne à nouveau le QR code affiché sur CedPlay.</p>'));
        return;
      }
      if (req.method === 'GET') {
        sendHtml(res, 200, pairingFormHtml(null, '', ''));
        return;
      }
      if (req.method !== 'POST') {
        sendHtml(res, 405, pairingPage('<h1>Méthode non prise en charge</h1><p>Utilise le formulaire.</p>'));
        return;
      }

      let rawBody = '';
      try {
        rawBody = await readTextBody(req, 8192);
      } catch {
        sendHtml(res, 413, pairingFormHtml('Envoi trop volumineux.', '', ''));
        return;
      }
      const params = new URLSearchParams(rawBody);
      const serverVal = (params.get('server') || '').trim().slice(0, MAX_FIELD);
      const userVal = (params.get('username') || '').trim().slice(0, MAX_FIELD);
      const passVal = (params.get('password') || '').trim().slice(0, MAX_FIELD);
      const errMsg = validatePairingInput(serverVal, userVal, passVal);
      if (errMsg) {
        sendHtml(res, 400, pairingFormHtml(errMsg, serverVal, userVal));
        return;
      }

      const requestId = `pair_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const ackPromise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingPairingAcks.delete(requestId);
          resolve(false);
        }, 6000);
        pendingPairingAcks.set(requestId, (accepted) => {
          clearTimeout(timer);
          pendingPairingAcks.delete(requestId);
          resolve(Boolean(accepted));
        });
      });

      emitEvent?.('pairingCredentials', {
        requestId,
        server: serverVal,
        username: userVal,
        password: passVal,
      });

      const accepted = await ackPromise;
      if (accepted) {
        sendHtml(res, 200, pairingPage('<h1>C’est envoyé</h1><p>Regarde ton écran : la connexion démarre. Tu peux fermer cette page.</p>'));
      } else {
        sendHtml(res, 409, pairingFormHtml('Adresse refusée ou session fermée. Réessaie.', serverVal, userVal));
      }
    });

    const addr = await listenOnPreferredPort(server, host, 0);
    const url = `http://${host}:${addr.port}/${secret}`;
    pairingSession = { server, url };
    return { url };
  };

  const startLanSync = async (token, hostOverride, preferredPort = DEFAULT_LAN_SYNC_PORT) => {
    if (!/^[a-z0-9]{8,32}$/.test(String(token || ''))) {
      throw new Error('Jeton de synchronisation invalide.');
    }
    await stopLanSync();
    const host = hostOverride || discoverLanIp();
    let syncing = false;

    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname !== `/sync/${token}`) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { service: 'cedplay-lan-sync', version: 1 });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }
      if (syncing) {
        sendJson(res, 409, { error: 'sync_in_progress' });
        return;
      }
      syncing = true;
      try {
        const body = await readTextBody(req, 2 * 1024 * 1024);
        const requestId = `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const ackPromise = new Promise((resolve) => {
          const timer = setTimeout(() => {
            pendingSyncAcks.delete(requestId);
            resolve({ ok: false });
          }, 8000);
          pendingSyncAcks.set(requestId, (result) => {
            clearTimeout(timer);
            pendingSyncAcks.delete(requestId);
            resolve(result);
          });
        });

        emitEvent?.('lanSyncRequest', { requestId, payload: body });
        const result = await ackPromise;
        if (!result?.ok || typeof result.mergedJson !== 'string') {
          sendJson(res, 400, { error: 'invalid_or_rejected_payload' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(result.mergedJson),
          'Cache-Control': 'no-store',
        });
        res.end(result.mergedJson);
      } catch (err) {
        sendJson(res, err?.statusCode || 400, { error: 'bad_request' });
      } finally {
        syncing = false;
      }
    });

    const addr = await listenOnPreferredPort(server, host, preferredPort);
    const url = `http://${host}:${addr.port}/sync/${token}`;
    lanSyncSession = { server, url };
    return { url };
  };

  const stopAll = async () => {
    await Promise.all([stopPairing(), stopLanSync()]);
  };

  const handleRoutes = async (req, res, urlObj) => {
    if (urlObj.pathname === '/api/desktop/pairing/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const started = await startPairing(body.host);
      sendJson(res, 200, started);
      return true;
    }
    if (urlObj.pathname === '/api/desktop/pairing/stop' && req.method === 'POST') {
      await stopPairing();
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (urlObj.pathname === '/api/desktop/pairing/ack' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const resolver = pendingPairingAcks.get(String(body.requestId || ''));
      if (resolver) resolver(Boolean(body.accepted));
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/lan-sync/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const started = await startLanSync(body.token, body.host, body.preferredPort);
        sendJson(res, 200, started);
      } catch (err) {
        sendJson(res, 400, { error: err?.message || 'Impossible de démarrer la synchronisation LAN.' });
      }
      return true;
    }
    if (urlObj.pathname === '/api/desktop/lan-sync/stop' && req.method === 'POST') {
      await stopLanSync();
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (urlObj.pathname === '/api/desktop/lan-sync/ack' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const resolver = pendingSyncAcks.get(String(body.requestId || ''));
      if (resolver) resolver({ ok: Boolean(body.ok), mergedJson: body.mergedJson });
      sendJson(res, 200, { ok: true });
      return true;
    }

    return false;
  };

  return {
    startPairing,
    stopPairing,
    startLanSync,
    stopLanSync,
    stopAll,
    handleRoutes,
  };
}
