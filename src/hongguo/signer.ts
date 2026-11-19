// SPDX-License-Identifier: GPL-3.0-only
import { Buffer } from "buffer";
import fs from "fs/promises";
import path from "path";
import process from "process";
import { PlayerSigner } from "./argus";
import { urlToLocalPath } from "./http";

const SIGNATURE_NAMES = ["x-argus", "x-gorgon", "x-helios", "x-khronos", "x-ladon", "x-medusa"] as const;
const IDLE_SHUTDOWN_MS = 45_000;

function signerError(code = "PLAYBACK_SIGNER_FAILED"): Error & { code: string } {
  return Object.assign(
    new Error(
      code === "PLAYBACK_SIGNER_MISSING"
        ? "本地播放签名组件缺失，请使用包含签名组件的完整便携包"
        : "本地播放签名组件暂时不可用，请重试本集",
    ),
    { code },
  );
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener("abort", abort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener("abort", abort);
        reject(err);
      },
    );
  });
}

export async function removeDirRecursive(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await removeDirRecursive(full);
      } else {
        await fs.unlink(full).catch(() => {});
      }
    }
    await fs.rmdir(dirPath).catch(() => {});
  } catch {
    // Ignore missing/locked temp files during cleanup
  }
}

export async function resolveSignerRuntimeDir(metaUrl: string = import.meta.url): Promise<string> {
  const bases = [
    urlToLocalPath(new URL("../../", metaUrl).href),
    urlToLocalPath(new URL("../", metaUrl).href),
    urlToLocalPath(new URL("./", metaUrl).href),
  ];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const base of bases) {
    for (const sub of [
      path.join(base, "runtime", "playback-signer"),
      path.join(base, "build", "playback-signer", "win32-x64"),
    ]) {
      if (!seen.has(sub)) {
        seen.add(sub);
        candidates.push(sub);
      }
    }
  }
  for (const dir of candidates) {
    const required = [
      path.join(dir, "sign", "domestic-sign.jar"),
      path.join(dir, "sign", "unidbg-sign.jar"),
      path.join(dir, "capture", "domestic", "libmetasec_ml.so"),
      path.join(dir, "capture", "domestic", "libc++_shared.so"),
      path.join(dir, "capture", "domestic", "sdk-metadata.bin"),
    ];
    let ok = true;
    for (const f of required) {
      if (!(await fs.exists(f).catch(() => false))) {
        ok = false;
        break;
      }
    }
    if (ok) return dir;
  }
  throw signerError("PLAYBACK_SIGNER_MISSING");
}

interface SignerProcessState {
  child: ReturnType<typeof process.spawn>;
  deviceKey: string;
  stateDir: string;
  ready: Promise<string>;
  exited: Promise<void>;
}

let current: SignerProcessState | undefined;
let queue: Promise<unknown> = Promise.resolve();
let closed = false;
let idleTimer: number | undefined;

function clearIdleTimer(): void {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
}

function scheduleIdleShutdown(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (current) void stopState(current);
  }, IDLE_SHUTDOWN_MS);
}

async function stopState(state: SignerProcessState | undefined): Promise<void> {
  if (!state) return;
  if (current === state) {
    current = undefined;
    clearIdleTimer();
  }
  try {
    state.child.kill();
  } catch {
    // Already exited
  }
  await state.exited;
}

