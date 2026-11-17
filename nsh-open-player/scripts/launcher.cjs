// SPDX-License-Identifier: GPL-3.0-only
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const data = path.join(process.env.APPDATA || require('node:os').homedir(), 'dev.openplayer.hongguo.nsh');
fs.mkdirSync(path.join(data, 'logs'), { recursive: true });
const log = fs.openSync(path.join(data, 'logs/launcher.log'), 'a');
const backend = spawn(process.execPath, [path.join(__dirname, 'launch.cjs'), data], { windowsHide: true, stdio: ['pipe', 'pipe', log] });
let window;
let started = false;
let output = '';
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  backend.stdin.end();
  window?.kill();
  const timeout = setTimeout(() => { backend.kill(); process.exit(code); }, 2000);
  timeout.unref();
  backend.once('close', () => process.exit(code));
  if (backend.exitCode !== null) process.exit(code);
}
const timer = setTimeout(() => close(1), 20000);
backend.on('error', () => close(1));
backend.on('close', () => close(window ? 0 : 1));
backend.stdout.on('data', chunk => {
  output = (output + chunk.toString('utf8')).slice(-8192);
  const match = output.match(/NSH_BACKEND_READY (\{[^\r\n]+\})/);
  if (started || !match) return;
  started = true;
  clearTimeout(timer);
  window = spawn(path.join(root, 'nsh-player.exe'), [], {
    cwd: root,
    env: { ...process.env, HONGGUO_NSH_BACKEND: match[1] },
    stdio: ['ignore', log, log],
  });
  window.once('error', () => close(1));
  window.once('close', code => close(code || 0));
});
process.once('SIGTERM', () => close());
process.once('SIGINT', () => close());
