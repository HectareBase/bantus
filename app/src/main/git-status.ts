// 作業フォルダごとの、コミットされていない変更（git status）。ウィジェットからは読むだけで、リポジトリを書き換えない。
// 普通の git status は .git/index を書き直すことがある（index.lock を取る）ので、--no-optional-locks を付けて
// Claude 自身の git 操作とぶつからないようにする。調べ方と頻度は docs/design/git-changes.md。
// リモートの取得（git fetch）は別の待ち行列（git-fetch.ts）で、設定でオンにしたときだけ動かす。

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitChanges, SessionState, SessionView } from '../shared/types';
import { findGitDirs, folderKey } from './sessions';

/** 1 回の git status を待つ長さ。大きなリポジトリで止まらないよう、過ぎたら諦める */
const TIMEOUT_MS = 5_000;
/** 結果を使い回す長さ。動いているセッションの作業フォルダは短く、停止中だけのフォルダは長く */
const MAX_AGE_ACTIVE_MS = 30_000;
const MAX_AGE_STOPPED_MS = 5 * 60_000;

/** `git status --porcelain=v2 --branch` の出力を数える */
export function parseStatus(output: string): GitChanges {
  const changes: GitChanges = { changed: 0, untracked: 0, ahead: 0, behind: 0, merged: false };
  for (const line of output.split('\n')) {
    // 1：普通の変更、2：名前の変更やコピー、u：まだ解決していない衝突
    if (/^[12u] /.test(line)) changes.changed++;
    else if (line.startsWith('? ')) changes.untracked++;
    else {
      // 追跡するブランチがないときは出ない
      const m = /^# branch\.ab \+(\d+) -\d+/.exec(line);
      if (m) changes.ahead = Number(m[1]);
    }
  }
  return changes;
}

/**
 * 追跡するブランチの名前と、そこからの遅れ（`# branch.ab +A -B` の B）。追跡するブランチがなければ undefined。
 * 遅れはリモートの写し（refs/remotes）と比べた数なので、取得（git-fetch.ts）がオンのときだけ表示に使う
 */
export function parseUpstream(output: string): { name: string; behind: number } | undefined {
  const name = /^# branch\.upstream (\S+)/m.exec(output)?.[1];
  if (!name) return undefined;
  const m = /^# branch\.ab \+\d+ -(\d+)/m.exec(output);
  return { name, behind: m ? Number(m[1]) : 0 };
}

/** `git status --porcelain=v2 --branch` の出力に、追跡するブランチがあるか */
export function hasUpstream(output: string): boolean {
  return /^# branch\.upstream /m.test(output);
}

/** untracked が false なら未追跡のファイルを数えない（--untracked-files=no） */
export type RunStatus = (dir: string, untracked?: boolean) => Promise<string>;

/** 元のブランチ（base）と比べた結果 */
export interface BranchInfo {
  behind: number;
  /** HEAD にあって、元のブランチにまだ入っていないコミット */
  ahead: number;
  merged: boolean;
  /** 元のブランチではなく main（元のフォルダの今のブランチ）に入ってマージ済みにしたとき、そのブランチ名 */
  mergedInto?: string;
}

/**
 * remoteRef を渡すと、手元の元のブランチのほかに、そのリモートの写しに入ったかも調べる。
 * main（元のフォルダの今のブランチ）を渡すと、元のブランチに入っていないときに、そこに入ったかも調べる
 */
export type ReadBranch = (dir: string, base: string, remoteRef?: string, main?: string) => Promise<BranchInfo>;

function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', '-C', dir, ...args],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

function runGit(dir: string, untracked = true): Promise<string> {
  return git(dir, ['status', '--porcelain=v2', '--branch', ...(untracked ? [] : ['--untracked-files=no'])]);
}

/** `rev-list --left-right --count A...B` の出力（「左 右」） */
export function parseCounts(output: string): { left: number; right: number } {
  const m = /^(\d+)\s+(\d+)/.exec(output.trim());
  return m ? { left: Number(m[1]), right: Number(m[2]) } : { left: 0, right: 0 };
}

