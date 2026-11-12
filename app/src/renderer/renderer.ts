// サイドバーの描画。リポジトリごとの見出しの下に、ワークツリー（元のフォルダを含む）ごとのカードを並べる。
// 使い終わったセッションは Bantus の中だけでアーカイブして隠し、カードの後ろの重なりから一覧（別のウィンドウ）で見る
// （docs/design/worktree-cards.md）。
// 行・カード・見出しの要素は使い回し、並びが変わったところだけを動かす（アニメーションを途切れさせない）。

import type { ArchiveMark, HoldMark } from '../shared/settings';
import { initSystemUsage } from './system-usage.js';
import type { FlyAction, FlyContent, FlyItem, GitChanges, PlanStep, SessionView, WidgetLayout } from '../shared/types';
import {
  PENDING_FOCUS_MS,
  PRIORITY_SORT,
  alertActions,
  alertDelay,
  attentionReason,
  attentionStateOf,
  displayState,
  type AttentionState,
  buildRepos,
  changeItems,
  changesTooltip,
  contextLabel,
  contextLevel,
  contextPercent,
  formatAgo,
  hasAlertOutput,
  holdTooltip,
  isHeld,
  releasedHolds,
  mergeAlerts,
  newlyFlagged,
  nextAttention,
  openedInClaude,
  pickAlerts,
  revivedCards,
  revivedSessions,
  startupConfirmedAt,
  canToggleArchive,
  isLive,
  shortcutTarget,
  resolveFocus,
  stateLabel,
  statusIconName,
  hasBackground,
  planLabel,
  planSteps,
  tooltip,
  type Alert,
  type ArchiveOptions,
  type PendingFocus,
  type RepoView,
  type SortOptions,
  type TimelineItem,
  type WorktreeCard,
} from './model.js';
import { flapRect } from '../shared/flap.js';
import { ja } from '../shared/strings/ja.js';
import { enabled as motionEnabled, flip } from './flip.js';
import { createIcon, fillIcons, setIcon } from './icon.js';
import { createMemo, type MemoBox } from './memo.js';
import { playSound } from './sound.js';
import { setStatus } from './status-icon.js';
import { applyHighlight, applyMotion, applyStatusColors } from './status-colors.js';
import { fillStrings } from './strings.js';
import { sweep } from './sweep.js';
import { initSwitcher } from './switcher.js';
import { initTooltips } from './tooltip.js';
import { initViewer } from './viewer.js';

interface RowRefs {
  el: HTMLLIElement;
  /** 状態の印の押す的。中に今の印（now）と、乗せたときの印（alt） */
  status: HTMLElement;
  statusNow: HTMLElement;
  statusAlt: HTMLElement;
  memoEl: HTMLElement;
  memo: MemoBox;
  title: HTMLElement;
  /** セッション名の文字。光の帯（.shine）と並べるので、.title の textContent ではなくこれを書き換える */
  titleText: Text;
  /** 処理中の間だけ .title に重ねる光の帯と、その中の明るい文字 */
  shine?: { el: HTMLElement; text: HTMLElement };
  when: HTMLElement;
  /** コンテキストの使用率（docs/design/worktree-cards.md）。中に短いバー（ctxFill）と数字（ctxNum） */
  ctx: HTMLElement;
  ctxFill: HTMLElement;
  ctxNum: HTMLElement;
  pill: HTMLElement;
  /** 札の文字と、その右に並べるタスクリストの棒（処理中でリストがあるときだけ） */
  pillText: HTMLElement;
  plan: HTMLElement;
  act: HTMLElement;
  data?: SessionView;
}

interface RepoRefs {
  el: HTMLElement;
  header: HTMLElement;
  name: HTMLElement;
  archived: HTMLButtonElement;
  archivedCount: HTMLElement;
  badge: HTMLElement;
  cards: HTMLElement;
  data?: RepoView;
}

interface CardRefs {
  el: HTMLElement;
  card: HTMLElement;
  stackHit: HTMLElement;
  header: HTMLElement;
  /** ブランチのアイコンの押す的。中に今の印（now）と、乗せたときの印（alt） */
  icon: HTMLElement;
  iconNow: HTMLElement;
  iconAlt: HTMLElement;
  label: HTMLElement;
  changes: HTMLElement;
  act: HTMLElement;
  hold: HTMLElement;
  memo: MemoBox;
  rows: HTMLUListElement;
  data?: WorktreeCard;
}

const cardsEl = document.getElementById('cards')!;
const rowTemplate = document.getElementById('row-template') as HTMLTemplateElement;
const cardTemplate = document.getElementById('card-template') as HTMLTemplateElement;
const repoTemplate = document.getElementById('repo-template') as HTMLTemplateElement;
fillIcons(document);
fillStrings(document);
const tooltips = initTooltips();
const viewer = initViewer();
// 残りの一覧を開いている間は、ビューアの HTML（一番上に重なる別のビュー）を引っ込める
initSwitcher(tooltips, (open) => viewer.setCovered(open));

