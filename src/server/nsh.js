// SPDX-License-Identifier: GPL-3.0-only
// NSH's native video view consumes the same playback engine through an owned
// loopback process. The URL capability stays inside this application instance.
const express = require('express');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const drama = require('./services/dramaService');
const streams = require('./services/streamService');
const { transcodeBytevc2 } = require('./native/bytevc2-transcode');
const { shutdownPlaybackSigner } = require('./native/playback-signer');
const { fetchDanmaku } = require('./native/danmaku');
const logger = require('./services/logger');

const MAX_DISK_CACHE_BYTES = 600 * 1024 * 1024;

function createNshBackend() {
  const encoderArgs = ['-maxrate', '3M', '-bufsize', '6M'];
  streams.transcode = (buffer, key, signal) => transcodeBytevc2(buffer, key, signal, { encoderArgs });
  const diskCacheDir = process.env.HONGGUO_DATA_DIR
    ? path.join(process.env.HONGGUO_DATA_DIR, 'media-cache')
    : null;
  // When disk cache is enabled (600 MB LRU), Windows plays local `filePath` directly from disk,
  // so keep Node's in-memory `streams.cache` minimal instead of pinning 384 MB in RAM.
  streams.maxCacheBytes = diskCacheDir
    ? (process.platform === 'win32' ? 24 * 1024 * 1024 : 64 * 1024 * 1024)
    : 256 * 1024 * 1024;
  streams.maxCacheCount = diskCacheDir ? (process.platform === 'win32' ? 1 : 4) : 24;
  const app = express();
  const token = randomBytes(32).toString('hex');
  const preparing = new Map();
  const compatibleBuffers = new WeakSet();
  const active = new Set();
  let useHardware = process.platform === 'win32';
  let diskPruneRunning = false;

  async function statDiskCache(vid) {
    if (!diskCacheDir) return null;
    const file = path.join(diskCacheDir, `${vid}.mp4`);
    try {
      const st = await fs.stat(file);
      if (st.size < 1024) return null;
      const now = new Date();
      void fs.utimes(file, now, now).catch(() => {});
      return { sizeBytes: st.size, filePath: file };
    } catch {
      return null;
    }
  }

  async function readDiskCache(vid) {
    if (!diskCacheDir) return null;
    const file = path.join(diskCacheDir, `${vid}.mp4`);
    try {
      const buf = await fs.readFile(file);
      if (buf.length < 1024) return null;
      const now = new Date();
      void fs.utimes(file, now, now).catch(() => {});
      return { buffer: buf, sizeBytes: buf.length, filePath: file };
    } catch {
      return null;
    }
  }

  async function resolveDiskCachePath(vid, buffer) {
    if (!diskCacheDir) return null;
    const file = path.join(diskCacheDir, `${vid}.mp4`);
    try {
      const st = await fs.stat(file);
      if (st.size >= 1024) return file;
    } catch {
      // Missing on disk — write it now
    }
    return writeDiskCache(vid, buffer);
  }

  async function writeDiskCache(vid, buffer) {
    if (!diskCacheDir || !buffer?.length) return null;
    try {
      await fs.mkdir(diskCacheDir, { recursive: true });
      const tmp = path.join(diskCacheDir, `${vid}.${process.pid}.${Date.now()}.tmp`);
      const target = path.join(diskCacheDir, `${vid}.mp4`);
      await fs.writeFile(tmp, buffer, { mode: 0o600 });
      await fs.rename(tmp, target);
      if (!diskPruneRunning) {
        diskPruneRunning = true;
        setImmediate(async () => {
          try {
            const names = await fs.readdir(diskCacheDir);
            const entries = [];
            let total = 0;
            for (const name of names) {
              if (!name.endsWith('.mp4')) continue;
              const full = path.join(diskCacheDir, name);
              const st = await fs.stat(full).catch(() => null);
              if (st) {
                total += st.size;
                entries.push({ full, size: st.size, mtimeMs: st.mtimeMs });
              }
            }
            if (total > MAX_DISK_CACHE_BYTES) {
              entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
              for (const entry of entries) {
                if (total <= MAX_DISK_CACHE_BYTES) break;
                await fs.rm(entry.full, { force: true });
                total -= entry.size;
              }
            }
          } catch {
            // Ignore disk cache prune errors
          } finally {
            diskPruneRunning = false;
          }
        });
      }
      return target;
    } catch {
      return null;
    }
  }

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

  async function prepare(vid, signal, background = false, { needBuffer = true } = {}) {
    if (!/^\d{1,30}$/.test(vid)) throw Object.assign(new Error('分集编号无效'), { status: 400 });
    signal.throwIfAborted();
    const key = `${vid}:auto`;
    const existingEntry = streams.cache.get(key);
    if (existingEntry?.buffer && compatibleBuffers.has(existingEntry.buffer)) {
      streams.cache.delete(key);
      streams.cache.set(key, existingEntry);
      const filePath = await resolveDiskCachePath(vid, existingEntry.buffer);
      return { buffer: existingEntry.buffer, sizeBytes: existingEntry.buffer.length, filePath };
    }

    // Fast disk-cache hit: `POST /prepare` only needs `stat` + `filePath` (0 bytes read into Node RAM!),
    // while `GET /media` loads into `streams.cache` on demand for HTTP range streaming.
    if (!needBuffer) {
      const diskStat = await statDiskCache(vid);
      if (diskStat) {
        signal.throwIfAborted();
        return { buffer: null, sizeBytes: diskStat.sizeBytes, filePath: diskStat.filePath };
      }
    } else {
      const diskHit = await readDiskCache(vid);
      if (diskHit) {
        signal.throwIfAborted();
        compatibleBuffers.add(diskHit.buffer);
        streams.cache.delete(key);
        streams.cache.set(key, { buffer: diskHit.buffer, size: diskHit.buffer.length });
        streams.pruneCache();
        return diskHit;
      }
    }

    // Foreground playback preempts any unrelated background prefetch holding bandwidth or NVENC
    if (!background) {
      for (const [otherVid, otherJob] of preparing.entries()) {
        if (otherVid !== vid && otherJob.background) {
          otherJob.controller.abort(new Error('Prefetch superseded'));
        }
      }
    }

    let job = preparing.get(vid);
    if (job?.controller.signal.aborted) job = null;
    if (job && !background) job.background = false;
    if (!job) {
      const controller = new AbortController();
      job = { controller, waiters: 0, background };
      job.promise = (async () => {
        let buffer = await streams.getDecryptedBuffer(vid, 'auto', {
          signal: controller.signal,
          background: job.background,
        });
        // Media Foundation does not include HEVC on every Windows install.
        // The existing FFmpeg path accepts clear MP4 as well as ByteVC2.
        if (buffer.includes(Buffer.from('hvc1')) || buffer.includes(Buffer.from('hev1'))) {
          try {
            buffer = await convertHevc(buffer, controller.signal);
          } catch (error) {
            if (!controller.signal.aborted) error.message = '本集视频转换失败，请重试本集';
            throw error;
          }
          streams.cache.delete(key);
          streams.cache.set(key, { buffer, size: buffer.length });
          streams.pruneCache();
        }
        compatibleBuffers.add(buffer);
        const filePath = await writeDiskCache(vid, buffer);
        const sizeBytes = buffer.length;
        if (filePath && process.platform === 'win32' && job.background) {
          // Background preloads on Windows are played directly via `filePath`; release Node RAM immediately.
          streams.cache.delete(key);
        } else {
          streams.pruneCache();
        }
        return { buffer, sizeBytes, filePath };
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
      if (diskCacheDir && /^\d{1,30}$/.test(req.params.vid)) {
        await fs.rm(path.join(diskCacheDir, `${req.params.vid}.mp4`), { force: true }).catch(() => {});
      }
      require('./native/app-source').clearEntryCache(req.params.vid);
    }
    const isBackground = req.body?.background === true;
    const { sizeBytes, filePath } = await prepare(req.params.vid, requestSignal(req, res), isBackground, { needBuffer: false });
    res.json({ sizeBytes, path: `/media/${req.params.vid}`, filePath });
  });
  router.get('/media/:vid', async (req, res) => {
    await prepare(req.params.vid, requestSignal(req, res), false, { needBuffer: true });
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
