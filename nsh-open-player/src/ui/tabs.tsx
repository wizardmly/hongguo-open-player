import { type JSX, Text } from "nsh";
import { Tab, Tabs } from "nsh/base";
import { Icon, type IconName } from "./icons";

export interface UiTabsProps {
  variant?: "nav" | "sidebar" | "pill" | "segmented" | "underline";
  class?: string;
  children?: JSX.Element;
}

/** Semantic tab list with native spring-animated indicator. */
export function UiTabs(props: UiTabsProps) {
  const variant = () => props.variant ?? "segmented";
  const rootClass = () => {
    const v = variant();
    if (v === "underline") {
      return "flex-row items-center gap-1 border-b border-border px-2";
    }
    if (v === "nav" || v === "pill") {
      return "flex-row items-center gap-1";
    }
    if (v === "sidebar") {
      return "flex-row items-center gap-1 border-b border-border bg-stage/25 px-3.5 py-1.5";
    }
    return "flex-row items-center gap-0.5 rounded-lg bg-muted p-1";
  };
  const indicatorClass = () => {
    const v = variant();
    if (v === "underline") {
      return "bottom-0 h-0.5 rounded-full bg-primary";
    }
    if (v === "nav") {
      return "inset-y-0 rounded-full bg-nav-active";
    }
    if (v === "sidebar") {
      return "inset-y-1.5 rounded-md bg-primary/16 border border-primary/40";
    }
    if (v === "pill") {
      return "inset-y-0.5 rounded-full bg-primary/18 border border-primary/40";
    }
    return "inset-y-1 rounded-md bg-card shadow-sm border border-border/60";
  };

  return (
    <Tabs
      indicatorClass={indicatorClass()}
      class={`${rootClass()} ${props.class ?? ""}`}
    >
      {props.children}
    </Tabs>
  );
}

export interface UiTabProps {
  label: string;
  icon?: IconName;
  selected: boolean;
  disabled?: boolean;
  pill?: boolean;
  testID?: string;
  class?: string;
  onPress: () => void;
}

/** Single accessible tab button inside `UiTabs`. */
export function UiTab(props: UiTabProps) {
  return (
    <Tab
      testID={props.testID}
      selected={props.selected}
      disabled={props.disabled}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      class={`group flex-row items-center justify-center gap-1.5 ${
        props.pill ? "rounded-full px-2.5 py-1.5" : "rounded-md px-2.5 py-1.5"
      } transition duration-150 hover:bg-accent/55 active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 ${props.class ?? ""}`}
    >
      <If when={props.icon}>
        {(name) => <Icon name={name()} size={14} tone={props.selected ? "primary" : "muted-foreground"} />}
      </If>
      <Text
        class={`text-xs ${
          props.selected
            ? props.pill
              ? "font-semibold text-primary-foreground"
              : "font-semibold text-foreground"
            : "font-medium text-muted-foreground"
        }`}
      >
        {props.label}
      </Text>
    </Tab>
  );
}
