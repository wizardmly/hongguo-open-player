import {
  batch,
  cleanup,
  createMotion,
  effect,
  Image,
  keymap,
  platform,
  type PressEvent,
  Scroll,
  type ScrollRef,
  signal,
  Text,
  Video,
  type VideoRef,
  View,
  type WheelEvent,
  windowSize,
} from "nsh";
import { currentWindow, isAvailable as desktopWindowAvailable } from "nsh/desktop";
import { DanmakuOverlay } from "../components/DanmakuOverlay";
import { parseSeasonInfo } from "../domain/seasons";
import type {
  DanmakuComment,
  DanmakuSpeed,
  EpisodeItem,
  FitMode,
  PlaybackRateStr,
  PlayerPreferences,
  SeasonEntry,
  SeriesDetail,
} from "../domain/types";
import { fetchEpisodeDanmaku, prefetchEpisodeDanmaku } from "../services/catalog";
import { episodePreloader } from "../services/preloader";
import { getSeriesProgress, recordWatchProgress, updatePlayerPreferences } from "../services/store";
import {
  animateLayoutChange,
  Icon,
  showToast,
  UiBadge,
  UiButton,
  UiIconButton,
  UiMenu,
  UiMenuItem,
  UiPopover,
  UiSheet,
  UiSkeleton,
  UiSlider,
  UiSpinner,
  UiSwitch,
  UiTab,
  UiTabs,
} from "../ui";

const PLAYBACK_RATES: PlaybackRateStr[] = ["0.75", "1.0", "1.25", "1.5", "2.0"];
const EPISODES_PER_GROUP = 30;

interface VideoLayerItem {
  id: number;
  epIndex: number;
  vid: string;
  src: string;
  role: "active" | "outgoing" | "standby";
  loaded: boolean;
  frameShown: boolean;
  duration: number;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

interface EpisodeGroup {
  start: number;
  end: number;
}

export interface TheaterViewProps {
  series: SeriesDetail;
  loadingSeriesDetail?: boolean;
  initialEpisodeIndex: number;
  initialResumeSec: number;
  isFavorited: boolean;
  prefs: PlayerPreferences;
  relatedSeasons: SeasonEntry[];
  baseTitle: string;
  checkingSeasons: boolean;
  hasModalOpen: boolean;
  onExitTheater: () => void;
  onToggleFavorite: () => void;
  onOpenDramaDetail: () => void;
  onOpenSeasonsModal: () => void;
  onRefreshSeasons: () => void;
  onSelectSeason: (season: SeasonEntry) => void;
}

function chunkRows<T>(items: T[], cols: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols));
  return out;
}

/**
 * Immersive 1:1 Theater Player with:
 * - Dual-Slot A/B `<Video>` Standby Deck (pre-decodes Episode N+1 in background for zero-black-frame switching)
 * - Sequential 3-episode background preloader & 128 MB LRU cache preservation across sessions
 * - Debounced buffering overlay + blurred poster stage backdrop during uncached preparation
 * - Fullscreen auto-hiding controls, scrub timestamp preview & automatic cross-season continuation
 */