const rows = new Map<string, RowRefs>();
const cards = new Map<string, CardRefs>();
const repos = new Map<string, RepoRefs>();
/** 未確認（左端の帯を出す）セッションの ID と、それを決めるために覚えておく前の状態 */
const attention = new Set<string>();
const seenState = new Map<string, AttentionState>();
/** 前に見た、Claude 本体で最後に開いた時刻。進んだら本体で開いたものとして帯を消す */
const seenFocusedAt = new Map<string, number>();
/** 帯が消えた（確認した）時刻。main の自動アーカイブを数え始める時刻に使う。ウィジェットの中だけで覚える */
const confirmedAt = new Map<string, number>();
/** アーカイブから動き出して戻ったセッション（model.ts の ArchiveOptions.revived） */
const revived = new Set<string>();
/** 一覧の設定（onLayout で届く）。アーカイブの印は、押したときにすぐ変え、保存された値が戻ってきたらそれに合わせる */
let sort: SortOptions = PRIORITY_SORT;
let marks: Record<string, ArchiveMark> = {};
let cardMarks: Record<string, ArchiveMark> = {};
/** 保留の印（docs/design/hold.md）。アーカイブの印と同じく、押したときにすぐ変え、保存された値が戻ってきたらそれに合わせる */
let holds: Record<string, HoldMark> = {};
let heldCards: Record<string, HoldMark> = {};
/** 外した保留のメモ（`s:<ID>` か `c:<カードの目印>` → メモ）。もう一度保留にしたら戻す。保存はしない */
const lastNotes = new Map<string, string>();
/** メモを入力している枠の数（0 か 1）。入力の間は、行やカードを動かさない（動かすとフォーカスが外れて確定してしまう） */
let editingMemos = 0;
/** 描いたあとに入力の状態にするメモ（`s:<ID>` か `c:<カードの目印>`）。保留にした直後に使う */
let pendingMemo: string | undefined;
let mainMinutes = 10;
/** カードの見出しに変更の印を出すか（onLayout で届く） */
let showChanges = true;
/** 最後にメインプロセスへ送った、出しているカードの目印（リモートの取得の対象を決めるのに使う） */
let sentFetchCards = '';
/** 最後に受け取ったセッション一覧と、最後に描いたリポジトリ */
let latest: SessionView[] = [];
let lastRepos: RepoView[] = [];
let pendingFocus: PendingFocus | undefined;
let pendingTimer: number | undefined;
/** めくれ・一覧を出しているもの（カードの目印か `repo:<目印>`）と、一覧を開いているか */
let flyKey: string | undefined;
let flyOpen = false;
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

// ---- 未確認の帯とアーカイブ ----

/** 帯を消す。消したら確認した時刻を覚える */
function clearAttention(id: string) {
  if (attention.delete(id)) confirmedAt.set(id, Date.now());
}

function setAttention(refs: RowRefs, id: string, on: boolean) {
  if (on) attention.add(id);
  else clearAttention(id);
  refs.el.toggleAttribute('data-attention', on);
}

function archiveOptions(): ArchiveOptions {
  return { marks, cardMarks, holds, heldCards, attention, confirmedAt, mainMinutes, revived, now: Date.now(), sort };
}

/** セッションの印を変えて保存する（null で外して自動の決まりに戻す） */
function setMark(id: string, mark: ArchiveMark | null) {
  marks = { ...marks };
  if (mark) marks[id] = mark;
  else delete marks[id];
  window.widget.setArchive(id, mark);
}

function setCardMark(key: string, mark: ArchiveMark | null) {
  cardMarks = { ...cardMarks };
  if (mark) cardMarks[key] = mark;
  else delete cardMarks[key];
  window.widget.setCardArchive(key, mark);
}

/** セッションの保留の印を変えて保存する（null で外す） */
function setHold(id: string, mark: HoldMark | null) {
  holds = { ...holds };
  if (mark) holds[id] = mark;
  else delete holds[id];
  window.widget.setHold(id, mark);
}

function setCardHold(key: string, mark: HoldMark | null) {
  heldCards = { ...heldCards };
  if (mark) heldCards[key] = mark;
  else delete heldCards[key];
  window.widget.setCardHold(key, mark);
}

/** 処理中・対応待ち。保留にできない（動いているものは保留にしない） */
function isRunning(s: SessionView): boolean {
  return s.state === 'busy' || s.state === 'waiting';
}

/**
 * 行の状態のアイコンを押した：保留にする・外す。処理中・対応待ちの行では何もしない。
 * 保留にするときは、アーカイブの印を消し、前に外したメモを戻して、そのままメモの入力の状態にする
 */
function toggleHold(id: string) {
  const s = latest.find((x) => x.id === id);
  if (!s || isRunning(s)) return;
  const current = holds[id];
  if (current) {
    lastNotes.set(`s:${id}`, current.note);
    setHold(id, null);
    // 外したとたんに自動の決まりで隠れないよう、確認したものとして猶予を置く
    confirmedAt.set(id, Date.now());
  } else {
    if (marks[id]) setMark(id, null);
    revived.delete(id);
    setHold(id, { note: lastNotes.get(`s:${id}`) ?? '', since: Date.now() });
    lastNotes.delete(`s:${id}`);
    pendingMemo = `s:${id}`;
  }
  render(latest);
}

/** カードの見出しのアイコンを押した。元のフォルダのカードと、処理中・対応待ちのセッションがあるカードでは何もしない */
function toggleCardHold(key: string) {
  const card = cards.get(key)?.data;
  if (!card || card.isMain || card.sessions.some(isRunning)) return;
  const current = heldCards[key];
  if (current) {
    lastNotes.set(`c:${key}`, current.note);
    setCardHold(key, null);
    // マージ済みのカードが外したとたんに隠れないよう、一番新しいセッションを確認したものとして猶予を置く
    const newest = [...card.sessions, ...card.archived].reduce<SessionView | undefined>((a, b) => (!a || b.lastActivityAt > a.lastActivityAt ? b : a), undefined);
    if (newest) confirmedAt.set(newest.id, Date.now());
  } else {
    if (cardMarks[key]) setCardMark(key, null);
    setCardHold(key, { note: lastNotes.get(`c:${key}`) ?? '', since: Date.now() });
    lastNotes.delete(`c:${key}`);
    pendingMemo = `c:${key}`;
  }
  render(latest);
}

/** メモを確定した。保留を外したあとなら何もしない */
function commitNote(id: string, note: string) {
  const current = holds[id];
  if (current && current.note !== note) setHold(id, { ...current, note });
}

