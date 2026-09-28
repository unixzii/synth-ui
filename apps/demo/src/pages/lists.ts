// F4: scrolling. A list of ten thousand rows that only draws what shows,
// a scroll view whose content measures itself, and a strip that scrolls
// sideways a channel at a time.

import { bitmap, type Context } from '@synth-ui/core';
import { card, checkbox, iconButton, label, list, scrollView, useTheme } from '@synth-ui/widgets';
import { app, say } from '../app';

const ROWS = 10_000;
const STAR = bitmap('..#.. .###. ##### .###. .#.#.');
const WORDS = ['GLASS', 'RIVER', 'ENGINE', 'LIGHT', 'EMBER', 'SIGNAL', 'TIDE', 'STATIC', 'ORBIT', 'MARBLE', 'PULSE', 'VELVET'];
const nameOf = (i: number) => `${WORDS[(i * 7) % WORDS.length]} ${WORDS[(i * 5 + 3) % WORDS.length]}`;
const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

export function listsPage(ctx: Context): void {
  const { colors: c } = useTheme(ctx);
  const colW = Math.floor((ctx.bounds.w - 10) / 2);

  ctx.allocate(ctx.cutLeft(colW, 10), (col) => {
    const box = card(col, { title: `A LIST · ${ROWS.toLocaleString('en')} ROWS, ONLY THOSE IN VIEW DRAWN`, pad: 0 });
    const res = list(
      box,
      { count: ROWS, rowHeight: 13, selected: app.row, fade: 10, fadeTo: c.bg, hint: (i) => `${nameOf(i)}: ENTER OR DOUBLE-CLICK TO OPEN` },
      (row, { index, selected }) => {
        label(row, hex(index), { font: 'small', color: selected ? c.muted : c.slate }, { x: 6, y: 0, w: 24, h: 13 });
        label(row, nameOf(index), { color: selected ? c.accent : c.text }, { x: 32, y: 0, w: 140, h: 13 });
        const star = app.favourites.has(index);
        if (iconButton(row, { icon: STAR, on: star, hint: star ? 'UNSTAR' : 'STAR' }, { x: row.bounds.w - 18, y: 1, w: 12, h: 11 }).clicked) {
          if (star) app.favourites.delete(index);
          else app.favourites.add(index);
        }
      },
    );
    if (res.select !== null) app.row = res.select;
    if (res.activate !== null) say(`OPENED ${nameOf(res.activate)}`);
  });

  ctx.allocate(
    ctx.bounds,
    (col) => {
      const box = card(col, { title: 'A SCROLL VIEW · CONTENT MEASURED AS IT IS LAID OUT', h: 150, pad: 0 });
      scrollView(box, { fade: 10 }, (content) => {
        content.inset(6, 4);
        content.column({ gap: 5 }, (colm) => {
          for (let i = 0; i < 16; i++) {
            label(colm, `SECTION ${i + 1}`, { font: 'small', color: c.muted });
            colm.row({ gap: 10, h: 9 }, (row) => {
              for (const [k, name] of [['bloom', 'BLOOM'], ['scanlines', 'SCANLINES']] as const) {
                if (checkbox(row, { label: name, checked: app.checks[k] }).clicked) app.checks[k] = !app.checks[k];
              }
            });
          }
        });
      });

      const strip = card(col, { title: 'SIDEWAYS · A CHANNEL AT A TIME, EDGES FADING', h: 58, pad: 0 });
      const pitch = 64;
      scrollView(strip, { axis: 'x', snap: pitch, content: { w: 16 * pitch }, fade: 24 }, (content) => {
        for (let i = 0; i < 16; i++) {
          const r = { x: i * pitch + 4, y: 4, w: pitch - 8, h: content.bounds.h - 8 };
          const it = content.interaction(r, { cursor: 'pointer', hint: `CHANNEL ${i + 1}` });
          content.fillRect(r, it.hovered ? c.line : c.control);
          content.strokeRect(r, i % 4 === 0 ? c.accent : c.border);
          label(content, String(i + 1).padStart(2, '0'), { scale: 2, align: 'center', color: i % 4 === 0 ? c.accent : c.text }, r);
          if (it.clicked) say(`CHANNEL ${i + 1}`);
        }
      });
    },
    { gap: 8 },
  );
}
