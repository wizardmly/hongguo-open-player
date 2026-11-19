# NSH 开源播放器 — Design System & Motion Inventory

## 1. Design Thesis & Task Hierarchy

**Primary Task:** Browse, search, and continuously watch multi-episode vertical (`9:16`) and horizontal (`16:9`) drama series with zero-wait episode transitions (backed by sequential multi-episode preloading), danmaku commentary, multi-season navigation, and persistent watch history.

- **Visual Language:** Restrained cinema-grade dark appearance (`#0b0d11` page, `#151922` card, `#ff3355` coral-rose primary commitment) paired with a balanced paper-light appearance (`#f5f6f8` page, `#ffffff` card, `#e11d48` primary) via semantic `theme.json` tokens. Zero raw hex/RGBA literals appear in presentation components.
- **Component Architecture (`src/ui/`):** All screens compose exclusively from `src/ui/` controls (`UiButton`, `UiIconButton`, `UiSearchInput`, `UiTabs`, `UiTab`, `UiSwitch`, `UiSlider`, `UiBadge`, `UiSurface`, `UiDialog`, `UiPopover`, `UiMenu`, `UiToastHost`, `UiSkeleton`, `UiEmptyState`, `Icon`). No screen imports raw `nsh/base` controls directly.

## 2. Geometry, Typography & Spacing Scales

- **Concentric Radius Scale:**
  - Largest floating surfaces (Dialogs, Sheets, Cards): `rounded-xl` (12pt)
  - Panels, Popovers, Menus, Sidebar cards: `rounded-lg` (10pt / `rounded-(--radius)`)
  - Controls (Buttons, Inputs, Episode cells, Season chips): `rounded-md` (6pt)
  - Compact tags & inline badges: `rounded-sm` (4pt)
  - Intentional circles & pills (Avatars, Switch tracks, Slider thumbs): `rounded-full`
- **Typography Scale:**
  - Page / Modal Title: `text-lg` `font-semibold`
  - Section / Card Title: `text-sm` `font-semibold`
  - Body / Control Label: `text-sm` `font-normal` / `font-medium`
  - Metadata / Badges / Timecodes: `text-xs` (`tabular-nums` on timecodes, episode numbers, rankings, and preload counters)
- **Spacing Scale:**
  - Control internal parts: `gap-1.5` (6pt)
  - Related toolbar controls: `gap-2` (8pt)
  - Card content & grid cells: `gap-3` (12pt), `p-3` / `p-4`
  - Page sections: `gap-4` (16pt), shared outer content spine `px-5` on desktop / `px-4` on mobile

## 3. Platform Targets

- **Desktop & Web (`platform.desktop`):** Persistent top navigation bar with category tabs, inline search + recent search popover, multi-column responsive poster grid (4–5 columns), split theater view with main stage on the left and collapsible 340pt episode/season sidebar on the right, full keyboard operation (`Space`/`K`, `Up`/`PageUp`, `Down`/`PageDown`, `Left`/`Right`, `M`, `F`, `Mod+K`, `Escape`), hover washes, and `focus-visible:` rings.
- **Mobile (`!platform.desktop` & non-terminal):** 44pt+ touch targets (`hitSlop`), 2-column poster grid, stacked theater layout / bottom sheet episode selector, safe-area insets.
- **Terminal (`platform.idiom === "terminal"`):** Keyboard-first cell-aligned controls, text labels alongside symbols, whole-cell spacing without reliance on images or shadows.

## 4. Motion Tokens (`src/ui/motion.ts`)

| Token | Value | Easing / Usage |
| --- | --- | --- |
| `instant` | `120ms` | Hover wash, focus border, subtle text color transitions (`ease-out`) |
| `fast` | `180ms` | Button press scale (`0.97`, icon button `0.95`), active wash (`cubic-bezier(0.22, 1, 0.36, 1)`) |
| `base` | `240ms` | Tab selection indicator spring, sidebar collapse (`LayoutAnimation`), menu/popover exit (`ease-in-out`) |
| `slow` | `360ms` | Dialog/popover/menu reveal, staggered card entrance (`ease-out`) |
| `slower` | `500ms` | Initial catalog wave stagger cap (`ease-out`) |

## 5. Motion Inventory (Verified per Screen)

### A. App Header & Catalog / Search Screen (`CatalogView`)
| State Change | Tool & Motion Token | Reduced Motion Behavior |
| --- | --- | --- |
| Nav Tab selection changes (`热门榜单` ↔ `真人短剧` ↔ `观影历史` …) | `Tabs` native spring indicator (`indicatorClass`), `base` | Jumps to selected tab immediately |
| Button / Card / Chip hover & press | `transition` classes (`duration-150`), button `active:scale-[0.97]`, card `hover:bg-accent/40 active:bg-accent`, `fast` | Color/wash changes without scale motion |
| Drama cards arrive on tab/page load | `createMotion({ enter: "fadeInUp" })` with capped stagger (`min(index, 8) * 35ms`), `slow` | Renders at final resting position immediately |
| Recent Search Popover & App Menu open/close | `Popover` / `Menu` `popupStartingClass` (`opacity-0 scale-95 -translate-y-1`) → `transition duration-200`, `slow` enter / `base` exit | Opens and closes in 1 frame without translation/scale |
| Loading state | `UiSkeleton` subtle opacity pulse (`glow` preset / CSS pulse), paused once ready | Static muted placeholder blocks |
| Drag / swipe / live continuous | None on static catalog screen (no gratuitous ambient motion) | None |

