// 画面に出す形への組み立て（リポジトリ、ワークツリーのカード、アーカイブ、ツールチップ）。DOM を使わないので、テストから直接呼べる。

import { cardKeyOf } from '../shared/card-key.js';
import type { ArchiveMark, HoldMark, SortOrder } from '../shared/settings';
import type { ContextUsage, FetchStatus, FlyPlace, GitChanges, GitFailure, PlanStep, SessionState, SessionView } from '../shared/types';
import { ja } from '../shared/strings/ja.js';
import type { IconName } from './icons.js';

/** 並び順の「優先度」での順位。停止中は画面では待機中と同じに見せるので、待機と同じ（中断も） */
export const RANK: Record<SessionState, number> = { waiting: 0, busy: 1, idle: 2, stopped: 2 };
/** 並び順の「優先度」での保留の順位。待機（停止中を含む）の後ろ */
export const HELD_RANK = 2.5;
export const WAITING_LABELS: Readonly<Record<string, string>> = ja.waiting;

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

/** 並べる順位。保留は待機（停止中を含む）の後ろ */
export function rankOf(s: SessionView, holds: HoldOptions = NO_HOLDS): number {
  return isHeld(s, holds) ? HELD_RANK : RANK[s.state];
}

/** セッションの比べ方。fixed は新しく作ったものが上、recent は最後に動きがあった順、priority は急ぐ順（保留は待機の後ろ） */
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

/** 保留にしてからの長さ（「保留 2 日」など）。ツールチップと、保留の札（heldLabel）に出す */
export function heldFor(since: number, now = Date.now()): string {
  const min = Math.floor((now - since) / 60_000);
  if (min < 1) return ja.time.heldJustNow;
  if (min < 60) return ja.time.heldMinutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) return ja.time.heldHours(h);
  return ja.time.heldDays(Math.floor(h / 24));
}

