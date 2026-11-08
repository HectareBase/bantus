// HTML ビューアの画面側（docs/design/html-viewer.md）。つまみ、見出し、HTML の場所（#viewer-slot）を受け持つ。
// HTML そのものはメインプロセスが別のビューで重ねる。ここでは場所の位置と大きさを測って送り、出せないときの文字を出す。

import { clampViewerHeight } from '../shared/settings.js';
import { ja } from '../shared/strings/ja.js';
import type { TipRect, ViewerState, WidgetLayout } from '../shared/types.js';
import { viewerFileName } from '../shared/viewer-path.js';
import { setIcon } from './icon.js';

export interface ViewerPane {
  /** 見た目の設定（出すか、パス、高さ、畳んだか）が届いたとき */
  applyLayout(layout: WidgetLayout): void;
  /** 今開いているセッションが決まったとき（描き直すたびに呼ぶ。変わったときだけ送る） */
  setTarget(id: string | undefined): void;
}

export function initViewer(): ViewerPane {
  const root = document.getElementById('viewer')!;
  const grip = document.getElementById('viewer-grip')!;
  const slot = document.getElementById('viewer-slot')!;
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
  /** 保存された高さ（CSS px） */
  let savedHeight = 240;
  /** ドラッグ中の高さ。離すまでは保存しない */
  let dragHeight: number | undefined;
  let state: ViewerState = { kind: 'off' };
  /** 送った目標と場所（同じなら送らない） */
  let sentTarget: string | null | undefined = null;
  let targetSent = false;
  let sentRect = '';

  /** HTML の場所を送る。隠れているときは undefined */
  function report() {
    let rect: TipRect | undefined;
    if (enabled && !collapsed && slot.isConnected) {
      const r = slot.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    const json = JSON.stringify(rect ?? null);
    if (json === sentRect) return;
    sentRect = json;
    window.widget.setViewerBounds(rect);
  }

  function applyHeight() {
    const h = clampViewerHeight(dragHeight ?? savedHeight, window.innerHeight);
    root.style.setProperty('--viewer-h', `${h}px`);
    return h;
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
  }

  // 大きさが変わったとき（高さのドラッグ、幅のドラッグ、拡大率）と、位置が変わったとき（ウィンドウの高さ）に送り直す
  new ResizeObserver(() => report()).observe(slot);
  window.addEventListener('resize', () => {
    applyHeight();
    report();
  });

  // つまみを上下にドラッグして高さを変える。カーソルが HTML の上に出ても、ポインターをつかんだまま追う
  let startY = 0;
  let startHeight = 0;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || collapsed) return;
    grip.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startHeight = applyHeight();
    dragHeight = startHeight;
    document.documentElement.classList.add('resizing-viewer');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    dragHeight = clampViewerHeight(startHeight + startY - e.clientY, window.innerHeight);
    applyHeight();
  });
  grip.addEventListener('lostpointercapture', () => {
    document.documentElement.classList.remove('resizing-viewer');
    if (dragHeight === undefined) return;
    const h = dragHeight;
    dragHeight = undefined;
    // 保存した値が onLayout で戻るまで、見た目を保つ
    savedHeight = h;
    applyHeight();
    window.widget.setViewerLayout({ viewerHeight: h });
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
      if (dragHeight === undefined) savedHeight = layout.viewerHeight;
      draw();
    },
    setTarget(id) {
      const value = id ?? null;
      if (targetSent && value === sentTarget) return;
      targetSent = true;
      sentTarget = value;
      window.widget.setViewerTarget(id);
    },
  };
}
