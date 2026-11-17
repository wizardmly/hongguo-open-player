import { Scroll, signal, Text, View } from "nsh";
import {
  showToast,
  UiBadge,
  UiButton,
  UiDialog,
  UiEmptyState,
  UiIconButton,
  UiInput,
  UiSeparator,
  UiSkeleton,
  UiSlider,
  UiSpinner,
  UiSurface,
  UiSwitch,
  UiTab,
  UiTabs,
} from "./index";

export interface UiGalleryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleAppearance: () => void;
}

/**
 * Built-in `src/ui/` Design System Gallery.
 * Displays every styled component in its variants, sizes and states in both Light and Dark appearances.
 */
export function UiGalleryModal(props: UiGalleryModalProps) {
  const sampleSwitch = signal(true);
  const sampleSlider = signal(65);
  const sampleTab = signal("buttons");
  const sampleText = signal("青玄剑歌");

  return (
    <UiDialog
      testID="ui-gallery-dialog"
      open={props.open}
      title="UI 组件库与设计规范"
      size="lg"
      scrollable
      onOpenChange={props.onOpenChange}
    >
      <View class="flex-1">
        <View class="shrink-0 flex-row items-center justify-between border-b border-border px-5 py-3.5">
          <View class="gap-0.5">
            <Text role="header" class="text-base font-semibold text-popover-foreground">
              UI 组件库与设计令牌预览
            </Text>
            <Text class="text-xs text-muted-foreground">
              所有页面统一由此组件层构建，支持深色影院与浅色纸感双外观实时切换
            </Text>
          </View>
          <View class="flex-row items-center gap-2">
            <UiButton
              variant="outline"
              size="sm"
              icon="sun"
              label="切换明暗外观"
              onPress={props.onToggleAppearance}
            />
            <UiIconButton
              icon="close"
              size="sm"
              accessibilityLabel="关闭组件库弹窗"
              onPress={() => props.onOpenChange(false)}
            />
          </View>
        </View>

        <Scroll class="flex-1">
          <View class="gap-4 p-5">
            <UiSurface class="gap-3 p-4">
              <Text role="header" class="text-sm font-semibold text-card-foreground">
                1. 按钮变体与尺寸 (UiButton / UiIconButton)
              </Text>
              <View class="flex-row flex-wrap items-center gap-2">
                <UiButton variant="primary" label="主要操作 (Primary)" icon="play" onPress={() => showToast("触发主要操作")} />
                <UiButton variant="secondary" label="次要按钮 (Secondary)" />
                <UiButton variant="outline" label="描边按钮 (Outline)" icon="layers" />
                <UiButton variant="ghost" label="幽灵按钮 (Ghost)" />
                <UiButton variant="danger" label="危险操作 (Danger)" />
                <UiButton variant="secondary" label="禁用态" disabled />
              </View>
              <View class="flex-row flex-wrap items-center gap-2">
                <UiButton size="sm" variant="outline" label="紧凑 sm" />
                <UiButton size="md" variant="outline" label="标准 md" />
                <UiButton size="lg" variant="outline" label="宽松 lg" />
                <UiIconButton icon="heart" variant="outline" size="md" accessibilityLabel="收藏示例" />
                <UiIconButton icon="heartFilled" variant="primary" size="md" accessibilityLabel="已收藏示例" />
              </View>
            </UiSurface>

            <UiSurface class="gap-3 p-4">
              <Text role="header" class="text-sm font-semibold text-card-foreground">
                2. 表单、选项卡与滑动控制 (UiInput / UiTabs / UiSwitch / UiSlider)
              </Text>
              <View class="flex-row flex-wrap items-center gap-3">
                <UiInput
                  value={sampleText()}
                  placeholder="输入示例文本"
                  onChange={(v) => sampleText.set(v)}
                  class="w-56"
                />
                <UiSwitch
                  checked={sampleSwitch()}
                  label={sampleSwitch() ? "弹幕已开启" : "弹幕已关闭"}
                  onChange={(v) => sampleSwitch.set(v)}
                />
              </View>
              <UiTabs variant="segmented" class="self-start">
                <UiTab label="分集列表" selected={sampleTab() === "buttons"} onPress={() => sampleTab.set("buttons")} />
                <UiTab label="系列全季" selected={sampleTab() === "seasons"} onPress={() => sampleTab.set("seasons")} />
                <UiTab label="播放统计" selected={sampleTab() === "stats"} onPress={() => sampleTab.set("stats")} />
              </UiTabs>
              <View class="gap-1">
                <Text class="text-xs tabular-nums text-muted-foreground">滑动数值：{sampleSlider()}%</Text>
                <UiSlider
                  value={sampleSlider()}
                  min={0}
                  max={100}
                  accessibilityLabel="示例滑块"
                  onChange={(v) => sampleSlider.set(v)}
                />
              </View>
            </UiSurface>

            <UiSurface class="gap-3 p-4">
              <Text role="header" class="text-sm font-semibold text-card-foreground">
                3. 徽章、加载态与空状态 (UiBadge / UiSpinner / UiSkeleton / UiEmptyState)
              </Text>
              <View class="flex-row flex-wrap items-center gap-2">
                <UiBadge label="全 186 集" tone="neutral" />
                <UiBadge label="正在热播" tone="primary" icon="flame" />
                <UiBadge label="已预载后 3 集" tone="success" icon="check" />
                <UiBadge label="网络重试" tone="warning" icon="alert" />
                <UiBadge label="TOP 1" tone="gold" icon="star" />
                <UiSpinner size={18} label="预加载队列运行中" />
              </View>
              <UiSeparator />
              <View class="flex-row gap-3">
                <UiSkeleton class="h-12 flex-1" />
                <UiSkeleton class="h-12 flex-1" />
              </View>
              <UiEmptyState
                icon="film"
                title="空状态组件预览"
                description="当列表暂无内容或检索无结果时，清晰说明现状并提供下一步操作。"
              />
            </UiSurface>
          </View>
        </Scroll>
      </View>
    </UiDialog>
  );
}
