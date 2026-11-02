// 設定ウィンドウ。カテゴリと項目は shared/settings.ts の定義から作る。変更はその場で反映し、保存ボタンは置かない。

import { CATEGORIES, SETTING_DEFS, type CategoryId, type SettingDef, type Settings } from '../shared/settings.js';
import { createIcon } from './icon.js';
import type { IconName } from './icons.js';

const api = window.settingsApi;
const nav = document.getElementById('nav')!;
const content = document.getElementById('content')!;

let settings: Settings;
let current: CategoryId = 'display';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** stacked にすると、値を名前の下に出す（パスのような長い値用） */
function card(label: string, description: string | undefined, control: Node, stacked = false): HTMLElement {
  const text = el('div', { className: 'label' }, [el('b', { textContent: label })]);
  if (description) text.append(el('span', { textContent: description }));
  return el('div', { className: stacked ? 'card stacked' : 'card' }, [text, el('div', { className: 'control' }, [control])]);
}

function set<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings = { ...settings, [key]: value };
  api.set({ [key]: value } as Partial<Settings>);
}

// ---- 項目の種類ごとの部品 ----

async function control(def: SettingDef): Promise<Node> {
  switch (def.type) {
    case 'segmented': {
      const group = el('div', { className: 'segmented', role: 'group' });
      group.setAttribute('aria-label', def.label);
      for (const o of def.options) {
        const b = el('button', { textContent: o.label });
        b.setAttribute('aria-pressed', String(settings[def.key] === o.value));
        b.addEventListener('click', () => {
          set(def.key, o.value as never);
          for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === b));
        });
        group.append(b);
      }
      return group;
    }
    case 'display': {
      const select = el('select');
      select.setAttribute('aria-label', def.label);
      for (const d of await api.displays()) select.append(el('option', { value: d.id, textContent: d.label }));
      // 保存されたモニターが今つながっていなければ、メインのモニターを選んだ状態で見せる
      select.value = [...select.options].some((o) => o.value === settings.display) ? settings.display : 'primary';
      select.addEventListener('change', () => set('display', select.value));
      return select;
    }
    case 'slider': {
      const input = el('input', { type: 'range', min: String(def.min), max: String(def.max), step: String(def.step), value: String(settings[def.key]) });
      input.setAttribute('aria-label', def.label);
      const value = el('span', { className: 'value', textContent: `${settings[def.key]}${def.unit}` });
      input.addEventListener('input', () => {
        value.textContent = `${input.value}${def.unit}`;
        set(def.key, Number(input.value));
      });
      return el('div', { className: 'control' }, [value, input]);
    }
  }
}

// ---- 画面 ----

async function renderAbout() {
  const info = await api.about();
  content.append(
    el('h2', { textContent: 'このアプリ' }),
    card('バージョン', undefined, el('span', { className: 'about-value', textContent: info.version })),
    el('h2', { textContent: '読み取っているデータ' }),
    ...info.dataFolders.map((f) => card('フォルダ', '読むだけで、書き換えはしません', el('span', { className: 'about-value', textContent: f }), true)),
    el('h2', { textContent: '設定の保存先' }),
    card('ファイル', undefined, el('span', { className: 'about-value', textContent: info.settingsFile }), true),
  );
}

async function renderContent() {
  const category = CATEGORIES.find((c) => c.id === current)!;
  content.replaceChildren(el('h1', { textContent: category.label }));
  if (current === 'about') return renderAbout();

  let group = '';
  for (const def of SETTING_DEFS.filter((d) => d.category === current)) {
    if (def.group !== group) {
      group = def.group;
      content.append(el('h2', { textContent: group }));
    }
    content.append(card(def.label, def.description, await control(def)));
  }
}

function renderNav() {
  // 項目がないカテゴリは出さない（「情報」は専用の画面があるので出す）
  const visible = CATEGORIES.filter((c) => c.id === 'about' || SETTING_DEFS.some((d) => d.category === c.id));
  nav.replaceChildren(...visible.map((c) => {
    const b = el('button', { className: 'nav-item' }, [createIcon(c.icon as IconName), c.label]);
    if (c.id === current) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => {
      current = c.id;
      renderNav();
      renderContent();
    });
    return b;
  }));
}

async function start() {
  settings = await api.get();
  renderNav();
  await renderContent();
}

start();