### B. Actor Ranking Screen (`ActorRankingView`)
| State Change | Tool & Motion Token | Reduced Motion Behavior |
| --- | --- | --- |
| Gender filter (`全部` / `男演员` / `女演员`) changes | `Tabs` sliding pill indicator, `base` | Instant selection swap |
| Actor cards arrive | `createMotion({ enter: "fadeInUp" })` capped stagger (`min(index, 8) * 35ms`), `slow` | Instant rest state |
| Actor card press → Actor Modal | Card active background wash (`fast`), `Dialog` `animation="fade"` | Instant modal presentation |

### C. Immersive Theater Player & Episode/Season Sidebar (`TheaterView`)
| State Change | Tool & Motion Token | Reduced Motion Behavior |
| --- | --- | --- |
| Play ↔ Pause button & center stage badge | Control press scale `0.95` (`fast`), center paused indicator `zoomIn` (`fast`) | Instant icon swap |
| Favorite heart toggled (`🤍` ↔ `❤️`) | `createMotion` `heartbeat` attention preset on favorite toggle (`slow`) | Instant state & label update |
| Episode Sidebar toggle (expand / collapse) | `LayoutAnimation.easeInEaseOut()` (`base` 240ms) resizing video stage & sidebar smoothly | Instant layout resize |
| Sidebar Tab (`选集` ↔ `系列全季`) & Episode Group Tabs (`1-30` ↔ `31-60`) | `Tabs` native indicator slide (`base`) | Instant indicator move |
| Danmaku Settings Popover & Speed Menu open/close | `Popover` / `Menu` `popupStartingClass` / `popupEndingClass` (`fast`/`base`) | Instant open/close |
| Buffering / Preload status updates | Indeterminate `spin` motion on spinner while buffering; preload dot transitions color (`instant`) | Static loading label without spin |
| Live continuous Danmaku commentary | `AnimatedValue.timing` linear horizontal track scroll (`fast` 5.5s / `medium` 7.5s / `slow` 9.8s) synchronized with playback state | Respects user's explicit Danmaku toggle; can be turned off in 1 click |
| Slider scrubbing (progress & volume) | Thumb `hover:scale-110 active:scale-95` (`fast`), immediate track follow (no lag on drag) | Immediate track follow without thumb scale |

### D. Modals & Toasts (`ActorModal`, `DramaDetailModal`, `SeasonsModal`, `SourceModal`, `ShortcutsModal`, `AboutModal`)
| State Change | Tool & Motion Token | Reduced Motion Behavior |
| --- | --- | --- |
| Dialog opens / dismisses | `Dialog` `animation="fade"` over `bg-stage/70` backdrop (`base`) | Instant show/hide |
| Copy title / action feedback toast | `ToastStack` + `Toast` spring entrance & swipe dismissal (`base`) | Instant appear/dismiss |

## 6. Design Finishing Checklist Verification (Light & Dark + Multi-Viewport)

Verified against native Windows Direct2D + Media Foundation screenshots (`1280×820` desktop Light/Dark, `390×844` mobile/mini-window) and headless/TUI test runs:

- **Radius:** Concentric scale (`rounded-xl` cards/dialogs/sheets → `rounded-lg` popovers/menus → `rounded-md` buttons/inputs/cells → `rounded-sm` tags → `rounded-full` avatars/switches/thumbs).
- **Typography:** Clear 3-level hierarchy (`text-lg`/`text-base` titles, `text-sm` body/controls, `text-xs` metadata); `tabular-nums` on timecodes (`00:02 / 00:06`), episode counters, preload counts, and leaderboard deltas; zero unexpected wrap or clipping.
- **Spacing & Gaps:** Consistent `px-5` desktop / `px-3` mobile outer spine, `gap-4` grid gutters, `p-3`/`p-4` card interiors, and `min-h-8` description blocks keeping multi-column card rows aligned on a single bottom baseline.
- **Alignment:** Optical icon centering via `24×24` viewBox Canvas icons, equal top/bottom control bar padding, centered `Dialog` cards (`scrollable` definite height preventing flex-basis collapse), and edge-anchored `Menu`/`Popover`/`Sheet`.
- **Color & Surfaces:** Balanced Dark (`#0b0d11` / `#151922`) and Light (`#f5f6f8` / `#ffffff`) `theme.json` tokens; `solidPrimary` (`bg-primary text-primary-foreground`) used on poster badges for WCAG AA contrast over bright covers; zero hardcoded hex colors in UI components.
- **Hover, Pressed & `ui` Layer:** Every interactive control resides in `src/ui/` (`UiButton`, `UiIconButton`, `UiInput`, `UiTabs`, `UiSlider`, `UiSwitch`, `UiDialog`, `UiMenu`, `UiPopover`, `UiSheet`, `UiToastHost`, `UiGalleryModal`) with hover washes, `active:scale-[0.97]` press feedback, `focus-visible:` rings, and `disabled:opacity-45`.
- **Motion, Accessibility & Platforms:** Every screen state change mapped in Section 5; CJK IME composition guarded (`onCompositionChange`); keyboard shortcuts (`Space`/`K`, `Up`/`Down`, `Left`/`Right`, `M`, `F`, `Mod+K`, `Escape`) verified; Desktop, Narrow/Mobile (`UiSheet`), Web, and Terminal (`--target tui`) idioms supported.
