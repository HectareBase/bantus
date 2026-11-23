// ワークツリーの分岐元を、コミットのつながりから割り出す（docs/design/worktree-cards.md の「分岐元の割り出し」）。
// セッションの記録（local_*.json の sourceBranch）は、別のブランチから切ったワークツリーでも main のことがあるので当てにしない。
// 読むだけで、リポジトリを書き換えない。

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BaseCandidate, BaseChoices } from '../shared/types';
import { readPackedRefs, type PackedRefs } from './packed-refs';
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
  prev: string;
  next: string;
  time: number;
  message: string;
}

function parseReflog(text: string): ReflogLine[] {
  const lines: ReflogLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]+) ([0-9a-f]+) .*? (\d+) [+-]\d{4}\t(.*)$/.exec(line);
    if (m) lines.push({ prev: m[1]!, next: m[2]!, time: Number(m[3]), message: m[4]! });
  }
  return lines;
}

/** 調べる自分のコミットの数の上限（引数が長くなりすぎないよう、古いものと新しいものを残す） */
const OWN_MAX = 40;

/** reflog の `commit` で始まる行の新しい値。古い順で重ねない */
function allOwnCommits(reflog: string): string[] {
  return [...new Set(parseReflog(reflog).filter((l) => /^commit\b/.test(l.message)).map((l) => l.next))];
}

/**
 * そのブランチの上で作ったコミット（reflog の `commit` で始まる行の新しい値）。古い順で、多ければ古いものと新しいものを半分ずつ。
 * 追いつくための fast-forward（`merge main: Fast-forward`）や作成（`branch: Created from`）は含めない
 */
export function ownCommits(reflog: string): string[] {
  const all = allOwnCommits(reflog);
  if (all.length <= OWN_MAX) return all;
  return [...all.slice(0, OWN_MAX / 2), ...all.slice(-OWN_MAX / 2)];
}

/** reflog の最初の行の時刻（秒）。ブランチを作った時刻か、それより後の最初の操作の時刻。reflog がなければ undefined */
export function firstTime(reflog: string): number | undefined {
  return parseReflog(reflog)[0]?.time;
}

/**
 * ブランチが始まったコミット。作成の行があればその新しい値、なければ（アプリが作ったブランチは最初のコミットから記録される）最初の行の古い値。
 * 自分のコミットから始まったブランチは、このワークツリーから切った子
 */