function commitCardNote(key: string, note: string) {
  const current = heldCards[key];
  if (current && current.note !== note) setCardHold(key, { ...current, note });
}

/** メモの入力を始めた・終えた。終えたら、入力の間に止めていた並べ替えを済ませる */
function onMemoEditing(editing: boolean) {
  editingMemos = Math.max(0, editingMemos + (editing ? 1 : -1));
  if (!editing) render(latest);
}

/** 保留の行（カード）が動き出したら、印を外す。メモは覚えておき、落ち着いてしばらくは隠さない */
function releaseHolds(sessions: SessionView[]) {
  const released = releasedHolds(sessions, { holds, heldCards });
  for (const id of released.sessions) {
    lastNotes.set(`s:${id}`, holds[id]!.note);
    revived.add(id);
    setHold(id, null);
  }
  for (const key of released.cards) {
    lastNotes.set(`c:${key}`, heldCards[key]!.note);
    setCardHold(key, null);
  }
}

/** 今アーカイブしているか（最後に描いたもので見る） */
function isArchivedNow(id: string): boolean {
  for (const repo of lastRepos) {
    for (const card of [...repo.cards, ...repo.hiddenCards]) {
      if (card.hidden && card.sessions.some((s) => s.id === id)) return true;
      if (card.archived.some((s) => s.id === id)) return true;
      if (card.sessions.some((s) => s.id === id)) return false;
    }
  }
  return false;
}

/** 行や一覧のトグル。今アーカイブしていれば戻し、していなければアーカイブする。アーカイブするときは帯も消す（確認したものとする） */
function toggleArchive(id: string) {
  const archive = !isArchivedNow(id);
  if (archive) clearAttention(id);
  // 手で決めたら、戻ったときの猶予はやめる
  revived.delete(id);
  setMark(id, archive ? 'archived' : 'shown');
  render(latest);
  if (archive) announceArchived(id);
}

function toggleCard(key: string) {
  const card = lastRepos.flatMap((r) => [...r.cards, ...r.hiddenCards]).find((c) => c.key === key);
  if (!card) return;
  if (!card.hidden) for (const s of [...card.sessions, ...card.archived]) revived.delete(s.id);
  setCardMark(key, card.hidden ? 'shown' : 'archived');
  render(latest);
}

/**
 * 手でアーカイブしたのに動き出したものは、印を外して自動の決まりに戻す。
 * アーカイブしていた（手でも自動でも、カードごとでも）ものが動き出したら、落ち着いてしばらくは出しておく
 */
function reviveMarks(sessions: SessionView[]) {
  for (const s of sessions) {
    if (isLive(s, attention) && (marks[s.id] === 'archived' || isArchivedNow(s.id))) revived.add(s.id);
  }
  for (const id of revivedSessions(sessions, { marks, attention })) setMark(id, null);
  for (const key of revivedCards(sessions, { cardMarks, attention })) setCardMark(key, null);
}

// ---- 行 ----

/** 今開いているセッションの行だけストライプの透かしを入れる。塗った行の ID を返す */
function applyFocus(): string | undefined {
  const resolved = resolveFocus(latest, pendingFocus);
  pendingFocus = resolved.pending;
  for (const [id, refs] of rows) refs.el.toggleAttribute('data-focused', id === resolved.id);
  return resolved.id;
}

/**
 * ショートカット：未確認の行があれば、Claude が前面かどうかに関係なく表示順に開く（アーカイブしたものは選ばない）。
 * なければ、前面にないときは今のセッションを前面に出し、前面なら表示順で次の行
 */
function openNext(claudeInFront: boolean) {
  const target = shortcutTarget(latest, attention, applyFocus(), claudeInFront, archiveOptions());
  if (target) openRow(target.id, target.raise);
}

/** 行を開く。raise が true なら、リンクを使わずに Claude のウィンドウを前に出すだけにする（前に出せなければ main がセッションを開き直す） */
function openRow(id: string, raise = false) {
  // 開く（前に出す）のを先に頼む。帯の更新と描き直しはそのあと
  if (raise) window.widget.raiseSession(id);
  else window.widget.openSession(id);
  const refs = rows.get(id);
  if (refs) setAttention(refs, id, false);
  else clearAttention(id);
  // ファイルに書かれるのを待たずに、クリックした行へすぐ移す。ファイルが追いつくか、本体で別のセッションを開くまで保つ。
  // 本体で開けないまま安全のための期限が過ぎたら、ファイルの値に戻す（そのための描き直しを予約しておく）
  const now = Date.now();
  pendingFocus = { id, at: now, until: now + PENDING_FOCUS_MS };
  clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => render(latest), PENDING_FOCUS_MS);
  render(latest);
}

/**
 * 状態の変化から、未確認の帯を付けるか消すかを決める。どれをアーカイブするかに使うので、描く前に済ませる。
 * Claude 本体で開いた（lastFocusedAt が進んだ）セッションは、帯を消す。
 * 知らせる変化（対応待ちになった、完了した）を返す
 */
