// 設定ウィンドウ。カテゴリと項目は shared/settings.ts の定義から作る。変更はその場で反映し、保存ボタンは置かない。

import {
  CATEGORIES, COLOR_STATES, COLOR_SWATCHES, DEFAULT_STATUS_COLORS, SETTING_DEFS,
  type CategoryId, type ColorState, type SettingDef, type Settings, type StatusColors,
} from '../shared/settings.js';
import { ja } from '../shared/strings/ja.js';
import type { FetchStatus, SessionState } from '../shared/types.js';
import { createIcon } from './icon.js';
import type { IconName } from './icons.js';
import { fetchStatusLines, statusIconName } from './model.js';
import { playSound } from './sound.js';
import { applyMotion, applyStatusColors } from './status-colors.js';
import { setStatus } from './status-icon.js';
import { fillStrings } from './strings.js';

document.title = ja.window.settings(ja.app.name);
fillStrings(document);

const T = ja.settings;
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
  // 状態の色の見本の行を、アニメーション効果に合わせて描く
  if (key === 'motion') applyMotion(value as Settings['motion']);
  // この設定で押せるか、出すかが決まる項目があれば、描き直す
  if (SETTING_DEFS.some((d) => d.enabledBy === key || d.shownWhen?.key === key)) void renderContent();
}

// ---- ボタン（type: 'action'）の横に出す結果 ----

let fetchStatus: FetchStatus | undefined;
/** 出している結果の欄（描き直すたびに作り直す） */
const statusNodes = new Set<HTMLElement>();

function showFetchStatus() {
  for (const node of statusNodes) {
    if (!node.isConnected) {
      statusNodes.delete(node);
      continue;
    }
    node.replaceChildren(...(fetchStatus ? fetchStatusLines(fetchStatus) : []).map((t) => el('span', { textContent: t })));
  }
}

// ---- 項目の種類ごとの部品 ----

let previewTimer: number | undefined;

/** 今の音の種類と音量で、対応待ちの音のあとに完了の音を鳴らす */
function previewSound() {
  clearTimeout(previewTimer);
  playSound(settings.soundType, 'waiting', settings.soundVolume);
  previewTimer = window.setTimeout(() => playSound(settings.soundType, 'done', settings.soundVolume), 1_500);
}

/** disabled なら、値は見せるが押せなくする（segmented、toggle、text、action が使う） */
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
      const preview = el('button', { className: 'preview-button', disabled }, [createIcon('volume-2'), T.preview]);
      preview.addEventListener('click', previewSound);
      return el('div', { className: 'control' }, [group, preview]);
    }
    case 'toggle': {
      const text = (on: boolean) => (on ? T.options.on : T.options.off);
      const state = el('span', { className: 'toggle-state', textContent: text(settings[def.key]) });
      const button = el('button', { className: 'toggle', disabled }, [el('span', { className: 'toggle-thumb' })]);
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-label', def.label);
      button.setAttribute('aria-checked', String(settings[def.key]));
      button.addEventListener('click', () => {
        const on = !settings[def.key];
        button.setAttribute('aria-checked', String(on));
        state.textContent = text(on);
        set(def.key, on);
      });
      // 「オン」「オフ」の文字を押しても切り替える
      state.addEventListener('click', () => { if (!button.disabled) button.click(); });
      return el('div', { className: 'control toggle-field' }, [state, button]);
    }
    case 'display': {
      const select = el('select');
      select.setAttribute('aria-label', def.label);
      // 選んだモニターは、今のモニターの構成ごとに覚える（メインプロセスの display-layout.ts）
      const { options, selected } = await api.displays();
      for (const d of options) select.append(el('option', { value: d.id, textContent: d.label }));
      select.value = selected;
      select.addEventListener('change', () => api.setDisplay(select.value));
      return select;
    }
    case 'slider': {
      const input = el('input', { type: 'range', min: String(def.min), max: String(def.max), step: String(def.step), value: String(settings[def.key]) });
      input.setAttribute('aria-label', def.label);
      const text = (v: number) => (def.format ? def.format(v) : `${v}${def.unit}`);
      const value = el('span', { className: 'value', textContent: text(settings[def.key]) });
      input.addEventListener('input', () => {
        value.textContent = text(Number(input.value));
        set(def.key, Number(input.value));
      });
      return el('div', { className: 'control' }, [value, input]);
    }
    case 'status-colors':
      return statusColors();
    case 'text': {
      const input = el('input', { type: 'text', value: settings[def.key], disabled, spellcheck: false, placeholder: def.placeholder ?? '' });
      input.setAttribute('aria-label', def.label);
      const error = el('div', { className: 'field-error', hidden: true });
      error.setAttribute('aria-live', 'polite');
      // 入力を確定したとき（Enter、フォーカスが外れたとき）に検査する。だめなら理由を出し、保存しない
      input.addEventListener('change', () => {
        const r = def.check(input.value);
        input.toggleAttribute('aria-invalid', 'error' in r);
        if ('error' in r) {
          input.setAttribute('aria-invalid', 'true');
          error.textContent = r.error;
          error.hidden = false;
          return;
        }
        error.hidden = true;
        input.value = r.value;
        if (r.value !== settings[def.key]) set(def.key, r.value);
      });
      return el('div', { className: 'control text-field' }, [input, error]);
    }
    case 'action': {
      const button = el('button', { className: 'preview-button', textContent: def.button, disabled });
      button.addEventListener('click', () => api.runAction(def.key));
      const status = el('div', { className: 'action-status' });
      status.setAttribute('aria-live', 'polite');
      statusNodes.add(status);
      showFetchStatus();
      return el('div', { className: 'control action' }, [status, button]);
    }
  }
}

