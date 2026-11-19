import { platform, signal } from "nsh";
import type { EpisodeItem, PreloadStatus } from "../domain/types";
import { prepareHongguoEpisode } from "../hongguo/media-engine";

export interface CachedEpisodeMedia {
  vid: string;
  resolvedUrl: string;
  sizeBytes: number;
  timestamp: number;
}

export interface PreloadLoaderResult {
  resolvedUrl: string;
  sizeBytes: number;
}

export interface EpisodeLoaderContext {
  background?: boolean;
  nextVids?: string[];
}

export type EpisodeMediaLoader = (
  episode: EpisodeItem,
  signal: AbortSignal,
  context?: EpisodeLoaderContext,
) => Promise<PreloadLoaderResult>;

interface QueueJob {
  episode: EpisodeItem;
  priority: "playback" | "prefetch";
  controller: AbortController;
  promise: Promise<CachedEpisodeMedia>;
  resolve: (value: CachedEpisodeMedia) => void;
  reject: (reason?: unknown) => void;
  started: boolean;
  attempts: number;
}

export interface PreloadManagerOptions {
  /** Number of upcoming episodes to preload sequentially (defaults to 3). */
  prefetchAheadCount?: number;
  /** Maximum cached bytes across episodes (defaults to 128 MB). */
  maxCacheBytes?: number;
  /** Maximum cached episode count (defaults to 15). */
  maxCacheCount?: number;
  /** Custom loader for fetching/warming media streams. */
  loader?: EpisodeMediaLoader;
}

const DEFAULT_ESTIMATED_BYTES = 600 * 1024;

async function defaultEpisodeLoader(
  episode: EpisodeItem,
  abortSignal: AbortSignal,
  context: EpisodeLoaderContext = {},
): Promise<PreloadLoaderResult> {
  abortSignal.throwIfAborted();
  const src = episode.src;
  if (episode.source === "hongguo") {
    return prepareHongguoEpisode(episode.vid, abortSignal, {
      background: context.background,
      nextVids: context.nextVids,
    });
  }
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { method: "GET", signal: abortSignal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    abortSignal.throwIfAborted();
    if (platform.os === "windows") {
      // Win32 Media Foundation plays HTTP(S) URLs directly rather than `blob:nsh://` URLs
      return {
        resolvedUrl: src,
        sizeBytes: Math.max(1, buf.byteLength),
      };
    }
    const blob = new Blob([buf], { type: res.headers.get("content-type") || "video/mp4" });
    return {
      resolvedUrl: URL.createObjectURL(blob),
      sizeBytes: Math.max(1, buf.byteLength),
    };
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 12);
    abortSignal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortSignal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
  });
  return {
    resolvedUrl: src,
    sizeBytes: episode.estimated_bytes ?? DEFAULT_ESTIMATED_BYTES,
  };
}

/**
 * Sequential Multi-Episode Preloader & LRU Cache Queue.
 *
 * - Preloads up to `prefetchAheadCount` (default 3) upcoming episodes sequentially (`1 -> 2 -> 3`).
 * - Synchronous `peekCached(vid)` enables 0ms zero-microtask switching & standby `<Video>` pre-decoding.
 * - Cache hits on `acquireForPlayback` NEVER abort already-running upcoming prefetches (e.g. Ep 3 keeps downloading when switching to cached Ep 2).
 * - Uncached active playback requests jump ahead of queued prefetches and preempt unrelated active prefetches.
 * - `cancelPendingPrefetches()` stops background network activity on Theater exit while preserving cached episodes in the 128 MB LRU cache.
 */
export class EpisodePreloadManager {
  readonly prefetchAheadCount: number;
  readonly maxCacheBytes: number;
  readonly maxCacheCount: number;

  private readonly loader: EpisodeMediaLoader;
  private readonly cache = new Map<string, CachedEpisodeMedia>();
  private readonly inFlight = new Map<string, QueueJob>();
  private readonly queue: QueueJob[] = [];
  private activeJob: QueueJob | null = null;
  private activeVid: string | null = null;
  private prefetchTargets = new Set<string>();

  /** Reactive map of `vid -> PreloadStatus` for UI indicators and standby pre-decoder triggers. */
  readonly statusByVid = signal<Record<string, PreloadStatus>>({});

