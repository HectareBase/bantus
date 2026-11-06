// Claude デスクトップのセッション一覧と状態を読む。データは読むだけで、書き換えない。
// 読み取り元と項目は docs/research/data-sources.md、状態の判定は docs/research/session-status.md。

import { readFileSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { cardKeyOf } from '../shared/card-key';
import type { HoldMark } from '../shared/settings';
import type { SessionState, SessionView } from '../shared/types';

/** 読み取るフォルダ。テストでは偽のフォルダを渡す */
export interface DataPaths {
  /** CLI が動いているセッションの状態（`~/.claude/sessions`） */
  runningDir: string;
  /** デスクトップのデータ（`%LOCALAPPDATA%\Claude-Data`） */
  dataBase: string;
}

export function defaultPaths(): DataPaths {
  return {
    runningDir: join(homedir(), '.claude', 'sessions'),
    dataBase: join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Claude-Data'),
  };
}

function claudeDataDirs(base: string): string[] {
  return listDirs(base)
    .filter((name) => name.startsWith('claude_'))
    .map((name) => join(base, name, 'claude-code-sessions'));
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function listFiles(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir).filter((name) => pattern.test(name)).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** 書き込み途中のファイルを読むことがあるので、失敗したら undefined */
function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function isAlive(pid: unknown): boolean {
  if (typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // 権限がなくて調べられないだけなら、動いている
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface Running {
  status?: string;
  waitingFor?: string;
  /** CLI の今の作業フォルダ。途中でワークツリーに入ると、local_*.json の cwd と違う値になる */
  cwd?: string;
}

/** CLI のセッション ID → { status, waitingFor, cwd }。ファイルだけが残っているものは除く */
function readRunning(runningDir: string): Map<string, Running> {
  const map = new Map<string, Running>();
  for (const file of listFiles(runningDir, /^\d+\.json$/)) {
    const d = readJson(file);
    if (!d?.sessionId || !isAlive(d.pid)) continue;
    map.set(d.sessionId, { status: d.status, waitingFor: d.waitingFor, cwd: typeof d.cwd === 'string' ? d.cwd : undefined });
  }
  return map;
}

export function toState(running: { status?: string } | undefined): SessionState {
  if (!running) return 'stopped';
  switch (running.status) {
    case 'waiting': return 'waiting';
    case 'busy': return 'busy';
    // 起動直後で status がまだない一瞬も含めて待機として扱う
    default: return 'idle';
  }
}

/** 読み取っているフォルダ（設定画面の「情報」用） */
export function sessionDataFolders(paths = defaultPaths()): string[] {
  if (process.env.WIDGET_FIXTURE) return [process.env.WIDGET_FIXTURE];
  return [paths.runningDir, ...claudeDataDirs(paths.dataBase)];
}

/** local_*.json が入っているフォルダ（アカウントごと） */
function sessionDirs(dataBase: string): string[] {
  const dirs: string[] = [];
  for (const root of claudeDataDirs(dataBase)) {
    for (const a of listDirs(root)) {
      for (const b of listDirs(join(root, a))) dirs.push(join(root, a, b));
    }
  }
  return dirs;
}

/** `.git/HEAD`（ワークツリーなら `.git/worktrees/<名前>/HEAD`）から今のブランチ名を読む。読み終えた結果は heads に入れて使い回す */
function readHeadBranch(gitDir: string, heads: Map<string, string | undefined>): string | undefined {
  if (heads.has(gitDir)) return heads.get(gitDir);
  let branch: string | undefined;
  try {
    const m = /^ref: refs\/heads\/(.+)$/m.exec(readFileSync(join(gitDir, 'HEAD'), 'utf8'));
    branch = m?.[1]?.trim();
  } catch {
    branch = undefined;
  }
  heads.set(gitDir, branch);
  return branch;
}

/** ワークツリーのフォルダにある `.git` ファイル（`gitdir: <場所>`）から、そのワークツリーのブランチ名を読む */
function readWorktreeBranch(worktreeDir: string, heads: Map<string, string | undefined>): string | undefined {
  try {
    const m = /^gitdir: (.+)$/m.exec(readFileSync(join(worktreeDir, '.git'), 'utf8'));
    return m?.[1] ? readHeadBranch(resolve(worktreeDir, m[1].trim()), heads) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * folder を含むワークツリーのフォルダ（`.git` がファイルで、その先が commonDir の中）。
 * メインのリポジトリ（`.git` がフォルダ）、別のリポジトリのワークツリー、git の外なら undefined
 */
function findWorktreeRoot(folder: string, commonDir: string): string | undefined {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    try {
      const m = /^gitdir: (.+)$/m.exec(readFileSync(join(dir, '.git'), 'utf8'));
      const gitDir = m?.[1] ? folderKey(resolve(dir, m[1].trim())) : '';
      return gitDir.startsWith(`${folderKey(resolve(commonDir))}${sep}`) ? dir : undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** gitAnchors の 1 つ目と同じ形（gitRoot は作業フォルダの一番上、commonDir は元のリポジトリの .git） */
interface GitAnchor {
  gitRoot: string;
  commonDir: string;
}

/**
 * gitAnchors を持たないセッションのために、folder から上へ `.git` を探す。読むだけで、何も書き込まない。
 * `.git` がフォルダならそのリポジトリ、ファイル（`gitdir: <場所>`）ならワークツリーで、その gitdir の `commondir`
 * （なければ `<gitdir>/../..`）を commonDir とする。git の外なら undefined
 */
function findGitAnchor(folder: string): GitAnchor | undefined {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    const dotGit = join(dir, '.git');
    try {
      if (statSync(dotGit).isDirectory()) return { gitRoot: dir, commonDir: dotGit };
      const m = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'));
      if (!m?.[1]) return undefined;
      const gitDir = resolve(dir, m[1].trim());
      let commonDir: string;
      try {
        commonDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
      } catch {
        commonDir = resolve(gitDir, '..', '..');
      }
      return { gitRoot: dir, commonDir };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

export const folderKey =(path: string) => path.replace(/[\\/]+$/, '').toLowerCase();

/** `claude/xenodochial-golick-8c38f8` → `xenodochial-golick` */
export function shortBranch(branch: string): string {
  return branch.replace(/^claude\//, '').replace(/-[0-9a-f]{6}$/, '');
}

const ORDER: Record<SessionState, number> = { waiting: 0, busy: 1, idle: 2, stopped: 3 };
const STATES = Object.keys(ORDER) as SessionState[];

function sortSessions(views: SessionView[]): SessionView[] {
  return views.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.lastActivityAt - a.lastActivityAt);
}

/**
 * ワークツリーごとの通し番号（seq）を振る。同じリポジトリの同じワークツリー（メインも 1 つとして数える）の中で、作った順に 1 から。
 * アーカイブ済みも数えるので、アーカイブしても番号は変わらない（削除するとそれより新しいものが詰まる）
 */
export function assignSeq(views: SessionView[]): void {
  const groups = new Map<string, SessionView[]>();
  for (const view of views) {
    const key = `${view.repoKey}|${view.worktree?.key ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(view);
    else groups.set(key, [view]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    list.forEach((view, i) => (view.seq = i + 1));
  }
}

/** 開発用の巡回の間隔（ミリ秒）。WIDGET_FIXTURE_CYCLE（秒）がなければ 0 */
function cycleMs(): number {
  return Math.max(0, Number(process.env.WIDGET_FIXTURE_CYCLE) || 0) * 1000;
}

/**
 * 開発用：環境変数 WIDGET_FIXTURE に見本データ（app/fixtures/*.json）を指定すると、実データの代わりに表示する。
 * 見本データの minutesAgo は「何分前に動きがあったか」。ファイルに書いた順を作った順とする（createdAt と通し番号）。
 * WIDGET_FIXTURE_CYCLE（秒）を付けると、その間隔ですべてのセッションの状態を 1 つずつ進める（状態の変化と並べ替えを確かめる）。
 */
export function readFixture(path: string, now = Date.now(), cycle = cycleMs()): SessionView[] {
  const items = readJson(path);
  if (!Array.isArray(items)) return [];
  const step = cycle ? Math.floor(now / cycle) : 0;
  const views: SessionView[] = items.map(({ minutesAgo, hold: _hold, holdCard: _holdCard, ...s }, i) => ({
    ...s,
    // 前の形の見本データ（遅れとマージ済みがない）も読めるようにする
    ...(s.changes && { changes: { behind: 0, merged: false, ...s.changes } }),
    createdAt: i + 1,
    lastActivityAt: now - (Number(minutesAgo) || 0) * 60_000,
  }));
  assignSeq(views);
  return sortSessions(views.map((view) => {
    if (!step) return view;
    const state = STATES[(STATES.indexOf(view.state) + step) % STATES.length]!;
    // 実データと同じく、waitingFor は対応待ちのときだけ
    const waitingFor = state === 'waiting' ? view.waitingFor ?? 'input needed' : undefined;
    return { ...view, state, waitingFor };
  }));
}

/**
 * 見本データの保留の印。項目の hold（そのセッション）と holdCard（そのセッションのカード）に
 * `{ "note": "メモ", "minutesAgo": 保留にしてからの分 }` を書く。ウィジェットの設定に入れて見せる（docs/design/hold.md）
 */
export function readFixtureHolds(path: string, now = Date.now()): { holds: Record<string, HoldMark>; heldCards: Record<string, HoldMark> } {
  const holds: Record<string, HoldMark> = {};
  const heldCards: Record<string, HoldMark> = {};
  const items = readJson(path);
  if (!Array.isArray(items)) return { holds, heldCards };
  const mark = (v: unknown): HoldMark | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const { note, minutesAgo } = v as Record<string, unknown>;
    return { note: typeof note === 'string' ? note : '', since: now - (Number(minutesAgo) || 0) * 60_000 };
  };
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
    const own = mark(item.hold);
    if (own) holds[item.id] = own;
    const card = mark(item.holdCard);
    if (card) heldCards[cardKeyOf(item as SessionView)] = card;
  }
  return { holds, heldCards };
}

export function readSessions(paths = defaultPaths()): SessionView[] {
  if (process.env.WIDGET_FIXTURE) return readFixture(process.env.WIDGET_FIXTURE);
  const running = readRunning(paths.runningDir);
  const heads = new Map<string, string | undefined>();
  const views: SessionView[] = [];
  // 通し番号を数えるためのもの。アーカイブ済みも入れる
  const numbered: SessionView[] = [];
  // 今開いているセッション（docs/research/deep-link-and-uia.md）。サイドチャットのときは親の ID にする
  let focused: { id: string; at: number } | undefined;
  /** セッションごとの最後に開いた時刻。サイドチャットは親に入れ、新しいほうを残す */
  const focusedAt = new Map<string, number>();
  /** 作業フォルダから探したワークツリーのフォルダ（同じフォルダを何度も探さない） */
  const roots = new Map<string, string | undefined>();
  const worktreeRootOf = (folder: string, commonDir: string) => {
    const k = `${folderKey(folder)}|${folderKey(commonDir)}`;
    if (!roots.has(k)) roots.set(k, findWorktreeRoot(folder, commonDir));
    return roots.get(k);
  };
  /** gitAnchors のないセッションの作業フォルダから探した git の情報（同じフォルダを何度も探さない） */
  const found = new Map<string, GitAnchor | undefined>();
  const gitAnchorOf = (folder: string) => {
    const k = folderKey(folder);
    if (!found.has(k)) found.set(k, findGitAnchor(folder));
    return found.get(k);
  };
  /** アプリが作ったワークツリーのフォルダ → そのセッションのワークツリー（同じフォルダで始めたセッションを同じカードにまとめる） */
  const named = new Map<string, Pick<SessionView, 'worktree' | 'baseBranch'>>();
  /** ワークツリーの名前を持たず、フォルダから見つけたセッション → そのフォルダ */
  const byFolder = new Map<SessionView, string>();
  for (const dir of sessionDirs(paths.dataBase)) {
    for (const file of listFiles(dir, /^local_.*\.json$/)) {
      const d = readJson(file);
      if (!d?.sessionId) continue;
      const archived = Boolean(d.isArchived);
      const at = Number(d.lastFocusedAt) || 0;
      // サイドチャット（btw）はデスクトップのサイドバーに出ないので、一覧には入れない。開いているのは親として扱う
      const btwParent = d.spawnedFrom?.btw ? d.spawnedFrom.sessionId : undefined;
      const focusId: string = btwParent || d.sessionId;
      if (!archived && at && (!focused || at > focused.at)) focused = { id: focusId, at };
      if (!archived && at > (focusedAt.get(focusId) ?? 0)) focusedAt.set(focusId, at);
      if (btwParent) continue;
      const r = running.get(d.cliSessionId);
      const state = toState(r);
      const summary = d.postTurnSummary ?? {};
      // リポジトリの外のワークツリー（git worktree add）で始めたセッションには gitAnchors がないことがあるので、作業フォルダから探す
      const startDir: string = d.originCwd || d.cwd || '';
      const anchor: GitAnchor | undefined = Array.isArray(d.gitAnchors)
        ? d.gitAnchors[0]
        : startDir
          ? gitAnchorOf(startDir)
          : undefined;
      // アプリが作ったワークツリーでは gitRoot が元のリポジトリを指す。リポジトリの外のワークツリー（git worktree add）では
      // gitRoot がワークツリーのフォルダになるので、commonDir（元のリポジトリの .git）の親を元のリポジトリとする
      const commonDir: string | undefined = anchor?.commonDir;
      const repoRoot = commonDir && basename(commonDir).toLowerCase() === '.git' ? dirname(commonDir) : anchor?.gitRoot;
      const root: string = repoRoot || d.originCwd || d.cwd || '';
      // 動いている CLI が途中でワークツリーに入ったとき（EnterWorktree）は local_*.json が元のままなので、CLI の今の作業フォルダから探す。
      // ワークツリーのセッションが作業フォルダを分けずに始めたセッション（use_worktree: false）は、名前を持たず、
      // gitRoot も元のリポジトリを指すので、セッションの作業フォルダ（cwd）から探す
      const outside: string | undefined = d.worktreeName
        ? undefined
        : anchor?.gitRoot && folderKey(anchor.gitRoot) !== folderKey(root)
          ? anchor.gitRoot
          : commonDir && (r?.cwd || d.cwd)
            ? worktreeRootOf(r?.cwd || d.cwd, commonDir)
            : undefined;
      const outsideBranch = outside ? readWorktreeBranch(outside, heads) || basename(outside) : undefined;
      const view: SessionView = {
        id: d.sessionId,
        title: d.title || '(無題)',
        // git の情報がないセッションとも同じ目印になるよう、フォルダで比べる
        repoKey: folderKey(root),
        repoName: root ? basename(root) : '(フォルダなし)',
        mainBranch: commonDir ? readHeadBranch(commonDir, heads) : undefined,
        worktree: d.worktreeName
          ? { key: d.worktreeName, label: shortBranch(d.branch || d.worktreeName), branch: d.branch || d.worktreeName }
          : outside && outsideBranch
            ? { key: folderKey(outside), label: shortBranch(outsideBranch), branch: outsideBranch }
            : undefined,
        // git 管理のフォルダだけ。ワークツリーならその場所、そうでなければリポジトリのフォルダ
        workDir: anchor ? d.worktreePath || outside || root || undefined : undefined,
        state,
        waitingFor: state === 'waiting' ? r?.waitingFor : undefined,
        needsAction: summary.needs_action || undefined,
        detail: summary.status_detail || undefined,
        createdAt: Number(d.createdAt) || 0,
        lastActivityAt: Number(d.lastActivityAt) || 0,
      };
      const mainBranch = view.mainBranch;
      // 遅れとマージ済みを調べる元のブランチ。アプリが作ったワークツリーは sourceBranch、自分で作ったものは元のフォルダのブランチ
      if (view.worktree) {
        const base = typeof d.sourceBranch === 'string' && d.sourceBranch ? d.sourceBranch : mainBranch;
        if (base && base !== view.worktree.branch) view.baseBranch = base;
      }
      if (view.worktree && d.worktreeName && typeof d.worktreePath === 'string' && d.worktreePath) {
        named.set(`${view.repoKey}|${folderKey(d.worktreePath)}`, { worktree: view.worktree, baseBranch: view.baseBranch });
      } else if (view.worktree && outside) byFolder.set(view, `${view.repoKey}|${folderKey(outside)}`);
      if (typeof d.spawnedFrom?.sessionId === 'string') view.spawnedFrom = d.spawnedFrom.sessionId;
      if (typeof d.turnWrapUp?.description === 'string' && d.turnWrapUp.description) view.summary = d.turnWrapUp.description;
      numbered.push(view);
      if (!archived) views.push(view);
    }
  }
  // フォルダから見つけたワークツリーが、アプリが作ったワークツリーと同じフォルダなら、同じ目印（名前）にそろえて 1 枚のカードにまとめる
  for (const [view, folder] of byFolder) {
    const same = named.get(folder);
    if (!same?.worktree) continue;
    view.worktree = same.worktree;
    if (same.baseBranch) view.baseBranch = same.baseBranch;
    else delete view.baseBranch;
  }
  assignSeq(numbered);
  // 親がアーカイブ済みなどで一覧にないときは、どの行も塗らない
  for (const view of views) {
    const at = focusedAt.get(view.id);
    if (at) view.focusedAt = at;
  }
  const focusedId = focused?.id;
  const focusedView = focusedId && views.find((s) => s.id === focusedId);
  if (focusedView) focusedView.focused = true;
  return sortSessions(views);
}

/**
 * 2 種類のフォルダを見張り、変化があったら（まとめて）onChange を呼ぶ。
 * fs.watch は取りこぼすことがあるので、低い頻度の読み直しも続ける。
 */
export function watchSessions(onChange: () => void, fallbackMs = 30_000, paths = defaultPaths()): () => void {
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };

  // 見本データのときは、そのファイルを見張る（書き換えるとすぐ表示に出る）
  const fixture = process.env.WIDGET_FIXTURE;
  const targets = fixture ? [fixture] : [paths.runningDir, ...claudeDataDirs(paths.dataBase)];
  const watchers: FSWatcher[] = [];
  for (const target of targets) {
    try {
      watchers.push(watch(target, { recursive: !fixture }, schedule));
    } catch {
      // フォルダがまだない場合は、低い頻度の読み直しに任せる
    }
  }
  const interval = setInterval(onChange, (fixture && cycleMs()) || fallbackMs);

  return () => {
    clearTimeout(timer);
    clearInterval(interval);
    for (const w of watchers) w.close();
  };
}
