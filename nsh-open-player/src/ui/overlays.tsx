import { cleanup, effect, type JSX, Overlay, signal, Text, View } from "nsh";
import {
  Dialog,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  Sheet,
  Toast,
  ToastManager,
  ToastStack,
  Tooltip,
  type Align,
  type Placement,
  type ToastEntry,
} from "nsh/base";
import { Icon, type IconName } from "./icons";

/** Shared floating popup surface classes across Popover, Menu and Tooltip. */
export const POPUP_SURFACE_CLASS =
  "rounded-lg border border-border bg-popover p-1.5 shadow-lg transition duration-200 ease-out";
export const POPUP_STARTING_CLASS = "opacity-0 scale-95 -translate-y-1";
export const POPUP_ENDING_CLASS = "opacity-0 scale-95 duration-150";
export const BACKDROP_CLASS = "bg-stage/70";

export interface UiTooltipProps {
  text: string;
}

/** Semantic tooltip bubble using shared popup surface tokens. */
export function UiTooltip(props: UiTooltipProps) {
  return (
    <Tooltip
      delay={450}
      offset={6}
      class="rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md transition duration-150 ease-out"
      startingClass="opacity-0 scale-95"
      endingClass="opacity-0 scale-95"
    >
      <Text class="text-xs text-popover-foreground">{props.text}</Text>
    </Tooltip>
  );
}

export interface UiDialogProps {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  size?: "sm" | "md" | "lg" | "xl";
  scrollable?: boolean;
  testID?: string;
  children?: JSX.Element;
}

const DIALOG_WIDTH: Record<NonNullable<UiDialogProps["size"]>, string> = {
  sm: "w-[420px] max-w-[92%]",
  md: "w-[560px] max-w-[92%]",
  lg: "w-[760px] max-w-[94%]",
  xl: "w-[920px] max-w-[95%]",
};

/** Centered accessible modal dialog with Escape & backdrop dismissal. */
export function UiDialog(props: UiDialogProps) {
  const size = () => props.size ?? "md";
  const heightClass = () =>
    props.scrollable ? "h-[82%] max-h-[720px]" : "max-h-[86%]";
  return (
    <Dialog
      testID={props.testID}
      open={props.open}
      animation="fade"
      accessibilityLabel={props.title}
      onOpenChange={(e) => props.onOpenChange(e.open)}
      backdropClass={BACKDROP_CLASS}
      class={`m-auto overflow-hidden rounded-xl border border-border bg-popover shadow-xl ${heightClass()} ${DIALOG_WIDTH[size()]}`}
    >
      {props.children}
    </Dialog>
  );
}

export interface UiPopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  align?: Align;
  trigger: JSX.Element;
  class?: string;
  children?: JSX.Element;
}

/** Anchored popover control panel using shared popup tokens. */
export function UiPopover(props: UiPopoverProps) {
  return (
    <Popover
      open={props.open}
      onOpenChange={(e) => props.onOpenChange?.(e.open)}
      placement={props.placement ?? "top"}
      align={props.align ?? "end"}
      offset={8}
      margin={8}
      popupClass={`${POPUP_SURFACE_CLASS} ${props.class ?? ""}`}
      popupStartingClass={POPUP_STARTING_CLASS}
      popupEndingClass={POPUP_ENDING_CLASS}
      trigger={props.trigger}
    >
      {props.children}
    </Popover>
  );
}

export interface UiMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  align?: Align;
  trigger: JSX.Element;
  class?: string;
  children?: JSX.Element;
}

/** Semantic command menu anchored to trigger on desktop and presented as a sheet on touch devices. */
export function UiMenu(props: UiMenuProps) {
  return (
    <Menu
      open={props.open}
      onOpenChange={(e) => props.onOpenChange?.(e.open)}
      placement={props.placement ?? "bottom"}
      align={props.align ?? "end"}
      offset={6}
      popupClass={`min-w-52 ${POPUP_SURFACE_CLASS} ${props.class ?? ""}`}
      popupStartingClass={POPUP_STARTING_CLASS}
      popupEndingClass={POPUP_ENDING_CLASS}
      backdropClass={BACKDROP_CLASS}
      trigger={props.trigger}
    >
      {props.children}
    </Menu>
  );
}

export interface UiMenuItemProps {
  label: string;
  icon?: IconName;
  shortcutHint?: string;
  checked?: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  testID?: string;
  onSelect?: () => void;
}

