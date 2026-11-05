// サイドバーの描画。リポジトリごとの見出しの下に、ワークツリー（元のフォルダを含む）ごとのカードを並べる。
// 使い終わったセッションは Bantus の中だけでアーカイブして隠し、カードの後ろの重なりから一覧（別のウィンドウ）で見る
// （docs/design/worktree-cards.md）。
// 行・カード・見出しの要素は使い回し、並びが変わったところだけを動かす（アニメーションを途切れさせない）。

import type { ArchiveMark } from '../shared/settings';
import type { FlyAction, FlyContent, FlyItem, GitChanges, SessionView, WidgetLayout } from '../shared/types';
import {
  PENDING_FOCUS_MS,
  PRIORITY_SORT,
  alertActions,
  alertDelay,
  attentionReason,
  buildRepos,
  changeItems,
  changesTooltip,
  formatAgo,
  hasAlertOutput,
  mergeAlerts,
  newlyFlagged,
  nextAttention,
  openedInClaude,
  pickAlerts,
  revivedCards,
  revivedSessions,
  shortcutTarget,
  resolveFocus,
  statusIconName,
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
import { flip } from './flip.js';
import { createIcon, fillIcons, setIcon } from './icon.js';
import { playSound } from './sound.js';
import { setStatus } from './status-icon.js';
import { sweep } from './sweep.js';
import { initTooltips } from './tooltip.js';

interface RowRefs {
  el: HTMLLIElement;
  status: HTMLElement;
  title: HTMLElement;
  /** セッション名の文字。光の帯（.shine）と並べるので、.title の textContent ではなくこれを書き換える */
  titleText: Text;
  /** 処理中の間だけ .title に重ねる光の帯と、その中の明るい文字 */
  shine?: { el: HTMLElement; text: HTMLElement };
  when: HTMLElement;
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
  icon: HTMLElement;
  label: HTMLElement;
  changes: HTMLElement;
  act: HTMLElement;
  rows: HTMLUListElement;
  data?: WorktreeCard;
}

const cardsEl = document.getElementById('cards')!;
const rowTemplate = document.getElementById('row-template') as HTMLTemplateElement;
const cardTemplate = document.getElementById('card-template') as HTMLTemplateElement;
const repoTemplate = document.getElementById('repo-template') as HTMLTemplateElement;
fillIcons(document);
const tooltips = initTooltips();

const rows = new Map<string, RowRefs>();
const cards = new Map<string, CardRefs>();
const repos = new Map<string, RepoRefs>();
/** 未確認（左端の帯を出す）セッションの ID と、それを決めるために覚えておく前の状態 */
const attention = new Set<string>();
const seenState = new Map<string, SessionView['state']>();
/** 前に見た、Claude 本体で最後に開いた時刻。進んだら本体で開いたものとして帯を消す */
const seenFocusedAt = new Map<string, number>();
/** 帯が消えた（確認した）時刻。main の自動アーカイブを数え始める時刻に使う。ウィジェットの中だけで覚える */
const confirmedAt = new Map<string, number>();
/** 一覧の設定（onLayout で届く）。アーカイブの印は、押したときにすぐ変え、保存された値が戻ってきたらそれに合わせる */
let sort: SortOptions = PRIORITY_SORT;
let marks: Record<string, ArchiveMark> = {};
let cardMarks: Record<string, ArchiveMark> = {};
let mainMinutes = 10;
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
  return { marks, cardMarks, attention, confirmedAt, mainMinutes, now: Date.now(), sort };
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
  setMark(id, archive ? 'archived' : 'shown');
  render(latest);
}

function toggleCard(key: string) {
  const card = lastRepos.flatMap((r) => [...r.cards, ...r.hiddenCards]).find((c) => c.key === key);
  if (!card) return;
  setCardMark(key, card.hidden ? 'shown' : 'archived');
  render(latest);
}

