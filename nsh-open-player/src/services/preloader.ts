import { signal } from "nsh";
import type { EpisodeItem, PreloadStatus } from "../domain/types";
import { prepareHongguoEpisode } from "./backend";

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

export type EpisodeMediaLoader = (episode: EpisodeItem, signal: AbortSignal) => Promise<PreloadLoaderResult>;

interface QueueJob {
  episode: EpisodeItem;
  priority: "playback" | "prefetch";
  controller: AbortController;
  promise: Promise<CachedEpisodeMedia>;
  resolve: (value: CachedEpisodeMedia) => void;
  reject: (reason?: unknown) => void;
  started: boolean;
}

export interface PreloadManagerOptions {
  /** Number of upcoming episodes to preload sequentially (defaults to 3). */
  prefetchAheadCount?: number;
  /** Maximum cached bytes across episodes (defaults to 128 MB). */
  maxCacheBytes?: number;
  /** Maximum cached episode count (defaults to 15). */
  maxCacheCount?: number;
  /** Custom loader for fetching/warming standard media streams. */
  loader?: EpisodeMediaLoader;
}

const DEFAULT_ESTIMATED_BYTES = 600 * 1024;

async function defaultEpisodeLoader(episode: EpisodeItem, abortSignal: AbortSignal): Promise<PreloadLoaderResult> {
  abortSignal.throwIfAborted();
  const src = episode.src;
  if (episode.source === "hongguo") return prepareHongguoEpisode(episode.vid, abortSignal);
  // Standard HTTP/HTTPS media streams: warm via `fetch` with abort support and measure bytes when small,
  // while keeping direct streaming URL if large or CORS-opaque.
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { method: "GET", signal: abortSignal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    abortSignal.throwIfAborted();
    const blob = new Blob([buf], { type: res.headers.get("content-type") || "video/mp4" });
    return {
      resolvedUrl: URL.createObjectURL(blob),
      sizeBytes: Math.max(1, buf.byteLength),
    };
  }
  // Bundled `asset:/` or local `blob:`/`file:` media: yield one microtask turn so active playback
  // preempts queued background prefetches deterministically.
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
 * - Active playback requests jump to the front of the queue ahead of pending prefetches.
 * - Switching to an episode already in-flight reuses the existing download promise.
 * - Enforces `maxCacheBytes` (128 MB) & `maxCacheCount` (15) while protecting active & upcoming targets.
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

  /** Reactive map of `vid -> PreloadStatus` for UI badges and observability. */
  readonly statusByVid = signal<Record<string, PreloadStatus>>({});

  constructor(options: PreloadManagerOptions = {}) {
    this.prefetchAheadCount = options.prefetchAheadCount ?? 3;
    this.maxCacheBytes = options.maxCacheBytes ?? 128 * 1024 * 1024;
    this.maxCacheCount = options.maxCacheCount ?? 15;
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

  /** Acquires an episode for immediate playback, reusing cache or in-flight work and preempting queued prefetches. */
  acquireForPlayback(episode: EpisodeItem): Promise<CachedEpisodeMedia> {
    this.activeVid = episode.vid;
    const hit = this.cache.get(episode.vid);
    if (hit) {
      hit.timestamp = Date.now();
      this.cache.delete(episode.vid);
      this.cache.set(episode.vid, hit);
      this.setStatus(episode.vid, "ready");
      return Promise.resolve(hit);
    }

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

    return this.enqueue(episode, "playback");
  }

  /** Schedules sequential background preloading of the next `prefetchAheadCount` (default 3) episodes. */
  scheduleUpcoming(episodes: EpisodeItem[], activeEpisodeIndex: number): EpisodeItem[] {
    const upcoming = episodes
      .filter((ep) => ep.vid_index > activeEpisodeIndex && ep.vid_index <= activeEpisodeIndex + this.prefetchAheadCount)
      .sort((a, b) => a.vid_index - b.vid_index);

    const nextTargetSet = new Set(upcoming.map((ep) => ep.vid));
    this.prefetchTargets = nextTargetSet;

    // Cancel queued (not-yet-started or obsolete prefetch) jobs that are neither activeVid nor in upcoming targets.
    for (const [vid, job] of [...this.inFlight.entries()]) {
      if (job.priority === "prefetch" && vid !== this.activeVid && !nextTargetSet.has(vid)) {
        job.controller.abort(new Error("Prefetch superseded"));
        this.removeQueuedJob(job);
        this.inFlight.delete(vid);
        if (!this.cache.has(vid)) this.setStatus(vid, "idle");
      }
    }

    for (const ep of upcoming) {
      if (this.cache.has(ep.vid)) {
        this.setStatus(ep.vid, "ready");
        continue;
      }
      if (this.inFlight.has(ep.vid)) continue;
      void this.enqueue(ep, "prefetch").catch(() => {
        // Background prefetch errors do not interrupt foreground playback; retry occurs when needed.
      });
    }

    return upcoming;
  }

  private enqueue(episode: EpisodeItem, priority: "playback" | "prefetch"): Promise<CachedEpisodeMedia> {
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
    };

    this.inFlight.set(episode.vid, job);
    this.setStatus(episode.vid, "queued");

    if (priority === "playback") {
      const insertAt = this.queue.findIndex((j) => j.priority !== "playback");
      if (insertAt === -1) this.queue.push(job);
      else this.queue.splice(insertAt, 0, job);
    } else {
      this.queue.push(job);
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
    this.activeJob = next;
    next.started = true;
    this.setStatus(next.episode.vid, "loading");

    this.loader(next.episode, next.controller.signal)
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
        if (!next.controller.signal.aborted) {
          this.setStatus(next.episode.vid, "error");
        }
        if (this.inFlight.get(next.episode.vid) === next) {
          this.inFlight.delete(next.episode.vid);
        }
        if (this.activeJob === next) {
          this.activeJob = null;
        }
        this.pump();
        next.reject(err);
      });
  }

  private storeInCache(entry: CachedEpisodeMedia): void {
    if (entry.sizeBytes > this.maxCacheBytes) {
      // Single episode exceeds budget; still deliver to caller without evicting everything else permanently.
      return;
    }
    this.cache.delete(entry.vid);
    this.cache.set(entry.vid, entry);
    this.evictIfNeeded(entry.vid);
  }

  private evictIfNeeded(justAddedVid: string): void {
    const isProtected = (vid: string) =>
      vid === justAddedVid || vid === this.activeVid || this.prefetchTargets.has(vid);

    // Pass 1: Evict oldest non-protected entries first.
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

    // Pass 2: If still over hard cap, evict oldest entries except `justAddedVid` and `activeVid`.
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

  /** Cancels all pending jobs and clears cached entries. */
  clearAll(): void {
    for (const job of this.inFlight.values()) {
      job.controller.abort(new Error("Cleared"));
    }
    this.queue.length = 0;
    this.inFlight.clear();
    this.activeJob = null;
    for (const item of this.cache.values()) {
      this.revokeIfBlob(item.resolvedUrl);
    }
    this.cache.clear();
    this.statusByVid.set({});
  }
}

/** Default singleton preload manager for the player surface. */
export const episodePreloader = new EpisodePreloadManager();
