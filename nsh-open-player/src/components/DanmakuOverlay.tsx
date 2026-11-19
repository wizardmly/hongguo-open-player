import { cleanup, createAnimatedValue, Easing, effect, signal, Text, untracked, View } from "nsh";
import type { DanmakuComment, DanmakuSpeed } from "../domain/types";

interface ScheduledItem {
  raw: DanmakuComment;
  row: number;
  width: number;
}

interface ActiveBullet {
  key: string;
  row: number;
  text: string;
  likes: number;
  rgb: readonly [number, number, number];
  x: ReturnType<typeof createAnimatedValue>;
  endX: number;
  lastX: number;
  pxPerMs: number;
  moving: boolean;
}

const MAX_ACTIVE_BULLETS = 24;

const SPEED_SECONDS: Record<DanmakuSpeed, number> = {
  fast: 10,
  medium: 13.5,
  slow: 17,
};

function estimateDanmakuWidth(text: string, likes = 0): number {
  let width = 12;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    width += code >= 0x20 && code <= 0x7e ? 10 : 20;
  }
  if (likes > 0) {
    const likeStr = `+${likes}`;
    width += 6 + likeStr.length * 8;
  }
  return width;
}

function calculateRequiredGap(wPrev: number, wNext: number, screenWidth: number, duration: number): number {
  const gapPrev = (duration * (wPrev + 12)) / (screenWidth + wPrev);
  const gapNext = (duration * (wNext + 12)) / (screenWidth + wNext);
  return Math.max(gapPrev, gapNext);
}

/** Exact likes-tier RGB tuple matching `theme.json` danmaku colors (`#ff7777` / `#ffad72` / `#ffd87a` / `#a8dcff` / `#ffffff`). */
function danmakuRgb(likes: number): readonly [number, number, number] {
  if (likes >= 500) return [255, 119, 119];
  if (likes >= 100) return [255, 173, 114];
  if (likes >= 20) return [255, 216, 122];
  if (likes >= 1) return [168, 220, 255];
  return [255, 255, 255];
}

