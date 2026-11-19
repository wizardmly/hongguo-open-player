import { createMotion, type JSX, Text, View } from "nsh";
import { Slider, Switch } from "nsh/base";
import { UiButton } from "./button";
import { Icon, type IconName } from "./icons";

export interface UiSwitchProps {
  checked: boolean;
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
  onChange: (checked: boolean) => void;
}

/** Accessible switch with fully styled track and thumb parts. */
export function UiSwitch(props: UiSwitchProps) {
  return (
    <Switch
      testID={props.testID}
      checked={props.checked}
      disabled={props.disabled}
      hitSlop={6}
      accessibilityLabel={props.accessibilityLabel ?? props.label ?? "切换开关"}
      onChange={(e) => props.onChange(e.checked)}
      trackClass="h-5 w-9 rounded-full border border-border bg-muted p-0.5 transition-colors duration-150 checked:border-primary checked:bg-primary"
      thumbClass="size-3.5 rounded-full bg-foreground transition-transform duration-150 checked:translate-x-4 checked:bg-primary-foreground"
      class="flex-row items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45"
    >
      <If when={props.label}>
        {(txt) => <Text class="text-xs font-medium text-foreground">{txt()}</Text>}
      </If>
    </Switch>
  );
}

export interface UiSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  tone?: "primary" | "progress";
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
  class?: string;
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number) => void;
}

/** Accessible single-thumb slider with styled track, rail, range and thumb parts. */
export function UiSlider(props: UiSliderProps) {
  const isProgress = () => props.tone === "progress";
  return (
    <Slider
      testID={props.testID}
      value={props.value}
      min={props.min ?? 0}
      max={props.max ?? 100}
      step={props.step ?? 1}
      disabled={props.disabled}
      accessibilityLabel={props.accessibilityLabel}
      onChange={(e) => {
        if (typeof e.value === "number") props.onChange?.(e.value);
      }}
      onChangeEnd={(e) => {
        if (typeof e.value === "number") props.onChangeEnd?.(e.value);
      }}
      trackClass="group h-6 justify-center"
      indicatorClass={`h-1 rounded-full ${
        isProgress() ? "bg-stage-foreground/20 group-hover:h-1.5" : "bg-muted group-hover:h-1.5"
      } transition-all duration-150`}
      rangeClass={`rounded-full ${isProgress() ? "bg-progress" : "bg-primary"}`}
      thumbClass={`size-3 rounded-full ${
        isProgress()
          ? "border border-stage-foreground/90 bg-progress"
          : "border border-primary-foreground/80 bg-primary"
      } shadow-sm transition-transform duration-150 hover:scale-115 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40`}
      class={`justify-center ${props.class ?? ""}`}
    />
  );
}

export type BadgeTone =
  | "neutral"
  | "subtle"
  | "primary"
  | "solidPrimary"
  | "hot"
  | "success"
  | "warning"
  | "destructive"
  | "stage"
  | "gold"
  | "solidGold"
  | "solidSilver"
  | "solidBronze"
  | "silver"
  | "bronze";

const BADGE_CLASSES: Record<BadgeTone, { box: string; text: string }> = {
  neutral: { box: "bg-surface border border-border", text: "text-muted-foreground" },
  subtle: { box: "bg-surface", text: "text-muted-foreground" },
  primary: { box: "bg-primary/15 border border-primary/35", text: "text-primary font-semibold" },
  solidPrimary: { box: "bg-primary border border-primary shadow-sm", text: "text-primary-foreground font-semibold" },
  hot: { box: "bg-hot/14", text: "text-hot font-medium" },
  success: { box: "bg-success/14", text: "text-success font-semibold" },
  warning: { box: "bg-warning/15 border border-warning/35", text: "text-warning font-medium" },
  destructive: { box: "bg-destructive/14", text: "text-destructive font-semibold" },
  stage: { box: "bg-stage/78 border border-stage-foreground/12", text: "text-stage-foreground font-semibold" },
  gold: { box: "bg-gold/14", text: "text-gold font-semibold" },
  solidGold: { box: "bg-gold shadow-sm", text: "text-stage font-bold" },
  solidSilver: { box: "bg-silver shadow-sm", text: "text-stage font-bold" },
  solidBronze: { box: "bg-bronze shadow-sm", text: "text-primary-foreground font-bold" },
  silver: { box: "bg-silver/18 border border-silver/45", text: "text-silver font-semibold" },
  bronze: { box: "bg-bronze/18 border border-bronze/45", text: "text-bronze font-semibold" },
};

