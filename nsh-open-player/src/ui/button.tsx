import { type JSX, platform, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Icon, type IconName } from "./icons";
import { UiTooltip } from "./overlays";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "stage"
  | "stageGhost"
  | "chip"
  | "seasonPill"
  | "episode"
  | "group";
export type ControlSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary hover:bg-primary/90 active:bg-primary/80 selected:bg-primary",
  secondary:
    "bg-card border border-border hover:bg-accent active:bg-accent/85 selected:bg-primary selected:border-primary selected:hover:bg-primary/90",
  outline:
    "bg-transparent border border-border hover:bg-accent/60 active:bg-accent selected:border-primary selected:bg-primary/15 selected:hover:bg-primary/20",
  ghost:
    "bg-transparent hover:bg-accent/65 active:bg-accent selected:bg-accent",
  danger:
    "bg-destructive/15 border border-destructive/40 hover:bg-destructive/25 active:bg-destructive/35",
  stage:
    "bg-transparent border border-border hover:bg-stage-foreground/8 hover:border-muted-foreground active:bg-stage-foreground/15 selected:border-primary selected:bg-primary/12 selected:hover:bg-primary/18",
  stageGhost:
    "bg-transparent hover:bg-stage-foreground/10 active:bg-stage-foreground/18",
  chip:
    "rounded-full bg-surface border border-border hover:border-primary hover:bg-primary/10 selected:bg-primary selected:border-primary selected:hover:bg-primary/90",
  seasonPill:
    "rounded-full bg-primary/18 border border-primary/45 hover:bg-primary/30 hover:border-primary",
  episode:
    "bg-card border border-border hover:bg-accent hover:border-dim selected:bg-ep-active selected:border-ep-active-border selected:hover:bg-ep-active selected:hover:border-ep-active-border",
  group:
    "rounded-sm bg-card border border-border hover:bg-accent selected:bg-group-active selected:border-group-active-border selected:hover:bg-group-active selected:hover:border-group-active-border",
};

const SIZE_CLASSES: Record<ControlSize, string> = {
  sm: "h-7 px-3 gap-1.5 rounded-md",
  md: "h-8 px-3.5 gap-1.5 rounded-md",
  lg: "h-10 px-4 gap-2 rounded-md",
};

const ICON_SIZE_CLASSES: Record<ControlSize, string> = {
  sm: "size-7 rounded-md",
  md: "size-8 rounded-md",
  lg: "size-10 rounded-md",
};

function labelTextClass(variant: ButtonVariant, selected?: boolean): string {
  if (
    variant === "primary" ||
    (selected && (variant === "secondary" || variant === "chip" || variant === "episode" || variant === "group"))
  ) {
    return "text-primary-foreground font-semibold";
  }
  if (variant === "danger") {
    return "text-destructive font-medium";
  }
  if (variant === "seasonPill") {
    return "text-primary font-semibold";
  }
  if (variant === "stage" && selected) {
    return "text-primary font-semibold";
  }
  if (variant === "stage" || variant === "stageGhost") {
    return "text-stage-foreground font-medium";
  }
  if (variant === "chip" || variant === "episode" || variant === "group") {
    return "text-muted-foreground font-medium";
  }
  if (selected && variant === "outline") {
    return "text-primary font-semibold";
  }
  return "text-foreground font-medium";
}

export interface UiButtonProps {
  label?: string;
  icon?: IconName;
  trailingIcon?: IconName;
  variant?: ButtonVariant;
  size?: ControlSize;
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  tooltip?: string;
  testID?: string;
  class?: string;
  onPress?: () => void;
  children?: JSX.Element;
}

/** App-owned semantic button built on `nsh/base`'s `Button`. */
export function UiButton(props: UiButtonProps) {
  const variant = () => props.variant ?? "secondary";
  const size = () => props.size ?? "md";
  const iconTone = () => {
    const v = variant();
    if (
      v === "primary" ||
      (props.selected && (v === "secondary" || v === "chip" || v === "episode"))
    ) {
      return "primary-foreground" as const;
    }
    if (v === "danger") return "destructive" as const;
    if (v === "seasonPill" || (props.selected && (v === "outline" || v === "stage"))) {
      return "primary" as const;
    }
    if (v === "stage" || v === "stageGhost") return "stage-foreground" as const;
    if (v === "chip" || v === "episode") return "muted-foreground" as const;
    return "foreground" as const;
  };
  const touchSlop = platform.desktop ? 2 : 8;

  return (
    <Button
      testID={props.testID}
      disabled={props.disabled}
      selected={props.selected}
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      hitSlop={touchSlop}
      onPress={props.onPress}
      tooltip={props.tooltip ? <UiTooltip text={props.tooltip} /> : undefined}
      class={`flex-row items-center justify-center transition duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 disabled:scale-100 ${SIZE_CLASSES[size()]} ${VARIANT_CLASSES[variant()]} ${props.class ?? ""}`}
    >
      <If when={props.icon}>
        {(name) => <Icon name={name()} size={size() === "sm" ? 14 : 16} tone={iconTone()} />}
      </If>
      <If when={props.label !== undefined}>
        <Text class={`${size() === "sm" ? "text-xs" : "text-[13px]"} ${labelTextClass(variant(), props.selected)}`}>
          {props.label}
        </Text>
      </If>
      {props.children}
      <If when={props.trailingIcon}>
        {(name) => <Icon name={name()} size={14} tone={iconTone()} />}
      </If>
    </Button>
  );
}

export interface UiIconButtonProps {
  icon: IconName;
  accessibilityLabel: string;
  tooltip?: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  selected?: boolean;
  disabled?: boolean;
  testID?: string;
  class?: string;
  onPress?: () => void;
}

/** Square icon-only button with mandatory `accessibilityLabel` and optional desktop tooltip. */
export function UiIconButton(props: UiIconButtonProps) {
  const variant = () => props.variant ?? "ghost";
  const size = () => props.size ?? "md";
  const iconTone = () => {
    const v = variant();
    if (v === "primary" || (props.selected && v === "secondary")) {
      return "primary-foreground" as const;
    }
    if (v === "danger") return "destructive" as const;
    if (props.selected && v === "stage") return "primary" as const;
    if (v === "stage" || v === "stageGhost") return "stage-foreground" as const;
    return "foreground" as const;
  };
  const touchSlop = platform.desktop ? 4 : 10;

  return (
    <Button
      testID={props.testID}
      disabled={props.disabled}
      selected={props.selected}
      accessibilityLabel={props.accessibilityLabel}
      hitSlop={touchSlop}
      onPress={props.onPress}
      tooltip={props.tooltip ? <UiTooltip text={props.tooltip} /> : undefined}
      class={`items-center justify-center transition duration-150 ease-out active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 disabled:scale-100 ${ICON_SIZE_CLASSES[size()]} ${VARIANT_CLASSES[variant()]} ${props.class ?? ""}`}
    >
      <If when={platform.idiom === "terminal"} else={<Icon name={props.icon} size={size() === "sm" ? 15 : 17} tone={iconTone()} />}>
        <View class="px-1">
          <Text class="text-xs text-foreground">{props.accessibilityLabel}</Text>
        </View>
      </If>
    </Button>
  );
}