function updateAttention(sessions: SessionView[]): Alert[] {
  const fresh: Alert[] = [];
  for (const s of sessions) {
    const prev = seenState.get(s.id);
    const next = attentionStateOf(s);
    if (prev !== next) {
      if (nextAttention(prev, next, attention.has(s.id))) attention.add(s.id);
      else clearAttention(s.id);
      const reason = attentionReason(prev, next);
      if (reason) fresh.push({ id: s.id, reason });
      seenState.set(s.id, next);
    }
    if (openedInClaude(seenFocusedAt.get(s.id), s.focusedAt)) clearAttention(s.id);
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
  if (openInFront && attention.has(openInFront)) {
    clearAttention(openInFront);
    render(latest);
  }
  if (!hasAlertOutput(n)) return;
  const alerts = pickAlerts(queued, { waiting: n.notifyWaiting, done: n.notifyDone, muteWhenOpen: n.muteWhenOpen }, openInFront);
  const actions = alertActions(alerts, n, latest);
  if (!actions) return;
  lastAlertAt = Date.now();
  if (actions.sound) playSound(n.soundType, actions.sound, n.soundVolume);
  if (actions.toast) window.widget.showToast(actions.toast);
  if (actions.flash) window.widget.flashTaskbar();
}

/**
 * 処理中の行だけ、セッション名に光の帯を重ねる。帯の窓と中の文字を逆向きに動かし、文字は止まって見える。
 * 描き直すたびに作り直すと動きが最初に戻るので、処理中になったときに作り、処理中でなくなったら外す
 */
function setShine(refs: RowRefs, s: SessionView) {
  const on = s.state === 'busy';
  if (on && !refs.shine) {
    const el = document.createElement('span');
    el.className = 'shine';
    el.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'shine-text';
    el.append(text);
    refs.title.append(el);
    refs.shine = { el, text };
  } else if (!on && refs.shine) {
    refs.shine.el.remove();
    refs.shine = undefined;
  }
  if (refs.shine && refs.shine.text.textContent !== s.title) refs.shine.text.textContent = s.title;
}

/**
 * 押して保留を切り替えるアイコン（行の状態の印、カードのブランチの印）。乗せたときの印（alt）は、保留なら circle-play、そうでなければ circle-pause。
 * can が false（処理中・対応待ち）のときは押せず、乗せても変えない
 */
function setToggle(el: HTMLElement, alt: HTMLElement, held: boolean, can: boolean) {
  setIcon(alt, held ? 'circle-play' : 'circle-pause');
  el.toggleAttribute('data-can', can);
  el.toggleAttribute('data-held', held);
  if (can) {
    el.dataset.tip = held ? ja.widget.holdOff : ja.widget.holdOn;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', el.dataset.tip);
  } else {
    delete el.dataset.tip;
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }
}

/**
 * 状態の札の中の、タスクリストの棒（docs/design/widget-app-plan.md の表示ルール）。手順ごとに 1 本、状態は data-step に入れる。
 * 手順の名前は出さず、「手順 2/3」の文を aria-label にする（ツールチップは行のものに入れる）
 */
function setPlan(el: HTMLElement, steps: readonly PlanStep[] | undefined) {
  const key = steps?.join(',') ?? '';
  if (el.dataset.steps === key) return;
  el.dataset.steps = key;
  el.hidden = !steps;
  if (!steps) {
    el.replaceChildren();
    el.removeAttribute('aria-label');
    return;
  }
  el.setAttribute('aria-label', planLabel(steps));
  el.replaceChildren(...steps.map((step) => {
    const bar = document.createElement('span');
    bar.className = 'plan-step';
    bar.dataset.step = step;
    return bar;
  }));
}

function getRow(s: SessionView): RowRefs {
  let refs = rows.get(s.id);
  if (!refs) {
    const el = clone<HTMLLIElement>(rowTemplate);
    const title = el.querySelector<HTMLElement>('.title')!;
    const titleText = document.createTextNode('');
    title.append(titleText);
    const id = s.id;
    const status = el.querySelector<HTMLElement>('.status')!;
    const meta = el.querySelector<HTMLElement>('.meta')!;
    const memoEl = el.querySelector<HTMLElement>('.memo')!;
    refs = {
      el,
      status,
      statusNow: status.querySelector('.now')!,
      statusAlt: status.querySelector('.alt')!,
      memoEl,
      memo: createMemo(memoEl, { bound: () => meta, onCommit: (note) => commitNote(id, note), onEditing: onMemoEditing }),
      title,
      titleText,
      when: el.querySelector('.when')!,
      ctx: el.querySelector('.ctx')!,
      ctxFill: el.querySelector('.ctx-fill')!,
      ctxNum: el.querySelector('.ctx-num')!,
      pill: el.querySelector('.state-pill')!,
      pillText: el.querySelector('.pill-text')!,
      plan: el.querySelector('.plan')!,
      act: el.querySelector('.act')!,
    };
    el.addEventListener('click', () => openRow(id));
    // ホイールクリックで、トグルと同じ処理を呼ぶ。mousedown で既定の動き（オートスクロール）を止める
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const state = rows.get(id)?.data?.state;
      if (state && canToggleArchive(state, false)) toggleArchive(id);
    });
    // 状態のアイコンの押下は行へ伝えない（伝えるとセッションが開く）
    status.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHold(id);
    });
    refs.act.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleArchive(id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openRow(id);
    });
    // 右クリックで、ID をコピーするメニューを出す（メニューはメインプロセスが出す）。カードの見出しのメニューへは伝えない
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.widget.showSessionMenu(id);
    });
    rows.set(s.id, refs);
  }
  const prev = refs.data;
  // 保留の行は、状態の印を circle-pause にし、2 行目を「保留」とメモの枠にする（処理中・対応待ちになったら外れる）
  const hold = isRunning(s) ? undefined : holds[s.id];
  // 停止中は待機中と同じに見せ、中断だけを stopped として描く（displayState）
  const shown = displayState(s);
  if (hold) setIcon(refs.statusNow, 'circle-pause');
  else setStatus(refs.statusNow, statusIconName(shown, s.waitingFor, s.background));
  setToggle(refs.status, refs.statusAlt, !!hold, !isRunning(s));
  if (refs.el.dataset.state !== shown) refs.el.dataset.state = shown;
  refs.el.toggleAttribute('data-held', !!hold);
  refs.el.toggleAttribute('data-background', !hold && hasBackground(s.state, s.background));
  refs.el.toggleAttribute('data-attention', attention.has(s.id));
  refs.act.dataset.tip = ja.widget.archiveTip;
  if (prev?.title !== s.title) refs.titleText.data = s.title;
  setShine(refs, s);
  const label = hold ? ja.state.held : stateLabel(shown, s.waitingFor, s.background);
  if (refs.pillText.textContent !== label) refs.pillText.textContent = label;
  setPlan(refs.plan, hold ? undefined : planSteps(s));
  if (prev?.lastActivityAt !== s.lastActivityAt) refs.when.textContent = formatAgo(s.lastActivityAt);
  const ctx = contextLabel(s.context);
  if (refs.ctxNum.textContent !== ctx) refs.ctxNum.textContent = ctx;
  refs.ctx.hidden = !ctx;
  refs.ctx.dataset.level = contextLevel(s.context);
  // 割合がわからない（窓の大きさがわからないモデル）ときは、バーを出さずトークン数だけ
  const pct = contextPercent(s.context);
  refs.ctx.toggleAttribute('data-raw', pct === undefined);
  refs.ctxFill.style.width = `${Math.min(100, pct ?? 0)}%`;
  refs.memoEl.hidden = !hold && !refs.memo.editing;
  if (hold) refs.memo.set(hold.note);
  refs.el.dataset.tip = tooltip(s, hold);
  refs.data = s;
  return refs;
}

