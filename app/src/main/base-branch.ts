// ワークツリーの分岐元を、コミットのつながりから割り出す（docs/design/worktree-cards.md の「分岐元の割り出し」）。
// セッションの記録（local_*.json の sourceBranch）は、別のブランチから切ったワークツリーでも main のことがあるので当てにしない。
// 読むだけで、リポジトリを書き換えない。

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findGitDirs, folderKey } from './sessions';

export type RunGit = (dir: string, args: string[]) => Promise<string>;

/** 手元のブランチと HEAD の差（`%(ahead-behind:HEAD)`） */
export interface HeadRow {
  name: string;
  /** そのブランチにあって HEAD にないコミット */
  ahead: number;
  /** HEAD にあってそのブランチにないコミット。分岐点からの近さ */
  behind: number;
}

/** `for-each-ref --format=%(refname:lstrip=2) %(ahead-behind:HEAD)` の出力 */
export function parseHeadRows(output: string): HeadRow[] {
  const rows: HeadRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(\S+) (\d+) (\d+)$/.exec(line.trim());
    if (m) rows.push({ name: m[1]!, ahead: Number(m[2]), behind: Number(m[3]) });
  }
  return rows;
}

/** reflog の 1 行（`<古い> <新しい> <名前> <時刻> <時差>\t<内容>`） */
interface ReflogLine {
  next: string;
  time: number;
  message: string;
}

function parseReflog(text: string): ReflogLine[] {
  const lines: ReflogLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^[0-9a-f]+ ([0-9a-f]+) .*? (\d+) [+-]\d{4}\t(.*)$/.exec(line);
    if (m) lines.push({ next: m[1]!, time: Number(m[2]), message: m[3]! });
  }
  return lines;
}

/** 調べる自分のコミットの数の上限（引数が長くなりすぎないよう、古いものと新しいものを残す） */
const OWN_MAX = 40;

/**
 * そのブランチの上で作ったコミット（reflog の `commit` で始まる行の新しい値）。古い順で、多ければ古いものと新しいものを半分ずつ。
 * 追いつくための fast-forward（`merge main: Fast-forward`）や作成（`branch: Created from`）は含めない
 */
export function ownCommits(reflog: string): string[] {
  const all = [...new Set(parseReflog(reflog).filter((l) => /^commit\b/.test(l.message)).map((l) => l.next))];
  if (all.length <= OWN_MAX) return all;
  return [...all.slice(0, OWN_MAX / 2), ...all.slice(-OWN_MAX / 2)];
}

/** reflog の最初の行の時刻（秒）。ブランチを作った時刻か、それより後の最初の操作の時刻。reflog がなければ undefined */
export function firstTime(reflog: string): number | undefined {
  return parseReflog(reflog)[0]?.time;
}

/** 分岐元を割り出すのに使う、`.git` のファイルから読んだもの（手元のブランチすべては読まない） */
export interface RefFiles {
  /** 共有の場所（refs と logs がある） */
  refDir: string;
  /** 作業フォルダの HEAD の指すブランチ（`refs/heads/` を除いた名前）。ブランチにいなければ undefined */
  branch?: string;
  /** HEAD のコミット */
  head?: string;
  /** そのブランチが手元にあるか */
  has(name: string): boolean;
}

