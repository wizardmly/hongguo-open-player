import { type InputRef, signal, Text, token, View } from "nsh";
import { Button, Input } from "nsh/base";
import { Icon } from "./icons";

export interface UiInputProps {
  value: string;
  placeholder?: string;
  accessibilityLabel?: string;
  testID?: string;
  class?: string;
  inputRef?: (node: InputRef) => void;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** Standard single-line text input styled with semantic tokens and CJK composition safety. */
export function UiInput(props: UiInputProps) {
  const composing = signal(false);

  return (
    <Input
      testID={props.testID}
      ref={props.inputRef}
      value={props.value}
      placeholder={props.placeholder}
      accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
      returnKeyType="done"
      submitBehavior="submit"
      style={{
        placeholderColor: String(token("dim")),
        caretColor: String(token("primary")),
      }}
      onCompositionChange={(e) => composing.set(e.composing)}
      onChange={(e) => props.onChange(e.value)}
      onSubmit={(e) => {
        if (!composing()) props.onSubmit?.(e.text);
      }}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      class={`h-8 rounded-md border border-input bg-surface px-3 text-sm text-foreground focus:border-ring ${props.class ?? ""}`}
    />
  );
}

export interface UiSearchInputProps {
  value: string;
  placeholder?: string;
  testID?: string;
  class?: string;
  inputRef?: (node: InputRef) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Pill search input matching `hongguo-open-player` `.search-box`:
 * clean rounded-full pill at rest (`🔍 搜索短剧`), revealing clear + `搜索` pill button when focused or non-empty.
 */
export function UiSearchInput(props: UiSearchInputProps) {
  const composing = signal(false);
  const focused = signal(false);
  const active = () => focused() || props.value.trim().length > 0;

  return (
    <View
      class={`h-8 flex-row items-center gap-1 rounded-full border bg-surface pl-3 pr-1 transition-all duration-150 ${
        active() ? "border-primary" : "border-border"
      } ${props.class ?? ""}`}
    >
      <Icon name="search" size={14} tone="muted-foreground" />
      <Input
        testID={props.testID ?? "search-input"}
        ref={props.inputRef}
        value={props.value}
        placeholder={props.placeholder ?? "搜索短剧"}
        accessibilityLabel="搜索短剧名、主角或题材"
        returnKeyType="search"
        submitBehavior="submit"
        style={{
          placeholderColor: String(token("dim")),
          caretColor: String(token("primary")),
        }}
        onCompositionChange={(e) => composing.set(e.composing)}
        onChange={(e) => props.onChange(e.value)}
        onSubmit={() => {
          if (!composing()) props.onSubmit();
        }}
        onFocus={() => {
          focused.set(true);
          props.onFocus?.();
        }}
        onBlur={() => {
          focused.set(false);
          props.onBlur?.();
        }}
        class="min-w-0 flex-1 border-0 bg-transparent px-1 py-0 text-xs text-foreground"
      />
      <If when={props.value.length > 0}>
        <Button
          testID="search-clear-btn"
          accessibilityLabel="清空搜索词"
          hitSlop={6}
          onPress={props.onClear}
          class="size-5 items-center justify-center rounded-full hover:bg-accent active:scale-95"
        >
          <Icon name="close" size={11} tone="muted-foreground" />
        </Button>
      </If>
      <If when={active()}>
        <Button
          testID="search-submit-btn"
          accessibilityLabel="执行搜索"
          onPress={props.onSubmit}
          class="h-6 items-center justify-center rounded-full bg-primary px-3 transition duration-150 hover:bg-primary/90 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Text class="text-xs font-semibold text-primary-foreground">搜索</Text>
        </Button>
      </If>
    </View>
  );
}
