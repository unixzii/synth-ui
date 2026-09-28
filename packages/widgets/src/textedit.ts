// Text editing as pure functions over (text, selection): what a text field
// does with keys, typing and the clipboard, apart from how it's drawn.

export interface Edit {
  text: string;
  /** The end of the selection that stays put. */
  anchor: number;
  /** The end that moves: where the caret is. */
  focus: number;
}

export const selStart = (e: Edit): number => Math.min(e.anchor, e.focus);
export const selEnd = (e: Edit): number => Math.max(e.anchor, e.focus);
export const selected = (e: Edit): string => e.text.slice(selStart(e), selEnd(e));
export const hasSelection = (e: Edit): boolean => e.anchor !== e.focus;

const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

/** Where a word-wise move left from `i` lands: the start of the word before it. */
export function wordLeft(text: string, i: number): number {
  let j = i;
  while (j > 0 && !isWord(text[j - 1])) j--;
  while (j > 0 && isWord(text[j - 1])) j--;
  return j;
}

/** Where a word-wise move right from `i` lands: the end of the word after it. */
export function wordRight(text: string, i: number): number {
  let j = i;
  while (j < text.length && !isWord(text[j])) j++;
  while (j < text.length && isWord(text[j])) j++;
  return j;
}

/** The run of word (or non-word) characters around `i`, for double-click. */
export function wordAt(text: string, i: number): [number, number] {
  const at = Math.min(i, text.length - 1);
  if (at < 0) return [0, 0];
  const word = isWord(text[at]);
  let a = at;
  let b = at + 1;
  while (a > 0 && isWord(text[a - 1]) === word) a--;
  while (b < text.length && isWord(text[b]) === word) b++;
  return [a, b];
}

/** Move the caret to `to`; `extend` keeps the anchor (Shift), else the selection collapses there. */
export function moveTo(e: Edit, to: number, extend: boolean): Edit {
  const f = Math.max(0, Math.min(e.text.length, to));
  return { text: e.text, anchor: extend ? e.anchor : f, focus: f };
}

/** Left or right by a character; without Shift, a selection collapses to its side instead. */
export function step(e: Edit, dir: -1 | 1, extend: boolean): Edit {
  if (!extend && hasSelection(e)) return moveTo(e, dir < 0 ? selStart(e) : selEnd(e), false);
  return moveTo(e, e.focus + dir, extend);
}

/** Replace the selection with `s`, cut to fit `maxLength`. */
export function insert(e: Edit, s: string, maxLength = Infinity): Edit {
  const a = selStart(e);
  const b = selEnd(e);
  const room = Math.max(0, maxLength - (e.text.length - (b - a)));
  const put = s.slice(0, room);
  const text = e.text.slice(0, a) + put + e.text.slice(b);
  return { text, anchor: a + put.length, focus: a + put.length };
}

/** Backspace (dir −1) or Delete (1): the selection, else back or forward to `to` (a character by default). */
export function erase(e: Edit, dir: -1 | 1, to?: number): Edit {
  if (hasSelection(e)) return insert(e, '');
  const other = to ?? e.focus + dir;
  return insert({ text: e.text, anchor: Math.max(0, Math.min(e.text.length, other)), focus: e.focus }, '');
}

/**
 * Undo and redo for one field. Consecutive edits of the same kind (typing,
 * deleting) close together in time merge into one step, as editors do.
 */
export class History {
  private undos: Edit[] = [];
  private redos: Edit[] = [];
  private last = { kind: '', time: -Infinity };

  constructor(private readonly mergeMs = 1000) {}

  /** Call before an edit, with the state it's about to change. */
  record(before: Edit, kind: string, time: number): void {
    const merge = kind === this.last.kind && kind !== 'other' && time - this.last.time < this.mergeMs;
    if (!merge) this.undos.push(before);
    this.redos = [];
    this.last = { kind, time };
  }

  /** A caret move or anything else that should end a run of merged edits. */
  breakRun(): void {
    this.last = { kind: '', time: -Infinity };
  }

  undo(current: Edit): Edit | null {
    const prev = this.undos.pop();
    if (!prev) return null;
    this.redos.push(current);
    this.breakRun();
    return prev;
  }

  redo(current: Edit): Edit | null {
    const next = this.redos.pop();
    if (!next) return null;
    this.undos.push(current);
    this.breakRun();
    return next;
  }
}
