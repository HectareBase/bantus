// Claude デスクトップのセッション一覧と状態を読む。データは読むだけで、書き換えない。
// 読み取り元と項目は docs/research/data-sources.md、状態の判定は docs/research/session-status.md。

import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { cardKeyOf } from '../shared/card-key';
import { createBackgroundReader } from './background-work';
import { createContextReader } from './context-usage';
import { createPlanReader } from './plan-progress';
import type { HoldMark } from '../shared/settings';
import { ja } from '../shared/strings/ja';
import type { SessionState, SessionView } from '../shared/types';

/** 読み取るフォルダ。テストでは偽のフォルダを渡す */
export interface DataPaths {
  /** CLI が動いているセッションの状態（`~/.claude/sessions`） */
  runningDir: string;
  /** デスクトップのデータ（`%LOCALAPPDATA%\Claude-Data`） */
  dataBase: string;
  /** 会話の記録（`~/.claude/projects`）。省くとコンテキストの使用量とバックグラウンドの作業を読まない */
  projectsDir?: string;
}

export function defaultPaths(): DataPaths {
  return {
    runningDir: join(homedir(), '.claude', 'sessions'),
    dataBase: join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Claude-Data'),
    projectsDir: join(homedir(), '.claude', 'projects'),
  };
}

/**
 * デスクトップのデータフォルダ（`Claude-Data\claude_*`）。
 * 本体のメッセージ専用ウィンドウのタイトルがこのフルパスになる（docs/research/deep-link-and-uia.md）
 */
export function desktopDataFolders(base = defaultPaths().dataBase): string[] {
  return listDirs(base)
    .filter((name) => name.startsWith('claude_'))
    .map((name) => join(base, name));
}

