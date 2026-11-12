// 分岐元の割り出し（src/main/base-branch.ts）を、本物の git で作ったリポジトリで確かめる

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createBaseFinder, firstTime, ownCommits, parseHeadRows } from '../src/main/base-branch';
import { createGitStatus } from '../src/main/git-status';
import { tempDir, view } from './helpers';

describe('parseHeadRows', () => {
  it('名前と ahead-behind を読む。Windows の改行でも読む', () =>
    assert.deepEqual(parseHeadRows('main 2 0\r\nclaude/x 0 3\n\n'), [
      { name: 'main', ahead: 2, behind: 0 },
      { name: 'claude/x', ahead: 0, behind: 3 },
    ]));
});

describe('ownCommits と firstTime', () => {
  const z = '0'.repeat(40);
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(40);
  const reflog = [
    `${z} ${a} t <t> 100 +0900\tbranch: Created from main`,
    `${a} ${b} t <t> 200 +0900\tmerge develop: Fast-forward`,
    `${b} ${c} t <t> 300 +0900\tcommit: feat: x`,
    `${c} ${a} t <t> 400 +0900\tcommit (amend): feat: y`,
    '',
  ].join('\n');
  it('commit で始まる行の新しい値だけを、古い順に重ねずに並べる（作成と追いつきは含めない）', () => assert.deepEqual(ownCommits(reflog), [c, a]));
  it('最初の行の時刻', () => {
    assert.equal(firstTime(reflog), 100);
    assert.equal(firstTime(''), undefined);
  });
});

