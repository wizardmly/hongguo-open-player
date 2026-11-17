import {
  cleanup,
  createMotion,
  effect,
  Image,
  keymap,
  platform,
  Scroll,
  signal,
  Text,
  Video,
  type VideoRef,
  View,
  windowSize,
} from "nsh";
import { currentWindow, isAvailable as desktopWindowAvailable } from "nsh/desktop";
import { DanmakuOverlay } from "../components/DanmakuOverlay";
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
import { fetchEpisodeDanmaku } from "../services/catalog";
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
  UiSlider,
  UiSpinner,
  UiSwitch,
  UiTab,
  UiTabs,
} from "../ui";

const PLAYBACK_RATES: PlaybackRateStr[] = ["0.75", "1.0", "1.25", "1.5", "2.0"];
const EPISODES_PER_GROUP = 30;

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

/** Immersive 1:1 Theater Player replicating `hongguo-open-player` `.theater-view` + 3-episode background preloader. */
export function TheaterView(props: TheaterViewProps) {
  const win = desktopWindowAvailable ? currentWindow() : null;
  let videoRef: VideoRef | undefined;

  const activeEpIndex = signal(props.initialEpisodeIndex);
  const streamUrl = signal("");
  const paused = signal(false);
  const buffering = signal(true);
  const errorMsg = signal<string | null>(null);
  const currentTime = signal(0);
  const duration = signal(0);
  const scrubbing = signal(false);
  const stageWidth = signal(760);
  const osdMessage = signal<string | null>(null);

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
  let lastStageClickMs = 0;
  let canAdvanceEpisode = false;
  let osdTimer: ReturnType<typeof setTimeout> | undefined;

  const flashOsd = (msg: string) => {
    osdMessage.set(msg);
    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osdMessage.set(null), 1300);
  };

  cleanup(() => {
    if (osdTimer) clearTimeout(osdTimer);
    loadRequestToken++;
    episodePreloader.clearAll();
  });

  const isWide = () => (platform.idiom === "terminal" ? windowSize().width >= 96 : windowSize().width >= 860);
  const isLargeDesktop = () => platform.idiom !== "terminal" && windowSize().width >= 1220;
  const isFullScreen = () => win?.state()?.mode === "fullScreen";

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

  const startEpisodeLoad = (ep: EpisodeItem, resumeSec = 0) => {
    const token = ++loadRequestToken;
    canAdvanceEpisode = false;
    paused.set(true);
    streamUrl.set("");
    pendingResumeSec = Math.max(0, resumeSec);
    activeEpIndex.set(ep.vid_index);
    const expectedGroupStart = Math.floor((ep.vid_index - 1) / EPISODES_PER_GROUP) * EPISODES_PER_GROUP + 1;
    activeGroupStart.set(expectedGroupStart);

    errorMsg.set(null);
    buffering.set(true);
    currentTime.set(pendingResumeSec);
    duration.set(ep.duration_sec || 0);

    void episodePreloader
      .acquireForPlayback(ep)
      .then((cached) => {
        if (token !== loadRequestToken) return;
        streamUrl.set(cached.resolvedUrl);
        buffering.set(false);
        paused.set(false);
        episodePreloader.scheduleUpcoming(props.series.episodes, ep.vid_index);
      })
      .catch((err) => {
        if (token !== loadRequestToken) return;
        buffering.set(false);
        errorMsg.set(
          err instanceof Error && err.message
            ? `片源加载失败：${err.message}`
            : "当前分集暂时无法加载，请检查网络或重试本集。",
        );
      });

    void fetchEpisodeDanmaku(ep.vid, ep.vid_index, ep.series_id).then((items) => {
      if (token === loadRequestToken) danmakuComments.set(items);
    }).catch(() => { if (token === loadRequestToken) danmakuComments.set([]); });

    void recordWatchProgress({
      series_id: props.series.series_id,
      series_title: props.series.series_title,
      cover: props.series.cover,
      episode_count: props.series.total,
      episode_index: ep.vid_index,
      vid: ep.vid,
      position_sec: pendingResumeSec,
      duration_sec: ep.duration_sec || 0,
    });
  };

  let initializedSeriesId = "";
  effect(() => {
    const sid = props.series.series_id;
    if (sid !== initializedSeriesId) {
      episodePreloader.clearAll();
      initializedSeriesId = sid;
      const targetIdx = props.initialEpisodeIndex;
      const ep =
        props.series.episodes.find((e) => e.vid_index === targetIdx) ?? props.series.episodes[0];
      if (ep) {
        startEpisodeLoad(ep, props.initialResumeSec);
      }
    }
  });

  const switchEpisode = (ep: EpisodeItem) => {
    mobileSheetOpen.set(false);
    const wasReady = episodePreloader.isCached(ep.vid);
    startEpisodeLoad(ep, 0);
    flashOsd(wasReady ? `第 ${ep.vid_index} 集` : `正在切换第 ${ep.vid_index} 集`);
  };

  const playPrevEpisode = () => {
    const prevIdx = activeEpIndex() - 1;
    const prev = props.series.episodes.find((e) => e.vid_index === prevIdx);
    if (prev) switchEpisode(prev);
  };

  const playNextEpisode = () => {
    const nextIdx = activeEpIndex() + 1;
    const next = props.series.episodes.find((e) => e.vid_index === nextIdx);
    if (next) {
      switchEpisode(next);
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
    streamUrl.set("");
    startEpisodeLoad(ep, resumeAt);
    flashOsd(resumeAt > 0 ? `正在从 ${formatDuration(resumeAt)} 恢复播放…` : "正在重试本集…");
  };

  const togglePlay = () => {
    const nextPaused = !paused();
    paused.set(nextPaused);
    if (nextPaused) {
      void centerPlayMotion.play("zoomIn", { duration: 160 });
    }
  };

  const handleStagePress = () => {
    const now = Date.now();
    if (now - lastStageClickMs < 280) {
      lastStageClickMs = 0;
      toggleFullScreen();
      return;
    }
    lastStageClickMs = now;
    togglePlay();
  };

  const seekBy = (deltaSec: number) => {
    const maxDur = duration() || currentEpisode()?.duration_sec || 0;
    if (maxDur <= 0) return;
    const target = Math.min(maxDur, Math.max(0, currentTime() + deltaSec));
    currentTime.set(target);
    videoRef?.seek(target);
    flashOsd(`${deltaSec > 0 ? "快进" : "快退"}至 ${formatDuration(target)}`);
  };

  const toggleMute = () => {
    const nextMuted = !props.prefs.isMuted;
    void updatePlayerPreferences({ isMuted: nextMuted });
    flashOsd(nextMuted ? "已静音" : `音量 ${Math.round(props.prefs.volume * 100)}%`);
  };

  const toggleFullScreen = () => {
    if (!win) {
      showToast("当前运行环境由宿主管理全屏视图");
      return;
    }
    const nextMode = isFullScreen() ? "normal" : "fullScreen";
    win.setMode(nextMode);
    flashOsd(nextMode === "fullScreen" ? "已进入全屏" : "已退出全屏");
  };

  const toggleFitMode = () => {
    const nextFit: FitMode = props.prefs.fitMode === "contain" ? "cover" : "contain";
    void updatePlayerPreferences({ fitMode: nextFit });
    flashOsd(nextFit === "contain" ? "画面：完整适应" : "画面：裁切铺满");
  };

  const toggleSidebar = () => {
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
        if (!props.hasModalOpen) playNextEpisode();
      },
      pagedown: () => {
        if (!props.hasModalOpen) playNextEpisode();
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

  const renderSidebarBody = () => {
    const watchedList = () => getSeriesProgress(props.series.series_id)?.watched_indexes ?? [];

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
            <If when={platform.idiom !== "terminal"}>
              <Image src={props.series.cover} class="h-[86px] w-16 shrink-0 rounded-md object-cover shadow-md" />
            </If>
            <View class="min-w-0 flex-1 items-start gap-1">
              <UiButton
                testID="open-drama-detail-card"
                variant="ghost"
                accessibilityLabel={`查看《${props.series.series_title}》剧情详情`}
                onPress={props.onOpenDramaDetail}
                class="h-auto w-full justify-start p-0 hover:bg-transparent"
              >
                <Text style={{ numberOfLines: 1 }} class="text-sm font-semibold text-foreground">
                  {props.series.series_title}
                </Text>
              </UiButton>

              <View class="flex-row flex-wrap items-center gap-1.5">
                <Text class="text-[11px] text-dim">共 {props.series.total} 集全</Text>
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

          <If when={props.series.intro}>
            <UiButton
              variant="ghost"
              accessibilityLabel="查看完整剧情介绍"
              onPress={props.onOpenDramaDetail}
              class="h-auto w-full items-start justify-start overflow-hidden border-t border-border/60 px-0 pt-2 pb-0 hover:bg-transparent"
            >
              <View class="min-w-0 flex-1">
                <Text style={{ numberOfLines: 2 }} class="text-left text-xs leading-relaxed text-dim">
                  {props.series.intro}{" "}
                  <Text class="text-[11px] font-semibold text-primary">详情 ↗</Text>
                </Text>
              </View>
            </UiButton>
          </If>
        </View>

        {/* Sidebar View Switcher: [选集] vs [📚 系列全季] */}
        <If when={props.relatedSeasons.length > 1}>
          <UiTabs variant="sidebar" class="rounded-md border border-border">
            <UiTab
              testID="sidebar-tab-episodes"
              label={`选集 (${props.series.episodes.length})`}
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
                props.onRefreshSeasons();
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
                              <Text style={{ numberOfLines: 1 }} class="flex-1 text-xs font-semibold text-foreground">
                                {season().series_title}
                              </Text>
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
          <View class="flex-1 gap-2.5">
            {/* Group Range Tabs (`1-30`, `31-60`, ...) + non-intrusive preload indicator */}
            <View class="flex-row flex-wrap items-center justify-between gap-1.5 pt-0.5">
              <View class="flex-row flex-wrap items-center gap-1.5">
                <Each of={episodeGroups()} key={(g) => `${g.start}-${g.end}`}>
                  {(group) => (
                    <UiButton
                      testID={`ep-group-${group().start}-${group().end}`}
                      variant="group"
                      size="sm"
                      selected={activeGroupStart() === group().start}
                      label={`${group().start}-${group().end}`}
                      onPress={() => activeGroupStart.set(group().start)}
                      class="h-7 px-2.5"
                    />
                  )}
                </Each>
              </View>
              <If when={upcomingCount() > 0}>
                <Text class="text-[11px] tabular-nums text-dim">
                  预载 {preloadedReadyCount()}/{upcomingCount()} 集
                </Text>
              </If>
            </View>

            {/* 5-Column Episode Matrix (`.episode-grid`) */}
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
                            return (
                              <UiButton
                                testID={`ep-btn-${ep().vid_index}`}
                                variant="episode"
                                selected={isCurrent()}
                                accessibilityLabel={`第 ${ep().vid_index} 集${isCurrent() ? "，正在播放" : ""}`}
                                onPress={() => switchEpisode(ep())}
                                class={`h-11 flex-1 px-0 ${isWatched() && !isCurrent() ? "border-dashed opacity-80" : ""}`}
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
      </View>
    );
  };

  return (
    <View class="flex-1 flex-row bg-stage">
      {/* Main Theater Player Column */}
      <View class="min-w-0 flex-1 border-r border-border bg-stage-panel">
        {/* 52px Player Header (`.player-header`: Left Back | Center Title + Badge | Right Actions) */}
        <View class="h-[52px] flex-row items-center justify-between gap-2 border-b border-border bg-stage-header px-5">
          <UiButton
            testID="exit-theater-btn"
            variant="stage"
            size="sm"
            icon="chevronLeft"
            label={isWide() ? "退出播放" : "返回"}
            onPress={props.onExitTheater}
            class="shrink-0"
          />

          <View class="min-w-0 flex-row items-center justify-center gap-2.5 overflow-hidden px-2">
            <Text style={{ numberOfLines: 1 }} class="shrink text-[15px] font-semibold text-stage-foreground">
              {props.series.series_title}
            </Text>
            <View class="shrink-0 rounded-sm bg-stage-foreground/8 px-2 py-0.5">
              <Text class="text-xs font-semibold tabular-nums text-muted-foreground">
                {isWide()
                  ? `第 ${activeEpIndex()} 集 / 全 ${props.series.total} 集`
                  : `${activeEpIndex()}/${props.series.total} 集`}
              </Text>
            </View>
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
            <UiButton
              testID="toggle-sidebar-btn"
              variant="stage"
              size="sm"
              icon={sidebarOpen() && isWide() ? "sidebarClose" : "sidebarOpen"}
              label={isWide() ? (sidebarOpen() ? "隐藏侧边栏" : "显示侧边栏") : "选集"}
              onPress={toggleSidebar}
            />
          </View>
        </View>

        {/* Center Video Stage (`.video-stage`) */}
        <View
          onLayout={(e) => stageWidth.set(e.bounds.size.width)}
          onPress={handleStagePress}
          class="relative flex-1 items-center justify-center overflow-hidden bg-stage"
        >
          <If when={streamUrl().length > 0 && platform.idiom !== "terminal"}>
            <Video
              ref={(node) => {
                videoRef = node;
              }}
              src={streamUrl()}
              paused={paused()}
              muted={props.prefs.isMuted}
              volume={props.prefs.volume}
              rate={Number(props.prefs.playbackRate)}
              progressUpdateInterval={250}
              style={{
                width: "100%",
                height: "100%",
                objectFit: props.prefs.fitMode,
              }}
              onLoadStart={() => buffering.set(true)}
              onLoad={(e) => {
                canAdvanceEpisode = true;
                buffering.set(false);
                if (Number.isFinite(e.duration) && e.duration > 0) {
                  duration.set(Math.max(duration(), e.duration));
                }
                if (pendingResumeSec > 0.2) {
                  const target =
                    e.duration > 0 ? Math.min(pendingResumeSec, Math.max(0, e.duration - 0.5)) : pendingResumeSec;
                  videoRef?.seek(target);
                  currentTime.set(target);
                  pendingResumeSec = 0;
                }
              }}
              onBuffer={(e) => buffering.set(e.isBuffering)}
              onProgress={(e) => {
                if (!scrubbing()) {
                  currentTime.set(e.currentTime);
                }
                if (Number.isFinite(e.duration) && e.duration > 0) {
                  duration.set(Math.max(duration(), e.duration));
                }
                if (Math.abs(e.currentTime - lastSavedSec) >= 2) {
                  lastSavedSec = e.currentTime;
                  const ep = currentEpisode();
                  if (ep) {
                    void recordWatchProgress({
                      series_id: props.series.series_id,
                      series_title: props.series.series_title,
                      cover: props.series.cover,
                      episode_count: props.series.total,
                      episode_index: ep.vid_index,
                      vid: ep.vid,
                      position_sec: e.currentTime,
                      duration_sec: e.duration || duration(),
                    });
                  }
                }
              }}
              onEnd={() => {
                if (!canAdvanceEpisode || duration() <= 0 || currentTime() < duration() - 1.5) return;
                canAdvanceEpisode = false;
                playNextEpisode();
              }}
              onError={(e) => {
                buffering.set(false);
                errorMsg.set(`视频加载失败（${e.message || "网络或解码异常"}）`);
              }}
            />
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

          {/* Borderless Shadowed Danmaku Layer */}
          <DanmakuOverlay
            enabled={props.prefs.danmakuEnabled}
            comments={danmakuComments()}
            currentTime={currentTime()}
            isPlaying={!paused() && !buffering() && !errorMsg()}
            rows={props.prefs.danmakuRows}
            speed={props.prefs.danmakuSpeed}
            opacity={props.prefs.danmakuOpacity}
            likesPriority={props.prefs.danmakuLikesPriority}
            stageWidth={stageWidth()}
          />

          {/* Center OSD pill */}
          <If when={osdMessage()}>
            {(msg) => (
              <View class="pointer-events-none absolute top-[44%] rounded-xl bg-surface/90 px-5 py-2.5 shadow-lg">
                <Text class="text-xs font-medium text-stage-foreground">{msg()}</Text>
              </View>
            )}
          </If>

          {/* Center Buffering Spinner */}
          <If when={buffering() && !errorMsg()}>
            <View class="pointer-events-none items-center gap-3 rounded-[10px] bg-stage/65 px-7 py-4">
              <UiSpinner size={28} />
              <Text class="text-xs text-stage-foreground">正在加载剧集...</Text>
            </View>
          </If>

          {/* Center 72x72 Paused Play Circle (`.play-overlay-btn`) */}
          <If when={paused() && !buffering() && !errorMsg()}>
            <View
              style={centerPlayMotion.style}
              class="size-[72px] items-center justify-center rounded-full bg-primary/85 shadow-lg"
            >
              <Icon name="play" size={30} tone="primary-foreground" />
            </View>
          </If>

          {/* Error Overlay */}
          <If when={errorMsg()}>
            {(errText) => (
              <View class="max-w-sm items-center gap-3.5 rounded-xl bg-stage/95 p-6">
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

        {/* 84px Bottom Player Controls (`.player-controls`) */}
        <View class="h-[84px] justify-center border-t border-border bg-surface px-5 pb-1.5">
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
              videoRef?.seek(val);
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
                disabled={activeEpIndex() >= props.series.episodes.length}
                accessibilityLabel="下一集"
                tooltip="下一集 (↓)"
                onPress={playNextEpisode}
              />
              <Text class="ml-1.5 text-xs tabular-nums text-dim">
                {formatDuration(currentTime())} / {formatDuration(duration())}
              </Text>
            </View>

            {/* Right Controls (`弹幕`, `⤢ 适应`, `1.0x ⌃`, `🔊`, `⛶`) */}
            <View class="flex-row items-center gap-3.5">
              {/* Danmaku Popover (`.danmaku-button` outlined crimson border when active) */}
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

              {/* Fit Mode Toggle */}
              <UiButton
                testID="fit-mode-btn"
                variant="stageGhost"
                size="sm"
                label={props.prefs.fitMode === "contain" ? "⤢ 适应" : "⛶ 铺满"}
                tooltip="画面比例切换"
                onPress={toggleFitMode}
              />

              {/* Speed Selector (`1.0x ⌃`) */}
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

              {/* Volume */}
              <View class="flex-row items-center gap-1.5">
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

              {/* Fullscreen */}
              <UiIconButton
                testID="fullscreen-btn"
                icon={isFullScreen() ? "exitFullscreen" : "fullscreen"}
                variant="stageGhost"
                size="sm"
                accessibilityLabel={isFullScreen() ? "退出全屏" : "全屏"}
                tooltip="全屏 (F)"
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
              <Text class="text-[11px] text-dim">[F] 或 [双击] 全屏</Text>
            </View>
          </If>
        </View>
      </View>

      {/* Desktop Right Sidebar (`380px` on >=1220px, `300px` on 860..1219px) */}
      <If when={isWide() && sidebarOpen()}>
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
