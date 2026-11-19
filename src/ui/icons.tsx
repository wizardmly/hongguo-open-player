import { Canvas, type CanvasRenderingContext2D, token, type Tokens } from "nsh";

/** Vector icon names drawn on a 20×20 grid with consistent 1.75pt stroke weight. */
export type IconName =
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "volume"
  | "mute"
  | "fullscreen"
  | "exitFullscreen"
  | "sidebarOpen"
  | "sidebarClose"
  | "heart"
  | "heartFilled"
  | "search"
  | "close"
  | "menu"
  | "star"
  | "flame"
  | "clock"
  | "layers"
  | "copy"
  | "check"
  | "keyboard"
  | "info"
  | "folder"
  | "globe"
  | "sun"
  | "moon"
  | "refresh"
  | "alert"
  | "film"
  | "user"
  | "danmaku"
  | "fitContain"
  | "fitCover"
  | "chevronLeft"
  | "chevronRight"
  | "chevronUp";

function strokePoints(cx: CanvasRenderingContext2D, pts: [number, number][], close = false): void {
  cx.beginPath();
  pts.forEach(([x, y], idx) => {
    if (idx === 0) cx.moveTo(x, y);
    else cx.lineTo(x, y);
  });
  if (close) cx.closePath();
  cx.stroke();
}

function fillPoints(cx: CanvasRenderingContext2D, pts: [number, number][]): void {
  cx.beginPath();
  pts.forEach(([x, y], idx) => {
    if (idx === 0) cx.moveTo(x, y);
    else cx.lineTo(x, y);
  });
  cx.closePath();
  cx.fill();
}