export function startCommit(reflog: string): string | undefined {
  const first = parseReflog(reflog)[0];
  if (!first) return undefined;
  return /^0+$/.test(first.prev) ? first.next : first.prev;
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
  let packed: PackedRefs | undefined;
  /** packed-refs の中のそのブランチの先頭。なければ undefined */
  const fromPacked = (name: string): string | undefined => {
    packed ??= readPackedRefs(dirs.refDir);
    return packed?.refs.get(`refs/heads/${name}`);
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

/** reflog の最初の行の時刻と、始まったコミットを読む（ファイルの頭だけ読む）。なければ undefined */
function reflogStart(refDir: string, name: string): { time: number; start?: string } | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(reflogPath(refDir, name), 'r');
    const buf = Buffer.alloc(1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const line = buf.toString('utf8', 0, n).split('\n')[0]!;
    const time = firstTime(line);
    if (time === undefined) return undefined;
    const start = startCommit(line);
    return { time, ...(start && { start }) };
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

/** 手元のブランチを、分岐元の候補としての扱いで分けたもの（classifyBranches） */
interface Classified {
  /** 作業フォルダのブランチを除く、手元のブランチすべて */
  rows: HeadRow[];
  /** 自分のコミットを 1 つも含まない */
  clean: HeadRow[];
  /** 前の作業（自分のコミットの一部）だけを含み、今の HEAD を含まない。子のブランチは除いてある */
  partial: HeadRow[];
  /** HEAD を含む（マージした先）。子のブランチは除いてある */
  targets: HeadRow[];
  /** 残っている自分のコミット */
  existing: string[];
  isOlder: (r: HeadRow) => boolean;
  rank: (name: string) => number;
  byNear: (a: HeadRow, b: HeadRow) => number;
}

/**
 * 手元のブランチと HEAD の差を数え、自分のコミットを含むかどうかで分ける。
 * 自分のコミットを含むブランチは、マージした先か、前の作業が入った先か、このワークツリーから途中で切った子のどれか。
 * 子を分岐元にしないよう、含むものは次のどれかのときだけ残す：記録の分岐元か元のフォルダのブランチ、
 * または reflog があり、自分より先に作られ、自分のコミットから始まっていないもの。reflog のないものは子と見分けられないので外す
 */
async function classifyBranches(dir: string, files: RefFiles, preferred: string[], run: RunGit): Promise<Classified | undefined> {
  const own = files.branch;
  if (!own || !files.head) return undefined;
  const rows = parseHeadRows(await run(dir, ['for-each-ref', '--format=%(refname:lstrip=2) %(ahead-behind:HEAD)', 'refs/heads/'])).filter(
    (r) => r.name !== own,
  );
  if (!rows.length) return undefined;
  const ownReflog = readReflog(files.refDir, own);
  const ownTime = firstTime(ownReflog);
  /** 作った時刻と始まったコミット。ブランチが大量にあるとファイルを開くだけで時間がかかるので、要るものだけを、要るときに、頭だけ読む */
  const startOf = new Map<string, { time: number; start?: string } | null>();
  const start = (name: string) => {
    let v = startOf.get(name);
    if (v === undefined) startOf.set(name, (v = reflogStart(files.refDir, name) ?? null));
    return v;
  };
  /** 作った時刻。reflog がないもの（packed-refs だけの古いブランチなど）は一番古いとみなす */
  const born = (name: string) => start(name)?.time ?? -Infinity;
  const isOlder = (r: HeadRow) => ownTime === undefined || born(r.name) <= ownTime;
  const rank = (name: string) => {
    const i = preferred.indexOf(name);
    return i < 0 ? preferred.length : i;
  };

  // 自分のコミットのうち、まだあるもの（書き直して消えたものを渡すと for-each-ref が失敗する）
  const listed = ownCommits(ownReflog);
  const existing = listed.length
    ? (await run(dir, ['rev-list', '--no-walk', '--ignore-missing', ...listed]))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  let clean = rows;
  let partial: HeadRow[] = [];
  let targets: HeadRow[] = [];
  if (existing.length) {
    const out = await run(dir, ['for-each-ref', '--format=%(refname:lstrip=2)', ...existing.map((c) => `--no-contains=${c}`), 'refs/heads/']);
    const names = new Set(out.split(/\r?\n/).map((s) => s.trim()));
    clean = rows.filter((r) => names.has(r.name));
    const ownSet = new Set(allOwnCommits(ownReflog));
    const notChild = (r: HeadRow) => {
      if (!isOlder(r)) return false;
      if (rank(r.name) < preferred.length) return true;
      const s = start(r.name);
      return !!s && !(s.start && ownSet.has(s.start));
    };
    const holding = rows.filter((r) => !names.has(r.name) && notChild(r));
    partial = holding.filter((r) => r.behind > 0);
    targets = holding.filter((r) => r.behind === 0);
  }
  // 同じ近さなら、記録の分岐元、元のフォルダのブランチ、先に作ったもの（同じ所から切った兄弟より、切った元のほうが古い）の順
  const byNear = (a: HeadRow, b: HeadRow) =>
    a.behind - b.behind ||
    rank(a.name) - rank(b.name) ||
    born(a.name) - born(b.name) ||
    a.ahead - b.ahead ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { rows, clean, partial, targets, existing, isOlder, rank, byNear };
}

/** 分けたブランチから分岐元を選ぶ */
async function chooseBase(c: Classified, dir: string, preferred: string[], run: RunGit): Promise<string | undefined> {
  const { isOlder, rank, byNear } = c;
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
  // 前の作業だけが入ったブランチも分岐元の候補に入れる（使い回したブランチの前の作業が main に入っても、main を見失わない）
  const best = pick([...c.clean, ...c.partial]);

  // マージした先：マージコミットで取り込んだものは、取り込む前の先頭から HEAD までの近さ。
  // fast-forward で入ったもの（first-parent の線の上に HEAD がある）は、HEAD から first-parent をたどって続く自分のコミットの数
  const merged: HeadRow[] = [];
  let ownRun: number | undefined;
  for (const t of c.targets) {
    let near = await mergedDistance(dir, `refs/heads/${t.name}`, run);
    if (near === undefined) {
      ownRun ??= await leadingOwn(dir, new Set(c.existing), run);
      near = ownRun;
    }
    merged.push({ name: t.name, ahead: t.ahead, behind: near });
  }
  const mergedBest = pick(merged);
  if (mergedBest && (!best || mergedBest.behind <= best.behind)) return mergedBest.name;
  return best?.name;
}

/**
 * 分岐元を割り出す。preferred は同じ近さのときに選ぶ順（記録の分岐元、元のフォルダのブランチ）。
 * 1. 手元のブランチ（作業フォルダのブランチを除く）と HEAD の差を 1 回の for-each-ref で数える
 * 2. 作業フォルダのブランチより後に作ったブランチ（このワークツリーから切ったものなど）は外す。作った時刻は reflog の最初の行
 * 3. 作業フォルダのブランチの上で作ったコミットを含むブランチのうち、HEAD まで含むものはマージした先として分け、
 *    前の作業だけを含むもの（使い回したブランチの前の作業が入った main など）は分岐元の候補に残す。途中で切った子は外す（classifyBranches）
 * 4. 残りから、HEAD にしかないコミットが一番少ない（分岐点が一番近い）ものを選ぶ。同じ近さなら記録の分岐元、元のフォルダのブランチ、
 *    先に作ったものの順
 * 5. マージした先のうち、マージコミットで取り込んだものは、取り込む前の先頭と比べて同じかより近ければ、そちらを選ぶ
 *    （develop から切って develop にマージしたもの。main にだけマージしたものは develop のほうが近い）
 * 決められなければ undefined
 */
export async function inferBaseBranch(dir: string, files: RefFiles, preferred: string[], run: RunGit): Promise<string | undefined> {
  const c = await classifyBranches(dir, files, preferred, run);
  return c && chooseBase(c, dir, preferred, run);
}

/** 分岐元の候補の数 */
const CANDIDATE_MAX = 5;

/**
 * 分岐元の候補を近い順に並べる。絞り込みの前の行から作るので、前の作業が入った main も出る。子のブランチは出さない。
 * must（既定のブランチ、推定、選んだ値）は、手元にあれば数に関わらず入れる
 */
function listCandidates(c: Classified, must: string[]): BaseCandidate[] {
  // 時刻を読まずに並べてから、上から要る分だけ取る（ブランチが大量にあっても reflog を開きすぎないように）
  const sorted = [...c.clean, ...c.partial, ...c.targets].sort(
    (a, b) => a.behind - b.behind || c.rank(a.name) - c.rank(b.name) || (a.name < b.name ? -1 : 1),
  );
  const required: HeadRow[] = [];
  for (const name of must) {
    const row = c.rows.find((r) => r.name === name);
    if (row && !required.includes(row)) required.push(row);
  }
  const rest: HeadRow[] = [];
  for (const r of sorted) {
    if (required.length + rest.length >= CANDIDATE_MAX) break;
    if (!must.includes(r.name) && c.isOlder(r)) rest.push(r);
  }
  return [...required, ...rest].sort(c.byNear).map((r) => ({ name: r.name, own: r.behind }));
}

/**
 * カードの分岐元の候補（候補の一覧を開いたときだけ調べる）。recorded は記録の分岐元、main は元のフォルダのブランチ、
 * fallback は既定のブランチ、wanted は選んである値。読めない、git が失敗したときは undefined
 */
export async function readBaseChoices(
  dir: string,
  recorded: string,
  main: string | undefined,
  fallback: string | undefined,
  wanted: string | undefined,
  run: RunGit,
  read: (dir: string) => RefFiles | undefined = readRefFiles,
): Promise<BaseChoices | undefined> {
  const files = read(dir);
  if (!files?.branch || !files.head) return undefined;
  const preferred = [recorded, ...(main && main !== recorded ? [main] : [])];
  const picked = wanted && wanted !== files.branch && files.has(wanted) ? wanted : undefined;
  try {
    const c = await classifyBranches(dir, files, preferred, run);
    if (!c) return undefined;
    const inferred = await chooseBase(c, dir, preferred, run);
    const must = [fallback, inferred, picked].filter((n): n is string => !!n && n !== files.branch);
    return {
      current: picked ?? inferred ?? recorded,
      ...(inferred && { inferred }),
      ...(picked && { picked }),
      candidates: listCandidates(c, must),
    };
  } catch {
    return undefined;
  }
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

/**
 * 分岐元を割り出す。recorded は記録の分岐元（割り出せなければこれを返す）、main は元のフォルダの今のブランチ、
 * pickedOf は作業フォルダのブランチに対してユーザーが選んだ分岐元（手元にあれば、推定より優先する）
 */
export type FindBase = (dir: string, recorded: string, main?: string, pickedOf?: (branch: string) => string | undefined) => Promise<string>;

/** ほかのブランチが動いただけのときに、前の答えを使い回す長さ */
const REFRESH_MS = 30 * 60_000;

/**
 * inferBaseBranch の答えを使い回す。調べ直すのは、HEAD か作業フォルダのブランチの reflog が変わったとき、ユーザーが選んだ値が変わったとき、
 * 答えの分岐元が消えたとき、REFRESH_MS たったときだけ。ユーザーが選んだ値が手元にあれば、git を起動せずにそれを答えにする。ほかのブランチが動いても調べ直さない：後から作ったブランチは分岐元にならず、分岐点も動かないので、
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
  const find: FindBase = async (dir, recorded, main, pickedOf) => {
    const files = read(dir);
    if (!files?.branch || !files.head) return recorded;
    const preferred = [recorded, ...(main && main !== recorded ? [main] : [])];
    // 選んだブランチが消えたら picked が空になり、目印が変わって自動の推定に戻る
    const wanted = pickedOf?.(files.branch);
    const picked = wanted && wanted !== files.branch && files.has(wanted) ? wanted : undefined;
    const id = JSON.stringify([preferred, picked, files.branch, files.head, reflogSize(files.refDir, files.branch)]);
    const key = folderKey(dir);
    const hit = cache.get(key);
    if (hit?.id === id && now() - hit.at < REFRESH_MS && (!hit.base || files.has(hit.base))) return hit.base ?? recorded;
    let base = picked;
    if (!base) {
      try {
        base = await inferBaseBranch(dir, files, preferred, counted);
      } catch {
        // 失敗も覚える（記録の分岐元を使う）。ブランチが多すぎて時間切れになるリポジトリで、調べ直しのたびに git を待たないため
        base = undefined;
      }
    }
    cache.delete(key);
    cache.set(key, { id, base, at: now() });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return base ?? recorded;
  };
  return Object.assign(find, { stats: () => ({ calls }) });
}

/** 選んだ分岐元を覚えておく数の上限（古いものから捨てる） */
const BASE_PICK_MAX = 200;

/** 選んだ分岐元の表の目印。リポジトリ（commonDir の目印）とブランチ名。Windows のパスに | は入らないので、最初の | で分けられる */
export function basePickKey(commonDir: string, branch: string): string {
  return `${folderKey(commonDir)}|${branch}`;
}

/** 値を入れるか外す（branch が null）。新しいものを末尾に置き、上限を超えたら古いものから捨てる */
export function setBasePick(picks: Record<string, string>, key: string, branch: string | null): Record<string, string> {
  const next = { ...picks };
  delete next[key];
  if (branch !== null) next[key] = branch;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - BASE_PICK_MAX))) delete next[k];
  return next;
}

type BranchCheck = (commonDir: string, name: string) => boolean | undefined;

/**
 * ブランチがあるかを調べる関数を作る。ばらのファイルを先に見て、なければ packed-refs を見る（git は起動しない）。
 * リポジトリを読めない、reftable の形式、packed-refs を開けないときは undefined（消えたと決めつけない）。
 * 1 つの関数の中では、リポジトリごとに packed-refs を 1 度だけ読み、同じブランチは 1 度だけ調べる
 */
function createBranchCheck(): BranchCheck {
  const readable = new Map<string, boolean>();
  const packed = new Map<string, PackedRefs | undefined>();
  const answers = new Map<string, boolean | undefined>();
  const check: BranchCheck = (commonDir, name) => {
    let ok = readable.get(commonDir);
    if (ok === undefined) {
      ok = existsSync(join(commonDir, 'HEAD')) && !existsSync(join(commonDir, 'reftable'));
      readable.set(commonDir, ok);
    }
    if (!ok) return undefined;
    try {
      if (statSync(join(commonDir, 'refs', 'heads', name)).isFile()) return true;
    } catch {
      // ばらのファイルがないのは普通
    }
    if (!packed.has(commonDir)) packed.set(commonDir, readPackedRefs(commonDir));
    return packed.get(commonDir)?.heads.has(name);
  };
  return (commonDir, name) => {
    const key = `${commonDir}|${name}`;
    if (!answers.has(key)) answers.set(key, check(commonDir, name));
    return answers.get(key);
  };
}

/** リポジトリ（共有の .git）にそのブランチがあるか。読めないときは undefined（createBranchCheck） */
export function branchExists(commonDir: string, name: string): boolean | undefined {
  return createBranchCheck()(commonDir, name);
}

/**
 * 作業ブランチか選んだ分岐元が消えた値を外す。外すものがなければ undefined。
 * リポジトリを読めないとき（外付けのドライブを外したなど）は残す
 */
export function prunedBasePicks(
  picks: Record<string, string>,
  exists: BranchCheck = createBranchCheck(),
): Record<string, string> | undefined {
  const entries = Object.entries(picks);
  const kept = entries.filter(([key, base]) => {
    const at = key.indexOf('|');
    if (at <= 0) return false;
    const commonDir = key.slice(0, at);
    return exists(commonDir, key.slice(at + 1)) !== false && exists(commonDir, base) !== false;
  });
  return kept.length === entries.length ? undefined : Object.fromEntries(kept);
}

/** 見本データの候補（npm run debug）。見本の作業フォルダは本物ではないので git を動かさず、名前の順に自分のコミットの数を振る */
export function fixtureBaseChoices(inferred: string | undefined, names: string[], wanted: string | undefined): BaseChoices | undefined {
  const unique = [...new Set([...(inferred ? [inferred] : []), ...names, ...(wanted ? [wanted] : [])])].slice(0, CANDIDATE_MAX);
  const current = wanted ?? inferred ?? unique[0];
  if (!current) return undefined;
  return {
    current,
    ...(inferred && { inferred }),
    ...(wanted && { picked: wanted }),
    candidates: unique.map((name, i) => ({ name, own: i * 2 + 1 })),
  };
}
