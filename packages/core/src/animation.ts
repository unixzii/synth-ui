// Every glide shares one curve: each 1/EASE_HZ of a second it covers a fixed
// fraction of the way left. Driven by elapsed time, not frames, so it runs
// at the same speed at 60, 120 or 20 frames a second.

/** The fraction of the way left covered per reference frame, by default. */
export const EASE = 0.15;
/** The reference frame rate `easing` is given at. */
export const EASE_HZ = 60;

/** Ease `cur` towards `target` over `dt` seconds; lands on it once within `snap`. */
export function ease(cur: number, target: number, dt: number, snap: number, easing = EASE): number {
  const k = 1 - (1 - easing) ** (dt * EASE_HZ);
  const next = cur + (target - cur) * k;
  return Math.abs(target - next) < snap ? target : next;
}
