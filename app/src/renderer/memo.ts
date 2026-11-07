// 保留のメモの枠（docs/design/hold.md）。押すとその場で入力欄になり、文字に合わせて右へ広がって、行の右端で折り返す。
// Enter とフォーカスが外れたときに確定し、Esc でやめる。日本語の変換中の Enter では確定しない。
// メモが空のときだけペンのアイコンを出す（入力中と、メモがあるときは出さない）。

import { HOLD_NOTE_MAX, normalizeNote } from '../shared/settings.js';

export interface MemoBox {
  /** 出しているメモを変える（入力中は何もしない） */
  set(note: string): void;
  /** 入力の状態にする */
  start(): void;
  readonly editing: boolean;
}

export interface MemoOptions {
  /** 広がれる右端を決める要素（行の 2 行目、カードの見出しの 2 段目） */
  bound: () => HTMLElement;
  /** 確定した。note はそろえたあとのメモ（空もある）。変わっていなくても呼ぶ */
  onCommit: (note: string) => void;
  /** 入力を始めた・終えた */
  onEditing: (editing: boolean) => void;
}

/** 文字の幅を測るための見えない要素。1 つを使い回す */
let sizer: HTMLSpanElement | undefined;

function measure(ta: HTMLTextAreaElement): number {
  if (!sizer) {
    sizer = document.createElement('span');
    sizer.className = 'memo-sizer';
    sizer.setAttribute('aria-hidden', 'true');
    document.body.append(sizer);
  }
  sizer.style.font = getComputedStyle(ta).font;
  sizer.textContent = ta.value || ' ';
  return sizer.getBoundingClientRect().width;
}

/** box は .memo の要素（中に .memo-pen、.memo-text、textarea がある） */
export function createMemo(box: HTMLElement, opts: MemoOptions): MemoBox {
  const text = box.querySelector<HTMLElement>('.memo-text')!;
  const ta = box.querySelector('textarea')!;
  ta.maxLength = HOLD_NOTE_MAX;
  let note = '';
  let editing = false;
  let composing = false;

  const show = () => {
    text.textContent = note;
    box.toggleAttribute('data-has-text', !!note);
  };

  /** 入力欄の幅を文字に合わせ（右端まで）、高さを中身に合わせる */
  const fit = () => {
    const boxStyle = getComputedStyle(box);
    const chrome = parseFloat(boxStyle.paddingLeft) + parseFloat(boxStyle.paddingRight) + parseFloat(boxStyle.borderLeftWidth) + parseFloat(boxStyle.borderRightWidth);
    const max = Math.max(24, opts.bound().getBoundingClientRect().right - box.getBoundingClientRect().left - chrome);
    ta.style.width = `${Math.min(max, Math.ceil(measure(ta)) + 4)}px`;
    ta.style.height = '0';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  const start = () => {
    if (editing) return;
    editing = true;
    ta.value = note;
    box.toggleAttribute('data-editing', true);
    opts.onEditing(true);
    fit();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };

  const end = (commit: boolean) => {
    if (!editing) return;
    editing = false;
    composing = false;
    if (commit) note = normalizeNote(ta.value);
    box.toggleAttribute('data-editing', false);
    ta.style.width = '';
    ta.style.height = '';
    show();
    if (commit) opts.onCommit(note);
    opts.onEditing(false);
  };

  // 枠を押しても、行（セッションを開く）へは伝えない
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    start();
  });
  ta.addEventListener('compositionstart', () => {
    composing = true;
  });
  ta.addEventListener('compositionend', () => {
    composing = false;
  });
  ta.addEventListener('input', () => {
    // 改行は入れない（貼り付けた改行は空白にする）
    if (/[\r\n]/.test(ta.value)) {
      const at = ta.selectionStart;
      ta.value = ta.value.replace(/\r\n|[\r\n]/g, ' ');
      ta.setSelectionRange(at, at);
    }
    fit();
  });
  ta.addEventListener('keydown', (e) => {
    // 行のキー操作（Enter で開く）へは伝えない
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      // 日本語の変換中の Enter は、変換を決めるためのもの
      if (!composing && !e.isComposing) ta.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      end(false);
    }
  });
  ta.addEventListener('blur', () => end(true));
  show();

  return {
    set(next: string) {
      if (editing || next === note) return;
      note = next;
      show();
    },
    start,
    get editing() {
      return editing;
    },
  };
}