/** 手でアーカイブしたのに動き出したものは、印を外して自動の決まりに戻す */
function reviveMarks(sessions: SessionView[]) {
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
  const id = shortcutTarget(latest, attention, applyFocus(), claudeInFront, archiveOptions());
  if (id) openRow(id);
}

function openRow(id: string) {
  const refs = rows.get(id);
  if (refs) setAttention(refs, id, false);
  else clearAttention(id);
  // ファイルに書かれるのを待たずに、クリックした行へすぐ移す。反映されないまま時間が過ぎたら、ファイルの値に戻す
  pendingFocus = { id, until: Date.now() + PENDING_FOCUS_MS };
  clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => render(latest), PENDING_FOCUS_MS);
  render(latest);
  window.widget.openSession(id);
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
    if (prev !== s.state) {
      if (nextAttention(prev, s.state, attention.has(s.id))) attention.add(s.id);
      else clearAttention(s.id);
      const reason = attentionReason(prev, s.state);
      if (reason) fresh.push({ id: s.id, reason });
      seenState.set(s.id, s.state);
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

function getRow(s: SessionView): RowRefs {
  let refs = rows.get(s.id);
  if (!refs) {
    const el = clone<HTMLLIElement>(rowTemplate);
    const title = el.querySelector<HTMLElement>('.title')!;
    const titleText = document.createTextNode('');
    title.append(titleText);
    refs = {
      el,
      status: el.querySelector('.status')!,
      title,
      titleText,
      when: el.querySelector('.when')!,
      act: el.querySelector('.act')!,
    };
    const id = s.id;
    el.addEventListener('click', () => openRow(id));
    refs.act.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleArchive(id);
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
  refs.act.dataset.tip = 'アーカイブ（Bantus の中だけ）';
  if (prev?.title !== s.title) refs.titleText.data = s.title;
  setShine(refs, s);
  if (prev?.lastActivityAt !== s.lastActivityAt) refs.when.textContent = formatAgo(s.lastActivityAt);
  refs.el.dataset.tip = tooltip(s);
  refs.data = s;
  return refs;
}

// ---- コミットされていない変更と、元のブランチとの差 ----

/** 見出しの内訳の印（変更、未追跡、push していないコミット、元のブランチからの遅れ）。何もなければ隠す */
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
    item.append(createIcon(i.icon));
    if (i.count) item.append(String(i.count));
    return item;
  }));
  if (items.length) el.dataset.tip = changesTooltip(c);
  else delete el.dataset.tip;
}

// ---- めくれと一覧（flyout） ----

function flyItem(t: TimelineItem): FlyItem {
  const s = t.session;
  const ago = formatAgo(s.lastActivityAt);
  return {
    id: s.id,
    title: s.title,
    state: s.state,
    waitingFor: s.waitingFor,
    archived: t.archived,
    origin: t.origin,
    focused: s.id === resolveFocus(latest, pendingFocus).id,
    link: t.link,
    sub: t.origin ? ['main', ago].filter(Boolean).join(' · ') : ago,
    summary: s.summary,
  };
}

function cardContent(card: WorktreeCard): FlyContent {
  return { kind: card.isMain ? 'plain' : 'timeline', items: card.timeline.map(flyItem) };
}

