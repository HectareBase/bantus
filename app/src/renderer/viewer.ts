// HTML ビューアの画面側（docs/design/html-viewer.md）。つまみ、見出し、HTML の場所（#viewer-slot）を受け持つ。
// HTML そのものはメインプロセスが別のビューで重ねる。ここでは場所の位置と大きさを測って送り、出せないときの文字を出す。
// 高さを自動で決めるときは、カードの一覧の中身の高さを測り、残りをビューアに渡す。

import { autoViewerHeight, clampViewerHeight } from '../shared/settings.js';
import { ja } from '../shared/strings/ja.js';
import type { TipRect, ViewerState, WidgetLayout } from '../shared/types.js';
import { viewerFileName } from '../shared/viewer-path.js';
import { setIcon } from './icon.js';

export interface ViewerPane {
  /** 見た目の設定（出すか、パス、高さ、畳んだか）が届いたとき */
  applyLayout(layout: WidgetLayout): void;
  /** 今開いているセッションが決まったとき（描き直すたびに呼ぶ。変わったときだけ送る） */
  setTarget(id: string | undefined): void;
  /**
   * ウィジェットの中の重ねて出すもの（ウィンドウの切り替えの残りの一覧）が HTML の場所にかかっている間は true。
   * HTML は別のビューで一番上に重なるので、その間は HTML を引っ込める
   */
  setCovered(covered: boolean): void;
}