// ---- コミットされていない変更と、元のブランチとの差 ----

/** 見出しの内訳の印（変更、未追跡、push していないコミット、元のブランチからの遅れ）。何もなければ隠す */
function setChanges(el: HTMLElement, c: GitChanges | undefined, base?: string) {
  const items = changeItems(c);
  // 毎回作り直さないよう、内訳が変わったときだけ描き直す
  const key = `${items.map((i) => `${i.icon}:${i.count}`).join(',')}|${base ?? ''}`;
  if (el.dataset.items === key) return;
  el.dataset.items = key;
  el.hidden = items.length === 0;
  el.replaceChildren(...items.map((i) => {
    const item = document.createElement('span');
    item.className = 'changes-item';
    item.append(createIcon(i.icon));
    if (i.count) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(i.count);
      item.append(n);
    }
    return item;
  }));
  if (items.length) el.dataset.tip = changesTooltip(c, base);
  else delete el.dataset.tip;
}

// ---- めくれと一覧（flyout） ----

function flyItem(t: TimelineItem): FlyItem {
  const s = t.session;
  const ago = formatAgo(s.lastActivityAt);
  return {
    id: s.id,
    title: s.title,
    state: displayState(s),
    waitingFor: s.waitingFor,
    ...(s.background && { background: s.background }),
    archived: t.archived,
    held: !t.archived && !isRunning(s) && !!holds[s.id],
    origin: t.origin,
    focused: s.id === resolveFocus(latest, pendingFocus).id,
    link: t.link,
    place: t.place,
    sub: ago,
    summary: s.summary,
  };
}

function cardContent(card: WorktreeCard): FlyContent {
  if (card.isMain) return { kind: 'plain', items: card.timeline.map(flyItem) };
  return { kind: 'timeline', items: card.timeline.map(flyItem), ...(card.base && { base: { branch: card.base.branch, tip: card.base.tip, ...(card.mergedInto && { mergedInto: card.mergedInto }) } }) };
}

function repoContent(repo: RepoView): FlyContent {
  return {
    kind: 'cards',
    cards: repo.hiddenCards.map((c) => ({
      key: c.key,
      label: c.label,
      merged: c.merged,
      ...(c.mergedInto && { mergedInto: c.mergedInto }),
      items: [...c.sessions, ...c.archived].map((session) => flyItem({ session, archived: true, origin: false })),
    })),
  };
}

function rectOf(el: Element) {
  const { x, y, width, height } = el.getBoundingClientRect();
  return { x, y, width, height };
}

/** ウィジェットを置いた端 */
function edgeOf(): 'left' | 'right' {
  return document.documentElement.dataset.edge === 'left' ? 'left' : 'right';
}

/** めくれ（つまみ）が飛び出す所。ウィジェットの外へはみ出すこともある */
function tabOf(refs: CardRefs) {
  return flapRect(edgeOf(), rectOf(refs.card));
}

/**
 * カードの一覧を開けるか。以前のセッション（重なり）があるときと、分岐元が元のフォルダのブランチと違うとき。
 * 後のほうは重なりを出さず、見出しに乗せたときだけめくれを出す（めくれには件数の代わりにブランチのアイコン）
 */
function canFly(card: WorktreeCard | undefined): card is WorktreeCard {
  return !!card && (card.stackCount > 0 || !!card.base?.offMain);
}

function showCardFlyout(key: string, open: boolean, hold?: number) {
  const refs = cards.get(key);
  const card = refs?.data;
  if (!refs || !canFly(card)) return;
  window.widget.showFlyout({ key, count: card.stackCount, anchor: rectOf(refs.card), hit: rectOf(refs.stackHit), tab: tabOf(refs), header: rectOf(refs.header), content: cardContent(card), open, hold });
}

/** アーカイブしたことを知らせるめくれを、カーソルが離れていても出しておく長さ */
const ANNOUNCE_HOLD_MS = 900;
/** 行が消えてカードが縮む動き（flip.ts、0.22 秒）が終わってから、めくれを伸ばす */
const ANNOUNCE_DELAY_MS = 240;
let announceTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * セッションをアーカイブしたら、入った先のカードの重なりから、乗せたときと同じめくれを伸ばして見せる。
 * 動きを減らす設定のときと、一覧を開いているとき（一覧の中でアーカイブした）は何もしない
 */
