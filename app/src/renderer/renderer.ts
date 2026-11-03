// サイドバーの描画（カード案 B-1）。リポジトリごとのカードに、ワークツリーごとの小見出しを付ける。
// グループごとの上限を超えたセッションと停止中は、折りたたみに入れる（まとめ方は設定で選ぶ）。
// 行・小見出し・カードの要素は使い回し、並びが変わったところだけを動かす（アニメーションを途切れさせない）。

import type { GitChanges, SessionView, WidgetLayout } from '../shared/types';
import {
  PENDING_FOCUS_MS,
  PRIORITY_SORT,
  PROGRESS_RING,
  alertActions,
  alertDelay,
  attentionReason,
  buildCards,
  cardBadge,
  cardLayout,
  changeItems,
  changesTooltip,
  foldCounts,
  foldLabel,
  formatAgo,
  hasAlertOutput,
  mergeAlerts,
  nextAttention,
  openedInClaude,
  pickAlerts,
  shortcutTarget,
  resolveFocus,
  statusIconName,
  tooltip,
  type Alert,
  type Card,
  type Fold,
  type FoldOptions,
  type Group,
  type PendingFocus,
  type SortOptions,
  type StatusIcon,
} from './model.js';
import { flip } from './flip.js';
import { createIcon, fillIcons, setIcon } from './icon.js';
import { playSound } from './sound.js';
import { initTooltips } from './tooltip.js';

interface RowRefs {
  el: HTMLLIElement;
  status: HTMLElement;
  seq: HTMLElement;
  title: HTMLElement;
  branch: HTMLElement;
  when: HTMLElement;
  keep: HTMLElement;
  data?: SessionView;
}

interface CardRefs {
  el: HTMLElement;
  name: HTMLElement;
  changes: HTMLElement;
  badge: HTMLElement;
  body: HTMLElement;
}

interface FoldRefs {
  el: HTMLElement;
  toggle: HTMLElement;
  /** 状態ごとの印と件数 */
  counts: Map<string, { el: HTMLElement; n: HTMLElement }>;
  /** 変更が残る作業フォルダの数 */
  changes: { el: HTMLElement; n: HTMLElement };
  hidden: HTMLUListElement;
  sep: HTMLElement;
  stopped: HTMLUListElement;
}

const cardsEl = document.getElementById('cards')!;
const rowTemplate = document.getElementById('row-template') as HTMLTemplateElement;
const cardTemplate = document.getElementById('card-template') as HTMLTemplateElement;
const subheadTemplate = document.getElementById('subhead-template') as HTMLTemplateElement;
const foldTemplate = document.getElementById('fold-template') as HTMLTemplateElement;
fillIcons(document);
const tooltips = initTooltips();

const rows = new Map<string, RowRefs>();
const cards = new Map<string, CardRefs>();
const subheads = new Map<string, HTMLElement>();
const sections = new Map<string, HTMLElement>();
const lists = new Map<string, HTMLUListElement>();
const folds = new Map<string, FoldRefs>();
/** 開いている折りたたみ。開けるのは 1 つだけ */
let openFold: string | undefined;
/** 未確認（左端の帯を出す）セッションの ID と、それを決めるために覚えておく前の状態 */
const attention = new Set<string>();
const seenState = new Map<string, SessionView['state']>();
/** 前に見た、Claude 本体で最後に開いた時刻。進んだら本体で開いたものとして帯を消す */
const seenFocusedAt = new Map<string, number>();
/** 一覧の設定（onLayout で届く）。常に表示は、押したときにすぐ変え、保存された値が戻ってきたらそれに合わせる */
let groupLimit = 0;
let foldScope: FoldOptions['scope'] = 'repo';
let sort: SortOptions = PRIORITY_SORT;
let alwaysShow = new Set<string>();
/** 最後に受け取ったセッション一覧と、クリックしてまだファイルに反映されていないセッション */
let latest: SessionView[] = [];
let pendingFocus: PendingFocus | undefined;
let pendingTimer: number | undefined;
/** 通知の設定（onLayout で届く） */
type NotifyOptions = Pick<WidgetLayout, 'notifyWaiting' | 'notifyDone' | 'sound' | 'soundType' | 'soundVolume' | 'toast' | 'flash' | 'muteWhenOpen'>;
let notify: NotifyOptions | undefined;
/** 最初のセッション一覧を受け取ったか。起動した時点の状態では知らせない */
let primed = false;
/** まだ知らせていない変化と、前に知らせた時刻 */
let queuedAlerts: Alert[] = [];
let alertTimer: number | undefined;
let lastAlertAt = -Infinity;

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

