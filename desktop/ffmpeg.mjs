import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { getFfmpegPath, getFfprobePath, sendJson } from './config.mjs';

const activeFfmpegChildren = new Set();
const TEXT_SUBTITLE_CODECS = new Set(['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'mov_text', 'text', 'ttml', 'microdvd', 'sami', 'realtext', 'subviewer', 'subviewer1', 'jacosub', 'pjs', 'vplayer']);

export function killAllFfmpegChildren() {
  for (const child of activeFfmpegChildren) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* process already exited */
    }
  }
  activeFfmpegChildren.clear();
}

function isHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function srtToVtt(srtText) {
  const clean = String(srtText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (/^\[Events\]\s*$/im.test(clean)) return assToVtt(clean);
  const converted = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  if (converted.trimStart().startsWith('WEBVTT')) return converted;
  return `WEBVTT\n\n${converted}`;
}

function assToVtt(text) {
  const cues = [];
  let inEvents = false;
  let fields = [];
  const timestamp = (raw) => {
    const match = /^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/.exec(raw.trim());
    if (!match) return null;
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${match[4].padEnd(3, '0')}`;
  };
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) {
      inEvents = /^\s*\[Events\]\s*$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^\s*Format:/i.test(line)) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^\s*Dialogue:/i.test(line) || !fields.length) continue;
    const raw = line.slice(line.indexOf(':') + 1).trim();
    const values = [];
    let cursor = 0;
    for (let i = 0; i < fields.length - 1; i++) {
      const comma = raw.indexOf(',', cursor);
      if (comma < 0) break;
      values.push(raw.slice(cursor, comma));
      cursor = comma + 1;
    }
    values.push(raw.slice(cursor));
    if (values.length !== fields.length) continue;
    const start = timestamp(values[fields.indexOf('start')] || '');
    const end = timestamp(values[fields.indexOf('end')] || '');
    const content = (values[fields.indexOf('text')] || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\\[Nn]/g, '\n').replace(/\\h/g, '\u00a0');
    if (start && end && content.trim()) cues.push(`${start} --> ${end}\n${content}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function probeMediaInfo(inputPathOrUrl, userAgent = '') {
  return new Promise((resolve) => {
    const ffprobe = getFfprobePath();
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams'];
    if (isHttpUrl(inputPathOrUrl) && userAgent) {
      args.push('-user_agent', userAgent);
    }
    args.push(inputPathOrUrl);

    execFile(ffprobe, args, { timeout: 12000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        resolve({ durationSec: 0, videoCodec: '', audioCodec: '', audioTracks: [], subtitleTracks: [] });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const durationSec = Number(parsed?.format?.duration) || 0;
        const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
        const v = streams.find((s) => s.codec_type === 'video');
        const a = streams.find((s) => s.codec_type === 'audio');
        resolve({
          durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
          videoCodec: v?.codec_name || '',
          audioCodec: a?.codec_name || '',
          audioTracks: streams.filter((s) => s.codec_type === 'audio').map((s, id) => ({
            id,
            label: String(s.tags?.title || s.tags?.language || `Piste ${id + 1}`),
          })),
          subtitleTracks: streams.filter((s) => s.codec_type === 'subtitle')
            .map((s, id) => ({ id, stream: s }))
            .filter(({ stream }) => TEXT_SUBTITLE_CODECS.has(stream.codec_name))
            .map(({ id, stream }) => ({ id, label: String(stream.tags?.title || stream.tags?.language || `Sous-titres ${id + 1}`) })),
          width: Number(v?.width) || 0,
          height: Number(v?.height) || 0,
        });
      } catch {
        resolve({ durationSec: 0, videoCodec: '', audioCodec: '', audioTracks: [], subtitleTracks: [] });
      }
    });
  });
}

function resolveTransmuxInput(rawSource, resolveLocalPath) {
  if (!rawSource) return null;
  if (isHttpUrl(rawSource)) return { input: rawSource, isRemote: true };
  if (resolveLocalPath) {
    const resolved = resolveLocalPath(rawSource);
    if (resolved) return { input: resolved, isRemote: false };
  }
  return null;
}

export function buildTransmuxArgs({ input, isRemote, userAgent, startSec = 0, transcodeVideo = false, live = false, audioTrack = 0 }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (isRemote) {
    if (userAgent) args.push('-user_agent', userAgent);
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '3');
  }
  if (live) {
    args.push('-fflags', '+genpts+nobuffer', '-analyzeduration', '2000000', '-probesize', '2000000');
  } else if (startSec > 0) {
    args.push('-ss', String(startSec));
  }

  args.push('-i', input);
  args.push('-map', '0:v:0?', '-map', `0:a:${audioTrack}?`);

  if (transcodeVideo) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'copy');
  }

  args.push(
    '-c:a', 'aac',
    '-ac', '2',
    '-b:a', '192k',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  );
  return args;
}

function streamFfmpegOutput(req, res, args, contentType) {
  const child = spawn(getFfmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  activeFfmpegChildren.add(child);
  let sentHeaders = false;
  let stderrTail = '';
  const cleanup = () => {
    activeFfmpegChildren.delete(child);
    if (!child.killed) {
      try { child.kill('SIGTERM'); } catch { /* process already exited */ }
    }
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-1024);
  });
  child.stdout.on('data', (chunk) => {
    if (!sentHeaders) {
      sentHeaders = true;
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    }
    if (!res.destroyed && !res.write(chunk)) {
      child.stdout.pause();
      res.once('drain', () => child.stdout.resume());
    }
  });
  child.on('error', (err) => {
    cleanup();
    if (!sentHeaders && !res.headersSent) sendJson(res, 500, { error: err.message || 'FFmpeg introuvable.' });
    else if (!res.destroyed) res.destroy();
  });
  child.on('close', (code) => {
    activeFfmpegChildren.delete(child);
    if (!sentHeaders && !res.headersSent) {
      sendJson(res, 502, { error: stderrTail.trim() || `FFmpeg terminé (code ${code ?? 1}).` });
      return;
    }
    if (!res.writableEnded) res.end();
  });
}

