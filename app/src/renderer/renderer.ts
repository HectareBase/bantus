// サイドバーの描画（カード案 B-1）。リポジトリごとのカードに、ワークツリーごとの小見出しを付ける。
// 行・小見出し・カードの要素は使い回し、並びが変わったところだけを動かす（アニメーションを途切れさせない）。

import type { SessionView, WidgetLayout } from '../shared/types';
import {
  PENDING_FOCUS_MS,
  PROGRESS_RING,
  buildCards,
  cardBadge,
  cardSections,
  formatAgo,
  nextAttention,
  nextCycleTarget,
  resolveFocus,
  stateOfRank,
  statusIconName,
  tooltip,
  type Card,
  type Group,
  type PendingFocus,
  type StatusIcon,
} from './model.js';
import { flip } from './flip.js';
import { fillIcons, setIcon } from './icon.js';
import { initTooltips } from './tooltip.js';

interface RowRefs {
  el: HTMLLIElement;
  status: HTMLElement;
  title: HTMLElement;
  branch: HTMLElement;
  when: HTMLElement;
  data?: SessionView;
}

interface CardRefs {
  el: HTMLElement;
  name: HTMLElement;
  badge: HTMLElement;
  body: HTMLElement;
  stopped: HTMLElement;
  stoppedLabel: HTMLElement;
  stoppedRows: HTMLUListElement;
}

const cardsEl = document.getElementById('cards')!;
const miniEl = document.getElementById('mini')!;
const rowTemplate = document.getElementById('row-template') as HTMLTemplateElement;
const cardTemplate = document.getElementById('card-template') as HTMLTemplateElement;
const subheadTemplate = document.getElementById('subhead-template') as HTMLTemplateElement;
fillIcons(document);
const tooltips = initTooltips(document.getElementById('tooltip')!);

const rows = new Map<string, RowRefs>();
const cards = new Map<string, CardRefs>();
const subheads = new Map<string, HTMLElement>();
const lists = new Map<string, HTMLUListElement>();
const openStopped = new Set<string>();
/** 未確認（左端の帯を出す）セッションの ID */
const attention = new Set<string>();
/** 最後に受け取ったセッション一覧と、クリックしてまだファイルに反映されていないセッション */
let latest: SessionView[] = [];
let pendingFocus: PendingFocus | undefined;
let pendingTimer: number | undefined;

// ---- 小さな道具 ----

function clone<T extends Element>(template: HTMLTemplateElement): T {
  return template.content.firstElementChild!.cloneNode(true) as T;
}

/** parent の子を nodes の並びにそろえる。すでに正しい位置にある要素は動かさない */
function syncChildren(parent: Element, nodes: Element[]) {
  nodes.forEach((node, i) => {
    const current = parent.children[i];
    if (current !== node) parent.insertBefore(node, current ?? null);
  });
  while (parent.children.length > nodes.length) parent.lastElementChild!.remove();
}

// ---- 状態の印 ----

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

function setStatus(el: HTMLElement, name: StatusIcon) {
  if (name !== PROGRESS_RING) return setIcon(el, name);
  if (el.dataset.icon === name) return;
  el.dataset.icon = name;
  el.replaceChildren(progressRing());
}

// ---- 行 ----

function setAttention(refs: RowRefs, id: string, on: boolean) {
  if (on) attention.add(id);
  else attention.delete(id);
  refs.el.toggleAttribute('data-attention', on);
}

/** 今開いているセッションの行だけ背景を塗る。塗った行の ID を返す */
function applyFocus(): string | undefined {
  const resolved = resolveFocus(latest, pendingFocus);
  pendingFocus = resolved.pending;
  for (const [id, refs] of rows) refs.el.toggleAttribute('data-focused', id === resolved.id);
  return resolved.id;
}

/** ショートカット：未確認の行を表示順に開く。なければ表示順で次の行 */
function openNext() {
  const id = nextCycleTarget(latest, attention, applyFocus());
  if (id) openRow(id);
}

function openRow(id: string) {
  const refs = rows.get(id);
  if (refs) setAttention(refs, id, false);
  // ファイルに書かれるのを待たずに、クリックした行へすぐ移す。反映されないまま時間が過ぎたら、ファイルの値に戻す
  pendingFocus = { id, until: Date.now() + PENDING_FOCUS_MS };
  clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(applyFocus, PENDING_FOCUS_MS);
  applyFocus();
  window.widget.openSession(id);
}

