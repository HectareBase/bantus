// カードの git の詳細（コミットの並び）。見出しの git の印を押したときだけ調べ、定期的には調べ直さない。
// 軽く動かすため、増減（+/− の行数）は出さない（--numstat も --stat も git diff も使わない）。
// 調べるのは `git log` を 1 回と、ときどき `merge-base` などを 1〜2 回。変更の件数は git-status.ts の結果（GitChanges）を使う。
// 結果は HEAD と分岐元の先頭のコミットの組で覚えて使い回す（先頭は readRefs で、git を起動せずに読む）。
// 作りは docs/design/git-detail.md。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GitChanges, GitCommit, GitDetail } from '../shared/types';
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
}

type Run = typeof git;

function strip({ parents: _parents, ...c }: ParsedCommit): GitCommit {
  return c;
}

/**
 * コミットの並びを読む。base（ワークツリーの分岐元）がなければ、最近のコミットを RECENT_LIMIT 件。
 * base があれば、分岐元にないコミットを新しい順に LOG_LIMIT 件まで。マージ済み（merged）なら、マージした先（mergedInto、なければ base）の
 * first-parent の線で HEAD を取り込む前のコミットから数える（git-status.ts の mergedInto と同じ見方）
 */
export async function readLog(dir: string, base: string | undefined, merged: boolean, mergedInto: string | undefined, run: Run = git): Promise<GitLog> {
  const log = (args: string[]) => run(dir, ['log', '--no-show-signature', `--format=${FORMAT}`, ...args]);
  if (!base) {
    const commits = parseLog(await log(['-n', String(RECENT_LIMIT), 'HEAD'])).map(strip);
    return { mode: 'main', commits, total: commits.length };
  }
  let from = `refs/heads/${base}`;
  if (merged) {
    const target = `refs/heads/${mergedInto ?? base}`;
    const first = (await run(dir, ['rev-list', '--first-parent', '--reverse', `HEAD..${target}`])).split('\n')[0]?.trim();
    if (first) from = `${first}^1`;
  }
  const parsed = parseLog(await log(['-n', String(LOG_LIMIT + 1), `${from}..HEAD`]));
  const truncated = parsed.length > LOG_LIMIT;
  const shown = parsed.slice(0, LOG_LIMIT);
  let total = shown.length;
  let fork = !truncated ? shown.at(-1)?.parents[0] : undefined;
  // 並びの一番古いものの親が分岐点。コミットがない、または上限で切ったときだけ git に聞く
  if (!fork) fork = (await run(dir, ['merge-base', from, 'HEAD'])).trim().slice(0, shown[0]?.short.length ?? 7) || undefined;
  if (truncated) total = Number((await run(dir, ['rev-list', '--count', `${from}..HEAD`])).trim()) || shown.length;
  return { mode: 'worktree', commits: shown.map(strip), total, ...(fork && { fork }) };
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
    commits: log?.commits ?? [],
    total: log?.total ?? 0,
    ...(log?.fork && { fork: log.fork }),
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
    const id = found && JSON.stringify([base, c.merged, into, found.head, found.refs]);
    const key = folderKey(src.dir);
    const hit = cache.get(key);
    if (id && hit?.id === id) {
      cache.delete(key);
      cache.set(key, hit);
      return buildDetail({ ...src, base }, hit.log);
    }
    let log: GitLog | undefined;
    try {
      log = await readLog(src.dir, base, c.merged, into, counted);
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
}

/**
 * 見本データで動かしているときの詳細（npm run debug）。見本の隣の git-detail/details.json に、カードの目印ごとのコミットを書いておく。
 * 見本の作業フォルダは本物ではないので、git は起動しない
 */
export function fixtureGitDetail(fixture: string, key: string, src: DetailSource, now = Date.now()): GitDetail {
  let entry: { commits?: FixtureCommit[]; total?: number; fork?: string } | undefined;
  try {
    const all = JSON.parse(readFileSync(join(dirname(fixture), 'git-detail', 'details.json'), 'utf8')) as Record<string, typeof entry>;
    entry = all[key];
  } catch {
    entry = undefined;
  }
  if (!entry) return buildDetail(src, undefined);
  const commits = (entry.commits ?? []).map((c) => ({ short: c.short, at: now - c.minutesAgo * 60_000, subject: c.subject, ...splitSubject(c.subject), body: c.body ?? '' }));
  return buildDetail(src, { mode: src.base ? 'worktree' : 'main', commits, total: entry.total ?? commits.length, ...(entry.fork && { fork: entry.fork }) });
}
