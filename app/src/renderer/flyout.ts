// めくれと一覧のウィンドウの中身（docs/design/worktree-cards.md）。
// - 重なりに乗せたとき：めくれ（件数と矢印）をカードの端から外へ伸ばす
// - めくれを押したとき：めくれの形から一覧（タイムライン）の形へ変形する（transform と opacity だけ）
// - 閉じるときは動きを付けずにすぐ消す（メインプロセスがウィンドウを隠す）
// クリックを受け取る場所（めくれと一覧）はメインプロセスに知らせ、ほかはクリックを下へ通してもらう。

import type { FlyCard, FlyContent, FlyItem, FlyShow, TipRect } from '../shared/types';
import { FLAP_INSET, FLAP_WIDTH, flapHeight } from '../shared/flap.js';
import { ja } from '../shared/strings/ja.js';
import { renderGit, resetGitFoot, scrollGitFoot } from './flyout-git.js';
import { createIcon } from './icon.js';
import { canToggleArchive, hasBackground, statusIconName, waitingLabel, type StatusIcon } from './model.js';
import { setStatus } from './status-icon.js';
import { applyHighlight, applyMotion, applyStatusColors } from './status-colors.js';

document.title = ja.window.flyout(ja.app.name);

const flap = document.getElementById('flap')!;
const flapCount = flap.querySelector<HTMLElement>('.flap-count')!;
const list = document.getElementById('list')!;
const head = list.querySelector<HTMLElement>('.list-head')!;
const body = list.querySelector<HTMLElement>('.list-body')!;
const foot = list.querySelector<HTMLElement>('.list-foot')!;
flap.querySelector('.flap-arrow')!.append(createIcon('chevron-right'));

/** ウィンドウの端と一覧の間（影の分） */
const EDGE_MARGIN = 8;
const MORPH_MS = 220;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let current: FlyShow | undefined;
let open = false;
/** この時刻（performance.now）を過ぎてから動かしたら、下の段にまとめを出す。開いて変形している間は出さない */
let summaryArmedAt = 0;
let items = new Map<string, FlyItem>();