describe('分岐元の割り出し（本物の git）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  /** 時刻を 1 秒ずつ進めて git を動かす（reflog の時刻で、作った順を見分けるため） */
  let clock = 1_700_000_000;
  const g = (cwd: string, ...args: string[]) => {
    clock++;
    const date = `${clock} +0900`;
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t', '-c', 'commit.gpgsign=false', '-c', 'core.logAllRefUpdates=true', '-C', cwd, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
    }).trim();
  };
  const run = (dir: string, args: string[]) =>
    new Promise<string>((resolve, reject) => execFile('git', ['-C', dir, ...args], { windowsHide: true }, (e, out) => (e ? reject(e) : resolve(out))));
  let n = 0;
  /** main に 1 つコミットしたリポジトリ。git がなければ undefined */
  const repo = (): string | undefined => {
    const dir = join(tmp.path, `r${n++}`);
    try {
      g(tmp.path, 'init', '-q', '-b', 'main', dir);
    } catch {
      return undefined;
    }
    g(dir, 'commit', '-q', '--allow-empty', '-m', 'root');
    return dir;
  };
  const commit = (dir: string, m: string) => g(dir, 'commit', '-q', '--allow-empty', '-m', m);
  /** from から branch を切ったワークツリー */
  const worktree = (dir: string, branch: string, from: string) => {
    const path = join(tmp.path, `w${n++}`);
    g(dir, 'worktree', 'add', '-q', '-b', branch, path, from);
    return path;
  };
  const find = (dir: string, recorded = 'main') => createBaseFinder(run)(dir, recorded, 'main');

  it('develop から切ったワークツリーは、記録が main でも develop', async () => {
    const r = repo();
    if (!r) return;
    g(r, 'branch', 'develop');
    const dev = worktree(r, 'develop2', 'develop');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop2');
    commit(w, 'f1');
    commit(r, 'm1');
    assert.equal(await find(w), 'develop2');
  });

  it('作ったばかりでコミットがなくても、切った元のブランチ', async () => {
    const r = repo();
    if (!r) return;
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop');
    assert.equal(await find(w), 'develop');
  });

  it('同じ近さなら記録の分岐元を選ぶ（main から切ったばかりのものが並んでいても main）', async () => {
    const r = repo();
    if (!r) return;
    g(r, 'branch', 'other');
    const w = worktree(r, 'feature', 'main');
    commit(w, 'f1');
    assert.equal(await find(w), 'main');
  });

  it('このワークツリーから後で切ったブランチは分岐元にしない', async () => {
    const r = repo();
    if (!r) return;
    const a = worktree(r, 'a', 'main');
    commit(a, 'a1');
    const child = worktree(r, 'child', 'a');
    commit(child, 'c1');
    commit(a, 'a2');
    assert.equal(await find(a), 'main');
    assert.equal(await find(child), 'a');
  });

  it('develop にマージコミットで入ったものは develop（main にだけ入った develop 由来のものも develop）', async () => {
    const r = repo();
    if (!r) return;
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop');
    commit(w, 'f1');
    const w2 = worktree(r, 'feature2', 'develop');
    commit(w2, 'g1');
    g(dev, 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
    g(r, 'merge', '-q', '--no-ff', '-m', 'merge feature2', 'feature2');
    assert.equal(await find(w), 'develop');
    assert.equal(await find(w2), 'develop');
  });

  it('fast-forward で main に入ったものは main', async () => {
    const r = repo();
    if (!r) return;
    commit(r, 'm1');
    const side = worktree(r, 'side', 'main');
    const w = worktree(r, 'feature', 'main');
    commit(w, 'f1');
    g(r, 'merge', '-q', '--ff-only', 'feature');
    commit(side, 's1');
    assert.equal(await find(w), 'main');
  });

  it('ブランチにいない、git の外なら記録の分岐元', async () => {
    const r = repo();
    if (!r) return;
    const w = worktree(r, 'feature', 'main');
    g(w, 'checkout', '-q', '--detach');
    assert.equal(await find(w, 'develop'), 'develop');
    assert.equal(await find(join(tmp.path, 'none'), 'develop'), 'develop');
  });

  it('HEAD が変わらず、ほかのブランチが動いただけなら git を起動しない。HEAD が変わったら調べ直す', async () => {
    const r = repo();
    if (!r) return;
    const w = worktree(r, 'feature', 'main');
    commit(w, 'f1');
    const finder = createBaseFinder(run);
    assert.equal(await finder(w, 'main', 'main'), 'main');
    const calls = finder.stats().calls;
    commit(r, 'm1');
    g(r, 'branch', 'later');
    assert.equal(await finder(w, 'main', 'main'), 'main');
    assert.equal(finder.stats().calls, calls);
    commit(w, 'f2');
    await finder(w, 'main', 'main');
    assert.ok(finder.stats().calls > calls);
  });

  it('選んだ分岐元が消えたとき、時間がたったときは調べ直す', async () => {
    const r = repo();
    if (!r) return;
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop');
    commit(w, 'f1');
    let t = 0;
    const finder = createBaseFinder(run, undefined, () => t);
    assert.equal(await finder(w, 'main', 'main'), 'develop');
    let calls = finder.stats().calls;
    t = 31 * 60_000;
    await finder(w, 'main', 'main');
    assert.ok(finder.stats().calls > calls, '30 分たったら調べ直す');
    calls = finder.stats().calls;
    g(r, 'worktree', 'remove', '--force', dev);
    g(r, 'branch', '-D', 'develop');
    assert.equal(await finder(w, 'main', 'main'), 'main');
    assert.ok(finder.stats().calls > calls, '分岐元が消えたら調べ直す');
  });

  it('git が失敗したら記録の分岐元を返し、HEAD が変わるまで git を待ち直さない', async () => {
    const r = repo();
    if (!r) return;
    const w = worktree(r, 'feature', 'main');
    commit(w, 'f1');
    let calls = 0;
    const finder = createBaseFinder(async () => {
      calls++;
      throw new Error('timeout');
    });
    assert.equal(await finder(w, 'develop', 'main'), 'develop');
    assert.equal(await finder(w, 'develop', 'main'), 'develop');
    assert.equal(calls, 1);
    commit(w, 'f2');
    await finder(w, 'develop', 'main');
    assert.equal(calls, 2);
  });

  it('packed-refs にだけある HEAD のブランチも読む', async () => {
    const r = repo();
    if (!r) return;
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop');
    commit(w, 'f1');
    g(r, 'pack-refs', '--all');
    assert.equal(await find(w), 'develop');
  });
});

describe('createGitStatus と分岐元', () => {
  const tick = () => new Promise((r) => setImmediate(r));
  it('割り出した分岐元と比べ、セッションの baseBranch をそれに置き換える。ワークツリーでないものは置き換えない', async () => {
    const bases: string[] = [];
    const branch = async (_dir: string, base: string) => (bases.push(base), { behind: 1, ahead: 2, merged: false });
    const findBase = async (_dir: string, recorded: string) => (recorded === 'main' ? 'develop' : recorded);
    const status = createGitStatus(() => {}, async () => '', () => 0, branch, () => true, undefined, findBase);
    const list = () => [view({ workDir: 'C:/W', baseBranch: 'main', worktree: { key: 'w', label: 'w', branch: 'w' } }), view({ workDir: 'C:/M' })];
    status.apply(list());
    await tick();
    await tick();
    assert.deepEqual(bases, ['develop']);
    const after = status.apply(list());
    assert.equal(after[0]!.baseBranch, 'develop');
    assert.equal(after[1]!.baseBranch, undefined);
  });
});