function getRow(s: SessionView): RowRefs {
  let refs = rows.get(s.id);
  if (!refs) {
    const el = clone<HTMLLIElement>(rowTemplate);
    refs = {
      el,
      status: el.querySelector('.status')!,
      title: el.querySelector('.title')!,
      branch: el.querySelector('.branch')!,
      when: el.querySelector('.when')!,
    };
    const id = s.id;
    el.addEventListener('click', () => openRow(id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openRow(id);
    });
    rows.set(s.id, refs);
  }
  const prev = refs.data;
  setStatus(refs.status, statusIconName(s.state, s.waitingFor));
  if (prev?.state !== s.state) {
    refs.el.dataset.state = s.state;
    setAttention(refs, s.id, nextAttention(prev?.state, s.state, attention.has(s.id)));
  }
  if (prev?.title !== s.title) refs.title.textContent = s.title;
  if (prev?.lastActivityAt !== s.lastActivityAt) refs.when.textContent = formatAgo(s.lastActivityAt);
  refs.el.dataset.tip = tooltip(s);
  refs.data = s;
  return refs;
}

// ---- カード ----

function getCard(card: Card): CardRefs {
  let refs = cards.get(card.key);
  if (!refs) {
    const el = clone<HTMLElement>(cardTemplate);
    refs = {
      el,
      name: el.querySelector('.repo-name')!,
      badge: el.querySelector('.badge')!,
      body: el.querySelector('.card-body')!,
      stopped: el.querySelector('.stopped')!,
      stoppedLabel: el.querySelector('.stopped-label')!,
      stoppedRows: el.querySelector('.stopped-rows')!,
    };
    const key = card.key;
    const stopped = refs.stopped;
    stopped.classList.toggle('open', openStopped.has(key));
    el.querySelector('.stopped-toggle')!.addEventListener('click', () => {
      if (openStopped.has(key)) openStopped.delete(key);
      else openStopped.add(key);
      stopped.classList.toggle('open', openStopped.has(key));
    });
    cards.set(card.key, refs);
  }
  return refs;
}

function getSubhead(key: string, group: Group): HTMLElement {
  let el = subheads.get(key);
  if (!el) {
    el = clone<HTMLElement>(subheadTemplate);
    subheads.set(key, el);
  }
  // カードの見出しが folder なので、メインは house にして重ねない
  setIcon(el.querySelector('.subhead-icon')!, group.isMain ? 'house' : 'git-branch');
  el.querySelector('.subhead-label')!.textContent = group.label;
  el.dataset.tip = group.tooltip;
  return el;
}

function getList(key: string): HTMLUListElement {
  let ul = lists.get(key);
  if (!ul) {
    ul = document.createElement('ul');
    ul.className = 'rows';
    lists.set(key, ul);
  }
  return ul;
}

function renderCard(card: Card): HTMLElement {
  const refs = getCard(card);
  refs.name.textContent = card.name;

  const badge = cardBadge(card);
  refs.badge.dataset.state = badge.state;
  refs.badge.textContent = badge.text;

  const { useSubheads, sections } = cardSections(card);
  const bodyNodes: Element[] = [];
  for (const g of sections) {
    const key = `${card.key}|${g.key}`;
    if (useSubheads) bodyNodes.push(getSubhead(key, g as Group));
    const ul = getList(key);
    syncChildren(ul, g.sessions.map((s) => {
      const row = getRow(s);
      row.branch.textContent = '';
      return row.el;
    }));
    bodyNodes.push(ul);
  }
  syncChildren(refs.body, bodyNodes);

  // 停止中はたたんでおく。開いたときにどのワークツリーかわかるよう、ブランチ名を添える
  refs.stopped.hidden = card.stopped.length === 0;
  refs.stoppedLabel.textContent = `停止中 ${card.stopped.length}`;
  syncChildren(refs.stoppedRows, card.stopped.map((s) => {
    const row = getRow(s);
    row.branch.textContent = s.worktree?.label ?? '';
    return row.el;
  }));
  return refs.el;
}

