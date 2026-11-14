import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { getDefaultRecordingsDir, getFfmpegPath, readJsonBody, sendJson } from './config.mjs';
import { sendDesktopNotification } from './notifications.mjs';

const MAX_SCAN_FILES = 2000;
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg', '.flv', '.wmv']);
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav']);
const SUBTITLE_EXTS = ['.vtt', '.srt', '.ass', '.ssa'];

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
};

export function pathToLocalUri(absPath) {
  return `local://${Buffer.from(path.resolve(absPath), 'utf8').toString('base64url')}`;
}

export function localUriToPath(uri) {
  if (typeof uri !== 'string') return null;
  if (uri.startsWith('local://')) {
    try {
      const decoded = Buffer.from(uri.slice('local://'.length), 'base64url').toString('utf8');
      return decoded ? path.resolve(decoded) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isSameOrSubPath(candidatePath, rootPath) {
  const c = path.resolve(candidatePath).toLowerCase();
  const r = path.resolve(rootPath).toLowerCase();
  if (c === r) return true;
  const withSep = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(withSep);
}

function folderDisplayName(dirPath) {
  const resolved = path.resolve(dirPath);
  const base = path.basename(resolved);
  return base || resolved;
}

function sanitizeFileName(name) {
  const cleaned = String(name || 'enregistrement')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || 'enregistrement';
}

export function pickWindowsFolder(title = 'Choisir un dossier') {
  if (process.env.CEDPLAY_TEST_PICK_FOLDER) {
    const p = path.resolve(process.env.CEDPLAY_TEST_PICK_FOLDER);
    return Promise.resolve(existsSync(p) ? p : null);
  }
  if (process.platform !== 'win32') return Promise.resolve(null);

  const safeTitle = String(title).replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.StartPosition = "CenterScreen"',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$dialog.Description = '${safeTitle}'`,
    '$dialog.ShowNewFolderButton = $true',
    'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
    '$owner.Dispose()',
  ].join('; ');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { timeout: 120000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const selected = String(stdout || '').trim();
        resolve(selected ? path.resolve(selected) : null);
      },
    );
  });
}

function findAdjacentSubtitle(mediaFilePath, dirEntries) {
  const ext = path.extname(mediaFilePath);
  const stem = path.basename(mediaFilePath, ext).toLowerCase();
  const candidates = [];
  for (const subExt of SUBTITLE_EXTS) {
    candidates.push(`${stem}${subExt}`);
    candidates.push(`${stem}.fr${subExt}`);
    candidates.push(`${stem}.fra${subExt}`);
    candidates.push(`${stem}.en${subExt}`);
  }
  const byLower = new Map();
  for (const entry of dirEntries) {
    if (entry.isFile()) byLower.set(entry.name.toLowerCase(), entry.name);
  }
  for (const cand of candidates) {
    const hit = byLower.get(cand);
    if (hit) return path.join(path.dirname(mediaFilePath), hit);
  }
  return null;
}

export function scanMediaFolder(folderPath, { recursive = true, limit = MAX_SCAN_FILES } = {}) {
  const files = [];
  let truncated = false;
  const visited = new Set();

  const walk = (dir) => {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    const resolved = path.resolve(dir);
    if (visited.has(resolved.toLowerCase())) return;
    visited.add(resolved.toLowerCase());

    let entries;
    try {
      entries = readdirSync(resolved, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirs = [];
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        break;
      }
      const fullPath = path.join(resolved, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !entry.name.startsWith('.')) subdirs.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTS.has(ext) && !AUDIO_EXTS.has(ext)) continue;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      const subPath = findAdjacentSubtitle(fullPath, entries);
      const mimeType = MIME_BY_EXT[ext] || (AUDIO_EXTS.has(ext) ? 'audio/*' : 'video/*');
      files.push({
        uri: pathToLocalUri(fullPath),
        name: entry.name,
        size: stat.size,
        mimeType,
        lastModified: Math.round(stat.mtimeMs),
        ...(subPath ? { subtitleUri: pathToLocalUri(subPath) } : {}),
      });
    }

    for (const sub of subdirs) {
      if (files.length >= limit) {
        truncated = true;
        break;
      }
      walk(sub);
    }
  };

  walk(folderPath);
  return { files, truncated };
}

