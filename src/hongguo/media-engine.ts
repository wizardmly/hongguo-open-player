// SPDX-License-Identifier: GPL-3.0-only
import { Buffer } from "buffer";
import fs from "fs/promises";
import path from "path";
import process from "process";
import { clearEntryCache, fetchAppPlayUrl, type PlayVariant } from "./app-source";
import { assertUnencryptedMp4, decryptMp4Buffer, isHevcMp4Buffer } from "./crypto";
import { abortableSignal, concatUint8Arrays, urlToLocalPath } from "./http";
import { removeDirRecursive, shutdownPlaybackSigner } from "./signer";

const MAX_DISK_CACHE_BYTES = 600 * 1024 * 1024;
const SAFE_FS_WRITE_CHUNK = 7 * 1024 * 1024; // Strictly under NSH's 8 MiB fs.writeFile limit
const ENCODER_ARGS = ["-maxrate", "3M", "-bufsize", "6M"];

interface PrepareJob {
  controller: AbortController;
  waiters: number;
  background: boolean;
  promise: Promise<{ resolvedUrl: string; sizeBytes: number }>;
}

const preparingJobs = new Map<string, PrepareJob>();
const accessTimestamps = new Map<string, number>();
let useHardwareNvenc = process.platform === "windows";
let diskPruneRunning = false;

function getDataRoot(): string {
  return process.dataDir || urlToLocalPath(new URL("../../", import.meta.url).href);
}

function getMediaCacheDir(): string {
  return path.join(getDataRoot(), "media-cache");
}

function ffmpegExecutable(isBytevc2 = false): string {
  if (isBytevc2) return process.platform === "windows" ? "bvc2-ffmpeg.exe" : "bvc2-ffmpeg";
  return process.platform === "windows" ? "ffmpeg.exe" : "ffmpeg";
}

async function runProcessAbortable(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await fs.mkdir(cwd, { recursive: true });
  const child = process.spawn(command, args, { cwd, lines: false });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stderrText = "";

    const cleanupListeners = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      reject(err);
    };

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finishErr((signal?.reason as Error) || new Error("播放已取消"));
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finishErr(Object.assign(new Error("视频处理超时"), { code: "ETIMEDOUT" }));
    }, timeoutMs);

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("stderr", (text) => {
      if (stderrText.length < 4096) stderrText += text.slice(0, 4096 - stderrText.length);
    });

    child.on("exit", (res) => {
      if (settled) return;
      if (signal?.aborted) {
        finishErr((signal.reason as Error) || new Error("播放已取消"));
        return;
      }
      if (res.errorCode || res.code !== 0) {
        const msg =
          res.errorCode === "ENOENT" || res.errorCode === "ERR_ACCESS_DENIED"
            ? `缺少或无法启动 ${command}，请检查程序运行时组件是否完整`
            : `视频转换失败 (code=${res.code ?? "null"}): ${stderrText.trim().slice(0, 300)}`;
        finishErr(Object.assign(new Error(msg), { code: res.errorCode || "TRANSCODE_FAILED" }));
        return;
      }
      settled = true;
      cleanupListeners();
      resolve();
    });
  });
}

/** Writes arbitrary-length bytes safely under NSH's 8 MiB `fs.writeFile` limit using exact binary concatenation if needed. */
async function writeLargeBufferToFile(targetPath: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (data.byteLength <= SAFE_FS_WRITE_CHUNK) {
    await fs.writeFile(targetPath, data);
    return;
  }

  const workDir = `${targetPath}.parts-${process.platform === "windows" ? Date.now() : Math.floor(Math.random() * 1e9)}`;
  await fs.mkdir(workDir, { recursive: true });
  const partPaths: string[] = [];
  try {
    let idx = 0;
    for (let off = 0; off < data.byteLength; off += SAFE_FS_WRITE_CHUNK) {
      signal?.throwIfAborted();
      const end = Math.min(off + SAFE_FS_WRITE_CHUNK, data.byteLength);
      const partPath = path.join(workDir, `p-${idx++}.bin`);
      await fs.writeFile(partPath, data.subarray(off, end));
      partPaths.push(partPath);
    }
    const concatSpec = `concat:${partPaths.join("|")}`;
    await runProcessAbortable(
      ffmpegExecutable(false),
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "data", "-i", concatSpec, "-map", "0", "-c", "copy", "-f", "data", "-y", targetPath],
      workDir,
      60_000,
      signal,
    );
  } finally {
    await removeDirRecursive(workDir);
  }
}

