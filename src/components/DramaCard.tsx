import { cleanup, createMotion, Image, platform, Text, View } from "nsh";
import type { SeriesSummary } from "../domain/types";
import { prefetchSeriesDetail } from "../services/catalog";
import { staggerDelay, UiBadge, UiButton, UiIconButton } from "../ui";

export interface DramaCardProps {
  drama: SeriesSummary;
  watchedIndex?: number;
  index: number;
  onSelect: (drama: SeriesSummary) => void;
  onRemove?: (seriesId: string) => void;
}

/** Poster card replicating `hongguo-open-player` `.drama-card` with desktop hover detail prefetching. */
export function DramaCard(props: DramaCardProps) {
  const entrance = createMotion({ enter: "fadeInUp", delay: staggerDelay(props.index), duration: 260 });
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleHoverPrefetch = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      prefetchSeriesDetail(props.drama.series_id);
    }, 140);
  };

  const cancelHoverPrefetch = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = undefined;
    }
  };

  cleanup(cancelHoverPrefetch);

  return (
    <View
      style={entrance.style}
      onMouseEnter={scheduleHoverPrefetch}
      onMouseLeave={cancelHoverPrefetch}
      class="group relative flex-1"
    >
      <UiButton
        testID={`drama-card-${props.drama.series_id}`}
        variant="ghost"
        accessibilityLabel={`${props.drama.series_title}，全 ${props.drama.episode_count} 集`}
        onPress={() => props.onSelect(props.drama)}
        class="h-auto w-full grow flex-col items-stretch justify-start overflow-hidden rounded-[10px] border border-border bg-card p-0 transition duration-200 hover:-translate-y-1 hover:border-primary/45 hover:bg-surface-elevated"
      >
        <If when={platform.idiom !== "terminal"}>
          <View class="relative w-full overflow-hidden bg-surface" style={{ aspectRatio: 3 / 4 }}>
            <Image
              src={props.drama.cover}
              class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {/* Hover center play badge */}
            <View class="absolute inset-0 items-center justify-center bg-stage/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <View class="rounded-full bg-primary px-4 py-2 shadow-md">
                <Text class="text-xs font-semibold text-primary-foreground">▶ 立即播放</Text>
              </View>
            </View>
            {/* Optional top-left rec badge */}
            <If when={props.drama.rec_text}>
              {(rec) => (
                <View class="absolute top-2 left-2">
                  <UiBadge label={rec()} tone="solidPrimary" />
                </View>
              )}
            </If>
            {/* Top-right episode count badge (`episode-badge`) */}
            <View class="absolute top-2 right-2">
              <UiBadge
                label={props.drama.episode_count ? `全 ${props.drama.episode_count} 集` : "短剧"}
                tone="stage"
              />
            </View>
            {/* Bottom-left watch progress badge (`progress-badge`) */}
            <If when={props.watchedIndex}>
              {(epIdx) => (
                <View class="absolute bottom-2 left-2">
                  <UiBadge label={`已看至第 ${epIdx()} 集`} tone="solidPrimary" />
                </View>
              )}
            </If>
          </View>
        </If>

        <View class="w-full gap-1.5 p-3.5">
          <View class="min-h-10 justify-start">
            <Text style={{ numberOfLines: 2 }} class="text-sm font-semibold leading-snug text-card-foreground">
              {props.drama.series_title}
            </Text>
          </View>

          <View class="flex-row flex-wrap items-center gap-1">
            <Each of={(props.drama.tags ?? []).slice(0, 3)} key={(tag) => tag}>
              {(tag) => <UiBadge label={tag()} tone="subtle" />}
            </Each>
            <If when={platform.idiom === "terminal" && props.watchedIndex !== undefined}>
              <UiBadge label={`已看至第 ${props.watchedIndex} 集`} tone="primary" />
            </If>
          </View>

          <If when={props.drama.description}>
            <View class="min-h-8 justify-start pt-0.5">
              <Text style={{ numberOfLines: 2 }} class="text-xs leading-snug text-dim">
                {props.drama.description}
              </Text>
            </View>
          </If>
        </View>
      </UiButton>

      {/* Optional single-item remove button in Watch History */}
      <If when={props.onRemove}>
        {(removeFn) => (
          <View class="absolute top-2 left-2 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <UiIconButton
              icon="close"
              size="sm"
              variant="stage"
              accessibilityLabel={`移除历史记录：${props.drama.series_title}`}
              tooltip="从观影历史移除"
              onPress={() => removeFn()(props.drama.series_id)}
              class="size-6 rounded-full bg-stage/80"
            />
          </View>
        )}
      </If>
    </View>
  );
}
