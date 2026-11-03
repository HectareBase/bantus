// 作業フォルダごとの、コミットされていない変更（git status）。ウィジェットからは読むだけで、リポジトリを書き換えない。
// 普通の git status は .git/index を書き直すことがある（index.lock を取る）ので、--no-optional-locks を付けて
// Claude 自身の git 操作とぶつからないようにする。調べ方と頻度は docs/design/git-changes.md。

import { execFile } from 'node:child_process';
import type { GitChanges, SessionState, SessionView } from '../shared/types';
import { folderKey } from './sessions';

/** 1 回の git status を待つ長さ。大きなリポジトリで止まらないよう、過ぎたら諦める */
const TIMEOUT_MS = 5_000;
/** 結果を使い回す長さ。動いているセッションの作業フォルダは短く、停止中だけのフォルダは長く */
const MAX_AGE_ACTIVE_MS = 30_000;
const MAX_AGE_STOPPED_MS = 5 * 60_000;

/** `git status --porcelain=v2 --branch` の出力を数える */
export function parseStatus(output: string): GitChanges {
  const changes: GitChanges = { changed: 0, untracked: 0, ahead: 0 };
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

export type RunStatus = (dir: string) => Promise<string>;

function runGit(dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v2', '--branch'],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

interface Entry {
  /** 調べられなかった（git がない、タイムアウトなど）ときは undefined */
  changes?: GitChanges;
  at: number;
}


/**
 * 結果を作業フォルダごとに覚え、古くなったものとターンが終わったものだけを調べ直す。
 * 調べ終えて結果が変わったら onUpdate を呼ぶ。git は一度に 1 つだけ動かす
 */
export function createGitStatus(onUpdate: () => void, run: RunStatus = runGit, now = () => Date.now()) {
  const cache = new Map<string, Entry>();
  /** 前に見たときの状態（ターンの終わりを見つけるため） */
  const lastStates = new Map<string, SessionState[]>();
  const queue: { key: string; dir: string }[] = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    let changed = false;
    while (queue.length) {
      const { key, dir } = queue.shift()!;
      let changes: GitChanges | undefined;
      try {
        changes = parseStatus(await run(dir));
      } catch {
        changes = undefined;
      }
      if (JSON.stringify(cache.get(key)?.changes) !== JSON.stringify(changes)) changed = true;
      cache.set(key, { changes, at: now() });
    }
    running = false;
    if (changed) onUpdate();
  }

  /** 作業フォルダの目印 → そのフォルダを使うセッションの状態。調べ直しが要るものを並べる */
  function update(folders: Map<string, { dir: string; states: SessionState[] }>) {
    for (const [key, { dir, states }] of folders) {
      const prev = lastStates.get(key);
      lastStates.set(key, states);
      if (queue.some((q) => q.key === key)) continue;
      const entry = cache.get(key);
      const active = states.some((s) => s !== 'stopped');
      const maxAge = active ? MAX_AGE_ACTIVE_MS : MAX_AGE_STOPPED_MS;
      // 処理中だったセッションが処理中でなくなった：ターンが終わり、変更が増えたかもしれない
      const turnEnded = prev !== undefined && prev.filter((s) => s === 'busy').length > states.filter((s) => s === 'busy').length;
      if (!entry || now() - entry.at >= maxAge || turnEnded) queue.push({ key, dir });
    }
    for (const key of cache.keys()) if (!folders.has(key)) cache.delete(key);
    for (const key of lastStates.keys()) if (!folders.has(key)) lastStates.delete(key);
    void drain();
  }

  /** 一覧の各セッションに、覚えている結果を付ける（まだ調べていなければ付けない）。あわせて調べ直しを並べる */
  function apply(sessions: SessionView[]): SessionView[] {
    const folders = new Map<string, { dir: string; states: SessionState[] }>();
    for (const s of sessions) {
      if (!s.workDir) continue;
      const key = folderKey(s.workDir);
      const f = folders.get(key) ?? { dir: s.workDir, states: [] };
      f.states.push(s.state);
      folders.set(key, f);
    }
    update(folders);
    for (const s of sessions) {
      const changes = s.workDir ? cache.get(folderKey(s.workDir))?.changes : undefined;
      if (changes) s.changes = changes;
    }
    return sessions;
  }

  return { apply };
}
