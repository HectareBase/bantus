// ブランチのツリーの線（docs/design/worktree-cards.md の「ブランチのツリー」）。
// 線は段ごとの CSS の枠線で描く。Windows の表示倍率が 125% や 150% でも、1px の線の太さがそろうようにするため。

import type { TreeRow } from './card-tree.js';

function piece(className: string, level: number): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.style.setProperty('--tree-level', String(level));
  return el;
}

/** 段に字下げと線を付ける。row がなければ外す。形が前と同じなら作り直さない */
export function setTreeGuides(el: HTMLElement, row: TreeRow | undefined) {
  const shape = row ? JSON.stringify([row.depth, row.rails, row.last, row.hasChildren]) : '';
  if ((el.dataset.treeShape ?? '') === shape) return;
  el.querySelector(':scope > .tree-guides')?.remove();
  if (!row) {
    delete el.dataset.treeShape;
    el.removeAttribute('data-tree');
    el.style.removeProperty('--tree-depth');
    return;
  }
  el.dataset.treeShape = shape;
  el.toggleAttribute('data-tree', true);
  el.style.setProperty('--tree-depth', String(row.depth));
  const guides = document.createElement('span');
  guides.className = 'tree-guides';
  guides.setAttribute('aria-hidden', 'true');
  row.rails.forEach((on, i) => {
    if (on) guides.append(piece('tree-rail', i));
  });
  if (row.depth > 0) {
    if (!row.last) guides.append(piece('tree-rail', row.depth - 1));
    guides.append(piece('tree-elbow', row.depth - 1));
  }
  if (row.hasChildren) guides.append(piece('tree-down', row.depth));
  el.prepend(guides);
}