// ---- 状態の色 ----

const COLOR_LABELS: Record<ColorState, { label: string; description: string }> = {
  busy: T.colors.busy,
  waiting: T.colors.waiting,
  idle: T.colors.idle,
  held: T.colors.held,
  stopped: T.colors.stopped,
};

/** 対応待ちの理由ごとの印（model.ts の statusIconName が出すもの）。縦に並べる */
const WAITING_REASONS = ['permission prompt', 'input needed', 'dialog open', undefined];

/** ウィジェットの行の見本 */
const PREVIEW_ROWS: { state: SessionState | 'held'; waitingFor?: string; title: string }[] = [
  { state: 'busy', title: T.previewRows.busy },
  { state: 'waiting', waitingFor: 'permission prompt', title: T.previewRows.permission },
  { state: 'waiting', waitingFor: 'input needed', title: T.previewRows.input },
  { state: 'idle', title: T.previewRows.idle },
  { state: 'held', title: T.previewRows.held },
  { state: 'stopped', title: T.previewRows.stopped },
];

function statusIcon(state: SessionState | 'held', waitingFor?: string): HTMLElement {
  const node = el('span', { className: 'status' });
  node.dataset.state = state;
  setStatus(node, state === 'held' ? 'circle-pause' : statusIconName(state, waitingFor));
  return node;
}

/** 待機中でバックグラウンドの作業が動いているときの印。処理中の色で描く */
function backgroundIcon(): HTMLElement {
  const node = el('span', { className: 'status' });
  node.dataset.state = 'busy';
  setStatus(node, statusIconName('idle', undefined, 1));
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
  preview.setAttribute('aria-label', T.colors.previewAria);

  const resetAll = el('button', { className: 'text-button', textContent: T.colors.resetAll });
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
      state === 'waiting'
        ? WAITING_REASONS.map((w) => statusIcon('waiting', w))
        : state === 'busy'
          ? [statusIcon('busy'), backgroundIcon()]
          : [statusIcon(state)]);
    const text = el('div', { className: 'label' }, [el('b', { textContent: label }), el('span', { textContent: description })]);
    const reset = el('button', { className: 'text-button', textContent: T.colors.reset });
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
    custom.setAttribute('aria-label', T.colors.customAria(label));
    custom.addEventListener('input', () => setColor(state, custom.value));
    const palette = el('div', { className: 'palette', hidden: true }, [
      el('div', { className: 'swatches', role: 'group' }, choices),
      el('label', { className: 'custom' }, [custom, T.colors.custom]),
    ]);
    palette.firstElementChild!.setAttribute('aria-label', T.colors.choicesAria(label));
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
      swatch.setAttribute('aria-label', T.colors.currentAria(label, color));
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
    el('h2', { textContent: T.about.app }),
    card(T.about.version, undefined, el('span', { className: 'about-value', textContent: info.version })),
    el('h2', { textContent: T.about.data }),
    ...info.dataFolders.map((f) => card(T.about.folder, T.about.readOnly, el('span', { className: 'about-value', textContent: f }), true)),
    el('h2', { textContent: T.about.settingsFile }),
    card(T.about.file, undefined, el('span', { className: 'about-value', textContent: info.settingsFile }), true),
  );
}

async function renderContent() {
  const category = CATEGORIES.find((c) => c.id === current)!;
  content.replaceChildren(el('h1', { textContent: category.label }));
  if (current === 'about') return renderAbout();

  // 今の設定に関係のない項目（shownWhen が合わない）は出さない
  const defs = SETTING_DEFS.filter((d) => d.category === current && (!d.shownWhen || settings[d.shownWhen.key] === d.shownWhen.value));
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
    const disabled = (def.packagedOnly === true && !packaged) || (def.enabledBy !== undefined && !settings[def.enabledBy]);
    const node = card(def.label, def.description, await control(def, disabled), def.type === 'text');
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
  applyMotion(settings.motion);
  api.onFetchStatus((s) => {
    fetchStatus = s;
    showFetchStatus();
  });
  fetchStatus = await api.fetchStatus();
  // モニターをつないだり外したりしたら、モニターの選択肢を出し直す
  api.onDisplaysChange(() => void renderContent());
  // 「◯分前」を進める
  window.setInterval(showFetchStatus, 30_000);
  renderNav();
  await renderContent();
}

start();
