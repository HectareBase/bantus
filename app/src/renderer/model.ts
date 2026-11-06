// 画面に出す形への組み立て（リポジトリ、ワークツリーのカード、アーカイブ、ツールチップ）。DOM を使わないので、テストから直接呼べる。

import { cardKeyOf } from '../shared/card-key.js';
import type { ArchiveMark, HoldMark, SortOrder } from '../shared/settings';
import type { ContextUsage, FlyPlace, GitChanges, SessionState, SessionView } from '../shared/types';
import type { IconName } from './icons.js';

export const RANK: Record<SessionState, number> = { waiting: 0, busy: 1, idle: 2, stopped: 3 };
/** 並び順の「優先度」での保留の順位。待機と停止中の間 */
export const HELD_RANK = 2.5;
export const WAITING_LABELS: Record<string, string> = {
  'permission prompt': '許可待ち',
  'input needed': '回答待ち',
  'dialog open': '画面を表示中',
  'sandbox request': 'サンドボックスの許可待ち',
  'worker request': 'ワーカーの要求待ち',
  'goal proposal': 'ゴールの確認待ち',
};

function byUrgency(a: { rank: number; latest: number }, b: { rank: number; latest: number }) {
  return a.rank - b.rank || b.latest - a.latest;
}

const collator = new Intl.Collator('ja', { numeric: true });

/**
 * カードと小見出しの比べ方。fixed は名前順（同じ名前なら key）で、first に当てはまるもの（メイン）を先頭にする。
 * recent は最後に動きがあった順、priority は急ぐ順
 */
