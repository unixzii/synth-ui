// Replay a Scene into an indexed Surface. This is all of drawing: the
// presenters only turn the finished indices into light.

import { bayer, strengthAt, type DrawCommand, type Scene } from '@synth-ui/core';
import { BitmapFont } from './font.js';
import type { Surface } from './surface.js';

/** Draw `scene` into `target`, resizing it to the scene first if they differ. */
export function rasterize(scene: Scene, target: Surface): void {
  if (target.width !== scene.width || target.height !== scene.height) target.resize(scene.width, scene.height);
  target.clear(scene.background);
  let clip = -1;
  for (const c of scene.commands) {
    if (c.clip !== clip) {
      clip = c.clip;
      target.setClip(scene.clips[clip] ?? null);
    }
    switch (c.op) {
      case 'fill':
        target.fillRect(c.x, c.y, c.w, c.h, c.color, c.pattern);
        break;
      case 'stroke':
        target.rect(c.x, c.y, c.w, c.h, c.color);
        break;
      case 'line':
        target.line(c.x0, c.y0, c.x1, c.y1, c.color);
        break;
      case 'circle':
        if (c.fill) target.fillCircle(c.cx, c.cy, c.r, c.color);
        else target.circle(c.cx, c.cy, c.r, c.color);
        break;
      case 'pixel':
        target.pset(c.x, c.y, c.color);
        break;
      case 'bitmap':
        target.bits(c.image, c.x, c.y, c.color, c.scale);
        break;
      case 'text':
        if (c.font instanceof BitmapFont) c.font.draw(target, c.text, c.x, c.y, c.color, c.scale);
        break;
      case 'remap':
        target.remap(c.x, c.y, c.w, c.h, c.map, c.pattern);
        break;
      case 'mosaic':
        target.mosaic(c.x, c.y, c.w, c.h, c.size);
        break;
      case 'filter':
        filter(target, c);
        break;
    }
  }
  target.setClip(null);
}

function filter(target: Surface, c: Extract<DrawCommand, { op: 'filter' }>) {
  const { field, maps } = c;
  const last = maps.length - 1;
  const mapFor = (s: number) => (last ? maps[Math.round(s * last)] : maps[0]);
  if (c.blend === 'dither') {
    target.apply(c.x, c.y, c.w, c.h, (i, x, y) => {
      const s = strengthAt(field, x, y);
      return bayer(x, y) < Math.round(s * 16) ? mapFor(s)[i] : i;
    });
  } else {
    target.apply(c.x, c.y, c.w, c.h, (i, x, y) => {
      const s = strengthAt(field, x, y);
      return last ? maps[Math.round(s * last)][i] : s >= 0.5 ? maps[0][i] : i;
    });
  }
}
