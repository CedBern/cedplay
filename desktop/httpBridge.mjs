import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import { readJsonBody, sendJson } from './config.mjs';

const DEFAULT_UA = 'CedPlay-Desktop/1.0 (Windows NT 10.0; Win64; x64)';
const MAX_HTTP_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

function isAllowedHttpUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveUserAgent(explicitUa, stateStore) {
  const fromReq = typeof explicitUa === 'string' ? explicitUa.trim() : '';
  if (fromReq) return fromReq;
  const fromState = stateStore?.get()?.playerOptions?.userAgent?.trim() || '';
  return fromState || DEFAULT_UA;
}

function buildRequestHeaders(rawHeaders, ua, ref) {
  const headers = new Headers();
  if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === 'string' && k.trim()) headers.set(k.trim(), v);
    }
  }
  if (ua && !headers.has('user-agent')) headers.set('user-agent', ua);
  if (ref && !headers.has('referer')) headers.set('referer', ref);
  return headers;
}

function headersToObject(headers) {
  const out = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function looksLikeGzip(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isM3u8Response(url, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('mpegurl')) return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.m3u8') || pathname.endsWith('.m3u');
  } catch {
    return false;
  }
}

function proxyWrapUrl(targetUrl, ua, ref) {
  const params = new URLSearchParams({ url: targetUrl });
  if (ua) params.set('ua', ua);
  if (ref) params.set('ref', ref);
  return `/api/desktop/proxy?${params.toString()}`;
}

export function rewriteM3u8Playlist(text, baseUrl, ua, ref) {
  const resolveAbs = (rel) => {
    const cleaned = rel.trim();
    if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('blob:')) return cleaned;
    try {
      const abs = new URL(cleaned, baseUrl).href;
      return isAllowedHttpUrl(abs) ? proxyWrapUrl(abs, ua, ref) : cleaned;
    } catch {
      return cleaned;
    }
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI=(["'])([^"']+)\1/g, (_, quote, uri) => `URI=${quote}${resolveAbs(uri)}${quote}`);
      }
      return resolveAbs(trimmed);
    })
    .join('\n');
}

async function readCappedBuffer(response, maxBytes = MAX_HTTP_BYTES) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error(`Réponse HTTP trop volumineuse (>${maxBytes} octets).`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function performDesktopHttp(options, stateStore) {
  const {
    url,
    method = 'GET',
    headers: rawHeaders,
    body,
    responseType = 'text',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    gunzip = false,
  } = options || {};

  if (typeof url !== 'string' || !isAllowedHttpUrl(url)) {
    const err = new Error('URL HTTP/HTTPS invalide.');
    err.statusCode = 400;
    throw err;
  }
  const upperMethod = String(method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(upperMethod)) {
    const err = new Error('Méthode HTTP non prise en charge.');
    err.statusCode = 400;
    throw err;
  }

  const ua = resolveUserAgent(rawHeaders?.['User-Agent'] || rawHeaders?.['user-agent'], stateStore);
  const headers = buildRequestHeaders(rawHeaders, ua);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), 120000));

  try {
    const init = {
      method: upperMethod,
      headers,
      redirect: 'follow',
      signal: controller.signal,
    };
    if (body !== undefined && upperMethod !== 'GET' && upperMethod !== 'HEAD') {
      if (typeof body === 'string') {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
    }

    const res = await fetch(url, init);
    const buf = upperMethod === 'HEAD' ? Buffer.alloc(0) : await readCappedBuffer(res);
    const decodedBuf = gunzip && looksLikeGzip(buf) ? gunzipSync(buf) : buf;
    let data;
    if (responseType === 'base64') {
      data = decodedBuf.toString('base64');
    } else if (responseType === 'json') {
      const txt = decodedBuf.toString('utf8');
      try { data = JSON.parse(txt); } catch { data = txt; }
    } else {
      data = decodedBuf.toString('utf8');
    }

    return {
      status: res.status,
      url: res.url || url,
      headers: headersToObject(res.headers),
      data,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSingleStream(url, stateStore, timeoutMs = 6000) {
  if (!isAllowedHttpUrl(url)) return { ok: false, status: 0 };
  const ua = resolveUserAgent('', stateStore);
  const runProbe = async (method, range) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'User-Agent': ua };
      if (range) headers.Range = range;
      const res = await fetch(url, { method, headers, redirect: 'follow', signal: controller.signal });
      if (res.body) void res.body.cancel().catch(() => {});
      return { ok: res.status >= 200 && res.status < 400, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  };

  const head = await runProbe('HEAD');
  if (head.ok) return head;
  if (head.status === 0 || head.status === 405 || head.status === 501 || head.status === 403 || head.status === 400) {
    return runProbe('GET', 'bytes=0-1023');
  }
  return head;
}

export async function probeBatchStreams(urls, stateStore, concurrency = 6) {
  const results = new Array(urls.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), urls.length || 1);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < urls.length) {
        const index = cursor++;
        results[index] = await probeSingleStream(urls[index], stateStore);
      }
    }),
  );
  return results;
}

function buildStalkerCookie(mac) {
  return `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Paris`;
}