function compareItems<T extends { key: string; rank: number; latest: number }>(
  order: SortOrder,
  name: (x: T) => string,
  first: (x: T) => boolean = () => false,
) {
  return (a: T, b: T): number => {
    if (order === 'priority') return byUrgency(a, b);
    if (order === 'recent') return b.latest - a.latest;
    if (first(a) !== first(b)) return first(a) ? -1 : 1;
    return collator.compare(name(a), name(b)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  };
}

/** 保留の印。セッションの ID → 印と、カードの目印 → 印 */
export interface HoldOptions {
  holds: Readonly<Record<string, HoldMark>>;
  heldCards: Readonly<Record<string, HoldMark>>;
}

/** 保留の印がない */
export const NO_HOLDS: HoldOptions = { holds: {}, heldCards: {} };

/** 保留にしている（そのセッションか、そのカードに印がある）。処理中・対応待ちのものは保留として扱わない（外す前でも） */
export function isHeld(s: SessionView, holds: HoldOptions): boolean {
  if (s.state === 'busy' || s.state === 'waiting') return false;
  return !!holds.holds[s.id] || !!holds.heldCards[cardKeyOf(s)];
}

/** 並べる順位。保留は待機と停止中の間 */
export function rankOf(s: SessionView, holds: HoldOptions = NO_HOLDS): number {
  return isHeld(s, holds) ? HELD_RANK : RANK[s.state];
}

/** セッションの比べ方。fixed は新しく作ったものが上、recent は最後に動きがあった順、priority は急ぐ順（保留は待機と停止中の間） */
export function compareSessions(order: SortOrder, holds: HoldOptions = NO_HOLDS) {
  return (a: SessionView, b: SessionView): number => {
    if (order === 'fixed') return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    if (order === 'priority') {
      const ra = rankOf(a, holds);
      const rb = rankOf(b, holds);
      if (ra !== rb) return ra - rb;
    }
    return b.lastActivityAt - a.lastActivityAt;
  };
}

/** 保留にしてからの長さ（「保留 2 日」など）。ツールチップに出す */
export function heldFor(since: number, now = Date.now()): string {
  const min = Math.floor((now - since) / 60_000);
  if (min < 1) return '保留したばかり';
  if (min < 60) return `保留 ${min} 分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `保留 ${h} 時間`;
  return `保留 ${Math.floor(h / 24)} 日`;
}

/** 保留の印のツールチップの行。経過と、メモがあればその全文 */
export function holdTooltip(mark: HoldMark, now = Date.now()): string {
  return mark.note ? `${heldFor(mark.since, now)}\n${mark.note}` : heldFor(mark.since, now);
}

// ---- コンテキストの使用量（docs/design/worktree-cards.md） ----

/** 色を変える使用率（%）。ここから「多い」（濃い文字）、CONTEXT_FULL から「残りわずか」（赤） */
export const CONTEXT_HIGH = 50;
export const CONTEXT_FULL = 75;

/** 使用率（%、整数）。窓の大きさがわからなければ undefined */
export function contextPercent(c: ContextUsage | undefined): number | undefined {
  if (!c?.window) return undefined;
  return Math.round((c.tokens / c.window) * 100);
}

/** 色の段階。割合がわからなければ normal */
export function contextLevel(c: ContextUsage | undefined): 'normal' | 'high' | 'full' {
  const pct = contextPercent(c);
  if (pct === undefined || pct < CONTEXT_HIGH) return 'normal';
  return pct < CONTEXT_FULL ? 'high' : 'full';
}

/** 1234 → 1.2k、123456 → 123k、1234567 → 1.2M */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 行の 2 行目に出す文字。割合がわかれば「12%」、わからなければトークン数（「120k tok」）。割合と見分けられるよう単位を付ける */
export function contextLabel(c: ContextUsage | undefined): string {
  if (!c) return '';
  const pct = contextPercent(c);
  return pct === undefined ? `${formatTokens(c.tokens)} tok` : `${pct}%`;
}

/** ツールチップの行 */
export function contextTooltip(c: ContextUsage | undefined): string {
  if (!c) return '';
  const pct = contextPercent(c);
  if (pct === undefined) return `コンテキスト：${formatTokens(c.tokens)}（窓の大きさがわからないモデル${c.model ? `：${c.model}` : ''}）`;
  return `コンテキスト：${pct}%（${formatTokens(c.tokens)} / ${formatTokens(c.window!)}）`;
}

export function formatAgo(ms: number, now = Date.now()): string {
  if (!ms) return '';
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min} 分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 時間前`;
  return `${Math.floor(h / 24)} 日前`;
}

/** 知らない waitingFor はそのまま出す（docs/research/session-status.md：「対応待ち（その他）」） */
export function waitingLabel(waitingFor: string | undefined): string {
  return WAITING_LABELS[waitingFor ?? ''] ?? waitingFor ?? '不明';
}

const STATE_LABELS: Record<Exclude<SessionState, 'waiting'>, string> = { busy: '処理中', idle: '待機中', stopped: '停止' };

/** 行の更新日時の左に出す状態の文字。知らない waitingFor は「その他」（「対応待ち（その他）」） */
export function stateLabel(state: SessionState, waitingFor?: string): string {
  if (state === 'waiting') return WAITING_LABELS[waitingFor ?? ''] ?? 'その他';
  return STATE_LABELS[state];
}

/** 対応待ちの理由ごとの印。ここにない理由は丸に感嘆符（「対応待ち（その他）」） */
const WAITING_ICONS: Record<string, IconName> = {
  'permission prompt': 'shield',
  'sandbox request': 'shield',
  'input needed': 'keyboard',
  'dialog open': 'app-window',
};
/** 処理中の印。lucide にない動き（弧が伸び縮みする）なので、renderer.ts で自前の SVG を描く */
export const PROGRESS_RING = 'progress-ring';
export type StatusIcon = IconName | typeof PROGRESS_RING;
const STATE_ICONS: Record<Exclude<SessionState, 'waiting'>, StatusIcon> = { busy: PROGRESS_RING, idle: 'message-square-more', stopped: 'circle-minus' };

/** 行の左に出す状態の印（lucide の名前か PROGRESS_RING） */
export function statusIconName(state: SessionState, waitingFor?: string): StatusIcon {
  if (state === 'waiting') return WAITING_ICONS[waitingFor ?? ''] ?? 'circle-alert';
  return STATE_ICONS[state];
}

/** 行のツールチップ。hold を渡すと、保留の経過とメモを名前のすぐ下に出す */
export function tooltip(s: SessionView, hold?: HoldMark, now = Date.now()): string {
  const lines = [s.title];
  if (hold) lines.push(holdTooltip(hold, now));
  if (s.worktree) lines.push(`ワークツリー：${s.worktree.branch}`);
  if (s.state === 'waiting') lines.push(`対応待ち：${waitingLabel(s.waitingFor)}`);
  if (s.needsAction) lines.push(`対応が必要：${s.needsAction}`);
  if (s.detail) lines.push(s.detail);
  const changes = changesTooltip(s.changes);
  if (changes) lines.push(changes);
  const context = contextTooltip(s.context);
  if (context) lines.push(context);
  return lines.join('\n');
}

// ---- コミットされていない変更（docs/design/git-changes.md） ----

export interface ChangeItem {
  icon: IconName;
  count: number;
}

/** 印に並べる内訳。0 のものは出さない。空なら印を出さない。マージ済みなら、内訳の代わりにマージのアイコンだけ（件数 0 は数を出さない） */
export function changeItems(c: GitChanges | undefined): ChangeItem[] {
  if (!c) return [];
  if (c.merged) return [{ icon: 'git-merge', count: 0 }];
  const items: ChangeItem[] = [
    { icon: 'file-pen-line', count: c.changed },
    { icon: 'file-plus', count: c.untracked },
    { icon: 'arrow-up', count: c.ahead },
    { icon: 'arrow-down', count: c.behind },
  ];
  return items.filter((i) => i.count > 0);
}

/** 印とセッションのツールチップに添える内訳。何もなければ空 */
export function changesTooltip(c: GitChanges | undefined): string {
  if (!c) return '';
  if (c.merged) return 'マージ済み（元のブランチに入った）';
  const parts: string[] = [];
  if (c.changed) parts.push(`変更 ${c.changed}`);
  if (c.untracked) parts.push(`未追跡 ${c.untracked}`);
  const lines = parts.length ? [`コミットされていない変更：${parts.join('・')}`] : [];
  if (c.ahead) lines.push(c.aheadOfBase ? `元のブランチにまだ入っていないコミット：${c.ahead}` : `push していないコミット：${c.ahead}`);
  if (c.behind) lines.push(`元のブランチからの遅れ：${c.behind}`);
  return lines.join('\n');
}

/**
 * 左端の帯（未確認）を出すかどうか。状態が変わったときに呼ぶ。prev は前に見た状態（初めて見たときは undefined）
 * - 付ける：対応待ちになったとき（起動した時点で対応待ちのときも）、処理中から待機になったとき
 * - 消す：処理中になったとき、対応待ちから待機・停止中になったとき（デスクトップ側で対応済み）
 * - クリックしたときに消すのは renderer
 */
export function nextAttention(prev: SessionState | undefined, next: SessionState, flagged: boolean): boolean {
  if (prev === next) return flagged;
  if (next === 'waiting') return true;
  return prev === 'busy' && next === 'idle';
}

/**
 * 新しく未確認になった（前の描画では帯がなかった）セッションの ID。光を一度だけ横切らせる行に使う。
 * 最初の描画（primed が false）では返さない（起動したとたんに全部の行が光らないように）
 */
export function newlyFlagged(before: ReadonlySet<string>, after: Iterable<string>, primed: boolean): string[] {
  if (!primed) return [];
  return [...after].filter((id) => !before.has(id));
}

// ---- 音とトーストで知らせる ----

/** 知らせる理由。waiting は対応待ちになった、done は完了した（処理中から待機になった） */
export type AlertReason = 'waiting' | 'done';

export interface Alert {
  id: string;
  reason: AlertReason;
}

/** 状態が変わってから知らせるまで待つ長さ。この間に変わったセッションは 1 回にまとめる */
export const ALERT_COLLECT_MS = 300;
/** 続けて知らせるときにあける間 */
export const ALERT_GAP_MS = 4_000;

/**
 * 知らせる理由。nextAttention と同じきっかけで、帯が新しく付いたときだけ返す。
 * 完了の帯が残ったまま対応待ちになったときも、対応待ちとして知らせる。
 * 起動直後の最初の読み込みで知らせないのは renderer が決める
 */
export function attentionReason(prev: SessionState | undefined, next: SessionState): AlertReason | undefined {
  if (prev === next) return undefined;
  if (next === 'waiting') return 'waiting';
  return prev === 'busy' && next === 'idle' ? 'done' : undefined;
}

/** まだ知らせていないものに、新しいものを足す。同じセッションなら対応待ちのほうを残す */
export function mergeAlerts(queued: Alert[], fresh: Alert[]): Alert[] {
  const map = new Map(queued.map((a) => [a.id, a]));
  for (const a of fresh) {
    if (map.get(a.id)?.reason !== 'waiting') map.set(a.id, a);
  }
  return [...map.values()];
}

/** 次に知らせるまでの待ち時間。lastAt は前に知らせた時刻（まだなら -Infinity） */
export function alertDelay(lastAt: number, now: number): number {
  return Math.max(ALERT_COLLECT_MS, lastAt + ALERT_GAP_MS - now);
}

export interface AlertFilter {
  waiting: boolean;
  done: boolean;
  /** Claude が前面で、そのセッションを開いているときは知らせない */
  muteWhenOpen: boolean;
}

/**
 * 知らせるものを選び、対応待ちを先に並べる（同じ理由なら元の順）。
 * openInFront は、Claude が前面にあるときに今開いているセッションの ID。前面にないときやわからないときは undefined
 */
export function pickAlerts(alerts: Alert[], filter: AlertFilter, openInFront: string | undefined): Alert[] {
  return alerts
    .filter((a) => (a.reason === 'waiting' ? filter.waiting : filter.done))
    .filter((a) => !(filter.muteWhenOpen && a.id === openInFront))
    .sort((a, b) => Number(a.reason !== 'waiting') - Number(b.reason !== 'waiting'));
}

/** 鳴らす音。対応待ちが 1 つでもあれば対応待ちの音 */
export function alertSound(alerts: Alert[]): AlertReason | undefined {
  if (!alerts.length) return undefined;
  return alerts.some((a) => a.reason === 'waiting') ? 'waiting' : 'done';
}

/** 知らせ方。どれもオフなら何もしない */
export interface AlertOutputs {
  sound: boolean;
  toast: boolean;
  flash: boolean;
}

export interface AlertActions {
  /** 鳴らす音。鳴らさないなら undefined */
  sound?: AlertReason;
  /** 出すトースト。出さないなら undefined */
  toast?: ToastContent;
  /** タスクバーを点滅させるか */
  flash: boolean;
}

/** 知らせ方が 1 つでもオンか */
export function hasAlertOutput(outputs: AlertOutputs): boolean {
  return outputs.sound || outputs.toast || outputs.flash;
}

/**
 * pickAlerts を通った知らせから、音・トースト・点滅のそれぞれをどうするか決める。
 * 知らせるものがない（どれも出さない）ときは undefined。音と点滅は、何件でも 1 回だけ
 */
export function alertActions(alerts: Alert[], outputs: AlertOutputs, sessions: SessionView[]): AlertActions | undefined {
  const reason = alertSound(alerts);
  if (!reason) return undefined;
  const actions: AlertActions = {
    sound: outputs.sound ? reason : undefined,
    toast: outputs.toast ? toastContent(alerts, sessions) : undefined,
    flash: outputs.flash,
  };
  return actions.sound || actions.toast || actions.flash ? actions : undefined;
}

/**
 * Claude 本体で開いたか。前に見た focusedAt（まだ見ていなければ undefined）より新しくなったら true。
 * 初めて見たセッションは、開いたとはみなさない（起動直後に帯を消さないため）
 */
export function openedInClaude(prevFocusedAt: number | undefined, focusedAt: number | undefined): boolean {
  return prevFocusedAt !== undefined && (focusedAt ?? 0) > prevFocusedAt;
}

export interface ToastContent {
  /** クリックで開くセッション */
  id: string;
  title: string;
  body: string;
}

/** トーストの中身。先頭（対応待ちを優先）のセッションの名前と理由。ほかにもあれば件数を添える */
export function toastContent(alerts: Alert[], sessions: SessionView[]): ToastContent | undefined {
  const first = alerts[0];
  const s = first && sessions.find((x) => x.id === first.id);
  if (!first || !s) return undefined;
  const reason = first.reason === 'waiting' ? `対応待ち（${waitingLabel(s.waitingFor)}）` : '完了';
  const rest = alerts.length - 1;
  return { id: s.id, title: s.title, body: rest ? `${reason}。ほかに ${rest} 件` : reason };
}

/** クリックで開いたセッション。デスクトップがファイルに書くまでの間、これを今開いているものとして扱う */
export interface PendingFocus {
  id: string;
  /** クリックした時刻（Unix ミリ秒）。これより新しい `lastFocusedAt` を持つ別のセッションが出たら、本体でそちらを開いたとみなす */
  at: number;
  /** 安全のための期限（Unix ミリ秒）。本体で開けなかったときに残り続けないよう、これを過ぎたらファイルの値に戻す */
  until: number;
}

/**
 * クリックしてからファイルに反映されるのを待つ最長の長さ。
 * 本体の書き込みは 3 秒以上かかることがあり、短いと先に切れて前の行に戻り、そのあと書き込みで戻ってくる（行が揺れる）。
 * そのため、ふだんは期限ではなくファイルの変化で仮の値を外し、これは本体で開けなかったときの備えにする
 */
export const PENDING_FOCUS_MS = 30_000;

/**
 * 今開いているセッションの ID を決める。
 * クリックしたセッションがあれば、次のどれかが起きるまではそちらを優先する。
 * ファイルが追いついた（クリックしたセッションが今開いているものになった）。
 * クリックより新しい `lastFocusedAt` を持つ別のセッションが出た（本体で別のセッションを開いた）。
 * クリックしたセッションが一覧から消えた。安全のための期限が過ぎた。
 * 返す pending は、まだ待つなら同じもの、もう要らなければ undefined。
 */
export function resolveFocus(
  sessions: SessionView[],
  pending: PendingFocus | undefined,
  now = Date.now(),
): { id: string | undefined; pending: PendingFocus | undefined } {
  const fromData = sessions.find((s) => s.focused)?.id;
  if (
    pending &&
    now < pending.until &&
    fromData !== pending.id &&
    sessions.some((s) => s.id === pending.id) &&
    !sessions.some((s) => s.id !== pending.id && (s.focusedAt ?? 0) > pending.at)
  ) {
    return { id: pending.id, pending };
  }
  return { id: fromData, pending: undefined };
}

// ---- カード（ワークツリーごと）と Bantus のアーカイブ（docs/design/worktree-cards.md） ----

/** アーカイブを決めるもの。手で決めた印、保留の印、未確認の行、確認した時刻、設定、今の時刻 */
export interface ArchiveOptions extends HoldOptions {
  /** セッションの ID → 手で決めた印 */
  marks: Readonly<Record<string, ArchiveMark>>;
  /** カードの目印 → 手で決めた印 */
  cardMarks: Readonly<Record<string, ArchiveMark>>;
  /** 未確認（左端の帯）のセッション。動いているものとして隠さない */
  attention: ReadonlySet<string>;
  /** ウィジェットで確認した（帯が消えた）時刻。main の自動アーカイブの起点に使う */
  confirmedAt: ReadonlyMap<string, number>;
  /** main で自動でアーカイブするまでの分。0 ならしない */
  mainMinutes: number;
  /**
   * アーカイブから動き出して戻ったセッション。落ち着いて（最後に動いたか確認してから）しばらくは、どの決まりでもアーカイブしない。
   * 開いて結果を読んでいる間に、帯が消えたとたん隠れないようにする
   */
  revived: ReadonlySet<string>;
  now: number;
  sort: SortOptions;
}

/** カード、カードの中の行の並び順（設定の projectOrder、worktreeOrder、sessionOrder） */
export interface SortOptions {
  project: SortOrder;
  worktree: SortOrder;
  session: SortOrder;
}

/** どれも急ぐ順 */
export const PRIORITY_SORT: SortOptions = { project: 'priority', worktree: 'priority', session: 'priority' };

/** 手の印も未確認もなく、main は自動でアーカイブしない */
export const NO_ARCHIVE: ArchiveOptions = {
  marks: {},
  cardMarks: {},
  holds: {},
  heldCards: {},
  attention: new Set(),
  confirmedAt: new Map(),
  mainMinutes: 0,
  revived: new Set(),
  now: 0,
  sort: PRIORITY_SORT,
};

/** タイムラインの 1 行 */
export interface TimelineItem {
  session: SessionView;
  archived: boolean;
  /** main で始めたセッション（起点） */
  origin: boolean;
  /** 起点の行の場所：main のカードでは行き先のワークツリー、ワークツリーのカードでは元のフォルダ */
  place?: FlyPlace;
  /** 1 つ下（より古いもの）とのつなぎ方。一番下はなし */
  link?: 'solid' | 'dashed';
}

export interface WorktreeCard {
  /** cardKeyOf と同じ値 */
  key: string;
  /** 元のフォルダ（main）のカード */
  isMain: boolean;
  /** 見出しの名前（短くしたブランチ名、main はそのブランチ名） */
  label: string;
  /** 見出しのツールチップ（ブランチ名の全体と作業フォルダ） */
  tooltip: string;
  changes?: GitChanges;
  /** カードに出す行（並び順の設定に従う） */
  sessions: SessionView[];
  /** アーカイブしたセッション（新しく作ったものが上）。重なりの件数 */
  archived: SessionView[];
  /** 一覧に出す行。ワークツリーは全部（新しく作ったものが上、起点が下）、main はアーカイブしたものと、ワークツリーのカードへ移した起点 */
  timeline: TimelineItem[];
  /**
   * 一覧にあって、このカードの行に出ていないものの数（重なりとめくれの件数）。アーカイブしたものと、main に残した起点。
   * 0 なら重なりを出さない。起点をアーカイブから戻しても、つながりは一覧で見られるよう重なりを残す
   */
  stackCount: number;
  /** カードごとアーカイブしている（マージ済み、ワークツリーがない、手でアーカイブした） */
  hidden: boolean;
  /** カードを保留にしている（docs/design/hold.md） */
  held?: HoldMark;
  /** マージ済み（ワークツリーがないものも含む） */
  merged: boolean;
  rank: number;
  latest: number;
}

export interface RepoView {
  key: string;
  name: string;
  /** 出すカード */
  cards: WorktreeCard[];
  /** カードごとアーカイブしたもの（見出しの件数） */
  hiddenCards: WorktreeCard[];
  badge: { state: '' | 'waiting' | 'busy' | 'held'; text: string };
  rank: number;
  latest: number;
}

/** 動いているもの（処理中、対応待ち、未確認）。どの決まりでもアーカイブしない */
export function isLive(s: SessionView, attention: ReadonlySet<string>): boolean {
  return s.state === 'busy' || s.state === 'waiting' || attention.has(s.id);
}

/** 戻ったセッションを出しておく分（main の自動アーカイブがオフのとき） */
export const REVIVE_GRACE_MINUTES = 10;

/** 落ち着いた時刻。最後に動いた時刻と、ウィジェットで確認した時刻の新しいほう */
function settledAt(s: SessionView, opts: Pick<ArchiveOptions, 'confirmedAt'>): number {
  return Math.max(s.lastActivityAt, opts.confirmedAt.get(s.id) ?? 0);
}

/** 隠さずに出しておくもの：動いているものと、戻ってから落ち着いてまだ間もないもの（main の自動アーカイブと同じ分） */
export function isKept(s: SessionView, opts: Pick<ArchiveOptions, 'attention' | 'revived' | 'confirmedAt' | 'mainMinutes' | 'now'>): boolean {
  if (isLive(s, opts.attention)) return true;
  if (!opts.revived.has(s.id)) return false;
  return withinGrace(s, opts);
}

/** 落ち着いてから、猶予（main の自動アーカイブと同じ分。オフなら REVIVE_GRACE_MINUTES）がまだたっていない */
function withinGrace(s: SessionView, opts: Pick<ArchiveOptions, 'confirmedAt' | 'mainMinutes' | 'now'>): boolean {
  return opts.now - settledAt(s, opts) < (opts.mainMinutes || REVIVE_GRACE_MINUTES) * 60_000;
}

/**
 * ウィジェットか Claude 本体で確認して（帯が消えて）から、まだ猶予の内にあるもの。
 * 行を押して開いたとたんに隠れたり、ワークツリーのカードへ移ったりしないようにする。
 * isKept と違って手の印より弱い（手でアーカイブするときも帯を消すので、印を先に見る）
 */
function recentlyConfirmed(s: SessionView, opts: Pick<ArchiveOptions, 'confirmedAt' | 'mainMinutes' | 'now'>): boolean {
  return opts.confirmedAt.has(s.id) && withinGrace(s, opts);
}

/**
 * 保留にしたのに動き出した（処理中・対応待ちになった）もの。印を外す（画面側が保存する）。
 * カードは、中のどれかのセッションが動き出したら外す
 */
export function releasedHolds(sessions: SessionView[], holds: HoldOptions): { sessions: string[]; cards: string[] } {
  const live = sessions.filter((s) => s.state === 'busy' || s.state === 'waiting');
  const cards = new Set<string>();
  for (const s of live) {
    const key = cardKeyOf(s);
    if (holds.heldCards[key]) cards.add(key);
  }
  return { sessions: live.filter((s) => holds.holds[s.id]).map((s) => s.id), cards: [...cards] };
}

/** 手でアーカイブしたのに動き出したセッションの ID。印を外して自動の決まりに戻す（画面側が保存する） */
export function revivedSessions(sessions: SessionView[], opts: Pick<ArchiveOptions, 'marks' | 'attention'>): string[] {
  return sessions.filter((s) => opts.marks[s.id] === 'archived' && isLive(s, opts.attention)).map((s) => s.id);
}

/** 手でアーカイブしたカードのうち、中のセッションが動き出したもの */
export function revivedCards(sessions: SessionView[], opts: Pick<ArchiveOptions, 'cardMarks' | 'attention'>): string[] {
  const keys = new Set<string>();
  for (const s of sessions) {
    const key = cardKeyOf(s);
    if (opts.cardMarks[key] === 'archived' && isLive(s, opts.attention)) keys.add(key);
  }
  return [...keys];
}

/** ワークツリーのセッション：手の印がなければ、最後に動いたもの以外をアーカイブする（確認してから間もないものは除く） */
function worktreeArchived(s: SessionView, newest: boolean, opts: ArchiveOptions): boolean {
  // 保留したものは、どの決まりでもアーカイブしない
  if (opts.holds[s.id] || isKept(s, opts)) return false;
  const mark = opts.marks[s.id];
  if (mark) return mark === 'archived';
  return !newest && !recentlyConfirmed(s, opts);
}

/** main のセッション：手の印がなければ、落ち着いて（確認して）から決めた分がたったらアーカイブする */
function mainArchived(s: SessionView, opts: ArchiveOptions): boolean {
  if (opts.holds[s.id] || isKept(s, opts)) return false;
  const mark = opts.marks[s.id];
  if (mark) return mark === 'archived';
  if (!opts.mainMinutes) return false;
  return opts.now - settledAt(s, opts) >= opts.mainMinutes * 60_000;
}

/**
 * 起点（main で始め、ワークツリーのセッションを作ったもの）をワークツリーのカードへ移すか。
 * 動いている・手で戻したものは main に残す。手の印がなく確認してから間もないものも、しばらく main に残す
 */
function originMoves(s: SessionView, opts: ArchiveOptions): boolean {
  // 保留の起点は main に出しておく
  if (opts.holds[s.id] || isKept(s, opts)) return false;
  const mark = opts.marks[s.id];
  if (mark) return mark !== 'shown';
  return !recentlyConfirmed(s, opts);
}

/** 起点の行き先（main のカードの一覧に出す）。dest は移す先のカードのセッション */
function destPlace(dest: SessionView): FlyPlace {
  const wt = dest.worktree!;
  return { icon: 'corner-down-right', label: wt.label, tip: `ワークツリー：${wt.branch} で続けている` };
}

/** 起点の出どころ（ワークツリーのカードの一覧に出す） */
function sourcePlace(origin: SessionView): FlyPlace {
  return {
    icon: 'house',
    label: origin.mainBranch ?? '元のフォルダ',
    tip: `元のフォルダ：${origin.mainBranch ?? '(ブランチ不明)'} で始めたセッション`,
  };
}

function byCreatedDesc(a: SessionView, b: SessionView): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** 新しいものが上のタイムライン。上の行が下の行から spawnedFrom で作られていれば実線 */
function timelineOf(items: Omit<TimelineItem, 'link'>[]): TimelineItem[] {
  const sorted = [...items].sort((a, b) => byCreatedDesc(a.session, b.session));
  return sorted.map((item, i): TimelineItem => {
    const below = sorted[i + 1];
    return below ? { ...item, link: item.session.spawnedFrom === below.session.id ? 'solid' : 'dashed' } : { ...item };
  });
}

function rankOfList(list: SessionView[], holds: HoldOptions): { rank: number; latest: number } {
  return {
    rank: Math.min(3, ...list.map((s) => rankOf(s, holds))),
    latest: Math.max(0, ...list.map((s) => s.lastActivityAt)),
  };
}

/**
 * リポジトリの見出しのバッジ。いちばん急ぐ状態の件数だけを出す。
 * 要対応・処理中がないときだけ、保留の件数（保留の行と保留のカード。held）を出す
 */
export function cardBadge(sessions: SessionView[], held = 0): { state: '' | 'waiting' | 'busy' | 'held'; text: string } {
  const waiting = sessions.filter((s) => s.state === 'waiting').length;
  const busy = sessions.filter((s) => s.state === 'busy').length;
  if (waiting) return { state: 'waiting', text: `要対応 ${waiting}` };
  if (busy) return { state: 'busy', text: `処理中 ${busy}` };
  if (held) return { state: 'held', text: `保留 ${held}` };
  return { state: '', text: '' };
}

/**
 * リポジトリごとに、ワークツリー（元のフォルダを含む）のカードを作り、アーカイブの決まりで行を分ける。
 * - ワークツリー：lastActivityAt が一番新しいものを残し、ほかの落ち着いたものをアーカイブする
 * - main：落ち着いてから決めた分がたったものをアーカイブする
 * - 起点：ワークツリーのカードへ移す（動いている間と、手で戻したものは main に残す）
 * - マージ済み・ワークツリーがないカードは、カードごとアーカイブする
 * - 動いているもの（処理中、対応待ち、未確認）は、どの決まりでも隠さない
 */
export function buildRepos(sessions: SessionView[], opts: ArchiveOptions = NO_ARCHIVE): RepoView[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  // 起点 → 移す先のカード（そのセッションから作られた、いちばん古いワークツリーのセッションのカード）
  const originTo = new Map<string, string>();
  // 起点 → 移す先のカードのセッション（行き先の名前に使う）
  const originDest = new Map<string, SessionView>();
  for (const s of [...sessions].sort((a, b) => a.createdAt - b.createdAt)) {
    const parent = s.spawnedFrom ? byId.get(s.spawnedFrom) : undefined;
    if (!s.worktree || !parent || parent.worktree || parent.repoKey !== s.repoKey || originTo.has(parent.id)) continue;
    originTo.set(parent.id, cardKeyOf(s));
    originDest.set(parent.id, s);
  }

  const repos = new Map<string, { name: string; groups: Map<string, SessionView[]>; all: SessionView[] }>();
  for (const s of sessions) {
    let repo = repos.get(s.repoKey);
    if (!repo) {
      repo = { name: s.repoName, groups: new Map(), all: [] };
      repos.set(s.repoKey, repo);
    }
    repo.all.push(s);
    const key = cardKeyOf(s);
    const list = repo.groups.get(key);
    if (list) list.push(s);
    else repo.groups.set(key, [s]);
  }

  const order = compareSessions(opts.sort.session, opts);
  const result: RepoView[] = [];
  for (const [repoKey, repo] of repos) {
    const cards: WorktreeCard[] = [];
    // ワークツリーのカードへ移す起点（移す先のカードの目印 → 起点）
    const moved = new Map<string, SessionView[]>();
    for (const s of repo.all) {
      const to = originTo.get(s.id);
      if (!to || !originMoves(s, opts)) continue;
      const list = moved.get(to);
      if (list) list.push(s);
      else moved.set(to, [s]);
    }
    const movedIds = new Set([...moved.values()].flat().map((s) => s.id));
    for (const [key, own] of repo.groups) {
      const first = own[0]!;
      const isMain = !first.worktree;
      const changes = own.find((s) => s.changes)?.changes;
      const { rank, latest } = rankOfList(own, opts);
      let shown: SessionView[];
      let archived: SessionView[];
      let timeline: TimelineItem[];
      if (isMain) {
        const stay = own.filter((s) => !movedIds.has(s.id));
        // ワークツリーのカードへ移した起点も、main の一覧に出す（main で始めたセッションなので、main からもたどれるように）
        const origins = own.filter((s) => movedIds.has(s.id));
        shown = stay.filter((s) => !mainArchived(s, opts));
        archived = stay.filter((s) => mainArchived(s, opts)).sort(byCreatedDesc);
        timeline = [
          ...archived.map((session) => ({ session, archived: true, origin: false })),
          ...origins.map((session) => ({ session, archived: true, origin: true, place: destPlace(originDest.get(session.id)!) })),
        ].sort((a, b) => byCreatedDesc(a.session, b.session));
      } else {
        const newest = own.reduce((a, b) => (b.lastActivityAt > a.lastActivityAt ? b : a));
        const flags = own.map((s) => ({ session: s, archived: worktreeArchived(s, s === newest, opts), origin: false }));
        const origins = (moved.get(key) ?? []).map((s) => ({ session: s, archived: true, origin: true, place: sourcePlace(s) }));
        // まだ main に残している起点も、一覧の一番下に出す
        const kept = repo.all
          .filter((s) => originTo.get(s.id) === key && !movedIds.has(s.id))
          .map((s) => ({ session: s, archived: false, origin: true, place: sourcePlace(s) }));
        shown = flags.filter((f) => !f.archived).map((f) => f.session);
        archived = [...flags.filter((f) => f.archived), ...origins].map((f) => f.session).sort(byCreatedDesc);
        timeline = timelineOf([...flags, ...origins, ...kept]);
      }
      const merged = !isMain && !!(changes?.merged || changes?.gone);
      const anyLive = own.some((s) => isKept(s, opts));
      const mark = opts.cardMarks[key];
      const held = isMain ? undefined : opts.heldCards[key];
      // マージ済みで自動で隠すのは、確認してから間もないものがなくなってから。保留のカードは隠さない
      const hidden = !isMain && !anyLive && !held && (mark ? mark === 'archived' : merged && !own.some((s) => recentlyConfirmed(s, opts)));
      cards.push({
        key,
        isMain,
        label: isMain ? first.mainBranch ?? '元のフォルダ' : first.worktree!.label,
        tooltip: cardTooltip(first),
        changes,
        sessions: shown.sort(order),
        archived,
        timeline,
        stackCount: timeline.filter((t) => !shown.includes(t.session)).length,
        hidden,
        ...(held && { held }),
        merged,
        rank,
        latest,
      });
    }
    cards.sort(compareItems<WorktreeCard>(opts.sort.worktree, (c) => c.label, (c) => c.isMain));
    const shownCards = cards.filter((c) => !c.hidden);
    // 保留の件数：保留のカードと、保留のカードの外にある保留の行
    const heldCount = shownCards.reduce((n, c) => n + (c.held ? 1 : c.sessions.filter((s) => isHeld(s, opts)).length), 0);
    result.push({
      key: repoKey,
      name: repo.name,
      cards: shownCards,
      hiddenCards: cards.filter((c) => c.hidden),
      badge: cardBadge(repo.all, heldCount),
      ...rankOfList(repo.all, opts),
    });
  }
  return result.sort(compareItems<RepoView>(opts.sort.project, (r) => r.name));
}

/** カードの見出しのツールチップ。ブランチ名の全体と作業フォルダ */
function cardTooltip(s: SessionView): string {
  const lines = [s.worktree ? `ワークツリー：${s.worktree.branch}` : `元のフォルダ：${s.mainBranch ?? '(ブランチ不明)'}`];
  if (s.workDir) lines.push(s.workDir);
  return lines.join('\n');
}

/** 画面に並んでいる順（上から）の、アーカイブしていないセッション */
export function displayOrder(sessions: SessionView[], opts: ArchiveOptions = NO_ARCHIVE): SessionView[] {
  return buildRepos(sessions, opts).flatMap((r) => r.cards.flatMap((c) => c.sessions));
}

/**
 * ショートカットで次に開くセッションの ID。今開いているセッション（currentId）は選ばない。アーカイブしたものは選ばない
 * - 未確認（左端の帯）の行があれば、表示順でいちばん上のもの（保留の行でも）
 * - なければ、表示順で今開いているセッションの次（最後なら先頭に戻る）。保留の行（保留のカードの行も）は飛ばす
 */
export function nextCycleTarget(
  sessions: SessionView[],
  attention: ReadonlySet<string>,
  currentId: string | undefined,
  opts: ArchiveOptions = NO_ARCHIVE,
): string | undefined {
  const shown = displayOrder(sessions, { ...opts, attention });
  const flagged = shown.find((s) => s.id !== currentId && attention.has(s.id))?.id;
  if (flagged) return flagged;
  // 保留の行は巡回から外す。今開いているものは保留でも残し、その次から探す
  const ids = shown.filter((s) => !isHeld(s, opts) || s.id === currentId).map((s) => s.id);
  // 今開いているものの次から探す。一覧にない（アーカイブしたなど）ときは indexOf が -1 なので先頭から
  const at = currentId ? ids.indexOf(currentId) : -1;
  const next = ids[(at + 1) % ids.length];
  return next === currentId ? undefined : next;
}

/** ショートカットで何をするか。raise が true なら、開き直さずに Claude のウィンドウを前に出すだけでよい（id はもう開いている） */
export interface ShortcutAction {
  id: string;
  raise: boolean;
}

/**
 * ショートカットで開くセッション
 * - 今開いているもののほかに未確認（左端の帯）の行があれば、前面かどうかに関係なく、表示順でいちばん上のもの
 * - なければ、Claude のウィンドウが前面にないときは今開いているセッション（前に出すだけ。raise: true）
 * - 前面にあるか、今開いているセッションが一覧にない（アーカイブしたなど）ときは nextCycleTarget
 */
export function shortcutTarget(
  sessions: SessionView[],
  attention: ReadonlySet<string>,
  currentId: string | undefined,
  claudeInFront: boolean,
  opts: ArchiveOptions = NO_ARCHIVE,
): ShortcutAction | undefined {
  const ids = displayOrder(sessions, { ...opts, attention }).map((s) => s.id);
  // 未確認は処理中より急ぐので、前面になくても今のセッションより先に開く
  const flagged = ids.find((id) => id !== currentId && attention.has(id));
  if (flagged) return { id: flagged, raise: false };
  if (!claudeInFront && currentId && ids.includes(currentId)) return { id: currentId, raise: true };
  const next = nextCycleTarget(sessions, attention, currentId, opts);
  return next ? { id: next, raise: false } : undefined;
}
