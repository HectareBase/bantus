// 状態の色（設定）を画面に当てる。ウィジェット・一覧・設定画面の見本で使う。
// CSS の --busy などを上書きする。薄い背景（--busy-bg など）は CSS が color-mix でこの色から作る。

import { COLOR_STATES, type StatusColors } from '../shared/settings.js';

export function applyStatusColors(colors: StatusColors, el: HTMLElement = document.documentElement) {
  for (const state of COLOR_STATES) el.style.setProperty(`--${state}`, colors[state]);
}