async function scheduleDiskCachePrune(cacheDir: string): Promise<void> {
  if (diskPruneRunning) return;
  diskPruneRunning = true;
  try {
    const names = await fs.readdir(cacheDir).catch(() => [] as string[]);
    const entries: { full: string; size: number; lastUsed: number }[] = [];
    let total = 0;
    for (const name of names) {
      if (!name.endsWith(".mp4")) continue;
      const full = path.join(cacheDir, name);
      const st = await fs.stat(full).catch(() => null);
      if (st) {
        total += st.size;
        entries.push({ full, size: st.size, lastUsed: accessTimestamps.get(name) ?? st.mtimeMs });
      }
    }
    if (total > MAX_DISK_CACHE_BYTES) {
      entries.sort((a, b) => a.lastUsed - b.lastUsed);
      for (const entry of entries) {
        if (total <= MAX_DISK_CACHE_BYTES) break;
        await fs.unlink(entry.full).catch(() => {});
        accessTimestamps.delete(path.basename(entry.full));
        total -= entry.size;
      }
    }
  } finally {
    diskPruneRunning = false;
  }
}

async function statDiskCache(vid: string): Promise<{ sizeBytes: number; filePath: string } | null> {
  const dir = getMediaCacheDir();
  const fileName = `${vid}.mp4`;
  const file = path.join(dir, fileName);
  try {
    const st = await fs.stat(file);
    if (st.size < 1024) return null;
    accessTimestamps.set(fileName, Date.now());
    return { sizeBytes: st.size, filePath: file };
  } catch {
    return null;
  }
}

async function fetchRangeBytes(
  url: string,
  userAgent: string,
  start: number,
  end: number,
  total: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const { signal: reqSignal, cleanup } = abortableSignal(Date.now() + timeoutMs, signal);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": userAgent,
        "Accept-Encoding": "identity",
        Range: `bytes=${start}-${end}`,
      },
      redirect: "manual",
      signal: reqSignal,
    });
    if (res.status !== 206) throw new Error(`Invalid range status ${res.status}`);
    const rangeHdr = res.headers.get("content-range");
    if (rangeHdr && rangeHdr !== `bytes ${start}-${end}/${total}`) {
      throw new Error(`Invalid range header ${rangeHdr}`);
    }
    const chunk = new Uint8Array(await res.arrayBuffer());
    if (chunk.byteLength !== end - start + 1) {
      throw new Error(`Short range read (${chunk.byteLength}/${end - start + 1})`);
    }
    return chunk;
  } finally {
    cleanup();
  }
}

async function downloadWithParallelRanges(
  url: string,
  userAgent: string,
  timeoutMs = 20000,
  signal?: AbortSignal,
): Promise<Buffer> {
  const ua =
    userAgent ||
    "com.phoenix.read/71532 (Linux; U; Android 9; SM-N9860; Build/PQ3A.190705.10241111;tt-ok/3.12.13.20)";
  const fragments = new AbortController();
  const transferSignal = signal ? AbortSignal.any([signal, fragments.signal]) : fragments.signal;

  try {
    const { signal: probeSignal, cleanup: probeCleanup } = abortableSignal(Date.now() + 4000, transferSignal);
    let total = 0;
    let wholeData: Uint8Array | null = null;
    try {
      const probe = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": ua, "Accept-Encoding": "identity", Range: "bytes=0-0" },
        redirect: "manual",
        signal: probeSignal,
      });
      const rangeHeader = probe.headers.get("content-range");
      if (!rangeHeader) {
        if (probe.status === 200) wholeData = new Uint8Array(await probe.arrayBuffer());
        else throw new Error("Invalid range probe");
      } else {
        total = parseInt(rangeHeader.split("/")[1], 10);
        if (!Number.isSafeInteger(total) || total <= 0 || total > 64 * 1024 * 1024) {
          if (probe.status === 200) wholeData = new Uint8Array(await probe.arrayBuffer());
          else throw new Error("Invalid range probe");
        }
      }
    } finally {
      probeCleanup();
    }
    if (wholeData) return Buffer.from(wholeData);

    const concurrency = Math.min(total, 8, Math.max(4, Math.ceil(total / (1024 * 1024))));
    const chunkSize = Math.ceil(total / concurrency);
    const tasks: Promise<Uint8Array>[] = [];
    for (let i = 0; i < concurrency; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, total - 1);
      if (start > end) break;
      tasks.push(fetchRangeBytes(url, ua, start, end, total, timeoutMs, transferSignal));
    }
    const chunks = await Promise.all(tasks);
    return concatUint8Arrays(chunks);
  } catch (err) {
    fragments.abort();
    if (signal?.aborted) throw err;

    const { signal: fullSignal, cleanup: fullCleanup } = abortableSignal(Date.now() + timeoutMs, signal);
    try {
      const fallback = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": ua, "Accept-Encoding": "identity" },
        signal: fullSignal,
      });
      if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);
      return Buffer.from(await fallback.arrayBuffer());
    } finally {
      fullCleanup();
    }
  }
}

