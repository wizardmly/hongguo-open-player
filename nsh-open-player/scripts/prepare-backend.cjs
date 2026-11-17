// SPDX-License-Identifier: GPL-3.0-only
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const repo = path.dirname(root);
const target = path.join(root, 'backend');
const mediaFfmpeg = process.env.HONGGUO_NSH_FFMPEG || path.join(repo, 'build/media-ffmpeg/x64/ffmpeg.exe');
if (!fs.existsSync(mediaFfmpeg)) throw new Error('Set HONGGUO_NSH_FFMPEG to a full FFmpeg build with HEVC decoding');
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(process.execPath, path.join(target, 'node.exe'));
fs.cpSync(path.join(repo, 'src/server'), path.join(target, 'src/server'), { recursive: true });
fs.copyFileSync(path.join(repo, 'package.json'), path.join(target, 'package.json'));
fs.mkdirSync(path.join(target, 'resources/media-ffmpeg'), { recursive: true });
fs.copyFileSync(mediaFfmpeg, path.join(target, 'resources/media-ffmpeg/ffmpeg.exe'));
const mediaLicense = path.join(path.dirname(mediaFfmpeg), 'FFmpeg-LICENSE.txt');
if (fs.existsSync(mediaLicense)) fs.copyFileSync(mediaLicense, path.join(target, 'resources/media-ffmpeg/FFmpeg-LICENSE.txt'));
const dependencies = spawnSync('cmd.exe', ['/d', '/c', 'npm ls --omit=dev --all --parseable'], { cwd: repo, encoding: 'utf8', windowsHide: true });
if (dependencies.status !== 0) throw new Error('Cannot resolve production dependencies');
for (const folder of dependencies.stdout.trim().split(/\r?\n/).slice(1)) {
  const relative = path.relative(repo, folder);
  if (!relative.startsWith('node_modules' + path.sep) || relative.includes('..')) throw new Error('Invalid dependency path');
  fs.cpSync(folder, path.join(target, relative), { recursive: true });
}
for (const [source, destination] of [
  ['build/bytevc2/x64', 'resources/bytevc2'], ['build/playback-signer/win32-x64', 'resources/playback-signer'],
]) {
  if (!fs.existsSync(path.join(repo, source))) throw new Error('Prepare runtime first: ' + source);
  fs.cpSync(path.join(repo, source), path.join(target, destination), { recursive: true });
}
fs.writeFileSync(path.join(target, 'launch.cjs'), `
const path = require('node:path');
const base = process.argv[2] || path.join(require('node:os').homedir(), 'AppData/Roaming/dev.openplayer.hongguo.nsh');
process.env.HONGGUO_DATA_DIR = path.join(base, 'backend-data');
process.env.HONGGUO_LOG_DIR = path.join(base, 'logs');
process.env.HONGGUO_BVC2_FFMPEG = path.join(__dirname, 'resources/bytevc2/ffmpeg.exe');
process.env.HONGGUO_NSH_FFMPEG = path.join(__dirname, 'resources/media-ffmpeg/ffmpeg.exe');
process.resourcesPath = path.join(__dirname, 'resources');
require('node:module').runMain(path.join(__dirname, 'src/server/nsh.js'));
`);
console.log('NSH backend prepared with shared server source, production dependencies, Node, signer and FFmpeg');
fs.copyFileSync(path.join(__dirname, 'launcher.cjs'), path.join(target, 'launcher.cjs'));