  constructor(options: PreloadManagerOptions = {}) {
    this.prefetchAheadCount = options.prefetchAheadCount ?? 3;
    this.maxCacheBytes = options.maxCacheBytes ?? 384 * 1024 * 1024;
    this.maxCacheCount = options.maxCacheCount ?? 36;
    this.loader = options.loader ?? defaultEpisodeLoader;
  }

  private setStatus(vid: string, status: PreloadStatus): void {
    this.statusByVid.update((prev) => {
      if (prev[vid] === status) return prev;
      return { ...prev, [vid]: status };
    });
  }

  getStatus(vid: string): PreloadStatus {
    return this.statusByVid()[vid] ?? "idle";
  }

  isCached(vid: string): boolean {
    return this.cache.has(vid);
  }

  /** Synchronous read-only cache lookup (0ms, no microtask hop, used by Dual-Slot `<Video>` standby deck). */
  peekCached(vid: string): CachedEpisodeMedia | null {
    return this.cache.get(vid) ?? null;
  }

  totalCachedBytes(): number {
    let sum = 0;
    for (const item of this.cache.values()) sum += item.sizeBytes;
    return sum;
  }

  cachedVids(): string[] {
    return [...this.cache.keys()];
  }

  invalidate(vid: string): void {
    const item = this.cache.get(vid);
    if (item) this.revokeIfBlob(item.resolvedUrl);
    this.cache.delete(vid);
    this.setStatus(vid, "idle");
  }

  /**
   * Acquires an episode for immediate playback:
   * 1. If already cached, returns immediately WITHOUT aborting in-flight prefetches of subsequent episodes.
   * 2. If already in-flight (`episode.vid`), upgrades its priority to `"playback"` and reuses the same Promise.
   * 3. If uncached and not in-flight, aborts any other in-flight job blocking the lane (unless that job is an unstarted queued prefetch, which simply yields queue priority) so foreground playback starts immediately.
   */
  acquireForPlayback(episode: EpisodeItem): Promise<CachedEpisodeMedia> {
    this.activeVid = episode.vid;

    // 1. Fast path: already in cache -> keep in-flight upcoming prefetches running uninterrupted!
    const hit = this.cache.get(episode.vid);
    if (hit) {
      hit.timestamp = Date.now();
      this.cache.delete(episode.vid);
      this.cache.set(episode.vid, hit);
      this.setStatus(episode.vid, "ready");
      return Promise.resolve(hit);
    }

    // 2. Abort any superseded foreground playback job (never keep two competing foreground playback jobs).
    for (const [vid, job] of [...this.inFlight.entries()]) {
      if (vid === episode.vid) continue;
      if (job.priority === "playback") {
        job.controller.abort(new Error("Playback superseded"));
        this.removeQueuedJob(job);
        this.inFlight.delete(vid);
        if (this.activeJob === job) this.activeJob = null;
        this.setStatus(vid, "idle");
        if (!job.started) job.reject(job.controller.signal.reason);
      }
    }

    // 3. Reuse existing in-flight job if `episode.vid` is already downloading or queued!
    const existing = this.inFlight.get(episode.vid);
    if (existing) {
      existing.priority = "playback";
      if (!existing.started) {
        const idx = this.queue.indexOf(existing);
        if (idx > 0) {
          this.queue.splice(idx, 1);
          const insertAt = this.queue.findIndex((j) => j.priority !== "playback");
          if (insertAt === -1) this.queue.push(existing);
          else this.queue.splice(insertAt, 0, existing);
        }
      }
      return existing.promise;
    }

    // 4. Uncached miss: preempt any unrelated slow background prefetch so foreground playback starts immediately!
    if (
      this.activeJob &&
      this.activeJob.priority === "prefetch" &&
      this.activeJob.episode.vid !== episode.vid &&
      (episode.source === "hongguo" ||
        this.activeJob.episode.vid_index > episode.vid_index + this.prefetchAheadCount)
    ) {
      const stale = this.activeJob;
      this.activeJob = null;
      stale.controller.abort(new Error("Preempted by foreground playback"));
      this.inFlight.delete(stale.episode.vid);
      this.setStatus(stale.episode.vid, "idle");
    }

    return this.enqueue(episode, "playback");
  }