function announceArchived(id: string) {
  clearTimeout(announceTimer);
  if (!motionEnabled() || flyOpen) return;
  announceTimer = setTimeout(() => {
    if (flyOpen) return;
    for (const [key, refs] of cards) {
      const card = refs.data;
      if (!card || !refs.el.isConnected || !card.timeline.some((t) => t.session.id === id && t.archived)) continue;
      // カードが一覧の見えている所から外れていたら出さない（めくれがタイトルバーなどにかかるため）
      const view = cardsEl.getBoundingClientRect();
      const tab = tabOf(refs);
      if (tab.y < view.top || tab.y + tab.height > view.bottom) return;
      // すでにこのカードのめくれを出しているなら、そのままにする
      if (flyKey !== key) showCardFlyout(key, false, ANNOUNCE_HOLD_MS);
      return;
    }
  }, ANNOUNCE_DELAY_MS);
}

/**
 * めくれが飛び出す所をメインプロセスへ知らせる。ウィジェットの外へはみ出す所はウィジェットの画面からは見えないので、
 * メインプロセスがカーソルを見て、入ったら知らせてくる（onFlyHover）。一覧の見えている所にあるカードだけ。
 * カードが動く動き（flip.ts、0.22 秒）が終わってから測る
 */
let targetsTimer: ReturnType<typeof setTimeout> | undefined;
function reportTargets() {
  clearTimeout(targetsTimer);
  targetsTimer = setTimeout(() => {
    const view = cardsEl.getBoundingClientRect();
    const targets = [];
    for (const [key, refs] of cards) {
      // 重なりのないカード（分岐元だけで開けるもの）は、見出しに乗せたときだけ出すので入れない
      if (!refs.data?.stackCount || !refs.el.isConnected) continue;
      const zone = tabOf(refs);
      if (zone.y + zone.height <= view.top || zone.y >= view.bottom) continue;
      const top = Math.max(zone.y, view.top);
      targets.push({ key, zone: { ...zone, y: top, height: Math.min(zone.y + zone.height, view.bottom) - top } });
    }
    window.widget.setFlyTargets(targets);
  }, 250);
}

function showRepoFlyout(repoKey: string) {
  const refs = repos.get(repoKey);
  const repo = refs?.data;
  if (!refs || !repo || !repo.hiddenCards.length) return;
  const key = `repo:${repoKey}`;
  if (flyKey === key && flyOpen) return;
  window.widget.showFlyout({ key, count: repo.hiddenCards.length, anchor: rectOf(refs.header), hit: rectOf(refs.archived), content: repoContent(repo), open: true });
}

/** 出しているめくれ・一覧の中身を、描き直したものに合わせる。中身がなくなったら閉じる */
function updateFlyout() {
  if (!flyKey) return;
  if (flyKey.startsWith('repo:')) {
    const repo = lastRepos.find((r) => `repo:${r.key}` === flyKey);
    if (repo) window.widget.updateFlyout(flyKey, repoContent(repo), repo.hiddenCards.length);
    return;
  }
  const card = cards.get(flyKey)?.data;
  if (card) window.widget.updateFlyout(flyKey, cardContent(card), card.stackCount);
}

function onFlyAction(action: FlyAction) {
  if (action.type === 'open') openRow(action.id);
  else if (action.type === 'toggle') toggleArchive(action.id);
  else toggleCard(action.key);
}

// ---- リポジトリとカード ----

function getRepo(repo: RepoView): RepoRefs {
  let refs = repos.get(repo.key);
  if (!refs) {
    const el = clone<HTMLElement>(repoTemplate);
    refs = {
      el,
      header: el.querySelector('.repo-header')!,
      name: el.querySelector('.repo-name')!,
      archived: el.querySelector('.repo-archived')!,
      archivedCount: el.querySelector('.repo-archived .n')!,
      badge: el.querySelector('.badge')!,
      cards: el.querySelector('.repo-cards')!,
    };
    const key = repo.key;
    refs.archived.addEventListener('click', () => showRepoFlyout(key));
    repos.set(repo.key, refs);
  }
  refs.name.textContent = repo.name;
  refs.badge.dataset.state = repo.badge.state;
  refs.badge.textContent = repo.badge.text;
  const n = repo.hiddenCards.length;
  refs.archived.hidden = n === 0;
  refs.archivedCount.textContent = String(n);
  refs.archived.dataset.tip = ja.widget.archivedCount(n);
  refs.archived.setAttribute('aria-label', refs.archived.dataset.tip);
  refs.data = repo;
  return refs;
}

