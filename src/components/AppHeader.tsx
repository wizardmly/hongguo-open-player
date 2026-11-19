import { Image, type InputRef, openUrl, platform, signal, Text, View, windowSize } from "nsh";
import { isAvailable as desktopWindowAvailable, titleBar } from "nsh/desktop";
import appIcon from "../../assets/app-icon.png";
import type { AppearanceMode, CatalogTab } from "../domain/types";
import {
  UiButton,
  UiIconButton,
  UiMenu,
  UiMenuItem,
  UiMenuSeparator,
  UiPopover,
  UiSearchInput,
  UiTab,
  UiTabs,
} from "../ui";

const NAV_ITEMS: { id: CatalogTab; label: string }[] = [
  { id: "hot-drama", label: "🔥 热门榜单" },
  { id: "actors", label: "🌟 剧星榜" },
  { id: "real-drama", label: "🎭 真人短剧" },
  { id: "comic-drama", label: "🎨 精品漫剧" },
  { id: "ai-drama", label: "🤖 AI 短剧" },
  { id: "history", label: "🕒 观影历史" },
  { id: "favorites", label: "⭐ 我的收藏" },
];

export interface AppHeaderProps {
  currentTab: CatalogTab;
  inTheater: boolean;
  searchKeyword: string;
  searchHistory: string[];
  appearance: AppearanceMode;
  searchInputRef?: (node: InputRef) => void;
  onGoHome: () => void;
  onSwitchTab: (tab: CatalogTab) => void;
  onSearchKeywordChange: (value: string) => void;
  onSubmitSearch: () => void;
  onSelectHistoryKeyword: (keyword: string) => void;
  onRemoveHistoryKeyword: (keyword: string) => void;
  onClearSearchHistory: () => void;
  onImportLocalMedia: () => void;
  onOpenSourceModal: () => void;
  onCycleAppearance: () => void;
  onOpenGalleryModal: () => void;
  onOpenShortcutsModal: () => void;
  onOpenAboutModal: () => void;
}

