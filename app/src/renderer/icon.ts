// lucide のアイコン（icons.ts）を SVG 要素にする。大きさは CSS で決め、線の太さなどは lucide の既定にそろえる

import { ICONS, type IconName } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createIcon(name: IconName): SVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  const attrs: Record<string, string> = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  for (const [tag, childAttrs] of ICONS[name]) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(childAttrs)) child.setAttribute(k, v);
    root.append(child);
  }
  return root;
}

/** el のアイコンを name にする。同じなら作り直さない */
export function setIcon(el: HTMLElement, name: IconName) {
  if (el.dataset.icon === name && el.firstElementChild) return;
  el.dataset.icon = name;
  el.replaceChildren(createIcon(name));
}

/** HTML に書いた data-icon="名前" の要素に、そのアイコンを入れる。テンプレートの中身にも入れる */
export function fillIcons(doc: Document) {
  const roots: ParentNode[] = [doc, ...[...doc.querySelectorAll('template')].map((t) => t.content)];
  for (const root of roots) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
      el.prepend(createIcon(el.dataset.icon as IconName));
    }
  }
}
