// DOM events → the core's InputEvents, queued between frames.
//
// Typing goes through a text agent: one off-screen textarea, focused only
// while a text widget has focus, used purely as a source of events — typed
// characters, input-method composition, paste, copy and cut, and the soft
// keyboard on touch screens. Nothing reads its value as state; it's emptied
// as soon as text arrives. Caret, selection, undo and drawing all belong to
// the widget.

import { comboOf, isTypingCombo, type InputEvent, type Modifiers, type TextInputState } from '@synth-ui/core';
import type { WebScreen } from './screen.js';

const mods = (e: MouseEvent | KeyboardEvent | WheelEvent): Modifiers => ({ shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });

export class DomEvents {
  readonly agent: HTMLTextAreaElement;
  private queue: InputEvent[] = [];
  private down = false;
  private composing = false;
  /** What the last frame said, for decisions that can't wait for the next one. */
  private text: TextInputState | null = null;
  private shortcuts: ReadonlySet<string> = new Set();

  constructor(
    private readonly screen: WebScreen,
    private readonly mac: boolean,
  ) {
    const c = screen.canvas;
    const pos = (e: MouseEvent) => screen.toVirtual(e.clientX, e.clientY);

    c.addEventListener('pointermove', (e) => this.push({ type: 'pointermove', ...pos(e), mods: mods(e) }));
    c.addEventListener('pointerleave', () => {
      if (!this.down) this.push({ type: 'pointerleave' });
    });
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId); // keep receiving moves while dragging off the canvas
      } catch {
        // Synthetic events have no real pointer to capture.
      }
      if (e.button === 0) this.down = true;
      this.push({ type: 'pointerdown', ...pos(e), button: e.button, mods: mods(e) });
    });
    // The UI decides what has focus: presses on the canvas mustn't take it from the agent.
    c.addEventListener('mousedown', (e) => e.preventDefault());
    const up = (e: PointerEvent) => {
      if (e.button === 0) this.down = false;
      this.push({ type: 'pointerup', ...pos(e), button: e.button, mods: mods(e) });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const px = (d: number) => (e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 400 : d);
        // With shift held, macOS turns vertical scrolling into horizontal: that stays vertical,
        // as a modifier. Otherwise a sideways swipe scrolls sideways, whichever way it mostly goes.
        const sideways = !e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY);
        const dx = sideways ? px(e.deltaX) : 0;
        const dy = sideways ? 0 : px(e.deltaY || (e.shiftKey ? e.deltaX : 0));
        this.push({ type: 'wheel', ...pos(e), dx, dy, mods: mods(e) });
      },
      { passive: false },
    );
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (this.foreign(e.target)) return;
      if (e.isComposing || e.keyCode === 229) return; // the input method's; composition events cover it
      if (this.shouldPrevent(e)) e.preventDefault();
      this.push({ type: 'keydown', key: e.key, code: e.code, repeat: e.repeat, mods: mods(e) });
    });
    window.addEventListener('keyup', (e) => {
      if (this.foreign(e.target) || e.isComposing) return;
      this.push({ type: 'keyup', key: e.key, code: e.code, mods: mods(e) });
    });
    window.addEventListener('blur', () => this.push({ type: 'blur' }));

    this.agent = this.makeAgent();
    screen.el.append(this.agent);
  }

  /** Everything since the last call, in order. */
  drain(): InputEvent[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  /** Take in what the frame decided: focus the agent by the caret while a text widget has focus. */
  update(text: TextInputState | null, shortcuts: ReadonlySet<string>): void {
    this.text = text;
    this.shortcuts = shortcuts;
    const a = this.agent;
    if (text) {
      const c = this.screen.toCss(text.caret);
      Object.assign(a.style, { left: `${c.left}px`, top: `${c.top}px`, height: `${Math.max(1, c.height)}px` });
      if (document.activeElement !== a) a.focus({ preventScroll: true });
    } else if (document.activeElement === a) a.blur();
  }

  private push(e: InputEvent) {
    this.queue.push(e);
  }

  /** Events meant for some other editable element on the page. */
  private foreign(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement) || target === this.agent) return false;
    return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }

  /**
   * Stop the browser's own action for keys the UI uses: shortcuts it claimed,
   * Tab (focus moves inside the UI), and while a text widget has focus, the
   * editing keys it handles itself. Typing and Mod+C/X/V keep their default,
   * or the agent would never see the text or the clipboard — even when they're
   * also shortcuts (Space, a letter), which don't fire while a text widget has focus.
   */
  private shouldPrevent(e: KeyboardEvent): boolean {
    const combo = comboOf(e.key, mods(e), this.mac);
    if (e.key === 'Tab') return true;
    if (!this.text || !isTypingCombo(combo)) return this.shortcuts.has(combo);
    const mod = this.mac ? e.metaKey : e.ctrlKey;
    if (mod && 'cvx'.includes(e.key.toLowerCase())) return false;
    return !(e.key.length === 1 && !mod);
  }

  private makeAgent(): HTMLTextAreaElement {
    const a = document.createElement('textarea');
    for (const [k, v] of Object.entries({ autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', tabindex: '-1', 'aria-hidden': 'true' })) a.setAttribute(k, v);
    Object.assign(a.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '0',
      border: '0',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      opacity: '0',
      pointerEvents: 'none',
      background: 'transparent',
      color: 'transparent',
      caretColor: 'transparent',
      // 16px keeps iOS from zooming in when it takes focus.
      fontSize: '16px',
      lineHeight: '1',
      whiteSpace: 'pre',
    });

    const flush = () => {
      if (a.value) this.push({ type: 'text', text: a.value });
      a.value = '';
    };
    a.addEventListener('input', () => {
      if (!this.composing) flush();
    });
    a.addEventListener('compositionstart', () => (this.composing = true));
    a.addEventListener('compositionupdate', (e) => this.push({ type: 'composition', text: e.data }));
    a.addEventListener('compositionend', (e) => {
      this.composing = false;
      this.push({ type: 'composition', text: '' });
      if (e.data) this.push({ type: 'text', text: e.data });
      a.value = '';
    });
    a.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text) this.push({ type: 'paste', text });
    });
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (!this.text?.selection) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', this.text.selection);
      if (cut) this.push({ type: 'cut' });
    };
    a.addEventListener('copy', (e) => copy(e, false));
    a.addEventListener('cut', (e) => copy(e, true));
    return a;
  }
}
