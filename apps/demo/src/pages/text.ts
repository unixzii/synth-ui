// F3: text fields. One-line fields that scroll when long, a title that
// shrinks and wraps to fit, and fields that filter what's typed. Everything
// about editing happens in the widget; the app only stores what's committed.

import type { Context } from '@synth-ui/core';
import { card, label, textField, useTheme, type TextFieldProps } from '@synth-ui/widgets';
import { app, say } from '../app';

export function textPage(ctx: Context): void {
  const { colors: c } = useTheme(ctx);
  const colW = Math.floor((ctx.bounds.w - 10) / 2);

  const commit = (what: string, value: string, store: (v: string) => void) => {
    store(value);
    app.log.unshift(`${what}: ${value || '(EMPTY)'}`);
    app.log.length = Math.min(app.log.length, 12);
    say(`${what} SAVED`);
  };

  ctx.allocate(
    ctx.cutLeft(colW, 10),
    (col) => {
      const title = card(col, { title: 'A TITLE · BIG WHILE IT FITS, THEN SMALLER, WRAPPING', h: 62 });
      const t = textField(title, { value: app.title, placeholder: 'UNTITLED', maxLength: 60, sizes: [[2, 2], [1, 3]], hint: 'CLICK TO RENAME THE SONG' });
      if (t.committed !== null) commit('TITLE', t.committed, (v) => (app.title = v));

      const fields = card(col, { title: 'ONE LINE · SCROLLS SIDEWAYS WHEN LONG', h: 96 });
      fields.column({ gap: 6 }, (colm) => {
        const field = (name: string, props: TextFieldProps, store: (v: string) => void) =>
          colm.row({ gap: 6, h: 11, align: 'center' }, (row) => {
            label(row, name, { font: 'small', color: c.text }, row.place({ w: 40, h: 11 }));
            const r = textField(row, { ...props, w: row.bounds.w - row.cursor.x });
            if (r.committed !== null) commit(name, r.committed, store);
          });
        field('NAME', { value: app.name, maxLength: 24, placeholder: 'NAME IT', hint: 'UP TO 24 CHARACTERS' }, (v) => (app.name = v));
        field('TEMPO', { value: app.tempo, maxLength: 3, filter: (t) => t.replace(/\D/g, ''), hint: 'DIGITS ONLY' }, (v) => (app.tempo = v));
        field('NOTE', { value: app.note, placeholder: 'A LONG NOTE SCROLLS TO KEEP THE CARET IN VIEW', hint: 'NO LIMIT' }, (v) => (app.note = v));
      });
      label(fields, 'TAB MOVES ON · ENTER KEEPS IT · ESC PUTS IT BACK · MOD+Z UNDOES', { font: 'small', color: c.slate }, fields.cutBottom(5));
    },
    { gap: 8 },
  );

  ctx.allocate(ctx.bounds, (col) => {
    const log = card(col, { title: 'COMMITTED', h: 166 });
    if (!app.log.length) label(log, 'NOTHING YET', { font: 'small', color: c.dim });
    log.column({ gap: 4 }, (colm) => app.log.forEach((line, i) => label(colm, line, { font: 'small', color: i ? c.muted : c.paper })));
  });
}