function sortVariantsByCdnPriority(variants: PlayVariant[]): PlayVariant[] {
  if (!variants.length) return [];
  const tierKey = (v: PlayVariant) => {
    const codec = String(v?.codec || "").toLowerCase();
    const quality = String(v?.quality || "").toLowerCase();
    return `${codec}:${quality}:${v?.width || 0}x${v?.height || 0}`;
  };
  const tierOrder: string[] = [];
  const tierMap = new Map<string, PlayVariant[]>();
  for (const v of variants) {
    const k = tierKey(v);
    if (!tierMap.has(k)) {
      tierMap.set(k, []);
      tierOrder.push(k);
    }
    tierMap.get(k)!.push(v);
  }
  const result: PlayVariant[] = [];
  for (const k of tierOrder) {
    const group = tierMap.get(k)!;
    const normal: PlayVariant[] = [];
    const throttled: PlayVariant[] = [];
    for (const v of group) {
      if (/v9-reading-video/i.test(v?.url || "")) throttled.push(v);
      else normal.push(v);
    }
    result.push(...normal, ...throttled);
  }
  return result;
}

async function downloadFastestMedia(
  variants: PlayVariant[],
  defaultVariant: PlayVariant,
  timeoutMs = 25000,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; variant: PlayVariant }> {
  const list = variants.length > 0 ? variants : [defaultVariant];
  const sorted = sortVariantsByCdnPriority(list);
  const controllers = sorted.map(() => new AbortController());

  const fetchOne = async (variant: PlayVariant, index: number) => {
    const controller = controllers[index];
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const buffer = await downloadWithParallelRanges(variant.url, variant.userAgent, timeoutMs, combined);
    return { buffer, variant };
  };

  if (sorted.length === 1) return fetchOne(sorted[0], 0);

  return new Promise<{ buffer: Buffer; variant: PlayVariant }>((resolve, reject) => {
    let settled = false;
    let next = 0;
    let failures = 0;
    let running = 0;
    let timer: number | undefined;
    const launch = () => {
      if (settled || next >= sorted.length || running >= 2) return;
      if (signal?.aborted) {
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        reject(signal.reason);
        return;
      }
      running++;
      const index = next++;
      if (timer !== undefined) clearTimeout(timer);
      if (next < sorted.length) timer = setTimeout(launch, 1200);
      fetchOne(sorted[index], index)
        .then((res) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          controllers.forEach((c, i) => {
            if (i !== index) c.abort();
          });
          resolve(res);
        })
        .catch((err) => {
          if (settled) return;
          failures++;
          running--;
          if (failures === sorted.length) {
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            reject(err);
          } else {
            launch();
          }
        });
    };
    launch();
  });
}