/** 今の折りたたみの決まり。未確認と今開いているものは、上限を超えても出す */
function foldOptions(): FoldOptions {
  const extra = new Set(attention);
  const focused = resolveFocus(latest, pendingFocus).id;
  if (focused) extra.add(focused);
  return { limit: groupLimit, scope: foldScope, alwaysShow, extra, sort };
}

/**
 * ショートカット：Claude が前面になければ今のセッションを前面に出す。
 * 前面なら未確認の行を表示順に開き、なければ表示順で次の行（折りたたみの中は選ばない）
 */
function openNext(claudeInFront: boolean) {
  const id = shortcutTarget(latest, attention, applyFocus(), claudeInFront, foldOptions());
  if (id) openRow(id);
}

function openRow(id: string) {
  const refs = rows.get(id);
  if (refs) setAttention(refs, id, false);
  // ファイルに書かれるのを待たずに、クリックした行へすぐ移す。反映されないまま時間が過ぎたら、ファイルの値に戻す
  pendingFocus = { id, until: Date.now() + PENDING_FOCUS_MS };
  clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => render(latest), PENDING_FOCUS_MS);
  // 折りたたみから選んだ行は、今開いているものとして一覧に上がる
  openFold = undefined;
  render(latest);
  window.widget.openSession(id);
}

function toggleAlwaysShow(id: string) {
  const on = !alwaysShow.has(id);
  alwaysShow = new Set(alwaysShow);
  if (on) alwaysShow.add(id);
  else alwaysShow.delete(id);
  render(latest);
  window.widget.setAlwaysShow(id, on);
}

/**
 * 状態の変化から、未確認の帯を付けるか消すかを決める。どの行を折りたたむかに使うので、描く前に済ませる。
 * Claude 本体で開いた（lastFocusedAt が進んだ）セッションは、帯を消す。
 * 知らせる変化（対応待ちになった、完了した）を返す
 */
function updateAttention(sessions: SessionView[]): Alert[] {
  const fresh: Alert[] = [];
  for (const s of sessions) {
    const prev = seenState.get(s.id);
    if (prev !== s.state) {
      if (nextAttention(prev, s.state, attention.has(s.id))) attention.add(s.id);
      else attention.delete(s.id);
      const reason = attentionReason(prev, s.state);
      if (reason) fresh.push({ id: s.id, reason });
      seenState.set(s.id, s.state);
    }
    if (openedInClaude(seenFocusedAt.get(s.id), s.focusedAt)) attention.delete(s.id);
    seenFocusedAt.set(s.id, s.focusedAt ?? 0);
  }
  return fresh;
}

// ---- 音、トースト、タスクバーの点滅 ----

/** 知らせる変化をためておき、少し待ってからまとめて知らせる。続くときは数秒あける（タイマーはそのときだけ使う） */
function queueAlerts(fresh: Alert[]) {
  queuedAlerts = mergeAlerts(queuedAlerts, fresh);
  if (alertTimer === undefined) alertTimer = window.setTimeout(() => void fireAlerts(), alertDelay(lastAlertAt, Date.now()));
}

