// 状態の色（設定）を画面に当てる。ウィジェット・一覧・設定画面の見本で使う。
// CSS の --busy などを上書きする。薄い背景（--busy-bg など）は CSS が color-mix でこの色から作る。
// 今開いている行の強調の濃さも、ここで CSS の --hl（倍率）に入れる。

import { COLOR_STATES, HIGHLIGHT_SCALE, type ActiveHighlight, type StatusColors } from '../shared/settings.js';

export function applyStatusColors(colors: StatusColors, el: HTMLElement = document.documentElement) {
  for (const state of COLOR_STATES) el.style.setProperty(`--${state}`, colors[state]);
}

/** 今開いている行の強調の濃さ。CSS が塗りとストライプの不透明度に --hl をかける */
export function applyHighlight(level: ActiveHighlight, el: HTMLElement = document.documentElement) {
  el.style.setProperty('--hl', String(HIGHLIGHT_SCALE[level] ?? 1));
}