function rectOf(el: HTMLElement): TipRect {
  // 動いている途中の形ではなく、止まったときの場所を知らせる（transform を除いた位置）
  return { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}

function reportSolid() {
  const rects: TipRect[] = [];
  if (!flap.hidden) rects.push(rectOf(flap));
  if (!list.hidden) rects.push(rectOf(list));
  window.flyoutApi.reportSolid(rects);
}

// ---- 一覧の行 ----

/** 行の状態の印。保留の行はウィジェットと同じ circle-pause */
function itemIcon(item: FlyItem): StatusIcon {
  return item.held ? 'circle-pause' : statusIconName(item.state, item.waitingFor, item.background);
}

function node(item: FlyItem, kind: 'timeline' | 'plain' | 'cards', above: FlyItem | undefined): HTMLElement {
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = item.id;
  el.dataset.state = item.state;
  el.toggleAttribute('data-held', !!item.held);
  el.toggleAttribute('data-background', !item.held && !item.archived && hasBackground(item.state, item.background));
  el.toggleAttribute('data-archived', item.archived);
  el.toggleAttribute('data-origin', item.origin);
  el.toggleAttribute('data-focused', item.focused);
  if (item.origin) el.title = item.place?.tip ?? ja.flyout.startedOnMain;
  if (kind === 'timeline') {
    el.classList.add('linked');
    // 線は点の上下から伸ばす。上の線は上の行（より新しいもの）のつなぎ方、下の線はこの行のつなぎ方
    if (above?.link) el.append(line('in', above.link));
    if (item.link) el.append(line('out', item.link));
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.append(dot);
  } else {
    const ico = document.createElement('span');
    ico.className = 'status';
    setStatus(ico, itemIcon(item));
    el.append(ico);
  }
  const txt = document.createElement('div');
  txt.className = 'txt';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.title;
  const sub = document.createElement('div');
  sub.className = 'sub';
  if (!item.archived && kind === 'timeline') {
    const ico = document.createElement('span');
    ico.className = 'status';
    setStatus(ico, itemIcon(item));
    sub.append(ico);
    if (item.state === 'waiting') sub.append(ja.state.waitingWithReason(waitingLabel(item.waitingFor)));
    else if (hasBackground(item.state, item.background)) sub.append(ja.state.background);
  }
  if (item.place) {
    const place = document.createElement('span');
    place.className = 'place';
    place.append(createIcon(item.place.icon));
    const name = document.createElement('span');
    name.className = 'place-name';
    name.textContent = item.place.label;
    place.append(name);
    sub.append(place);
    if (item.sub) {
      const sep = document.createElement('span');
      sep.textContent = '·';
      sub.append(sep);
    }
  }
  if (item.sub) sub.append(item.sub);
  txt.append(title, sub);
  el.append(txt);
  // 処理中・対応待ちのものはアーカイブできない（動いているものは隠さない）ので、トグルを出さない。保留のものも出さない（保留とアーカイブは同時に付けない）
  const live = !item.archived && (item.state === 'busy' || item.state === 'waiting');
  if (kind !== 'cards' && !live && !item.held) {
    const act = document.createElement('button');
    act.className = 'act';
    act.setAttribute('aria-pressed', String(item.archived));
    act.title = item.archived ? ja.flyout.unarchive : ja.flyout.archive;
    act.append(createIcon('archive'));
    act.addEventListener('click', (e) => {
      e.stopPropagation();
      window.flyoutApi.action({ type: 'toggle', id: item.id });
    });
    el.append(act);
  }
  el.addEventListener('click', () => window.flyoutApi.action({ type: 'open', id: item.id }));
  // 右クリックで、ID をコピーするメニューを出す（メニューはメインプロセスが出す）
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.flyoutApi.showSessionMenu(item.id);
  });
  // ホイールクリックでトグルと同じ処理を呼ぶ（トグルを出さない行は切り替えない）。mousedown でオートスクロールを止める
  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });
  el.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    if (kind !== 'cards' && canToggleArchive(item.state, item.archived)) window.flyoutApi.action({ type: 'toggle', id: item.id });
  });
  // 開いたときは一覧がカーソルの下に広がるので、乗っただけでは出さない。カーソルを動かしたときだけ、下の段にまとめを出す
  // 中身が変わったときに Chromium が送る動きのない pointermove も、動かしたとは見なさない
  el.addEventListener('pointermove', (e) => {
    if (performance.now() >= summaryArmedAt && (e.movementX || e.movementY)) showSummary(item.id);
  });
  return el;
}

function line(side: 'in' | 'out', link: 'solid' | 'dashed'): HTMLElement {
  const el = document.createElement('span');
  el.className = `ln ${side} ${link}`;
  return el;
}

/**
 * 分岐元のブランチの行。起点（元のフォルダで始めたセッション）のすぐ上、起点がなければ一番下に置く。
 * セッションではないので押せない。線は上の行のつなぎ方をそのまま通す（in / out）
 */
function baseNode(base: { branch: string; tip: string; mergedInto?: string }, link: { in?: 'solid' | 'dashed'; out?: 'solid' | 'dashed' }): HTMLElement {
  const el = document.createElement('div');
  el.className = 'node linked base-root';
  el.title = base.tip;
  if (link.in) el.append(line('in', link.in));
  if (link.out) el.append(line('out', link.out));
  const ic = document.createElement('span');
  ic.className = 'base-ic';
  ic.append(createIcon('git-branch'));
  const txt = document.createElement('div');
  txt.className = 'txt';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = base.branch;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = base.mergedInto ? ja.flyout.baseRootMerged(base.mergedInto) : ja.flyout.baseRoot;
  txt.append(title, sub);
  el.append(ic, txt);
  return el;
}