async function fireAlerts() {
  alertTimer = undefined;
  // 待っている間に開いた（帯が消えた）ものは知らせない
  const queued = queuedAlerts.filter((a) => attention.has(a.id));
  queuedAlerts = [];
  const n = notify;
  if (!n || !queued.length) return;
  // Claude が前面かどうかは、今開いているセッションが入っているときだけ調べる（PowerShell に問い合わせるため）
  const focused = resolveFocus(latest, pendingFocus).id;
  const askFront = focused !== undefined && queued.some((a) => a.id === focused);
  const openInFront = askFront && (await window.widget.isClaudeInFront()) ? focused : undefined;
  // 本体で見ている最中に変わったセッションには、帯を付けない
  if (openInFront && attention.delete(openInFront)) render(latest);
  if (!hasAlertOutput(n)) return;
  const alerts = pickAlerts(queued, { waiting: n.notifyWaiting, done: n.notifyDone, muteWhenOpen: n.muteWhenOpen }, openInFront);
  const actions = alertActions(alerts, n, latest);
  if (!actions) return;
  lastAlertAt = Date.now();
  if (actions.sound) playSound(n.soundType, actions.sound, n.soundVolume);
  if (actions.toast) window.widget.showToast(actions.toast);
  if (actions.flash) window.widget.flashTaskbar();
}

function getRow(s: SessionView): RowRefs {
  let refs = rows.get(s.id);
  if (!refs) {
    const el = clone<HTMLLIElement>(rowTemplate);
    refs = {
      el,
      status: el.querySelector('.status')!,
      seq: el.querySelector('.seq')!,
      title: el.querySelector('.title')!,
      branch: el.querySelector('.branch')!,
      when: el.querySelector('.when')!,
      keep: el.querySelector('.keep')!,
    };
    const id = s.id;
    el.addEventListener('click', () => openRow(id));
    refs.keep.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAlwaysShow(id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openRow(id);
    });
    rows.set(s.id, refs);
  }
  const prev = refs.data;
  setStatus(refs.status, statusIconName(s.state, s.waitingFor));
  if (prev?.state !== s.state) refs.el.dataset.state = s.state;
  refs.el.toggleAttribute('data-attention', attention.has(s.id));
  const kept = alwaysShow.has(s.id);
  refs.el.toggleAttribute('data-keep', kept);
  refs.keep.setAttribute('aria-pressed', String(kept));
  refs.keep.dataset.tip = kept ? '常に表示中（クリックで外す）' : '常に表示する';
  if (prev?.seq !== s.seq) refs.seq.textContent = s.seq ? String(s.seq) : '';
  if (prev?.title !== s.title) refs.title.textContent = s.title;
  if (prev?.lastActivityAt !== s.lastActivityAt) refs.when.textContent = formatAgo(s.lastActivityAt);
  refs.el.dataset.tip = tooltip(s);
  refs.data = s;
  return refs;
}

// ---- コミットされていない変更 ----

/** 見出しや小見出しの内訳の印（変更、未追跡、push していないコミット）。何もなければ隠す */
function setChanges(el: HTMLElement, c: GitChanges | undefined) {
  const items = changeItems(c);
  // 毎回作り直さないよう、内訳が変わったときだけ描き直す
  const key = items.map((i) => `${i.icon}:${i.count}`).join(',');
  if (el.dataset.items === key) return;
  el.dataset.items = key;
  el.hidden = items.length === 0;
  el.replaceChildren(...items.map((i) => {
    const item = document.createElement('span');
    item.className = 'changes-item';
    item.append(createIcon(i.icon), String(i.count));
    return item;
  }));
  if (items.length) el.dataset.tip = changesTooltip(c);
  else delete el.dataset.tip;
}

// ---- カード ----