/** 保留の札（行とカードの 2 段目）の文字。1 分たつまでは短く「保留」とだけ出し、メモの枠に幅を残す */
export function heldLabel(since: number, now = Date.now()): string {
  return now - since < 60_000 ? ja.time.heldJustNowShort : heldFor(since, now);
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

/** 使用率（%）の段階。コンテキストとタイトルバーの CPU・MEM で同じ境目を使う。割合がわからなければ normal */
export function percentLevel(pct: number | undefined): 'normal' | 'high' | 'full' {
  if (pct === undefined || pct < CONTEXT_HIGH) return 'normal';
  return pct < CONTEXT_FULL ? 'high' : 'full';
}

/** 色の段階。割合がわからなければ normal */
export function contextLevel(c: ContextUsage | undefined): 'normal' | 'high' | 'full' {
  return percentLevel(contextPercent(c));
}

// ---- タイトルバーの PC 全体の使用率 ----

const GIB = 2 ** 30;

/** メモリの使用率（%、整数） */
export function memPercent(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0;
}

/** メモリのツールチップの数字。使用量は小数 1 桁、総量は整数（GB は 2^30 バイト。タスク マネージャーと同じ） */
export function memGb(used: number, total: number): { used: string; total: string } {
  return { used: (used / GIB).toFixed(1), total: String(Math.round(total / GIB)) };
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
  if (pct === undefined) return ja.tooltip.contextUnknownWindow(formatTokens(c.tokens), c.model);
  return ja.tooltip.contextPercent(pct, formatTokens(c.tokens), formatTokens(c.window!));
}

export function formatAgo(ms: number, now = Date.now()): string {
  if (!ms) return '';
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return ja.time.justNow;
  if (min < 60) return ja.time.minutesAgo(min);
  const h = Math.floor(min / 60);
  if (h < 24) return ja.time.hoursAgo(h);
  return ja.time.daysAgo(Math.floor(h / 24));
}

/** 処理中のターンが始まってからの長さ（「12 分経過」「1 時間 5 分」）。描き直しは 1 分ごとなので、分の単位にとどめる。1 分たつまでは undefined */
export function busyFor(since: number, now = Date.now()): string | undefined {
  const min = Math.floor((now - since) / 60_000);
  if (min < 1) return undefined;
  if (min < 60) return ja.time.busyMinutes(min);
  return ja.time.busyHours(Math.floor(min / 60), min % 60);
}

/** 行の 2 行目の時刻の文字。処理中でターンの始まりがわかり、1 分以上たっていれば経過。ほかは最後に動きがあってからの「◯分前」 */
export function whenLabel(s: Pick<SessionView, 'state' | 'busySince' | 'lastActivityAt'>, now = Date.now()): string {
  return (s.state === 'busy' && s.busySince ? busyFor(s.busySince, now) : undefined) ?? formatAgo(s.lastActivityAt, now);
}

/** 知らない waitingFor はそのまま出す（docs/research/session-status.md：「対応待ち（その他）」） */
export function waitingLabel(waitingFor: string | undefined): string {
  return WAITING_LABELS[waitingFor ?? ''] ?? waitingFor ?? ja.state.unknown;
}

/**
 * 画面に出す状態。停止中（stopped）は、ユーザーがすることが待機中と同じ（デスクトップで開けば再開できる）なので待機中と同じに見せる。
 * 中断（処理中か対応待ちのまま止まった。interrupted）だけは、作業が終わったように見せないよう stopped のまま返し、「中断」と出す
 */
export function displayState(s: Pick<SessionView, 'state' | 'interrupted'>): SessionState {
  return s.state === 'stopped' && !s.interrupted ? 'idle' : s.state;
}

/** stopped は displayState が返したもの（中断）だけが来る */
const STATE_LABELS: Record<Exclude<SessionState, 'waiting'>, string> = { busy: ja.state.busy, idle: ja.state.idle, stopped: ja.state.interrupted };

/** 待機中で、バックグラウンドの作業が動いている（docs/design/widget-app-plan.md の表示ルール） */
export function hasBackground(state: SessionState, background?: number): boolean {
  return state === 'idle' && (background ?? 0) > 0;
}

/** 状態の札の中に棒で出すタスクリスト。処理中で、手順が 2 つ以上のときだけ */
export function planSteps(s: Pick<SessionView, 'state' | 'plan'>): PlanStep[] | undefined {
  return s.state === 'busy' && s.plan && s.plan.length >= 2 ? s.plan : undefined;
}

/**
 * 棒のある札が行に収まらないときの詰め方の段（docs/design/widget-app-plan.md の表示ルール）。
 * 棒を細くするのは CSS がする。それでも入らなければ「処理中」の文字を隠して棒だけにし、それでも入らなければ棒を隠して文字を「…」で切る
 */
export type PillFit = 'full' | 'text-hidden' | 'plan-hidden';

/** 今の段で札がはみ出すときの、次の段。もう詰められない（棒も隠した）なら undefined */
export function nextPillFit(fit: PillFit): PillFit | undefined {
  if (fit === 'full') return 'text-hidden';
  if (fit === 'text-hidden') return 'plan-hidden';
  return undefined;
}

/** 「手順 2/3」の文。今の手順（2 つ以上なら最初のもの）の番号。今の手順がなければ、終わった手順の次（すべて終わったら最後） */
export function planLabel(steps: readonly PlanStep[]): string {
  const active = steps.indexOf('active');
  const n = active >= 0 ? active + 1 : Math.min(steps.length, steps.filter((s) => s === 'done').length + 1);
  return ja.tooltip.plan(n, steps.length);
}

/** 行の更新日時の左に出す状態の文字。state は displayState のもの。知らない waitingFor は「その他」（「対応待ち（その他）」） */
export function stateLabel(state: SessionState, waitingFor?: string, background?: number): string {
  if (state === 'waiting') return WAITING_LABELS[waitingFor ?? ''] ?? ja.state.waitingOther;
  if (hasBackground(state, background)) return ja.state.background;
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

/** 行の左に出す状態の印（lucide の名前か PROGRESS_RING）。state は displayState のもの。待機中でバックグラウンドの作業があれば砂時計 */
export function statusIconName(state: SessionState, waitingFor?: string, background?: number): StatusIcon {
  if (state === 'waiting') return WAITING_ICONS[waitingFor ?? ''] ?? 'circle-alert';
  if (hasBackground(state, background)) return 'hourglass';
  return STATE_ICONS[state];
}

/** 行のツールチップ。hold を渡すと、保留の経過とメモを名前のすぐ下に出す */
export function tooltip(s: SessionView, hold?: HoldMark, now = Date.now()): string {
  const lines = [s.title];
  if (hold) lines.push(holdTooltip(hold, now));
  if (s.worktree) lines.push(ja.tooltip.worktree(s.worktree.branch));
  if (s.state === 'waiting') lines.push(ja.tooltip.waiting(waitingLabel(s.waitingFor)));
  if (hasBackground(s.state, s.background)) lines.push(ja.tooltip.background(s.background!));
  const plan = planSteps(s);
  if (plan) lines.push(planLabel(plan));
  if (s.needsAction) lines.push(ja.tooltip.needsAction(s.needsAction));
  if (s.detail) lines.push(s.detail);
  const changes = changesTooltip(s.changes, s.worktree && s.baseBranch);
  if (changes) lines.push(changes);
  const context = contextTooltip(s.context);
  if (context) lines.push(context);
  return lines.join('\n');
}

// ---- リモートの取得（docs/design/git-fetch.md） ----

/** 設定画面の「今すぐ取得」の横に出す文。1 行目が最後の取得、続けて失敗したリポジトリ */
export function fetchStatusLines(s: FetchStatus, now = Date.now()): string[] {
  const F = ja.settings.fetchStatus;
  if (!s.enabled) return [F.off];
  const lines = [s.running ? F.running : s.lastAt !== undefined ? F.last(formatAgo(s.lastAt, now)) : F.never];
  for (const f of s.failures) lines.push(F.failed(f.name, F.kinds[f.failure]));
  return lines;
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

/** カードの見出しの印の 1 つ。kind は、数が 0 の薄いブランチのアイコン（clean）か、失敗の注意のアイコン（error） */
export interface MarkItem extends ChangeItem {
  kind?: 'clean' | 'error';
}

/**
 * カードの見出しの印に並べるもの。調べ終えていれば、数がすべて 0 でも薄いブランチのアイコンを 1 つ出す（押して詳細を開けるように）。
 * 調べられなかった（error）ときは注意のアイコン。まだ調べていなければ空（印を出さない）。docs/design/git-changes.md
 */
export function markItems(c: GitChanges | undefined, error?: GitFailure): MarkItem[] {
  if (!c) return error ? [{ icon: 'circle-alert', count: 0, kind: 'error' }] : [];
  const items = changeItems(c);
  return items.length ? items : [{ icon: 'git-branch', count: 0, kind: 'clean' }];
}

/** カードの見出しの印のツールチップ。数がすべて 0 なら「変更はありません」、失敗ならその理由 */
export function markTooltip(c: GitChanges | undefined, base?: string, error?: GitFailure): string {
  if (!c) return error ? ja.changes.failed[error] : '';
  return changesTooltip(c, base) || ja.changes.clean;
}

/**
 * 印とセッションのツールチップに添える内訳。何もなければ空。
 * base はワークツリーの分岐元（遅れと未マージを比べている先）。わかれば名前を出す
 */
export function changesTooltip(c: GitChanges | undefined, base?: string): string {
  if (!c) return '';
  if (c.merged) return c.mergedInto ? ja.changes.mergedInto(c.mergedInto, base) : ja.changes.merged;
  const parts: string[] = [];
  if (c.changed) parts.push(ja.changes.changed(c.changed));
  if (c.untracked) parts.push(ja.changes.untracked(c.untracked));
  const lines = parts.length ? [ja.changes.uncommitted(parts.join(ja.changes.separator))] : [];
  if (c.ahead) {
    if (!c.aheadOfBase) lines.push(ja.changes.unpushed(c.ahead));
    else lines.push(base ? ja.changes.aheadOfNamedBase(base, c.ahead) : ja.changes.aheadOfBase(c.ahead));
  }
  if (c.behind) {
    const target = c.upstream ?? base;
    lines.push(target ? ja.changes.behindNamed(target, c.behind) : ja.changes.behind(c.behind));
  }
  return lines.join('\n');
}

/**
 * 未確認の帯と知らせの判定に使う状態。待機中でバックグラウンドの作業が動いているもの（background）は、
 * 作業が終われば Claude が続けるので、処理中と同じく扱う
 */
export type AttentionState = SessionState | 'background';

export function attentionStateOf(s: Pick<SessionView, 'state' | 'background'>): AttentionState {
  return hasBackground(s.state, s.background) ? 'background' : s.state;
}

/** Claude が動いている（処理中か、バックグラウンドで作業中） */
const isWorking = (state: AttentionState | undefined) => state === 'busy' || state === 'background';
/** 落ち着いている（待機か停止中） */
const isSettled = (state: AttentionState | undefined) => state === 'idle' || state === 'stopped';

/**
 * 左端の帯（未確認）を出すかどうか。状態が変わったときに呼ぶ。prev は前に見た状態（初めて見たときは undefined）
 * - 付ける：対応待ちになったとき（起動した時点で対応待ちのときも）、処理中かバックグラウンドで作業中から待機になったとき
 * - 消す：処理中・バックグラウンドで作業中になったとき、対応待ちから待機・停止中になったとき（デスクトップ側で対応済み）
 * - 待機と停止中の行き来では変えない。処理中・バックグラウンドで作業中から停止中になった（中断）ときは付けない
 * - クリックしたときに消すのは renderer
 */
export function nextAttention(prev: AttentionState | undefined, next: AttentionState, flagged: boolean): boolean {
  if (prev === next) return flagged;
  // 待機と停止中は画面では同じに見えるので、行き来しても帯はそのまま（完了の帯がプロセスの終わりで消えないように）
  if (isSettled(prev) && isSettled(next)) return flagged;
  if (next === 'waiting') return true;
  return isWorking(prev) && next === 'idle';
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

/** 知らせる理由。waiting は対応待ちになった、done は完了した（処理中かバックグラウンドで作業中から待機になった） */
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
export function attentionReason(prev: AttentionState | undefined, next: AttentionState): AlertReason | undefined {
  if (prev === next) return undefined;
  if (next === 'waiting') return 'waiting';
  return isWorking(prev) && next === 'idle' ? 'done' : undefined;
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
  const reason = first.reason === 'waiting' ? ja.state.waitingWithReason(waitingLabel(s.waitingFor)) : ja.toast.done;
  const rest = alerts.length - 1;
  return { id: s.id, title: s.title, body: rest ? ja.toast.withRest(reason, rest) : reason };
}

/** クリックで開いたセッション。デスクトップがファイルに書くまでの間、これを今開いているものとして扱う */
export interface PendingFocus {
  id: string;
  /** クリックした時刻（Unix ミリ秒）。これより新しい `lastFocusedAt` を持つ別のセッションが出たら、本体でそちらを開いたとみなす */
  at: number;
  /** 安全のための期限（Unix ミリ秒）。本体で開けなかったときに残り続けないよう、これを過ぎたらファイルの値に戻す */
  until: number;
  /**
   * クリックしたときに開いていたセッション（ファイルの値と、前のクリックの仮の値）。
   * 本体が前に出たとき、切り替わる前にこれらの `lastFocusedAt` が書かれることがある。
   * クリックから FOCUS_FROM_GRACE_MS までの書き込みは、本体で開いたものとみなさない
   */
  from?: readonly string[];
}

/**
 * クリックの直後に、前に開いていたセッションの `lastFocusedAt` を本体で開いたものとみなさない長さ。
 * 本体は前に出たときに、新しいセッションへ切り替わる前の（前の）セッションの時刻を書くことがある
 */
export const FOCUS_FROM_GRACE_MS = 5_000;

/**
 * クリックしてからファイルに反映されるのを待つ最長の長さ。
 * 本体の書き込みは 3 秒以上かかることがあり、短いと先に切れて前の行に戻り、そのあと書き込みで戻ってくる（行が揺れる）。
 * そのため、ふだんは期限ではなくファイルの変化で仮の値を外し、これは本体で開けなかったときの備えにする
 */
export const PENDING_FOCUS_MS = 30_000;

/**
 * 今開いているセッションの ID を決める。
 * クリックしたセッションがあれば、次のどれかが起きるまではそちらを優先する。
 * ファイルが追いついた（クリックしたセッションが、クリックより新しい時刻で今開いているものになった）。
 * クリックより新しい `lastFocusedAt` を持つ別のセッションが出た（本体で別のセッションを開いた）。
 * ただし、クリックしたときに開いていたセッションの、クリックの直後の書き込みは数えない（本体が前に出たときに書くことがある）。
 * クリックしたセッションが一覧から消えた。安全のための期限が過ぎた。
 * 返す pending は、まだ待つなら同じもの、もう要らなければ undefined。
 */
export function resolveFocus(
  sessions: SessionView[],
  pending: PendingFocus | undefined,
  now = Date.now(),
): { id: string | undefined; pending: PendingFocus | undefined } {
  const fromData = sessions.find((s) => s.focused);
  if (
    pending &&
    now < pending.until &&
    !caughtUp(fromData, pending) &&
    sessions.some((s) => s.id === pending.id) &&
    !sessions.some((s) => s.id !== pending.id && openedAfter(s, pending))
  ) {
    return { id: pending.id, pending };
  }
  return { id: fromData?.id, pending: undefined };
}

/**
 * ファイルがクリックに追いついたか。クリックしたセッションが今開いているものになり、その時刻がクリックより新しいとき。
 * クリックより前の値で同じセッションになっているだけ（すばやく続けてクリックし、前のクリックがまだ書かれていない）なら、
 * まだ追いついていない。ここで外すと、遅れて届く前のクリックの書き込みで前の行に戻る
 */
function caughtUp(fromData: SessionView | undefined, pending: PendingFocus): boolean {
  return fromData?.id === pending.id && (fromData.focusedAt ?? 0) > pending.at;
}

/** クリックのあとで、本体でそのセッションを開いたか。前に開いていたセッションのクリック直後の書き込みは数えない */
function openedAfter(s: SessionView, pending: PendingFocus): boolean {
  const at = s.focusedAt ?? 0;
  if (at <= pending.at) return false;
  return !(pending.from?.includes(s.id) && at <= pending.at + FOCUS_FROM_GRACE_MS);
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
  /** 見出しのツールチップ（ブランチ名の全体、分岐元と作業フォルダ） */
  tooltip: string;
  /**
   * ワークツリーの分岐元（遅れと未マージを比べている先）。印のツールチップと、一覧の分岐元の行に使う。
   * offMain は、分岐元が元のフォルダの今のブランチと違う（段階的に分岐した）とき。以前のセッションがなくても一覧を開けるようにする
   */
  base?: { branch: string; tip: string; offMain: boolean };
  changes?: GitChanges;
  /** 作業フォルダの git が失敗した理由（changes がないときだけ使う） */
  gitError?: GitFailure;
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
  /** 分岐元ではなく main（元のフォルダのブランチ）に入ってマージ済みにしたとき、そのブランチ名 */
  mergedInto?: string;
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

/** ホイールクリックでアーカイブを切り替えてよいか。トグルが出ないとき（処理中・対応待ちでまだアーカイブしていない）は切り替えない */
export function canToggleArchive(state: SessionView['state'], archived: boolean): boolean {
  return archived || (state !== 'busy' && state !== 'waiting');
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
 * 起動して最初に受け取った一覧から、確認した時刻の種を作る。確認した時刻はウィジェットの中だけで覚えるので、再起動すると消える。
 * 動いていない（処理中・対応待ちでない）セッションは、最後に動いた時刻に確認したものとみなし、そこから猶予を数える。
 * 使っている最中の起点が、再起動したとたんにワークツリーのカードへ移らないようにする。
 * settledAt は変わらないので、main の自動アーカイブの結果は変えない
 */
export function startupConfirmedAt(sessions: SessionView[]): Map<string, number> {
  const seed = new Map<string, number>();
  for (const s of sessions) if (s.state !== 'busy' && s.state !== 'waiting') seed.set(s.id, s.lastActivityAt);
  return seed;
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
  return { icon: 'corner-down-right', label: wt.label, tip: ja.flyout.continuedIn(wt.branch) };
}

/** 起点の出どころ（ワークツリーのカードの一覧に出す） */
function sourcePlace(origin: SessionView): FlyPlace {
  // 名前は「元のフォルダ」にする。今のブランチ名を出すと、分岐元や始めたときのブランチに見えてしまうため
  return {
    icon: 'house',
    label: ja.widget.originFolder,
    tip: origin.workDir ? ja.flyout.startedIn(origin.workDir) : ja.flyout.startedInUnknown,
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
 * 対応待ち・処理中がないときだけ、保留の件数（保留の行と保留のカード。held）を出す
 */
export function cardBadge(sessions: SessionView[], held = 0): { state: '' | 'waiting' | 'busy' | 'held'; text: string } {
  const waiting = sessions.filter((s) => s.state === 'waiting').length;
  const busy = sessions.filter((s) => s.state === 'busy').length;
  if (waiting) return { state: 'waiting', text: ja.widget.badgeWaiting(waiting) };
  if (busy) return { state: 'busy', text: ja.widget.badgeBusy(busy) };
  if (held) return { state: 'held', text: ja.widget.badgeHeld(held) };
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
      const gitError = changes ? undefined : own.find((s) => s.gitError)?.gitError;
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
        // 元のフォルダがブランチにいない（detached HEAD）ときは、短いコミット ID
        label: isMain ? first.mainBranch ?? first.mainHead ?? ja.widget.originFolder : first.worktree!.label,
        tooltip: cardTooltip(first),
        ...baseOf(first),
        changes,
        ...(gitError && { gitError }),
        sessions: shown.sort(order),
        archived,
        timeline,
        stackCount: timeline.filter((t) => !shown.includes(t.session)).length,
        hidden,
        ...(held && { held }),
        merged,
        ...(!isMain && changes?.merged && changes.mergedInto && { mergedInto: changes.mergedInto }),
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

/** カードの見出しのツールチップ。ブランチ名の全体、分岐元と作業フォルダ */
function cardTooltip(s: SessionView): string {
  const main = s.mainBranch ?? (s.mainHead ? ja.tooltip.detached(s.mainHead) : ja.tooltip.unknownBranch);
  const lines = [s.worktree ? ja.tooltip.worktree(s.worktree.branch) : ja.tooltip.origin(main)];
  if (s.baseBranch) lines.push(ja.tooltip.base(s.baseBranch));
  if (s.workDir) lines.push(s.workDir);
  return lines.join('\n');
}

/**
 * ワークツリーの分岐元。一覧ではいつも分岐元の行を出す（どのカードでも同じ形にそろえる）。
 * 段階的に分岐したとき（main → develop → feature）は offMain にし、以前のセッションがなくても一覧を開けるようにする。
 * 元のフォルダも、既定以外のブランチにいれば分岐元（既定のブランチ）を渡す（印のツールチップに使う）。一覧の形は変えないので offMain にしない
 */
function baseOf(s: SessionView): Pick<WorktreeCard, 'base'> {
  const branch = s.baseBranch;
  if (!branch) return {};
  const tip = ja.widget.branchedFromTip(branch, s.mainBranch ?? (s.mainHead ? ja.tooltip.detached(s.mainHead) : ja.tooltip.unknownBranch));
  return { base: { branch, tip, offMain: !!s.worktree && branch !== s.mainBranch } };
}

/** 画面に並んでいる順（上から）の、アーカイブしていないセッション */
export function displayOrder(sessions: SessionView[], opts: ArchiveOptions = NO_ARCHIVE): SessionView[] {
  return buildRepos(sessions, opts).flatMap((r) => r.cards.flatMap((c) => c.sessions));
}

/**
 * ショートカットで次に開くセッションの ID。今開いているセッション（currentId）は選ばない。アーカイブしたものは選ばない
 * - 未確認（左端の帯）の行があれば、表示順でいちばん上のもの（保留の行でも）
 * - なければ、表示順で今開いているセッションの次（最後なら先頭に戻る）。保留の行（保留のカードの行も）と処理中の行は飛ばす
 * - 回る先がなければ undefined（何もしない）
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
  // 保留の行と処理中の行は巡回から外す（処理中は開いてもやることがない）。今開いているものはどちらでも残し、その次から探す
  const ids = shown.filter((s) => s.id === currentId || (!isHeld(s, opts) && s.state !== 'busy')).map((s) => s.id);
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