export function TheaterView(props: TheaterViewProps) {
  const win = desktopWindowAvailable ? currentWindow() : null;

  // Keyed Immutable-Src Standby Deck + First-Frame Zero-Black Gate:
  // 1. Every `<Video>` is keyed by a unique `id` with an immutable `src` (never mutating `src` on an existing
  //    Win32 `IMFMediaEngine` instance, which caused paused-preroll frame freezes).
  // 2. IMPORTANT: NSH destroys native `<Video>` controls (`MountItem::Delete` -> `IMFMediaEngine::Shutdown()`)
  //    via JS `FinalizationRegistry` when the JS node is GC'd, and `ref` does NOT fire `ref(null)` on unmount.
  //    Store refs exclusively in `WeakRef` + prune on layer removal so retired decoders free RAM & handles immediately.
  // 3. Keep at most ONE hidden `standby` `<Video>` (`N+1`), mounted only after `outgoing` is retired, so peak
  //    concurrent decoders never exceed 2 while forward switches stay 0ms and random/backward switches stay zero-black.
  const videoNodeById = new Map<number, WeakRef<VideoRef>>();
  const standbyPrerollTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let layerSeq = 0;
  let handoffCleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let outgoingCleanupArmedForId = 0;
  let groupScrollRef: ScrollRef | undefined;
  let groupScrollX = 0;

  const getVideoNode = (id: number): VideoRef | undefined => {
    const ref = videoNodeById.get(id);
    const node = ref?.deref();
    if (!node && ref) videoNodeById.delete(id);
    return node;
  };

  const pruneVideoTracking = (layers: VideoLayerItem[]) => {
    const liveIds = new Set(layers.map((item) => item.id));
    for (const id of [...videoNodeById.keys()]) {
      if (!liveIds.has(id)) videoNodeById.delete(id);
    }
    for (const [id, timer] of [...standbyPrerollTimers.entries()]) {
      if (!liveIds.has(id)) {
        clearTimeout(timer);
        standbyPrerollTimers.delete(id);
      }
    }
  };

  const videoLayers = signal<VideoLayerItem[]>([]);
  const setVideoLayers = (next: VideoLayerItem[]) => {
    pruneVideoTracking(next);
    videoLayers.set(next);
  };
  const updateVideoLayers = (updater: (prev: VideoLayerItem[]) => VideoLayerItem[]) => {
    videoLayers.update((prev) => {
      const next = updater(prev);
      pruneVideoTracking(next);
      return next;
    });
  };
  const activeLayerId = signal(0);
  const activeLayerReady = signal(false);

  const activeEpIndex = signal(props.initialEpisodeIndex);
  const paused = signal(false);
  const preparing = signal(true);
  const prepElapsedSec = signal(0);
  const decoderBuffering = signal(false);
  const showDeferredBuffer = signal(false);
  const errorMsg = signal<string | null>(null);
  const currentTime = signal(0);
  const duration = signal(0);
  const scrubbing = signal(false);
  const stageWidth = signal(760);
  const osdMessage = signal<string | null>(null);
  const controlsHidden = signal(false);

  const sidebarOpen = signal(true);
  const mobileSheetOpen = signal(false);
  const sidebarTab = signal<"episodes" | "seasons">("episodes");
  const activeGroupStart = signal(1);
  const danmakuComments = signal<DanmakuComment[]>([]);
  const favHeartMotion = createMotion();
  const centerPlayMotion = createMotion({ enter: "zoomIn", duration: 160 });

  let pendingResumeSec = props.initialResumeSec;
  let loadRequestToken = 0;
  let lastSavedSec = -1;
  let canAdvanceEpisode = false;
  let osdTimer: ReturnType<typeof setTimeout> | undefined;
  let bufferGraceTimer: ReturnType<typeof setTimeout> | undefined;
  let controlsHideTimer: ReturnType<typeof setTimeout> | undefined;
  let prepTickTimer: ReturnType<typeof setInterval> | undefined;

  const activeVideoRef = (): VideoRef | undefined => getVideoNode(activeLayerId());

  const flashOsd = (msg: string) => {
    osdMessage.set(msg);
    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osdMessage.set(null), 1250);
  };

  const isWide = () => (platform.idiom === "terminal" ? windowSize().width >= 96 : windowSize().width >= 860);
  const isLargeDesktop = () => platform.idiom !== "terminal" && windowSize().width >= 1220;
  const isFullScreen = () => win?.state()?.mode === "fullScreen";

  const wakeControls = () => {
    if (controlsHidden()) controlsHidden.set(false);
    if (controlsHideTimer) {
      clearTimeout(controlsHideTimer);
      controlsHideTimer = undefined;
    }
    if (isFullScreen() && !paused() && !scrubbing() && !props.hasModalOpen) {
      controlsHideTimer = setTimeout(() => {
        if (isFullScreen() && !paused() && !scrubbing() && !props.hasModalOpen) {
          controlsHidden.set(true);
        }
      }, 2800);
    }
  };

  effect(() => {
    const fs = isFullScreen();
    const isPaused = paused();
    const isScrub = scrubbing();
    if (!fs || isPaused || isScrub) {
      controlsHidden.set(false);
      if (controlsHideTimer) {
        clearTimeout(controlsHideTimer);
        controlsHideTimer = undefined;
      }
    } else {
      wakeControls();
    }
  });

  // Debounce decoder buffering spinner by 650ms so local/standby episode switches never blink a loading box!
  effect(() => {
    const isBuf = decoderBuffering();
    if (bufferGraceTimer) {
      clearTimeout(bufferGraceTimer);
      bufferGraceTimer = undefined;
    }
    if (!isBuf) {
      showDeferredBuffer.set(false);
      return;
    }
    bufferGraceTimer = setTimeout(() => {
      if (decoderBuffering()) showDeferredBuffer.set(true);
    }, 650);
  });

  // Track elapsed preparation seconds so cold HEVC transcode loads show dynamic, reassuring progress stages!
  effect(() => {
    const isPrep = Boolean(props.loadingSeriesDetail) || preparing();
    if (prepTickTimer) {
      clearInterval(prepTickTimer);
      prepTickTimer = undefined;
    }
    prepElapsedSec.set(0);
    if (!isPrep) return;
    prepTickTimer = setInterval(() => {
      prepElapsedSec.update((s) => s + 1);
    }, 1000);
  });

  // Auto-keep active Episode Group Pill (`1-30` .. `181-186`) scrolled into view when switching episodes!
  effect(() => {
    const start = activeGroupStart();
    const idx = Math.max(0, Math.floor((start - 1) / EPISODES_PER_GROUP));
    const targetX = Math.max(0, idx * 58 - 40);
    groupScrollX = targetX;
    groupScrollRef?.scrollTo({ x: targetX, animated: true });
  });

  cleanup(() => {
    if (osdTimer) clearTimeout(osdTimer);
    if (bufferGraceTimer) clearTimeout(bufferGraceTimer);
    if (controlsHideTimer) clearTimeout(controlsHideTimer);
    if (prepTickTimer) clearInterval(prepTickTimer);
    if (handoffCleanupTimer) clearTimeout(handoffCleanupTimer);
    for (const timer of standbyPrerollTimers.values()) clearTimeout(timer);
    standbyPrerollTimers.clear();
    videoNodeById.clear();
    groupScrollRef = undefined;
    loadRequestToken++;
    // Stop in-flight background downloads while keeping completed episodes in cache!
    episodePreloader.cancelPendingPrefetches();
  });

  const totalEpisodeCount = () => props.series.total || props.series.episode_count || props.series.episodes.length;

  const currentEpisode = (): EpisodeItem | undefined =>
    props.series.episodes.find((e) => e.vid_index === activeEpIndex()) ?? props.series.episodes[0];

  const episodeGroups = (): EpisodeGroup[] => {
    const total = props.series.episodes.length;
    const out: EpisodeGroup[] = [];
    for (let start = 1; start <= total; start += EPISODES_PER_GROUP) {
      out.push({ start, end: Math.min(total, start + EPISODES_PER_GROUP - 1) });
    }
    return out;
  };

  const currentGroupEpisodes = (): EpisodeItem[] => {
    const start = activeGroupStart();
    const end = start + EPISODES_PER_GROUP - 1;
    return props.series.episodes.filter((ep) => ep.vid_index >= start && ep.vid_index <= end);
  };

  const preloadedReadyCount = (): number => {
    const statusMap = episodePreloader.statusByVid();
    const idx = activeEpIndex();
    return props.series.episodes.filter(
      (ep) => ep.vid_index > idx && ep.vid_index <= idx + 3 && statusMap[ep.vid] === "ready",
    ).length;
  };

  const upcomingCount = (): number => {
    const idx = activeEpIndex();
    return props.series.episodes.filter((ep) => ep.vid_index > idx && ep.vid_index <= idx + 3).length;
  };

  // Prefetch next episode's danmaku & pre-mount at most ONE `standby` `<Video>` (`N+1`)
  // once active playback is warm AND the previous `outgoing` frame has been retired,
  // keeping peak concurrent IMFMediaEngine decoders <= 2 (low RAM + 0ms forward switches)!
  effect(() => {
    const curIdx = activeEpIndex();
    const isActiveWarm = activeLayerReady();
    const statusMap = episodePreloader.statusByVid();
    const nextEp = props.series.episodes.find((e) => e.vid_index === curIdx + 1);

    if (nextEp) {
      prefetchEpisodeDanmaku(nextEp.vid, nextEp.vid_index, nextEp.series_id ?? props.series.series_id);
    }

    if (!isActiveWarm) return;

    const currentLayers = videoLayers();
    if (currentLayers.some((item) => item.role === "outgoing")) return;

    const nextVid = nextEp?.vid;
    const hasStaleStandby = currentLayers.some(
      (item) => item.role === "standby" && item.vid !== nextVid,
    );
    let nextStandby: VideoLayerItem | null = null;
    if (
      nextEp &&
      !currentLayers.some((item) => item.vid === nextEp.vid) &&
      (statusMap[nextEp.vid] === "ready" || episodePreloader.isCached(nextEp.vid))
    ) {
      const cached = episodePreloader.peekCached(nextEp.vid);
      if (cached) {
        nextStandby = {
          id: ++layerSeq,
          epIndex: nextEp.vid_index,
          vid: nextEp.vid,
          src: cached.resolvedUrl,
          role: "standby",
          loaded: false,
          frameShown: false,
          duration: nextEp.duration_sec || 0,
        };
      }
    }

    if (!nextStandby && !hasStaleStandby) return;

    updateVideoLayers((prev) => {
      const retained = prev.filter((item) => item.role !== "standby" || item.vid === nextVid);
      if (!nextStandby || retained.some((item) => item.vid === nextStandby.vid)) return retained;
      return [...retained, nextStandby];
    });
  });

  const scheduleOutgoingCleanup = (forActiveId: number, delayMs: number, markArmed = true) => {
    if (handoffCleanupTimer) clearTimeout(handoffCleanupTimer);
    if (markArmed) outgoingCleanupArmedForId = forActiveId;
    handoffCleanupTimer = setTimeout(() => {
      handoffCleanupTimer = undefined;
      if (activeLayerId() !== forActiveId) return;
      updateVideoLayers((prev) => {
        const active = prev.find((item) => item.id === forActiveId);
        if (!active || !active.loaded) return prev;
        return prev
          .filter((item) => item.role !== "outgoing")
          .map((item) => (item.id === forActiveId ? { ...item, loaded: true, frameShown: true } : item));
      });
    }, delayMs);
  };

  const mountOrPromoteEpisode = (ep: EpisodeItem, resolvedUrl: string, resumeSec: number) => {
    pendingResumeSec = Math.max(0, resumeSec);
    outgoingCleanupArmedForId = 0;
    if (handoffCleanupTimer) {
      clearTimeout(handoffCleanupTimer);
      handoffCleanupTimer = undefined;
    }

    const existingStandby = videoLayers().find(
      (item) => item.role === "standby" && item.vid === ep.vid && item.src === resolvedUrl,
    );

    // Super-Fast Path 1: Pre-decoded standby `<Video>` already prerolled Frame 0 (`loaded && frameShown`) -> 0ms instant flip!
    // Keep outgoing's last frame underneath (`zIndex: 1`) for 450ms so incoming paints directly over it with ZERO black flash.
    if (existingStandby && existingStandby.loaded && existingStandby.frameShown) {
      if (pendingResumeSec > 0.2) {
        const dur = existingStandby.duration;
        const target = dur > 0 ? Math.min(pendingResumeSec, Math.max(0, dur - 0.5)) : pendingResumeSec;
        getVideoNode(existingStandby.id)?.seek(target);
        pendingResumeSec = 0;
      }
      batch(() => {
        activeLayerId.set(existingStandby.id);
        activeLayerReady.set(true);
        preparing.set(false);
        decoderBuffering.set(false);
        canAdvanceEpisode = true;
        duration.set(Math.max(ep.duration_sec || 0, existingStandby.duration));
        currentTime.set(Math.max(0, resumeSec));
        paused.set(false);
        updateVideoLayers((prev) => {
          const currentShown =
            prev.find((item) => item.role === "active" && item.frameShown) ??
            prev.find((item) => item.role === "outgoing" && item.frameShown);
          const outgoing: VideoLayerItem[] = currentShown
            ? [{ ...currentShown, role: "outgoing" }]
            : [];
          return [...outgoing, { ...existingStandby, role: "active", frameShown: true }];
        });
      });
      scheduleOutgoingCleanup(existingStandby.id, 450, true);
      return;
    }

    // Fast Path 2: Standby is mid-load OR random jump -> keep previous episode's last frame frozen at `zIndex: 1, opacity: 1`.
    // On Windows, `VideoItem::draw` is 100% transparent until `TransferVideoFrame` sets `frame.filled = true`, so mounting
    // incoming on top at `zIndex: 2, opacity: 1` directly covers outgoing on the exact VSync Frame 0 arrives!
    const incomingId = existingStandby ? existingStandby.id : ++layerSeq;
    batch(() => {
      activeLayerId.set(incomingId);
      activeLayerReady.set(false);
      preparing.set(false);
      decoderBuffering.set(true);
      canAdvanceEpisode = false;
      duration.set(ep.duration_sec || 0);
      currentTime.set(Math.max(0, resumeSec));
      paused.set(false);
      updateVideoLayers((prev) => {
        const currentShown =
          prev.find((item) => item.role === "active" && item.frameShown) ??
          prev.find((item) => item.role === "outgoing" && item.frameShown);
        const outgoing: VideoLayerItem[] = currentShown
          ? [{ ...currentShown, role: "outgoing" }]
          : [];
        const incoming: VideoLayerItem = existingStandby
          ? { ...existingStandby, role: "active", frameShown: false }
          : {
              id: incomingId,
              epIndex: ep.vid_index,
              vid: ep.vid,
              src: resolvedUrl,
              role: "active",
              loaded: false,
              frameShown: false,
              duration: ep.duration_sec || 0,
            };
        return [...outgoing, incoming];
      });
    });

    // Safety cap if stream starts paused or never advances progress
    scheduleOutgoingCleanup(incomingId, 2000, false);
  };

  const startEpisodeLoad = (ep: EpisodeItem, resumeSec = 0) => {
    const token = ++loadRequestToken;
    canAdvanceEpisode = false;
    lastSavedSec = -1;
    const expectedGroupStart = Math.floor((ep.vid_index - 1) / EPISODES_PER_GROUP) * EPISODES_PER_GROUP + 1;

    batch(() => {
      activeEpIndex.set(ep.vid_index);
      activeGroupStart.set(expectedGroupStart);
      errorMsg.set(null);
    });

    void fetchEpisodeDanmaku(ep.vid, ep.vid_index, ep.series_id ?? props.series.series_id)
      .then((items) => {
        if (token === loadRequestToken) danmakuComments.set(items);
      })
      .catch(() => {
        if (token === loadRequestToken) danmakuComments.set([]);
      });

    void recordWatchProgress({
      series_id: props.series.series_id,
      series_title: props.series.series_title,
      cover: props.series.cover,
      episode_count: totalEpisodeCount(),
      episode_index: ep.vid_index,
      vid: ep.vid,
      position_sec: Math.max(0, resumeSec),
      duration_sec: ep.duration_sec || 0,
    });

    // Fast Path: Synchronous cache hit (`peekCached`) -> promote standby (0ms!) or overlap-handoff without black flash!
    const syncCached = episodePreloader.peekCached(ep.vid);
    if (syncCached) {
      void episodePreloader.acquireForPlayback(ep).catch(() => {});
      episodePreloader.scheduleUpcoming(props.series.episodes, ep.vid_index);
      mountOrPromoteEpisode(ep, syncCached.resolvedUrl, resumeSec);
      return;
    }

    // Slow Path: Uncached episode -> pause outgoing visible frame (discarding stale standby), show preparation badge!
    batch(() => {
      paused.set(true);
      preparing.set(true);
      decoderBuffering.set(false);
      currentTime.set(Math.max(0, resumeSec));
      duration.set(ep.duration_sec || 0);
      updateVideoLayers((prev) => prev.filter((item) => item.role !== "standby"));
    });

    void episodePreloader
      .acquireForPlayback(ep)
      .then((cached) => {
        if (token !== loadRequestToken) return;
        mountOrPromoteEpisode(ep, cached.resolvedUrl, resumeSec);
        episodePreloader.scheduleUpcoming(props.series.episodes, ep.vid_index);
      })
      .catch((err) => {
        if (token !== loadRequestToken) return;
        if (err instanceof Error && /Aborted|superseded|Cleared|exited/i.test(err.message)) return;
        preparing.set(false);
        decoderBuffering.set(false);
        errorMsg.set(
          err instanceof Error && err.message
            ? `片源加载失败：${err.message}`
            : "当前分集暂时无法加载，请检查网络或重试本集。",
        );
      });
  };

  let initializedKey = "";
  effect(() => {
    const sid = props.series.series_id;
    const epLen = props.series.episodes.length;
    if (epLen === 0) {
      // Optimistic Theater shell while `fetchSeriesDetail` is still in flight
      activeEpIndex.set(props.initialEpisodeIndex);
      preparing.set(true);
      return;
    }
    const key = `${sid}:${epLen > 0 ? "ready" : "pending"}`;
    if (key !== initializedKey) {
      initializedKey = key;
      episodePreloader.cancelPendingPrefetches();
      batch(() => {
        setVideoLayers([]);
        activeLayerId.set(0);
        activeLayerReady.set(false);
      });
      const targetIdx = props.initialEpisodeIndex;
      const ep =
        props.series.episodes.find((e) => e.vid_index === targetIdx) ?? props.series.episodes[0];
      if (ep) {
        startEpisodeLoad(ep, props.initialResumeSec);
      }
    }
  });

  const switchEpisode = (ep: EpisodeItem, silentIfSeamless = false) => {
    mobileSheetOpen.set(false);
    const wasCached = episodePreloader.isCached(ep.vid);
    startEpisodeLoad(ep, 0);
    if (!silentIfSeamless) {
      flashOsd(wasCached ? `第 ${ep.vid_index} 集` : `正在准备第 ${ep.vid_index} 集`);
    }
  };

  const playPrevEpisode = () => {
    const prevIdx = activeEpIndex() - 1;
    const prev = props.series.episodes.find((e) => e.vid_index === prevIdx);
    if (prev) switchEpisode(prev);
  };

  const playNextEpisode = (autoEnded = false) => {
    const nextIdx = activeEpIndex() + 1;
    const next = props.series.episodes.find((e) => e.vid_index === nextIdx);
    if (next) {
      switchEpisode(next, autoEnded);
      return;
    }
    // End of current season: seamlessly auto-continue to the next season if available!
    const { seasonNum } = parseSeasonInfo(props.series.series_title);
    const nextSeason = props.relatedSeasons.find(
      (s) => s.series_id !== props.series.series_id && s.seasonNum === seasonNum + 1,
    );
    if (nextSeason) {
      showToast(`本季已播完，正在自动连播《${nextSeason.series_title}》`, "success");
      props.onSelectSeason(nextSeason);
    } else {
      paused.set(true);
      showToast("已播放至本季最后一集");
    }
  };

  const retryCurrentEpisode = () => {
    const ep = currentEpisode();
    if (!ep) return;
    const resumeAt = Math.max(currentTime(), pendingResumeSec);
    episodePreloader.invalidate(ep.vid);
    batch(() => {
      setVideoLayers([]);
      activeLayerId.set(0);
      activeLayerReady.set(false);
    });
    startEpisodeLoad(ep, resumeAt);
    flashOsd(resumeAt > 0 ? `正在从 ${formatDuration(resumeAt)} 恢复播放…` : "正在重试本集…");
  };

  const togglePlay = () => {
    if (props.loadingSeriesDetail || preparing()) return;
    const nextPaused = !paused();
    paused.set(nextPaused);
    if (nextPaused) {
      void centerPlayMotion.play("zoomIn", { duration: 160 });
    } else {
      wakeControls();
    }
  };

  const handleStagePress = (e: PressEvent) => {
    wakeControls();
    if (e.clickCount >= 2) {
      if (paused() && !preparing() && !errorMsg()) paused.set(false);
      toggleFullScreen();
      return;
    }
    togglePlay();
  };

  const seekBy = (deltaSec: number) => {
    wakeControls();
    const maxDur = duration() || currentEpisode()?.duration_sec || 0;
    if (maxDur <= 0) return;
    const target = Math.min(maxDur, Math.max(0, currentTime() + deltaSec));
    currentTime.set(target);
    activeVideoRef()?.seek(target);
    flashOsd(`${deltaSec > 0 ? "快进" : "快退"}至 ${formatDuration(target)}`);
  };

  const toggleMute = () => {
    wakeControls();
    const nextMuted = !props.prefs.isMuted;
    void updatePlayerPreferences({ isMuted: nextMuted });
    flashOsd(nextMuted ? "已静音" : `音量 ${Math.round(props.prefs.volume * 100)}%`);
  };

  const toggleDanmakuQuick = () => {
    wakeControls();
    const next = !props.prefs.danmakuEnabled;
    void updatePlayerPreferences({ danmakuEnabled: next });
    flashOsd(next ? "弹幕已开启" : "弹幕已关闭");
  };

  const toggleFullScreen = () => {
    if (!win) {
      showToast("当前运行环境由宿主管理全屏视图");
      return;
    }
    const nextMode = isFullScreen() ? "normal" : "fullScreen";
    win.setMode(nextMode);
    controlsHidden.set(false);
    flashOsd(nextMode === "fullScreen" ? "已进入全屏" : "已退出全屏");
  };

  const toggleFitMode = () => {
    wakeControls();
    const nextFit: FitMode = props.prefs.fitMode === "contain" ? "cover" : "contain";
    void updatePlayerPreferences({ fitMode: nextFit });
    flashOsd(nextFit === "contain" ? "画面：完整适应" : "画面：裁切铺满");
  };

  const toggleSidebar = () => {
    wakeControls();
    if (isWide()) {
      animateLayoutChange();
      sidebarOpen.update((v) => !v);
    } else {
      mobileSheetOpen.update((v) => !v);
    }
  };

  const handleToggleFavorite = () => {
    void favHeartMotion.play("heartbeat", { duration: 420 });
    props.onToggleFavorite();
  };

  keymap.bind(
    {
      space: () => {
        if (!props.hasModalOpen) togglePlay();
      },
      k: () => {
        if (!props.hasModalOpen) togglePlay();
      },
      up: () => {
        if (!props.hasModalOpen) playPrevEpisode();
      },
      pageup: () => {
        if (!props.hasModalOpen) playPrevEpisode();
      },
      down: () => {
        if (!props.hasModalOpen) playNextEpisode(false);
      },
      pagedown: () => {
        if (!props.hasModalOpen) playNextEpisode(false);
      },
      left: () => {
        if (!props.hasModalOpen) seekBy(-5);
      },
      right: () => {
        if (!props.hasModalOpen) seekBy(5);
      },
      m: () => {
        if (!props.hasModalOpen) toggleMute();
      },
      d: () => {
        if (!props.hasModalOpen) toggleDanmakuQuick();
      },
      s: () => {
        if (!props.hasModalOpen) toggleSidebar();
      },
      f: () => {
        if (!props.hasModalOpen) toggleFullScreen();
      },
      escape: () => {
        if (props.hasModalOpen) return;
        if (isFullScreen() && win) {
          win.setMode("normal");
        } else {
          props.onExitTheater();
        }
      },
    },
    { when: "notEditing" },
  );

  const handleVolumeWheel = (e: WheelEvent) => {
    wakeControls();
    const dy = e.delta.y;
    if (Math.abs(dy) < 0.01) return;
    const step = dy < 0 ? 5 : -5;
    const curPct = props.prefs.isMuted ? 0 : Math.round(props.prefs.volume * 100);
    const nextPct = Math.min(100, Math.max(0, curPct + step));
    void updatePlayerPreferences({
      volume: nextPct / 100,
      isMuted: nextPct === 0,
    });
    flashOsd(nextPct === 0 ? "已静音" : `音量 ${nextPct}%`);
  };

  const handleGroupTabsWheel = (e: WheelEvent) => {
    if (Math.abs(e.delta.y) <= Math.abs(e.delta.x)) return;
    const stepPx = e.deltaMode === "lines" ? e.delta.y * 36 : e.delta.y;
    const nextX = Math.max(0, groupScrollX + stepPx);
    groupScrollX = nextX;
    groupScrollRef?.scrollTo({ x: nextX, animated: false });
  };

  const showLoadingCard = () =>
    !errorMsg() && (Boolean(props.loadingSeriesDetail) || preparing() || showDeferredBuffer());

  const loadingStageLabel = () => {
    if (props.loadingSeriesDetail) return "正在获取剧集目录...";
    if (preparing()) {
      const sec = prepElapsedSec();
      const idx = activeEpIndex();
      if (sec < 2) return `正在连接并请求第 ${idx} 集片源...`;
      if (sec < 6) return `正在高速拉取并解密第 ${idx} 集...`;
      return `正在优化第 ${idx} 集高清画质（后续剧集将自动后台无感预载）...`;
    }
    return "正在缓冲画面...";
  };

  const hasAnyDecodedFrame = () => videoLayers().some((item) => item.frameShown);

  const renderSidebarBody = () => {
    const watchedList = () => getSeriesProgress(props.series.series_id)?.watched_indexes ?? [];
    const statusMap = () => episodePreloader.statusByVid();

    return (
      <View class="flex-1 gap-3">
        {/* Drama Info Header Card (`.sidebar-drama-header`) */}
        <View class="relative gap-2.5 rounded-md border border-border bg-card/55 p-3">
          {/* Top-right circular heart icon button */}
          <View style={favHeartMotion.style} class="absolute top-2.5 right-2.5 z-10">
            <UiIconButton
              testID="sidebar-fav-btn"
              icon={props.isFavorited ? "heartFilled" : "heart"}
              variant={props.isFavorited ? "primary" : "outline"}
              size="sm"
              selected={props.isFavorited}
              accessibilityLabel={props.isFavorited ? "已收藏此剧" : "收藏此剧"}
              onPress={handleToggleFavorite}
              class="rounded-full"
            />
          </View>

          <View class="flex-row items-start gap-3 pr-8">
            <If when={platform.idiom !== "terminal" && Boolean(props.series.cover)}>
              <Image src={props.series.cover} class="h-[86px] w-16 shrink-0 rounded-md object-cover shadow-md" />
            </If>
            <View class="min-w-0 flex-1 items-start gap-1">
              <UiButton
                testID="open-drama-detail-card"
                variant="ghost"
                accessibilityLabel={`查看《${props.series.series_title}》剧情详情`}
                onPress={props.onOpenDramaDetail}
                class="h-auto w-full justify-start overflow-hidden p-0 hover:bg-transparent"
              >
                <View class="min-w-0 flex-1">
                  <Text style={{ numberOfLines: 1 }} class="text-left text-sm font-semibold text-foreground">
                    {props.series.series_title}
                  </Text>
                </View>
              </UiButton>

              <View class="flex-row flex-wrap items-center gap-1.5">
                <Text class="text-[11px] text-dim">共 {totalEpisodeCount()} 集全</Text>
                <If when={props.series.social_info?.hot_text}>
                  {(hot) => <UiBadge label={`🔥 ${hot()}`} tone="hot" />}
                </If>
                <If when={props.series.social_info?.rating}>
                  {(r) => <UiBadge label={`⭐ ${r()}分`} tone="gold" />}
                </If>
              </View>

              <View class="flex-row flex-wrap items-center gap-1 pt-0.5">
                <Each of={props.series.tags.slice(0, 3)} key={(t) => t}>
                  {(t) => <UiBadge label={t()} tone="subtle" />}
                </Each>
              </View>

              <If when={props.relatedSeasons.length > 0 || props.checkingSeasons}>
                <View class="pt-1">
                  <UiButton
                    testID="open-seasons-modal-btn"
                    variant="seasonPill"
                    size="sm"
                    label={
                      props.checkingSeasons && props.relatedSeasons.length === 0
                        ? "📚 系列各季..."
                        : `📚 系列全季 (${props.relatedSeasons.length})`
                    }
                    onPress={props.onOpenSeasonsModal}
                    class="h-6 px-2.5"
                  />
                </View>
              </If>
            </View>
          </View>

          <If when={props.series.intro || props.series.description}>
            <UiButton
              variant="ghost"
              accessibilityLabel="查看完整剧情介绍"
              onPress={props.onOpenDramaDetail}
              class="h-auto w-full items-start justify-start overflow-hidden border-t border-border/60 px-0 pt-2 pb-0 hover:bg-transparent"
            >
              <View class="min-w-0 flex-1 gap-1">
                <Text style={{ numberOfLines: 2 }} class="text-left text-xs leading-relaxed text-dim">
                  {props.series.intro || props.series.description}
                </Text>
                <View class="w-full flex-row items-center justify-end">
                  <Text class="text-[11px] font-semibold text-primary">查看剧情与演职员 ↗</Text>
                </View>
              </View>
            </UiButton>
          </If>
        </View>

        {/* Sidebar View Switcher: [选集] vs [📚 系列全季] */}
        <If when={props.relatedSeasons.length > 1}>
          <UiTabs variant="sidebar" class="rounded-md border border-border">
            <UiTab
              testID="sidebar-tab-episodes"
              label={`选集 (${totalEpisodeCount()})`}
              selected={sidebarTab() === "episodes"}
              onPress={() => sidebarTab.set("episodes")}
              class="flex-1"
            />
            <UiTab
              testID="sidebar-tab-seasons"
              label={`📚 系列全季 (${props.relatedSeasons.length})`}
              selected={sidebarTab() === "seasons"}
              onPress={() => {
                sidebarTab.set("seasons");
                if (props.relatedSeasons.length === 0) props.onRefreshSeasons();
              }}
              class="flex-1"
            />
          </UiTabs>
        </If>

        {/* Panel 1: Grouped 5-Column Episode Grid */}
        <If
          when={sidebarTab() === "episodes"}
          else={
            <View class="flex-1 gap-2">
              <View class="flex-row items-center justify-between px-1">
                <Text class="text-[11px] text-dim">已按剧集顺序排好序</Text>
                <UiButton
                  variant="ghost"
                  size="sm"
                  label="⛶ 弹窗大图"
                  onPress={props.onOpenSeasonsModal}
                />
              </View>
              <Scroll class="flex-1">
                <View class="gap-2 pr-1">
                  <Each of={props.relatedSeasons} key={(s) => s.series_id}>
                    {(season) => {
                      const isCurrent = () => season().series_id === props.series.series_id;
                      return (
                        <UiButton
                          variant="outline"
                          selected={isCurrent()}
                          onPress={() => props.onSelectSeason(season())}
                          class="h-auto w-full justify-start gap-2.5 p-2"
                        >
                          <If when={platform.idiom !== "terminal"}>
                            <View class="relative h-[60px] w-11 shrink-0 overflow-hidden rounded-sm bg-muted">
                              <Image src={season().cover} class="size-full object-cover" />
                              <View class="absolute top-0.5 left-0.5 rounded-sm bg-stage/80 px-1">
                                <Text class="text-[10px] font-bold text-primary">{season().seasonLabel}</Text>
                              </View>
                            </View>
                          </If>
                          <View class="min-w-0 flex-1 items-start gap-1">
                            <View class="w-full flex-row items-center justify-between gap-1">
                              <View class="min-w-0 flex-1">
                                <Text style={{ numberOfLines: 1 }} class="text-left text-xs font-semibold text-foreground">
                                  {season().series_title}
                                </Text>
                              </View>
                              <If when={isCurrent()}>
                                <UiBadge label="播放中" tone="solidPrimary" pill />
                              </If>
                            </View>
                            <View class="flex-row items-center gap-2">
                              <Text class="text-[11px] text-dim">共 {season().total} 集</Text>
                              <If when={season().social_info?.hot_text}>
                                {(h) => <Text class="text-[11px] text-hot">🔥 {h()}</Text>}
                              </If>
                              <If when={season().social_info?.rating}>
                                {(r) => <Text class="text-[11px] text-gold">⭐ {r()}</Text>}
                              </If>
                            </View>
                          </View>
                        </UiButton>
                      );
                    }}
                  </Each>
                </View>
              </Scroll>
            </View>
          }
        >
          <If
            when={!props.loadingSeriesDetail && props.series.episodes.length > 0}
            else={
              <View class="flex-1 gap-2.5 pt-1">
                <UiSkeleton class="h-7 w-40" />
                <Each of={[1, 2, 3, 4]} key={(r) => r}>
                  {() => (
                    <View class="flex-row gap-2">
                      <Each of={[1, 2, 3, 4, 5]} key={(c) => c}>
                        {() => <UiSkeleton class="h-11 flex-1" />}
                      </Each>
                    </View>
                  )}
                </Each>
              </View>
            }
          >
            <View class="flex-1 gap-2.5">
              {/* Episode Group Range Tabs (`1-30` .. `181-202`): wrap cleanly up to 12 groups; scroll + chevrons for ultra-long series */}
              <View onWheel={handleGroupTabsWheel} class="flex-row items-center justify-between gap-2 pt-0.5">
                <If
                  when={episodeGroups().length <= 12}
                  else={
                    <View class="min-w-0 flex-1 flex-row items-center gap-1">
                      <UiIconButton
                        icon="chevronLeft"
                        variant="ghost"
                        size="sm"
                        accessibilityLabel="向左滚动集数分组"
                        onPress={() => {
                          groupScrollX = Math.max(0, groupScrollX - 180);
                          groupScrollRef?.scrollTo({ x: groupScrollX, animated: true });
                        }}
                      />
                      <Scroll
                        ref={(node) => {
                          groupScrollRef = node;
                        }}
                        horizontal
                        scrollbar={false}
                        onScroll={(e) => {
                          groupScrollX = e.offset.x;
                        }}
                        class="min-w-0 flex-1"
                      >
                        <View class="flex-row items-center gap-1.5 pr-1">
                          <Each of={episodeGroups()} key={(g) => `${g.start}-${g.end}`}>
                            {(group) => (
                              <UiButton
                                testID={`ep-group-${group().start}-${group().end}`}
                                variant="group"
                                size="sm"
                                selected={activeGroupStart() === group().start}
                                label={`${group().start}-${group().end}`}
                                onPress={() => activeGroupStart.set(group().start)}
                                class="h-7 shrink-0 px-2"
                              />
                            )}
                          </Each>
                        </View>
                      </Scroll>
                      <UiIconButton
                        icon="chevronRight"
                        variant="ghost"
                        size="sm"
                        accessibilityLabel="向右滚动集数分组"
                        onPress={() => {
                          groupScrollX = Math.max(0, groupScrollX + 180);
                          groupScrollRef?.scrollTo({ x: groupScrollX, animated: true });
                        }}
                      />
                    </View>
                  }
                >
                  <View class="min-w-0 flex-1 flex-row flex-wrap items-center gap-1.5">
                    <Each of={episodeGroups()} key={(g) => `${g.start}-${g.end}`}>
                      {(group) => (
                        <UiButton
                          testID={`ep-group-${group().start}-${group().end}`}
                          variant="group"
                          size="sm"
                          selected={activeGroupStart() === group().start}
                          label={`${group().start}-${group().end}`}
                          onPress={() => activeGroupStart.set(group().start)}
                          class="h-7 shrink-0 px-2"
                        />
                      )}
                    </Each>
                  </View>
                </If>
                <If when={!isWide() && upcomingCount() > 0}>
                  <Text
                    class={`shrink-0 text-[11px] tabular-nums ${
                      preloadedReadyCount() >= upcomingCount() ? "text-success" : "text-dim"
                    }`}
                  >
                    预载 {preloadedReadyCount()}/{upcomingCount()} 集
                  </Text>
                </If>
              </View>

              {/* 5-Column Episode Matrix (`.episode-grid`) with subtle preload readiness dots */}
              <Scroll class="flex-1">
                <View class="gap-2 pr-0.5 pb-2">
                  <Each
                    of={chunkRows(currentGroupEpisodes(), 5)}
                    key={(row) => row.map((e) => e.vid).join(",")}
                  >
                    {(row) => {
                      const pad = () => Math.max(0, 5 - row().length);
                      return (
                        <View class="flex-row gap-2">
                          <Each of={row()} key={(ep) => ep.vid}>
                            {(ep) => {
                              const isCurrent = () => ep().vid_index === activeEpIndex();
                              const isWatched = () => watchedList().includes(ep().vid_index);
                              const epStatus = () => statusMap()[ep().vid];
                              return (
                                <View class="relative flex-1">
                                  <UiButton
                                    testID={`ep-btn-${ep().vid_index}`}
                                    variant="episode"
                                    selected={isCurrent()}
                                    accessibilityLabel={`第 ${ep().vid_index} 集${isCurrent() ? "，正在播放" : ""}`}
                                    onPress={() => switchEpisode(ep())}
                                    class={`h-11 w-full px-0 ${isWatched() && !isCurrent() ? "border-dashed opacity-80" : ""}`}
                                  >
                                    <View class="flex-row items-center justify-center gap-1">
                                      <If when={isCurrent()}>
                                        <Text class="text-[10px] text-primary-foreground">▶</Text>
                                      </If>
                                      <Text
                                        class={`text-sm tabular-nums ${
                                          isCurrent()
                                            ? "font-bold text-primary-foreground"
                                            : isWatched()
                                              ? "text-dim"
                                              : "font-medium text-muted-foreground"
                                        }`}
                                      >
                                        {String(ep().vid_index)}
                                      </Text>
                                    </View>
                                  </UiButton>
                                  <If when={!isCurrent() && (epStatus() === "ready" || epStatus() === "loading")}>
                                    <View
                                      class={`pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full ${
                                        epStatus() === "ready" ? "bg-success" : "bg-hot"
                                      }`}
                                    />
                                  </If>
                                </View>
                              );
                            }}
                          </Each>
                          <Each of={Array.from({ length: pad() }, (_, i) => i)} key={(i) => i}>
                            {() => <View class="h-11 flex-1" />}
                          </Each>
                        </View>
                      );
                    }}
                  </Each>
                </View>
              </Scroll>
            </View>
          </If>
        </If>
      </View>
    );
  };

  return (
    <View onMouseMove={wakeControls} class="flex-1 flex-row bg-stage">
      {/* Main Theater Player Column */}
      <View
        class={`relative min-w-0 flex-1 bg-stage-panel ${
          isWide() && sidebarOpen() && !isFullScreen() ? "border-r border-border" : ""
        }`}
      >
        {/* 52px Player Header (docked in windowed mode; auto-hiding top overlay in fullscreen) */}
        <If when={!isFullScreen() || !controlsHidden()}>
          <View
            class={`h-[52px] flex-row items-center justify-between gap-2 px-5 ${
              isFullScreen()
                ? "absolute inset-x-0 top-0 z-20 bg-stage/80"
                : "border-b border-border bg-stage-header"
            }`}
          >
            <UiButton
              testID="exit-theater-btn"
              variant="stage"
              size="sm"
              icon="chevronLeft"
              label={isFullScreen() ? "退出全屏" : isWide() ? "退出播放" : "返回"}
              onPress={() => {
                if (isFullScreen() && win) win.setMode("normal");
                else props.onExitTheater();
              }}
              class="shrink-0"
            />

            <View class="min-w-0 flex-1 flex-row items-center justify-center gap-2.5 overflow-hidden px-2">
              <Text style={{ numberOfLines: 1 }} class="shrink text-[15px] font-semibold text-stage-foreground">
                {props.series.series_title}
              </Text>
              <View class="shrink-0 rounded-sm bg-stage-foreground/8 px-2 py-0.5">
                <Text class="text-xs font-semibold tabular-nums text-muted-foreground">
                  {isWide()
                    ? `第 ${activeEpIndex()} 集 / 全 ${totalEpisodeCount()} 集`
                    : `${activeEpIndex()}/${totalEpisodeCount()} 集`}
                </Text>
              </View>
              <If when={isWide() && upcomingCount() > 0}>
                <View
                  class={`shrink-0 flex-row items-center gap-1 rounded-sm border px-2 py-0.5 ${
                    preloadedReadyCount() >= upcomingCount()
                      ? "border-success/35 bg-success/12"
                      : "border-stage-foreground/12 bg-stage-foreground/6"
                  }`}
                >
                  <If when={preloadedReadyCount() >= upcomingCount()}>
                    <Text class="text-[11px] font-bold text-success">✓</Text>
                  </If>
                  <Text
                    class={`text-xs font-medium tabular-nums ${
                      preloadedReadyCount() >= upcomingCount() ? "text-success" : "text-stage-muted"
                    }`}
                  >
                    预载 {preloadedReadyCount()}/{upcomingCount()} 集
                  </Text>
                </View>
              </If>
            </View>

            <View class="shrink-0 flex-row items-center gap-2">
              <UiButton
                testID="theater-fav-btn"
                variant="stage"
                selected={props.isFavorited}
                size="sm"
                label={props.isFavorited ? "❤️ 已收藏" : "🤍 收藏"}
                onPress={handleToggleFavorite}
              />
              <If when={!isFullScreen()}>
                <UiButton
                  testID="toggle-sidebar-btn"
                  variant="stage"
                  size="sm"
                  icon={sidebarOpen() && isWide() ? "sidebarClose" : "sidebarOpen"}
                  label={isWide() ? (sidebarOpen() ? "隐藏侧边栏" : "显示侧边栏") : "选集"}
                  onPress={toggleSidebar}
                />
              </If>
            </View>
          </View>
        </If>

        {/* Center Video Stage (`.video-stage`) with Dual-Slot `<Video>` A/B Standby Deck */}
        <View
          onLayout={(e) => stageWidth.set(e.bounds.size.width)}
          onPress={handleStagePress}
          class="relative flex-1 items-center justify-center overflow-hidden bg-stage"
        >
          {/* Ambient blurred cover backdrop shown only before the first video frame is decoded */}
          <If when={!hasAnyDecodedFrame() && platform.idiom !== "terminal" && Boolean(props.series.cover)}>
            <Image
              src={props.series.cover}
              blurRadius={26}
              class="pointer-events-none absolute inset-0 size-full object-cover opacity-30"
            />
          </If>

          {/* Keyed Immutable-Src Standby Deck + Zero-Black First-Frame Gate */}
          <If when={platform.idiom !== "terminal"}>
            <Each of={videoLayers()} key={(layer) => layer.id}>
              {(layer) => {
                const layerId = layer().id;
                cleanup(() => {
                  videoNodeById.delete(layerId);
                  const t = standbyPrerollTimers.get(layerId);
                  if (t) {
                    clearTimeout(t);
                    standbyPrerollTimers.delete(layerId);
                  }
                });
                const isActive = () => layer().role === "active" && layerId === activeLayerId();
                const layerOpacity = () => {
                  const role = layer().role;
                  if (role === "outgoing") return 1;
                  if (role === "standby") return 0;
                  // On Windows Direct2D, `VideoItem::draw` draws zero pixels until `TransferVideoFrame` fills Frame 0,
                  // so keeping `active` at `opacity: 1` lets Frame 0 paint directly over `outgoing`'s last frame on the exact VSync!
                  if (platform.os === "windows") return 1;
                  return layer().frameShown ? 1 : 0;
                };
                const layerZIndex = () => {
                  const role = layer().role;
                  if (role === "active") return 2;
                  if (role === "outgoing") return 1;
                  return 0;
                };

                return (
                  <View
                    style={{
                      opacity: layerOpacity(),
                      zIndex: layerZIndex(),
                      pointerEvents: "none",
                    }}
                    class="absolute inset-0"
                  >
                    <Video
                      ref={(node) => {
                        if (node) videoNodeById.set(layerId, new WeakRef(node));
                      }}
                      src={layer().src}
                      paused={!isActive() || paused()}
                      muted={!isActive() || props.prefs.isMuted}
                      volume={props.prefs.volume}
                      rate={isActive() ? Number(props.prefs.playbackRate) : undefined}
                      progressUpdateInterval={isActive() ? (activeLayerReady() ? 200 : 50) : 500}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: props.prefs.fitMode,
                      }}
                      onLoadStart={() => {
                        if (isActive() && !activeLayerReady()) {
                          decoderBuffering.set(true);
                        }
                      }}
                      onLoad={(e) => {
                        const myId = layerId;
                        const knownDur = Number.isFinite(e.duration) && e.duration > 0 ? e.duration : 0;

                        if (layer().role === "standby") {
                          updateVideoLayers((prev) =>
                            prev.map((item) =>
                              item.id === myId
                                ? { ...item, loaded: true, duration: knownDur || item.duration }
                                : item,
                            ),
                          );
                          // Mark Frame 0 preroll complete after 90ms so GPU texture transfer is 100% settled
                          const oldTimer = standbyPrerollTimers.get(myId);
                          if (oldTimer) clearTimeout(oldTimer);
                          standbyPrerollTimers.set(
                            myId,
                            setTimeout(() => {
                              standbyPrerollTimers.delete(myId);
                              updateVideoLayers((prev) =>
                                prev.map((item) =>
                                  item.id === myId && item.role === "standby"
                                    ? { ...item, frameShown: true }
                                    : item,
                                ),
                              );
                            }, 90),
                          );
                          return;
                        }

                        if (myId !== activeLayerId()) return;
                        const hasOutgoing = videoLayers().some((item) => item.role === "outgoing");

                        batch(() => {
                          canAdvanceEpisode = true;
                          preparing.set(false);
                          if (knownDur > 0) {
                            duration.set(Math.max(duration(), knownDur));
                          }
                          if (!hasOutgoing) {
                            activeLayerReady.set(true);
                            decoderBuffering.set(false);
                          }
                          updateVideoLayers((prev) =>
                            prev.map((item) =>
                              item.id === myId
                                ? {
                                    ...item,
                                    loaded: true,
                                    frameShown: !hasOutgoing ? true : item.frameShown,
                                    duration: knownDur || item.duration,
                                  }
                                : item,
                            ),
                          );
                        });

                        if (pendingResumeSec > 0.2) {
                          const target =
                            knownDur > 0
                              ? Math.min(pendingResumeSec, Math.max(0, knownDur - 0.5))
                              : pendingResumeSec;
                          getVideoNode(myId)?.seek(target);
                          currentTime.set(target);
                          pendingResumeSec = 0;
                        }
                      }}
                      onBuffer={(e) => {
                        if (!isActive() || layer().epIndex !== activeEpIndex()) return;
                        decoderBuffering.set(e.isBuffering);
                      }}
                      onProgress={(e) => {
                        const myId = layerId;
                        if (myId !== activeLayerId() || layer().epIndex !== activeEpIndex()) return;
                        if (!scrubbing()) {
                          currentTime.set(e.currentTime);
                        }
                        if (Number.isFinite(e.duration) && e.duration > 0) {
                          duration.set(Math.max(duration(), e.duration));
                        }
                        if (
                          e.currentTime >= 0.02 &&
                          (!layer().frameShown || !activeLayerReady() || decoderBuffering())
                        ) {
                          batch(() => {
                            activeLayerReady.set(true);
                            decoderBuffering.set(false);
                            updateVideoLayers((prev) =>
                              prev.map((item) => (item.id === myId ? { ...item, loaded: true, frameShown: true } : item)),
                            );
                          });
                        }
                        // Never remove `outgoing` immediately when audio clock hits 0.02s — keep previous episode's last frame
                        // safely underneath for 320ms so GPU `TransferVideoFrame` has painted ~15+ frames directly over it!
                        if (
                          e.currentTime >= 0.02 &&
                          outgoingCleanupArmedForId !== myId &&
                          videoLayers().some((item) => item.role === "outgoing")
                        ) {
                          scheduleOutgoingCleanup(myId, 320, true);
                        }
                        if (Math.abs(e.currentTime - lastSavedSec) >= 2) {
                          lastSavedSec = e.currentTime;
                          const ep = currentEpisode();
                          if (ep) {
                            void recordWatchProgress({
                              series_id: props.series.series_id,
                              series_title: props.series.series_title,
                              cover: props.series.cover,
                              episode_count: totalEpisodeCount(),
                              episode_index: ep.vid_index,
                              vid: ep.vid,
                              position_sec: e.currentTime,
                              duration_sec: e.duration || duration(),
                            });
                          }
                        }
                      }}
                      onEnd={() => {
                        if (!isActive() || layer().epIndex !== activeEpIndex()) return;
                        if (!canAdvanceEpisode || duration() <= 0 || currentTime() < duration() - 1.5) return;
                        canAdvanceEpisode = false;
                        playNextEpisode(true);
                      }}
                      onError={(e) => {
                        const myId = layerId;
                        if (layer().role === "standby") {
                          const badVid = layer().vid;
                          if (badVid) episodePreloader.invalidate(badVid);
                          updateVideoLayers((prev) => prev.filter((item) => item.id !== myId));
                          return;
                        }
                        if (!isActive() || layer().epIndex !== activeEpIndex()) return;
                        preparing.set(false);
                        decoderBuffering.set(false);
                        errorMsg.set(`视频加载失败（${e.message || "网络或解码异常"}）`);
                      }}
                    />
                  </View>
                );
              }}
            </Each>
          </If>

          <If when={platform.idiom === "terminal"}>
            <View class="items-center gap-2 p-4">
              <Text class="text-sm font-semibold text-stage-foreground">
                正在播放：{props.series.series_title} · 第 {activeEpIndex()} 集
              </Text>
              <Text class="text-xs text-stage-muted">
                状态：{paused() ? "已暂停" : "播放中"} · 画幅：{currentEpisode()?.aspect === "horizontal" ? "16:9 横屏" : "9:16 竖屏"}
              </Text>
            </View>
          </If>

          {/* Borderless Shadowed Danmaku Layer (`zIndex: 4`) */}
          <View style={{ zIndex: 4, pointerEvents: "none" }} class="pointer-events-none absolute inset-0">
            <DanmakuOverlay
              enabled={props.prefs.danmakuEnabled}
              comments={danmakuComments()}
              currentTime={currentTime()}
              isPlaying={!paused() && !preparing() && !showDeferredBuffer() && !errorMsg()}
              rows={props.prefs.danmakuRows}
              speed={props.prefs.danmakuSpeed}
              opacity={props.prefs.danmakuOpacity}
              likesPriority={props.prefs.danmakuLikesPriority}
              stageWidth={stageWidth()}
            />
          </View>

          {/* Subtle Top-Left OSD pill (never blocks center character faces or mimics a buffering card) */}
          <If when={osdMessage()}>
            {(msg) => (
              <View
                style={{ zIndex: 6 }}
                class="pointer-events-none absolute top-4 left-5 rounded-lg border border-stage-foreground/12 bg-stage/78 px-3.5 py-1.5 shadow-md"
              >
                <Text class="text-xs font-medium text-stage-foreground">{msg()}</Text>
              </View>
            )}
          </If>

          {/* Smart Debounced Stage Loading Card */}
          <If when={showLoadingCard()}>
            <View
              style={{ zIndex: 5 }}
              class="pointer-events-none items-center gap-3 rounded-xl border border-stage-foreground/12 bg-stage/78 px-7 py-4 shadow-xl"
            >
              <UiSpinner size={28} />
              <Text class="text-xs font-medium text-stage-foreground">{loadingStageLabel()}</Text>
            </View>
          </If>

          {/* Center 72x72 Paused Play Circle (`.play-overlay-btn`) */}
          <If when={paused() && !showLoadingCard() && !errorMsg()}>
            <View
              style={{ ...centerPlayMotion.style, zIndex: 5 }}
              class="size-[72px] items-center justify-center rounded-full bg-primary/85 shadow-lg"
            >
              <Icon name="play" size={30} tone="primary-foreground" />
            </View>
          </If>

          {/* Error Overlay */}
          <If when={errorMsg()}>
            {(errText) => (
              <View style={{ zIndex: 7 }} class="max-w-sm items-center gap-3.5 rounded-xl border border-border bg-stage/95 p-6 shadow-xl">
                <Icon name="alert" size={28} tone="destructive" />
                <Text class="text-center text-sm text-stage-foreground">{errText()}</Text>
                <UiButton
                  testID="retry-episode-btn"
                  variant="primary"
                  size="md"
                  label="重试本集"
                  onPress={retryCurrentEpisode}
                />
              </View>
            )}
          </If>
        </View>

        {/* 84px Bottom Player Controls (docked in windowed mode; auto-hiding bottom overlay in fullscreen) */}
        <If when={!isFullScreen() || !controlsHidden()}>
          <View
            class={`relative h-[84px] justify-center px-5 pb-1.5 ${
              isFullScreen()
                ? "absolute inset-x-0 bottom-0 z-20 bg-stage/85"
                : "border-t border-border bg-surface"
            }`}
          >
            {/* Scrubbing Timestamp Preview Pill */}
            <If when={scrubbing()}>
              <View class="pointer-events-none absolute -top-8 self-center rounded-md border border-border bg-popover px-2.5 py-1 shadow-md">
                <Text class="text-xs font-semibold tabular-nums text-popover-foreground">
                  {formatDuration(currentTime())} / {formatDuration(duration())}
                </Text>
              </View>
            </If>

            {/* Progress Slider (`#d45d69` progress tone) */}
            <UiSlider
              testID="seek-slider"
              tone="progress"
              value={currentTime()}
              min={0}
              max={Math.max(1, duration() || 12)}
              step={0.1}
              disabled={duration() <= 0}
              accessibilityLabel="播放进度"
              onChange={(val) => {
                scrubbing.set(true);
                currentTime.set(val);
              }}
              onChangeEnd={(val) => {
                scrubbing.set(false);
                currentTime.set(val);
                activeVideoRef()?.seek(val);
              }}
            />

            <View class="flex-row items-center justify-between gap-2">
              {/* Left Transport Controls */}
              <View class="flex-row items-center gap-2">
                <UiIconButton
                  testID="play-pause-btn"
                  icon={paused() ? "play" : "pause"}
                  variant="stageGhost"
                  size="md"
                  accessibilityLabel={paused() ? "播放" : "暂停"}
                  tooltip={paused() ? "播放 (Space)" : "暂停 (Space)"}
                  onPress={togglePlay}
                />
                <UiIconButton
                  testID="prev-episode-btn"
                  icon="prev"
                  variant="stageGhost"
                  size="md"
                  disabled={activeEpIndex() <= 1}
                  accessibilityLabel="上一集"
                  tooltip="上一集 (↑)"
                  onPress={playPrevEpisode}
                />
                <UiIconButton
                  testID="next-episode-btn"
                  icon="next"
                  variant="stageGhost"
                  size="md"
                  disabled={activeEpIndex() >= props.series.episodes.length && props.relatedSeasons.length <= 1}
                  accessibilityLabel="下一集"
                  tooltip="下一集 (↓)"
                  onPress={() => playNextEpisode(false)}
                />
                <Text class="ml-1.5 text-xs tabular-nums text-dim">
                  {formatDuration(currentTime())} / {formatDuration(duration())}
                </Text>
              </View>

              {/* Right Controls (`弹幕`, `⤢ 适应`, `1.0x ⌃`, `🔊`, `⛶`) */}
              <View class="flex-row items-center gap-3.5">
                <UiPopover
                  placement="top"
                  align="end"
                  class="w-64 p-4"
                  trigger={
                    <UiButton
                      testID="danmaku-settings-btn"
                      variant="stage"
                      size="sm"
                      selected={props.prefs.danmakuEnabled}
                      label="弹幕"
                      tooltip="弹幕设置 (D 快速开关)"
                    />
                  }
                >
                  <View class="gap-3">
                    <View class="flex-row items-center justify-between">
                      <Text class="text-xs font-semibold text-popover-foreground">弹幕设置</Text>
                      <UiSwitch
                        testID="danmaku-enable-switch"
                        checked={props.prefs.danmakuEnabled}
                        label={props.prefs.danmakuEnabled ? "已开启" : "已关闭"}
                        onChange={(checked) => void updatePlayerPreferences({ danmakuEnabled: checked })}
                      />
                    </View>

                    <View class="flex-row items-center justify-between">
                      <Text class="text-xs text-muted-foreground">显示行数</Text>
                      <View class="flex-row gap-1">
                        <Each of={[1, 3, 5] as const} key={(n) => n}>
                          {(rows) => (
                            <UiButton
                              variant="outline"
                              size="sm"
                              selected={props.prefs.danmakuRows === rows()}
                              label={`${rows()} 行`}
                              onPress={() => void updatePlayerPreferences({ danmakuRows: rows() })}
                            />
                          )}
                        </Each>
                      </View>
                    </View>

                    <View class="flex-row items-center justify-between">
                      <Text class="text-xs text-muted-foreground">滚动速度</Text>
                      <View class="flex-row gap-1">
                        <Each
                          of={[
                            { v: "fast" as DanmakuSpeed, l: "快" },
                            { v: "medium" as DanmakuSpeed, l: "中" },
                            { v: "slow" as DanmakuSpeed, l: "慢" },
                          ]}
                          key={(o) => o.v}
                        >
                          {(opt) => (
                            <UiButton
                              variant="outline"
                              size="sm"
                              selected={props.prefs.danmakuSpeed === opt().v}
                              label={opt().l}
                              onPress={() => void updatePlayerPreferences({ danmakuSpeed: opt().v })}
                            />
                          )}
                        </Each>
                      </View>
                    </View>

                    <View class="gap-1">
                      <View class="flex-row items-center justify-between">
                        <Text class="text-xs text-muted-foreground">不透明度</Text>
                        <Text class="text-xs tabular-nums text-popover-foreground">
                          {Math.round(props.prefs.danmakuOpacity * 100)}%
                        </Text>
                      </View>
                      <UiSlider
                        value={Math.round(props.prefs.danmakuOpacity * 100)}
                        min={10}
                        max={100}
                        step={10}
                        accessibilityLabel="弹幕不透明度"
                        onChange={(v) => void updatePlayerPreferences({ danmakuOpacity: v / 100 })}
                      />
                    </View>

                    <View class="flex-row items-center justify-between">
                      <Text class="text-xs text-muted-foreground">高赞优先</Text>
                      <UiSwitch
                        checked={props.prefs.danmakuLikesPriority}
                        accessibilityLabel="高赞弹幕优先"
                        onChange={(checked) => void updatePlayerPreferences({ danmakuLikesPriority: checked })}
                      />
                    </View>

                    <If when={props.prefs.danmakuEnabled}>
                      <Text class="text-[11px] text-dim">弹幕 {danmakuComments().length} 条</Text>
                    </If>
                  </View>
                </UiPopover>

                <UiButton
                  testID="fit-mode-btn"
                  variant="stageGhost"
                  size="sm"
                  label={props.prefs.fitMode === "contain" ? "⤢ 适应" : "⛶ 铺满"}
                  tooltip="画面比例切换"
                  onPress={toggleFitMode}
                />

                <UiMenu
                  placement="top"
                  align="end"
                  trigger={
                    <UiButton
                      testID="speed-menu-btn"
                      variant="secondary"
                      size="sm"
                      label={`${props.prefs.playbackRate}x ⌃`}
                      accessibilityLabel={`播放倍速 ${props.prefs.playbackRate}x`}
                      class="min-w-[70px]"
                    />
                  }
                >
                  <Each of={PLAYBACK_RATES} key={(r) => r}>
                    {(rate) => (
                      <UiMenuItem
                        label={`${rate()}x`}
                        checked={props.prefs.playbackRate === rate()}
                        onSelect={() => {
                          void updatePlayerPreferences({ playbackRate: rate() });
                          flashOsd(`倍速 ${rate()}x`);
                        }}
                      />
                    )}
                  </Each>
                </UiMenu>

                <View onWheel={handleVolumeWheel} class="flex-row items-center gap-1.5">
                  <UiIconButton
                    testID="mute-btn"
                    icon={props.prefs.isMuted || props.prefs.volume === 0 ? "mute" : "volume"}
                    variant="stageGhost"
                    size="sm"
                    accessibilityLabel={props.prefs.isMuted ? "取消静音" : "静音"}
                    tooltip="静音切换 (M)"
                    onPress={toggleMute}
                  />
                  <If when={isWide()}>
                    <View class="w-[70px]">
                      <UiSlider
                        tone="progress"
                        value={props.prefs.isMuted ? 0 : Math.round(props.prefs.volume * 100)}
                        min={0}
                        max={100}
                        step={5}
                        accessibilityLabel="音量大小"
                        onChange={(v) =>
                          void updatePlayerPreferences({
                            volume: v / 100,
                            isMuted: v === 0,
                          })
                        }
                      />
                    </View>
                  </If>
                </View>

                <UiIconButton
                  testID="fullscreen-btn"
                  icon={isFullScreen() ? "exitFullscreen" : "fullscreen"}
                  variant="stageGhost"
                  size="sm"
                  accessibilityLabel={isFullScreen() ? "退出全屏" : "全屏"}
                  tooltip="全屏 (F / 双击画面)"
                  onPress={toggleFullScreen}
                />
              </View>
            </View>

            {/* Keyboard Hints (`.keyboard-hints`) */}
            <If when={isLargeDesktop()}>
              <View class="flex-row items-center justify-center gap-5 pt-0.5">
                <Text class="text-[11px] text-dim">快捷键：[空格] 播放/暂停</Text>
                <Text class="text-[11px] text-dim">[↑/↓] 上下集切换</Text>
                <Text class="text-[11px] text-dim">[←/→] 快退/快进 5s</Text>
                <Text class="text-[11px] text-dim">[D] 弹幕开关</Text>
                <Text class="text-[11px] text-dim">[F/双击] 全屏</Text>
              </View>
            </If>
          </View>
        </If>
      </View>

      {/* Desktop Right Sidebar (hidden in fullscreen mode for pure edge-to-edge cinema) */}
      <If when={isWide() && sidebarOpen() && !isFullScreen()}>
        <View class={`${isLargeDesktop() ? "w-[380px]" : "w-[300px]"} bg-sidebar p-4`}>
          {renderSidebarBody()}
        </View>
      </If>

      {/* Narrow Viewport Sheet */}
      <UiSheet open={!isWide() && mobileSheetOpen()} onOpenChange={(open) => mobileSheetOpen.set(open)}>
        <View class="h-96">{renderSidebarBody()}</View>
      </UiSheet>
    </View>
  );
}