/**
 * 元のブランチからの遅れと、マージ済みかどうか（docs/design/worktree-cards.md）。
 * - 遅れ：元のブランチにあって HEAD にないコミットの数
 * - マージ済み：HEAD が元のブランチに入っていて（HEAD にしかないコミットが 0）、しかも元のブランチの first-parent の線の上にない。
 *   作ったばかりでコミットのないワークツリーは線の上にあるので、マージ済みにしない
 * 元のブランチが手元になければ、遅れ 0・マージ済みでないとする。
 * remoteRef（`refs/remotes/<リモート>/<元のブランチ>`）を渡すと、手元でマージ済みでなくても、そこに同じ決まりで入っていれば
 * マージ済みにする（GitHub でマージしたものを、手元に取り込む前に見分ける。docs/design/git-fetch.md）。遅れは手元と比べたまま
 * main（元のフォルダの今のブランチ）を渡すと、元のブランチにまだ入っていないコミットがあるときだけ、main に同じ決まりで
 * 入っていればマージ済みにして mergedInto に名前を入れる（develop から切って main にマージしたもの）。遅れと ahead は元のブランチと比べたまま
 */
export async function readBranchInfo(dir: string, base: string, run = git, remoteRef?: string, main?: string): Promise<BranchInfo> {
  const ref = `refs/heads/${base}`;
  let counts: { left: number; right: number };
  try {
    counts = parseCounts(await run(dir, ['rev-list', '--left-right', '--count', `${ref}...HEAD`]));
  } catch {
    return { behind: 0, ahead: 0, merged: false };
  }
  const info = { behind: counts.left, ahead: counts.right };
  if (await mergedInto(dir, ref, counts, run)) return { ...info, merged: true };
  if (remoteRef && (await mergedIntoRef(dir, remoteRef, run))) return { ...info, merged: true };
  // 元のブランチに入っていないコミットがあるときだけ調べる（作ったばかりのものや、元のブランチに入ったものは調べない）
  if (main && main !== base && info.ahead > 0 && (await mergedIntoRef(dir, `refs/heads/${main}`, run))) {
    return { ...info, merged: true, mergedInto: main };
  }
  return { ...info, merged: false };
}

/** コミットの ID（SHA-1 か SHA-256） */
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * 作業フォルダ dir の HEAD と、names に並べた ref（`refs/...`）の先頭のコミットを、`.git` のファイルから読む（git は起動しない）。
 * ref はばらのファイル（共有の場所 refDir の下）を先に見て、なければ packed-refs から探す。ないものは null。
 * HEAD が読めない（git の外、まだコミットがない）、reftable を使っているなど、確かに読めないときは undefined
 */