export interface UiBadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  pill?: boolean;
  class?: string;
}

/** Compact semantic status or metadata tag. */
export function UiBadge(props: UiBadgeProps) {
  const tone = () => props.tone ?? "neutral";
  const iconTone = () => {
    const t = tone();
    if (t === "solidPrimary" || t === "solidBronze") return "primary-foreground" as const;
    if (t === "solidGold" || t === "solidSilver") return "foreground" as const;
    if (t === "primary") return "primary" as const;
    if (t === "success") return "success" as const;
    if (t === "warning" || t === "hot") return "warning" as const;
    if (t === "destructive") return "destructive" as const;
    if (t === "stage") return "stage-foreground" as const;
    if (t === "gold") return "gold" as const;
    if (t === "silver") return "silver" as const;
    if (t === "bronze") return "bronze" as const;
    return "muted-foreground" as const;
  };

  return (
    <View
      class={`flex-row items-center gap-1 ${props.pill ? "rounded-full px-2.5 py-0.5" : "rounded-sm px-1.5 py-0.5"} ${BADGE_CLASSES[tone()].box} ${props.class ?? ""}`}
    >
      <If when={props.icon}>
        {(name) => <Icon name={name()} size={11} tone={iconTone()} />}
      </If>
      <Text class={`text-[11px] ${BADGE_CLASSES[tone()].text}`}>{props.label}</Text>
    </View>
  );
}

export interface UiSurfaceProps {
  elevated?: boolean;
  class?: string;
  children?: JSX.Element;
}

/** Semantic card/panel container with hairline border and concentric radius. */
export function UiSurface(props: UiSurfaceProps) {
  return (
    <View
      class={`rounded-xl border border-border ${props.elevated ? "bg-surface-elevated shadow-md" : "bg-card"} ${props.class ?? ""}`}
    >
      {props.children}
    </View>
  );
}

/** Hairline horizontal or vertical separator. */
export function UiSeparator(props: { vertical?: boolean; class?: string }) {
  return (
    <View class={`${props.vertical ? "h-4 w-px" : "h-px w-full"} bg-border ${props.class ?? ""}`} />
  );
}

/** Indeterminate native-animated spinner. */
export function UiSpinner(props: { size?: number; label?: string }) {
  const spin = createMotion({ enter: "spin" });
  const s = () => props.size ?? 24;

  return (
    <View class="flex-row items-center justify-center gap-2.5">
      <View
        style={{ width: s(), height: s(), ...spin.style }}
        class="items-center justify-center rounded-full border-2 border-muted-foreground/30 border-t-primary"
      />
      <If when={props.label}>
        {(txt) => <Text class="text-xs font-medium text-muted-foreground">{txt()}</Text>}
      </If>
    </View>
  );
}

/** Pulsing skeleton placeholder block. */
export function UiSkeleton(props: { class?: string }) {
  const pulse = createMotion({ enter: "glow" });
  return <View style={pulse.style} class={`rounded-lg bg-card ${props.class ?? ""}`} />;
}

export interface UiEmptyStateProps {
  icon: IconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Structured empty or recoverable error state with optional primary recovery action. */
export function UiEmptyState(props: UiEmptyStateProps) {
  return (
    <View class="flex-1 items-center justify-center gap-3 px-6 py-16">
      <View class="size-12 items-center justify-center rounded-full border border-border bg-surface">
        <Icon name={props.icon} size={22} tone="muted-foreground" />
      </View>
      <Text role="header" class="text-base font-semibold text-foreground">
        {props.title}
      </Text>
      <Text class="max-w-md text-center text-xs text-dim">{props.description}</Text>
      <If when={props.actionLabel && props.onAction}>
        <UiButton
          variant="outline"
          size="md"
          label={props.actionLabel}
          onPress={props.onAction}
          class="mt-1"
        />
      </If>
    </View>
  );
}