const GLYPHS: Record<IconName, (cx: CanvasRenderingContext2D) => void> = {
  play: (cx) => fillPoints(cx, [[6, 4.2], [16.2, 10], [6, 15.8]]),
  pause: (cx) => {
    cx.fillRect(5.5, 4.2, 3.2, 11.6);
    cx.fillRect(11.3, 4.2, 3.2, 11.6);
  },
  prev: (cx) => {
    cx.fillRect(4.5, 4.8, 2.2, 10.4);
    fillPoints(cx, [[15.2, 4.8], [8, 10], [15.2, 15.2]]);
  },
  next: (cx) => {
    fillPoints(cx, [[4.8, 4.8], [12, 10], [4.8, 15.2]]);
    cx.fillRect(13.3, 4.8, 2.2, 10.4);
  },
  volume: (cx) => {
    strokePoints(cx, [[4, 8], [7.5, 8], [11.5, 4.8], [11.5, 15.2], [7.5, 12], [4, 12]], true);
    cx.beginPath();
    cx.arc(12, 10, 3.2, -0.75, 0.75);
    cx.stroke();
    cx.beginPath();
    cx.arc(12, 10, 5.6, -0.75, 0.75);
    cx.stroke();
  },
  mute: (cx) => {
    strokePoints(cx, [[4, 8], [7.5, 8], [11.5, 4.8], [11.5, 15.2], [7.5, 12], [4, 12]], true);
    strokePoints(cx, [[14, 7.5], [17.8, 12.5]]);
    strokePoints(cx, [[17.8, 7.5], [14, 12.5]]);
  },
  fullscreen: (cx) => {
    strokePoints(cx, [[4, 7.5], [4, 4], [7.5, 4]]);
    strokePoints(cx, [[12.5, 4], [16, 4], [16, 7.5]]);
    strokePoints(cx, [[16, 12.5], [16, 16], [12.5, 16]]);
    strokePoints(cx, [[7.5, 16], [4, 16], [4, 12.5]]);
  },
  exitFullscreen: (cx) => {
    strokePoints(cx, [[4, 7.5], [7.5, 7.5], [7.5, 4]]);
    strokePoints(cx, [[12.5, 4], [12.5, 7.5], [16, 7.5]]);
    strokePoints(cx, [[16, 12.5], [12.5, 12.5], [12.5, 16]]);
    strokePoints(cx, [[7.5, 16], [7.5, 12.5], [4, 12.5]]);
  },
  sidebarOpen: (cx) => {
    cx.strokeRect(3, 3.8, 14, 12.4);
    strokePoints(cx, [[12.5, 3.8], [12.5, 16.2]]);
    strokePoints(cx, [[6.2, 8], [8.5, 10], [6.2, 12]]);
  },
  sidebarClose: (cx) => {
    cx.strokeRect(3, 3.8, 14, 12.4);
    strokePoints(cx, [[12.5, 3.8], [12.5, 16.2]]);
    strokePoints(cx, [[8.8, 8], [6.5, 10], [8.8, 12]]);
  },
  heart: (cx) => {
    cx.beginPath();
    cx.moveTo(10, 16.2);
    cx.bezierCurveTo(4, 12.2, 3.2, 6.2, 6.8, 5);
    cx.bezierCurveTo(8.5, 4.4, 9.6, 5.6, 10, 6.8);
    cx.bezierCurveTo(10.4, 5.6, 11.5, 4.4, 13.2, 5);
    cx.bezierCurveTo(16.8, 6.2, 16, 12.2, 10, 16.2);
    cx.stroke();
  },
  heartFilled: (cx) => {
    cx.beginPath();
    cx.moveTo(10, 16.2);
    cx.bezierCurveTo(4, 12.2, 3.2, 6.2, 6.8, 5);
    cx.bezierCurveTo(8.5, 4.4, 9.6, 5.6, 10, 6.8);
    cx.bezierCurveTo(10.4, 5.6, 11.5, 4.4, 13.2, 5);
    cx.bezierCurveTo(16.8, 6.2, 16, 12.2, 10, 16.2);
    cx.fill();
  },
  search: (cx) => {
    cx.beginPath();
    cx.arc(9, 9, 5.2, 0, Math.PI * 2);
    cx.stroke();
    strokePoints(cx, [[13, 13], [16.8, 16.8]]);
  },
  close: (cx) => {
    strokePoints(cx, [[5.2, 5.2], [14.8, 14.8]]);
    strokePoints(cx, [[14.8, 5.2], [5.2, 14.8]]);
  },
  menu: (cx) => {
    strokePoints(cx, [[3.8, 5.8], [16.2, 5.8]]);
    strokePoints(cx, [[3.8, 10], [16.2, 10]]);
    strokePoints(cx, [[3.8, 14.2], [16.2, 14.2]]);
  },
  star: (cx) => {
    strokePoints(
      cx,
      [[10, 3.2], [12, 7.6], [16.8, 8.2], [13.2, 11.5], [14.2, 16.2], [10, 13.8], [5.8, 16.2], [6.8, 11.5], [3.2, 8.2], [8, 7.6]],
      true,
    );
  },
  flame: (cx) => {
    cx.beginPath();
    cx.moveTo(10, 3.2);
    cx.bezierCurveTo(13.8, 6.5, 15.2, 9.5, 14.6, 12.8);
    cx.bezierCurveTo(14, 15.4, 12.2, 16.8, 10, 16.8);
    cx.bezierCurveTo(7.8, 16.8, 5.4, 15.2, 5.4, 12);
    cx.bezierCurveTo(5.4, 9.4, 7.2, 7.6, 8.5, 6.2);
    cx.bezierCurveTo(8.3, 8, 9.5, 8.6, 10, 3.2);
    cx.stroke();
  },
  clock: (cx) => {
    cx.beginPath();
    cx.arc(10, 10, 6.6, 0, Math.PI * 2);
    cx.stroke();
    strokePoints(cx, [[10, 6.2], [10, 10.2], [13, 11.8]]);
  },
  layers: (cx) => {
    strokePoints(cx, [[10, 3.8], [16.5, 7.2], [10, 10.6], [3.5, 7.2]], true);
    strokePoints(cx, [[3.5, 10.4], [10, 13.8], [16.5, 10.4]]);
    strokePoints(cx, [[3.5, 13.4], [10, 16.8], [16.5, 13.4]]);
  },
  copy: (cx) => {
    cx.strokeRect(7.2, 6.8, 8.8, 9.6);
    strokePoints(cx, [[4.5, 13.2], [4.5, 4.2], [12.8, 4.2]]);
  },
  check: (cx) => strokePoints(cx, [[4.2, 10.4], [8.2, 14.4], [16, 5.8]]),
  keyboard: (cx) => {
    cx.strokeRect(2.8, 5.2, 14.4, 9.6);
    strokePoints(cx, [[6.5, 12.2], [13.5, 12.2]]);
    for (const x of [6, 10, 14]) cx.fillRect(x - 0.8, 7.6, 1.6, 1.6);
  },
  info: (cx) => {
    cx.beginPath();
    cx.arc(10, 10, 6.8, 0, Math.PI * 2);
    cx.stroke();
    strokePoints(cx, [[10, 9.4], [10, 13.8]]);
    cx.fillRect(9.2, 6.2, 1.6, 1.6);
  },
  folder: (cx) => {
    strokePoints(cx, [[3.2, 5.2], [8.2, 5.2], [9.8, 7.2], [16.8, 7.2], [16.8, 15.4], [3.2, 15.4]], true);
  },
  globe: (cx) => {
    cx.beginPath();
    cx.arc(10, 10, 6.8, 0, Math.PI * 2);
    cx.stroke();
    strokePoints(cx, [[3.4, 10], [16.6, 10]]);
    cx.beginPath();
    cx.ellipse(10, 10, 3.2, 6.8, 0, 0, Math.PI * 2);
    cx.stroke();
  },
  sun: (cx) => {
    cx.beginPath();
    cx.arc(10, 10, 3.4, 0, Math.PI * 2);
    cx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      strokePoints(cx, [
        [10 + Math.cos(a) * 5.2, 10 + Math.sin(a) * 5.2],
        [10 + Math.cos(a) * 7.2, 10 + Math.sin(a) * 7.2],
      ]);
    }
  },
  moon: (cx) => {
    cx.beginPath();
    cx.arc(10.6, 10, 5.8, 0.55, Math.PI * 1.45);
    cx.arc(13.2, 7.8, 4.6, Math.PI * 1.38, 0.45, true);
    cx.closePath();
    cx.stroke();
  },
  refresh: (cx) => {
    cx.beginPath();
    cx.arc(10, 10, 6, 0.3, Math.PI * 1.75);
    cx.stroke();
    strokePoints(cx, [[13.2, 4.2], [16, 4.8], [15.2, 7.6]]);
  },
  alert: (cx) => {
    strokePoints(cx, [[10, 3.6], [17, 15.8], [3, 15.8]], true);
    strokePoints(cx, [[10, 8], [10, 11.8]]);
    cx.fillRect(9.2, 13.2, 1.6, 1.6);
  },
  film: (cx) => {
    cx.strokeRect(3.4, 4.2, 13.2, 11.6);
    strokePoints(cx, [[6.6, 4.2], [6.6, 15.8]]);
    strokePoints(cx, [[13.4, 4.2], [13.4, 15.8]]);
    strokePoints(cx, [[3.4, 10], [16.6, 10]]);
  },
  user: (cx) => {
    cx.beginPath();
    cx.arc(10, 7.2, 3.2, 0, Math.PI * 2);
    cx.stroke();
    cx.beginPath();
    cx.arc(10, 16.8, 5.6, Math.PI * 1.12, Math.PI * 1.88);
    cx.stroke();
  },
  danmaku: (cx) => {
    cx.strokeRect(3.2, 4.4, 13.6, 11.2);
    strokePoints(cx, [[6, 8], [11.2, 8]]);
    strokePoints(cx, [[8.8, 12], [14, 12]]);
  },
  fitContain: (cx) => {
    cx.strokeRect(3.2, 4.4, 13.6, 11.2);
    cx.strokeRect(6.8, 6.4, 6.4, 7.2);
  },
  fitCover: (cx) => {
    cx.strokeRect(3.2, 4.4, 13.6, 11.2);
    strokePoints(cx, [[6, 7.2], [14, 7.2]]);
    strokePoints(cx, [[6, 12.8], [14, 12.8]]);
  },
  chevronLeft: (cx) => strokePoints(cx, [[12.2, 5.2], [7.4, 10], [12.2, 14.8]]),
  chevronRight: (cx) => strokePoints(cx, [[7.8, 5.2], [12.6, 10], [7.8, 14.8]]),
  chevronUp: (cx) => strokePoints(cx, [[5.4, 12.2], [10, 7.6], [14.6, 12.2]]),
};

export interface IconProps {
  name: IconName;
  size?: number;
  /** Semantic color token from `theme.json` (defaults to `"foreground"`). */
  tone?: keyof Tokens;
}

/** Semantic vector icon drawn natively on `Canvas` using theme tokens only. */
export function Icon(props: IconProps) {
  const size = () => props.size ?? 16;
  return (
    <Canvas
      style={{ width: size(), height: size(), flexShrink: 0 }}
      draw={(cx) => {
        const s = size();
        const strokeColor = String(token(props.tone ?? "foreground"));
        cx.scale(s / 20, s / 20);
        cx.strokeStyle = strokeColor;
        cx.fillStyle = strokeColor;
        cx.lineWidth = 1.75;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        GLYPHS[props.name](cx);
      }}
    />
  );
}
