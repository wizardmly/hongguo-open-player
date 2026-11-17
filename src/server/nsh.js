// SPDX-License-Identifier: GPL-3.0-only
// NSH's native video view consumes the same playback engine through an owned
// loopback process. The URL capability stays inside this application instance.
const express = require('express');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const drama = require('./services/dramaService');
const streams = require('./services/streamService');
const { transcodeBytevc2 } = require('./native/bytevc2-transcode');
const { shutdownPlaybackSigner } = require('./native/playback-signer');
const { fetchDanmaku } = require('./native/danmaku');
const logger = require('./services/logger');

function createNshBackend() {
  const encoderArgs = ['-maxrate', '3M', '-bufsize', '6M'];
  streams.transcode = (buffer, key, signal) => transcodeBytevc2(buffer, key, signal, { encoderArgs });
  const app = express();
  const token = randomBytes(32).toString('hex');
  const preparing = new Map();
  const compatibleBuffers = new WeakSet();
  const active = new Set();
  let useHardware = process.platform === 'win32';

  async function convertHevc(buffer, signal) {
    const started = Date.now();
    let converted;
    try {
      converted = await transcodeBytevc2(buffer, Buffer.alloc(0), signal, {
        executable: process.env.HONGGUO_NSH_FFMPEG, encoderArgs, hardware: useHardware,
      });
    } catch (error) {
      if (!useHardware || signal.aborted) throw error;
      useHardware = false;
      logger.info('NSH', '硬件转码不可用，改用软件转码');
      converted = await transcodeBytevc2(buffer, Buffer.alloc(0), signal, {
        executable: process.env.HONGGUO_NSH_FFMPEG, encoderArgs,
      });
    }
    logger.info('NSH', `${useHardware ? '硬件' : '软件'}转换完成: 耗时=${Date.now() - started}ms`);
    return converted;
  }
  app.use((req, res, next) => {
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expectedHost || req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') {
      return res.sendStatus(403);
    }
    res.set('Cache-Control', 'no-store');
    next();
  });
  const router = express.Router();
  router.use(express.json({ limit: '8kb' }));
  router.get('/catalog', async (req, res) => res.json(await drama.catalog({ category: req.query.category, page: req.query.page })));
  router.get('/search', async (req, res) => res.json(await drama.search(req.query.keyword, req.query.page)));
  router.get('/series/:id', async (req, res) => res.json(await drama.getSeriesDetail(req.params.id)));
  router.get('/actors/ranking', async (req, res) => res.json(await drama.getActorRankings({ gender: req.query.gender, page: req.query.page })));
  router.get('/actors/:id', async (req, res) => {
    const [detail, firstWorks] = await Promise.all([
      drama.getActorDetail(req.params.id), drama.getActorWorks(req.params.id, { count: 50, offset: 0 }),
    ]);
    const works = [...firstWorks.works];
    const ids = new Set(works.map(item => item.series_id));
    let more = firstWorks.has_more;
    while (more && works.length < 2500) {
      const page = await drama.getActorWorks(req.params.id, { count: 50, offset: works.length });
      const fresh = page.works.filter(item => !ids.has(item.series_id));
      if (!fresh.length) break;
      for (const item of fresh) ids.add(item.series_id);
      works.push(...fresh);
      more = page.has_more;
    }
    res.json({ ...detail, works });
  });
  router.get('/danmaku/:seriesId/:vid', async (req, res) => res.json(await fetchDanmaku({ seriesId: req.params.seriesId, vid: req.params.vid })));

  async function prepare(vid, signal) {
    if (!/^\d{1,30}$/.test(vid)) throw Object.assign(new Error('分集编号无效'), { status: 400 });
    signal.throwIfAborted();
    const key = `${vid}:auto`;
    const existingBuffer = streams.cache.get(key)?.buffer;
    if (existingBuffer && compatibleBuffers.has(existingBuffer)) return existingBuffer;
    let job = preparing.get(vid);
    if (job?.controller.signal.aborted) job = null;
    if (!job) {
      const controller = new AbortController();
      job = { controller, waiters: 0 };
      job.promise = (async () => {
        let buffer = await streams.getDecryptedBuffer(vid, 'auto', { signal: controller.signal });
        // Media Foundation does not include HEVC on every Windows install.
        // The existing FFmpeg path accepts clear MP4 as well as ByteVC2.
        if (buffer.includes(Buffer.from('hvc1')) || buffer.includes(Buffer.from('hev1'))) {
          try {
            buffer = await convertHevc(buffer, controller.signal);
          } catch (error) {
            if (!controller.signal.aborted) error.message = '本集视频转换失败，请重试本集';
            throw error;
          }
          streams.cache.set(key, { buffer, size: buffer.length });
          streams.pruneCache();
        }
        compatibleBuffers.add(buffer);
        return buffer;
      })().finally(() => { if (preparing.get(vid) === job) preparing.delete(vid); });
      preparing.set(vid, job);
    }
    job.waiters++;
    let onAbort;
    return new Promise((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      job.promise.then(resolve, reject);
    }).finally(() => {
      signal.removeEventListener('abort', onAbort);
      job.waiters--;
      if (!job.waiters && preparing.get(vid) === job) job.controller.abort(new Error('Playback request cancelled'));
    });
  }

  function requestSignal(req, res) {
    const controller = new AbortController();
    active.add(controller);
    res.once('close', () => { active.delete(controller); if (!res.writableEnded) controller.abort(new Error('Client closed')); });
    return controller.signal;
  }

  router.post('/prepare/:vid', async (req, res) => {
    if (req.body?.refresh === true) {
      streams.cache.delete(`${req.params.vid}:auto`);
      require('./native/app-source').clearEntryCache(req.params.vid);
    }
    const buffer = await prepare(req.params.vid, requestSignal(req, res));
    res.json({ sizeBytes: buffer.length, path: `/media/${req.params.vid}` });
  });
  router.get('/media/:vid', async (req, res) => {
    await prepare(req.params.vid, requestSignal(req, res));
    return streams.handleBufferedStream(req, res, req.params.vid);
  });
  app.use(`/${token}`, router);
  app.use((_req, res) => res.sendStatus(404));
  app.use((error, req, res, _next) => {
    logger.error('NSH', `${error.code || 'REQUEST_FAILED'} ${error.message}`, error.detail?.replace(/[\x00-\x08\x0e-\x1f]/g, '').slice(0,2000));
    if (!res.headersSent && !res.destroyed) res.status(error.status >= 400 && error.status < 600 ? error.status : 500).json({ error: error.message || '片源服务暂不可用' });
  });
  const server = http.createServer(app);
  return {
    async start() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      return { port: server.address().port, token };
    },
    async stop() {
      for (const controller of active) controller.abort(new Error('Player closed'));
      for (const job of preparing.values()) job.controller.abort(new Error('Player closed'));
      streams.shutdown();
      server.close();
      server.closeAllConnections?.();
      await shutdownPlaybackSigner();
    },
  };
}

if (require.main === module) {
  const backend = createNshBackend();
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await backend.stop();
    process.exit(0);
  };
  process.stdin.resume();
  process.stdin.once('end', close);
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  backend.start().then(info => process.stdout.write(`NSH_BACKEND_READY ${JSON.stringify(info)}\n`)).catch(() => process.exit(1));
}

module.exports = { createNshBackend };
