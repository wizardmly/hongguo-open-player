const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNshBackend } = require('../../src/server/nsh');
const streams = require('../../src/server/services/streamService');

test('NSH backend requires its per-process URL capability and serves prepared media ranges', async t => {
  const backend = createNshBackend();
  const original = streams.getDecryptedBuffer;
  const buffer = Buffer.alloc(2048, 7);
  let loads = 0;
  streams.getDecryptedBuffer = async vid => {
    loads++;
    streams.cache.set(`${vid}:auto`, { buffer, size: buffer.length });
    return buffer;
  };
  t.after(async () => { streams.getDecryptedBuffer = original; streams.cache.clear(); await backend.stop(); });
  const { port, token } = await backend.start();
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base + '/invalid/catalog')).status, 404);
  assert.equal((await fetch(base + `/${token}/catalog`, { headers: { Origin: 'https://example.com' } })).status, 403);
  const ready = await fetch(base + `/${token}/prepare/123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(ready.status, 200);
  const prepared = await ready.json();
  assert.equal(prepared.sizeBytes, buffer.length);
  const media = await fetch(base + `/${token}` + prepared.path, { headers: { Range: 'bytes=100-199' } });
  assert.equal(media.status, 206);
  assert.equal(media.headers.get('content-range'), 'bytes 100-199/2048');
  assert.equal((await media.arrayBuffer()).byteLength, 100);
  assert.equal(loads, 2, 'range serving reuses the existing playback engine');
  assert.equal((await fetch(base + `/${token}/prepare/invalid`, { method: 'POST' })).status, 400);
});

test('NSH falls back to software when hardware conversion is unavailable and reuses that choice', async t => {
  const transcoder = require('../../src/server/native/bytevc2-transcode');
  const modulePath = require.resolve('../../src/server/nsh');
  const originalModule = require.cache[modulePath];
  const originalTranscode = transcoder.transcodeBytevc2;
  const originalStreamTranscode = streams.transcode;
  const originalBuffer = streams.getDecryptedBuffer;
  const attempts = [];
  transcoder.transcodeBytevc2 = async (_buffer, _key, _signal, options) => {
    attempts.push(options.hardware === true);
    if (options.hardware) throw new Error('Hardware encoder unavailable');
    return Buffer.from('compatible video');
  };
  delete require.cache[modulePath];
  const backend = require(modulePath).createNshBackend();
  streams.getDecryptedBuffer = async () => Buffer.from('test HEVC sample entry hvc1');
  t.after(async () => {
    transcoder.transcodeBytevc2 = originalTranscode;
    streams.getDecryptedBuffer = originalBuffer;
    streams.transcode = originalStreamTranscode;
    require.cache[modulePath] = originalModule;
    await backend.stop();
  });
  const { port, token } = await backend.start();
  for (const vid of ['124', '125']) {
    const response = await fetch(`http://127.0.0.1:${port}/${token}/prepare/${vid}`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sizeBytes, Buffer.byteLength('compatible video'));
  }
  assert.deepEqual(attempts, process.platform === 'win32' ? [true, false, false] : [false, false]);
});