export function readRefs(dir: string, names: string[]): { head: string; refs: (string | null)[] } | undefined {
  const dirs = findGitDirs(dir);
  if (!dirs) return undefined;
  // reftable の形式は読めないので、使い回さない（毎回 git に聞く）
  if (existsSync(join(dirs.refDir, 'reftable'))) return undefined;
  let packed: Map<string, string> | undefined;
  const fromPacked = (name: string): string | null => {
    if (!packed) {
      packed = new Map();
      try {
        for (const line of readFileSync(join(dirs.refDir, 'packed-refs'), 'utf8').split(/\r?\n/)) {
          const m = /^([0-9a-f]+) (refs\/\S+)$/.exec(line);
          if (m) packed.set(m[2]!, m[1]!);
        }
      } catch {
        // packed-refs がないのは普通
      }
    }
    return packed.get(name) ?? null;
  };
  /** ref の名前からコミットへ。シンボリックな ref（`ref: ...`）は数段までたどる。読めないときは throw */
  const resolveRef = (name: string, depth = 0): string | null => {
    if (depth > 5 || !name.startsWith('refs/')) throw new Error('unresolvable ref');
    let text: string;
    try {
      text = readFileSync(join(dirs.refDir, name), 'utf8').trim();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // ない、ref の途中がファイル（refs/heads/a があって refs/heads/a/b を探した）、フォルダだった（refs/heads/a/b があって
      // refs/heads/a を探した）なら packed-refs を見る
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return fromPacked(name);
      throw e;
    }
    if (OID.test(text)) return text;
    const m = /^ref: (\S+)$/.exec(text);
    if (m) return resolveRef(m[1]!, depth + 1);
    throw new Error('unexpected ref');
  };
  try {
    // HEAD はワークツリーごと（gitDir）。ブランチを指していれば、その先頭を共有の場所から読む
    const text = readFileSync(join(dirs.gitDir, 'HEAD'), 'utf8').trim();
    const m = /^ref: (\S+)$/.exec(text);
    const head = OID.test(text) ? text : m ? resolveRef(m[1]!) : null;
    if (!head) return undefined;
    return { head, refs: names.map((n) => resolveRef(n)) };
  } catch {
    return undefined;
  }
}

/** 覚えておく作業フォルダの数の上限（古いものから捨てる） */
const BRANCH_CACHE_MAX = 200;

/**
 * readBranchInfo の結果を、HEAD と比べる ref（元のブランチ、リモートの写し、main）の先頭のコミットの組が変わるまで使い回す。
 * 結果はコミットのつながりだけで決まるので、組が同じなら git を起動しない。先頭を読めないとき（refs が undefined）と、
 * 途中で git が失敗したとき（タイムアウトなど）は覚えない
 */
