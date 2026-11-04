// 状態の印。ウィジェットの行と、一覧（flyout）の行で使う。

import { setIcon } from './icon.js';
import { PROGRESS_RING, type StatusIcon } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 処理中：薄い輪の上を、伸び縮みする弧が回る（Windows 11 の ProgressRing に近い動き） */
function progressRing(): SVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', '0 0 24 24');
  root.setAttribute('aria-hidden', 'true');
  root.classList.add('progress-ring');
  for (const cls of ['track', 'arc']) {
    const c = document.createElementNS(SVG_NS, 'circle');
    for (const [k, v] of Object.entries({ cx: '12', cy: '12', r: '9', pathLength: '30', class: cls })) c.setAttribute(k, v);
    root.append(c);
  }
  return root;
}

export function setStatus(el: HTMLElement, name: StatusIcon) {
  if (name !== PROGRESS_RING) return setIcon(el, name);
  if (el.dataset.icon === name) return;
  el.dataset.icon = name;
  el.replaceChildren(progressRing());
}