function claudeDataDirs(base: string): string[] {
  return desktopDataFolders(base).map((dir) => join(dir, 'claude-code-sessions'));
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

/**
 * 解釈した JSON を、ファイルの更新時刻、変更時刻、大きさ、ファイルの番号（置き換えると変わる）が変わるまで使い回す表。一覧を作り直すたびに、
 * アーカイブ済みも含めたすべての local_*.json を読み直さないため。
 * 返す値は表の中身そのものなので、呼び出し側で書き換えない（書き換えるなら複製する）。
 * 読めなかったもの（書き込み途中など）は覚えず、次も読み直す
 */
export function createJsonCache() {
  const entries = new Map<string, { stamp: string; data: unknown }>();
  /** 今回読んだパス（prune で、消えたファイルを表から外すため） */
  let seen = new Set<string>();
  let reads = 0;
  let stats = 0;
  return {
    read(path: string): any {
      seen.add(path);
      let stamp: string;
      stats++;
      try {
        const st = statSync(path);
        stamp = `${st.mtimeMs}|${st.ctimeMs}|${st.size}|${st.ino}`;
      } catch {
        entries.delete(path);
        return undefined;
      }
      const hit = entries.get(path);
      if (hit?.stamp === stamp) return hit.data;
      reads++;
      const data = readJson(path);
      if (data === undefined) entries.delete(path);
      else entries.set(path, { stamp, data });
      return data;
    },
    /**
     * stat をせずに、覚えている中身を返す（覚えていなければ undefined）。prune で外さないよう、読んだものとして数える。
     * ファイルが変わっていないと別の手がかりで分かっているときだけ使う
     */
    peek(path: string): any {
      const hit = entries.get(path);
      if (hit) seen.add(path);
      return hit?.data;
    },
    /** 前の prune から今までに読まなかったパスを表から外す */
    prune() {
      for (const path of entries.keys()) if (!seen.has(path)) entries.delete(path);
      seen = new Set();
    },
    /** 表の大きさと、実際にファイルを読んだ回数、stat した回数（テスト用） */
    stats: () => ({ size: entries.size, reads, stats }),
  };
}

type JsonCache = ReturnType<typeof createJsonCache>;

/** データフォルダ（dataBase）ごとの使い回しの表 */
const jsonCaches = new Map<string, JsonCache>();

/** テストで、使い回しが効いているかを見るため */
export function jsonCacheFor(dir: string): JsonCache {
  let cache = jsonCaches.get(dir);
  if (!cache) jsonCaches.set(dir, (cache = createJsonCache()));
  return cache;
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
  /** CLI が起動した時刻（Unix ミリ秒）。これより前に始まったバックグラウンドの作業は数えない */
  startedAt?: number;
}

/**
 * CLI のセッション ID → { status, waitingFor, cwd }。ファイルだけが残っているものは除く。
 * 小さく、状態（busy と idle は同じ長さ）を短い間に書き換えるので、使い回さずに毎回読む
 */
function readRunning(runningDir: string): Map<string, Running> {
  const map = new Map<string, Running>();
  for (const file of listFiles(runningDir, /^\d+\.json$/)) {
    const d = readJson(file);
    if (!d?.sessionId || !isAlive(d.pid)) continue;
    map.set(d.sessionId, {
      status: d.status,
      waitingFor: d.waitingFor,
      cwd: typeof d.cwd === 'string' ? d.cwd : undefined,
      startedAt: typeof d.startedAt === 'number' && Number.isFinite(d.startedAt) ? d.startedAt : undefined,
    });
  }
  return map;
}

export function toState(running: { status?: string } | undefined): SessionState {
  if (!running) return 'stopped';
  switch (running.status) {
    case 'waiting': return 'waiting';
    case 'busy': return 'busy';
    // shell は「待機中で、バックグラウンドの Bash が動いている」（端末版の画面だけが書く）。待機として扱い、hasShellWork で印を付ける
    // 起動直後で status がまだない一瞬も含めて待機として扱う
    default: return 'idle';
  }
}

/** status が shell（待機中で、バックグラウンドの Bash が動いている）。docs/research/session-status.md */
export function hasShellWork(running: { status?: string } | undefined): boolean {
  return running?.status === 'shell';
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
function readHeadBranch(gitDir: string, heads: Heads): string | undefined {
  return readHead(gitDir, heads).branch;
}

/** HEAD の指すもの。ブランチにいれば branch、ブランチにいない（detached HEAD）ならコミットの ID（commit） */
interface HeadState {
  branch?: string;
  commit?: string;
}

/** 一覧を 1 回作る間の、gitDir → HEAD の指すもの */
type Heads = Map<string, HeadState>;

/** `.git/HEAD` を読む。読み終えた結果は heads に入れて使い回す */
function readHead(gitDir: string, heads: Heads): HeadState {
  const hit = heads.get(gitDir);
  if (hit) return hit;
  let head: HeadState = {};
  try {
    const text = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    const branch = /^ref: refs\/heads\/(.+)$/m.exec(text)?.[1]?.trim();
    if (branch) head = { branch };
    else if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(text)) head = { commit: text };
  } catch {
    head = {};
  }
  heads.set(gitDir, head);
  return head;
}

/** detached HEAD のとき、カードの名前に使う短いコミット ID の長さ */
const SHORT_HEAD = 7;

/**
 * 元のリポジトリの既定のブランチを、共有の場所（refDir、ふつうは commonDir）の `.git` のファイルだけから読む（git は起動しない）。
 * `refs/remotes/<リモート>/HEAD`（origin を先に）の指すブランチ、`main`、`master` の順に、手元に `refs/heads/<名前>` があるものを返す。
 * どれもなければ undefined（呼び出し側が記録の分岐元を使う）。docs/design/git-changes.md の「元のフォルダが既定以外のブランチにいるとき」
 */
export function readDefaultBranch(refDir: string): string | undefined {
  let packed: Set<string> | undefined;
  const has = (name: string): boolean => {
    if (existsSync(join(refDir, 'refs', 'heads', name))) return true;
    if (!packed) {
      packed = new Set();
      try {
        for (const line of readFileSync(join(refDir, 'packed-refs'), 'utf8').split(/\r?\n/)) {
          const m = /^[0-9a-f]+ refs\/heads\/(\S+)$/.exec(line);
          if (m) packed.add(m[1]!);
        }
      } catch {
        // packed-refs がないのは普通
      }
    }
    return packed.has(name);
  };
  const byName = (a: string, b: string) => (a === 'origin' ? -1 : b === 'origin' ? 1 : a < b ? -1 : a > b ? 1 : 0);
  const names: string[] = [];
  for (const remote of listDirs(join(refDir, 'refs', 'remotes')).sort(byName)) {
    try {
      const m = /^ref: refs\/remotes\/[^/]+\/(\S+)$/.exec(readFileSync(join(refDir, 'refs', 'remotes', remote, 'HEAD'), 'utf8').trim());
      if (m) names.push(m[1]!);
    } catch {
      // HEAD のないリモートは飛ばす
    }
  }
  names.push('main', 'master');
  return names.find(has);
}

/** ワークツリーのフォルダにある `.git` ファイル（`gitdir: <場所>`）から、そのワークツリーのブランチ名を読む */
function readWorktreeBranch(worktreeDir: string, heads: Heads): string | undefined {
  try {
    const m = /^gitdir: (.+)$/m.exec(readFileSync(join(worktreeDir, '.git'), 'utf8'));
    return m?.[1] ? readHeadBranch(resolve(worktreeDir, m[1].trim()), heads) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * folder を含むワークツリーのフォルダ（`.git` がファイルで、その先が commonDir の中）。
 * メインのリポジトリ（`.git` がフォルダ）、別のリポジトリのワークツリー、git の外なら undefined。
 * mainRoot（`.git` が commonDir そのものの、元のリポジトリの一番上）まで上がったら、読まずに undefined を返す
 * （そこはワークツリーではない。`.git` がフォルダなので、読んでも EISDIR で失敗するだけ）
 */
function findWorktreeRoot(folder: string, commonDir: string, mainRoot?: string): string | undefined {
  const stop = mainRoot && folderKey(join(mainRoot, '.git')) === folderKey(resolve(commonDir)) ? folderKey(resolve(mainRoot)) : undefined;
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    if (stop && folderKey(dir) === stop) return undefined;
    gitSearchCount.worktreeReads++;
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
  gitSearchCount.anchorSearches++;
  const found = findGitDirs(folder);
  return found && { gitRoot: found.gitRoot, commonDir: found.commonDir };
}

/**
 * folder から上へ `.git` を探し、作業フォルダの一番上（gitRoot）、HEAD のある場所（gitDir）、ref を共有する場所（commonDir）を返す。
 * `.git` がフォルダならどれも同じリポジトリ。ファイル（`gitdir: <場所>`、ワークツリー）なら gitDir はその場所で、
 * commonDir はそこの `commondir`（なければ `<gitdir>/../..`）。refDir は git と同じ決まりの共有の場所で、`commondir` がなければ
 * gitDir そのもの（サブモジュールや --separate-git-dir）。ref はここから読む。読むだけで、git の外なら undefined
 */
export function findGitDirs(folder: string): { gitRoot: string; gitDir: string; commonDir: string; refDir: string } | undefined {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    const dotGit = join(dir, '.git');
    try {
      if (statSync(dotGit).isDirectory()) return { gitRoot: dir, gitDir: dotGit, commonDir: dotGit, refDir: dotGit };
      const m = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'));
      if (!m?.[1]) return undefined;
      const gitDir = resolve(dir, m[1].trim());
      let commonDir: string;
      let refDir: string;
      try {
        commonDir = refDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
      } catch {
        commonDir = resolve(gitDir, '..', '..');
        refDir = gitDir;
      }
      return { gitRoot: dir, gitDir, commonDir, refDir };
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

/** 並び順。停止中は画面では待機中と同じに見せるので、待機と同じ順位 */
const ORDER: Record<SessionState, number> = { waiting: 0, busy: 1, idle: 2, stopped: 2 };
/** 見本データの状態を進める順（WIDGET_FIXTURE_CYCLE） */
const STATES: SessionState[] = ['waiting', 'busy', 'idle', 'stopped'];

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
 * 中断（処理中か対応待ちから、ターンを終えずにプロセスが止まった）を見分ける。
 * 読むたびに前の状態と比べ、busy / waiting から stopped になったものに interrupted を付け、止まっている間は付けたままにする。
 * 動き出したら外す。前の状態を知らない（ウィジェットを起動した時点で止まっていた）ものには付けない。
 * 見本データで interrupted を書いたものは、そのまま残す
 */
export class InterruptTracker {
  private last = new Map<string, SessionState>();
  private interrupted = new Set<string>();

  apply(views: SessionView[]): SessionView[] {
    // 読めずに空のときは、覚えている状態を捨てない
    if (!views.length) return views;
    const next = new Map<string, SessionState>();
    for (const view of views) {
      const prev = this.last.get(view.id);
      next.set(view.id, view.state);
      if (view.state !== 'stopped') {
        this.interrupted.delete(view.id);
        delete view.interrupted;
        continue;
      }
      if (prev === 'busy' || prev === 'waiting') this.interrupted.add(view.id);
      if (view.interrupted || this.interrupted.has(view.id)) view.interrupted = true;
    }
    for (const id of this.interrupted) if (!next.has(id)) this.interrupted.delete(id);
    this.last = next;
    return views;
  }
}

/**
 * 開発用：環境変数 WIDGET_FIXTURE に見本データ（app/fixtures/*.json）を指定すると、実データの代わりに表示する。
 * 見本データの minutesAgo は「何分前に動きがあったか」。workDir は見本データのファイルから見た相対パスで書ける。ファイルに書いた順を作った順とする（createdAt と通し番号）。
 * busyMinutes は処理中のターンが始まってからの分（busySince になる）。起動した時刻から数えるので、表示が 1 分ごとに進む。
 * WIDGET_FIXTURE_CYCLE（秒）を付けると、その間隔ですべてのセッションの状態を 1 つずつ進める（状態の変化と並べ替えを確かめる）。
 */
let fixtureStart: number | undefined;

export function readFixture(path: string, now = Date.now(), cycle = cycleMs()): SessionView[] {
  const items = readJson(path);
  const start = (fixtureStart ??= now);
  if (!Array.isArray(items)) return [];
  const step = cycle ? Math.floor(now / cycle) : 0;
  const views: SessionView[] = items.map(({ minutesAgo, busyMinutes, hold: _hold, holdCard: _holdCard, ...s }, i) => ({
    ...s,
    ...(typeof busyMinutes === 'number' && { busySince: start - busyMinutes * 60_000 }),
    // 前の形の見本データ（遅れとマージ済みがない）も読めるようにする
    ...(s.changes && { changes: { behind: 0, merged: false, ...s.changes } }),
    // 作業フォルダ（HTML ビューアの見本）は、見本データのファイルから見た相対パスで書ける
    ...(typeof s.workDir === 'string' && s.workDir && { workDir: resolve(dirname(path), s.workDir) }),
    createdAt: i + 1,
    lastActivityAt: now - (Number(minutesAgo) || 0) * 60_000,
  }));
  assignSeq(views);
  return sortSessions(views.map((view) => {
    if (!step) return view;
    const state = STATES[(STATES.indexOf(view.state) + step) % STATES.length]!;
    // 実データと同じく、waitingFor は対応待ちのときだけ
    const waitingFor = state === 'waiting' ? view.waitingFor ?? 'input needed' : undefined;
    // タスクリストとターンの始まりは処理中のときだけ
    const { plan, busySince, ...rest } = view;
    return { ...rest, state, waitingFor, ...(state === 'busy' && plan && { plan }), ...(state === 'busy' && busySince && { busySince }) };
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

/** 会話の記録のフォルダごとの読み手（読んだ結果を呼び出しの間で使い回す） */
const contextReaders = new Map<string, ReturnType<typeof createContextReader>>();

function contextReaderFor(projectsDir: string) {
  let reader = contextReaders.get(projectsDir);
  if (!reader) contextReaders.set(projectsDir, (reader = createContextReader(projectsDir)));
  return reader;
}

/** バックグラウンドの作業を読み終えた、または記録が変わったときに呼ぶもの（watchSessions が登録する） */
const backgroundListeners = new Set<() => void>();
/** 会話の記録のフォルダごとの、バックグラウンドの作業の読み手 */
const backgroundReaders = new Map<string, ReturnType<typeof createBackgroundReader>>();

function backgroundReaderFor(projectsDir: string) {
  let reader = backgroundReaders.get(projectsDir);
  if (!reader) {
    reader = createBackgroundReader(projectsDir, () => {
      for (const listener of backgroundListeners) listener();
    });
    backgroundReaders.set(projectsDir, reader);
  }
  return reader;
}

/** 会話の記録のフォルダごとの、処理中のタスクリストの読み手（読み終えたとき、リストが変わったときは backgroundListeners に知らせる） */
const planReaders = new Map<string, ReturnType<typeof createPlanReader>>();

function planReaderFor(projectsDir: string) {
  let reader = planReaders.get(projectsDir);
  if (!reader) {
    reader = createPlanReader(projectsDir, () => {
      for (const listener of backgroundListeners) listener();
    });
    planReaders.set(projectsDir, reader);
  }
  return reader;
}

/** テストで、見張りと読む順番を止めるため */
export function disposeBackgroundReaders(): void {
  for (const reader of backgroundReaders.values()) reader.dispose();
  backgroundReaders.clear();
  for (const reader of planReaders.values()) reader.dispose();
  planReaders.clear();
}

/** `.git` の探索の結果を覚えておく長さ。ワークツリーを作ったり消したりしても、これが過ぎれば反映される */
const GIT_SEARCH_TTL_MS = 60_000;

/**
 * `.git` を実際に探した回数（テスト用）。worktreeReads は findWorktreeRoot が `.git` を読もうとした回数、
 * defaultReads は既定のブランチ（readDefaultBranch）を読んだ回数
 */
const gitSearchCount = { worktreeReads: 0, anchorSearches: 0, defaultReads: 0 };

/** 期限付きで、探した結果を使い回す表。期限の過ぎたものは sweep でまとめて捨てる */
function createTtlCache<T>() {
  const entries = new Map<string, { value: T; at: number }>();
  return {
    get(key: string, now: number, compute: () => T): T {
      const hit = entries.get(key);
      if (hit && now - hit.at < GIT_SEARCH_TTL_MS) return hit.value;
      const value = compute();
      entries.set(key, { value, at: now });
      return value;
    },
    sweep(now: number) {
      for (const [key, e] of entries) if (now - e.at >= GIT_SEARCH_TTL_MS) entries.delete(key);
    },
  };
}

type TtlCache<T> = ReturnType<typeof createTtlCache<T>>;

/** Claude でアーカイブ済みのセッションから作ったもの。通し番号と、カードをまとめるためだけに使う */
interface ArchivedEntry {
  view: SessionView;
  named?: [string, Pick<SessionView, 'worktree' | 'baseBranch'>];
  byFolder?: string;
}

/** データフォルダ（dataBase）ごとの、呼び出しをまたいで使い回す表 */
interface SessionCaches {
  /** 作業フォルダから探したワークツリーのフォルダ */
  roots: TtlCache<string | undefined>;
  /** gitAnchors のないセッションの作業フォルダから探した git の情報 */
  anchors: TtlCache<GitAnchor | undefined>;
  /** リポジトリ（commonDir）の既定のブランチ（readDefaultBranch） */
  defaults: TtlCache<string | undefined>;
  /**
   * 解釈した local_*.json の中身 → アーカイブ済みのセッションから作ったもの。createJsonCache はファイルの stamp
   * （更新時刻、変更時刻、大きさ、番号）が変わるまで同じ中身を返し、変われば読み直した別の中身を返すので、stamp が変われば作り直しになる
   */
  archived: WeakMap<object, ArchivedEntry>;
  /** アーカイブ済みのセッションを作った回数（テスト用） */
  archivedBuilds: number;
  /** フォルダごとの archived-sessions.idx の中身（readArchivedIndex） */
  indexes: Map<string, { stamp: string; ids: Set<string> | undefined }>;
  /** すべての local_*.json を最後に stat した時刻 */
  lastFullScan?: number;
  /** フォルダごとの、前回調べたときのフォルダの時刻と local_*.json の一覧 */
  dirs: Map<string, { stamp: string; files: string[] }>;
}

/** 更新時刻、変更時刻、大きさ、番号をまとめた目印。stat できなければ undefined */
function stampOf(path: string): string | undefined {
  return stampAndTimeOf(path)?.stamp;
}

/** 目印と、更新時刻と変更時刻の新しいほう。stat できなければ undefined */
function stampAndTimeOf(path: string): { stamp: string; time: number } | undefined {
  try {
    const st = statSync(path);
    return { stamp: `${st.mtimeMs}|${st.ctimeMs}|${st.size}|${st.ino}`, time: Math.max(st.mtimeMs, st.ctimeMs) };
  } catch {
    return undefined;
  }
}

/**
 * フォルダの時刻がこれより新しい（今に近い）ときは、その時刻を覚えない。ファイルの時刻の刻みは粗く
 * （Windows では 1 ミリ秒から十数ミリ秒）、同じ刻みのうちに続けて名前が変わると、フォルダの時刻は変わらない。
 * 覚えた直後に同じ刻みで書かれた変化を取りこぼさないよう、時刻が落ち着いてから覚える（git の racy-git と同じ考え）
 */
export const DIR_SETTLE_MS = 1_000;

/**
 * archived-sessions.idx を使っても、この間隔ですべての local_*.json を stat し直す（取りこぼしに備える）。
 * watchSessions の低い頻度の読み直しと同じ周期
 */
export const FULL_SCAN_MS = 30_000;

/**
 * フォルダの archived-sessions.idx（`{"v":1,"archived":["local_<uuid>", ...]}`、docs/research/data-sources.md）から、
 * アーカイブ済みのセッション ID の集合を返す。stat して、変わったときだけ読み直す。
 * ない、読めない、形が違うときは undefined（すべてを stat するやり方に戻す）
 */
function readArchivedIndex(dir: string, indexes: SessionCaches['indexes']): Set<string> | undefined {
  const path = join(dir, 'archived-sessions.idx');
  const stamp = stampOf(path);
  if (!stamp) {
    indexes.delete(dir);
    return undefined;
  }
  const hit = indexes.get(dir);
  if (hit?.stamp === stamp) return hit.ids;
  const d = readJson(path);
  const ids =
    d && d.v === 1 && Array.isArray(d.archived) && d.archived.every((id: unknown) => typeof id === 'string')
      ? new Set<string>(d.archived)
      : undefined;
  // 書き込み途中で読めなかったときは覚えない（書き終えても stamp が変わらないことがあるため）
  if (ids) indexes.set(dir, { stamp, ids });
  else indexes.delete(dir);
  return ids;
}

const sessionCaches = new Map<string, SessionCaches>();

function sessionCachesFor(dataBase: string): SessionCaches {
  let c = sessionCaches.get(dataBase);
  if (!c) {
    c = { roots: createTtlCache(), anchors: createTtlCache(), defaults: createTtlCache(), archived: new WeakMap(), archivedBuilds: 0, indexes: new Map(), dirs: new Map() };
    sessionCaches.set(dataBase, c);
  }
  return c;
}

/** 使い回しが効いているかを見るため（テスト用）。`.git` の探索の回数は、すべてのデータフォルダの合計 */
export function sessionCacheStats(dataBase: string) {
  return { archivedBuilds: sessionCachesFor(dataBase).archivedBuilds, ...gitSearchCount };
}

/** 書き換えてもよい複製（assignSeq は seq を、カードをまとめる処理は worktree と baseBranch を書き換える） */
function copyView(view: SessionView): SessionView {
  return { ...view, ...(view.worktree && { worktree: { ...view.worktree } }) };
}

/**
 * now はテストで差し替える（`.git` の探索を使い回す期限と、すべての local_*.json を stat し直す周期に使う）。
 * fsNow はファイルの時刻と比べる今の時刻（フォルダの時刻が落ち着いたかを見る）。テストで差し替える
 */
export function readSessions(paths = defaultPaths(), now = Date.now(), fsNow = Date.now()): SessionView[] {
  if (process.env.WIDGET_FIXTURE) return readFixture(process.env.WIDGET_FIXTURE);
  const running = readRunning(paths.runningDir);
  const contextReader = paths.projectsDir ? contextReaderFor(paths.projectsDir) : undefined;
  const backgroundReader = paths.projectsDir ? backgroundReaderFor(paths.projectsDir) : undefined;
  const planReader = paths.projectsDir ? planReaderFor(paths.projectsDir) : undefined;
  /** 使用量を読んだ CLI のセッション ID（使い回しの表から消えたものを外す） */
  const cliIds = new Set<string>();
  /** バックグラウンドの作業を見ている、動いている CLI のセッション ID */
  const liveCliIds = new Set<string>();
  const heads: Heads = new Map();
  const views: SessionView[] = [];
  // 通し番号を数えるためのもの。アーカイブ済みも入れる
  const numbered: SessionView[] = [];
  // 今開いているセッション（docs/research/deep-link-and-uia.md）。サイドチャットのときは親の ID にする
  let focused: { id: string; at: number } | undefined;
  /** セッションごとの最後に開いた時刻。サイドチャットは親に入れ、新しいほうを残す */
  const focusedAt = new Map<string, number>();
  // 探した結果は、呼び出しをまたいで期限まで使い回す（同じフォルダを何度も探さない）
  const caches = sessionCachesFor(paths.dataBase);
  caches.roots.sweep(now);
  caches.anchors.sweep(now);
  caches.defaults.sweep(now);
  /** 作業フォルダから探したワークツリーのフォルダ */
  const worktreeRootOf = (folder: string, commonDir: string, mainRoot: string | undefined) =>
    caches.roots.get(`${folderKey(folder)}|${folderKey(commonDir)}|${mainRoot ? folderKey(mainRoot) : ''}`, now, () =>
      findWorktreeRoot(folder, commonDir, mainRoot),
    );
  /** gitAnchors のないセッションの作業フォルダから探した git の情報 */
  const gitAnchorOf = (folder: string) => caches.anchors.get(folderKey(folder), now, () => findGitAnchor(folder));
  /** リポジトリの既定のブランチ。`.git` の探索と同じ期限で使い回す */
  const defaultBranchOf = (commonDir: string) =>
    caches.defaults.get(folderKey(commonDir), now, () => {
      gitSearchCount.defaultReads++;
      return readDefaultBranch(commonDir);
    });
  /** アプリが作ったワークツリーのフォルダ → そのセッションのワークツリー（同じフォルダで始めたセッションを同じカードにまとめる） */
  const named = new Map<string, Pick<SessionView, 'worktree' | 'baseBranch'>>();
  /** ワークツリーの名前を持たず、フォルダから見つけたセッション → そのフォルダ */
  const byFolder = new Map<SessionView, string>();
  // 解釈した中身は使い回すので、d は読むだけにする（view には値を写す）
  const files = jsonCacheFor(paths.dataBase);
  // archived-sessions.idx に載っていて、覚えている中身もアーカイブ済みのものは stat しない。ただし一定の間隔ですべてを stat し直す
  const fullScan = caches.lastFullScan === undefined || now < caches.lastFullScan || now - caches.lastFullScan >= FULL_SCAN_MS;
  if (fullScan) caches.lastFullScan = now;
  const dirs = sessionDirs(paths.dataBase);
  for (const key of caches.indexes.keys()) if (!dirs.includes(key)) caches.indexes.delete(key);
  for (const key of caches.dirs.keys()) if (!dirs.includes(key)) caches.dirs.delete(key);
  for (const dir of dirs) {
    // Claude は local_*.json を一時ファイルに書いてから名前を変えて差し替えるので、書き込むたびにフォルダの更新時刻が変わる
    // （docs/research/data-sources.md）。フォルダの時刻が前回と同じなら、一覧も中のファイルの stat も省き、前回の結果を使う。
    // 上書きで書かれたとき（フォルダの時刻が変わらない）に備え、全件の見直しではフォルダの時刻にかかわらず調べる。
    // フォルダの時刻は中を調べる前に取る（調べている間の書き込みは、次の読み直しで時刻の違いとして見つかる）
    // 時刻が今に近いときは覚えない（同じ刻みのうちに続けて書かれると、フォルダの時刻が変わらないため。DIR_SETTLE_MS）
    const dirStamp = stampAndTimeOf(dir);
    const prev = caches.dirs.get(dir);
    const same = !fullScan && dirStamp !== undefined && prev?.stamp === dirStamp.stamp;
    const list = same ? prev!.files : listFiles(dir, /^local_.*\.json$/);
    if (!same) {
      if (dirStamp && dirStamp.time <= fsNow - DIR_SETTLE_MS) caches.dirs.set(dir, { stamp: dirStamp.stamp, files: list });
      else caches.dirs.delete(dir);
    }
    const index = fullScan || same ? undefined : readArchivedIndex(dir, caches.indexes);
    for (const file of list) {
      let d: any;
      if (same) {
        // 前回読めなかったもの（覚えていない）だけ stat し直す
        d = files.peek(file);
        if (d === undefined) d = files.read(file);
      } else {
        // .idx とファイルのどちらが先に書かれるか分からないので、両方がアーカイブ済みと言うときだけ stat を省く。
        // .idx に載ったばかり（覚えている中身がまだアーカイブ済みでない）、覚えていない、.idx から外れたものは stat する
        d = index?.has(basename(file, '.json')) ? files.peek(file) : undefined;
        if (d?.isArchived !== true) d = files.read(file);
      }
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
      // アーカイブ済みは通し番号とカードをまとめるためだけに使うので、作ったものを中身が変わるまで使い回す（git の探索をやり直さない）。
      // 動いているもの（作業フォルダが途中で変わることがある）は毎回作る
      const reuse = archived && !r;
      const hit = reuse ? caches.archived.get(d) : undefined;
      if (hit) {
        const view = copyView(hit.view);
        // まとめた先のカードに worktree をそのまま渡すので、表の中身を渡さず複製する
        if (hit.named) named.set(hit.named[0], { ...hit.named[1], ...(hit.named[1].worktree && { worktree: { ...hit.named[1].worktree } }) });
        if (hit.byFolder) byFolder.set(view, hit.byFolder);
        numbered.push(view);
        continue;
      }
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
            ? worktreeRootOf(r?.cwd || d.cwd, commonDir, anchor?.gitRoot)
            : undefined;
      const outsideBranch = outside ? readWorktreeBranch(outside, heads) || basename(outside) : undefined;
      const mainHead = commonDir ? readHead(commonDir, heads) : undefined;
      // アプリが作ったワークツリーのブランチは、記録（branch）ではなく実際の HEAD から読む。ワークツリーの中でブランチを切り替えると、
      // 記録と食い違うため。読めなければ記録のまま。カードをまとめる目印は worktreeName のまま
      const namedBranch: string | undefined = d.worktreeName
        ? (typeof d.worktreePath === 'string' && d.worktreePath ? readWorktreeBranch(d.worktreePath, heads) : undefined) || d.branch || d.worktreeName
        : undefined;
      const view: SessionView = {
        id: d.sessionId,
        title: d.title || ja.session.untitled,
        // git の情報がないセッションとも同じ目印になるよう、フォルダで比べる
        repoKey: folderKey(root),
        repoName: root ? basename(root) : ja.session.noFolder,
        mainBranch: mainHead?.branch,
        ...(mainHead?.commit && { mainHead: mainHead.commit.slice(0, SHORT_HEAD) }),
        ...(commonDir && { commonDir }),
        worktree: d.worktreeName && namedBranch
          ? { key: d.worktreeName, label: shortBranch(namedBranch), branch: namedBranch }
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
      const recorded: string | undefined = typeof d.sourceBranch === 'string' && d.sourceBranch ? d.sourceBranch : undefined;
      // 遅れとマージ済みを調べる元のブランチ。アプリが作ったワークツリーは sourceBranch、自分で作ったものは元のフォルダのブランチ。
      // それがワークツリーのブランチそのもの（sourceBranch のブランチをそのままワークツリーにした）なら、既定のブランチにする
      if (view.worktree) {
        let base = recorded ?? mainBranch;
        if (base === view.worktree.branch && commonDir) base = defaultBranchOf(commonDir);
        if (base && base !== view.worktree.branch) view.baseBranch = base;
      } else if (commonDir && view.workDir) {
        // 元のフォルダが既定以外のブランチにいる、またはブランチにいないときは、既定のブランチを分岐元にする（割り出しはしない。
        // git-status.ts は、ワークツリーでないセッションの分岐元を findBase に通さない）
        const base = defaultBranchOf(commonDir) ?? recorded;
        if (base && base !== mainBranch) view.baseBranch = base;
      }
      let namedKey: string | undefined;
      let folderEntry: string | undefined;
      if (view.worktree && d.worktreeName && typeof d.worktreePath === 'string' && d.worktreePath) {
        namedKey = `${view.repoKey}|${folderKey(d.worktreePath)}`;
        named.set(namedKey, { worktree: view.worktree, baseBranch: view.baseBranch });
      } else if (view.worktree && outside) byFolder.set(view, (folderEntry = `${view.repoKey}|${folderKey(outside)}`));
      if (typeof d.spawnedFrom?.sessionId === 'string') view.spawnedFrom = d.spawnedFrom.sessionId;
      if (typeof d.turnWrapUp?.description === 'string' && d.turnWrapUp.description) view.summary = d.turnWrapUp.description;
      if (reuse) {
        // 表に入れるのは、まだ手を付けていない複製。一覧に使うほうは、このあとカードをまとめる処理と assignSeq が書き換える
        const kept = copyView(view);
        caches.archived.set(d, {
          view: kept,
          ...(namedKey && { named: [namedKey, { worktree: kept.worktree, baseBranch: kept.baseBranch }] }),
          ...(folderEntry && { byFolder: folderEntry }),
        });
        caches.archivedBuilds++;
      }
      numbered.push(view);
      if (archived) continue;
      // コンテキストの使用量。アーカイブ済みは画面に出ないので読まない
      if (contextReader && typeof d.cliSessionId === 'string' && d.cliSessionId) {
        cliIds.add(d.cliSessionId);
        const folders = [r?.cwd, d.cwd, d.originCwd, d.worktreePath].filter((f): f is string => typeof f === 'string' && !!f);
        const context = contextReader.read(d.cliSessionId, folders, typeof d.model === 'string' ? d.model : undefined);
        if (context) view.context = context;
      }
      // バックグラウンドの作業。記録を読むのは待機中のときだけ（docs/research/session-status.md の「バックグラウンドの作業」）
      if (r && typeof d.cliSessionId === 'string' && d.cliSessionId) {
        let background = 0;
        const folders = [r.cwd, d.cwd, d.originCwd, d.worktreePath].filter((f): f is string => typeof f === 'string' && !!f);
        if (backgroundReader) {
          liveCliIds.add(d.cliSessionId);
          if (state === 'idle') background = backgroundReader.read(d.cliSessionId, folders, r.startedAt) ?? 0;
          else backgroundReader.pause(d.cliSessionId);
        }
        // タスクリストの進み具合と、今のターンが始まった時刻。記録を読むのは処理中のときだけ（docs/research/work-progress.md）
        if (planReader) {
          if (state === 'busy') {
            const plan = planReader.read(d.cliSessionId, folders);
            if (plan) view.plan = plan;
            const since = planReader.since(d.cliSessionId);
            if (since !== undefined) view.busySince = since;
          } else planReader.pause(d.cliSessionId);
        }
        if (state === 'idle' && hasShellWork(r)) background = Math.max(background, 1);
        if (background > 0) view.background = background;
      }
      views.push(view);
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
  files.prune();
  assignSeq(numbered);
  contextReader?.prune(cliIds);
  backgroundReader?.prune(liveCliIds);
  planReader?.prune(liveCliIds);
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
export function watchSessions(onChange: () => void, fallbackMs = FULL_SCAN_MS,paths = defaultPaths()): () => void {
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
  // バックグラウンドの作業を読み終えたとき、作業中のセッションの記録が変わったとき
  backgroundListeners.add(schedule);

  return () => {
    backgroundListeners.delete(schedule);
    clearTimeout(timer);
    clearInterval(interval);
    for (const w of watchers) w.close();
  };
}
