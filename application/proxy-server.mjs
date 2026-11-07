import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = Number(process.env.IPTV_PROXY_PORT || 5179);
const HOST = '127.0.0.1';
const USER_AGENT = 'IPTVSmartersPro';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

function extractErrorMessage(err) {
  if (!err) return 'Erreur réseau inconnue';
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map(e => e.message || e.code).join(' | ');
  }
  return err.message || err.code || String(err);
}

function build502Payload(err) {
  return {
    error: 'Impossible de joindre le serveur IPTV distant',
    detail: err?.code || 'Connexion impossible',
    hints: [
      'Vérifiez la connexion réseau et le nombre de connexions autorisées par votre abonnement.',
      'Le serveur distant peut être temporairement saturé ou en maintenance : patientez quelques minutes avant de réessayer.',
    ],
  };
}

async function fetchWithRetry(targetUrl, headers = {}, retries = 2) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const url = new URL(targetUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const res = await new Promise((resolve, reject) => {
        const req = client.request(url, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, ...headers },
          timeout: 6000,
        }, resolve);
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('Délai d’attente dépassé (timeout 6s)')); });
        req.end();
      });

      if (res.statusCode >= 500 && attempt <= retries) {
        res.resume();
        console.warn(`[Proxy IPTV] Tentative ${attempt} a reçu HTTP ${res.statusCode}, nouvel essai...`);
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt <= retries) {
        console.warn(`[Proxy IPTV] Tentative ${attempt} échouée (${extractErrorMessage(err)}), nouvel essai...`);
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
    }
  }
  throw lastErr || new Error('Échec des tentatives');
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  const timestamp = new Date().toLocaleTimeString();

  if (reqUrl.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, uptime: process.uptime() }));
    return;
  }

  // Generic stream & URL proxy
  if (reqUrl.pathname === '/proxy') {
    const rawTarget = reqUrl.searchParams.get('url');
    if (!rawTarget) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Paramètre "url" manquant.' }));
      return;
    }

    let target;
    try {
      target = new URL(rawTarget);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URL cible invalide.' }));
      return;
    }

    if (!['http:', 'https:'].includes(target.protocol)) { res.writeHead(400); res.end('HTTP requis'); return; }

    const isHttps = target.protocol === 'https:';
    const client = isHttps ? https : http;

    const forwardHeaders = {
      'User-Agent': USER_AGENT,
      'Accept': req.headers['accept'] || '*/*',
    };
    if (req.headers['range']) forwardHeaders['Range'] = req.headers['range'];

    const upstreamReq = client.request(target, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: forwardHeaders,
      timeout: 15000,
    }, (upstreamRes) => {
      console.log(`[${timestamp}] [STREAM UPSTREAM] HTTP ${upstreamRes.statusCode} (${upstreamRes.headers['content-type'] || 'n/a'})`);
      const outHeaders = {};
      const contentType = upstreamRes.headers['content-type'];
      if (contentType) outHeaders['Content-Type'] = contentType;
      if (upstreamRes.headers['content-length']) outHeaders['Content-Length'] = upstreamRes.headers['content-length'];
      if (upstreamRes.headers['content-range']) outHeaders['Content-Range'] = upstreamRes.headers['content-range'];
      if (upstreamRes.headers['accept-ranges']) outHeaders['Accept-Ranges'] = upstreamRes.headers['accept-ranges'];
      if (upstreamRes.headers.location) {
        const redirect = new URL(upstreamRes.headers.location, target);
        outHeaders.Location = `http://${HOST}:${PORT}/proxy?url=${encodeURIComponent(redirect.href)}`;
      }
      setCorsHeaders(res);
      res.writeHead(upstreamRes.statusCode || 200, outHeaders);

      upstreamRes.pipe(res);
      upstreamRes.on('error', () => res.destroy());
    });

    upstreamReq.on('error', (err) => {
      console.error(`[${timestamp}] [STREAM ERROR] Connexion interrompue`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(build502Payload(err, target.origin)));
      }
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(new Error('Délai d’attente dépassé (timeout 15s)'));
    });

    res.on('close', () => {
      upstreamReq.destroy();
    });
    upstreamReq.end();
    return;
  }

  // VOD catalog: only the known Xtream read actions can be forwarded.
  if (reqUrl.pathname === '/xtream/catalog') {
    // null : informations du compte (fuseau du serveur) ; get_live_streams : chaînes avec archives (catch-up).
    const allowed = new Set([null, 'get_vod_categories', 'get_vod_streams', 'get_vod_info', 'get_series_categories', 'get_series', 'get_series_info', 'get_live_streams']);
    const action = reqUrl.searchParams.get('action');
    const username = reqUrl.searchParams.get('username'), password = reqUrl.searchParams.get('password');
    let endpoint;
    try {
      const base = new URL(reqUrl.searchParams.get('server'));
      if (!['http:', 'https:'].includes(base.protocol) || !username || !password || !allowed.has(action)) throw new Error();
      endpoint = new URL(`${base.href.replace(/\/+$/, '')}/player_api.php`);
      endpoint.search = new URLSearchParams({ username, password, ...(action ? { action } : {}) }).toString();
      for (const key of ['category_id', 'vod_id', 'series_id']) {
        const value = reqUrl.searchParams.get(key);
        if (value !== null) { if (!/^\d+$/.test(value)) throw new Error(); endpoint.searchParams.set(key, value); }
      }
    } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Requête catalogue invalide' })); return; }
    try {
      const upstream = await fetchWithRetry(endpoint.href);
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) { upstream.resume(); throw new Error(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      upstream.pipe(res);
      upstream.on('error', () => res.destroy());
      res.on('close', () => upstream.destroy());
    } catch { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Catalogue indisponible' })); } }
    return;
  }

  // Xtream categories helper
  if (reqUrl.pathname === '/xtream/categories') {
    const serverUrl = reqUrl.searchParams.get('server');
    const username = reqUrl.searchParams.get('username');
    const password = reqUrl.searchParams.get('password');
    if (!serverUrl || !username || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Champs manquants' }));
      return;
    }
    const cleanServer = serverUrl.replace(/\/+$/, '');
    console.log(`[${timestamp}] [XTREAM CATEGORIES] Serveur: ${cleanServer}`);

    const target = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;
    try {
      const upstreamRes = await fetchWithRetry(target);
      console.log(`[${timestamp}] [XTREAM CATEGORIES] Réponse HTTP ${upstreamRes.statusCode}`);
      if (upstreamRes.statusCode >= 400) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(build502Payload(new Error(`Le serveur IPTV a répondu avec le statut HTTP ${upstreamRes.statusCode}`), cleanServer)));
        return;
      }
      res.writeHead(upstreamRes.statusCode || 200, { 'Content-Type': 'application/json' });
      upstreamRes.pipe(res);
    } catch (err) {
      const msg = extractErrorMessage(err);
      console.error(`[${timestamp}] [XTREAM CATEGORIES ERROR] ${msg}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(build502Payload(err, cleanServer)));
    }
    return;
  }

  // Xtream streams helper
  if (reqUrl.pathname === '/xtream/streams') {
    const serverUrl = reqUrl.searchParams.get('server');
    const username = reqUrl.searchParams.get('username');
    const password = reqUrl.searchParams.get('password');
    const categoryId = reqUrl.searchParams.get('category_id');
    if (!serverUrl || !username || !password || !categoryId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Champs manquants' }));
      return;
    }
    const cleanServer = serverUrl.replace(/\/+$/, '');
    console.log(`[${timestamp}] [XTREAM STREAMS] Catégorie: ${categoryId}`);

    const target = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams&category_id=${encodeURIComponent(categoryId)}`;
    try {
      const upstreamRes = await fetchWithRetry(target);
      if (upstreamRes.statusCode >= 400) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(build502Payload(new Error(`Le serveur IPTV a répondu avec le statut HTTP ${upstreamRes.statusCode}`), cleanServer)));
        return;
      }
      res.writeHead(upstreamRes.statusCode || 200, { 'Content-Type': 'application/json' });
      upstreamRes.pipe(res);
    } catch (err) {
      const msg = extractErrorMessage(err);
      console.error(`[${timestamp}] [XTREAM STREAMS ERROR] ${msg}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(build502Payload(err, cleanServer)));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Route non trouvée');
});

server.listen(PORT, HOST, () => {
  console.log(`[Proxy IPTV] En écoute sur http://${HOST}:${PORT}`);
});