/** HEAD と、それが指すブランチの先頭を `.git` のファイルから読む（git は起動しない）。読めなければ undefined */
export function readRefFiles(dir: string): RefFiles | undefined {
  const dirs = findGitDirs(dir);
  if (!dirs) return undefined;
  let packed: string | undefined;
  /** packed-refs の中のそのブランチの先頭。なければ undefined */
  const fromPacked = (name: string): string | undefined => {
    if (packed === undefined) {
      try {
        packed = readFileSync(join(dirs.refDir, 'packed-refs'), 'utf8');
      } catch {
        packed = '';
      }
    }
    const at = packed.indexOf(` refs/heads/${name}\n`);
    if (at < 0) return undefined;
    return packed.slice(packed.lastIndexOf('\n', at) + 1, at);
  };
  const loose = (name: string): string | undefined => {
    try {
      return readFileSync(join(dirs.refDir, 'refs', 'heads', name), 'utf8').trim();
    } catch {
      return undefined;
    }
  };
  let text: string;
  try {
    text = readFileSync(join(dirs.gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return undefined;
  }
  const branch = /^ref: refs\/heads\/(\S+)$/.exec(text)?.[1];
  const head = branch ? (loose(branch) ?? fromPacked(branch)) : /^[0-9a-f]+$/.test(text) ? text : undefined;
  return {
    refDir: dirs.refDir,
    ...(branch && { branch }),
    ...(head && { head }),
    has: (name) => existsSync(join(dirs.refDir, 'refs', 'heads', name)) || fromPacked(name) !== undefined,
  };
}

function reflogPath(refDir: string, name: string): string {
  return join(refDir, 'logs', 'refs', 'heads', name);
}

function readReflog(refDir: string, name: string): string {
  try {
    return readFileSync(reflogPath(refDir, name), 'utf8');
  } catch {
    return '';
  }
}

/** reflog の最初の行の時刻だけを読む（ファイルの頭だけ読む）。なければ undefined */
function reflogStart(refDir: string, name: string): number | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(reflogPath(refDir, name), 'r');
    const buf = Buffer.alloc(1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return firstTime(buf.toString('utf8', 0, n).split('\n')[0]!);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** reflog の大きさ（使い回すかどうかの目印）。なければ 0 */
function reflogSize(refDir: string, name: string): number {
  try {
    return statSync(reflogPath(refDir, name)).size;
  } catch {
    return 0;
  }
}

/**
 * 分岐元を割り出す。preferred は同じ近さのときに選ぶ順（記録の分岐元、元のフォルダのブランチ）。
 * 1. 手元のブランチ（作業フォルダのブランチを除く）と HEAD の差を 1 回の for-each-ref で数える
 * 2. 作業フォルダのブランチより後に作ったブランチ（このワークツリーから切ったものなど）は外す。作った時刻は reflog の最初の行
 * 3. 作業フォルダのブランチの上で作ったコミットを含むブランチは、分岐元ではなくマージした先として分ける
 * 4. 残りから、HEAD にしかないコミットが一番少ない（分岐点が一番近い）ものを選ぶ。同じ近さなら記録の分岐元、元のフォルダのブランチ、
 *    先に作ったものの順
 * 5. マージした先のうち、マージコミットで取り込んだものは、取り込む前の先頭と比べて同じかより近ければ、そちらを選ぶ
 *    （develop から切って develop にマージしたもの。main にだけマージしたものは develop のほうが近い）
 * 決められなければ undefined
 */
export async function inferBaseBranch(dir: string, files: RefFiles, preferred: string[], run: RunGit): Promise<string | undefined> {
  const own = files.branch;
  if (!own || !files.head) return undefined;
  const rows = parseHeadRows(await run(dir, ['for-each-ref', '--format=%(refname:lstrip=2) %(ahead-behind:HEAD)', 'refs/heads/'])).filter(
    (r) => r.name !== own,
  );
  if (!rows.length) return undefined;
  const ownReflog = readReflog(files.refDir, own);
  const ownTime = firstTime(ownReflog);
  /**
   * 作った時刻。reflog がないもの（packed-refs だけの古いブランチなど）は一番古いとみなす。
   * ブランチが大量にあるとファイルを開くだけで時間がかかるので、要るものだけを、要るときに、頭だけ読む
   */
  const bornOf = new Map<string, number>();
  const born = (name: string) => {
    let t = bornOf.get(name);
    if (t === undefined) bornOf.set(name, (t = reflogStart(files.refDir, name) ?? -Infinity));
    return t;
  };
  const isOlder = (r: HeadRow) => ownTime === undefined || born(r.name) <= ownTime;

  // 自分のコミットのうち、まだあるもの（書き直して消えたものを渡すと for-each-ref が失敗する）
  const listed = ownCommits(ownReflog);
  const existing = listed.length
    ? (await run(dir, ['rev-list', '--no-walk', '--ignore-missing', ...listed]))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  let clean = rows;
  let targets: HeadRow[] = [];
  if (existing.length) {
    const out = await run(dir, ['for-each-ref', '--format=%(refname:lstrip=2)', ...existing.map((c) => `--no-contains=${c}`), 'refs/heads/']);
    const names = new Set(out.split(/\r?\n/).map((s) => s.trim()));
    clean = rows.filter((r) => names.has(r.name));
    targets = rows.filter((r) => !names.has(r.name) && r.behind === 0 && isOlder(r));
  }

  const rank = (name: string) => {
    const i = preferred.indexOf(name);
    return i < 0 ? preferred.length : i;
  };
  // 同じ近さなら、記録の分岐元、元のフォルダのブランチ、先に作ったもの（同じ所から切った兄弟より、切った元のほうが古い）の順
  const byNear = (a: HeadRow, b: HeadRow) =>
    a.behind - b.behind ||
    rank(a.name) - rank(b.name) ||
    born(a.name) - born(b.name) ||
    a.ahead - b.ahead ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  /** 近い順に、同じ近さの組ごとに見て、後から作ったものを除いて残れば、その組から選ぶ（作った時刻は見た組の分だけ読む） */
  const pick = (list: HeadRow[]): HeadRow | undefined => {
    const sorted = [...list].sort((a, b) => a.behind - b.behind);
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j < sorted.length && sorted[j]!.behind === sorted[i]!.behind) j++;
      const group = sorted.slice(i, j);
      // 記録の分岐元か元のフォルダのブランチが組にあれば、ほかの時刻は読まずに決まる
      const first = group.filter((r) => rank(r.name) < preferred.length && isOlder(r)).sort(byNear)[0];
      if (first) return first;
      const older = group.filter(isOlder);
      if (older.length) return older.sort(byNear)[0];
      i = j;
    }
    return undefined;
  };
  const best = pick(clean);

  // マージした先：マージコミットで取り込んだものは、取り込む前の先頭から HEAD までの近さ。
  // fast-forward で入ったもの（first-parent の線の上に HEAD がある）は、HEAD から first-parent をたどって続く自分のコミットの数
  const merged: HeadRow[] = [];
  let ownRun: number | undefined;
  for (const t of targets) {
    let near = await mergedDistance(dir, `refs/heads/${t.name}`, run);
    if (near === undefined) {
      ownRun ??= await leadingOwn(dir, new Set(existing), run);
      near = ownRun;
    }
    merged.push({ name: t.name, ahead: t.ahead, behind: near });
  }
  const mergedBest = pick(merged);
  if (mergedBest && (!best || mergedBest.behind <= best.behind)) return mergedBest.name;
  return best?.name;
}

/**
 * ref が HEAD をマージコミットで取り込んでいれば、取り込む前の先頭にない HEAD のコミットの数。
 * ref の first-parent の線の上に HEAD がある（fast-forward、追いついただけ）なら undefined
 */
async function mergedDistance(dir: string, ref: string, run: RunGit): Promise<number | undefined> {
  try {
    const first = (await run(dir, ['rev-list', '--first-parent', '--reverse', `HEAD..${ref}`])).split(/\r?\n/)[0]?.trim();
    if (!first) return undefined;
    const [parent, head] = (await run(dir, ['rev-parse', `${first}^1`, 'HEAD'])).trim().split(/\s+/);
    if (!parent || parent === head) return undefined;
    return Number((await run(dir, ['rev-list', '--count', `${parent}..HEAD`])).trim()) || 0;
  } catch {
    return undefined;
  }
}

/** HEAD から first-parent をたどって、自分のコミット（own）が続く数。分岐した点から HEAD までの近さ */
async function leadingOwn(dir: string, own: Set<string>, run: RunGit): Promise<number> {
  const chain = (await run(dir, ['rev-list', '--first-parent', `--max-count=${own.size + 1}`, 'HEAD'])).split(/\r?\n/).map((s) => s.trim());
  let n = 0;
  while (n < chain.length && own.has(chain[n]!)) n++;
  return n;
}

/** 覚えておく作業フォルダの数の上限（古いものから捨てる） */
const CACHE_MAX = 200;

/** 分岐元を割り出す。recorded は記録の分岐元（割り出せなければこれを返す）、main は元のフォルダの今のブランチ */
export type FindBase = (dir: string, recorded: string, main?: string) => Promise<string>;

/** ほかのブランチが動いただけのときに、前の答えを使い回す長さ */
const REFRESH_MS = 30 * 60_000;

/**
 * inferBaseBranch の答えを使い回す。調べ直すのは、HEAD か作業フォルダのブランチの reflog が変わったとき、選んだ分岐元が消えたとき、
 * REFRESH_MS たったときだけ。ほかのブランチが動いても調べ直さない：後から作ったブランチは分岐元にならず、分岐点も動かないので、
 * 答えはふつう変わらない。手元のブランチすべての先頭は読まない（大量にあると、読むだけでメインのプロセスが止まるため）。
 * `.git` を読めないときは記録の分岐元を返す。git が失敗したとき（`ahead-behind` のない古い git、時間切れなど）も記録の分岐元を返し、
 * それを答えとして同じ決まりで使い回す
 */
export function createBaseFinder(
  run: RunGit,
  read: (dir: string) => RefFiles | undefined = readRefFiles,
  now: () => number = Date.now,
): FindBase & { stats: () => { calls: number } } {
  const cache = new Map<string, { id: string; base: string | undefined; at: number }>();
  let calls = 0;
  const counted: RunGit = (d, args) => {
    calls++;
    return run(d, args);
  };
  const find = async (dir: string, recorded: string, main?: string): Promise<string> => {
    const files = read(dir);
    if (!files?.branch || !files.head) return recorded;
    const preferred = [recorded, ...(main && main !== recorded ? [main] : [])];
    const id = JSON.stringify([preferred, files.branch, files.head, reflogSize(files.refDir, files.branch)]);
    const key = folderKey(dir);
    const hit = cache.get(key);
    if (hit?.id === id && now() - hit.at < REFRESH_MS && (!hit.base || files.has(hit.base))) return hit.base ?? recorded;
    let base: string | undefined;
    try {
      base = await inferBaseBranch(dir, files, preferred, counted);
    } catch {
      // 失敗も覚える（記録の分岐元を使う）。ブランチが多すぎて時間切れになるリポジトリで、調べ直しのたびに git を待たないため
      base = undefined;
    }
    cache.delete(key);
    cache.set(key, { id, base, at: now() });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return base ?? recorded;
  };
  return Object.assign(find, { stats: () => ({ calls }) });
}