function cardBlock(card: FlyCard): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fcard';
  const head = document.createElement('div');
  head.className = 'fcard-head';
  head.title = card.mergedInto ? ja.flyout.mergedInto(card.mergedInto) : card.merged ? ja.flyout.merged : ja.flyout.archivedCard;
  head.append(createIcon(card.merged ? 'git-merge' : 'git-branch'));
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = card.label;
  const act = document.createElement('button');
  act.className = 'act';
  act.setAttribute('aria-pressed', 'true');
  act.title = ja.flyout.unarchiveCard;
  act.append(createIcon('archive'));
  act.addEventListener('click', () => window.flyoutApi.action({ type: 'toggle-card', key: card.key }));
  head.append(name, act);
  el.append(head, ...card.items.map((i) => node(i, 'cards', undefined)));
  return el;
}

/** 下の段に出している行（まとめのない行に乗せたときも、その行を覚えておく） */
let summaryId: string | undefined;
/** git の詳細を出している（下の段は flyout-git.ts が描く） */
let gitMode = false;

/** 中身を作り直す。新しい中身を知らせてきたとき（onContent）は、乗せている行のまとめを出したままにする */
function renderContent(content: FlyContent, keepSummary = false) {
  items = new Map();
  gitMode = content.kind === 'git';
  list.classList.toggle('git', gitMode);
  if (content.kind === 'git') {
    // git の詳細（flyout-git.ts）。下の段はいつも出し、乗せたコミットの本文を出す
    renderGit(content.detail, { head, body, foot, onResize: () => { placeList(); reportSolid(); } }, !keepSummary);
    return;
  }
  head.hidden = true;
  if (content.kind === 'cards') {
    for (const c of content.cards) for (const i of c.items) items.set(i.id, i);
    body.replaceChildren(...content.cards.map(cardBlock));
  } else {
    content.items.forEach((i) => items.set(i.id, i));
    const nodes = content.items.map((i, n) => node(i, content.kind, content.items[n - 1]));
    if (content.kind === 'timeline' && content.base) {
      // 時間の順：元のフォルダで始めた起点 → 分岐元のブランチからワークツリーを作る → ワークツリーのセッション
      const at = content.items.findIndex((i) => i.origin);
      const above = content.items[(at < 0 ? content.items.length : at) - 1];
      if (at < 0) {
        // 起点がなければ一番下。上の行（一番古いもの）からは破線でつなぐ
        nodes.at(-1)?.append(line('out', 'dashed'));
        nodes.push(baseNode(content.base, { in: 'dashed' }));
      } else {
        const link = above?.link ?? 'dashed';
        nodes.splice(at, 0, baseNode(content.base, { ...(above && { in: link }), out: link }));
      }
    }
    body.replaceChildren(...nodes);
  }
  // 下の段は、まとめのある行が 1 つでもあれば、乗せていなくてもいつも同じ高さで出しておく（flyout.css の .list-foot）
  foot.hidden = ![...items.values()].some((i) => i.summary);
  summaryId = undefined;
  showSummary(keepSummary ? summaryId : undefined, true);
}

/** 行に乗せたら、一覧の下の段に最後のターンのまとめを出す。下の段の大きさは変えず、中の文字だけを入れ替える */
function showSummary(id: string | undefined, force = false) {
  if (gitMode) return;
  if (!force && id === summaryId) return;
  summaryId = id;
  if (foot.hidden) return;
  const item = id ? items.get(id) : undefined;
  if (!item?.summary) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = item ? ja.flyout.noSummary : ja.flyout.summaryHint;
    return foot.replaceChildren(hint);
  }
  const b = document.createElement('b');
  b.textContent = item.title;
  const text = document.createElement('div');
  text.className = 'summary';
  text.textContent = item.summary;
  foot.replaceChildren(b, text);
}

// ---- 置き方と動き ----

/** 一覧の縦の位置。カードの上端にそろえ、ウィンドウ（作業領域）からはみ出すときは中へずらす */
function placeList() {
  if (!current) return;
  const max = window.innerHeight - list.offsetHeight - EDGE_MARGIN;
  list.style.top = `${Math.max(EDGE_MARGIN, Math.min(current.top, max))}px`;
}

/** めくれの件数。0（以前のセッションはないが、分岐元を見せるために開く）なら、件数の代わりにブランチのアイコン */
function setFlapCount(count: number) {
  if (count) flapCount.textContent = String(count);
  else flapCount.replaceChildren(createIcon('git-branch'));
}