function getCard(card: WorktreeCard, sync = true): CardRefs {
  let refs = cards.get(card.key);
  if (!refs) {
    const el = clone<HTMLElement>(cardTemplate);
    const key = card.key;
    const icon = el.querySelector<HTMLElement>('.card-icon')!;
    const hold = el.querySelector<HTMLElement>('.card-hold')!;
    refs = {
      el,
      card: el.querySelector('.card')!,
      stackHit: el.querySelector('.stack-hit')!,
      header: el.querySelector('.card-header')!,
      icon,
      iconNow: icon.querySelector('.now')!,
      iconAlt: icon.querySelector('.alt')!,
      label: el.querySelector('.card-label')!,
      changes: el.querySelector('.changes')!,
      act: el.querySelector('.card-act')!,
      hold,
      memo: createMemo(hold.querySelector('.memo')!, { bound: () => hold, onCommit: (note) => commitCardNote(key, note), onEditing: onMemoEditing }),
      rows: el.querySelector('.rows')!,
    };
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCardHold(key);
    });
    // 重なりの的に乗せたらめくれを出す。消すのはメインプロセス（カーソルが的とめくれのどちらからも外れたとき）。
    // 的の上で動いている間にめくれが消えていたら（一覧を閉じたあとなど）、出し直す
    refs.stackHit.addEventListener('pointerenter', () => showCardFlyout(key, false));
    refs.stackHit.addEventListener('pointermove', () => {
      if (flyKey !== key) showCardFlyout(key, false);
    });
    // めくれが出る前に押したときは、すぐ一覧を開く
    refs.stackHit.addEventListener('click', () => showCardFlyout(key, true));
    // カードの見出し（タイトルバー）に乗せている間も、めくれを出しておく。消すのは重なりの的と同じくメインプロセス
    refs.header.addEventListener('pointerenter', () => showCardFlyout(key, false));
    refs.header.addEventListener('pointermove', () => {
      if (flyKey !== key) showCardFlyout(key, false);
    });
    refs.act.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCard(key);
    });
    // 見出しの右クリックで、作業フォルダを開くメニューを出す（メニューはメインプロセスが出す）
    refs.header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.widget.showCardMenu(key);
    });
    cards.set(card.key, refs);
  }
  const running = card.sessions.some(isRunning);
  setIcon(refs.iconNow, card.held ? 'circle-pause' : card.isMain ? 'house' : 'git-branch');
  // 元のフォルダのカードは保留にしない（ワークツリーごと止めるためのもの）
  setToggle(refs.icon, refs.iconAlt, !!card.held, !card.isMain && !running);
  refs.el.toggleAttribute('data-held', !!card.held);
  refs.label.textContent = card.label;
  refs.header.dataset.tip = card.held ? `${card.tooltip}\n${holdTooltip(card.held)}` : card.tooltip;
  // 動いている（処理中・対応待ちの）セッションがあるカードと保留のカードはアーカイブできないので、トグルを出さない
  refs.act.hidden = card.isMain || running || !!card.held;
  refs.hold.hidden = !card.held && !refs.memo.editing;
  if (card.held) refs.memo.set(card.held.note);
  setChanges(refs.changes, showChanges ? card.changes : undefined, card.base?.branch);
  refs.el.toggleAttribute('data-stack', card.stackCount > 0);
  refs.stackHit.dataset.count = String(card.stackCount);
  if (sync) syncChildren(refs.rows, card.sessions.map((s) => getRow(s).el));
  else for (const s of card.sessions) if (rows.has(s.id)) getRow(s);
  refs.data = card;
  return refs;
}

function renderRepo(repo: RepoView): HTMLElement {
  const refs = getRepo(repo);
  syncChildren(refs.cards, repo.cards.map((c) => getCard(c).el));
  return refs.el;
}

/** 並べ替えで動かす要素。親（リポジトリ）を子より先に */
function* animatedElements(): Iterable<HTMLElement> {
  for (const r of repos.values()) yield r.el;
  for (const c of cards.values()) yield c.el;
  for (const r of rows.values()) yield r.el;
}

function render(sessions: SessionView[]) {
  latest = sessions;
  const flaggedBefore = new Set(attention);
  const fresh = updateAttention(sessions);
  releaseHolds(sessions);
  // 保留の行は「完了したとき」を知らせない
  const alerts = fresh.filter((a) => a.reason !== 'done' || !holdOf(a.id));
  if (primed && alerts.length) queueAlerts(alerts);
  reviveMarks(sessions);
  // 起動して最初の一覧では、確認した時刻の種を入れる（再起動で猶予が消えないように）
  if (!primed) for (const [id, at] of startupConfirmedAt(sessions)) if (!confirmedAt.has(id)) confirmedAt.set(id, at);
  const list = buildRepos(sessions, archiveOptions());
  lastRepos = list;
  // リモートの取得は、アーカイブしていない（出している）カードのあるリポジトリだけにする（docs/design/git-fetch.md）
  const shownCards = list.flatMap((r) => r.cards.map((c) => c.key)).sort();
  if (JSON.stringify(shownCards) !== sentFetchCards) {
    sentFetchCards = JSON.stringify(shownCards);
    window.widget.setFetchCards(shownCards);
  }
  if (editingMemos) {
    // メモの入力中は、並びを変えずに中身だけを書き換える（入力欄を動かすとフォーカスが外れる）。並べ替えは入力を終えてから
    for (const repo of list) {
      if (repos.has(repo.key)) getRepo(repo);
      for (const card of repo.cards) if (cards.has(card.key)) getCard(card, false);
    }
  } else {
    // 並びが変わった行・カード・見出しを、前の位置からすべらせる
    flip(animatedElements, () => {
      syncChildren(cardsEl, list.map(renderRepo));
    });
  }
  // 新しく未確認になった行に、光を一度だけ横切らせる（並べ替えの動きが終わってから）
  for (const id of newlyFlagged(flaggedBefore, attention, primed)) {
    const refs = rows.get(id);
    if (refs) void sweep(refs.el);
  }

  // なくなったものは捨てる
  const ids = new Set(sessions.map((s) => s.id));
  for (const [id, refs] of rows) if (!ids.has(id) || !refs.el.isConnected) rows.delete(id);
  for (const id of attention) if (!ids.has(id)) attention.delete(id);
  for (const id of revived) if (!ids.has(id)) revived.delete(id);
  for (const map of [seenState, seenFocusedAt, confirmedAt] as Map<string, unknown>[]) {
    for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  }
  for (const [key, refs] of cards) if (!refs.el.isConnected) cards.delete(key);
  for (const [key, refs] of repos) if (!refs.el.isConnected) repos.delete(key);
  // HTML ビューアは、今開いているセッションの作業フォルダのファイルを出す
  viewer.setTarget(applyFocus());
  updateFlyout();
  reportTargets();
  tooltips.prune();
  startPendingMemo();
}

/** 保留にしている（そのセッションか、そのカード） */
function holdOf(id: string): boolean {
  const s = latest.find((x) => x.id === id);
  return !!s && isHeld(s, { holds, heldCards });
}

