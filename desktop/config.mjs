import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(THIS_DIR, '..');
export const DIST_DIR = path.join(REPO_ROOT, 'application', 'dist');
export const DEFAULT_DESKTOP_PORT = Number(process.env.CEDPLAY_DESKTOP_PORT || 4178);

export function getDataDir() {
  if (process.env.CEDPLAY_DATA_DIR) return path.resolve(process.env.CEDPLAY_DATA_DIR);
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'CedPlay', 'desktop');
}

export function getDefaultRecordingsDir() {
  return path.join(os.homedir(), 'Videos', 'CedPlay');
}

export function resolveBinary(explicitEnv, candidates) {
  const envVal = explicitEnv ? process.env[explicitEnv] : undefined;
  if (envVal && existsSync(envVal)) return envVal;
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function getFfmpegPath() {
  return resolveBinary('FFMPEG_PATH', [
    'C:\\Users\\C2k\\tools\\ffmpeg\\ffmpeg.exe',
    path.join(os.homedir(), 'tools', 'ffmpeg', 'ffmpeg.exe'),
  ]) || 'ffmpeg';
}

export function getFfprobePath() {
  return resolveBinary('FFPROBE_PATH', [
    'C:\\Users\\C2k\\tools\\ffmpeg\\ffprobe.exe',
    path.join(os.homedir(), 'tools', 'ffmpeg', 'ffprobe.exe'),
  ]) || 'ffprobe';
}

export function hasBinary(binPath) {
  if (path.isAbsolute(binPath) && !existsSync(binPath)) return false;
  const result = spawnSync(binPath, ['-version'], { timeout: 2000, stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

const DEFAULT_STATE = {
  localFolders: [],
  recordingsFolder: null,
  schedules: [],
  reminders: [],
  deliveredReminders: [],
  playerOptions: {
    userAgent: '',
    bufferMode: 'normal',
    decoder: 'auto',
    afr: false,
  },
};

export function createStateStore(dataDir = getDataDir()) {
  mkdirSync(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'desktop-state.json');

  const load = () => {
    try {
      const raw = readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        localFolders: Array.isArray(parsed.localFolders) ? parsed.localFolders : [],
        recordingsFolder: parsed.recordingsFolder && typeof parsed.recordingsFolder.uri === 'string'
          ? parsed.recordingsFolder
          : null,
        schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        deliveredReminders: Array.isArray(parsed.deliveredReminders) ? parsed.deliveredReminders : [],
        playerOptions: {
          ...DEFAULT_STATE.playerOptions,
          ...(parsed.playerOptions && typeof parsed.playerOptions === 'object' ? parsed.playerOptions : {}),
        },
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  };

  let state = load();

  const save = () => {
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    renameSync(tmp, statePath);
  };

  return {
    dataDir,
    statePath,
    get() {
      return state;
    },
    update(mutator) {
      const next = mutator(state);
      if (next && next !== state) state = next;
      save();
      return state;
    },
    reload() {
      state = load();
      return state;
    },
  };
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export async function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
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
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON object');
    return parsed;
  } catch {
    const err = new Error('Invalid JSON');
    err.statusCode = 400;
    throw err;
  }
}
