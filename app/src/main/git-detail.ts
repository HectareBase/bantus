// カードの git の詳細（コミットの並び）。見出しの git の印を押したときだけ調べ、定期的には調べ直さない。
// 軽く動かすため、増減（+/− の行数）は出さない（--numstat も --stat も git diff も使わない）。
// 調べるのは `git log` を 1 回と、ときどき `merge-base` などを 1〜2 回。変更の件数は git-status.ts の結果（GitChanges）を使う。
// 結果は HEAD と分岐元の先頭のコミットの組で覚えて使い回す（先頭は readRefs で、git を起動せずに読む）。
// 作りは docs/design/git-detail.md。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GitChanges, GitCommit, GitDetail, GitMerge } from '../shared/types';
import { git, readRefs } from './git-status';
import { folderKey } from './sessions';

/** ワークツリーで並べるコミットの上限。超えた分は数だけ数える */
export const LOG_LIMIT = 50;
/** メインのカードで並べる最近のコミットの数 */
export const RECENT_LIMIT = 5;
/** 本文を画面へ渡す長さの上限 */
const BODY_MAX = 1000;
/** 覚えておく作業フォルダの数の上限（古いものから捨てる） */
const CACHE_MAX = 50;
/** 短い ID、親（短い ID を空白で区切る）、時刻（秒）、件名、本文。項目は \x1f、コミットは \x1e で区切る */
const FORMAT = '%h%x1f%p%x1f%ct%x1f%s%x1f%b%x1e';

/** 件名を `<種別>(<範囲>): <要約>` の形で分ける。形が合わなければ件名をそのまま本文にする */
export function splitSubject(subject: string): { type?: string; scope?: string; text: string } {
  const m = /^([A-Za-z]+)(?:\(([^()]*)\))?!?:\s+(\S.*)$/.exec(subject);
  if (!m) return { text: subject };
  const scope = m[2]?.trim();
  return { type: m[1]!.toLowerCase(), ...(scope && { scope }), text: m[3]! };
}

/**
 * マージの件名（`Merge branch '<名前>'`、`refs/heads/` 付き、`into ...` 付き、`Merge remote-tracking branch '<名前>'`）から、
 * 取り込んだブランチを読む。remote-tracking なら remote が true（名前は `origin/main` の形）。形が合わなければ undefined
 */
export function parseMergeSubject(subject: string): { branch: string; remote: boolean } | undefined {
  const m = /^Merge (remote-tracking )?branch '([^']+)'(?: of \S+)?(?: into \S+)?$/.exec(subject.trim());
  if (!m) return undefined;
  const branch = m[2]!.replace(/^refs\/(?:heads|remotes)\//, '');
  return branch ? { branch, remote: !!m[1] } : undefined;
}

/** 画面に出すブランチ名。`refs/heads/` と、末尾の乱数（`-1a2b3c` の形。数字を 1 つ以上含む 16 進 6 桁）を除く */
export function shortBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, '').replace(/-(?=[0-9a-f]*\d)[0-9a-f]{6}$/, '');
}

/** 取り込んだブランチがワークツリーの分岐元か（remote-tracking なら `<リモート>/<分岐元>`） */
function isBase(parsed: { branch: string; remote: boolean }, base: string | undefined): boolean {
  if (!base) return false;
  return parsed.remote ? parsed.branch.slice(parsed.branch.indexOf('/') + 1) === base : parsed.branch === base;
}

/** マージの様子のうち、件名から決まる所 */
function mergeInfo(subject: string, base: string | undefined): Omit<GitMerge, 'children'> {
  const parsed = parseMergeSubject(subject);
  if (!parsed) return {};
  return { branch: parsed.branch, name: shortBranch(parsed.branch), ...(isBase(parsed, base) && { fromBase: true }) };
}

/**
 * 取ってきたコミット（新しい順）を、マージごとにまとめる。git は動かさず、親のつながりだけをたどる。
 * - HEAD（先頭）から first-parent をたどった線を本線にする。本線にもマージにも属さないものは、本線と同じ段に並べる
 * - 本線のマージの 2 番目以降の親から辿れて、本線になく、ほかのマージに属していないコミットを、そのマージの子にする
 * - complete でない（取ってきた範囲の外にも続きうる）とき、子をたどって範囲の外の親に当たったら more にする。
 *   complete のとき（分岐元から数えて上限で切っていない並び）、範囲の外の親は分岐元のものなので数えない
 * - excluded：分岐元を取り込んだマージとその子の数（分岐元から数える件数に入れない）
 */
