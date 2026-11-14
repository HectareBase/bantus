// プロジェクトの ToDo（docs/design/todos.md）。見出しとワークツリーのカードの間に出すチェックリスト。
// - 見出しの「ToDo を足す」ボタンで一番下に入力欄を開く。Enter で確定して続けて次を入力、Esc か空のまま外を押すとやめる
//   日本語の変換中の Enter は確定にしない
// - 文字を押すと書き直せる（空にすると消える）。行に乗せると × ですぐ消せる
// - チェックすると済みの見た目にして、下の細い線を TODO_LEAVE_MS かけて縮める。縮みきったら薄くして高さを詰め、データからも消す
//   その間にチェックを外すと取り消し
// - TODO_FOLD_AT 件以上は畳み、最初の TODO_FOLD_SHOW 件と「ほか N 件」を出す
// 並びは画面が持ち、変えるたびに丸ごと onSave に渡す（メインプロセスが todos.json に書く）。
// 入力欄を開いている間は、行を作り直さない（作り直すとフォーカスが外れる）。消えた行だけをその場で外し、残りは閉じてから描き直す

import { ja } from '../shared/strings/ja.js';
import { TODO_LEAVE_MS, TODO_TEXT_MAX, newTodoId, normalizeTodoText, todoFold, type TodoItem } from '../shared/todos.js';
import { createIcon } from './icon.js';

/** 薄くしてから高さを詰め終えるまで（styles.css の .todo の transition に合わせる） */
const GONE_MS = 450;

export interface TodoList {
  /** 保存してある並びを入れる（入力中は、閉じてから描く） */
  set(items: readonly TodoItem[]): void;
  /** 一番下に入力欄を開く（畳んでいれば開いてから） */
  startAdd(): void;
}

export interface TodoOptions {
  /** 並びが変わった（足した、書き直した、消した）。丸ごと渡す */
  onSave: (items: TodoItem[]) => void;
  /** 入力欄を開いた・閉じた */
  onEditing: (editing: boolean) => void;
}

const subtle = () => document.documentElement.dataset.motion === 'subtle';