function renderMini(list: Card[]) {
  const nodes = list.map((card) => {
    const item = document.createElement('div');
    item.className = 'mini-repo';
    item.dataset.tip = card.name;
    item.textContent = [...card.name][0]?.toUpperCase() ?? '?';
    const ring = document.createElement('span');
    ring.className = 'mini-ring';
    const state = stateOfRank(card.rank);
    ring.dataset.state = state;
    ring.classList.toggle('blink', state === 'waiting');
    item.append(ring);
    item.addEventListener('click', () => setCollapsed(false));
    return item;
  });
  miniEl.replaceChildren(...nodes);
}

/** 並べ替えで動かす要素。親（カード）を子より先に */
function* animatedElements(): Iterable<HTMLElement> {
  for (const c of cards.values()) yield c.el;
  yield* subheads.values();
  for (const r of rows.values()) yield r.el;
}

function render(sessions: SessionView[]) {
  latest = sessions;
  const list = buildCards(sessions);
  // 並びが変わった行・小見出し・カードを、前の位置からすべらせる
  flip(animatedElements, () => {
    syncChildren(cardsEl, list.map(renderCard));
    renderMini(list);
  });

  // なくなったものは捨てる
  const ids = new Set(sessions.map((s) => s.id));
  for (const id of rows.keys()) if (!ids.has(id)) rows.delete(id);
  for (const id of attention) if (!ids.has(id)) attention.delete(id);
  const cardKeys = new Set(list.map((c) => c.key));
  for (const key of cards.keys()) if (!cardKeys.has(key)) cards.delete(key);
  for (const map of [subheads, lists] as Map<string, Element>[]) {
    for (const [key, el] of map) if (!el.isConnected) map.delete(key);
  }
  applyFocus();
  tooltips.prune();
}

// ---- 画面の操作 ----

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
function setCollapsed(value: boolean) {
  collapsed = value;
  document.documentElement.classList.toggle('collapsed', collapsed);
  window.widget.setCollapsed(collapsed);
}
document.getElementById('collapse')!.addEventListener('click', () => setCollapsed(!collapsed));
document.getElementById('settings')!.addEventListener('click', () => window.widget.openSettings());

// 最前面への固定。押した見た目はすぐ変え、保存された値が onLayout で戻ってきたらそれに合わせる
const pinButton = document.getElementById('pin')!;
let pinned = true;
function showPinned(value: boolean) {
  pinned = value;
  setIcon(pinButton, pinned ? 'pin' : 'pin-off');
  pinButton.setAttribute('aria-pressed', String(pinned));
  pinButton.dataset.tip = pinned ? '最前面に固定中（クリックで外す）' : '最前面に固定する';
}
pinButton.addEventListener('click', () => {
  showPinned(!pinned);
  window.widget.setPinned(pinned);
});

// 内側の端をドラッグして幅を変える。カーソルがウィンドウの外へ出ても、ポインターをつかんだまま追う
const resizeHandle = document.getElementById('resize-handle')!;
resizeHandle.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || collapsed) return;
  resizeHandle.setPointerCapture(e.pointerId);
  document.documentElement.classList.add('resizing');
  window.widget.resizeStart();
});
resizeHandle.addEventListener('pointermove', (e) => {
  if (resizeHandle.hasPointerCapture(e.pointerId)) window.widget.resizeMove();
});
resizeHandle.addEventListener('lostpointercapture', () => {
  document.documentElement.classList.remove('resizing');
  window.widget.resizeEnd();
});

// 背景が 0% のときは、カードやタイトルバーのない所のクリックを後ろのウィンドウへ通す
let floating = false;
let clickThrough = false;
function setClickThrough(value: boolean) {
  if (value === clickThrough) return;
  clickThrough = value;
  window.widget.setClickThrough(value);
}
document.addEventListener('mousemove', (e) => {
  if (!floating) return;
  const solid = (e.target as Element).closest('.card, .titlebar, .mini-repo, .resize-handle');
  setClickThrough(!solid);
});

function applyLayout({ edge, backgroundOpacity, cardOpacity, pinned }: WidgetLayout) {
  showPinned(pinned);
  const root = document.documentElement;
  root.dataset.edge = edge;
  root.style.setProperty('--bg-alpha', String(backgroundOpacity / 100));
  root.style.setProperty('--card-alpha', String(cardOpacity / 100));
  floating = backgroundOpacity === 0;
  root.classList.toggle('floating', floating);
  if (!floating) clickThrough = false;
}
window.widget.onLayout(applyLayout);
window.widget.getLayout().then(applyLayout);
window.widget.onSessions(render);
window.widget.onCycle(openNext);