/** Persistent 60px top navigation bar replicating `hongguo-open-player` `.app-header`. */
export function AppHeader(props: AppHeaderProps) {
  const historyOpen = signal(false);
  const searchFocused = signal(false);
  const isTerm = platform.idiom === "terminal";
  const tb = () => (desktopWindowAvailable ? titleBar() : { height: 0, left: 0, right: 0 });
  const hideBrandSuffix = () => (isTerm ? windowSize().width < 95 : windowSize().width < 1140);
  const compact = () => (isTerm ? windowSize().width < 90 : windowSize().width < 940);
  const mobile = () => (isTerm ? windowSize().width < 64 : windowSize().width < 560);
  const padLeft = () => {
    const base = mobile() ? 12 : 20;
    const leftInset = tb().left;
    return leftInset > 0 ? leftInset + 12 : base;
  };
  const padRight = () => {
    const base = mobile() ? 12 : 20;
    const rightInset = tb().right;
    return rightInset > 0 ? rightInset + 22 : base;
  };

  const appearanceLabel = () =>
    props.appearance === "dark"
      ? "外观：深色影院"
      : props.appearance === "light"
        ? "外观：浅色纸感"
        : "外观：跟随系统";

  const searchExpanded = () => searchFocused() || props.searchKeyword.trim().length > 0;

  return (
    <View
      desktop={{ windowDrag: true }}
      style={isTerm ? undefined : { paddingLeft: padLeft(), paddingRight: padRight() }}
      class={`border-b border-border bg-surface/95 ${compact() ? "py-2" : "h-[60px] justify-center"} ${isTerm ? "px-2" : ""}`}
    >
      <View class="flex-row items-center justify-between gap-3">
        {/* Left: Brand + Category Pill Tabs */}
        <View class={mobile() ? "shrink-0 flex-row items-center" : "min-w-0 flex-1 flex-row items-center gap-3 overflow-hidden"}>
          <UiButton
            testID="brand-home-btn"
            variant="ghost"
            size="md"
            accessibilityLabel="返回首页"
            onPress={props.onGoHome}
            class="shrink-0 gap-1.5 px-1.5 hover:bg-transparent hover:opacity-90"
          >
            <If when={platform.idiom !== "terminal"}>
              <Image src={appIcon} class="size-7 rounded-md object-contain" />
            </If>
            <View class="flex-row items-center">
              <Text class="text-[15px] font-bold text-primary">红果</Text>
              <If when={!hideBrandSuffix()}>
                <Text class="ml-0.5 text-[15px] font-bold text-foreground">开源播放器</Text>
              </If>
            </View>
          </UiButton>

          <If when={!compact()}>
            <UiTabs variant="nav" class="min-w-0 flex-1 overflow-hidden">
              <Each of={NAV_ITEMS} key={(item) => item.id}>
                {(item) => (
                  <UiTab
                    testID={`nav-tab-${item().id}`}
                    pill
                    label={item().label}
                    selected={!props.inTheater && props.currentTab === item().id}
                    onPress={() => props.onSwitchTab(item().id)}
                  />
                )}
              </Each>
            </UiTabs>
          </If>
        </View>

        {/* Right: Pill Search Box (with anchored Recent Search dropdown) + Hamburger Menu */}
        <View class={mobile() ? "min-w-0 flex-1 flex-row items-center gap-2" : "shrink-0 flex-row items-center gap-2.5"}>
          <View class={mobile() ? "min-w-0 flex-1" : searchExpanded() ? "w-56" : "w-44"}>
            <UiPopover
              open={historyOpen() && props.searchHistory.length > 0}
              onOpenChange={(open) => historyOpen.set(open)}
              placement="bottom"
              align="end"
              class="w-64 p-2"
              trigger={
                <View testID="recent-search-trigger" class="w-full">
                  <UiSearchInput
                    value={props.searchKeyword}
                    inputRef={props.searchInputRef}
                    onChange={props.onSearchKeywordChange}
                    onFocus={() => {
                      searchFocused.set(true);
                      if (props.searchHistory.length > 0) historyOpen.set(true);
                    }}
                    onBlur={() => {
                      searchFocused.set(false);
                    }}
                    onSubmit={() => {
                      historyOpen.set(false);
                      props.onSubmitSearch();
                    }}
                    onClear={() => props.onSearchKeywordChange("")}
                  />
                </View>
              }
            >
              <View class="gap-1">
                <View class="flex-row items-center justify-between px-2 py-1">
                  <Text class="text-xs text-dim">最近搜索</Text>
                  <UiButton
                    testID="clear-search-history-btn"
                    variant="ghost"
                    size="sm"
                    label="清空"
                    onPress={() => {
                      props.onClearSearchHistory();
                      historyOpen.set(false);
                    }}
                  />
                </View>
                <Each of={props.searchHistory} key={(kw) => kw}>
                  {(kw) => (
                    <View class="flex-row items-center justify-between gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent">
                      <UiButton
                        variant="ghost"
                        size="sm"
                        label={kw()}
                        onPress={() => {
                          historyOpen.set(false);
                          props.onSelectHistoryKeyword(kw());
                        }}
                        class="flex-1 justify-start"
                      />
                      <UiIconButton
                        icon="close"
                        size="sm"
                        variant="ghost"
                        accessibilityLabel={`删除搜索历史：${kw()}`}
                        onPress={() => props.onRemoveHistoryKeyword(kw())}
                      />
                    </View>
                  )}
                </Each>
              </View>
            </UiPopover>
          </View>

          <UiMenu
            placement="bottom"
            align="end"
            trigger={
              <UiIconButton
                testID="app-menu-trigger"
                icon="menu"
                variant="outline"
                size="md"
                accessibilityLabel="菜单与帮助"
                tooltip="菜单与帮助"
                class="bg-surface"
              />
            }
          >
            <UiMenuItem
              testID="menu-open-shortcuts"
              icon="keyboard"
              label="快捷键指南"
              shortcutHint="?"
              onSelect={props.onOpenShortcutsModal}
            />
            <UiMenuItem
              testID="menu-import-local"
              icon="folder"
              label="导入本地视频 / 片单…"
              onSelect={props.onImportLocalMedia}
            />
            <UiMenuItem
              testID="menu-config-source"
              icon="globe"
              label="配置数据源接口…"
              onSelect={props.onOpenSourceModal}
            />
            <UiMenuItem
              testID="menu-toggle-appearance"
              icon={props.appearance === "light" ? "sun" : "moon"}
              label={appearanceLabel()}
              closeOnSelect={false}
              onSelect={props.onCycleAppearance}
            />
            <UiMenuSeparator />
            <UiMenuItem
              testID="menu-open-gallery"
              icon="layers"
              label="组件设计规范"
              onSelect={props.onOpenGalleryModal}
            />
            <UiMenuItem
              icon="globe"
              label="GitHub 项目主页"
              onSelect={() => void openUrl("https://github.com/zfdang/hongguo-open-player")}
            />
            <UiMenuItem
              testID="menu-open-about"
              icon="info"
              label="关于 红果开源播放器"
              onSelect={props.onOpenAboutModal}
            />
          </UiMenu>
        </View>
      </View>

      {/* Secondary tab strip on narrow viewports */}
      <If when={compact()}>
        <View class="mt-2">
          <UiTabs variant="nav" class="flex-wrap">
            <Each of={NAV_ITEMS} key={(item) => item.id}>
              {(item) => (
                <UiTab
                  testID={`nav-tab-${item().id}`}
                  pill
                  label={item().label}
                  selected={!props.inTheater && props.currentTab === item().id}
                  onPress={() => props.onSwitchTab(item().id)}
                />
              )}
            </Each>
          </UiTabs>
        </View>
      </If>
    </View>
  );
}
