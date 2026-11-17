import { appInfo, Clipboard, Image, openUrl, platform, Scroll, signal, Text, View } from "nsh";
import appIcon from "../../assets/app-icon.png";
import type { ActorDetail, CastMember, SeasonEntry, SeriesDetail, SeriesSummary } from "../domain/types";
import {
  showToast,
  UiBadge,
  UiButton,
  UiDialog,
  UiEmptyState,
  UiIconButton,
  UiInput,
  UiSeparator,
  UiSpinner,
  UiSurface,
} from "../ui";
import { DramaCard } from "./DramaCard";

// ===== 1. Drama Detail Modal =====

export interface DramaDetailModalProps {
  open: boolean;
  series: SeriesDetail | null;
  isFavorited: boolean;
  relatedSeasons: SeasonEntry[];
  onOpenChange: (open: boolean) => void;
  onToggleFavorite: () => void;
  onSelectSeason: (season: SeasonEntry) => void;
  onOpenAllSeasons: () => void;
  onSelectActor: (actor: CastMember) => void;
}

export function DramaDetailModal(props: DramaDetailModalProps) {
  const copied = signal(false);

  const handleCopyTitle = async () => {
    const title = props.series?.series_title;
    if (!title) return;
    await Clipboard.writeText(title);
    copied.set(true);
    showToast(`已复制剧名：${title}`, "success");
    setTimeout(() => copied.set(false), 1800);
  };

  return (
    <UiDialog
      testID="drama-detail-dialog"
      open={props.open && props.series !== null}
      title={props.series?.series_title ?? "短剧详情"}
      size="lg"
      scrollable
      onOpenChange={props.onOpenChange}
    >
      <If when={props.series}>
        {(series) => (
          <View class="flex-1">
            <View class="shrink-0 flex-row items-start justify-between gap-4 border-b border-border bg-primary/8 p-5">
              <View class="flex-1 flex-row items-start gap-4">
                <If when={platform.idiom !== "terminal"}>
                  <Image
                    src={series().cover}
                    class="h-[120px] w-[90px] rounded-md border border-border object-cover shadow-md"
                  />
                </If>
                <View class="min-w-0 flex-1 gap-2">
                  <View class="flex-row flex-wrap items-center justify-between gap-2">
                    <View class="flex-row flex-wrap items-center gap-2.5">
                      <Text role="header" class="text-lg font-bold text-popover-foreground">
                        {series().series_title}
                      </Text>
                      <UiButton
                        testID="copy-drama-title-btn"
                        variant="outline"
                        size="sm"
                        label={copied() ? "✓ 已复制" : "📋 复制剧名"}
                        onPress={() => void handleCopyTitle()}
                      />
                    </View>
                    <UiButton
                      testID="detail-fav-btn"
                      variant="outline"
                      selected={props.isFavorited}
                      size="sm"
                      label={props.isFavorited ? "❤️ 已在收藏夹" : "🤍 加入收藏"}
                      onPress={props.onToggleFavorite}
                    />
                  </View>

                  <View class="flex-row flex-wrap items-center gap-2">
                    <UiBadge label={`共 ${series().total} 集全`} tone="primary" />
                    <If when={series().social_info?.hot_text}>
                      {(hot) => <UiBadge label={`🔥 ${hot()}`} tone="hot" />}
                    </If>
                    <If when={series().social_info?.rating}>
                      {(rate) => <UiBadge label={`⭐ ${rate()} 分`} tone="gold" />}
                    </If>
                    <If when={series().social_info?.like_count}>
                      {(lk) => <Text class="text-xs text-dim">👍 {lk()} 点赞</Text>}
                    </If>
                  </View>

                  <View class="flex-row flex-wrap items-center gap-1.5">
                    <Each of={series().tags} key={(t) => t}>
                      {(t) => <UiBadge label={t()} tone="subtle" />}
                    </Each>
                  </View>
                </View>
              </View>

              <UiIconButton
                icon="close"
                size="sm"
                accessibilityLabel="关闭详情弹窗"
                onPress={() => props.onOpenChange(false)}
                class="rounded-full bg-accent/60"
              />
            </View>

            <Scroll class="flex-1">
              <View class="gap-5 p-5">
                <If when={props.relatedSeasons.length > 1}>
                  <View class="gap-2.5 border-b border-border pb-4">
                    <View class="flex-row items-center justify-between">
                      <Text role="header" class="text-sm font-semibold text-muted-foreground">
                        📚 系列全季 ({props.relatedSeasons.length})
                      </Text>
                      <UiButton
                        variant="ghost"
                        size="sm"
                        label="查看全季卡片 ↗"
                        onPress={props.onOpenAllSeasons}
                      />
                    </View>
                    <View class="flex-row flex-wrap items-center gap-2">
                      <Each of={props.relatedSeasons} key={(s) => s.series_id}>
                        {(s) => (
                          <UiButton
                            variant="chip"
                            size="sm"
                            selected={s().series_id === series().series_id}
                            label={s().seasonLabel}
                            onPress={() => props.onSelectSeason(s())}
                          />
                        )}
                      </Each>
                    </View>
                  </View>
                </If>

                <View class="gap-2">
                  <Text role="header" class="text-sm font-semibold text-muted-foreground">
                    📖 剧情简介
                  </Text>
                  <Text style={{ userSelect: "text" }} class="text-sm leading-relaxed text-popover-foreground">
                    {series().intro || "暂无该剧剧情简介"}
                  </Text>
                </View>

                <If when={series().celebrities.length > 0}>
                  <View class="gap-2.5 border-t border-border pt-4">
                    <Text role="header" class="text-sm font-semibold text-muted-foreground">
                      🎬 演职员表 ({series().celebrities.length})
                    </Text>
                    <View class="flex-row flex-wrap gap-2.5">
                      <Each of={series().celebrities} key={(c) => c.actor_id}>
                        {(actor) => (
                          <UiButton
                            variant="outline"
                            size="lg"
                            accessibilityLabel={`查看演员 ${actor().name}`}
                            onPress={() => props.onSelectActor(actor())}
                            class="h-auto justify-start gap-2.5 px-3 py-2"
                          >
                            <If when={platform.idiom !== "terminal"}>
                              <Image src={actor().avatar} class="size-9 rounded-full border border-border object-cover" />
                            </If>
                            <View class="items-start gap-0.5">
                              <Text class="text-xs font-semibold text-foreground">{actor().name}</Text>
                              <Text class="text-[11px] text-dim">{actor().role}</Text>
                            </View>
                          </UiButton>
                        )}
                      </Each>
                    </View>
                  </View>
                </If>
              </View>
            </Scroll>

            <View class="shrink-0 flex-row justify-end border-t border-border bg-stage-header/60 px-6 py-3.5">
              <UiButton
                variant="primary"
                label="继续播放"
                onPress={() => props.onOpenChange(false)}
              />
            </View>
          </View>
        )}
      </If>
    </UiDialog>
  );
}

