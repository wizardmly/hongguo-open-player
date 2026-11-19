import { platform, Scroll, Text, View, windowSize } from "nsh";
import { DramaCard } from "../components/DramaCard";
import type { CatalogTab, SeriesSummary, WatchHistoryEntry } from "../domain/types";
import { HOT_SEARCH_TAGS } from "../services/catalog";
import { getSeriesProgress } from "../services/store";
import { UiBadge, UiButton, UiEmptyState, UiIconButton, UiSkeleton } from "../ui";

export interface CatalogViewProps {
  currentTab: CatalogTab;
  activeQuery: string;
  dramas: SeriesSummary[];
  latestHistory: WatchHistoryEntry | null;
  loading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
  onQuickSearch: (tag: string) => void;
  onSelectDrama: (drama: SeriesSummary) => void;
  onResumeLatest: (entry: WatchHistoryEntry) => void;
  onRemoveHistoryItem?: (seriesId: string) => void;
  onClearHistory?: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onChangePage: (delta: -1 | 1) => void;
}

function splitIntoRows<T>(items: T[], cols: number): T[][] {
  const safeCols = Math.max(1, cols);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += safeCols) {
    rows.push(items.slice(i, i + safeCols));
  }
  return rows;
}

function formatResumeTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 1) return "";
  const total = Math.floor(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Main catalog, search results, watch history, and favorites 5-column poster grid replicating `.catalog-container`. */
export function CatalogView(props: CatalogViewProps) {
  const columns = () => {
    const w = windowSize().width;
    if (platform.idiom === "terminal") {
      if (w >= 120) return 3;
      if (w >= 76) return 2;
      return 1;
    }
    if (w >= 1180) return 5;
    if (w >= 920) return 4;
    if (w >= 680) return 3;
    if (w >= 440) return 2;
    return 1;
  };

  const outerPad = () => (platform.idiom !== "terminal" && windowSize().width >= 900 ? "px-8" : "px-4");

  const showHotChips = () =>
    props.currentTab !== "history" && props.currentTab !== "favorites" && props.currentTab !== "actors";

  const showPagination = () =>
    props.currentTab !== "history" &&
    props.currentTab !== "favorites" &&
    (props.dramas.length > 0 || props.page > 1);

  const emptyTitle = () => {
    if (props.currentTab === "history") return "暂无观看历史";
    if (props.currentTab === "favorites") return "暂无收藏短剧";
    return "暂无相关短剧内容";
  };

  const emptyDesc = () => {
    if (props.currentTab === "history") return "播放过的短剧会显示在这里";
    if (props.currentTab === "favorites") return "点击短剧海报旁的“收藏”即可快速添加";
    if (props.currentTab === "search") return "未找到相关短剧，换个搜索关键词试试吧";
    return "换个搜索关键词，或者切换分类标签试试吧";
  };

  const rows = () => splitIntoRows(props.dramas, columns());

  return (
    <Scroll class="flex-1" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      <View class={`gap-5 py-4 pb-12 ${outerPad()}`}>
        {/* Quick Search Chips Bar + Refresh & 1-Click Continue Watching */}
        <If when={showHotChips()}>
          <View class="flex-row flex-wrap items-center justify-between gap-2.5 pt-0.5">
            <View class="flex-row flex-wrap items-center gap-2">
              <Text class="text-[13px] text-dim">热门搜索：</Text>
              <Each of={HOT_SEARCH_TAGS} key={(t) => t}>
                {(tag) => (
                  <UiButton
                    testID={`hot-chip-${tag()}`}
                    variant="chip"
                    size="sm"
                    selected={props.currentTab === "search" && props.activeQuery === tag()}
                    label={tag()}
                    onPress={() => props.onQuickSearch(tag())}
                  />
                )}
              </Each>
            </View>

            <View class="flex-row items-center gap-2">
              <If when={props.currentTab === "hot-drama" && props.page === 1 ? props.latestHistory : null}>
                {(last) => {
                  const posLabel = () => formatResumeTime(last().position_sec);
                  return (
                    <UiButton
                      testID="quick-continue-watching-btn"
                      variant="seasonPill"
                      size="sm"
                      icon="play"
                      label={`继续看《${
                        last().series_title.length > 10
                          ? `${last().series_title.slice(0, 10)}…`
                          : last().series_title
                      }》第 ${last().episode_index} 集${posLabel() ? ` ${posLabel()}` : ""}`}
                      tooltip={`上次观看：${last().series_title} 第 ${last().episode_index} 集`}
                      onPress={() => props.onResumeLatest(last())}
                    />
                  );
                }}
              </If>
              <UiIconButton
                testID="catalog-refresh-btn"
                icon="refresh"
                variant="outline"
                size="sm"
                disabled={props.loading}
                accessibilityLabel="刷新当前列表"
                tooltip="刷新当前列表"
                onPress={props.onRefresh}
                class="bg-surface"
              />
            </View>
          </View>
        </If>

        {/* History Management Header */}
        <If when={props.currentTab === "history" && props.dramas.length > 0}>
          <View class="flex-row items-center justify-between">
            <View class="flex-row items-center gap-2">
              <Text class="text-sm font-semibold text-foreground">最近观看记录</Text>
              <UiBadge label={`共 ${props.dramas.length} 部`} tone="neutral" pill />
            </View>
            <If when={props.onClearHistory}>
              {(clearFn) => (
                <UiButton
                  testID="clear-watch-history-btn"
                  variant="outline"
                  size="sm"
                  label="清空观看记录"
                  onPress={clearFn()}
                />
              )}
            </If>
          </View>
        </If>

        {/* Loading Skeletons */}
        <If
          when={!props.loading}
          else={
            <View class="gap-6">
              <Each of={[1, 2]} key={(r) => r}>
                {() => (
                  <View class="flex-row gap-5">
                    <Each of={Array.from({ length: columns() }, (_, i) => i)} key={(i) => i}>
                      {() => (
                        <View class="flex-1 gap-2">
                          <UiSkeleton class="h-64 w-full" />
                          <UiSkeleton class="h-4 w-4/5" />
                          <UiSkeleton class="h-3 w-3/5" />
                        </View>
                      )}
                    </Each>
                  </View>
                )}
              </Each>
            </View>
          }
        >
          <If
            when={!props.error}
            else={
              <UiEmptyState
                icon="alert"
                title="短剧加载失败"
                description={props.error ?? "请稍后重试"}
                actionLabel="重试加载"
                onAction={props.onRetry}
              />
            }
          >
            <If
              when={props.dramas.length > 0}
              else={<UiEmptyState icon="film" title={emptyTitle()} description={emptyDesc()} />}
            >
              <View class="gap-6">
                <Each
                  of={rows()}
                  key={(row, rIdx) => `row-${rIdx}-${row.map((d) => d.series_id).join(",")}`}
                >
                  {(row, rIdx) => {
                    const padCount = () => Math.max(0, columns() - row().length);
                    return (
                      <View class="flex-row items-stretch gap-5">
                        <Each of={row()} key={(d) => d.series_id}>
                          {(drama, cIdx) => {
                            const progress = () => getSeriesProgress(drama().series_id);
                            return (
                              <DramaCard
                                drama={drama()}
                                watchedIndex={drama().watched_index ?? progress()?.episode_index}
                                index={rIdx() * columns() + cIdx()}
                                onSelect={props.onSelectDrama}
                                onRemove={
                                  props.currentTab === "history" ? props.onRemoveHistoryItem : undefined
                                }
                              />
                            );
                          }}
                        </Each>
                        <Each of={Array.from({ length: padCount() }, (_, i) => i)} key={(i) => `pad-${i}`}>
                          {() => <View class="flex-1" />}
                        </Each>
                      </View>
                    );
                  }}
                </Each>
              </View>
            </If>
          </If>
        </If>

        {/* Pagination Bar (`.pagination-bar`) */}
        <If when={showPagination()}>
          <View class="flex-row items-center justify-center gap-4 pt-4">
            <UiButton
              testID="catalog-prev-page"
              variant="secondary"
              size="md"
              label="上一页"
              disabled={props.page <= 1 || props.loading}
              onPress={() => props.onChangePage(-1)}
            />
            <Text class="text-[13px] tabular-nums text-muted-foreground">第 {props.page} 页</Text>
            <UiButton
              testID="catalog-next-page"
              variant="secondary"
              size="md"
              label="下一页"
              disabled={!props.hasMore || props.loading}
              onPress={() => props.onChangePage(1)}
            />
          </View>
        </If>
      </View>
    </Scroll>
  );
}
