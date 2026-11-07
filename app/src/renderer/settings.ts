// 設定ウィンドウ。カテゴリと項目は shared/settings.ts の定義から作る。変更はその場で反映し、保存ボタンは置かない。

import {
  CATEGORIES, COLOR_STATES, COLOR_SWATCHES, DEFAULT_STATUS_COLORS, SETTING_DEFS,
  type CategoryId, type ColorState, type SettingDef, type Settings, type StatusColors,
} from '../shared/settings.js';
import type { SessionState } from '../shared/types.js';
import { createIcon } from './icon.js';
import type { IconName } from './icons.js';
import { statusIconName } from './model.js';
import { playSound } from './sound.js';
import { applyStatusColors } from './status-colors.js';
import { setStatus } from './status-icon.js';

const api = window.settingsApi;
const nav = document.getElementById('nav')!;
const content = document.getElementById('content')!;

let settings: Settings;
let current: CategoryId = CATEGORIES[0]!.id;

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

let previewTimer: number | undefined;

/** 今の音の種類と音量で、対応待ちの音のあとに完了の音を鳴らす */
function previewSound() {
  clearTimeout(previewTimer);
  playSound(settings.soundType, 'waiting', settings.soundVolume);
  previewTimer = window.setTimeout(() => playSound(settings.soundType, 'done', settings.soundVolume), 1_500);
}

/** disabled なら、値は見せるが押せなくする（今は segmented だけが使う） */
async function control(def: SettingDef, disabled: boolean): Promise<Node> {
  switch (def.type) {
    case 'segmented': {
      const group = el('div', { className: 'segmented', role: 'group' });
      group.setAttribute('aria-label', def.label);
      for (const o of def.options) {
        const b = el('button', { textContent: o.label, disabled });
        b.setAttribute('aria-pressed', String(settings[def.key] === o.value));
        b.addEventListener('click', () => {
          set(def.key, o.value as never);
          for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === b));
          if (def.preview === 'sound') playSound(settings.soundType, 'waiting', settings.soundVolume);
        });
        group.append(b);
      }
      if (def.preview !== 'sound') return group;
      const preview = el('button', { className: 'preview-button', disabled }, [createIcon('volume-2'), '試聴']);
      preview.addEventListener('click', previewSound);
      return el('div', { className: 'control' }, [group, preview]);
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
    case 'status-colors':
      return statusColors();
  }
}

// ---- 状態の色 ----

const COLOR_LABELS: Record<ColorState, { label: string; description: string }> = {
  busy: { label: '処理中', description: 'Claude が作業している' },
  waiting: { label: '対応待ち', description: '許可待ち・回答待ち・画面を表示中・その他。理由にかかわらず同じ色' },
  idle: { label: '待機', description: '次の指示を待っている。完了したときの帯もこの色' },
  held: { label: '保留', description: 'あとで再開するために止めている。状態のアイコンを押して付け外しする' },
  stopped: { label: '停止中', description: '動いていないセッション' },
};

/** 対応待ちの理由ごとの印（model.ts の statusIconName が出すもの）。縦に並べる */
const WAITING_REASONS = ['permission prompt', 'input needed', 'dialog open', undefined];

/** ウィジェットの行の見本 */
const PREVIEW_ROWS: { state: SessionState | 'held'; waitingFor?: string; title: string }[] = [
  { state: 'busy', title: '検索の結果を並べ替える' },
  { state: 'waiting', waitingFor: 'permission prompt', title: 'コマンドの実行の許可を待つ' },
  { state: 'waiting', waitingFor: 'input needed', title: '質問への回答を待つ' },
  { state: 'idle', title: '設定画面の文言を直す' },
  { state: 'held', title: 'ほかのブランチのマージを待つ' },
  { state: 'stopped', title: '古いブランチを片付ける' },
];

function statusIcon(state: SessionState | 'held', waitingFor?: string): HTMLElement {
  const node = el('span', { className: 'status' });
  node.dataset.state = state;
  setStatus(node, state === 'held' ? 'circle-pause' : statusIconName(state, waitingFor));
  return node;
}

function isDefaultColors(colors: StatusColors): boolean {
  return COLOR_STATES.every((st) => colors[st] === DEFAULT_STATUS_COLORS[st]);
}