// ===== 2. Series All-Seasons Modal (`series-seasons.jpg` 1:1) =====

export interface SeasonsModalProps {
  open: boolean;
  baseTitle: string;
  activeSeriesId?: string;
  seasons: SeasonEntry[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSeason: (season: SeasonEntry) => void;
  onSearchGlobally: (keyword: string) => void;
}

export function SeasonsModal(props: SeasonsModalProps) {
  return (
    <UiDialog
      testID="seasons-dialog"
      open={props.open}
      title={`《${props.baseTitle}》系列全季`}
      size="xl"
      scrollable
      onOpenChange={props.onOpenChange}
    >
      <View class="flex-1">
        <View class="shrink-0 flex-row items-start justify-between border-b border-border bg-primary/10 px-6 py-4">
          <View class="gap-1">
            <View class="flex-row flex-wrap items-center gap-2.5">
              <Text class="text-xl">📚</Text>
              <Text role="header" class="text-lg font-bold text-popover-foreground">
                《{props.baseTitle}》系列全季
              </Text>
              <If when={props.seasons.length > 0}>
                <UiBadge label={`共 ${props.seasons.length} 季 · 已排好序`} tone="primary" pill />
              </If>
            </View>
            <Text class="text-xs text-muted-foreground">
              支持按季直接选看，点击任意一季即刻无缝换季播放
            </Text>
          </View>
          <UiIconButton
            icon="close"
            size="sm"
            accessibilityLabel="关闭系列全季弹窗"
            onPress={() => props.onOpenChange(false)}
            class="rounded-full bg-accent/60"
          />
        </View>

        <Scroll class="flex-1">
          <View class="p-6">
            <If
              when={!props.loading || props.seasons.length > 0}
              else={
                <View class="py-16">
                  <UiSpinner label="正在检索系列全部季目..." />
                </View>
              }
            >
              <If
                when={props.seasons.length > 0}
                else={
                  <UiEmptyState
                    icon="layers"
                    title="未找到其他季短剧"
                    description="可尝试在全站范围检索同名系列内容。"
                    actionLabel={`🔍 在全站搜索“${props.baseTitle}”`}
                    onAction={() => props.onSearchGlobally(props.baseTitle)}
                  />
                }
              >
                <View class="flex-row flex-wrap gap-4">
                  <Each of={props.seasons} key={(s) => s.series_id}>
                    {(season) => {
                      const isCurrent = () => season().series_id === props.activeSeriesId;
                      return (
                        <View class="w-[196px]">
                          <UiButton
                            testID={`modal-season-${season().seasonNum}`}
                            variant="ghost"
                            selected={isCurrent()}
                            accessibilityLabel={`${season().seasonLabel} ${season().series_title}，共 ${season().total} 集`}
                            onPress={() => props.onSelectSeason(season())}
                            class={`h-auto w-full flex-col items-stretch overflow-hidden rounded-[10px] border p-0 ${
                              isCurrent()
                                ? "border-primary bg-primary/6"
                                : "border-border bg-card/60 hover:border-foreground/25 hover:bg-card"
                            }`}
                          >
                            <If when={platform.idiom !== "terminal"}>
                              <View class="relative w-full overflow-hidden bg-surface" style={{ aspectRatio: 3 / 4 }}>
                                <Image src={season().cover} class="size-full object-cover" />
                                <View class="absolute top-2 left-2">
                                  <UiBadge
                                    label={season().seasonLabel}
                                    tone={isCurrent() ? "primary" : "stage"}
                                    pill
                                  />
                                </View>
                                <If when={isCurrent()}>
                                  <View class="absolute top-2 right-2">
                                    <UiBadge label="ılı 正在播放" tone="solidPrimary" pill />
                                  </View>
                                  <View class="absolute right-0 bottom-0 left-0 h-1 bg-primary" />
                                </If>
                              </View>
                            </If>
                            <View class="w-full gap-1.5 p-3">
                              <View class="flex-row items-start justify-between gap-1.5">
                                <Text
                                  style={{ numberOfLines: 1 }}
                                  class={`flex-1 text-xs font-semibold ${
                                    isCurrent() ? "font-bold text-primary" : "text-foreground"
                                  }`}
                                >
                                  {season().series_title}
                                </Text>
                                <If when={isCurrent()}>
                                  <UiBadge label="当前" tone="solidPrimary" />
                                </If>
                              </View>
                              <View class="flex-row flex-wrap items-center gap-1.5">
                                <Text class="text-[11px] tabular-nums text-muted-foreground">
                                  共 {season().total} 集
                                </Text>
                                <If when={season().social_info?.hot_text}>
                                  {(h) => <Text class="text-[11px] text-primary">🔥 {h()}</Text>}
                                </If>
                                <If when={season().social_info?.rating}>
                                  {(r) => <Text class="text-[11px] tabular-nums text-gold">★ {r()}</Text>}
                                </If>
                              </View>
                            </View>
                          </UiButton>
                        </View>
                      );
                    }}
                  </Each>
                </View>
              </If>
            </If>
          </View>
        </Scroll>

        <View class="shrink-0 flex-row items-center justify-between border-t border-border bg-stage-header/60 px-6 py-3.5">
          <UiButton
            variant="outline"
            size="md"
            label={`🔍 在全站搜索“${props.baseTitle}”全部短剧`}
            onPress={() => props.onSearchGlobally(props.baseTitle)}
          />
          <UiButton variant="primary" size="md" label="关闭" onPress={() => props.onOpenChange(false)} />
        </View>
      </View>
    </UiDialog>
  );
}

// ===== 3. Actor Profile & Works Modal =====

export interface ActorModalProps {
  open: boolean;
  actor: ActorDetail | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchActor: (actorId: string) => void;
  onPlayWork: (work: SeriesSummary) => void;
}

export function ActorModal(props: ActorModalProps) {
  const visibleLimit = signal(4);

  return (
    <UiDialog
      testID="actor-detail-dialog"
      open={props.open}
      title={props.actor ? `${props.actor.name} 的主页与作品` : "演员主页"}
      size="xl"
      scrollable
      onOpenChange={(open) => {
        if (!open) visibleLimit.set(4);
        props.onOpenChange(open);
      }}
    >
      <View class="flex-1">
        <If
          when={!props.loading ? props.actor : null}
          else={
            <View class="flex-1 items-center justify-center py-20">
              <UiSpinner label="正在加载演员主页与参演短剧…" />
            </View>
          }
        >
          {(actor) => (
            <View class="flex-1">
              <View class="shrink-0 flex-row items-start justify-between gap-4 border-b border-border bg-primary/8 p-6">
                <View class="flex-1 flex-row items-start gap-5">
                  <If when={platform.idiom !== "terminal"}>
                    <Image
                      src={actor().avatar}
                      class="size-24 rounded-full border-2 border-primary object-cover shadow-md"
                    />
                  </If>
                  <View class="min-w-0 flex-1 gap-2">
                    <View class="flex-row flex-wrap items-center gap-2.5">
                      <Text role="header" class="text-xl font-bold text-popover-foreground">
                        {actor().name}
                      </Text>
                      <If when={actor().score}><UiBadge label={`🔥 ${actor().score}`} tone="primary" pill /></If>
                      <If when={actor().rank > 0}><UiBadge label={`剧星榜 TOP ${actor().rank}`} tone="gold" pill /></If>
                    </View>
                    <Text style={{ userSelect: "text" }} class="text-xs leading-relaxed text-muted-foreground">
                      {actor().intro}
                    </Text>

                    <If when={actor().related_celebrities.length > 0}>
                      <View class="flex-row flex-wrap items-center gap-2 pt-1">
                        <Text class="text-xs text-dim">合作演员：</Text>
                        <Each of={actor().related_celebrities} key={(rel) => rel.actor_id}>
                          {(rel) => (
                            <UiButton
                              variant="chip"
                              size="sm"
                              label={rel().name}
                              onPress={() => {
                                visibleLimit.set(4);
                                props.onSwitchActor(rel().actor_id);
                              }}
                            />
                          )}
                        </Each>
                      </View>
                    </If>
                  </View>
                </View>

                <UiIconButton
                  icon="close"
                  size="sm"
                  accessibilityLabel="关闭演员弹窗"
                  onPress={() => props.onOpenChange(false)}
                  class="rounded-full bg-accent/60"
                />
              </View>

              <Scroll class="flex-1">
                <View class="gap-4 p-6">
                  <View class="flex-row items-center justify-between">
                    <Text role="header" class="text-base font-bold text-popover-foreground">
                      🎬 参演短剧作品 ({actor().works.length})
                    </Text>
                    <Text class="text-xs text-dim">点击任意短剧立即开播</Text>
                  </View>

                  <View class="flex-row flex-wrap gap-4">
                    <Each of={actor().works.slice(0, visibleLimit())} key={(w) => w.series_id}>
                      {(work, idx) => (
                        <View class="w-48">
                          <DramaCard
                            drama={work()}
                            index={idx()}
                            onSelect={(chosen) => props.onPlayWork(chosen)}
                          />
                        </View>
                      )}
                    </Each>
                  </View>

                  <If when={actor().works.length > visibleLimit()}>
                    <View class="items-center pt-2">
                      <UiButton
                        testID="actor-load-more-btn"
                        variant="outline"
                        label={`加载更多参演短剧 (${visibleLimit()}/${actor().works.length})`}
                        onPress={() => visibleLimit.update((n) => n + 6)}
                      />
                    </View>
                  </If>
                </View>
              </Scroll>
            </View>
          )}
        </If>
      </View>
    </UiDialog>
  );
}

// ===== 4. Media Source Configuration Modal =====

export interface SourceConfigModalProps {
  open: boolean;
  currentUrl: string;
  onOpenChange: (open: boolean) => void;
  onApplyUrl: (url: string) => Promise<void>;
  onImportLocal: () => void;
}

export function SourceConfigModal(props: SourceConfigModalProps) {
  const draftUrl = signal(props.currentUrl);
  const loading = signal(false);
  const errorText = signal("");

  const handleConnect = async () => {
    errorText.set("");
    loading.set(true);
    try {
      await props.onApplyUrl(draftUrl());
      props.onOpenChange(false);
    } catch (err) {
      errorText.set(err instanceof Error ? err.message : String(err));
    } finally {
      loading.set(false);
    }
  };

  return (
    <UiDialog
      testID="source-config-dialog"
      open={props.open}
      title="配置数据源接口"
      size="md"
      onOpenChange={props.onOpenChange}
    >
      <View class="gap-4 p-6">
        <View class="flex-row items-center justify-between">
          <Text role="header" class="text-base font-bold text-popover-foreground">
            数据源接入设置
          </Text>
          <UiIconButton
            icon="close"
            size="sm"
            accessibilityLabel="关闭数据源设置"
            onPress={() => props.onOpenChange(false)}
          />
        </View>

        <Text class="text-xs leading-relaxed text-muted-foreground">
          已接入红果片源。还可以添加自定义 HTTP(S) JSON 片单，或从本地导入 MP4/MOV/WebM/JSON 文件。
        </Text>

        <View class="gap-2">
          <Text class="text-xs font-medium text-popover-foreground">自定义 JSON 片单地址</Text>
          <UiInput
            testID="custom-source-url-input"
            value={draftUrl()}
            placeholder="https://example.com/open-catalog.json"
            onChange={(v) => draftUrl.set(v)}
            onSubmit={() => void handleConnect()}
          />
          <If when={errorText().length > 0}>
            <Text class="text-xs text-destructive">{errorText()}</Text>
          </If>
        </View>

        <UiSeparator />

        <View class="flex-row items-center justify-between gap-2">
          <UiButton
            variant="outline"
            icon="folder"
            label="选择本地 MP4 / JSON 文件…"
            onPress={() => {
              props.onOpenChange(false);
              props.onImportLocal();
            }}
          />
          <View class="flex-row items-center gap-2">
            <UiButton variant="ghost" label="取消" onPress={() => props.onOpenChange(false)} />
            <UiButton
              testID="apply-source-url-btn"
              variant="primary"
              disabled={loading() || !draftUrl().trim()}
              label={loading() ? "正在加载…" : "接入片单"}
              onPress={() => void handleConnect()}
            />
          </View>
        </View>
      </View>
    </UiDialog>
  );
}

// ===== 5. Keyboard Shortcuts Modal (`.shortcuts-modal` 1:1) =====

const SHORTCUT_ROWS: { keys: string; desc: string }[] = [
  { keys: "空格 / K", desc: "播放 / 暂停视频" },
  { keys: "↑ / PageUp", desc: "切换至上一集" },
  { keys: "↓ / PageDown", desc: "切换至下一集" },
  { keys: "← / →", desc: "快退 / 快进 5 秒" },
  { keys: "F / 双击画面", desc: "进入 / 退出全屏模式" },
  { keys: "M", desc: "静音 / 恢复声音" },
  { keys: "Esc", desc: "退出全屏 / 关闭当前弹窗" },
  { keys: "Ctrl/Cmd + K", desc: "聚焦顶部搜索框" },
];

export function ShortcutsModal(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <UiDialog
      testID="shortcuts-dialog"
      open={props.open}
      title="快捷键操作指南"
      size="md"
      onOpenChange={props.onOpenChange}
    >
      <View class="gap-4 p-6">
        <View class="flex-row items-center justify-between">
          <Text role="header" class="text-base font-bold text-popover-foreground">
            ⌨️ 快捷键操作指南
          </Text>
          <UiIconButton
            icon="close"
            size="sm"
            accessibilityLabel="关闭快捷键指南"
            onPress={() => props.onOpenChange(false)}
          />
        </View>

        <View class="gap-2">
          <Each of={SHORTCUT_ROWS} key={(r) => r.keys}>
            {(row) => (
              <View class="flex-row items-center justify-between rounded-md border border-border/70 bg-card/60 px-3.5 py-2.5">
                <UiBadge label={row().keys} tone="neutral" />
                <Text class="text-xs text-popover-foreground">{row().desc}</Text>
              </View>
            )}
          </Each>
        </View>

        <View class="flex-row justify-end pt-1">
          <UiButton variant="primary" label="我知道了" onPress={() => props.onOpenChange(false)} />
        </View>
      </View>
    </UiDialog>
  );
}