export function createBranchReader(
  run: typeof git = git,
  refs: typeof readRefs = readRefs,
): ReadBranch & { stats: () => { calls: number } } {
  const cache = new Map<string, { id: string; info: BranchInfo }>();
  let calls = 0;
  const read = async (dir: string, base: string, remoteRef?: string, main?: string): Promise<BranchInfo> => {
    const names = [`refs/heads/${base}`, ...(remoteRef ? [remoteRef] : []), ...(main && main !== base ? [`refs/heads/${main}`] : [])];
    const found = refs(dir, names);
    const id = found && JSON.stringify([base, remoteRef, main, found.head, found.refs]);
    const key = folderKey(dir);
    const hit = cache.get(key);
    if (id && hit?.id === id) {
      // 使った順に並べ直す（上限を超えたら、長く使っていないものから捨てる）
      cache.delete(key);
      cache.set(key, hit);
      return { ...hit.info };
    }
    // 元のブランチが手元にない：readBranchInfo は最初の rev-list の失敗で、遅れ 0・マージ済みでないとする。git を起動するまでもない
    if (found && found.refs[0] === null) return { behind: 0, ahead: 0, merged: false };
    /** ないと読めた ref。それを渡した git の失敗は、ないせいなので覚えてよい */
    const missing = found ? names.filter((_, i) => found.refs[i] === null) : [];
    let failed = false;
    const counted: typeof git = (d, args) => {
      calls++;
      return run(d, args).catch((e) => {
        if (!missing.some((m) => args.includes(`${m}...HEAD`) || args.includes(`HEAD..${m}`))) failed = true;
        throw e;
      });
    };
    const info = await readBranchInfo(dir, base, counted, remoteRef, main);
    cache.delete(key);
    if (id && !failed) {
      cache.set(key, { id, info: { ...info } });
      while (cache.size > BRANCH_CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return info;
  };
  return Object.assign(read, { stats: () => ({ calls }) });
}

/** ref と HEAD の差を数えてから mergedInto で調べる。ref がなければ false */
async function mergedIntoRef(dir: string, ref: string, run: typeof git): Promise<boolean> {
  try {
    const counts = parseCounts(await run(dir, ['rev-list', '--left-right', '--count', `${ref}...HEAD`]));
    return await mergedInto(dir, ref, counts, run);
  } catch {
    return false;
  }
}

/** HEAD が ref に入っていて（HEAD にしかないコミットが 0）、しかも ref の first-parent の線の上にないか。counts は `ref...HEAD` の数 */
async function mergedInto(dir: string, ref: string, counts: { left: number; right: number }, run: typeof git): Promise<boolean> {
  if (counts.right > 0 || counts.left === 0) return false;
  try {
    const first = (await run(dir, ['rev-list', '--first-parent', '--reverse', `HEAD..${ref}`])).split('\n')[0]?.trim();
    if (!first) return false;
    const [parent, head] = (await run(dir, ['rev-parse', `${first}^1`, 'HEAD'])).trim().split(/\s+/);
    return !!parent && parent !== head;
  } catch {
    return false;
  }
}

/** 追跡するブランチと、そこからの遅れ */
type Upstream = { name: string; behind: number };

interface Entry {
  /** 調べられなかった（git がない、タイムアウトなど）ときは undefined */
  changes?: GitChanges;
  /** 追跡するブランチ。元のフォルダ（base がない）で、取得がオンのときだけ表示に使う */
  upstream?: Upstream;
  at: number;
}

/** 調べ方と見せ方を変える設定（メインプロセスの設定と、取得の待ち行列から） */
export interface GitOptions {
  /** 取得（git fetch）がオン。元のフォルダの遅れを出す */
  fetchEnabled: boolean;
  /** 未追跡のファイルを数える */
  countUntracked: boolean;
  /** リポジトリ（commonDir の目印）の、取得するリモート。分からなければ undefined */
  remoteOf(commonDir: string): string | undefined;
}

const DEFAULT_OPTIONS: GitOptions = { fetchEnabled: false, countUntracked: true, remoteOf: () => undefined };

/**
 * 元のフォルダのカードに出す変更。取得がオンで追跡するブランチがあれば、そこからの遅れを behind に入れる。
 * オフのときは出さない（refs/remotes の写しが古いままで、数が実際と合わないため）
 */
export function withUpstream(changes: GitChanges, upstream: Upstream | undefined, fetchEnabled: boolean): GitChanges {
  if (!fetchEnabled || !upstream || changes.gone) return changes;
  return { ...changes, behind: upstream.behind, upstream: upstream.name };
}

interface Folder {
  dir: string;
  base?: string;
  /** 元のフォルダの今のブランチ。元のブランチと違えば、マージした先として調べる */
  main?: string;
  commonDir?: string;
  states: SessionState[];
}

/**
 * 結果を作業フォルダごとに覚え、古くなったものとターンが終わったものだけを調べ直す。
 * 調べ終えて結果が変わったら onUpdate を呼ぶ。git は一度に 1 つだけ動かす
 */
export function createGitStatus(
  onUpdate: () => void,
  run: RunStatus = runGit,
  now = () => Date.now(),
  branch: ReadBranch = createBranchReader(),
  exists: (dir: string) => boolean = existsSync,
  options: () => GitOptions = () => DEFAULT_OPTIONS,
) {
  const cache = new Map<string, Entry>();
  /** 前に見たときの状態（ターンの終わりを見つけるため） */
  const lastStates = new Map<string, SessionState[]>();
  /** 作業フォルダの目印 → リポジトリの目印（取得のあとで、そのリポジトリの作業フォルダを調べ直すため） */
  const repoOf = new Map<string, string>();
  const queue: { key: string; dir: string; base?: string; main?: string; commonDir?: string }[] = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    let changed = false;
    while (queue.length) {
      const { key, dir, base, main, commonDir } = queue.shift()!;
      const opts = options();
      let changes: GitChanges | undefined;
      let upstream: Upstream | undefined;
      try {
        const output = await run(dir, opts.countUntracked);
        changes = parseStatus(output);
        if (base) {
          const remote = commonDir ? opts.remoteOf(commonDir) : undefined;
          const info = await branch(dir, base, remote ? `refs/remotes/${remote}/${base}` : undefined, main);
          changes.behind = info.behind;
          changes.merged = info.merged;
          if (info.mergedInto) changes.mergedInto = info.mergedInto;
          // Claude が作るワークツリーのブランチには、ふつう追跡するブランチがない。そのときは push していないコミットの代わりに、
          // 元のブランチにまだ入っていないコミットを数える（0 のままだと、コミットしたワークツリーに何も出ないため）
          if (!hasUpstream(output)) {
            changes.ahead = info.ahead;
            changes.aheadOfBase = true;
          }
        } else upstream = parseUpstream(output);
      } catch {
        // ワークツリーのフォルダを消したときは、カードごとアーカイブできるよう印を付ける
        changes = exists(dir) ? undefined : { changed: 0, untracked: 0, ahead: 0, behind: 0, merged: false, gone: true };
      }
      const prev = cache.get(key);
      if (JSON.stringify([prev?.changes, prev?.upstream]) !== JSON.stringify([changes, upstream])) changed = true;
      cache.set(key, { changes, ...(upstream && { upstream }), at: now() });
    }
    running = false;
    if (changed) onUpdate();
  }

  /** 作業フォルダの目印 → そのフォルダを使うセッションの状態。調べ直しが要るものを並べる */
  function update(folders: Map<string, Folder>) {
    for (const [key, { dir, base, main, commonDir, states }] of folders) {
      if (commonDir) repoOf.set(key, folderKey(commonDir));
      const prev = lastStates.get(key);
      lastStates.set(key, states);
      if (queue.some((q) => q.key === key)) continue;
      const entry = cache.get(key);
      const active = states.some((s) => s !== 'stopped');
      const maxAge = active ? MAX_AGE_ACTIVE_MS : MAX_AGE_STOPPED_MS;
      // 処理中だったセッションが処理中でなくなった：ターンが終わり、変更が増えたかもしれない
      const turnEnded = prev !== undefined && prev.filter((s) => s === 'busy').length > states.filter((s) => s === 'busy').length;
      if (!entry || now() - entry.at >= maxAge || turnEnded) queue.push({ key, dir, base, main, commonDir: commonDir && folderKey(commonDir) });
    }
    for (const key of cache.keys()) if (!folders.has(key)) cache.delete(key);
    for (const key of lastStates.keys()) if (!folders.has(key)) lastStates.delete(key);
    for (const key of repoOf.keys()) if (!folders.has(key)) repoOf.delete(key);
    void drain();
  }

  /** 一覧の各セッションに、覚えている結果を付ける（まだ調べていなければ付けない）。あわせて調べ直しを並べる */
  function apply(sessions: SessionView[]): SessionView[] {
    const folders = new Map<string, Folder>();
    for (const s of sessions) {
      if (!s.workDir) continue;
      const key = folderKey(s.workDir);
      const f = folders.get(key) ?? { dir: s.workDir, base: s.baseBranch, main: s.mainBranch, commonDir: s.commonDir, states: [] };
      f.base ??= s.baseBranch;
      f.main ??= s.mainBranch;
      f.commonDir ??= s.commonDir;
      f.states.push(s.state);
      folders.set(key, f);
    }
    update(folders);
    const { fetchEnabled } = options();
    for (const s of sessions) {
      const entry = s.workDir ? cache.get(folderKey(s.workDir)) : undefined;
      if (entry?.changes) s.changes = withUpstream(entry.changes, entry.upstream, fetchEnabled);
    }
    return sessions;
  }

  /** 次に apply を呼んだとき、そのリポジトリ（commonDir の目印）の作業フォルダを調べ直す。省くとすべて */
  function invalidate(commonDir?: string) {
    for (const [key, entry] of cache) {
      if (commonDir === undefined || repoOf.get(key) === commonDir) entry.at = -Infinity;
    }
  }

  return { apply, invalidate };
}