function rgbaString(rgb: readonly [number, number, number], alpha: number): string {
  const safe = Number.isFinite(alpha) ? alpha : 1;
  const clamped = Math.round(Math.min(1, Math.max(0.05, safe)) * 100) / 100;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamped})`;
}

/**
 * Exact port of `prioritizeDanmakuItems` from `hongguo-open-player/src/client/js/app.js`:
 * assigns non-colliding tracks and replaces lower-likes blockers when high-likes priority is enabled.
 */
function scheduleDanmakuTracks(
  items: DanmakuComment[],
  rows: number,
  speed: DanmakuSpeed,
  screenWidth: number,
  likesPriority: boolean,
): ScheduledItem[] {
  if (!items.length) return [];
  const duration = SPEED_SECONDS[speed];
  const width = Math.max(320, screenWidth);

  const candidates = items
    .map((raw, index) => ({
      raw,
      time: raw.time_sec,
      likes: Math.max(0, Math.floor(raw.likes || 0)),
      width: estimateDanmakuWidth(raw.text, raw.likes),
      index,
    }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      if (b.likes !== a.likes) return b.likes - a.likes;
      return a.index - b.index;
    });

  const tracks: { items: typeof candidates }[] = Array.from({ length: rows }, () => ({ items: [] }));

  for (const c of candidates) {
    let freeTrack = -1;
    let minGap = Infinity;

    for (let k = 0; k < rows; k++) {
      const list = tracks[k].items;
      if (list.length === 0) {
        freeTrack = k;
        break;
      }
      const prev = list[list.length - 1];
      const reqGap = calculateRequiredGap(prev.width, c.width, width, duration);
      if (c.time >= prev.time + reqGap) {
        const gap = c.time - (prev.time + reqGap);
        if (gap < minGap) {
          minGap = gap;
          freeTrack = k;
        }
      }
    }

    if (freeTrack !== -1) {
      tracks[freeTrack].items.push(c);
      continue;
    }

    if (likesPriority && c.likes > 0) {
      let bestTrack = -1;
      let minLikes = c.likes;
      let maxBlock = -Infinity;

      for (let k = 0; k < rows; k++) {
        const list = tracks[k].items;
        const incumbent = list[list.length - 1];
        if (incumbent.likes >= c.likes) continue;

        let canReplace = true;
        if (list.length >= 2) {
          const prev2 = list[list.length - 2];
          const gap2 = calculateRequiredGap(prev2.width, c.width, width, duration);
          if (c.time < prev2.time + gap2) canReplace = false;
        }
        if (!canReplace) continue;

        const reqGap = calculateRequiredGap(incumbent.width, c.width, width, duration);
        const remBlock = incumbent.time + reqGap - c.time;
        if (incumbent.likes < minLikes || (incumbent.likes === minLikes && remBlock > maxBlock)) {
          minLikes = incumbent.likes;
          maxBlock = remBlock;
          bestTrack = k;
        }
      }

      if (bestTrack !== -1) {
        tracks[bestTrack].items.pop();
        tracks[bestTrack].items.push(c);
      }
    }
  }

  const out: ScheduledItem[] = [];
  for (let row = 0; row < rows; row++) {
    for (const entry of tracks[row].items) {
      out.push({ raw: entry.raw, row, width: entry.width });
    }
  }
  return out.sort((a, b) => a.raw.time_sec - b.raw.time_sec);
}

export interface DanmakuOverlayProps {
  enabled: boolean;
  comments: DanmakuComment[];
  currentTime: number;
  isPlaying: boolean;
  rows: 1 | 3 | 5;
  speed: DanmakuSpeed;
  opacity: number;
  likesPriority: boolean;
  stageWidth: number;
  topOffset?: number;
}

/**
 * Borderless multi-color shadowed Danmaku overlay replicating `hongguo-open-player` `.danmaku-layer`:
 * 20px bold text + dark outline/drop-shadow + superscript `+likes` (`#ff7777` / `#ffad72` / `#ffd87a` / `#a8dcff` / `#ffffff`).
 */
