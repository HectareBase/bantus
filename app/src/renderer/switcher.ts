// ウィンドウの切り替え（docs/design/window-switcher.md）。ウィジェットの一番下の帯に、同じモニターにある Claude 以外のウィンドウの
// アイコンを手前にある順に並べる。押すとそのウィンドウを前に出す。一覧はメインプロセスが変わったときだけ送ってくる。
// 入りきらない分は「+N」にまとめ、押すと帯の上に残りの一覧（アイコンとタイトル）を開く。
// ボタンと行の要素は使い回し、変わったところだけを書き換える。動きは付けない。

import { ja } from '../shared/strings/ja.js';
import { switcherFit } from '../shared/switcher-fit.js';
import type { SwitcherUpdate, SwitcherWindow } from '../shared/types';
import { createIcon } from './icon.js';
import type { Tooltips } from './tooltip.js';

interface Item {
  el: HTMLButtonElement;
  /** アイコンの絵。取れなかったウィンドウには汎用のアイコン（lucide）を入れる */
  img?: HTMLImageElement;
  title?: HTMLElement;
  iconKey?: string;
}

/** parent の子を nodes の並びにそろえる。すでに正しい位置にある要素は動かさない */
function syncChildren(parent: Element, nodes: Element[]) {
  nodes.forEach((node, i) => {
    const current = parent.children[i];
    if (current !== node) parent.insertBefore(node, current ?? null);
  });
  while (parent.children.length > nodes.length) parent.lastElementChild!.remove();
}

/** 帯の中の、ボタンを並べられる幅（左右の内側の余白を除く） */
function innerWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/** onListOpen：残りの一覧を開いた・閉じた（ビューアの HTML を引っ込めるのに使う） */
export function initSwitcher(tooltips: Tooltips, onListOpen: (open: boolean) => void) {
  const root = document.getElementById('switcher')!;
  const bar = document.getElementById('switcher-bar')!;
  const list = document.getElementById('switcher-list')!;
  const more = document.createElement('button');
  more.className = 'switcher-more';
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'switcher-list');

  /** 届いたアイコン（目印 → data URL）。同じ絵は一度しか届かない */
  const icons = new Map<string, string>();
  let windows: SwitcherWindow[] = [];
  /** 帯のボタンと、一覧の行（どちらもウィンドウのハンドルごと） */
  const buttons = new Map<string, Item>();
  const rows = new Map<string, Item>();
  /** 残りの一覧を開いているか。sentOpen は最後に onListOpen へ知らせた値 */
  let open = false;
  let sentOpen = false;

  function focus(id: string) {
    setOpen(false);
    window.widget.focusWindow(id);
  }

  function create(id: string, withTitle: boolean): Item {
    const el = document.createElement('button');
    el.className = withTitle ? 'switcher-row' : 'switcher-item';
    el.addEventListener('click', () => focus(id));
    const item: Item = { el };
    if (withTitle) {
      item.title = document.createElement('span');
      item.title.className = 'switcher-title';
      el.append(item.title);
    }
    return item;
  }

  /** アイコン、タイトル、最小化の見た目を合わせる。変わったところだけを書き換える */
  function update(item: Item, w: SwitcherWindow) {
    const url = w.icon === undefined ? undefined : icons.get(w.icon);
    const key = url === undefined ? '' : w.icon!;
    if (item.iconKey !== key) {
      item.iconKey = key;
      item.el.querySelector('.switcher-icon')?.remove();
      if (url === undefined) {
        const svg = createIcon('app-window');
        svg.classList.add('switcher-icon');
        item.el.prepend(svg);
      } else {
        const img = document.createElement('img');
        img.className = 'switcher-icon';
        img.alt = '';
        img.draggable = false;
        img.src = url;
        item.el.prepend(img);
      }
    }
    item.el.toggleAttribute('data-min', w.minimized);
    const tip = w.minimized ? ja.switcher.minimized(w.title) : w.title;
    if (item.title) {
      // 一覧の行はタイトルを出しているので、ツールチップは最小化のときだけ
      if (item.title.textContent !== w.title) item.title.textContent = w.title;
      if (w.minimized) item.el.dataset.tip = tip;
      else delete item.el.dataset.tip;
    } else {
      if (item.el.dataset.tip !== tip) item.el.dataset.tip = tip;
      if (item.el.getAttribute('aria-label') !== tip) item.el.setAttribute('aria-label', tip);
    }
  }

  function get(map: Map<string, Item>, w: SwitcherWindow, withTitle: boolean): HTMLElement {
    let item = map.get(w.id);
    if (!item) {
      item = create(w.id, withTitle);
      map.set(w.id, item);
    }
    update(item, w);
    return item.el;
  }

  function prune(map: Map<string, Item>, keep: readonly SwitcherWindow[]) {
    const ids = new Set(keep.map((w) => w.id));
    for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  }

  function draw() {
    // 1 つもなければ帯ごと消す。設定で出さないときは html.hide-switcher で消える（styles.css）
    root.hidden = windows.length === 0;
    const count = root.hidden ? 0 : switcherFit(windows.length, innerWidth(bar));
    const shown = windows.slice(0, count);
    const rest = windows.slice(count);
    if (!rest.length) open = false;
    if (rest.length) {
      const text = `+${rest.length}`;
      if (more.textContent !== text) more.textContent = text;
      more.dataset.tip = ja.switcher.more(rest.length);
      more.setAttribute('aria-label', more.dataset.tip);
    }
    more.setAttribute('aria-expanded', String(open));
    syncChildren(bar, [...shown.map((w) => get(buttons, w, false)), ...(rest.length ? [more] : [])]);
    const listed = open ? rest : [];
    list.hidden = !open;
    syncChildren(list, listed.map((w) => get(rows, w, true)));
    if (sentOpen !== open) {
      sentOpen = open;
      onListOpen(open);
    }
    prune(buttons, shown);
    prune(rows, listed);
    tooltips.prune();
  }

  function setOpen(value: boolean) {
    if (value === open) return;
    open = value;
    draw();
  }

  more.addEventListener('click', () => setOpen(!open));
  // 一覧は、外を押したとき、Esc、ウィジェットからフォーカスが外れたときに閉じる
  document.addEventListener('pointerdown', (e) => {
    if (open && !(e.target instanceof Node && root.contains(e.target))) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  window.addEventListener('blur', () => setOpen(false));
  // 帯の幅が変わったら（ウィジェットの幅、拡大率、帯が出た・消えた）、入る数を決め直す
  new ResizeObserver(() => draw()).observe(bar);
  // マウスをウィジェットに乗せたら、すぐ調べ直してもらう（設定で出さないときは、メインプロセスが何もしない）
  document.documentElement.addEventListener('mouseenter', () => window.widget.refreshWindows());

  window.widget.onWindows((update: SwitcherUpdate) => {
    for (const [key, url] of Object.entries(update.icons)) icons.set(key, url);
    windows = update.windows;
    draw();
  });
}