function repoContent(repo: RepoView): FlyContent {
  return {
    kind: 'cards',
    cards: repo.hiddenCards.map((c) => ({
      key: c.key,
      label: c.label,
      merged: c.merged,
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

function showCardFlyout(key: string, open: boolean) {
  const refs = cards.get(key);
  const card = refs?.data;
  if (!refs || !card || !card.stackCount) return;
  window.widget.showFlyout({ key, count: card.stackCount, anchor: rectOf(refs.card), hit: rectOf(refs.stackHit), tab: tabOf(refs), content: cardContent(card), open });
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
  refs.archived.dataset.tip = `アーカイブした作業 ${n} 件（マージ済みなど）`;
  refs.archived.setAttribute('aria-label', refs.archived.dataset.tip);
  refs.data = repo;
  return refs;
}

function getCard(card: WorktreeCard): CardRefs {
  let refs = cards.get(card.key);
  if (!refs) {
    const el = clone<HTMLElement>(cardTemplate);
    refs = {
      el,
      card: el.querySelector('.card')!,
      stackHit: el.querySelector('.stack-hit')!,
      header: el.querySelector('.card-header')!,
      icon: el.querySelector('.card-icon')!,
      label: el.querySelector('.card-label')!,
      changes: el.querySelector('.changes')!,
      act: el.querySelector('.card-act')!,
      rows: el.querySelector('.rows')!,
    };
    const key = card.key;
    // 重なりの的に乗せたらめくれを出す。消すのはメインプロセス（カーソルが的とめくれのどちらからも外れたとき）。
    // 的の上で動いている間にめくれが消えていたら（一覧を閉じたあとなど）、出し直す
    refs.stackHit.addEventListener('pointerenter', () => showCardFlyout(key, false));
    refs.stackHit.addEventListener('pointermove', () => {
      if (flyKey !== key) showCardFlyout(key, false);
    });
    // めくれが出る前に押したときは、すぐ一覧を開く
    refs.stackHit.addEventListener('click', () => showCardFlyout(key, true));
    refs.act.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCard(key);
    });
    cards.set(card.key, refs);
  }
  setIcon(refs.icon, card.isMain ? 'house' : 'git-branch');
  refs.label.textContent = card.label;
  refs.header.dataset.tip = card.tooltip;
  // 動いている（処理中・対応待ちの）セッションがあるカードはアーカイブできないので、トグルを出さない
  refs.act.hidden = card.isMain || card.sessions.some((s) => s.state === 'busy' || s.state === 'waiting');
  setChanges(refs.changes, card.changes);
  refs.el.toggleAttribute('data-stack', card.stackCount > 0);
  refs.stackHit.dataset.count = String(card.stackCount);
  syncChildren(refs.rows, card.sessions.map((s) => getRow(s).el));
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
  if (primed && fresh.length) queueAlerts(fresh);
  reviveMarks(sessions);
  const list = buildRepos(sessions, archiveOptions());
  lastRepos = list;
  // 並びが変わった行・カード・見出しを、前の位置からすべらせる
  flip(animatedElements, () => {
    syncChildren(cardsEl, list.map(renderRepo));
  });
  // 新しく未確認になった行に、光を一度だけ横切らせる（並べ替えの動きが終わってから）
  for (const id of newlyFlagged(flaggedBefore, attention, primed)) {
    const refs = rows.get(id);
    if (refs) void sweep(refs.el);
  }

  // なくなったものは捨てる
  const ids = new Set(sessions.map((s) => s.id));
  for (const [id, refs] of rows) if (!ids.has(id) || !refs.el.isConnected) rows.delete(id);
  for (const id of attention) if (!ids.has(id)) attention.delete(id);
  for (const map of [seenState, seenFocusedAt, confirmedAt] as Map<string, unknown>[]) {
    for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  }
  for (const [key, refs] of cards) if (!refs.el.isConnected) cards.delete(key);
  for (const [key, refs] of repos) if (!refs.el.isConnected) repos.delete(key);
  applyFocus();
  updateFlyout();
  reportTargets();
  tooltips.prune();
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
  const solid = (e.target as Element).closest('.card, .titlebar, .resize-handle, .stack-hit, .repo-header');
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
  mainMinutes = layout.mainArchiveMinutes;
  const { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen } = layout;
  notify = { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen };
  render(latest);
  const root = document.documentElement;
  root.dataset.edge = edge;
  reportTargets();
  root.style.setProperty('--bg-alpha', String(backgroundOpacity / 100));
  root.style.setProperty('--card-alpha', String(cardOpacity / 100));
  root.style.setProperty('--header-alpha', String(layout.headerShade / 100));
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
