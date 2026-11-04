// 画面に出す形への組み立て（リポジトリ、ワークツリーのカード、アーカイブ、ツールチップ）。DOM を使わないので、テストから直接呼べる。

import { cardKeyOf } from '../shared/card-key.js';
import type { ArchiveMark, SortOrder } from '../shared/settings';
import type { GitChanges, SessionState, SessionView } from '../shared/types';
import type { IconName } from './icons.js';

export const RANK: Record<SessionState, number> = { waiting: 0, busy: 1, idle: 2, stopped: 3 };
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

/** セッションの比べ方。fixed は新しく作ったものが上、recent は最後に動きがあった順、priority は急ぐ順 */
export function compareSessions(order: SortOrder) {
  return (a: SessionView, b: SessionView): number => {
    if (order === 'fixed') return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    if (order === 'priority' && RANK[a.state] !== RANK[b.state]) return RANK[a.state] - RANK[b.state];
    return b.lastActivityAt - a.lastActivityAt;
  };
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

export function tooltip(s: SessionView): string {
  const lines = [s.title];
  if (s.worktree) lines.push(`ワークツリー：${s.worktree.branch}`);
  if (s.state === 'waiting') lines.push(`対応待ち：${waitingLabel(s.waitingFor)}`);
  if (s.needsAction) lines.push(`対応が必要：${s.needsAction}`);
  if (s.detail) lines.push(s.detail);
  const changes = changesTooltip(s.changes);
  if (changes) lines.push(changes);
  return lines.join('\n');
}

// ---- コミットされていない変更（docs/design/git-changes.md） ----

export interface ChangeItem {
  icon: IconName;
  count: number;
}

/** 印に並べる内訳。0 のものは出さない。空なら印を出さない */
export function changeItems(c: GitChanges | undefined): ChangeItem[] {
  if (!c) return [];
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
  const parts: string[] = [];
  if (c.changed) parts.push(`変更 ${c.changed}`);
  if (c.untracked) parts.push(`未追跡 ${c.untracked}`);
  const lines = parts.length ? [`コミットされていない変更：${parts.join('・')}`] : [];
  if (c.ahead) lines.push(`push していないコミット：${c.ahead}`);
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
  /** この時刻（Unix ミリ秒）を過ぎたら、ファイルの値に戻す */
  until: number;
}

/** クリックしてからファイルに反映されるまで待つ長さ */
export const PENDING_FOCUS_MS = 5_000;

/**
 * 今開いているセッションの ID を決める。
 * クリックしたセッションがあれば、ファイルが追いつく（またはその時間が過ぎる）まではそちらを優先する。
 * 返す pending は、まだ待つなら同じもの、もう要らなければ undefined。
 */
export function resolveFocus(
  sessions: SessionView[],
  pending: PendingFocus | undefined,
  now = Date.now(),
): { id: string | undefined; pending: PendingFocus | undefined } {
  const fromData = sessions.find((s) => s.focused)?.id;
  if (pending && now < pending.until && fromData !== pending.id && sessions.some((s) => s.id === pending.id)) {
    return { id: pending.id, pending };
  }
  return { id: fromData, pending: undefined };
}

// ---- カード（ワークツリーごと）と Bantus のアーカイブ（docs/design/worktree-cards.md） ----

/** アーカイブを決めるもの。手で決めた印、未確認の行、確認した時刻、設定、今の時刻 */
export interface ArchiveOptions {
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
  attention: new Set(),
  confirmedAt: new Map(),
  mainMinutes: 0,
  now: 0,
  sort: PRIORITY_SORT,
};

/** タイムラインの 1 行 */
export interface TimelineItem {
  session: SessionView;
  archived: boolean;
  /** main で始めたセッション（起点） */
  origin: boolean;
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
  /** 一覧に出す行。ワークツリーは全部（新しく作ったものが上、起点が下）、main はアーカイブしたものだけ */
  timeline: TimelineItem[];
  /**
   * 一覧にあって、このカードの行に出ていないものの数（重なりとめくれの件数）。アーカイブしたものと、main に残した起点。
   * 0 なら重なりを出さない。起点をアーカイブから戻しても、つながりは一覧で見られるよう重なりを残す
   */
  stackCount: number;
  /** カードごとアーカイブしている（マージ済み、ワークツリーがない、手でアーカイブした） */
  hidden: boolean;
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
  badge: { state: '' | 'waiting' | 'busy'; text: string };
  rank: number;
  latest: number;
}

/** 動いているもの（処理中、対応待ち、未確認）。どの決まりでもアーカイブしない */
export function isLive(s: SessionView, attention: ReadonlySet<string>): boolean {
  return s.state === 'busy' || s.state === 'waiting' || attention.has(s.id);
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

/** ワークツリーのセッション：手の印がなければ、最後に動いたもの以外をアーカイブする */
function worktreeArchived(s: SessionView, newest: boolean, opts: ArchiveOptions): boolean {
  if (isLive(s, opts.attention)) return false;
  const mark = opts.marks[s.id];
  if (mark) return mark === 'archived';
  return !newest;
}

/** main のセッション：手の印がなければ、落ち着いて（確認して）から決めた分がたったらアーカイブする */
function mainArchived(s: SessionView, opts: ArchiveOptions): boolean {
  if (isLive(s, opts.attention)) return false;
  const mark = opts.marks[s.id];
  if (mark) return mark === 'archived';
  if (!opts.mainMinutes) return false;
  const settled = Math.max(s.lastActivityAt, opts.confirmedAt.get(s.id) ?? 0);
  return opts.now - settled >= opts.mainMinutes * 60_000;
}

/** 起点（main で始め、ワークツリーのセッションを作ったもの）をワークツリーのカードへ移すか。動いている・手で戻したものは main に残す */
function originMoves(s: SessionView, opts: ArchiveOptions): boolean {
  return !isLive(s, opts.attention) && opts.marks[s.id] !== 'shown';
}

function byCreatedDesc(a: SessionView, b: SessionView): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** 新しいものが上のタイムライン。上の行が下の行から spawnedFrom で作られていれば実線 */
function timelineOf(items: { session: SessionView; archived: boolean; origin: boolean }[]): TimelineItem[] {
  const sorted = [...items].sort((a, b) => byCreatedDesc(a.session, b.session));
  return sorted.map((item, i): TimelineItem => {
    const below = sorted[i + 1];
    return below ? { ...item, link: item.session.spawnedFrom === below.session.id ? 'solid' : 'dashed' } : { ...item };
  });
}

function rankOf(list: SessionView[]): { rank: number; latest: number } {
  return {
    rank: Math.min(3, ...list.map((s) => RANK[s.state])),
    latest: Math.max(0, ...list.map((s) => s.lastActivityAt)),
  };
}

/** リポジトリの見出しのバッジ。いちばん急ぐ状態の件数だけを出す */
export function cardBadge(sessions: SessionView[]): { state: '' | 'waiting' | 'busy'; text: string } {
  const waiting = sessions.filter((s) => s.state === 'waiting').length;
  const busy = sessions.filter((s) => s.state === 'busy').length;
  if (waiting) return { state: 'waiting', text: `要対応 ${waiting}` };
  if (busy) return { state: 'busy', text: `処理中 ${busy}` };
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
  for (const s of [...sessions].sort((a, b) => a.createdAt - b.createdAt)) {
    const parent = s.spawnedFrom ? byId.get(s.spawnedFrom) : undefined;
    if (!s.worktree || !parent || parent.worktree || parent.repoKey !== s.repoKey || originTo.has(parent.id)) continue;
    originTo.set(parent.id, cardKeyOf(s));
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

  const order = compareSessions(opts.sort.session);
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
      const { rank, latest } = rankOf(own);
      let shown: SessionView[];
      let archived: SessionView[];
      let timeline: TimelineItem[];
      if (isMain) {
        const stay = own.filter((s) => !movedIds.has(s.id));
        if (!stay.length) continue;
        shown = stay.filter((s) => !mainArchived(s, opts));
        archived = stay.filter((s) => mainArchived(s, opts)).sort(byCreatedDesc);
        timeline = archived.map((session) => ({ session, archived: true, origin: false }));
      } else {
        const newest = own.reduce((a, b) => (b.lastActivityAt > a.lastActivityAt ? b : a));
        const flags = own.map((s) => ({ session: s, archived: worktreeArchived(s, s === newest, opts), origin: false }));
        const origins = (moved.get(key) ?? []).map((s) => ({ session: s, archived: true, origin: true }));
        // まだ main に残している起点も、一覧の一番下に出す
        const kept = repo.all
          .filter((s) => originTo.get(s.id) === key && !movedIds.has(s.id))
          .map((s) => ({ session: s, archived: false, origin: true }));
        shown = flags.filter((f) => !f.archived).map((f) => f.session);
        archived = [...flags.filter((f) => f.archived), ...origins].map((f) => f.session).sort(byCreatedDesc);
        timeline = timelineOf([...flags, ...origins, ...kept]);
      }
      const merged = !isMain && !!(changes?.merged || changes?.gone);
      const anyLive = own.some((s) => isLive(s, opts.attention));
      const mark = opts.cardMarks[key];
      const hidden = !isMain && !anyLive && (mark ? mark === 'archived' : merged);
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
        merged,
        rank,
        latest,
      });
    }
    cards.sort(compareItems<WorktreeCard>(opts.sort.worktree, (c) => c.label, (c) => c.isMain));
    result.push({
      key: repoKey,
      name: repo.name,
      cards: cards.filter((c) => !c.hidden),
      hiddenCards: cards.filter((c) => c.hidden),
      badge: cardBadge(repo.all),
      ...rankOf(repo.all),
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
 * - 未確認（左端の帯）の行があれば、表示順でいちばん上のもの
 * - なければ、表示順で今開いているセッションの次（最後なら先頭に戻る）
 */
export function nextCycleTarget(
  sessions: SessionView[],
  attention: ReadonlySet<string>,
  currentId: string | undefined,
  opts: ArchiveOptions = NO_ARCHIVE,
): string | undefined {
  const ids = displayOrder(sessions, { ...opts, attention }).map((s) => s.id);
  const flagged = ids.find((id) => id !== currentId && attention.has(id));
  if (flagged) return flagged;
  // 今開いているものの次から探す。一覧にない（アーカイブしたなど）ときは indexOf が -1 なので先頭から
  const at = currentId ? ids.indexOf(currentId) : -1;
  const next = ids[(at + 1) % ids.length];
  return next === currentId ? undefined : next;
}

/**
 * ショートカットで開くセッションの ID
 * - 今開いているもののほかに未確認（左端の帯）の行があれば、前面かどうかに関係なく、表示順でいちばん上のもの
 * - なければ、Claude のウィンドウが前面にないときは今開いているセッション（開き直して前面に出す）
 * - 前面にあるか、今開いているセッションが一覧にない（アーカイブしたなど）ときは nextCycleTarget
 */
export function shortcutTarget(
  sessions: SessionView[],
  attention: ReadonlySet<string>,
  currentId: string | undefined,
  claudeInFront: boolean,
  opts: ArchiveOptions = NO_ARCHIVE,
): string | undefined {
  const ids = displayOrder(sessions, { ...opts, attention }).map((s) => s.id);
  // 未確認は処理中より急ぐので、前面になくても今のセッションより先に開く
  const flagged = ids.find((id) => id !== currentId && attention.has(id));
  if (flagged) return flagged;
  if (!claudeInFront && currentId && ids.includes(currentId)) return currentId;
  return nextCycleTarget(sessions, attention, currentId, opts);
}
