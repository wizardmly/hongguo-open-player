const { test } = require('node:test');
const assert = require('node:assert/strict');
const StreamService = require('../../src/server/services/streamService').constructor;

test('cache prunes to a byte budget and prefetch coalesces browser probes', () => {
  const service = new StreamService();
  service.maxCacheBytes = 10;
  service.cache.set('1:auto', { size: 6, timestamp: 1 });
  service.cache.set('2:auto', { size: 6, timestamp: 2 });
  service.cache.set('3:auto', { size: 6, timestamp: 3 });
  service.pruneCache();
  assert.deepEqual([...service.cache.keys()], ['3:auto']);
  service.prefetch('3');
  assert.equal(service.prefetchTimers.size, 0);
  for (let i = 0; i < 20; i++) service.prefetch('4');
  assert.equal(service.prefetchTimers.size, 1);
  service.prefetch('5'); service.prefetch('6');
  assert.deepEqual([...service.prefetchTimers.keys()], ['6:auto']);
  service.shutdown();
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('prefetch downloads and caches at most three episodes in order, retrying after a busy stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = new StreamService();
  t.after(() => service.shutdown());
  const loaded = [];
  service.loadBuffer = async vid => {
    loaded.push(vid);
    const buffer = Buffer.from(vid);
    service.cache.set(`${vid}:auto`, { buffer, size: buffer.length });
    return buffer;
  };
  service.activeStreams = 1;
  service.prefetch('1', 'auto', ['1', 'invalid', '2', '3', '4']);
  t.mock.timers.tick(4000);
  await tick();
  assert.deepEqual(loaded, []);
  assert.equal(service.prefetchTimers.size, 3);
  service.activeStreams = 0;
  t.mock.timers.tick(1000);
  await tick();
  assert.deepEqual(loaded, ['1', '2', '3']);
  assert.equal(service.cache.size, 3);
  assert.equal(service.inFlight.size, 0);
  service.prefetch('1', 'auto', ['2', '3']);
  assert.equal(service.prefetchTimers.size, 0);
});

test('changing prefetch window cancels obsolete work and prioritizes imminent episodes within the cache budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = new StreamService();
  t.after(() => service.shutdown());
  const loaded = [];
  service.loadBuffer = (vid, quality, signal) => {
    loaded.push(vid);
    if (vid === '1') return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    return Promise.resolve(Buffer.from(vid));
  };
  service.prefetch('1', 'auto', ['2', '3']);
  t.mock.timers.tick(4000);
  await tick();
  service.prefetch('7', 'auto', ['8', '9']);
  await tick();
  t.mock.timers.tick(4000);
  await tick();
  assert.deepEqual(loaded, ['1', '7', '8', '9']);
  service.maxCacheBytes = 10;
  for (const key of ['7:auto', '8:auto', '9:auto', '6:auto']) service.cache.set(key, { size: 6 });
  service.pruneCache();
  assert.deepEqual([...service.cache.keys()], ['7:auto']);
});

test('prefetch continues after an episode fails and shutdown cancels pending timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = new StreamService();
  t.after(() => service.shutdown());
  const loaded = [];
  service.loadBuffer = async vid => {
    loaded.push(vid);
    if (vid === '1') throw new Error('unavailable');
    return Buffer.from(vid);
  };
  service.prefetch('1', 'auto', ['2', '3']);
  t.mock.timers.tick(4000);
  await tick();
  assert.deepEqual(loaded, ['1', '2', '3']);
  service.prefetch('7', 'auto', ['8']);
  service.shutdown();
  t.mock.timers.tick(4000);
  await tick();
  assert.deepEqual(loaded, ['1', '2', '3']);
});