export function groupMerges(commits: ParsedCommit[], opts: { base?: string; complete: boolean }): { commits: GitCommit[]; excluded: number } {
  const byId = new Map(commits.map((c) => [c.short, c]));
  const main = new Set<string>();
  for (let c = commits[0]; c && !main.has(c.short); c = byId.get(c.parents[0] ?? '')) main.add(c.short);
  const claimed = new Set<string>();
  const groups = new Map<string, { children: Set<string>; more: boolean }>();
  const claim = (m: ParsedCommit) => {
    const children = new Set<string>();
    let more = false;
    const queue = m.parents.slice(1);
    while (queue.length) {
      const id = queue.shift()!;
      const c = byId.get(id);
      if (!c) {
        if (!opts.complete) more = true;
        continue;
      }
      if (main.has(id) || claimed.has(id) || id === m.short) continue;
      claimed.add(id);
      children.add(id);
      queue.push(...c.parents);
    }
    groups.set(m.short, { children, more });
  };
  // 本線のマージから先に（日時のずれで、子がマージより前に並んでいても本線に出さない）
  for (const c of commits) if (main.has(c.short) && c.parents.length > 1) claim(c);
  for (const c of commits) if (!main.has(c.short) && !claimed.has(c.short) && c.parents.length > 1) claim(c);
  const toCommit = (c: ParsedCommit, children?: ParsedCommit[], more = false): GitCommit => {
    const { parents, ...rest } = c;
    if (parents.length < 2) return rest;
    return { ...rest, merge: { ...mergeInfo(c.subject, opts.base), children: (children ?? []).map((k) => toCommit(k)), ...(more && { more: true }) } };
  };
  let excluded = 0;
  const out: GitCommit[] = [];
  for (const c of commits) {
    if (claimed.has(c.short)) continue;
    const g = groups.get(c.short);
    const commit = toCommit(c, g && commits.filter((k) => g.children.has(k.short)), g?.more);
    if (commit.merge?.fromBase) excluded += 1 + commit.merge.children.length;
    out.push(commit);
  }
  return { commits: out, excluded };
}

/** マージに、取り込んだブランチで作業したセッションのタイトルを付ける（titles はブランチ名からタイトル） */
export function withTitles(commits: GitCommit[], titles: ReadonlyMap<string, string> | undefined): GitCommit[] {
  if (!titles) return commits;
  return commits.map((c) => {
    if (!c.merge) return c;
    const title = c.merge.branch && !c.merge.fromBase ? titles.get(c.merge.branch) : undefined;
    return { ...c, merge: { ...c.merge, ...(title && { title }), children: withTitles(c.merge.children, titles) } };
  });
}

