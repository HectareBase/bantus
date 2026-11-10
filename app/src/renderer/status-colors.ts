// 状態の色（設定）を画面に当てる。ウィジェット・一覧・設定画面の見本で使う。
// CSS の --busy などを上書きする。薄い背景（--busy-bg など）は CSS が color-mix でこの色から作る。
// 今開いている行の強調の濃さも、ここで CSS の --hl（倍率）に入れる。アニメーション効果は <html> の data-motion に入れる。

import { COLOR_STATES, HIGHLIGHT_SCALE, type ActiveHighlight, type Motion, type StatusColors } from '../shared/settings.js';

export function applyStatusColors(colors: StatusColors, el: HTMLElement = document.documentElement) {
  for (const state of COLOR_STATES) el.style.setProperty(`--${state}`, colors[state]);
}

/** 今開いている行の強調の濃さ。CSS が塗りとストライプの不透明度に --hl をかける */
export function applyHighlight(level: ActiveHighlight, el: HTMLElement = document.documentElement) {
  el.style.setProperty('--hl', String(HIGHLIGHT_SCALE[level] ?? 1));
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionSetting: Motion = 'full';

function showMotion() {
  const subtle = motionSetting === 'subtle' || reducedMotion.matches;
  if (subtle) document.documentElement.dataset.motion = 'subtle';
  else delete document.documentElement.dataset.motion;
}
reducedMotion.addEventListener('change', showMotion);

/**
 * アニメーション効果。ひかえめなら <html data-motion="subtle"> にし、CSS が動き続ける表示を止めて、状態を塗りと枠で示す。
 * OS の「動きを減らす」のときも、設定にかかわらず同じ見た目にする
 */
export function applyMotion(motion: Motion) {
  motionSetting = motion;
  showMotion();
}