export async function resolveStalkerLink({ portalUrl, mac, cmd, type = 'itv' }, stateStore) {
  if (!isAllowedHttpUrl(portalUrl) || !mac || !cmd) {
    const err = new Error('Paramètres Stalker incomplets.');
    err.statusCode = 400;
    throw err;
  }
  const base = portalUrl.replace(/\/+$/, '');
  const endpoint = base.endsWith('.php') ? base : `${base}/portal.php`;
  const headers = {
    Cookie: buildStalkerCookie(mac),
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
  };

  const hsUrl = `${endpoint}?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
  const hs = await performDesktopHttp({ url: hsUrl, headers, responseType: 'json' }, stateStore);
  const token = hs?.data?.js?.token || '';
  if (token) headers.Authorization = `Bearer ${token}`;

  const linkUrl = `${endpoint}?type=${encodeURIComponent(type)}&action=create_link&cmd=${encodeURIComponent(cmd)}&JsHttpRequest=1-xml`;
  const linkRes = await performDesktopHttp({ url: linkUrl, headers, responseType: 'json' }, stateStore);
  const rawCmd = linkRes?.data?.js?.cmd || '';
  const cleaned = rawCmd.replace(/^(?:ffmpeg|ffrt|ffrt2|ffrt3)\s+/i, '').trim();
  if (!isAllowedHttpUrl(cleaned)) {
    const err = new Error('Le portail Stalker n’a pas renvoyé d’adresse de flux valide.');
    err.statusCode = 502;
    throw err;
  }
  return { url: cleaned, rawCmd, token };
}

export function openExternalUrl(targetUrl) {
  if (!isAllowedHttpUrl(targetUrl)) {
    const err = new Error('Adresse externe invalide.');
    err.statusCode = 400;
    throw err;
  }
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', targetUrl], (err) => {
        if (err) reject(err);
        else resolve(true);
      });
      return;
    }
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(opener, [targetUrl], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

export async function handleHttpRoutes(req, res, urlObj, stateStore) {
  if (urlObj.pathname === '/api/desktop/http' && req.method === 'POST') {
    const payload = await readJsonBody(req);
    try {
      const result = await performDesktopHttp(payload, stateStore);
      sendJson(res, 200, result);
    } catch (err) {
      const code = err?.statusCode || (err?.name === 'AbortError' ? 504 : 502);
      sendJson(res, code, { error: err?.message || 'Erreur HTTP desktop' });
    }
    return true;
  }

  if (urlObj.pathname === '/api/desktop/proxy' && (req.method === 'GET' || req.method === 'HEAD')) {
    const targetUrl = urlObj.searchParams.get('url') || '';
    if (!isAllowedHttpUrl(targetUrl)) {
      sendJson(res, 400, { error: 'URL cible invalide.' });
      return true;
    }
    const ua = resolveUserAgent(urlObj.searchParams.get('ua'), stateStore);
    const ref = urlObj.searchParams.get('ref') || '';
    const headers = buildRequestHeaders({}, ua, ref);
    if (req.headers.range) headers.set('range', String(req.headers.range));

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });

      const finalUrl = upstream.url || targetUrl;
      const contentType = upstream.headers.get('content-type') || '';

      if (req.method === 'GET' && isM3u8Response(finalUrl, contentType)) {
        const text = await upstream.text();
        const rewritten = rewriteM3u8Playlist(text, finalUrl, urlObj.searchParams.get('ua') || '', ref);
        res.writeHead(upstream.status, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Content-Length': Buffer.byteLength(rewritten),
          'Cache-Control': 'no-store',
        });
        res.end(rewritten);
        return true;
      }

      const outHeaders = {
        'Cache-Control': 'no-store',
      };
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const val = upstream.headers.get(name);
        if (val) outHeaders[name] = val;
      }
      if (!outHeaders['content-type']) outHeaders['content-type'] = 'application/octet-stream';

      res.writeHead(upstream.status, outHeaders);
      if (req.method === 'HEAD' || !upstream.body) {
        res.end();
        return true;
      }
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 502, { error: err?.message || 'Erreur proxy média' });
      } else {
        res.destroy();
      }
    }
    return true;
  }

  if (urlObj.pathname === '/api/desktop/probe-streams' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === 'string') : [];
    const results = await probeBatchStreams(urls, stateStore);
    sendJson(res, 200, { results });
    return true;
  }

  if (urlObj.pathname === '/api/desktop/stalker-resolve' && req.method === 'POST') {
    const body = await readJsonBody(req);
    try {
      const resolved = await resolveStalkerLink(body, stateStore);
      sendJson(res, 200, resolved);
    } catch (err) {
      sendJson(res, err?.statusCode || 502, { error: err?.message || 'Erreur Stalker' });
    }
    return true;
  }

  if (urlObj.pathname === '/api/desktop/open-external' && req.method === 'POST') {
    const body = await readJsonBody(req);
    try {
      await openExternalUrl(body.url);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err?.statusCode || 500, { error: err?.message || 'Impossible d’ouvrir le lien externe.' });
    }
    return true;
  }

  return false;
}