/** Styled menu item with optional icon, check indicator and shortcut hint. */
export function UiMenuItem(props: UiMenuItemProps) {
  const checkable = () => props.checked !== undefined;
  return (
    <MenuItem
      testID={props.testID}
      checked={props.checked}
      disabled={props.disabled}
      closeOnSelect={props.closeOnSelect}
      accessibilityLabel={props.label}
      onSelect={props.onSelect}
      indicatorClass={
        checkable()
          ? "size-4 items-center justify-center opacity-0 checked:opacity-100"
          : "hidden"
      }
      indicator={checkable() ? <Icon name="check" size={13} tone="primary" /> : undefined}
      class="flex-row items-center gap-2 rounded-md px-2.5 py-2 hover:bg-accent focus:bg-accent active:bg-accent/80 disabled:opacity-45"
    >
      <View class="flex-1 flex-row items-center justify-between gap-4">
        <View class="flex-row items-center gap-2.5">
          <If when={props.icon}>
            {(iconName) => (
              <View class="size-4 items-center justify-center">
                <Icon name={iconName()} size={15} tone="muted-foreground" />
              </View>
            )}
          </If>
          <Text class="text-sm text-popover-foreground">{props.label}</Text>
        </View>
        <If when={props.shortcutHint}>
          {(hint) => <Text class="font-mono text-xs text-muted-foreground">{hint()}</Text>}
        </If>
      </View>
    </MenuItem>
  );
}

/** Hairline menu separator. */
export function UiMenuSeparator() {
  return <MenuSeparator class="my-1 h-px bg-border" />;
}

export interface UiSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: Placement;
  children?: JSX.Element;
}

/** Slide-in edge sheet for narrow viewports. */
export function UiSheet(props: UiSheetProps) {
  return (
    <Sheet
      open={props.open}
      side={props.side ?? "bottom"}
      closeOnSwipe
      onOpenChange={(e) => props.onOpenChange(e.open)}
      backdropClass={BACKDROP_CLASS}
      popupClass="max-h-[82%] rounded-t-xl border-t border-border bg-card p-4 shadow-xl"
    >
      {props.children}
    </Sheet>
  );
}

// ===== App-wide Toast Service =====

interface ToastPayload {
  message: string;
  tone?: "default" | "success" | "warning";
}

const toastManager = new ToastManager({ duration: 220, exitDuration: 180 });
const visibleToasts = signal<ToastEntry[]>([]);
let nextToastSeq = 1;

function syncToasts(): void {
  visibleToasts.set(toastManager.visible(3));
}

/** Pushes a transient status toast at the bottom-center of the window. */
export function showToast(message: string, tone: ToastPayload["tone"] = "default"): void {
  const id = `toast-${nextToastSeq++}`;
  toastManager.push(id, { message, tone } satisfies ToastPayload, { timeout: 2400 });
  syncToasts();
}

/** App-level toast stack mounted once at the root. */
export function UiToastHost() {
  const expanded = signal(false);

  effect(() => {
    if (visibleToasts().length === 0) return;
    const timer = setInterval(() => {
      toastManager.advance(expanded());
      syncToasts();
    }, 80);
    cleanup(() => clearInterval(timer));
  });

  return (
    <If when={visibleToasts().length > 0}>
      <Overlay class="pointer-events-none inset-x-0 bottom-5 items-center">
        <ToastStack
          placement="bottomCenter"
          closeOnEscape={false}
          onExpandedChange={(e) => expanded.set(e.expanded)}
          onCancel={() => {
            toastManager.dismissAll();
            syncToasts();
          }}
          class="pointer-events-auto w-80 max-w-[90%]"
        >
          <Each of={visibleToasts()} key={(entry) => entry.id}>
            {(entry) => {
              const payload = () => entry().value as ToastPayload;
              return (
                <Toast
                  transitionStatus={entry().status}
                  accessibilityLabel={payload().message}
                  onDismissRequest={() => {
                    toastManager.dismiss(entry().id);
                    syncToasts();
                  }}
                  startingClass="opacity-0 translate-y-2 scale-95"
                  endingClass="opacity-0 translate-y-1 scale-95"
                  class="flex-row items-center gap-2 rounded-lg border border-border bg-popover px-3.5 py-2.5 shadow-lg transition duration-200 ease-out"
                >
                  <Icon
                    name={payload().tone === "warning" ? "alert" : "check"}
                    size={15}
                    tone={payload().tone === "warning" ? "warning" : "primary"}
                  />
                  <Text class="flex-1 text-xs font-medium text-popover-foreground">{payload().message}</Text>
                </Toast>
              );
            }}
          </Each>
        </ToastStack>
      </Overlay>
    </If>
  );
}