function placeFlap(show: FlyShow) {
  flap.style.top = `${show.top + FLAP_INSET}px`;
  flap.style.width = `${FLAP_WIDTH}px`;
  flap.style.height = `${flapHeight(show.height)}px`;
  setFlapCount(show.count);
}

/**
 * めくれの形から一覧の形へ変形する。
 * 変形させるのは中身のない外枠（.list::before の背景・枠線・影）だけ。文字に拡大の動きをかけると、
 * 引き伸ばした絵としてぼやけ、止まったときに描き直されてぶれて見えるため。文字は外枠がほぼ広がりきってから、その場で薄い状態から出す
 */
function morph() {
  if (reducedMotion.matches || flap.hidden) return;
  // めくれが伸びている途中で押されても、伸びる動き（transform）を除いた形から始める（モックと同じ）
  const from = rectOf(flap);
  const to = rectOf(list);
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = document.documentElement.dataset.side === 'left'
    ? from.x + from.width - (to.x + to.width)
    : from.x - to.x;
  const dy = from.y - to.y;
  list.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }], {
    duration: MORPH_MS,
    easing: 'cubic-bezier(.2, .8, .2, 1)',
    pseudoElement: '::before',
  });
  // 0.26 秒の 55%（変形の 65% ほど）から出す。このとき外枠は本来の大きさの 98% ほどまで広がっている
  for (const child of list.children) {
    child.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: MORPH_MS + 40 });
  }
}

function setOpen(animate: boolean) {
  open = true;
  summaryArmedAt = performance.now() + MORPH_MS;
  list.hidden = false;
  flap.classList.add('pinned');
  placeList();
  if (animate) morph();
  // めくれは飛び出して一覧になったので、開いている間は隠す（一覧が短いと、下からはみ出して見えるため）
  flap.hidden = true;
  reportSolid();
}

window.flyoutApi.onColors((colors, highlight, motion, island) => {
  document.documentElement.classList.toggle('island', island);
  applyStatusColors(colors);
  applyHighlight(highlight);
  applyMotion(motion);
});
window.flyoutApi.onShow((show) => {
  current = show;
  open = false;
  document.documentElement.dataset.side = show.side;
  // 一覧はウィジェットの端からすき間をあけて開く（めくれはカードの端から伸びる）
  list.style.right = show.side === 'left' ? `${show.inset}px` : '';
  list.style.left = show.side === 'right' ? `${show.inset}px` : '';
  renderContent(show.content);
  list.hidden = true;
  flap.classList.remove('pinned', 'peek');
  // 見出しから開くときは、めくれを出さずに一覧だけを出す
  flap.hidden = show.open;
  if (!show.open) {
    placeFlap(show);
    // 見せる直前に動きを始める（ウィンドウは描き終えてから見せる）
    void flap.offsetWidth;
    flap.classList.add('peek');
  }
  if (show.open) setOpen(false);
  else requestAnimationFrame(() => reportSolid());
});

window.flyoutApi.onContent((content, count) => {
  if (!current) return;
  renderContent(content, true);
  setFlapCount(count);
  if (open) placeList();
  reportSolid();
});

window.flyoutApi.onOpen(() => setOpen(true));

window.flyoutApi.onHide(() => {
  current = undefined;
  open = false;
  flap.hidden = true;
  list.hidden = true;
  for (const a of list.getAnimations({ subtree: true })) a.cancel();
});

// めくれを押すと開き、開いているときにもう一度押すと閉じる
flap.addEventListener('click', () => {
  if (open) window.flyoutApi.close();
  else window.flyoutApi.requestOpen();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.flyoutApi.close();
});
list.addEventListener('pointerleave', () => (gitMode ? resetGitFoot(foot) : showSummary(undefined)));
// 下の段はスクロールしないので、その上で回したホイールは一覧のスクロールに回す
// git の詳細では、本文が収まらないときだけ本文を送る
foot.addEventListener('wheel', (e) => {
  if (!(gitMode && scrollGitFoot(foot, e.deltaY))) body.scrollBy({ top: e.deltaY });
}, { passive: true });
