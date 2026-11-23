// めくれのウィンドウの、分岐元の候補の一覧（docs/design/worktree-cards.md の「分岐元を選ぶ」）。
// タイムラインの分岐元の行と、git の詳細の一番下の ◇ を押すと、そのすぐ下に開く。
// ブランチ名はリポジトリから来た文字なので、textContent だけで出す。

import type { BaseCandidate, BaseChoices, BasePicker } from '../shared/types';
import { ja } from '../shared/strings/ja.js';
import { createIcon } from './icon.js';

function span(className: string, text?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** 行を、押すと候補の一覧を開け閉めするボタンにする。右端に開く向きの矢印を置く */
export function makeBaseToggle(el: HTMLElement, open: boolean, toggle: () => void) {
  el.classList.add('base-toggle');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', String(open));
  el.setAttribute('aria-label', ja.flyout.baseChange);
  const more = span('base-more');
  more.append(createIcon(open ? 'chevron-up' : 'chevron-down'));
  el.append(more);
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggle();
  });
}

function choiceRow(c: BaseCandidate, choices: BaseChoices, onPick: (branch: string) => void): HTMLElement {
  const el = document.createElement('button');
  el.className = 'base-choice';
  el.setAttribute('role', 'menuitemradio');
  const current = c.name === choices.current;
  el.setAttribute('aria-checked', String(current));
  el.title = c.name;
  const check = span('base-check');
  if (current) check.append(createIcon('check'));
  el.append(check, span('base-name', c.name));
  if (c.name === choices.inferred) el.append(span('base-tag', ja.flyout.baseInferred));
  el.append(span('base-own', ja.flyout.baseOwn(c.own)));
  el.addEventListener('click', () => onPick(c.name));
  return el;
}

/** 候補の一覧。through はタイムラインの線をこの段に通すときのつなぎ方 */
export function basePanel(picker: BasePicker, onPick: (branch: string) => void, onReset: () => void, through?: 'solid' | 'dashed'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'base-picker';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', ja.flyout.baseChoices);
  if (through) el.append(span(`ln ${through}`));
  const { choices } = picker;
  if (!choices) {
    el.append(span('base-note', picker.failed ? ja.flyout.baseFailed : ja.flyout.baseLoading));
    return el;
  }
  el.append(...choices.candidates.map((c) => choiceRow(c, choices, onPick)));
  if (choices.picked) {
    const reset = document.createElement('button');
    reset.className = 'base-reset';
    reset.append(createIcon('rotate-cw'), ja.flyout.baseReset);
    reset.addEventListener('click', onReset);
    el.append(reset);
  }
  return el;
}
