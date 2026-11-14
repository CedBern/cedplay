import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { APP_USER_MODEL_ID } from '../electron-runtime.mjs';
import { prepare, RUNTIME_FILES, validateWebDist } from './prepare.mjs';

test('Windows staging excludes repository secrets, profiles, fixtures and web dependencies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cedplay-package-'));
  try {
    const buildDir = path.join(root, 'desktop', 'windows');
    const ffmpegDir = path.join(root, 'external-binaries');
    for (const dir of [buildDir, ffmpegDir, path.join(root, 'application', 'dist'), path.join(buildDir, 'licenses')]) await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'application', 'package.json'), JSON.stringify({ version: '1.12.64', dependencies: { secretDependency: '1' } }));
    await writeFile(path.join(buildDir, 'package.json'), JSON.stringify({ version: '1.12.64', devDependencies: { electron: '45.3.2' } }));
    await writeFile(path.join(root, 'application', 'dist', 'index.html'), '<html>public</html>');
    for (const name of RUNTIME_FILES) await writeFile(path.join(root, 'desktop', name), 'runtime');
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) await writeFile(path.join(ffmpegDir, name), 'binary');
    for (const name of ['FFMPEG-NOTICE.md', 'GPL-3.0.txt']) await writeFile(path.join(buildDir, 'licenses', name), 'license');
    for (const name of ['private-token.json', 'desktop-state.json', 'credentials.env', 'fixture.mkv', 'local.test.mjs']) await writeFile(path.join(root, 'desktop', name), 'PRIVATE');
    await mkdir(path.join(root, 'application', 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'application', 'node_modules', 'secret.txt'), 'PRIVATE');
    const manifest = await prepare({ repoRoot: root, buildDir, ffmpegDir });
    assert.equal(manifest.binaries.length, 2);
    const stagedDesktop = await readdir(path.join(buildDir, 'stage', 'app', 'desktop'));
    assert.deepEqual(stagedDesktop.sort(), [...RUNTIME_FILES].sort());
    const appPackage = JSON.parse(await readFile(path.join(buildDir, 'stage', 'app', 'package.json'), 'utf8'));
    assert.equal(appPackage.dependencies, undefined);
    assert.equal(appPackage.main, 'desktop/electron-main.cjs');
    assert.deepEqual(await readdir(path.join(buildDir, 'stage', 'app', 'application')), ['dist']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('media fixtures and accidental private file types in dist block packaging', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cedplay-package-assets-'));
  try {
    await writeFile(path.join(root, 'index.html'), '<html/>');
    for (const name of ['fixture.mp4', '.env', 'key.keystore']) {
      await writeFile(path.join(root, name), 'private or heavy');
      await assert.rejects(validateWebDist(root), /Unexpected web distribution file/);
      await rm(path.join(root, name));
    }
    assert.deepEqual(await validateWebDist(root), ['index.html']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows identity: shortcut AUMID, signing policy and exe metadata stay consistent', async () => {
  const require = createRequire(import.meta.url);
  const config = require('./electron-builder.cjs');
  // L'installateur grave appId dans les raccourcis ; la fenêtre doit déclarer le même
  // identifiant, sinon l'icône épinglée et la fenêtre ouverte se dédoublent.
  assert.equal(config.appId, APP_USER_MODEL_ID);
  // signAndEditExecutable: false laisserait l'icône et le nom « Electron » sur CedPlay.exe.
  assert.notEqual(config.win.signAndEditExecutable, false);
  assert.equal(config.win.signExecutable, false);
  assert.equal(config.productName, 'CedPlay');
  const icon = await readFile(new URL(config.win.icon, new URL('./', import.meta.url)));
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
});
