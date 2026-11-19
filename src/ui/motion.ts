import { Easing, LayoutAnimation } from "nsh";

/** Centralized motion tokens (milliseconds & curves) shared across `src/ui/` and screens. */
export const MOTION = {
  instant: 120,
  fast: 180,
  base: 240,
  slow: 360,
  slower: 500,
  staggerStep: 35,
  staggerCap: 8,
  pressSettle: Easing.bezier(0.22, 1, 0.36, 1),
  enterCurve: Easing.out(Easing.cubic),
  moveCurve: Easing.inOut(Easing.cubic),
} as const;

/** Runs a standard 240ms layout animation for collapsible panels and list mutations. */
export function animateLayoutChange(): void {
  LayoutAnimation.configureNext(
    LayoutAnimation.create(MOTION.base, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
  );
}

/** Computes a capped stagger delay in milliseconds for arriving grid/list items. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index), MOTION.staggerCap) * MOTION.staggerStep;
}
