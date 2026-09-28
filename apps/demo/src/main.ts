// The synth-ui playground: a page per group of widgets, behind tabs in the
// top bar (F1–F5), with a status line at the bottom and tooltips over all.

import { Palette, type Context } from '@synth-ui/core';
import { createWebHost } from '@synth-ui/renderer/web';
import { ICONS, THEME_COLORS, iconButton, label, statusLine, tabs, tooltip, useTheme } from '@synth-ui/widgets';
import { app } from './app';
import { controlsPage } from './pages/controls';
import { corePage } from './pages/core';
import { crtPage } from './pages/crt';
import { listsPage } from './pages/lists';
import { textPage } from './pages/text';

const palette = new Palette(THEME_COLORS);
const host = createWebHost(document.getElementById('app')!, {
  palette,
  resolution: { width: 640, height: 400 },
  background: palette.index.void,
  label: 'synth-ui demo',
});

const PAGES = [
  { label: 'CORE', shortcut: 'F1', draw: corePage },
  { label: 'CONTROLS', shortcut: 'F2', draw: controlsPage },
  { label: 'TEXT', shortcut: 'F3', draw: textPage },
  { label: 'SCROLLING', shortcut: 'F4', draw: listsPage },
  { label: 'CRT', shortcut: 'F5', draw: crtPage(host) },
];
let page = 0;

host.run((ctx) => {
  const { colors: c } = useTheme(ctx);
  ctx.fillRect(ctx.bounds, c.bg);
  PAGES.forEach((p, i) => {
    if (ctx.shortcut(p.shortcut)) page = i;
  });

  topBar(ctx);
  const status = ctx.cutBottom(14);
  ctx.inset(10, 10, 10, 6);
  ctx.allocate(ctx.bounds, PAGES[page].draw, { key: `page:${page}` });

  // The status line: what the pointer is over, and, highlighted for a moment, what just happened.
  ctx.fillRect(status, c.panel);
  ctx.hline(status.x, status.y, status.w, c.line);
  statusLine(ctx, { text: ctx.hint, message: app.message }, { x: status.x + 10, y: status.y + 2, w: status.w - 20, h: 11 });
  tooltip(ctx);
});

function topBar(ctx: Context) {
  const { colors: c } = useTheme(ctx);
  const r = ctx.cutTop(17);
  ctx.fillRect(r, c.panel);
  ctx.hline(r.x, r.y + r.h - 1, r.w, c.line);
  ctx.allocate(r, (bar) => {
    bar.inset(8, 2, 6, 3);
    if (host.effects) {
      const crt = host.fx.enabled;
      if (iconButton(bar, { icon: ICONS.crt, on: crt, hint: crt ? 'CRT FX: ON' : 'CRT FX: OFF' }, bar.cutRight(15)).clicked) host.fx.enabled = !crt;
    }
    bar.row({ gap: 10, align: 'center' }, (row) => {
      label(row, 'SYNTH-UI', { color: c.accent });
      const picked = tabs(row, { tabs: PAGES.map((p) => ({ label: p.label, shortcut: p.shortcut, hint: `${p.label} (${p.shortcut})` })), selected: page });
      if (picked !== null) page = picked;
    });
  });
}
