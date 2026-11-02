// サイドバーの描画。変わったところだけを書き換え、行全体の作り直しはしない。

import type { SessionState, SessionView } from '../shared/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATES: SessionState[] = ['waiting', 'busy', 'idle', 'stopped'];
const WAITING_LABELS: Record<string, string> = {
  'permission prompt': '許可待ち',
  'input needed': '回答待ち',
  'dialog open': '画面を表示中',
  'sandbox request': 'サンドボックスの許可待ち',
  'worker request': 'ワーカーの要求待ち',
  'goal proposal': 'ゴールの確認待ち',
};

// フォルダの色。名前から決めるので、同じフォルダはいつも同じ色になる
const FOLDER_COLORS = ['#0078d4', '#8764b8', '#00b294', '#ca5010', '#e3008c', '#498205', '#c239b3', '#038387'];

interface RowRefs {
  el: HTMLLIElement;
  status: HTMLElement;
  title: HTMLElement;
  folder: HTMLElement;
  when: HTMLElement;
  data?: SessionView;
}

const rows = new Map<string, RowRefs>();
const template = document.getElementById('row-template') as HTMLTemplateElement;
const groupLists = new Map<SessionState, HTMLUListElement>();
const groupSections = new Map<SessionState, HTMLElement>();
for (const state of STATES) {
  const section = document.querySelector<HTMLElement>(`.group[data-state="${state}"]`)!;
  groupSections.set(state, section);
  groupLists.set(state, section.querySelector('ul')!);
}

function folderColor(folder: string): string {
  let h = 0;
  for (const ch of folder) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return FOLDER_COLORS[h % FOLDER_COLORS.length]!;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function statusIcon(state: SessionState): SVGElement | null {
  const root = svg('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  switch (state) {
    case 'busy': {
      root.classList.add('spinner');
      root.append(svg('circle', { cx: '8', cy: '8', r: '6.5' }));
      return root;
    }
    case 'waiting':
      root.append(svg('circle', { cx: '8', cy: '8', r: '4.5', class: 'pulse' }));
      return root;
    case 'idle':
      root.classList.add('ring');
      root.append(svg('circle', { cx: '8', cy: '8', r: '4' }));
      return root;
    default:
      return null;
  }
}

function setStatus(target: HTMLElement, state: SessionState) {
  const icon = statusIcon(state);
  target.replaceChildren(...(icon ? [icon] : []));
}

function formatAgo(ms: number): string {
  if (!ms) return '';
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min} 分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 時間前`;
  return `${Math.floor(h / 24)} 日前`;
}

function tooltip(s: SessionView): string {
  const lines = [s.title];
  if (s.state === 'waiting') lines.push(`対応待ち：${WAITING_LABELS[s.waitingFor ?? ''] ?? s.waitingFor ?? '不明'}`);
  if (s.needsAction) lines.push(`対応が必要：${s.needsAction}`);
  if (s.detail) lines.push(s.detail);
  return lines.join('\n');
}

function createRow(id: string): RowRefs {
  const el = (template.content.firstElementChild as HTMLLIElement).cloneNode(true) as HTMLLIElement;
  const refs: RowRefs = {
    el,
    status: el.querySelector('.status')!,
    title: el.querySelector('.title')!,
    folder: el.querySelector('.folder')!,
    when: el.querySelector('.when')!,
  };
  el.addEventListener('click', () => window.widget.openSession(id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') window.widget.openSession(id);
  });
  return refs;
}

function updateRow(refs: RowRefs, s: SessionView) {
  const prev = refs.data;
  if (prev?.state !== s.state) setStatus(refs.status, s.state);
  if (prev?.title !== s.title) refs.title.textContent = s.title;
  if (prev?.folder !== s.folder) {
    refs.folder.textContent = s.folder;
    refs.el.style.setProperty('--folder', folderColor(s.folder));
  }
  if (prev?.lastActivityAt !== s.lastActivityAt) refs.when.textContent = formatAgo(s.lastActivityAt);
  refs.el.title = tooltip(s);
  refs.data = s;
}

function render(sessions: SessionView[]) {
  const seen = new Set<string>();
  const counts: Record<SessionState, number> = { waiting: 0, busy: 0, idle: 0, stopped: 0 };
  // 状態ごとに、受け取った順（新しい順）で並べる。位置が変わる行だけを動かす
  const cursor = new Map<SessionState, Element | null>();

  for (const s of sessions) {
    seen.add(s.id);
    counts[s.state]++;
    let refs = rows.get(s.id);
    if (!refs) {
      refs = createRow(s.id);
      rows.set(s.id, refs);
    }
    updateRow(refs, s);

    const list = groupLists.get(s.state)!;
    const prevSibling = cursor.get(s.state) ?? null;
    const expected = prevSibling ? prevSibling.nextElementSibling : list.firstElementChild;
    if (expected !== refs.el) list.insertBefore(refs.el, expected);
    cursor.set(s.state, refs.el);
  }

  for (const [id, refs] of rows) {
    if (!seen.has(id)) {
      refs.el.remove();
      rows.delete(id);
    }
  }

  for (const state of STATES) {
    const section = groupSections.get(state)!;
    section.hidden = counts[state] === 0;
    section.querySelector('.count')!.textContent = String(counts[state]);
    const mini = document.querySelector<HTMLElement>(`.mini-item[data-state="${state}"]`);
    if (mini) {
      mini.hidden = counts[state] === 0;
      mini.querySelector('.count')!.textContent = String(counts[state]);
    }
  }
}

// たたんだ表示の印は一度だけ作る
for (const item of document.querySelectorAll<HTMLElement>('.mini-item')) {
  setStatus(item.querySelector('.status')!, item.dataset.state as SessionState);
}

// 「◯分前」は 1 分に 1 回だけ書き換える（アニメーションではないので CPU への影響はない）
setInterval(() => {
  for (const refs of rows.values()) {
    if (refs.data) refs.when.textContent = formatAgo(refs.data.lastActivityAt);
  }
}, 60_000);

// 見えていないときはアニメーションを止める
const updatePaused = () => document.documentElement.classList.toggle('paused', document.hidden);
document.addEventListener('visibilitychange', updatePaused);
updatePaused();

let collapsed = false;
document.getElementById('collapse')!.addEventListener('click', () => {
  collapsed = !collapsed;
  document.documentElement.classList.toggle('collapsed', collapsed);
  window.widget.setCollapsed(collapsed);
});
document.getElementById('quit')!.addEventListener('click', () => window.widget.quit());

window.widget.onSessions(render);