/** list は .todos の要素（見出しとカードの間）、add は見出しの「ToDo を足す」ボタン */
export function createTodoList(list: HTMLElement, add: HTMLElement, opts: TodoOptions): TodoList {
  let items: TodoItem[] = [];
  /** 畳まずに全部を出している */
  let open = false;
  /** チェックしてから消えるまでの行：id → チェックした時刻と、消すタイマー */
  const leaving = new Map<string, { at: number; timer: number }>();
  /** 開いている入力欄（足す欄か、書き直す欄）。ないときは undefined */
  let input: HTMLInputElement | undefined;

  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', ja.todo.listAria);

  const save = () => opts.onSave(items.map((t) => ({ ...t })));

  function setEditing(next: HTMLInputElement | undefined) {
    const was = !!input;
    input = next;
    if (was !== !!next) opts.onEditing(!!next);
  }

  /** 足した直後に、入力中のまま描き直して次の欄を開く（入力の始まり・終わりは知らせない） */
  function addAndContinue(v: string) {
    items.push({ id: newTodoId(items.map((t) => t.id)), text: v });
    save();
    input = undefined;
    render();
    openAddRow(true);
  }

  /** 入力欄を閉じたあと。並びが変わっていれば描き直す */
  function closeInput() {
    setEditing(undefined);
    render();
  }

  function remove(id: string) {
    const t = leaving.get(id);
    if (t) clearTimeout(t.timer);
    leaving.delete(id);
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return;
    items.splice(i, 1);
    save();
  }

  /** 薄くして高さを詰めてから、データからも消す */
  function finish(id: string) {
    const row = list.querySelector<HTMLElement>(`.todo[data-id="${CSS.escape(id)}"]`);
    const done = () => {
      remove(id);
      if (input) {
        // 入力中は行だけを外し、残りは閉じてから描く
        list.querySelector(`.todo[data-id="${CSS.escape(id)}"]`)?.remove();
      } else render();
    };
    if (!row || subtle()) return done();
    row.classList.add('gone');
    window.setTimeout(done, GONE_MS);
  }

  function toggleCheck(id: string, row: HTMLElement) {
    // 消えはじめたら取り消せない
    if (row.classList.contains('gone')) return;
    const check = row.querySelector<HTMLElement>('.todo-check')!;
    const t = leaving.get(id);
    if (t) {
      // 取り消し
      clearTimeout(t.timer);
      leaving.delete(id);
      row.classList.remove('leaving');
      check.setAttribute('aria-checked', 'false');
      check.setAttribute('aria-label', ja.todo.check);
      return;
    }
    leaving.set(id, { at: Date.now(), timer: window.setTimeout(() => finish(id), TODO_LEAVE_MS) });
    row.style.setProperty('--elapsed', '0ms');
    row.classList.add('leaving');
    check.setAttribute('aria-checked', 'true');
    check.setAttribute('aria-label', ja.todo.uncheck);
  }

  /** 入力欄の共通の動き。Enter（変換中でない）で commit、Esc で cancel、フォーカスが外れたら blur */
  function wireInput(el: HTMLInputElement, on: { commit: (v: string) => void; cancel: () => void; blur: (v: string) => void }) {
    el.maxLength = TODO_TEXT_MAX;
    el.spellcheck = false;
    let composing = false;
    let ended = false;
    el.addEventListener('compositionstart', () => (composing = true));
    el.addEventListener('compositionend', () => (composing = false));
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        // 日本語の変換中の Enter は、変換を決めるためのもの
        if (composing || e.isComposing || ended) return;
        ended = true;
        on.commit(normalizeTodoText(el.value));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (ended) return;
        ended = true;
        on.cancel();
      }
    });
    el.addEventListener('blur', () => {
      if (ended) return;
      ended = true;
      on.blur(normalizeTodoText(el.value));
    });
    // 行や見出しのクリックへは伝えない
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  function startAdd() {
    if (input) {
      input.focus();
      return;
    }
    if (todoFold(items.length, open).folded) {
      open = true;
      render();
    }
    openAddRow(false);
  }

  /** 一番下（「畳む」の上）に足す欄を開く。continued は続けて入力するとき（入力中のまま） */
  function openAddRow(continued: boolean) {
    const row = document.createElement('div');
    row.className = 'todo new';
    const box = document.createElement('span');
    box.className = 'todo-check';
    const el = document.createElement('input');
    el.placeholder = ja.todo.placeholder;
    el.setAttribute('aria-label', ja.todo.inputAria);
    row.append(box, el, document.createElement('span'));
    list.insertBefore(row, list.querySelector('.todo-fold'));
    list.hidden = false;
    wireInput(el, {
      commit: (v) => (v ? addAndContinue(v) : closeInput()),
      cancel: closeInput,
      blur: (v) => {
        if (v) {
          items.push({ id: newTodoId(items.map((t) => t.id)), text: v });
          save();
        }
        closeInput();
      },
    });
    if (continued) input = el;
    else setEditing(el);
    el.focus();
  }

  function startEdit(id: string, row: HTMLElement) {
    if (input || leaving.has(id)) return;
    const item = items.find((t) => t.id === id);
    const text = row.querySelector('.todo-text');
    if (!item || !text) return;
    const el = document.createElement('input');
    el.value = item.text;
    el.setAttribute('aria-label', ja.todo.editAria);
    text.replaceWith(el);
    const commit = (v: string) => {
      const i = items.findIndex((t) => t.id === id);
      if (i >= 0 && v !== items[i]!.text) {
        // 空にしたら消す
        if (v) items[i] = { id, text: v };
        else items.splice(i, 1);
        save();
      }
      closeInput();
    };
    wireInput(el, { commit, cancel: closeInput, blur: commit });
    setEditing(el);
    el.focus();
    el.select();
  }

  function rowFor(t: TodoItem): HTMLElement {
    const row = document.createElement('div');
    row.className = 'todo';
    row.dataset.id = t.id;
    row.setAttribute('role', 'listitem');

    const check = document.createElement('button');
    check.className = 'todo-check';
    check.setAttribute('role', 'checkbox');
    check.append(createIcon('check'));

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = t.text;
    text.tabIndex = 0;

    const del = document.createElement('button');
    del.className = 'todo-del';
    del.tabIndex = -1;
    del.setAttribute('aria-label', ja.todo.remove);
    del.append(createIcon('x'));

    const leave = leaving.get(t.id);
    check.setAttribute('aria-checked', String(!!leave));
    check.setAttribute('aria-label', leave ? ja.todo.uncheck : ja.todo.check);
    if (leave) {
      // 描き直したときは、細い線を経った分だけ縮めたところから続ける
      row.classList.add('leaving');
      row.style.setProperty('--elapsed', `-${Date.now() - leave.at}ms`);
    }

    check.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCheck(t.id, row);
    });
    text.addEventListener('click', (e) => {
      e.stopPropagation();
      startEdit(t.id, row);
    });
    text.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'F2') return;
      e.preventDefault();
      e.stopPropagation();
      startEdit(t.id, row);
    });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (leaving.has(t.id)) return;
      finish(t.id);
    });
    row.append(check, text, del);
    return row;
  }

  function foldButton(rest: number): HTMLElement {
    const b = document.createElement('button');
    b.className = 'todo-fold';
    b.setAttribute('aria-expanded', String(open));
    b.append(createIcon('chevron-down'), document.createTextNode(open ? ja.todo.fold : ja.todo.more(rest)));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      open = !open;
      render();
    });
    return b;
  }

  function render() {
    // 入力中は描かない（閉じたときに closeInput が描く）
    if (input) return;
    const fold = todoFold(items.length, open);
    // 畳めないほど減ったら、次に増えたときは畳んだところから
    if (!fold.foldable) open = false;
    const nodes: HTMLElement[] = items.slice(0, fold.shown).map(rowFor);
    if (fold.foldable) nodes.push(foldButton(fold.rest));
    list.replaceChildren(...nodes);
    list.hidden = items.length === 0;
  }

  add.addEventListener('click', (e) => {
    e.stopPropagation();
    startAdd();
  });

  return {
    set(next) {
      const same = next.length === items.length && next.every((t, i) => t.id === items[i]!.id && t.text === items[i]!.text);
      if (same) return;
      items = next.map((t) => ({ ...t }));
      for (const id of [...leaving.keys()]) {
        if (!items.some((t) => t.id === id)) {
          clearTimeout(leaving.get(id)!.timer);
          leaving.delete(id);
        }
      }
      render();
    },
    startAdd,
  };
}