async function startSigner(deviceKey: string): Promise<SignerProcessState> {
  const runtimeDir = await resolveSignerRuntimeDir();
  const dataRoot = process.dataDir || urlToLocalPath(new URL("../../", import.meta.url).href);
  const stateDir = path.join(dataRoot, "signer-state", `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const tmpDir = path.join(stateDir, "tmp");
  await fs.mkdir(tmpDir, { recursive: true });

  const jars = [
    path.join(runtimeDir, "sign", "domestic-sign.jar"),
    path.join(runtimeDir, "sign", "unidbg-sign.jar"),
  ].join(path.delimiter);
  const nativeDir = path.join(runtimeDir, "capture", "domestic");
  const javaExe = process.platform === "windows" ? "java.exe" : "java";

  const child = process.spawn(
    javaExe,
    [`-Djava.io.tmpdir=${tmpDir}`, "-cp", jars, "com.hongguo.sign.DomesticSigner", nativeDir, stateDir],
    { cwd: stateDir, lines: true },
  );

  let resolveExit!: () => void;
  const exited = new Promise<void>((res) => {
    resolveExit = res;
  });

  let resolveReady!: (endpoint: string) => void;
  let rejectReady!: (err: unknown) => void;
  const ready = new Promise<string>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const state: SignerProcessState = { child, deviceKey, stateDir, ready, exited };
  let settledReady = false;
  const readyTimer = setTimeout(() => {
    if (settledReady) return;
    settledReady = true;
    try {
      child.kill();
    } catch {
      // ignore
    }
    rejectReady(signerError());
  }, 30_000);

  child.on("stdout", (line: string) => {
    const match = line.match(/SIGNER_READY 127\.0\.0\.1:(\d+)/);
    if (!match || settledReady) return;
    settledReady = true;
    clearTimeout(readyTimer);
    resolveReady(`http://127.0.0.1:${match[1]}/sign`);
  });

  child.on("exit", () => {
    clearTimeout(readyTimer);
    if (!settledReady) {
      settledReady = true;
      rejectReady(signerError());
    }
    if (current === state) current = undefined;
    void removeDirRecursive(stateDir).finally(() => resolveExit());
  });

  current = state;
  return state;
}

async function signNativeOnce(url: string, body: Buffer, signal?: AbortSignal): Promise<Record<string, string>> {
  signal?.throwIfAborted();
  if (closed) throw signerError();
  clearIdleTimer();

  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !/(^|\.)(fqnovel\.com|snssdk\.com)$/.test(parsed.hostname)
  ) {
    throw signerError();
  }
  const devicePair = ["device_id", "iid"].map((key) => parsed.searchParams.get(key) || "");
  if (!devicePair.every((value) => /^\d{1,30}$/.test(value))) {
    throw signerError();
  }
  const devKey = devicePair.join(":");
  if (current && current.deviceKey !== devKey) {
    await stopState(current);
  }
  const state = current || (await startSigner(devKey));
  try {
    const endpoint = await abortable(state.ready, signal);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 15_000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
    let data: Record<string, unknown>;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, body_base64: body.toString("base64") }),
        signal: combinedSignal,
      });
      if (!response.ok) throw signerError();
      data = (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }

    const lowered: Record<string, string> = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (typeof v === "string") lowered[k.toLowerCase()] = v;
    }
    if (
      !SIGNATURE_NAMES.every(
        (name) =>
          typeof lowered[name] === "string" &&
          lowered[name].length > 0 &&
          lowered[name].length < 16384 &&
          !/[\r\n]/.test(lowered[name]),
      )
    ) {
      throw signerError();
    }
    scheduleIdleShutdown();
    return Object.fromEntries(SIGNATURE_NAMES.map((name) => [name, lowered[name]]));
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    await stopState(state);
    throw signerError();
  }
}

export async function signPlaybackRequest(
  url: string,
  body: Buffer,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (process.platform === "windows" && process.arch === "x86_64") {
    const run = () => {
      if (signal?.aborted) return Promise.reject(signal.reason);
      const task = queue.catch(() => {}).then(() => signNativeOnce(url, body, signal));
      queue = task;
      return abortable(task, signal);
    };
    try {
      return await run();
    } catch (error: any) {
      if (error?.code !== "PLAYBACK_SIGNER_FAILED" || signal?.aborted) throw error;
      return await run();
    }
  }
  return PlayerSigner.headers(new URL(url).search.slice(1), body);
}

export async function shutdownPlaybackSigner(): Promise<void> {
  closed = true;
  clearIdleTimer();
  await stopState(current);
}