export function initViewer(): ViewerPane {
  const root = document.getElementById('viewer')!;
  const cards = document.getElementById('cards')!;
  const grip = document.getElementById('viewer-grip')!;
  const slot = document.getElementById('viewer-slot')!;
  /** ビューアの下に置く、ウィンドウの切り替えの帯（switcher.ts）。出ていないときは高さ 0 */
  const below = document.getElementById('switcher');
  const fileEl = root.querySelector<HTMLElement>('.viewer-file')!;
  const placeEl = root.querySelector<HTMLElement>('.viewer-place')!;
  const messageEl = root.querySelector<HTMLElement>('.viewer-message')!;
  const pathEl = root.querySelector<HTMLElement>('.viewer-path')!;
  const reloadButton = document.getElementById('viewer-reload') as HTMLButtonElement;
  const externalButton = document.getElementById('viewer-external') as HTMLButtonElement;
  const collapseButton = document.getElementById('viewer-collapse') as HTMLButtonElement;

  let enabled = false;
  let collapsed = false;
  let path = '';
  /** 高さを空いた場所に合わせる */
  let auto = true;
  /** 空いた場所から決めた高さ（CSS px）。まだ測っていなければ undefined */
  let autoHeight: number | undefined;
  /** 保存された（手で決めた）高さ（CSS px） */
  let savedHeight = 240;
  /** ドラッグ中の高さ。離すまでは保存しない */
  let dragHeight: number | undefined;
  let state: ViewerState = { kind: 'off' };
  /** 送った目標と場所（同じなら送らない） */
  let sentTarget: string | null | undefined = null;
  let targetSent = false;
  let sentRect = '';
  let covered = false;

  /** HTML の場所を送る。隠れているときは undefined */
  function report() {
    let rect: TipRect | undefined;
    if (enabled && !collapsed && !covered && slot.isConnected) {
      const r = slot.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    const json = JSON.stringify(rect ?? null);
    if (json === sentRect) return;
    sentRect = json;
    window.widget.setViewerBounds(rect);
  }

  /** 今出している高さ（CSS px） */
  let shownHeight = 0;

  function applyHeight() {
    const h = dragHeight !== undefined ? clampViewerHeight(dragHeight, window.innerHeight)
      : auto && autoHeight !== undefined ? autoHeight
        : clampViewerHeight(savedHeight, window.innerHeight);
    if (h !== shownHeight) {
      shownHeight = h;
      root.style.setProperty('--viewer-h', `${h}px`);
    }
    return h;
  }

  /**
   * カードの一覧の中身の高さ（CSS px）。子の下端（下の余白を含む）と一覧の下の余白を足す。
   * 位置は offsetTop で測る（並べ替えのアニメーションの transform と、一覧のスクロールに左右されない）
   */
  function cardsContentHeight(): number {
    const style = getComputedStyle(cards);
    const base = cards.offsetTop + cards.clientTop;
    let bottom = parseFloat(style.paddingTop) || 0;
    for (const child of cards.children) {
      if (!(child instanceof HTMLElement) || !child.getClientRects().length) continue;
      const top = child.offsetParent === cards ? child.offsetTop : child.offsetTop - base;
      bottom = Math.max(bottom, top + child.offsetHeight + (parseFloat(getComputedStyle(child).marginBottom) || 0));
    }
    return bottom + (parseFloat(style.paddingBottom) || 0);
  }

  /** 空いた場所を測り直して高さを決める。畳んでいるときも測っておく（広げたときにすぐ合う） */
  function fit() {
    if (!enabled || !auto || dragHeight !== undefined) return;
    // カードの一覧とビューアの HTML で分け合える高さ。畳んでいるときは、HTML の分も一覧が使っている。
    // 一覧が縮みきってビューアがウィンドウの下にはみ出しているときは、はみ出した分を引く（1px までは端数として見逃す）
    // ビューアの下にウィンドウの切り替えの帯があるときは、その分（帯の高さと下の余白）もはみ出しに数える
    const belowHeight = below?.getClientRects().length ? below.getBoundingClientRect().height + (parseFloat(getComputedStyle(below).marginBottom) || 0) : 0;
    const overflow = root.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(root).marginBottom) || 0) + belowHeight - window.innerHeight;
    const shared = cards.getBoundingClientRect().height + (collapsed ? 0 : shownHeight) - (overflow > 1 ? overflow : 0);
    const next = autoViewerHeight(shared, cardsContentHeight());
    if (next === autoHeight) return;
    autoHeight = next;
    applyHeight();
    report();
  }

  /** 測り直しを次のコマにまとめる。一度に何度も大きさが変わっても、測るのも送るのも 1 回だけにする */
  let fitFrame = 0;
  function scheduleFit() {
    if (fitFrame || !enabled || !auto) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      fit();
    });
  }

  function message(s: ViewerState): string {
    switch (s.kind) {
      case 'off':
      case 'ok':
        return '';
      case 'noSession':
        return ja.viewer.noSession;
      case 'noPath':
        return ja.viewer.noPath;
      case 'noDir':
        return ja.viewer.noDir;
      case 'archived':
        return ja.viewer.archived;
      case 'missing':
        return ja.viewer.missing;
    }
  }

  function draw() {
    root.hidden = !enabled;
    root.toggleAttribute('data-collapsed', collapsed);
    root.dataset.kind = state.kind;
    const file = 'file' in state ? state.file : path ? viewerFileName(path) : '';
    fileEl.textContent = file;
    placeEl.textContent = 'place' in state ? state.place : '';
    messageEl.textContent = message(state);
    pathEl.textContent = state.kind === 'missing' ? state.path : '';
    reloadButton.disabled = state.kind !== 'ok' && state.kind !== 'missing';
    externalButton.disabled = state.kind !== 'ok';
    setIcon(collapseButton, collapsed ? 'chevron-up' : 'chevron-down');
    collapseButton.dataset.tip = collapsed ? ja.viewer.expand : ja.viewer.collapse;
    collapseButton.setAttribute('aria-label', collapseButton.dataset.tip);
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    applyHeight();
    report();
    scheduleFit();
  }

  // カードの一覧の大きさ（ウィンドウの高さ、畳む・広げる）と、中身の大きさ（カードの増減、行の増減）が変わったら測り直す。
  // 一覧の直下の子（リポジトリのまとまり）を見張る。子が入れ替わったら見張り直す
  const cardsObserver = new ResizeObserver(() => scheduleFit());
  const watchCards = () => {
    cardsObserver.disconnect();
    cardsObserver.observe(cards);
    for (const child of cards.children) cardsObserver.observe(child);
    scheduleFit();
  };
  new MutationObserver(watchCards).observe(cards, { childList: true });
  watchCards();

  // 大きさが変わったとき（高さのドラッグ、幅のドラッグ、拡大率）と、位置が変わったとき（ウィンドウの高さ）に送り直す
  new ResizeObserver(() => report()).observe(slot);
  // 帯が出た・消えた、残りの一覧を開いた・閉じたときも、空いた場所を測り直す
  if (below) new ResizeObserver(() => scheduleFit()).observe(below);
  window.addEventListener('resize', () => {
    applyHeight();
    report();
    scheduleFit();
  });

  // つまみを上下にドラッグして高さを変える。カーソルが HTML の上に出ても、ポインターをつかんだまま追う
  let startY = 0;
  let startHeight = 0;
  // 動かさずに離したとき（クリック、ダブルクリック）は、手で決めた高さに切り替えない
  let moved = false;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || collapsed) return;
    moved = false;
    grip.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startHeight = applyHeight();
    dragHeight = startHeight;
    document.documentElement.classList.add('resizing-viewer');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    if (!moved && Math.abs(e.clientY - startY) < 3) return;
    moved = true;
    dragHeight = clampViewerHeight(startHeight + startY - e.clientY, window.innerHeight);
    applyHeight();
  });
  grip.addEventListener('lostpointercapture', () => {
    document.documentElement.classList.remove('resizing-viewer');
    if (dragHeight === undefined) return;
    const h = dragHeight;
    dragHeight = undefined;
    if (!moved) {
      applyHeight();
      return;
    }
    // ドラッグしたら、手で決めた高さに切り替える。保存した値が onLayout で戻るまで、見た目を保つ
    savedHeight = h;
    auto = false;
    applyHeight();
    window.widget.setViewerLayout({ viewerHeight: h, viewerAutoHeight: false });
  });
  // つまみのダブルクリックで、空いた場所に合わせる高さに戻す
  grip.addEventListener('dblclick', () => {
    if (collapsed || auto) return;
    auto = true;
    autoHeight = undefined;
    scheduleFit();
    window.widget.setViewerLayout({ viewerAutoHeight: true });
  });

  reloadButton.addEventListener('click', () => window.widget.reloadViewer());
  externalButton.addEventListener('click', () => window.widget.openViewerExternal());
  collapseButton.addEventListener('click', () => {
    collapsed = !collapsed;
    draw();
    window.widget.setViewerLayout({ viewerCollapsed: collapsed });
  });

  window.widget.onViewerState((next) => {
    state = next;
    draw();
  });

  return {
    applyLayout(layout) {
      enabled = layout.viewerEnabled;
      collapsed = layout.viewerCollapsed;
      path = layout.viewerPath;
      if (dragHeight === undefined) {
        savedHeight = layout.viewerHeight;
        if (layout.viewerAutoHeight !== auto) autoHeight = undefined;
        auto = layout.viewerAutoHeight;
      }
      draw();
    },
    setTarget(id) {
      const value = id ?? null;
      if (targetSent && value === sentTarget) return;
      targetSent = true;
      sentTarget = value;
      window.widget.setViewerTarget(id);
    },
    setCovered(value) {
      if (value === covered) return;
      covered = value;
      report();
    },
  };
}
