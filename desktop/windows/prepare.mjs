import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUILD_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(BUILD_DIR, '../..');
export const RUNTIME_FILES = [
  'config.mjs', 'ffmpeg.mjs', 'httpBridge.mjs', 'lanServers.mjs',
  'localAndDvr.mjs', 'notifications.mjs', 'server.mjs', 'cedplay.ico',
  'electron-main.cjs', 'electron-runtime.mjs',
];
const ALLOWED_WEB_EXTENSIONS = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg',
  '.webp', '.ico', '.woff', '.woff2', '.ttf', '.txt', '.webmanifest',
]);
const PUBLIC_PLAYLISTS = new Set(['default-playlist.m3u', 'demo-playlist.m3u', 'flux-legaux.m3u']);

export async function validateWebDist(directory) {
  const files = [];
  async function walk(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symbolic link excluded: ${file}`);
      if (item.isDirectory()) await walk(file);
      else {
        const relative = path.relative(directory, file);
        if (!ALLOWED_WEB_EXTENSIONS.has(path.extname(item.name).toLowerCase()) && !PUBLIC_PLAYLISTS.has(relative)) {
          throw new Error(`Unexpected web distribution file: ${file}`);
        }
        if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error(`Oversized web asset: ${file}`);
        files.push(path.relative(directory, file));
      }
    }
  }
  await walk(directory);
  if (!files.includes('index.html')) throw new Error('Build application/ first: dist/index.html missing');
  return files.sort();
}

export async function prepare({ repoRoot = REPO_ROOT, buildDir = BUILD_DIR, ffmpegDir = process.env.CEDPLAY_FFMPEG_DIR || path.join(os.homedir(), 'tools', 'ffmpeg') } = {}) {
  const stage = path.resolve(buildDir, 'stage');
  // Only this fixed, disposable staging directory may be replaced.
  if (path.dirname(stage) !== path.resolve(buildDir) || path.basename(stage) !== 'stage') throw new Error('Invalid staging path');
  const webDist = path.join(repoRoot, 'application', 'dist');
  const webFiles = await validateWebDist(webDist);
  const webPackage = JSON.parse(await readFile(path.join(repoRoot, 'application', 'package.json'), 'utf8'));
  const builderPackage = JSON.parse(await readFile(path.join(buildDir, 'package.json'), 'utf8'));
  if (webPackage.version !== builderPackage.version) throw new Error('Windows and application versions differ');
  const sources = RUNTIME_FILES.map(name => path.join(repoRoot, 'desktop', name));
  const binaries = ['ffmpeg.exe', 'ffprobe.exe'].map(name => path.join(ffmpegDir, name));
  for (const file of [...sources, ...binaries]) {
    if (!(await stat(file)).isFile()) throw new Error(`Required runtime file missing: ${file}`);
  }
  await rm(stage, { recursive: true, force: true });
  const app = path.join(stage, 'app');
  await mkdir(path.join(app, 'desktop'), { recursive: true });
  await mkdir(path.join(app, 'application'), { recursive: true });
  await mkdir(path.join(stage, 'bin'), { recursive: true });
  await mkdir(path.join(stage, 'licenses'), { recursive: true });
  await writeFile(path.join(app, 'package.json'), `${JSON.stringify({
    name: 'cedplay-desktop', version: webPackage.version, private: true,
    description: 'CedPlay Windows desktop player', author: 'CedPlay',
    type: 'module', main: 'desktop/electron-main.cjs',
  }, null, 2)}\n`);
  for (let i = 0; i < sources.length; i++) await cp(sources[i], path.join(app, 'desktop', RUNTIME_FILES[i]));
  await cp(webDist, path.join(app, 'application', 'dist'), { recursive: true });
  const binaryManifest = [];
  for (const source of binaries) {
    const target = path.join(stage, 'bin', path.basename(source));
    await cp(source, target);
    const bytes = await readFile(target);
    binaryManifest.push({ file: path.basename(target), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  for (const name of ['FFMPEG-NOTICE.md', 'GPL-3.0.txt']) {
    await cp(path.join(buildDir, 'licenses', name), path.join(stage, 'licenses', name));
  }
  const manifest = { version: webPackage.version, electron: builderPackage.devDependencies.electron, runtimeFiles: RUNTIME_FILES, webFiles, binaries: binaryManifest };
  await writeFile(path.join(stage, 'licenses', 'BUNDLED-RUNTIME.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared CedPlay ${webPackage.version}: ${RUNTIME_FILES.length} runtime files, ${webFiles.length} web assets, 2 media binaries`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await prepare();
}