export function createLocalAndDvrService(stateStore, emitEvent) {
  const activeRecordings = new Map();
  const pendingNotifications = new Set();
  let schedulerTimer = null;

  const notify = (notification) => {
    const pending = sendDesktopNotification(notification);
    pendingNotifications.add(pending);
    void pending.finally(() => pendingNotifications.delete(pending));
  };

  const hasBackgroundWork = () => activeRecordings.size > 0
    || stateStore.get().schedules.length > 0
    || stateStore.get().reminders.length > 0
    || pendingNotifications.size > 0;

  const ensureDefaultRecordingsFolder = () => {
    const state = stateStore.get();
    if (state.recordingsFolder?.uri) {
      const existingPath = localUriToPath(state.recordingsFolder.uri);
      if (existingPath && existsSync(existingPath)) return state.recordingsFolder;
    }
    const dir = getDefaultRecordingsDir();
    mkdirSync(dir, { recursive: true });
    const folder = { uri: pathToLocalUri(dir), name: 'CedPlay (Vidéos)' };
    stateStore.update((s) => ({ ...s, recordingsFolder: folder }));
    return folder;
  };

  const getAuthorizedRoots = () => {
    const state = stateStore.get();
    const roots = [];
    for (const folder of state.localFolders || []) {
      const p = localUriToPath(folder.uri);
      if (p) roots.push(p);
    }
    if (state.recordingsFolder?.uri) {
      const rp = localUriToPath(state.recordingsFolder.uri);
      if (rp) roots.push(rp);
    }
    return roots;
  };

  const resolveLocalPath = (uri) => {
    const target = localUriToPath(uri);
    if (!target || !existsSync(target)) return null;
    const roots = getAuthorizedRoots();
    if (!roots.some((r) => isSameOrSubPath(target, r))) return null;
    return target;
  };

  const stopRecordingById = (id) => new Promise((resolve) => {
    const rec = activeRecordings.get(id);
    if (!rec) {
      resolve(false);
      return;
    }
    if (rec.durationTimer) clearTimeout(rec.durationTimer);
    activeRecordings.delete(id);

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      emitEvent?.('recordingStopped', { id, title: rec.title, uri: rec.uri });
      notify({
        kind: 'recordingStopped',
        title: 'Enregistrement terminé',
        body: rec.title,
        tag: `dvr-stop-${id}`,
      });
      resolve(true);
    };

    const killTimer = setTimeout(() => {
      try { rec.child.kill('SIGKILL'); } catch { /* ignore */ }
      done();
    }, 4000);

    rec.child.once('close', () => {
      clearTimeout(killTimer);
      done();
    });

    try {
      if (rec.child.stdin && !rec.child.stdin.destroyed) {
        rec.child.stdin.write('q\n');
      } else {
        rec.child.kill('SIGTERM');
      }
    } catch {
      try { rec.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
  });

  const startRecording = ({ url, title, userAgent, durationMs = 0, scheduleId = null }) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('URL HTTP/HTTPS requise pour enregistrer.');
    }
    const folder = ensureDefaultRecordingsFolder();
    const dir = localUriToPath(folder.uri);
    mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${sanitizeFileName(title)} - ${stamp}.ts`;
    const filePath = path.join(dir, fileName);
    const id = `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const uri = pathToLocalUri(filePath);

    const ua = (userAgent || stateStore.get().playerOptions?.userAgent || '').trim();
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (ua) args.push('-user_agent', ua);
    // reconnect_streamed bloque aussi les playlists HLS servies sans extension.
    args.push('-reconnect', '1', '-reconnect_delay_max', '3');
    args.push('-i', url, '-c', 'copy', '-f', 'mpegts', '-y', filePath);

    const child = spawn(getFfmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderrTail = '';
    child.stderr.on('data', (c) => {
      stderrTail = (stderrTail + c.toString('utf8')).slice(-512);
    });

    const entry = {
      id,
      title: String(title || 'Direct'),
      url,
      filePath,
      fileName,
      uri,
      startedAt: Date.now(),
      durationMs: Number(durationMs) || 0,
      scheduleId,
      child,
      durationTimer: null,
    };

    if (entry.durationMs > 0) {
      entry.durationTimer = setTimeout(() => {
        void stopRecordingById(id);
      }, entry.durationMs);
    }

    child.on('close', () => {
      if (activeRecordings.has(id)) {
        if (entry.durationTimer) clearTimeout(entry.durationTimer);
        activeRecordings.delete(id);
        emitEvent?.('recordingStopped', { id, title: entry.title, uri, stderr: stderrTail.trim() });
        if (!entry.hadSpawnError) {
          notify({
            kind: 'recordingStopped',
            title: 'Enregistrement terminé',
            body: entry.title,
            tag: `dvr-stop-${id}`,
          });
        }
      }
    });
    child.on('error', (err) => {
      entry.hadSpawnError = true;
      if (entry.durationTimer) clearTimeout(entry.durationTimer);
      activeRecordings.delete(id);
      emitEvent?.('recordingStopped', { id, title: entry.title, uri, stderr: err.message });
    });

    activeRecordings.set(id, entry);
    emitEvent?.('recordingStarted', { id, title: entry.title, uri, startedAt: entry.startedAt });
    notify({
      kind: 'recordingStarted',
      title: 'Enregistrement en cours',
      body: entry.title,
      tag: `dvr-start-${id}`,
    });
    return {
      id,
      title: entry.title,
      uri,
      fileName,
      startedAt: entry.startedAt,
      durationMs: entry.durationMs,
    };
  };

  const tickScheduler = () => {
    const now = Date.now();
    const state = stateStore.get();
    const schedules = state.schedules || [];
    const reminders = state.reminders || [];
    const delivered = (state.deliveredReminders || []).filter((rem) => Number.isFinite(rem?.startTime) && now - rem.startTime <= 90_000);
    const deliveredKeys = new Set(delivered.map((rem) => JSON.stringify([rem.id, rem.startTime])));

    if (schedules.length) {
      const remaining = [];
      let changed = false;

      for (const sched of schedules) {
        const endMs = sched.startTimeMs + sched.durationMs;
        if (endMs <= now) {
          changed = true;
          continue;
        }
        if (sched.startTimeMs <= now) {
          const remainingMs = Math.max(1, endMs - now);
          changed = true;
          try {
            startRecording({
              url: sched.url,
              title: sched.title,
              userAgent: sched.userAgent,
              durationMs: remainingMs,
              scheduleId: sched.id,
            });
          } catch {
            /* skip invalid scheduled stream */
          }
          continue;
        }
        remaining.push(sched);
      }

      if (changed) {
        stateStore.update((s) => ({ ...s, schedules: remaining }));
      }
    }

    if (reminders.length) {
      const nextReminders = [];
      const triggered = [];
      let remChanged = false;
      for (const rem of reminders) {
        if (!Number.isFinite(rem?.startTime)) {
          remChanged = true;
          continue;
        }
        if (rem.startTime <= now) {
          remChanged = true;
          const key = JSON.stringify([rem.id, rem.startTime]);
          if (now - rem.startTime <= 90_000 && !deliveredKeys.has(key)) {
            triggered.push(rem);
            delivered.push({ id: rem.id, startTime: rem.startTime });
            deliveredKeys.add(key);
          }
          continue;
        }
        nextReminders.push(rem);
      }
      if (remChanged) {
        // La resynchronisation du navigateur peut renvoyer le rappel avant sa purge IndexedDB.
        stateStore.update((s) => ({ ...s, reminders: nextReminders, deliveredReminders: delivered }));
      }
      for (const rem of triggered) {
        emitEvent?.('reminderTriggered', rem);
        notify({
          kind: 'reminder',
          title: rem.channelName || 'Rappel programme',
          body: `${rem.title || 'Émission'} commence`,
          channelId: rem.channelId,
          tag: `rem-${rem.id}`,
        });
      }
    }
  };

  const startScheduler = () => {
    if (schedulerTimer) return;
    schedulerTimer = setInterval(tickScheduler, 2000);
    tickScheduler();
  };

  const stopAll = async () => {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    const ids = [...activeRecordings.keys()];
    await Promise.all(ids.map((id) => stopRecordingById(id)));
    await Promise.all(pendingNotifications);
  };

  const listActive = () => [...activeRecordings.values()].map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    uri: r.uri,
    fileName: r.fileName,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
  }));

  const handleRoutes = async (req, res, urlObj) => {
    if (urlObj.pathname === '/api/desktop/local/folders' && req.method === 'GET') {
      sendJson(res, 200, { folders: stateStore.get().localFolders });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/local/pick' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const chosen = body.path ? path.resolve(String(body.path)) : await pickWindowsFolder('Choisir un dossier de vidéos');
      if (!chosen || !existsSync(chosen)) {
        sendJson(res, 200, { folder: null });
        return true;
      }
      const folder = { uri: pathToLocalUri(chosen), name: folderDisplayName(chosen) };
      stateStore.update((s) => {
        const filtered = (s.localFolders || []).filter((f) => f.uri !== folder.uri);
        return { ...s, localFolders: [...filtered, folder] };
      });
      sendJson(res, 200, { folder });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/local/remove' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const uri = String(body.uri || '');
      stateStore.update((s) => ({
        ...s,
        localFolders: (s.localFolders || []).filter((f) => f.uri !== uri),
      }));
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/local/scan' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const targetUri = body.uri ? String(body.uri) : '';
      const folders = targetUri
        ? stateStore.get().localFolders.filter((f) => f.uri === targetUri)
        : stateStore.get().localFolders;

      const allFiles = [];
      const seen = new Set();
      let truncated = false;
      for (const f of folders) {
        const dir = localUriToPath(f.uri);
        if (!dir || !existsSync(dir)) continue;
        const { files, truncated: folderTrunc } = scanMediaFolder(dir, { limit: MAX_SCAN_FILES - allFiles.length });
        if (folderTrunc) truncated = true;
        for (const item of files) {
          if (seen.has(item.uri)) continue;
          seen.add(item.uri);
          allFiles.push(item);
        }
        if (allFiles.length >= MAX_SCAN_FILES) {
          truncated = true;
          break;
        }
      }
      sendJson(res, 200, { files: allFiles, truncated });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/local/file' && (req.method === 'GET' || req.method === 'HEAD')) {
      const uri = urlObj.searchParams.get('uri') || '';
      const filePath = resolveLocalPath(uri);
      if (!filePath) {
        sendJson(res, 404, { error: 'Fichier local introuvable ou non autorisé.' });
        return true;
      }
      const stat = statSync(filePath);
      const total = stat.size;
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
        if (!match) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          res.end();
          return true;
        }
        const isSuffix = !match[1];
        const suffixLength = Number(match[2] || 0);
        const start = isSuffix ? Math.max(0, total - suffixLength) : Number(match[1]);
        const end = isSuffix || !match[2] ? total - 1 : Math.min(total - 1, Number(match[2]));
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
          || (isSuffix && (!Number.isSafeInteger(suffixLength) || suffixLength <= 0))
          || start >= total || start > end || start < 0) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          res.end();
          return true;
        }
        res.writeHead(206, {
          'Content-Type': contentType,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') {
          res.end();
          return true;
        }
        createReadStream(filePath, { start, end }).pipe(res);
        return true;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      createReadStream(filePath).pipe(res);
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/folder' && req.method === 'GET') {
      const folder = ensureDefaultRecordingsFolder();
      sendJson(res, 200, { folder });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/pick-folder' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const chosen = body.path ? path.resolve(String(body.path)) : await pickWindowsFolder('Choisir le dossier des enregistrements DVR');
      if (!chosen || !existsSync(chosen)) {
        sendJson(res, 200, { folder: null });
        return true;
      }
      const folder = { uri: pathToLocalUri(chosen), name: folderDisplayName(chosen) };
      stateStore.update((s) => ({ ...s, recordingsFolder: folder }));
      sendJson(res, 200, { folder });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/list' && req.method === 'GET') {
      const folder = ensureDefaultRecordingsFolder();
      const dir = localUriToPath(folder.uri);
      const { files } = dir && existsSync(dir) ? scanMediaFolder(dir, { recursive: false }) : { files: [] };
      sendJson(res, 200, { files });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/delete' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const uri = String(body.uri || '');
      const recFolder = stateStore.get().recordingsFolder?.uri ? localUriToPath(stateStore.get().recordingsFolder.uri) : null;
      const filePath = localUriToPath(uri);
      if (!recFolder || !filePath || !isSameOrSubPath(filePath, recFolder) || !existsSync(filePath)) {
        sendJson(res, 404, { error: 'Enregistrement introuvable.' });
        return true;
      }
      unlinkSync(filePath);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const started = startRecording({
          url: body.url,
          title: body.title,
          userAgent: body.userAgent,
          durationMs: body.durationMs,
        });
        sendJson(res, 200, { recording: started });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || 'Impossible de démarrer l’enregistrement.' });
      }
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/stop' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const ok = await stopRecordingById(String(body.id || ''));
      sendJson(res, 200, { ok });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/active' && req.method === 'GET') {
      sendJson(res, 200, { recordings: listActive() });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/schedule' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { url, title, startTimeMs, durationMs, userAgent } = body;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || !Number.isFinite(startTimeMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
        sendJson(res, 400, { error: 'Paramètres de programmation invalides.' });
        return true;
      }
      if (startTimeMs + durationMs <= Date.now()) {
        sendJson(res, 400, { error: 'La date programmée est déjà passée.' });
        return true;
      }
      const entry = {
        id: `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        url,
        title: String(title || 'Enregistrement'),
        startTimeMs: Number(startTimeMs),
        durationMs: Number(durationMs),
        ...(userAgent ? { userAgent: String(userAgent) } : {}),
      };
      stateStore.update((s) => ({
        ...s,
        schedules: [...(s.schedules || []), entry],
      }));
      sendJson(res, 200, { schedule: entry });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/schedules' && req.method === 'GET') {
      sendJson(res, 200, { schedules: stateStore.get().schedules || [] });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/recordings/cancel' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const id = String(body.id || '');
      stateStore.update((s) => ({
        ...s,
        schedules: (s.schedules || []).filter((item) => item.id !== id),
      }));
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/reminders/sync' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.reminders)) {
        sendJson(res, 400, { error: 'Liste reminders invalide.' });
        return true;
      }
      const normalized = body.reminders
        .filter((item) => item && typeof item.id === 'string' && typeof item.channelId === 'string'
          && typeof item.channelName === 'string' && typeof item.title === 'string' && Number.isFinite(item.startTime))
        .map((item) => ({
          id: item.id.slice(0, 128),
          channelId: item.channelId.slice(0, 128),
          channelName: item.channelName.slice(0, 160),
          title: item.title.slice(0, 200),
          startTime: Number(item.startTime),
        }));
      stateStore.update((s) => ({ ...s, reminders: normalized }));
      tickScheduler();
      sendJson(res, 200, { ok: true, count: normalized.length });
      return true;
    }

    if (urlObj.pathname === '/api/desktop/reminders' && req.method === 'GET') {
      sendJson(res, 200, { reminders: stateStore.get().reminders || [] });
      return true;
    }

    return false;
  };

  return {
    resolveLocalPath,
    startRecording,
    stopRecordingById,
    listActive,
    hasBackgroundWork,
    startScheduler,
    stopAll,
    handleRoutes,
  };
}