// ===== 6. About Modal (`.about-modal` 1:1) =====

export function AboutModal(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const info = appInfo();

  return (
    <UiDialog
      testID="about-dialog"
      open={props.open}
      title="关于 红果开源播放器"
      size="md"
      onOpenChange={props.onOpenChange}
    >
      <View class="gap-4 p-6">
        <View class="flex-row items-center justify-between">
          <View class="flex-row items-center gap-3.5">
            <If when={platform.idiom !== "terminal"}>
              <Image src={appIcon} class="size-11 rounded-xl object-contain" />
            </If>
            <View class="gap-0.5">
              <Text role="header" class="text-base font-bold text-popover-foreground">
                红果开源播放器
              </Text>
              <Text class="text-xs text-dim">
                v{info.version ?? "1.0.0"} · 基于 Longbridge Native Shell (NSH) 原生桌面客户端
              </Text>
            </View>
          </View>
          <UiIconButton
            icon="close"
            size="sm"
            accessibilityLabel="关闭关于弹窗"
            onPress={() => props.onOpenChange(false)}
          />
        </View>

        <Text style={{ userSelect: "text" }} class="text-xs leading-relaxed text-muted-foreground">
          基于 Longbridge Native Shell (github.com/longbridge/nsh) 复刻构建的跨平台原生桌面短剧播放客户端。提供五列海报浏览、剧星榜、沉浸式自适应画幅观影、后三集顺序预加载、多季自动排序补全、多色防碰撞弹幕与本地进度记忆。
        </Text>

        <View class="flex-row flex-wrap gap-2">
          <UiBadge label="🚀 NSH 原生视图渲染" tone="neutral" pill />
          <UiBadge label="📱 沉浸式自适应画幅" tone="neutral" pill />
          <UiBadge label="🌟 剧星榜与演员主页" tone="neutral" pill />
          <UiBadge label="⚡ 后 3 集顺序预加载" tone="neutral" pill />
        </View>

        <UiSurface class="gap-1.5 p-3.5">
          <Text class="text-xs text-card-foreground">开源许可：GPL-3.0 / Apache-2.0 (NSH Runtime)</Text>
          <Text class="text-xs text-dim">
            Windows 版已接入红果目录、搜索、真实弹幕与多季列表，支持本地媒体和自定义片单。
          </Text>
        </UiSurface>

        <View class="flex-row items-center justify-end gap-2.5">
          <UiButton
            variant="outline"
            label="访问 GitHub 主页"
            onPress={() => void openUrl("https://github.com/zfdang/hongguo-open-player")}
          />
          <UiButton variant="primary" label="确定" onPress={() => props.onOpenChange(false)} />
        </View>
      </View>
    </UiDialog>
  );
}
