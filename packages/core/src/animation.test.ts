import { describe, expect, it } from 'vitest';
import { EASE, EASE_HZ, ease } from './animation.js';

/** Ease from 0 towards 1 for `seconds` at `fps` frames a second. */
const run = (fps: number, seconds: number) => {
  let v = 0;
  for (let i = 0; i < Math.round(fps * seconds); i++) v = ease(v, 1, 1 / fps, 1e-9);
  return v;
};

describe('ease', () => {
  it('covers EASE of the way in one reference frame', () => {
    expect(ease(0, 1, 1 / EASE_HZ, 1e-9)).toBeCloseTo(EASE, 10);
  });

  it('advances by time, the same at any frame rate', () => {
    // Whole numbers of frames at every rate, so each run covers the same time.
    for (const seconds of [0.5, 1]) {
      const at60 = run(60, seconds);
      for (const fps of [20, 30, 120, 144]) expect(run(fps, seconds)).toBeCloseTo(at60, 10);
    }
  });

  it('lands on the target once within the snap distance, and stays put there', () => {
    expect(ease(0.99, 1, 1 / 60, 0.1)).toBe(1);
    expect(ease(1, 1, 1 / 60, 0.1)).toBe(1);
    expect(ease(0.5, 1, 0, 0.1)).toBe(0.5);
  });
});
