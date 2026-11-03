// 画面に出す形への組み立て（カード、小見出し、ツールチップ）。DOM を使わないので、テストから直接呼べる。

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

export interface Group {
  key: string;
  label: string;
  tooltip: string;
  isMain: boolean;
  sessions: SessionView[];
  /** その作業フォルダのコミットされていない変更（同じ小見出しのセッションは同じフォルダ） */
  changes?: GitChanges;
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
  const changes = changesTooltip(s.changes);
  if (changes) lines.push(changes);
  return lines.join('\n');
}

// ---- コミットされていない変更（docs/git-changes.md） ----

/** コミットされていない件数（変更と未追跡）。停止中の「変更あり」はこれで数える */
export function changeCount(c: GitChanges | undefined): number {
  return c ? c.changed + c.untracked : 0;
}

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
  return lines.join('\n');
}

/** セッションの中から、作業フォルダの結果を 1 つ選ぶ（同じフォルダなら同じ結果） */
function firstChanges(sessions: SessionView[]): GitChanges | undefined {
  return sessions.find((s) => s.changes)?.changes;
}

/** 作業フォルダの目印。workDir がなければ（git 管理でない、見本データ）ワークツリーの目印で代える */
function folderOf(s: SessionView): string {
  return s.workDir?.toLowerCase() ?? `${s.repoKey}|${s.worktree?.key ?? ''}`;
}

/**
 * 停止中のセッションだけが使っている作業フォルダのうち、変更が残っているものの数。
 * 上の小見出しや見出しにもう出ているフォルダは数えない
 */
export function stoppedChangedFolders(card: Card): number {
  const shown = new Set(card.active.map(folderOf));
  const folders = new Set<string>();
  for (const s of card.stopped) {
    const key = folderOf(s);
    if (!shown.has(key) && changeCount(s.changes) > 0) folders.add(key);
  }
  return folders.size;
}

/** 停止中をたたんだときの文字 */
export function stoppedLabel(card: Card): string {
  const changed = stoppedChangedFolders(card);
  return `停止中 ${card.stopped.length}` + (changed ? ` · 変更あり ${changed}` : '');
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
    g.changes ??= s.changes;
    g.rank = Math.min(g.rank, RANK[s.state]);
    g.latest = Math.max(g.latest, s.lastActivityAt);
  }
  return [...map.values()].sort(byUrgency);
}

/**
 * カードの中の並び。ワークツリーのセッションがあるときだけ、小見出しで分ける。
 * 小見出しがないときは、作業フォルダの変更（headerChanges）をカードの見出しに出す
 */
export function cardSections(card: Card): {
  useSubheads: boolean;
  sections: Pick<Group, 'key' | 'sessions'>[];
  headerChanges?: GitChanges;
} {
  const groups = buildGroups(card.active);
  const useSubheads = groups.some((g) => !g.isMain);
  if (useSubheads) return { useSubheads, sections: groups };
  return {
    useSubheads,
    sections: card.active.length ? [{ key: '*', sessions: card.active }] : [],
    headerChanges: firstChanges(card.active),
  };
}

/** 画面に並んでいる順（上から）の、停止中でないセッション */
export function displayOrder(sessions: SessionView[]): SessionView[] {
  return buildCards(sessions).flatMap((card) => cardSections(card).sections.flatMap((g) => g.sessions));
}

/**
 * ショートカットで次に開くセッションの ID。今開いているセッション（currentId）は選ばない
 * - 未確認（左端の帯）の行があれば、表示順でいちばん上のもの
 * - なければ、表示順で今開いているセッションの次（最後なら先頭に戻る）
 */
export function nextCycleTarget(sessions: SessionView[], attention: ReadonlySet<string>, currentId: string | undefined): string | undefined {
  const ids = displayOrder(sessions).map((s) => s.id);
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
