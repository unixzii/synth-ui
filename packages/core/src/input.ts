// What a host tells the core happened, in platform-neutral terms.
// Positions are in virtual pixels. Key names follow the W3C UI Events `key`
// and `code` values ('a', 'Enter', 'ArrowLeft', 'F1'; 'KeyZ', 'Digit2'),
// which native platforms can map to as easily as the web reports them.

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

export const NO_MODIFIERS: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };

export type InputEvent =
  | { type: 'pointermove'; x: number; y: number; mods: Modifiers }
  /** `button`: 0 primary, 1 middle, 2 secondary. */
  | { type: 'pointerdown'; x: number; y: number; button: number; mods: Modifiers }
  | { type: 'pointerup'; x: number; y: number; button: number; mods: Modifiers }
  /** The pointer left the surface (while no button is held). */
  | { type: 'pointerleave' }
  /** Scrolling, in pixels; positive is down and right. */
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number; mods: Modifiers }
  | { type: 'keydown'; key: string; code: string; repeat: boolean; mods: Modifiers }
  | { type: 'keyup'; key: string; code: string; mods: Modifiers }
  /** Text typed (or committed by an input method) into the focused text widget. */
  | { type: 'text'; text: string }
  /** An input method's text in progress; '' when composition ends. */
  | { type: 'composition'; text: string }
  | { type: 'paste'; text: string }
  /** The selection was cut to the clipboard; the focused text widget should delete it. */
  | { type: 'cut' }
  /** The window lost focus: keys held down won't report going up. */
  | { type: 'blur' };

/** Pointer shapes, named as in CSS. */
export type CursorStyle =
  | 'default'
  | 'pointer'
  | 'text'
  | 'move'
  | 'grab'
  | 'grabbing'
  | 'crosshair'
  | 'ns-resize'
  | 'ew-resize'
  | 'not-allowed'
  | 'none';

// ------------------------------------------------------------ key combos

/**
 * A key combo as text: modifiers then the key, joined by '+', e.g. 'Mod+Z',
 * 'Shift+ArrowUp', 'Space', 'F1'. `Mod` is Cmd on a Mac and Ctrl elsewhere.
 * Letters match either case; Shift must be named when it's meant, except
 * with symbols, where it's ignored: '+' is '+' however it's typed.
 */
export type KeyCombo = string;

/** A key's name in a combo: letters lowercase, the space bar as 'Space'. */
export function keyName(key: string): string {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Does Shift count in a combo with this key? Not for symbols: which of them
 * need Shift depends on the keyboard layout ('+' is Shift+= on US keys).
 */
const shiftCounts = (key: string) => key.length !== 1 || key.toLowerCase() !== key.toUpperCase();

/** The canonical form of a key press, e.g. 'Mod+Shift+z', to compare combos by. */
export function comboOf(key: string, mods: Modifiers, mac: boolean): string {
  const parts: string[] = [];
  const mod = mac ? mods.meta : mods.ctrl;
  if (mod) parts.push('Mod');
  if (mac ? mods.ctrl : mods.meta) parts.push(mac ? 'Ctrl' : 'Meta');
  if (mods.alt) parts.push('Alt');
  if (mods.shift && shiftCounts(key)) parts.push('Shift');
  parts.push(keyName(key));
  return parts.join('+');
}

const ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];

/** Normalise a combo written by hand ('shift+mod+Z') to the canonical form. */
export function canonicalCombo(combo: KeyCombo, mac: boolean): string {
  // '+' alone, or a combo ending in '++', means the plus key itself.
  const plus = combo === '+' || combo.endsWith('++');
  const parts = (plus ? combo.slice(0, -1) : combo).split('+').filter(Boolean);
  const last = plus ? '+' : (parts.pop() ?? '');
  const key = last.toLowerCase() === 'space' ? ' ' : last;
  const mods = new Set(parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()));
  // Spelled-out platform keys become Mod where that's what they are.
  if (mods.has(mac ? 'Meta' : 'Ctrl')) {
    mods.delete(mac ? 'Meta' : 'Ctrl');
    mods.add('Mod');
  }
  if (mods.has('Cmd')) {
    mods.delete('Cmd');
    mods.add(mac ? 'Mod' : 'Meta');
  }
  if (!shiftCounts(key)) mods.delete('Shift');
  return [...ORDER.filter((m) => mods.has(m)), keyName(key)].join('+');
}

const EDITING_KEYS = new Set(['Backspace', 'Delete', 'Enter', 'Escape', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * Is this canonical combo one a focused text widget would want: typing
 * (with or without Shift), editing keys, or Mod with A, C, V, X, Y, Z or an
 * editing key?
 */
export function isTypingCombo(combo: string): boolean {
  const parts = combo.split('+');
  // 'Mod++' splits into ['Mod', '', '']: the key is '+'.
  const key = combo.endsWith('++') || combo === '+' ? '+' : parts[parts.length - 1];
  const mods = parts.slice(0, -1).filter((m) => m && m !== 'Shift');
  if (!mods.length) return key.length === 1 || key === 'Space' || EDITING_KEYS.has(key);
  return mods.length === 1 && mods[0] === 'Mod' && (key.length === 1 ? 'acvxyz'.includes(key) : EDITING_KEYS.has(key));
}
