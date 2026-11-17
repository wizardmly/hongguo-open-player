import { createMotion, Image, platform, Scroll, Text, View, windowSize } from "nsh";
import type { ActorSummary } from "../domain/types";
import {
  staggerDelay,
  UiBadge,
  UiButton,
  UiEmptyState,
  UiSkeleton,
} from "../ui";

export interface ActorRankingViewProps {
  actors: ActorSummary[];
  gender: "all" | "male" | "female";
  rankDate: string;
  page: number;
  hasMore: boolean;
  loading: boolean;
  onChangeGender: (gender: "all" | "male" | "female") => void;
  onChangePage: (delta: -1 | 1) => void;
  onSelectActor: (actor: ActorSummary) => void;
}

function splitRows<T>(items: T[], cols: number): T[][] {
  const safe = Math.max(1, cols);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += safe) out.push(items.slice(i, i + safe));
  return out;
}

function ActorRankCard(props: { actor: ActorSummary; index: number; onSelect: (a: ActorSummary) => void }) {
  const entrance = createMotion({ enter: "fadeInUp", delay: staggerDelay(props.index), duration: 280 });
  const cardBorderClass = () => {
    if (props.actor.rank === 1) return "border-gold/45 bg-card";
    if (props.actor.rank === 2) return "border-silver/40 bg-card";
    if (props.actor.rank === 3) return "border-bronze/40 bg-card";
    return "border-border bg-card";
  };
  const rankBadgeTone = () => {
    if (props.actor.rank === 1) return "solidGold" as const;
    if (props.actor.rank === 2) return "solidSilver" as const;
    if (props.actor.rank === 3) return "solidBronze" as const;
    return "neutral" as const;
  };
  const rankBadgeLabel = () => {
    if (props.actor.rank === 1) return "🥇 TOP 1";
    if (props.actor.rank === 2) return "🥈 TOP 2";
    if (props.actor.rank === 3) return "🥉 TOP 3";
    return `TOP ${props.actor.rank}`;
  };

  return (
    <View style={entrance.style} class="flex-1">
      <UiButton
        testID={`actor-card-${props.actor.actor_id}`}
        variant="ghost"
        accessibilityLabel={`TOP ${props.actor.rank} ${props.actor.name}，${props.actor.score}`}
        onPress={() => props.onSelect(props.actor)}
        class={`h-auto w-full grow flex-col items-stretch justify-between rounded-2xl border p-5 transition duration-200 hover:-translate-y-1 hover:border-primary/50 hover:bg-surface-elevated ${cardBorderClass()}`}
      >
        <View class="w-full items-center gap-3">
          {/* Header: Rank Medal + Rank Delta (`up` green / `down` red) */}
          <View class="w-full flex-row items-center justify-between">
            <UiBadge label={rankBadgeLabel()} tone={rankBadgeTone()} pill />
            <If
              when={props.actor.rank_change.type === 1}
              else={
                <If
                  when={props.actor.rank_change.type === 2}
                  else={<Text class="text-xs text-dim">—</Text>}
                >
                  <UiBadge
                    label={`▼ ${props.actor.rank_change.num ?? 1}`}
                    tone="destructive"
                    pill
                  />
                </If>
              }
            >
              <UiBadge
                label={`▲ ${props.actor.rank_change.num ?? 1}`}
                tone="success"
                pill
              />
            </If>
          </View>

          {/* 88x88 Avatar + Name + Score */}
          <View class="items-center gap-2">
            <If when={platform.idiom !== "terminal"}>
              <Image
                src={props.actor.avatar}
                class="size-[88px] rounded-full border-2 border-foreground/15 object-cover"
              />
            </If>
            <Text class="pt-0.5 text-base font-bold text-card-foreground">{props.actor.name}</Text>
            <UiBadge label={`🔥 ${props.actor.score}`} tone="primary" pill />
          </View>

          {/* Subtitle stat tags */}
          <View class="flex-row flex-wrap justify-center gap-1.5">
            <Each of={props.actor.sub_titles.slice(0, 2)} key={(t) => t}>
              {(tag) => <UiBadge label={tag()} tone="neutral" />}
            </Each>
          </View>

          {/* 2-line representative works */}
          <View class="min-h-9 items-center justify-start">
            <Text style={{ numberOfLines: 2 }} class="text-center text-xs leading-snug text-dim">
              {props.actor.intro}
            </Text>
          </View>
        </View>

        <View class="mt-3.5 w-full items-center border-t border-border/70 pt-2.5">
          <Text class="text-xs font-semibold text-primary">主页与作品 ❯</Text>
        </View>
      </UiButton>
    </View>
  );
}