function getCard(card: Card): CardRefs {
  let refs = cards.get(card.key);
  if (!refs) {
    const el = clone<HTMLElement>(cardTemplate);
    refs = {
      el,
      name: el.querySelector('.repo-name')!,
      changes: el.querySelector('.changes')!,
      badge: el.querySelector('.badge')!,
      body: el.querySelector('.card-body')!,
    };
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
  setChanges(el.querySelector('.changes')!, group.changes);
  return el;
}

/** ワークツリーの枠。小見出し、行、ワークツリーごとの折りたたみを入れる */
function getSection(key: string): HTMLElement {
  let el = sections.get(key);
  if (!el) {
    el = document.createElement('div');
    el.className = 'worktree';
    sections.set(key, el);
  }
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

// ---- 折りたたみ ----

function setOpenFold(key: string | undefined) {
  if (openFold === key) return;
  openFold = key;
  for (const [k, refs] of folds) refs.el.classList.toggle('open', k === openFold);
}

function getFold(key: string): FoldRefs {
  let refs = folds.get(key);
  if (!refs) {
    const el = clone<HTMLElement>(foldTemplate);
    const counts = new Map<string, { el: HTMLElement; n: HTMLElement }>();
    for (const c of el.querySelectorAll<HTMLElement>('.fold-count')) {
      const state = c.dataset.state as SessionView['state'];
      setStatus(c.querySelector('.status')!, statusIconName(state));
      counts.set(state, { el: c, n: c.querySelector('.n')! });
    }
    refs = {
      el,
      toggle: el.querySelector('.fold-toggle')!,
      counts,
      changes: { el: el.querySelector('.fold-changes')!, n: el.querySelector('.fold-changes .n')! },
      hidden: el.querySelector('.fold-hidden')!,
      sep: el.querySelector('.fold-sep')!,
      stopped: el.querySelector('.fold-stopped')!,
    };
    el.querySelector('.fold-toggle')!.addEventListener('click', () => setOpenFold(openFold === key ? undefined : key));
    folds.set(key, refs);
  }
  return refs;
}

/** withBranch：カードにまとめるときは、どのワークツリーかわかるようブランチ名を添える */
function renderFold(fold: Fold, withBranch: boolean): HTMLElement {
  const refs = getFold(fold.key);
  refs.el.classList.toggle('open', openFold === fold.key);
  // ボタンには状態ごとの印と件数だけを出し、文字の説明はツールチップと読み上げに回す
  const label = foldLabel(fold);
  refs.toggle.dataset.tip = label;
  refs.toggle.setAttribute('aria-label', label);
  const counts = new Map(foldCounts(fold).map((c) => [c.state as string, c.count]));
  for (const [state, c] of refs.counts) {
    const n = counts.get(state) ?? 0;
    c.el.hidden = n === 0;
    c.n.textContent = String(n);
  }
  // 中のセッションに、上の印に出ていない変更が残っていれば、変更の印と作業フォルダの数を添える
  refs.changes.el.hidden = fold.changedFolders === 0;
  refs.changes.n.textContent = String(fold.changedFolders);
  const toRow = (s: SessionView) => {
    const row = getRow(s);
    row.branch.textContent = withBranch ? (s.worktree?.label ?? '') : '';
    return row.el;
  };
  syncChildren(refs.hidden, fold.hidden.map(toRow));
  syncChildren(refs.stopped, fold.stopped.map(toRow));
  refs.sep.hidden = !(fold.hidden.length && fold.stopped.length);
  return refs.el;
}

function renderCard(card: Card, opts: FoldOptions): HTMLElement {
  const refs = getCard(card);
  refs.name.textContent = card.name;

  const badge = cardBadge(card);
  refs.badge.dataset.state = badge.state;
  refs.badge.textContent = badge.text;

  const layout = cardLayout(card, opts);
  setChanges(refs.changes, layout.headerChanges);
  const bodyNodes: Element[] = [];
  for (const g of layout.sections) {
    const key = `${card.key}|${g.key}`;
    const nodes: Element[] = [];
    if (g.group) nodes.push(getSubhead(key, g.group));
    const ul = getList(key);
    syncChildren(ul, g.sessions.map((s) => {
      const row = getRow(s);
      row.branch.textContent = '';
      return row.el;
    }));
    nodes.push(ul);
    if (g.fold) nodes.push(renderFold(g.fold, false));
    // 小見出しのあるワークツリーは枠で囲む。ワークツリーが 1 つだけのカードは枠を付けない
    if (g.group) {
      const section = getSection(key);
      syncChildren(section, nodes);
      bodyNodes.push(section);
    } else {
      bodyNodes.push(...nodes);
    }
  }
  if (layout.fold) bodyNodes.push(renderFold(layout.fold, true));
  syncChildren(refs.body, bodyNodes);
  return refs.el;
}

/** 並べ替えで動かす要素。親（カード）を子より先に */
function* animatedElements(): Iterable<HTMLElement> {
  for (const c of cards.values()) yield c.el;
  yield* sections.values();
  for (const f of folds.values()) yield f.el;
  for (const r of rows.values()) yield r.el;
}

function render(sessions: SessionView[]) {
  latest = sessions;
  const fresh = updateAttention(sessions);
  if (primed && fresh.length) queueAlerts(fresh);
  const opts = foldOptions();
  const list = buildCards(sessions, opts.sort.project);
  // 番号の列の幅。どの行でもタイトルの先頭がそろうよう、いちばん大きい番号の桁数にする
  const digits = String(Math.max(0, ...sessions.map((s) => s.seq ?? 0))).length;
  document.documentElement.style.setProperty('--seq-digits', String(digits));
  // 並びが変わった行・小見出し・折りたたみ・カードを、前の位置からすべらせる
  flip(animatedElements, () => {
    syncChildren(cardsEl, list.map((card) => renderCard(card, opts)));
  });

  // なくなったものは捨てる
  const ids = new Set(sessions.map((s) => s.id));
  for (const id of rows.keys()) if (!ids.has(id)) rows.delete(id);
  for (const id of attention) if (!ids.has(id)) attention.delete(id);
  for (const id of seenState.keys()) if (!ids.has(id)) seenState.delete(id);
  for (const id of seenFocusedAt.keys()) if (!ids.has(id)) seenFocusedAt.delete(id);
  const cardKeys = new Set(list.map((c) => c.key));
  for (const key of cards.keys()) if (!cardKeys.has(key)) cards.delete(key);
  for (const map of [subheads, sections, lists] as Map<string, Element>[]) {
    for (const [key, el] of map) if (!el.isConnected) map.delete(key);
  }
  for (const [key, refs] of folds) if (!refs.el.isConnected) folds.delete(key);
  if (openFold && !folds.has(openFold)) openFold = undefined;
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

document.getElementById('settings')!.addEventListener('click', () => window.widget.openSettings());

// 最前面への固定。押した見た目はすぐ変え、保存された値が onLayout で戻ってきたらそれに合わせる
const pinButton = document.getElementById('pin')!;
let pinned = true;
function showPinned(value: boolean) {
  pinned = value;
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
  if (e.button !== 0) return;
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
  const solid = (e.target as Element).closest('.card, .titlebar, .resize-handle');
  setClickThrough(!solid);
});

// 折りたたみは、外をクリックするか Esc で閉じる
document.addEventListener('pointerdown', (e) => {
  if (openFold && !(e.target as Element).closest('.fold')) setOpenFold(undefined);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setOpenFold(undefined);
});

function applyLayout(layout: WidgetLayout) {
  const { edge, backgroundOpacity, cardOpacity, pinned, groupLimit: limit, foldScope: scope, alwaysShow: keep } = layout;
  showPinned(pinned);
  groupLimit = limit;
  foldScope = scope;
  sort = { project: layout.projectOrder, worktree: layout.worktreeOrder, session: layout.sessionOrder };
  alwaysShow = new Set(keep);
  const { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen } = layout;
  notify = { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen };
  render(latest);
  const root = document.documentElement;
  root.dataset.edge = edge;
  root.style.setProperty('--bg-alpha', String(backgroundOpacity / 100));
  root.style.setProperty('--card-alpha', String(cardOpacity / 100));
  root.style.setProperty('--header-alpha', String(layout.headerShade / 100));
  root.classList.toggle('hide-seq', !layout.showSeq);
  root.classList.toggle('hide-updated', !layout.showUpdated);
  floating = backgroundOpacity === 0;
  root.classList.toggle('floating', floating);
  if (!floating) clickThrough = false;
}
window.widget.onLayout(applyLayout);
window.widget.getLayout().then(applyLayout);
window.widget.onSessions((sessions) => {
  render(sessions);
  primed = true;
});
window.widget.onCycle(openNext);
// トーストのクリックも、行のクリックと同じく帯を消してから開く
window.widget.onToastClick(openRow);