/** 本文の末尾のトレーラー（`Co-Authored-By: ...` などが並ぶ段落）を除き、長いものは切る */
export function cleanBody(body: string): string {
  const paras = body.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  const last = paras.at(-1);
  if (last && last.split('\n').every((l) => /^[A-Za-z][A-Za-z0-9-]*: \S/.test(l))) paras.pop();
  const text = paras.join('\n\n').trim();
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}…` : text;
}

export interface ParsedCommit extends GitCommit {
  /** 親の短い ID */
  parents: string[];
}

/** `git log --format=<FORMAT>` の出力を読む。新しい順のまま */
export function parseLog(output: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  for (const record of output.split('\x1e')) {
    const fields = record.replace(/^\s+/, '').split('\x1f');
    if (fields.length < 5) continue;
    const [short, parents, time, subject, ...rest] = fields as [string, string, string, string, ...string[]];
    if (!/^[0-9a-f]{4,}$/.test(short)) continue;
    const seconds = Number(time);
    commits.push({
      short,
      parents: parents.split(' ').filter(Boolean),
      at: Number.isFinite(seconds) ? seconds * 1000 : 0,
      subject,
      ...splitSubject(subject),
      body: cleanBody(rest.join('\x1f')),
    });
  }
  return commits;
}

/** git から読む所（変更の件数を除く）。覚えて使い回すのはここだけ */
export interface GitLog {
  mode: 'worktree' | 'main';
  commits: GitCommit[];
  total: number;
  fork?: string;
  /** メインのカードで push していないコミットを並べたとき、追跡するブランチ（`origin/main` など） */
  tracking?: string;
}

type Run = typeof git;

/** 最近のコミットを出すとき、マージの子を数えるために取ってくる数（git の起動は 1 回のまま） */
export const RECENT_FETCH = 30;

/** 先頭から first-parent をたどった線の、並びの中で一番古いコミットの親（分岐点） */
function firstParentEnd(commits: ParsedCommit[]): string | undefined {
  const byId = new Map(commits.map((c) => [c.short, c]));
  const seen = new Set<string>();
  let c = commits[0];
  while (c && !seen.has(c.short)) {
    seen.add(c.short);
    const next = byId.get(c.parents[0] ?? '');
    if (!next) return c.parents[0];
    c = next;
  }
  return undefined;
}

/**
 * コミットの並びを読む。マージは groupMerges で本線とマージの子にまとめる（git は増やさない）。
 * - base（ワークツリーの分岐元）があれば、分岐元にないコミットを新しい順に LOG_LIMIT 件まで。マージ済み（merged）なら、マージした先
 *   （mergedInto、なければ base）の first-parent の線で HEAD を取り込む前のコミットから数える（git-status.ts の mergedInto と同じ見方）
 * - base がなく unpushed（push していないコミットがある）なら、追跡するブランチにないコミットを同じく並べ、追跡するブランチを分岐元の代わりにする
 * - どちらでもなければ、最近のコミットを本線で RECENT_LIMIT 件（マージの子を数えるため、RECENT_FETCH 件を取ってくる）
 * - 分岐元を取り込んだマージとその子は、total に数えない
 */
export async function readLog(
  dir: string,
  base: string | undefined,
  merged: boolean,
  mergedInto: string | undefined,
  run: Run = git,
  unpushed = false,
): Promise<GitLog> {
  const log = (args: string[]) => run(dir, ['log', '--no-show-signature', `--format=${FORMAT}`, ...args]);
  if (!base && !unpushed) {
    const commits = groupMerges(parseLog(await log(['-n', String(RECENT_FETCH), 'HEAD'])), { complete: false }).commits.slice(0, RECENT_LIMIT);
    return { mode: 'main', commits, total: commits.length };
  }
  let from = base ? `refs/heads/${base}` : '@{upstream}';
  if (base && merged) {
    const target = `refs/heads/${mergedInto ?? base}`;
    const first = (await run(dir, ['rev-list', '--first-parent', '--reverse', `HEAD..${target}`])).split('\n')[0]?.trim();
    if (first) from = `${first}^1`;
  }
  const parsed = parseLog(await log(['-n', String(LOG_LIMIT + 1), `${from}..HEAD`]));
  const truncated = parsed.length > LOG_LIMIT;
  const shown = parsed.slice(0, LOG_LIMIT);
  const grouped = groupMerges(shown, { ...(base && { base }), complete: !truncated });
  let total = shown.length;
  // 一番古いものが取り込んだブランチのコミットのこともあるので、first-parent の線の端を見る
  let fork = !truncated ? firstParentEnd(shown) : undefined;
  // 並びの一番古いものの親が分岐点。コミットがない、または上限で切ったときだけ git に聞く
  if (!fork) fork = (await run(dir, ['merge-base', from, 'HEAD'])).trim().slice(0, shown[0]?.short.length ?? 7) || undefined;
  if (truncated) total = Number((await run(dir, ['rev-list', '--count', `${from}..HEAD`])).trim()) || shown.length;
  const tracking = base ? undefined : (await run(dir, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim() || undefined;
  total = Math.max(0, total - grouped.excluded);
  return { mode: base ? 'worktree' : 'main', commits: grouped.commits, total, ...(fork && { fork }), ...(tracking && { tracking }) };
}

/** 詳細を調べるカードの様子（メインプロセスがセッションから決める） */
export interface DetailSource {
  dir: string;
  /** ワークツリーの分岐元。メインのカードでは undefined */
  base?: string;
  branch?: string;
  /** 見出しに出す短い名前 */
  label?: string;
  changes?: GitChanges;
  /** ブランチ名から、そのブランチで作業したセッションのタイトル（マージの件名に使う） */
  titles?: ReadonlyMap<string, string>;
}

const NO_CHANGES: GitChanges = { changed: 0, untracked: 0, ahead: 0, behind: 0, merged: false };

/** 読んだ並びと、すでにある変更の件数を合わせる */
export function buildDetail(src: DetailSource, log: GitLog | undefined): GitDetail {
  const c = src.changes ?? NO_CHANGES;
  const worktree = log ? log.mode === 'worktree' : !!src.base;
  return {
    mode: worktree ? 'worktree' : 'main',
    ...(src.branch && { branch: src.branch }),
    ...(src.label && { label: src.label }),
    ...(worktree && src.base && { base: src.base }),
    changed: c.changed,
    untracked: c.untracked,
    ahead: c.ahead,
    // ワークツリーの遅れ（分岐元が先に進んだ数）は一番下の ◇ に出す。見出しの ↓ は、メインのカードで取得がオンのときだけ（GitChanges.upstream）
    behind: worktree ? 0 : c.upstream ? c.behind : 0,
    ...(!worktree && c.upstream && { upstream: c.upstream }),
    merged: c.merged,
    ...(c.mergedInto && { mergedInto: c.mergedInto }),
    // タイトルは変わることがあるので、覚えた並びには入れず、ここで付ける
    commits: withTitles(log?.commits ?? [], src.titles),
    total: log?.total ?? 0,
    ...(log?.fork && { fork: log.fork }),
    ...(log?.tracking && { tracking: log.tracking }),
    baseAhead: worktree ? c.behind : 0,
    ...(!log && { failed: true }),
  };
}

/**
 * 詳細を読む関数を作る。並びは、作業フォルダの HEAD と分岐元（マージした先）の先頭のコミットの組が同じなら使い回す。
 * 先頭を読めないとき（refs が undefined）と、git が失敗したときは覚えない
 */
export function createGitDetailReader(run: Run = git, refs: typeof readRefs = readRefs) {
  const cache = new Map<string, { id: string; log: GitLog }>();
  let calls = 0;
  const counted: Run = (dir, args) => {
    calls++;
    return run(dir, args);
  };
  async function read(src: DetailSource): Promise<GitDetail> {
    const c = src.changes ?? NO_CHANGES;
    const into = c.merged ? c.mergedInto : undefined;
    let base = src.base;
    const names = base ? [`refs/heads/${base}`, ...(into && into !== base ? [`refs/heads/${into}`] : [])] : [];
    const found = refs(src.dir, names);
    // 分岐元が手元にない：分岐元と比べられないので、メインのカードと同じく最近のコミットを出す
    if (base && found && found.refs[0] === null) base = undefined;
    // メインのカードで push していないコミットがあれば、追跡するブランチと比べる。追跡するブランチの先頭は名前がわからず読めないので、
    // push していない数と遅れも組に入れる（push と取得で変わる）
    const unpushed = !base && c.ahead > 0 && !c.aheadOfBase;
    const id = found && JSON.stringify([base, c.merged, into, found.head, found.refs, unpushed && [c.ahead, c.behind]]);
    const key = folderKey(src.dir);
    const hit = cache.get(key);
    if (id && hit?.id === id) {
      cache.delete(key);
      cache.set(key, hit);
      return buildDetail({ ...src, base }, hit.log);
    }
    let log: GitLog | undefined;
    try {
      log = await readLog(src.dir, base, c.merged, into, counted, unpushed);
    } catch {
      log = undefined;
    }
    cache.delete(key);
    if (id && log) {
      cache.set(key, { id, log });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return buildDetail({ ...src, base }, log);
  }
  return Object.assign(read, { stats: () => ({ calls }) });
}

/** 見本データの 1 件（fixtures/git-detail/details.json） */
interface FixtureCommit {
  short: string;
  minutesAgo: number;
  subject: string;
  body?: string;
  /** 親の短い ID。書かなければ次の行（一番下は分岐点） */
  parents?: string[];
}

/**
 * 見本データで動かしているときの詳細（npm run debug）。見本の隣の git-detail/details.json に、カードの目印ごとのコミットを書いておく。
 * 見本の作業フォルダは本物ではないので、git は起動しない
 */
export function fixtureGitDetail(fixture: string, key: string, src: DetailSource, now = Date.now()): GitDetail {
  let entry: { commits?: FixtureCommit[]; total?: number; fork?: string; tracking?: string } | undefined;
  try {
    const all = JSON.parse(readFileSync(join(dirname(fixture), 'git-detail', 'details.json'), 'utf8')) as Record<string, typeof entry>;
    entry = all[key];
  } catch {
    entry = undefined;
  }
  if (!entry) return buildDetail(src, undefined);
  // 親を書いていなければ、次の行（一番下は分岐点）を親にする
  const list = entry.commits ?? [];
  const parsed: ParsedCommit[] = list.map((c, i) => ({
    short: c.short,
    parents: c.parents ?? [list[i + 1]?.short ?? entry.fork ?? ''].filter(Boolean),
    at: now - c.minutesAgo * 60_000,
    subject: c.subject,
    ...splitSubject(c.subject),
    body: c.body ?? '',
  }));
  const recent = !src.base && !entry.tracking;
  const grouped = groupMerges(parsed, { ...(src.base && { base: src.base }), complete: !recent });
  const commits = recent ? grouped.commits.slice(0, RECENT_LIMIT) : grouped.commits;
  return buildDetail(src, { mode: src.base ? 'worktree' : 'main', commits, total: entry.total ?? (recent ? commits.length : parsed.length - grouped.excluded), ...(entry.fork && { fork: entry.fork }), ...(!src.base && entry.tracking && { tracking: entry.tracking }) });
}
