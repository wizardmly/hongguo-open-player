// SPDX-License-Identifier: GPL-3.0-only
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = process.argv[2] || 'nsh';
const data = path.join(root, '.nsh/test/live-data');

function decodePngRgba(filePath) {
  const buf = fs.readFileSync(filePath);
  let off = 8, w = 0, h = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = chunk.readUInt32BE(0); h = chunk.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(chunk);
    off += 12 + len;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const rowBytes = w * bpp;
  const stride = rowBytes + 1;
  const pixels = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const filter = inflated[y * stride];
    const srcOff = y * stride + 1;
    const dstOff = y * rowBytes;
    const prevOff = (y - 1) * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = inflated[srcOff + i];
      const a = i >= bpp ? pixels[dstOff + i - bpp] : 0;
      const b = y > 0 ? pixels[prevOff + i] : 0;
      const c = y > 0 && i >= bpp ? pixels[prevOff + i - bpp] : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 0xff;
      else if (filter === 2) val = (x + b) & 0xff;
      else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (x + pr) & 0xff;
      }
      pixels[dstOff + i] = val;
    }
  }
  return { w, h, pixels };
}

function assertSwitchedVideoFramesMoved() {
  const a = decodePngRgba(path.join(root, '.nsh/test/hongguo-ep2-frame-a.png'));
  const b = decodePngRgba(path.join(root, '.nsh/test/hongguo-ep2-frame-b.png'));
  const rowBytes = a.w * 4;
  let diff = 0;
  // Sample lower-middle video stage region (excluding top danmaku rows and bottom 84px transport bar)
  for (let y = Math.floor(a.h * 0.45); y < Math.floor(a.h * 0.78); y++) {
    const rowOff = y * rowBytes;
    for (let x = Math.floor(a.w * 0.12); x < Math.floor(a.w * 0.58); x++) {
      for (let c = 0; c < 3; c++) {
        if (Math.abs(a.pixels[rowOff + x * 4 + c] - b.pixels[rowOff + x * 4 + c]) > 6) diff++;
      }
    }
  }
  console.log(`NSH_PLAYBACK_TIMING ep2_video_pixel_diff=${diff}`);
  if (diff < 20000) {
    throw new Error(`Switched episode video frame appears frozen (pixel diff=${diff})`);
  }

  for (const shot of [
    'switch-1-to-2-15ms.png',
    'switch-1-to-2-80ms.png',
    'switch-2-to-1-20ms.png',
    'switch-1-to-3-40ms.png',
  ]) {
    const img = decodePngRgba(path.join(root, '.nsh/test', shot));
    const st = img.w * 4;
    let sum = 0;
    let count = 0;
    for (let y = Math.floor(img.h * 0.25); y < Math.floor(img.h * 0.78); y += 2) {
      const rowOff = y * st;
      // Center vertical portrait column of the left video stage (`w * 0.22 .. w * 0.44`)
      for (let x = Math.floor(img.w * 0.22); x < Math.floor(img.w * 0.44); x += 2) {
        const r = img.pixels[rowOff + x * 4];
        const g = img.pixels[rowOff + x * 4 + 1];
        const bl = img.pixels[rowOff + x * 4 + 2];
        sum += 0.299 * r + 0.587 * g + 0.114 * bl;
        count++;
      }
    }
    const avgLuma = sum / Math.max(1, count);
    console.log(`NSH_SWITCH_LUMA ${shot}=${avgLuma.toFixed(2)}`);
    if (avgLuma < 8) {
      throw new Error(`Black frame detected during episode switch in ${shot} (avgLuma=${avgLuma.toFixed(2)})`);
    }
  }
}

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
  runner.on('close', code => {
    try {
      if (!code) assertSwitchedVideoFramesMoved();
      process.exitCode = code || 0;
    } catch (err) {
      console.error(err.message || err);
      process.exitCode = 1;
    }
    backend.stdin.end();
  });
  runner.on('error', () => { process.exitCode = 1; backend.stdin.end(); });
});
backend.on('close', () => { if (!started) process.exitCode = 1; });
process.once('SIGINT', () => { runner?.kill(); backend.kill(); });
