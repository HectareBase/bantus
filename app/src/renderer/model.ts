// 画面に出す形への組み立て（カード、小見出し、ツールチップ）。DOM を使わないので、テストから直接呼べる。

import type { SessionState, SessionView } from '../shared/types';
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

export interface Group {
  key: string;
  label: string;
  tooltip: string;
  isMain: boolean;
  sessions: SessionView[];
}

export interface Card {
  key: string;
  name: string;
  active: SessionView[];
  stopped: SessionView[];
  rank: number;
  latest: number;
}

function byUrgency(a: { rank: number; latest: number }, b: { rank: number; latest: number }) {
  return a.rank - b.rank || b.latest - a.latest;
}

export function stateOfRank(rank: number): SessionState {
  return (Object.keys(RANK) as SessionState[]).find((k) => RANK[k] === rank) ?? 'stopped';
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

/** 知らない waitingFor はそのまま出す（docs/session-status.md：「対応待ち（その他）」） */
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

export function buildCards(sessions: SessionView[]): Card[] {
  const map = new Map<string, Card>();
  for (const s of sessions) {
    let card = map.get(s.repoKey);
    if (!card) {
      card = { key: s.repoKey, name: s.repoName, active: [], stopped: [], rank: 3, latest: 0 };
      map.set(s.repoKey, card);
    }
    (s.state === 'stopped' ? card.stopped : card.active).push(s);
    card.rank = Math.min(card.rank, RANK[s.state]);
    card.latest = Math.max(card.latest, s.lastActivityAt);
  }
  return [...map.values()].sort(byUrgency);
}

export function buildGroups(active: SessionView[]): Group[] {
  const map = new Map<string, Group & { rank: number; latest: number }>();
  for (const s of active) {
    const key = s.worktree?.key ?? '';
    let g = map.get(key);
    if (!g) {
      g = s.worktree
        ? { key, label: s.worktree.label, tooltip: s.worktree.branch, isMain: false, sessions: [], rank: 3, latest: 0 }
        : {
            key,
            label: s.mainBranch ? `メイン（${s.mainBranch}）` : 'メイン',
            tooltip: 'リポジトリのフォルダで作業しているセッション',
            isMain: true,
            sessions: [],
            rank: 3,
            latest: 0,
          };
      map.set(key, g);
    }
    g.sessions.push(s);
    g.rank = Math.min(g.rank, RANK[s.state]);
    g.latest = Math.max(g.latest, s.lastActivityAt);
  }
  return [...map.values()].sort(byUrgency);
}

/** 一覧を折りたたむ決まり。設定の値と、画面が覚えている状態から作る */
export interface FoldOptions {
  /** グループごとに見せる数。0 ならすべて見せる */
  limit: number;
  /** 折りたたみの単位。repo はカードに 1 つ、worktree は小見出しごと */
  scope: 'repo' | 'worktree';
  /** 常に表示のセッション。停止中でも一覧に出し、枠を先に使う */
  alwaysShow: ReadonlySet<string>;
  /** 上限を超えても出すセッション（未確認、今開いているもの）。ほかの行を押し出さないよう、空いた枠がなければ枠の外に足す */
  extra: ReadonlySet<string>;
}

/** 何も折りたたまない（停止中だけをたたむ） */
export const NO_FOLD: FoldOptions = { limit: 0, scope: 'repo', alwaysShow: new Set(), extra: new Set() };

/** 折りたたみの中身 */
export interface Fold {
  key: string;
  /** 上限で隠した、停止中でないセッション */
  hidden: SessionView[];
  stopped: SessionView[];
}

export interface Section {
  key: string;
  /** 小見出しを出すときだけ */
  group?: Group;
  sessions: SessionView[];
  /** ワークツリーごとにまとめるときの、このグループの折りたたみ */
  fold?: Fold;
}

export interface CardLayout {
  sections: Section[];
  /** リポジトリごとにまとめるときの、カードの一番下の折りたたみ */
  fold?: Fold;
}

/**
 * グループの中で見せるものと隠すものを分ける。list は急ぐ順
 * - 対応待ちと常に表示のものは、上限を超えても出し、枠を先に使う
 * - 残りの枠を急ぐ順に埋める
 * - extra のものは、枠に入らなくても出す
 */
function pick(list: SessionView[], opts: FoldOptions): { visible: SessionView[]; hidden: SessionView[] } {
  if (!opts.limit) return { visible: list, hidden: [] };
  const first = (s: SessionView) => s.state === 'waiting' || opts.alwaysShow.has(s.id);
  let room = opts.limit - list.filter(first).length;
  const shown = new Set<SessionView>();
  for (const s of list) {
    if (first(s)) shown.add(s);
    else if (room > 0) {
      shown.add(s);
      room--;
    } else if (opts.extra.has(s.id)) shown.add(s);
  }
  return { visible: list.filter((s) => shown.has(s)), hidden: list.filter((s) => !shown.has(s)) };
}

function makeFold(key: string, hidden: SessionView[], stopped: SessionView[]): Fold | undefined {
  return hidden.length || stopped.length ? { key, hidden, stopped } : undefined;
}

/**
 * カードの中の並び。ワークツリーのセッションがあるときだけ、小見出しで分ける。
 * 上限を超えたものと停止中は、折りたたみに入れる（常に表示の停止中は一覧に残す）。
 * ワークツリーごとにまとめるときは、停止中しかないワークツリーにも小見出しを出す。
 */
export function cardLayout(card: Card, opts: FoldOptions = NO_FOLD): CardLayout {
  const kept = (s: SessionView) => opts.alwaysShow.has(s.id);
  const byWorktree = opts.scope === 'worktree';
  const groups = buildGroups([...card.active, ...card.stopped.filter((s) => byWorktree || kept(s))]);
  const useSubheads = groups.some((g) => !g.isMain);
  const allHidden: SessionView[] = [];
  const sections = groups.map((g): Section => {
    const live = g.sessions.filter((s) => s.state !== 'stopped' || kept(s));
    const { visible, hidden } = pick(live, opts);
    const section: Section = { key: g.key, group: useSubheads ? g : undefined, sessions: visible };
    if (byWorktree) {
      const stopped = g.sessions.filter((s) => s.state === 'stopped' && !kept(s));
      section.fold = makeFold(`${card.key}|${g.key}|fold`, hidden, stopped);
    } else allHidden.push(...hidden);
    return section;
  });
  const fold = byWorktree ? undefined : makeFold(`${card.key}|fold`, allHidden, card.stopped.filter((s) => !kept(s)));
  return { sections, fold };
}

/** 折りたたみの説明（ツールチップと読み上げ用）。「ほか 2 件・停止中 3」 */
export function foldLabel(fold: Fold): string {
  const parts: string[] = [];
  if (fold.hidden.length) parts.push(`ほか ${fold.hidden.length} 件`);
  if (fold.stopped.length) parts.push(`停止中 ${fold.stopped.length}`);
  return parts.join('・');
}

/** 折りたたみのボタンに出す、状態ごとの件数。急ぐ順で、0 件の状態は出さない。対応待ちは隠さないので入らない */
export function foldCounts(fold: Fold): { state: SessionState; count: number }[] {
  const states: SessionState[] = ['busy', 'idle', 'stopped'];
  return states
    .map((state) => ({ state, count: [...fold.hidden, ...fold.stopped].filter((s) => s.state === state).length }))
    .filter((c) => c.count > 0);
}

/** 画面に並んでいる順（上から）の、折りたたみの外のセッション */
export function displayOrder(sessions: SessionView[], opts: FoldOptions = NO_FOLD): SessionView[] {
  return buildCards(sessions).flatMap((card) => cardLayout(card, opts).sections.flatMap((g) => g.sessions));
}

/**
 * ショートカットで次に開くセッションの ID。今開いているセッション（currentId）は選ばない。折りたたみの中のものは選ばない
 * - 未確認（左端の帯）の行があれば、表示順でいちばん上のもの
 * - なければ、表示順で今開いているセッションの次（最後なら先頭に戻る）
 */
export function nextCycleTarget(
  sessions: SessionView[],
  attention: ReadonlySet<string>,
  currentId: string | undefined,
  opts: FoldOptions = NO_FOLD,
): string | undefined {
  const ids = displayOrder(sessions, opts).map((s) => s.id);
  const flagged = ids.find((id) => id !== currentId && attention.has(id));
  if (flagged) return flagged;
  // 今開いているものの次から探す。一覧にない（停止中など）ときは indexOf が -1 なので先頭から
  const at = currentId ? ids.indexOf(currentId) : -1;
  const next = ids[(at + 1) % ids.length];
  return next === currentId ? undefined : next;
}

/** カードの見出しのバッジ。いちばん急ぐ状態の件数だけを出す */
export function cardBadge(card: Card): { state: '' | 'waiting' | 'busy'; text: string } {
  const waiting = card.active.filter((s) => s.state === 'waiting').length;
  const busy = card.active.filter((s) => s.state === 'busy').length;
  if (waiting) return { state: 'waiting', text: `要対応 ${waiting}` };
  if (busy) return { state: 'busy', text: `処理中 ${busy}` };
  return { state: '', text: '' };
}