/** 保留にした直後の行（カード）のメモを、入力の状態にする */
function startPendingMemo() {
  const target = pendingMemo;
  if (!target || editingMemos) return;
  pendingMemo = undefined;
  const memo = target.startsWith('s:') ? rows.get(target.slice(2))?.memo : cards.get(target.slice(2))?.memo;
  memo?.start();
}

// ---- 画面の操作 ----

// 「◯分前」と main の自動アーカイブのために、1 分に 1 回だけ描き直す（変わったところだけを書き換える）
setInterval(() => {
  for (const refs of rows.values()) {
    if (refs.data) refs.when.textContent = formatAgo(refs.data.lastActivityAt);
  }
  render(latest);
}, 60_000);

// 見えていないときはアニメーションを止める
const updatePaused = () => document.documentElement.classList.toggle('paused', document.hidden);
document.addEventListener('visibilitychange', updatePaused);
updatePaused();

document.getElementById('settings')!.addEventListener('click', () => window.widget.openSettings());

// タイトルの右クリックで、アプリを終了するメニューを出す
document.querySelector('.titlebar')!.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.widget.showTitleMenu();
});

// 最前面への固定。押した見た目はすぐ変え、保存された値が onLayout で戻ってきたらそれに合わせる
const pinButton = document.getElementById('pin')!;
let pinned = true;
function showPinned(value: boolean) {
  pinned = value;
  // アイランド型の角丸のつなぎ方を変える（固定している間だけ、画面の上下に縁取りの線がある）
  document.documentElement.classList.toggle('pinned', value);
  pinButton.setAttribute('aria-pressed', String(pinned));
  pinButton.dataset.tip = pinned ? ja.widget.pinned : ja.widget.pin;
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

// 背景が 0% のときは、リポジトリの枠やタイトルバーのない所のクリックを後ろのウィンドウへ通す。
// アイランド型のときは、帯（body）の外の透明なところ（内側の角丸の分の細い列）だけを通す。そこではポインターの的が html になる
let floating = false;
let island = false;
let clickThrough = false;
function setClickThrough(value: boolean) {
  if (value === clickThrough) return;
  clickThrough = value;
  window.widget.setClickThrough(value);
}
document.addEventListener('mousemove', (e) => {
  if (island) {
    setClickThrough(e.target === document.documentElement);
    return;
  }
  if (!floating) return;
  const solid = (e.target as Element).closest('.repo, .titlebar, .resize-handle, .stack-hit, .viewer, .switcher');
  setClickThrough(!solid);
});

// スクロールするとカードの位置がずれるので、めくれと一覧を消す
cardsEl.addEventListener('scroll', () => {
  if (flyKey) window.widget.leaveFlyout(flyKey);
  reportTargets();
});
new ResizeObserver(() => reportTargets()).observe(cardsEl);
// ウィジェットの外で、重なりに反応する範囲にカーソルが入った
window.widget.onFlyHover((key) => {
  if (flyKey !== key) showCardFlyout(key, false);
});

function applyLayout(layout: WidgetLayout) {
  const { edge, backgroundOpacity, cardOpacity, pinned } = layout;
  showPinned(pinned);
  sort = { project: layout.projectOrder, worktree: layout.worktreeOrder, session: layout.sessionOrder };
  marks = { ...layout.archive };
  cardMarks = { ...layout.archivedCards };
  holds = { ...layout.holds };
  heldCards = { ...layout.heldCards };
  mainMinutes = layout.mainArchiveMinutes;
  showChanges = layout.showChanges;
  tooltips.setDelay(layout.tooltipDelayMs);
  const { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen } = layout;
  notify = { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen };
  render(latest);
  const root = document.documentElement;
  root.dataset.edge = edge;
  viewer.applyLayout(layout);
  reportTargets();
  root.style.setProperty('--bg-alpha', String(backgroundOpacity / 100));
  root.style.setProperty('--card-alpha', String(cardOpacity / 100));
  root.style.setProperty('--header-alpha', String(layout.headerShade / 100));
  root.style.setProperty('--row-pad', `${layout.rowPadding}px`);
  root.style.setProperty('--fillet', `${layout.islandRadius}px`);
  root.style.setProperty('--edge-cover', `${layout.islandLine}px`);
  applyStatusColors(layout.statusColors);
  applyHighlight(layout.activeHighlight);
  applyMotion(layout.motion);
  root.classList.toggle('hide-updated', !layout.showUpdated);
  root.classList.toggle('hide-state', !layout.showState);
  root.classList.toggle('hide-context', !layout.showContext);
  root.classList.toggle('hide-system-usage', !layout.showSystemUsage);
  root.classList.toggle('hide-switcher', !layout.showWindowSwitcher);
  island = layout.island;
  root.classList.toggle('island', island);
  floating = !island && backgroundOpacity === 0;
  root.classList.toggle('floating', floating);
  if (!floating && !island) clickThrough = false;
}
window.widget.onLayout(applyLayout);
initSystemUsage();
window.widget.getLayout().then(applyLayout);
window.widget.onSessions((sessions) => {
  render(sessions);
  primed = true;
});
window.widget.onCycle(openNext);
// トーストのクリックも、行のクリックと同じく帯を消してから開く
window.widget.onToastClick((id) => openRow(id));
window.widget.onFlyAction(onFlyAction);
window.widget.onFlyState((key, open) => {
  flyKey = key;
  flyOpen = open;
  // めくれを出している間は、そのカードの重なりを濃くする。一覧を開いている間は、重なりが飛び出して一覧になったものとして隠す
  for (const [k, refs] of cards) {
    refs.el.toggleAttribute('data-fly', k === key);
    refs.el.toggleAttribute('data-fly-open', k === key && open);
  }
});