export async function handleFfmpegRoutes(req, res, urlObj, { stateStore, resolveLocalPath }) {
  if (urlObj.pathname === '/api/desktop/probe-media' && req.method === 'GET') {
    const raw = urlObj.searchParams.get('url') || '';
    const resolved = resolveTransmuxInput(raw, resolveLocalPath);
    if (!resolved) {
      sendJson(res, 400, { error: 'Source média non autorisée ou invalide.' });
      return true;
    }
    const ua = stateStore?.get()?.playerOptions?.userAgent || '';
    const info = await probeMediaInfo(resolved.input, ua);
    sendJson(res, 200, info);
    return true;
  }

  if (urlObj.pathname === '/api/desktop/subtitle' && req.method === 'GET') {
    const raw = urlObj.searchParams.get('uri') || urlObj.searchParams.get('url') || '';
    if (!raw) {
      sendJson(res, 400, { error: 'Paramètre uri manquant.' });
      return true;
    }
    if (urlObj.searchParams.has('track')) {
      const track = Number(urlObj.searchParams.get('track'));
      const resolved = resolveTransmuxInput(raw, resolveLocalPath);
      if (!resolved || !Number.isSafeInteger(track) || track < 0) {
        sendJson(res, 400, { error: 'Source ou piste de sous-titres invalide.' });
        return true;
      }
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
      const ua = stateStore?.get()?.playerOptions?.userAgent || '';
      if (resolved.isRemote && ua) args.push('-user_agent', ua);
      args.push('-i', resolved.input, '-map', `0:s:${track}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1');
      streamFfmpegOutput(req, res, args, 'text/vtt; charset=utf-8');
      return true;
    }
    try {
      let text = '';
      if (isHttpUrl(raw)) {
        const upstream = await fetch(raw);
        if (!upstream.ok) {
          sendJson(res, upstream.status, { error: `Sous-titres HTTP ${upstream.status}` });
          return true;
        }
        text = await upstream.text();
      } else {
        const localFile = resolveLocalPath?.(raw);
        if (!localFile) {
          sendJson(res, 403, { error: 'Accès fichier sous-titres refusé.' });
          return true;
        }
        text = readFileSync(localFile, 'utf8');
      }
      const vtt = srtToVtt(text);
      res.writeHead(200, {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Length': Buffer.byteLength(vtt),
        'Cache-Control': 'no-store',
      });
      res.end(vtt);
    } catch (err) {
      sendJson(res, 500, { error: err?.message || 'Impossible de charger les sous-titres.' });
    }
    return true;
  }

  if (urlObj.pathname === '/api/desktop/transmux' && req.method === 'GET') {
    const raw = urlObj.searchParams.get('url') || '';
    const resolved = resolveTransmuxInput(raw, resolveLocalPath);
    if (!resolved) {
      sendJson(res, 400, { error: 'Source transmux invalide ou non autorisée.' });
      return true;
    }
    const startSec = Math.max(0, Number(urlObj.searchParams.get('start') || '0') || 0);
    const transcodeVideo = urlObj.searchParams.get('video') === 'h264';
    const live = urlObj.searchParams.get('live') === '1';
    const audioTrack = Number(urlObj.searchParams.get('audioTrack') || '0');
    if (!Number.isSafeInteger(audioTrack) || audioTrack < 0) {
      sendJson(res, 400, { error: 'Piste audio invalide.' });
      return true;
    }
    const ua = urlObj.searchParams.get('ua') || stateStore?.get()?.playerOptions?.userAgent || '';

    const ffmpegBin = getFfmpegPath();
    const args = buildTransmuxArgs({
      input: resolved.input,
      isRemote: resolved.isRemote,
      userAgent: ua,
      startSec,
      transcodeVideo,
      live,
      audioTrack,
    });

    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    activeFfmpegChildren.add(child);

    let sentHeaders = false;
    let stderrTail = '';

    const cleanup = () => {
      activeFfmpegChildren.delete(child);
      if (!child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
    };

    req.on('close', cleanup);
    res.on('close', cleanup);

    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-1024);
    });

    child.stdout.on('data', (chunk) => {
      if (!sentHeaders) {
        sentHeaders = true;
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-store',
        });
      }
      if (!res.destroyed) {
        const ok = res.write(chunk);
        if (!ok) {
          child.stdout.pause();
          res.once('drain', () => child.stdout.resume());
        }
      }
    });

    child.on('error', (err) => {
      cleanup();
      if (!sentHeaders && !res.headersSent) {
        sendJson(res, 500, { error: err?.message || 'FFmpeg introuvable.' });
      } else if (!res.destroyed) {
        res.destroy();
      }
    });

    child.on('close', (code) => {
      activeFfmpegChildren.delete(child);
      if (!sentHeaders && !res.headersSent) {
        sendJson(res, 502, { error: stderrTail.trim() || `FFmpeg terminé (code ${code ?? 1}).` });
        return;
      }
      if (!res.writableEnded) res.end();
    });

    return true;
  }

  return false;
}