/** Actor leaderboard replicating `hongguo-open-player` `.actor-ranking-container` (4-column grid). */
export function ActorRankingView(props: ActorRankingViewProps) {
  const cols = () => {
    const w = windowSize().width;
    if (platform.idiom === "terminal") {
      if (w >= 120) return 3;
      if (w >= 76) return 2;
      return 1;
    }
    if (w >= 1140) return 4;
    if (w >= 860) return 3;
    if (w >= 560) return 2;
    return 1;
  };

  const outerPad = () => (platform.idiom !== "terminal" && windowSize().width >= 900 ? "px-8" : "px-4");

  return (
    <Scroll class="flex-1">
      <View class={`gap-5 py-5 pb-12 ${outerPad()}`}>
        {/* Top Crimson-Tinted Banner (`.actor-banner`) */}
        <View class="gap-2 rounded-2xl border border-primary/25 bg-primary/10 px-7 py-5">
          <View class="flex-row flex-wrap items-center gap-3">
            <Text class="text-xl">🌟</Text>
            <Text role="header" class="text-xl font-bold text-foreground">
              红果短剧 · 剧星榜
            </Text>
            <If when={props.rankDate}>
              <UiBadge label={`统计截至 ${props.rankDate}`} tone="primary" pill />
            </If>
          </View>
          <Text class="text-[13px] text-muted-foreground">
            按演员参演剧播放量、粉丝关注及全网讨论热度综合排序 · 点击演员卡片查看详细主页与全部参演短剧
          </Text>
        </View>

        {/* Separate Gender Filter Bar (`.actor-filter-bar`) */}
        <View class="flex-row flex-wrap items-center gap-3 rounded-[10px] border border-border bg-surface px-5 py-3">
          <Text class="text-[13px] font-medium text-muted-foreground">演员筛选：</Text>
          <View class="flex-row flex-wrap items-center gap-2.5">
            <UiButton
              testID="actor-filter-all"
              variant="chip"
              size="sm"
              selected={props.gender === "all"}
              label="🌟 全部"
              onPress={() => props.onChangeGender("all")}
            />
            <UiButton
              testID="actor-filter-male"
              variant="chip"
              size="sm"
              selected={props.gender === "male"}
              label="👨 男演员"
              onPress={() => props.onChangeGender("male")}
            />
            <UiButton
              testID="actor-filter-female"
              variant="chip"
              size="sm"
              selected={props.gender === "female"}
              label="👩 女演员"
              onPress={() => props.onChangeGender("female")}
            />
          </View>
        </View>

        {/* 4-Column Actor Grid */}
        <If
          when={!props.loading}
          else={
            <View class="flex-row gap-5">
              <Each of={Array.from({ length: cols() }, (_, i) => i)} key={(n) => n}>
                {() => <UiSkeleton class="h-72 flex-1" />}
              </Each>
            </View>
          }
        >
          <If
            when={props.actors.length > 0}
            else={<UiEmptyState icon="user" title="暂无剧星榜数据" description="请稍后刷新重试" />}
          >
            <View class="gap-5">
              <Each
                of={splitRows(props.actors, cols())}
                key={(row, idx) => `${idx}-${row.map((a) => a.actor_id).join(",")}`}
              >
                {(row, rIdx) => {
                  const pad = () => Math.max(0, cols() - row().length);
                  return (
                    <View class="flex-row items-stretch gap-5">
                      <Each of={row()} key={(a) => a.actor_id}>
                        {(actor, cIdx) => (
                          <ActorRankCard
                            actor={actor()}
                            index={rIdx() * cols() + cIdx()}
                            onSelect={props.onSelectActor}
                          />
                        )}
                      </Each>
                      <Each of={Array.from({ length: pad() }, (_, i) => i)} key={(i) => i}>
                        {() => <View class="flex-1" />}
                      </Each>
                    </View>
                  );
                }}
              </Each>
            </View>
          </If>
        </If>

        {/* Pagination */}
        <If when={props.actors.length > 0}>
          <View class="flex-row items-center justify-center gap-4 pt-4">
            <UiButton
              variant="secondary"
              size="md"
              label="上一页"
              disabled={props.page <= 1 || props.loading}
              onPress={() => props.onChangePage(-1)}
            />
            <Text class="text-[13px] tabular-nums text-muted-foreground">第 {props.page} 页</Text>
            <UiButton
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
