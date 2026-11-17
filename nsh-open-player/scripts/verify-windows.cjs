// SPDX-License-Identifier: GPL-3.0-only
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = process.argv[2] || 'nsh';
const data = path.join(root, '.nsh/test/live-data');
fs.mkdirSync(data, { recursive: true });
const log = fs.openSync(path.join(data, 'backend-output.txt'), 'w');
const backend = spawn(process.execPath, [path.join(root, 'backend/launch.cjs'), data], { windowsHide: true, stdio: ['pipe', 'pipe', log] });
let runner;
let output = '';
let started = false;
backend.stdout.on('data', chunk => {
  output = (output + chunk.toString('utf8')).slice(-8192);
  const match = output.match(/NSH_BACKEND_READY (\{[^\r\n]+\})/);
  if (started || !match) return;
  started = true;
  runner = spawn(cli, ['test', 'Live.test.tsx', '--target', 'windows', '--verbose'], {
    cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, HONGGUO_NSH_BACKEND: match[1] },
  });
  runner.on('close', code => { process.exitCode = code || 0; backend.stdin.end(); });
  runner.on('error', () => { process.exitCode = 1; backend.stdin.end(); });
});
backend.on('close', () => { if (!started) process.exitCode = 1; });
process.once('SIGINT', () => { runner?.kill(); backend.kill(); });