  /** Schedules sequential background preloading of the next `prefetchAheadCount` (default 3) episodes. */
  scheduleUpcoming(episodes: EpisodeItem[], activeEpisodeIndex: number): EpisodeItem[] {
    const upcoming = episodes
      .filter((ep) => ep.vid_index > activeEpisodeIndex && ep.vid_index <= activeEpisodeIndex + this.prefetchAheadCount)
      .sort((a, b) => a.vid_index - b.vid_index);

    const nextTargetSet = new Set(upcoming.map((ep) => ep.vid));
    this.prefetchTargets = nextTargetSet;

    // Cancel queued or obsolete prefetch jobs that are neither `activeVid` nor in `nextTargetSet`.
    for (const [vid, job] of [...this.inFlight.entries()]) {
      if (job.priority === "prefetch" && vid !== this.activeVid && !nextTargetSet.has(vid)) {
        job.controller.abort(new Error("Prefetch superseded"));
        this.removeQueuedJob(job);
        this.inFlight.delete(vid);
        if (this.activeJob === job) this.activeJob = null;
        if (!job.started) job.reject(job.controller.signal.reason);
        if (!this.cache.has(vid)) this.setStatus(vid, "idle");
      }
    }

    for (const ep of upcoming) {
      const cached = this.cache.get(ep.vid);
      if (cached) {
        this.setStatus(ep.vid, "ready");
        // Keep backend LRU & disk-cache warm even across long watch sessions
        if (ep.source === "hongguo" && Date.now() - cached.timestamp > 30_000) {
          cached.timestamp = Date.now();
          void prepareHongguoEpisode(ep.vid, new AbortController().signal, { background: true })
            .then((fresh) => {
              const cur = this.cache.get(ep.vid);
              if (cur && fresh.resolvedUrl) cur.resolvedUrl = fresh.resolvedUrl;
            })
            .catch(() => {});
        }
        continue;
      }
      if (this.inFlight.has(ep.vid)) continue;
      void this.enqueue(ep, "prefetch").catch(() => {
        // Background prefetch errors do not interrupt foreground playback.
      });
    }

    this.pump();
    return upcoming;
  }

