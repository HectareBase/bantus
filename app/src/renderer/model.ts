// 画面に出す形への組み立て（カード、小見出し、ツールチップ）。DOM を使わないので、テストから直接呼べる。

import type { SortOrder } from '../shared/settings';
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
  const lines = [s.seq ? `${s.seq}. ${s.title}` : s.title];
  if (s.worktree) lines.push(`ワークツリー：${s.worktree.branch}`);
  if (s.state === 'waiting') lines.push(`対応待ち：${waitingLabel(s.waitingFor)}`);
  if (s.needsAction) lines.push(`対応が必要：${s.needsAction}`);
  if (s.detail) lines.push(s.detail);
  const changes = changesTooltip(s.changes);
  if (changes) lines.push(changes);
  return lines.join('\n');
}

// ---- コミットされていない変更（docs/design/git-changes.md） ----

/** コミットされていない件数（変更と未追跡）。折りたたみの「変更が残る作業フォルダ」はこれで数える */
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

export function buildCards(sessions: SessionView[], order: SortOrder = 'priority'): Card[] {
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
  return [...map.values()].sort(compareItems<Card>(order, (c) => c.name));
}

export function buildGroups(active: SessionView[], order: SortOrder = 'priority'): Group[] {
  const map = new Map<string, Group & { rank: number; latest: number }>();
  for (const s of active) {
    const key = s.worktree?.key ?? '';
    let g = map.get(key);
    if (!g) {
      g = s.worktree
        ? { key, label: s.worktree.label, tooltip: s.worktree.branch, isMain: false, sessions: [], rank: 3, latest: 0 }
        : {
            key,
            // 家のアイコンで元のフォルダだとわかるので、名前はブランチ名だけにする
            label: s.mainBranch ?? '元のフォルダ',
            tooltip: 'プロジェクトの元のフォルダで作業しているセッション',
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
  return [...map.values()].sort(compareItems<Group & { rank: number; latest: number }>(order, (g) => g.label, (g) => g.isMain));
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
  /** 並び順。どれを折りたたむかは並び順に関係なく急ぐ順で選び、選んだあとで並べる */
  sort: SortOptions;
}

/** カード、小見出し、行の並び順（設定の projectOrder、worktreeOrder、sessionOrder） */
export interface SortOptions {
  project: SortOrder;
  worktree: SortOrder;
  session: SortOrder;
}

/** どれも急ぐ順 */
export const PRIORITY_SORT: SortOptions = { project: 'priority', worktree: 'priority', session: 'priority' };

/** 何も折りたたまない（停止中だけをたたむ） */
export const NO_FOLD: FoldOptions = { limit: 0, scope: 'repo', alwaysShow: new Set(), extra: new Set(), sort: PRIORITY_SORT };

/** 折りたたみの中身 */
export interface Fold {
  key: string;
  /** 上限で隠した、停止中でないセッション */
  hidden: SessionView[];
  stopped: SessionView[];
  /** 中のセッションの作業フォルダのうち、コミットされていない変更が残っていて、小見出しや見出しの印に出ていないものの数 */
  changedFolders: number;
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
  /** 小見出しがないときに、カードの見出しに出す作業フォルダの変更 */
  headerChanges?: GitChanges;
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

/** shown：小見出しや見出しの印にもう出ている作業フォルダ（folderOf） */
function makeFold(key: string, hidden: SessionView[], stopped: SessionView[], shown: ReadonlySet<string>): Fold | undefined {
  if (!hidden.length && !stopped.length) return undefined;
  const changed = new Set<string>();
  for (const s of [...hidden, ...stopped]) {
    if (changeCount(s.changes) > 0 && !shown.has(folderOf(s))) changed.add(folderOf(s));
  }
  return { key, hidden, stopped, changedFolders: changed.size };
}

/**
 * カードの中の並び。ワークツリーのセッションがあるときだけ、小見出しで分ける。
 * 上限を超えたものと停止中は、折りたたみに入れる（常に表示の停止中は一覧に残す）。
 * ワークツリーごとにまとめるときは、停止中しかないワークツリーにも小見出しを出す。
 */
export function cardLayout(card: Card, opts: FoldOptions = NO_FOLD): CardLayout {
  const kept = (s: SessionView) => opts.alwaysShow.has(s.id);
  const byWorktree = opts.scope === 'worktree';
  const order = compareSessions(opts.sort.session);
  const groups = buildGroups([...card.active, ...card.stopped.filter((s) => byWorktree || kept(s))], opts.sort.worktree);
  const useSubheads = groups.some((g) => !g.isMain);
  // 小見出しがなければ、メインの作業フォルダの変更を見出しに出す（停止中のワークツリーは折りたたみの中にあり、見出しには出さない）
  const main = [...card.active, ...card.stopped].filter((s) => !s.worktree);
  const headerChanges = useSubheads ? undefined : firstChanges(main);
  const shown = new Set((useSubheads ? groups.flatMap((g) => g.sessions) : main).map(folderOf));
  const allHidden: SessionView[] = [];
  const sections = groups.map((g): Section => {
    const live = g.sessions.filter((s) => s.state !== 'stopped' || kept(s)).sort(compareSessions('priority'));
    const { visible, hidden } = pick(live, opts);
    const section: Section = { key: g.key, group: useSubheads ? g : undefined, sessions: visible.sort(order) };
    if (byWorktree) {
      const stopped = g.sessions.filter((s) => s.state === 'stopped' && !kept(s)).sort(order);
      section.fold = makeFold(`${card.key}|${g.key}|fold`, hidden.sort(order), stopped, shown);
    } else allHidden.push(...hidden);
    return section;
  });
  const stopped = card.stopped.filter((s) => !kept(s)).sort(order);
  const fold = byWorktree ? undefined : makeFold(`${card.key}|fold`, allHidden.sort(order), stopped, shown);
  return { sections, fold, headerChanges };
}

/** 折りたたみの説明（ツールチップと読み上げ用）。「ほか 2 件・停止中 3」 */
export function foldLabel(fold: Fold): string {
  const parts: string[] = [];
  if (fold.hidden.length) parts.push(`ほか ${fold.hidden.length} 件`);
  if (fold.stopped.length) parts.push(`停止中 ${fold.stopped.length}`);
  if (fold.changedFolders) parts.push(`変更が残る作業フォルダ ${fold.changedFolders}`);
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
  return buildCards(sessions, opts.sort.project).flatMap((card) => cardLayout(card, opts).sections.flatMap((g) => g.sessions));
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

/**
 * ショートカットで開くセッションの ID
 * - Claude のウィンドウが前面になければ、今開いているセッション（開き直して前面に出す）
 * - 前面にあるか、今開いているセッションが一覧にない（停止中など）ときは nextCycleTarget
 */
export function shortcutTarget(
  sessions: SessionView[],
  attention: ReadonlySet<string>,
  currentId: string | undefined,
  claudeInFront: boolean,
  opts: FoldOptions = NO_FOLD,
): string | undefined {
  if (!claudeInFront && currentId && displayOrder(sessions, opts).some((s) => s.id === currentId)) return currentId;
  return nextCycleTarget(sessions, attention, currentId, opts);
}

/** カードの見出しのバッジ。いちばん急ぐ状態の件数だけを出す */
export function cardBadge(card: Card): { state: '' | 'waiting' | 'busy'; text: string } {
  const waiting = card.active.filter((s) => s.state === 'waiting').length;
  const busy = card.active.filter((s) => s.state === 'busy').length;
  if (waiting) return { state: 'waiting', text: `要対応 ${waiting}` };
  if (busy) return { state: 'busy', text: `処理中 ${busy}` };
  return { state: '', text: '' };
}