async function transcodeToDiskFile(
  buffer: Buffer,
  key: Uint8Array,
  targetPath: string,
  options: { isBytevc2: boolean; hardware: boolean; signal: AbortSignal },
): Promise<number> {
  if (!key.length) assertUnencryptedMp4(buffer);
  const workDir = `${targetPath}.tc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const inputFile = path.join(workDir, "input.mp4");
  const outFile = path.join(workDir, "output.mp4");
  await fs.mkdir(workDir, { recursive: true });
  try {
    await writeLargeBufferToFile(inputFile, buffer, options.signal);

    const runTranscode = (hw: boolean) => {
      const videoArgs = hw
        ? ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "25", "-b:v", "0"]
        : ["-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-crf", "25"];
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "2",
        ...(hw ? ["-hwaccel", "cuda"] : []),
        ...(key.length ? ["-decryption_key", Buffer.from(key).toString("hex")] : []),
        "-i",
        inputFile,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        ...videoArgs,
        ...ENCODER_ARGS,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-y",
        outFile,
      ];
      return runProcessAbortable(ffmpegExecutable(options.isBytevc2), args, workDir, 5 * 60 * 1000, options.signal);
    };

    try {
      await runTranscode(options.hardware);
    } catch (err) {
      if (!options.hardware || options.signal.aborted) throw err;
      useHardwareNvenc = false;
      await runTranscode(false);
    }

    const st = await fs.stat(outFile);
    if (!st.size || st.size >= 128 * 1024 * 1024) {
      throw new Error("视频转换结果过大或为空");
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.rename(outFile, targetPath);
    return st.size;
  } finally {
    await removeDirRecursive(workDir);
  }
}

export interface PrepareEpisodeOptions {
  refresh?: boolean;
  background?: boolean;
  nextVids?: string[];
}

export async function prepareHongguoEpisode(
  vid: string,
  signal: AbortSignal,
  options: PrepareEpisodeOptions = {},
): Promise<{ resolvedUrl: string; sizeBytes: number }> {
  const cleanVid = String(vid || "").trim();
  if (!/^\d{1,30}$/.test(cleanVid)) {
    throw Object.assign(new Error("分集编号无效"), { status: 400 });
  }
  signal.throwIfAborted();

  const cacheDir = getMediaCacheDir();
  const targetFile = path.join(cacheDir, `${cleanVid}.mp4`);

  if (options.refresh) {
    clearEntryCache(cleanVid);
    await fs.unlink(targetFile).catch(() => {});
  } else {
    const diskHit = await statDiskCache(cleanVid);
    if (diskHit) {
      signal.throwIfAborted();
      return { resolvedUrl: diskHit.filePath, sizeBytes: diskHit.sizeBytes };
    }
  }

  const isBackground = options.background === true;
  if (!isBackground) {
    for (const [otherVid, otherJob] of [...preparingJobs.entries()]) {
      if (otherVid !== cleanVid && otherJob.background) {
        otherJob.controller.abort(new Error("Prefetch superseded"));
      }
    }
  }

  let job = preparingJobs.get(cleanVid);
  if (job?.controller.signal.aborted) job = undefined;
  if (job && !isBackground) job.background = false;

  if (!job) {
    const controller = new AbortController();
    const newJob: PrepareJob = {
      controller,
      waiters: 0,
      background: isBackground,
      promise: (async () => {
        const playInfo = await fetchAppPlayUrl(cleanVid, {
          quality: "auto",
          allowLowerQuality: true,
          allowBytevc2: true,
          refresh: options.refresh === true,
          nextVids: options.nextVids,
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        if (!playInfo?.url) throw new Error("未获取到有效的视频流链接");

        const { buffer, variant } = await downloadFastestMedia(
          playInfo.variants || [],
          playInfo,
          25000,
          controller.signal,
        );
        controller.signal.throwIfAborted();

        const keyHex = variant.contentKey || playInfo.contentKey || "";
        const keyBytes = keyHex ? Buffer.from(keyHex, "hex") : Buffer.alloc(0);

        let finalSize: number;
        if (variant.codec === "bytevc2") {
          finalSize = await transcodeToDiskFile(buffer, keyBytes, targetFile, {
            isBytevc2: true,
            hardware: false,
            signal: controller.signal,
          });
        } else {
          const decrypted = await decryptMp4Buffer(buffer, keyBytes.length === 16 ? keyBytes : null);
          controller.signal.throwIfAborted();
          if (isHevcMp4Buffer(decrypted)) {
            finalSize = await transcodeToDiskFile(decrypted, Buffer.alloc(0), targetFile, {
              isBytevc2: false,
              hardware: useHardwareNvenc,
              signal: controller.signal,
            });
          } else {
            const tmpTarget = `${targetFile}.${Date.now()}.tmp`;
            await writeLargeBufferToFile(tmpTarget, decrypted, controller.signal);
            await fs.rename(tmpTarget, targetFile);
            finalSize = decrypted.length;
          }
        }

        accessTimestamps.set(`${cleanVid}.mp4`, Date.now());
        void scheduleDiskCachePrune(cacheDir);
        return { resolvedUrl: targetFile, sizeBytes: finalSize };
      })().finally(() => {
        if (preparingJobs.get(cleanVid) === newJob) preparingJobs.delete(cleanVid);
      }),
    };
    job = newJob;
    preparingJobs.set(cleanVid, newJob);
  }

  job.waiters++;
  let onAbort: () => void;
  try {
    return await new Promise<{ resolvedUrl: string; sizeBytes: number }>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      job!.promise.then(resolve, reject);
    });
  } finally {
    signal.removeEventListener("abort", onAbort!);
    job.waiters--;
    if (!job.waiters && preparingJobs.get(cleanVid) === job) {
      job.controller.abort(new Error("Playback request cancelled"));
    }
  }
}

export async function shutdownHongguoEngine(): Promise<void> {
  for (const job of [...preparingJobs.values()]) {
    job.controller.abort(new Error("Player closed"));
  }
  preparingJobs.clear();
  await shutdownPlaybackSigner();
}