/** 行の見本、状態ごとの行（四角を押すと候補が開く）、「すべて既定に戻す」 */
function statusColors(): HTMLElement {
  const panel = el('div', { className: 'status-colors' });
  const preview = el('div', { className: 'card color-preview' }, PREVIEW_ROWS.map((r) => {
    const row = el('div', { className: 'preview-row' }, [statusIcon(r.state, r.waitingFor), el('span', { textContent: r.title })]);
    row.dataset.state = r.state;
    return row;
  }));
  preview.setAttribute('aria-label', 'ウィジェットの見本');

  const resetAll = el('button', { className: 'text-button', textContent: 'すべて既定に戻す' });
  const updaters: (() => void)[] = [];
  const palettes: { palette: HTMLElement; swatch: HTMLButtonElement }[] = [];

  const setColor = (state: ColorState, color: string) => {
    set('statusColors', { ...settings.statusColors, [state]: color });
    refresh();
  };
  const refresh = () => {
    applyStatusColors(settings.statusColors, panel);
    for (const u of updaters) u();
    resetAll.disabled = isDefaultColors(settings.statusColors);
  };
  const closePalettes = (except?: HTMLElement) => {
    for (const p of palettes) {
      if (p.palette === except) continue;
      p.palette.hidden = true;
      p.swatch.setAttribute('aria-expanded', 'false');
    }
  };

  const rows = COLOR_STATES.map((state) => {
    const { label, description } = COLOR_LABELS[state];
    const icons = el('div', { className: 'state-icons' },
      state === 'waiting' ? WAITING_REASONS.map((w) => statusIcon('waiting', w)) : [statusIcon(state)]);
    const text = el('div', { className: 'label' }, [el('b', { textContent: label }), el('span', { textContent: description })]);
    const reset = el('button', { className: 'text-button', textContent: '既定に戻す' });
    reset.addEventListener('click', () => setColor(state, DEFAULT_STATUS_COLORS[state]));
    const swatch = el('button', { className: 'swatch current' });
    swatch.setAttribute('aria-expanded', 'false');

    const choices = COLOR_SWATCHES.map((c) => {
      const b = el('button', { className: 'swatch' });
      b.style.setProperty('--swatch', c);
      b.setAttribute('aria-label', c);
      b.title = c;
      b.addEventListener('click', () => setColor(state, c));
      return b;
    });
    const custom = el('input', { type: 'color' });
    custom.setAttribute('aria-label', `${label}の色を自由に選ぶ`);
    custom.addEventListener('input', () => setColor(state, custom.value));
    const palette = el('div', { className: 'palette', hidden: true }, [
      el('div', { className: 'swatches', role: 'group' }, choices),
      el('label', { className: 'custom' }, [custom, '自由に選ぶ']),
    ]);
    palette.firstElementChild!.setAttribute('aria-label', `${label}の色の候補`);
    palettes.push({ palette, swatch });
    swatch.addEventListener('click', () => {
      const open = palette.hidden;
      closePalettes(palette);
      palette.hidden = !open;
      swatch.setAttribute('aria-expanded', String(open));
    });

    updaters.push(() => {
      const color = settings.statusColors[state];
      swatch.style.setProperty('--swatch', color);
      swatch.setAttribute('aria-label', `${label}の色：${color}`);
      reset.hidden = color === DEFAULT_STATUS_COLORS[state];
      for (const [i, b] of choices.entries()) b.setAttribute('aria-pressed', String(COLOR_SWATCHES[i] === color));
      if (custom.value !== color) custom.value = color;
    });

    const head = el('div', { className: 'color-row' }, [icons, text, el('div', { className: 'control' }, [reset, swatch])]);
    return el('div', { className: 'card color-card' }, [head, palette]);
  });

  resetAll.addEventListener('click', () => {
    set('statusColors', { ...DEFAULT_STATUS_COLORS });
    refresh();
  });
  panel.append(preview, ...rows, el('div', { className: 'reset-all' }, [resetAll]));
  refresh();
  return panel;
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

  const defs = SETTING_DEFS.filter((d) => d.category === current);
  const packaged = defs.some((d) => d.packagedOnly) && (await api.about()).packaged;
  let group = '';
  for (const def of defs) {
    if (def.group !== group) {
      group = def.group;
      content.append(el('h2', { textContent: group }));
    }
    if (def.type === 'status-colors') {
      content.append(await control(def, false));
      continue;
    }
    const disabled = def.packagedOnly === true && !packaged;
    const node = card(def.label, def.description, await control(def, disabled));
    if (disabled) node.classList.add('disabled');
    content.append(node);
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