  private enqueue(episode: EpisodeItem, priority: "playback" | "prefetch", attempts = 0): Promise<CachedEpisodeMedia> {
    let resolveFn!: (value: CachedEpisodeMedia) => void;
    let rejectFn!: (reason?: unknown) => void;
    const promise = new Promise<CachedEpisodeMedia>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });

    const job: QueueJob = {
      episode,
      priority,
      controller: new AbortController(),
      promise,
      resolve: resolveFn,
      reject: rejectFn,
      started: false,
      attempts,
    };

    this.inFlight.set(episode.vid, job);
    this.setStatus(episode.vid, "queued");

    if (priority === "playback") {
      const insertAt = this.queue.findIndex((j) => j.priority !== "playback");
      if (insertAt === -1) this.queue.push(job);
      else this.queue.splice(insertAt, 0, job);
    } else {
      const insertAt = this.queue.findIndex(
        (j) => j.priority === "prefetch" && j.episode.vid_index > episode.vid_index,
      );
      if (insertAt === -1) this.queue.push(job);
      else this.queue.splice(insertAt, 0, job);
    }

    this.pump();
    return promise;
  }

  private removeQueuedJob(target: QueueJob): void {
    const idx = this.queue.indexOf(target);
    if (idx !== -1) this.queue.splice(idx, 1);
  }

  private pump(): void {
    if (this.activeJob || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.runJob(next);
  }

  private runJob(next: QueueJob): void {
    this.activeJob = next;
    next.started = true;
    this.setStatus(next.episode.vid, "loading");

    this.loader(next.episode, next.controller.signal, {
      background: next.priority === "prefetch",
      nextVids: [...this.prefetchTargets].filter((v) => v !== next.episode.vid),
    })
      .then((loaded) => {
        next.controller.signal.throwIfAborted();
        const entry: CachedEpisodeMedia = {
          vid: next.episode.vid,
          resolvedUrl: loaded.resolvedUrl,
          sizeBytes: Math.max(1, loaded.sizeBytes),
          timestamp: Date.now(),
        };
        this.storeInCache(entry);
        this.setStatus(entry.vid, "ready");
        if (this.inFlight.get(next.episode.vid) === next) {
          this.inFlight.delete(next.episode.vid);
        }
        if (this.activeJob === next) {
          this.activeJob = null;
        }
        this.pump();
        next.resolve(entry);
      })
      .catch((err) => {
        const wasAborted = next.controller.signal.aborted;

        // Foreground playback transient hiccup (e.g. CDN ECONNRESET or cold-start signer restart): retry up to 2 times transparently!
        if (!wasAborted && next.priority === "playback" && next.attempts < 2) {
          next.attempts += 1;
          const backoffMs = next.attempts === 1 ? 450 : 1800;
          setTimeout(() => {
            if (next.controller.signal.aborted || this.activeJob !== next) return;
            this.runJob(next);
          }, backoffMs);
          return;
        }

        if (this.inFlight.get(next.episode.vid) === next) {
          this.inFlight.delete(next.episode.vid);
        }
        if (this.activeJob === next) {
          this.activeJob = null;
        }
        // Single automatic retry for transient background prefetch hiccups if still in `prefetchTargets`
        if (
          !wasAborted &&
          next.priority === "prefetch" &&
          next.attempts < 1 &&
          this.prefetchTargets.has(next.episode.vid)
        ) {
          this.setStatus(next.episode.vid, "queued");
          this.pump();
          setTimeout(() => {
            if (
              this.prefetchTargets.has(next.episode.vid) &&
              !this.cache.has(next.episode.vid) &&
              !this.inFlight.has(next.episode.vid)
            ) {
              void this.enqueue(next.episode, "prefetch", next.attempts + 1).catch(() => {});
            }
          }, 600);
          next.reject(err);
          return;
        }
        if (!wasAborted) {
          this.setStatus(next.episode.vid, "error");
        }
        this.pump();
        next.reject(err);
      });
  }

  private storeInCache(entry: CachedEpisodeMedia): void {
    if (entry.sizeBytes > this.maxCacheBytes) {
      return;
    }
    this.cache.delete(entry.vid);
    this.cache.set(entry.vid, entry);
    this.evictIfNeeded(entry.vid);
  }

  private evictIfNeeded(justAddedVid: string): void {
    const isProtected = (vid: string) =>
      vid === justAddedVid || vid === this.activeVid || this.prefetchTargets.has(vid);

    for (const [vid, item] of [...this.cache.entries()]) {
      if (this.cache.size <= this.maxCacheCount && this.totalCachedBytes() <= this.maxCacheBytes) {
        return;
      }
      if (!isProtected(vid)) {
        this.revokeIfBlob(item.resolvedUrl);
        this.cache.delete(vid);
        this.setStatus(vid, "idle");
      }
    }

    for (const [vid, item] of [...this.cache.entries()]) {
      if (this.cache.size <= this.maxCacheCount && this.totalCachedBytes() <= this.maxCacheBytes) {
        return;
      }
      if (vid !== justAddedVid && vid !== this.activeVid) {
        this.revokeIfBlob(item.resolvedUrl);
        this.cache.delete(vid);
        this.setStatus(vid, "idle");
      }
    }
  }

  private revokeIfBlob(url: string): void {
    if (url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore blob revocation errors in headless environments.
      }
    }
  }

  /** Stops queued/in-flight downloads when leaving Theater while keeping completed episodes in the 128 MB LRU cache. */
  cancelPendingPrefetches(): void {
    for (const [vid, job] of [...this.inFlight.entries()]) {
      job.controller.abort(new Error("Theater exited"));
      if (!job.started) job.reject(job.controller.signal.reason);
      if (!this.cache.has(vid)) this.setStatus(vid, "idle");
    }
    this.queue.length = 0;
    this.inFlight.clear();
    this.activeJob = null;
    this.activeVid = null;
    this.prefetchTargets.clear();
  }

  /** Cancels all pending jobs and clears cached entries. */
  clearAll(): void {
    this.cancelPendingPrefetches();
    for (const item of this.cache.values()) {
      this.revokeIfBlob(item.resolvedUrl);
    }
    this.cache.clear();
    this.statusByVid.set({});
  }
}

/** Default singleton preload manager for the player surface. */
export const episodePreloader = new EpisodePreloadManager();