export function DanmakuOverlay(props: DanmakuOverlayProps) {
  const bullets = signal<ActiveBullet[]>([]);
  const emittedIds = new Set<string>();
  let scheduled: ScheduledItem[] = [];
  let nextCursor = 0;
  let lastTime = -1;
  let seq = 1;

  const stopAndClearBullets = () => {
    const active = untracked(() => bullets());
    for (const b of active) {
      b.moving = false;
      void b.x.stop();
    }
    if (active.length > 0) {
      bullets.set([]);
    }
  };

  const driveBullet = (bullet: ActiveBullet) => {
    const remainingDist = Math.max(0, bullet.lastX - bullet.endX);
    if (remainingDist <= 1) {
      bullets.update((prev) => prev.filter((b) => b.key !== bullet.key));
      return;
    }
    const remainingMs = Math.max(80, Math.round(remainingDist / Math.max(0.01, bullet.pxPerMs)));
    bullet.moving = true;
    void bullet.x.timing(bullet.endX, { duration: remainingMs, easing: Easing.linear }).then(({ finished }) => {
      if (finished) {
        bullets.update((prev) => prev.filter((b) => b.key !== bullet.key));
      }
    });
  };

  effect(() => {
    const bucketedWidth = Math.round(Math.max(320, props.stageWidth) / 160) * 160;
    scheduled = scheduleDanmakuTracks(
      props.comments,
      props.rows,
      props.speed,
      bucketedWidth,
      props.likesPriority,
    );
    emittedIds.clear();
    nextCursor = 0;
    stopAndClearBullets();
    lastTime = -1;
  });

  // Freeze visible danmaku in place while paused/buffering, and resume smoothly on play!
  effect(() => {
    const playing = props.enabled && props.isPlaying;
    const currentBullets = untracked(() => bullets());
    if (!playing) {
      for (const b of currentBullets) {
        if (!b.moving) continue;
        b.moving = false;
        void b.x.stop().then(({ value }) => {
          b.lastX = value;
        });
      }
      return;
    }
    for (const b of currentBullets) {
      if (!b.moving) {
        driveBullet(b);
      }
    }
  });

  effect(() => {
    if (!props.enabled) {
      stopAndClearBullets();
      return;
    }
    const t = props.currentTime;
    if (t + 0.4 < lastTime) {
      emittedIds.clear();
      nextCursor = 0;
      stopAndClearBullets();
    }
    lastTime = t;
    if (!props.isPlaying) return;

    const minTime = Math.max(0, t - 0.9);
    const maxTime = t + 0.25;
    while (nextCursor < scheduled.length && scheduled[nextCursor].raw.time_sec < minTime) {
      nextCursor++;
    }

    let due: ScheduledItem[] | null = null;
    let scan = nextCursor;
    while (scan < scheduled.length && scheduled[scan].raw.time_sec <= maxTime) {
      const item = scheduled[scan];
      scan++;
      if (!emittedIds.has(item.raw.id)) {
        if (!due) due = [];
        due.push(item);
      }
    }
    nextCursor = scan;
    if (!due) return;

    const width = Math.max(320, untracked(() => props.stageWidth));
    const durationMs = Math.round(SPEED_SECONDS[props.speed] * 1000);
    const added: ActiveBullet[] = [];

    for (const entry of due) {
      emittedIds.add(entry.raw.id);
      const startX = width - 8;
      const endX = -(entry.width + 60);
      const x = createAnimatedValue(startX);
      const key = `${entry.raw.id}-${seq++}`;
      const likes = Math.max(0, Math.floor(entry.raw.likes || 0));
      const pxPerMs = (startX - endX) / Math.max(100, durationMs);

      added.push({
        key,
        row: entry.row,
        text: entry.raw.text,
        likes,
        rgb: danmakuRgb(likes),
        x,
        endX,
        lastX: startX,
        pxPerMs,
        moving: false,
      });
    }

    let survivingAdded: ActiveBullet[] = added;
    bullets.update((prev) => {
      const combined = prev.length > 0 ? [...prev, ...added] : added;
      if (combined.length <= MAX_ACTIVE_BULLETS) {
        return combined;
      }
      const cut = combined.length - MAX_ACTIVE_BULLETS;
      const evicted = combined.slice(0, cut);
      const kept = combined.slice(cut);
      for (const old of evicted) {
        old.moving = false;
        void old.x.stop();
      }
      const keptSet = new Set(kept);
      survivingAdded = added.filter((b) => keptSet.has(b));
      return kept;
    });

    for (const bullet of survivingAdded) {
      driveBullet(bullet);
    }
  });

  cleanup(() => {
    stopAndClearBullets();
  });

  const shadowColor = () => rgbaString([0, 0, 0], Math.min(0.92, props.opacity * 0.95));

  return (
    <If when={props.enabled}>
      <View
        style={{ top: props.topOffset ?? 40, height: props.rows * 32, pointerEvents: "none" }}
        class="pointer-events-none absolute inset-x-0 overflow-hidden"
      >
        <Each of={bullets()} key={(b) => b.key}>
          {(b) => (
            <View
              style={{
                top: b().row * 32,
                transform: [{ translateX: b().x }],
              }}
              class="absolute left-0 flex-row items-start"
            >
              <Text
                style={{
                  color: rgbaString(b().rgb, props.opacity),
                  textShadow: [{ x: 1, y: 1, blur: 0, color: shadowColor() }],
                }}
                class="text-[19px] font-semibold leading-[30px]"
              >
                {b().text}
              </Text>
              <If when={b().likes > 0}>
                <Text
                  style={{
                    color: rgbaString(b().rgb, props.opacity),
                    textShadow: [{ x: 1, y: 1, blur: 0, color: shadowColor() }],
                  }}
                  class="ml-0.5 text-[11px] font-semibold leading-4"
                >
                  {`+${b().likes}`}
                </Text>
              </If>
            </View>
          )}
        </Each>
      </View>
    </If>
  );
}
