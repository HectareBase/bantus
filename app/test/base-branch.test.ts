// 分岐元の割り出し（src/main/base-branch.ts）を、本物の git で作ったリポジトリで確かめる

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { basePickKey, branchExists, createBaseFinder, firstTime, fixtureBaseChoices, ownCommits, parseHeadRows, prunedBasePicks, readBaseChoices, setBasePick, startCommit } from '../src/main/base-branch';
import { createGitStatus } from '../src/main/git-status';
import { packedRefsReads, parsePackedRefs, readPackedRefs } from '../src/main/packed-refs';
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
  it('始まったコミット：作成の行は新しい値、作成の行がなければ最初の行の古い値', () => {
    assert.equal(startCommit(reflog), a);
    assert.equal(startCommit(`${b} ${c} t <t> 300 +0900\tcommit: feat: x\n`), b);
    assert.equal(startCommit(''), undefined);
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

  /** develop から切ったブランチで前の作業をして main にマージし、同じブランチで今の作業を続けたもの */
  const reused = (catchUp: boolean) => {
    const r = repo();
    if (!r) return undefined;
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop');
    commit(w, 'prev');
    g(r, 'merge', '-q', '--no-ff', '-m', 'merge prev', 'feature');
    if (catchUp) g(w, 'merge', '-q', '--ff-only', 'main');
    commit(w, 'now');
    return { r, w };
  };

  it('使い回したブランチの前の作業が main に入っていれば、最初の分岐元ではなく main', async () => {
    for (const catchUp of [true, false]) {
      const t = reused(catchUp);
      if (!t) return;
      assert.equal(await find(t.w, 'develop'), 'main', catchUp ? 'main に追いついたあと' : '追いつかずに続けたとき');
    }
  });

  it('途中で切った子は分岐元にしない（reflog があるとき、消えたとき）', async () => {
    const r = repo();
    if (!r) return;
    const a = worktree(r, 'a', 'main');
    commit(a, 'a1');
    g(a, 'branch', 'mid');
    commit(a, 'a2');
    assert.equal(await find(a), 'main');
    rmSync(join(r, '.git', 'logs', 'refs', 'heads', 'mid'));
    assert.equal(await find(a), 'main', 'reflog のない子は見分けられないので、自分のコミットを含むものは選ばない');
  });

  it('HEAD から切ったばかりで reflog のない子も分岐元にしない', async () => {
    const r = repo();
    if (!r) return;
    const a = worktree(r, 'a', 'main');
    commit(a, 'a1');
    g(a, 'branch', 'tip');
    rmSync(join(r, '.git', 'logs', 'refs', 'heads', 'tip'));
    assert.equal(await find(a), 'main');
  });

  it('選んだ値を最優先にし、git を起動しない。やめると推定に戻る', async () => {
    const r = repo();
    if (!r) return;
    g(r, 'branch', 'other');
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop');
    commit(w, 'f1');
    const finder = createBaseFinder(run);
    assert.equal(await finder(w, 'main', 'main'), 'develop');
    const calls = finder.stats().calls;
    assert.equal(await finder(w, 'main', 'main', () => 'other'), 'other');
    assert.equal(finder.stats().calls, calls, '選んだ値は git なしで答える');
    assert.equal(await finder(w, 'main', 'main', () => 'other'), 'other');
    assert.equal(await finder(w, 'main', 'main'), 'develop', '選んだ値が目印に入っているので、やめたら推定に戻る');
    assert.ok(finder.stats().calls > calls);
    assert.equal(await finder(w, 'main', 'main', () => 'feature'), 'develop', '自分のブランチは選べない');
  });

  it('選んだブランチが消えたら自動に戻す', async () => {
    const r = repo();
    if (!r) return;
    g(r, 'branch', 'other');
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    const w = worktree(r, 'feature', 'develop');
    commit(w, 'f1');
    const finder = createBaseFinder(run);
    assert.equal(await finder(w, 'main', 'main', () => 'other'), 'other');
    g(r, 'branch', '-D', 'other');
    assert.equal(await finder(w, 'main', 'main', () => 'other'), 'develop');
  });

  it('候補：近い順で、自分のコミットの数を添え、前の作業が入った main を出し、途中で切った子は出さない', async () => {
    const t = reused(false);
    if (!t) return;
    g(t.w, 'branch', 'mid', 'HEAD~1');
    const c = await readBaseChoices(t.w, 'develop', 'main', 'main', undefined, run);
    assert.deepEqual(c, {
      current: 'main',
      inferred: 'main',
      candidates: [
        { name: 'main', own: 1 },
        { name: 'develop', own: 2 },
      ],
    });
  });

  it('候補：5 件までで、遠くても既定のブランチと選んだ値は入れる', async () => {
    const r = repo();
    if (!r) return;
    g(r, 'branch', 'far');
    commit(r, 'm1');
    const dev = worktree(r, 'develop', 'main');
    commit(dev, 'd1');
    for (const name of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']) g(r, 'branch', name, 'develop');
    const w = worktree(r, 'feature', 'develop');
    commit(w, 'f1');
    const c = await readBaseChoices(w, 'main', 'main', 'main', 'far', run);
    assert.ok(c);
    const names = c.candidates.map((x) => x.name);
    assert.equal(c.current, 'far');
    assert.equal(c.picked, 'far');
    assert.equal(c.inferred, 'develop');
    assert.equal(names.length, 5);
    for (const must of ['main', 'far', 'develop']) assert.ok(names.includes(must), must);
    assert.deepEqual(c.candidates.map((x) => x.own), [...c.candidates.map((x) => x.own)].sort((x, y) => x - y), '近い順');
  });

  it('ブランチがあるかを読む。packed-refs だけのものも読み、リポジトリを読めなければ決めない', () => {
    const r = repo();
    if (!r) return;
    g(r, 'branch', 'a/b');
    const common = join(r, '.git');
    assert.equal(branchExists(common, 'a/b'), true);
    assert.equal(branchExists(common, 'a'), false, 'フォルダはブランチではない');
    g(r, 'pack-refs', '--all');
    assert.equal(branchExists(common, 'a/b'), true);
    assert.equal(branchExists(common, 'none'), false);
    assert.equal(branchExists(join(tmp.path, 'none'), 'a/b'), undefined);
  });
});

describe('選んだ分岐元の保存', () => {
  it('目印はリポジトリの目印とブランチ名', () => assert.equal(basePickKey('C:\\Repo\\.git\\', 'claude/x'), 'c:\\repo\\.git|claude/x'));
  it('入れる、外す。上限を超えたら古いものから捨てる', () => {
    const one = setBasePick({}, 'r|a', 'main');
    assert.deepEqual(one, { 'r|a': 'main' });
    assert.deepEqual(setBasePick(one, 'r|a', null), {});
    let many: Record<string, string> = {};
    for (let i = 0; i < 205; i++) many = setBasePick(many, `r|b${i}`, 'main');
    assert.equal(Object.keys(many).length, 200);
    assert.equal(many['r|b0'], undefined);
    assert.equal(many['r|b204'], 'main');
  });
  it('作業ブランチか分岐元が消えた値を外す。読めないリポジトリの値は残す', () => {
    const has: Record<string, boolean | undefined> = { 'r:keep': true, 'r:main': true, 'r:gone': false };
    const exists = (repo: string, name: string) => (repo === 'off' ? undefined : has[`${repo}:${name}`] ?? false);
    assert.deepEqual(prunedBasePicks({ 'r|keep': 'main', 'r|gone': 'main', 'r|keep2': 'gone', 'off|x': 'y' }, exists), { 'r|keep': 'main', 'off|x': 'y' });
    assert.equal(prunedBasePicks({ 'r|keep': 'main' }, exists), undefined);
  });
  describe('packed-refs の読み方', () => {
    const tmp = tempDir();
    after(() => tmp.cleanup());
    const sha = (c: string) => c.repeat(40);
    const old = (file: string, ago = 60_000) => {
      const t = new Date(Date.now() - ago);
      utimesSync(file, t, t);
    };
    /** HEAD と refs/heads だけの .git を作る。packed があれば packed-refs に書き、書いた直後の扱いを避けて時刻を戻す */
    const gitDir = (name: string, packed?: string) => {
      const dir = join(tmp.path, name, '.git');
      mkdirSync(join(dir, 'refs', 'heads'), { recursive: true });
      writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n');
      if (packed !== undefined) {
        writeFileSync(join(dir, 'packed-refs'), packed);
        old(join(dir, 'packed-refs'));
      }
      return dir;
    };
    const mixed = [
      '# pack-refs with: peeled fully-peeled sorted ',
      `${sha('a')} refs/heads/main`,
      `${sha('b')} refs/heads/topic/x`,
      `${sha('c')} refs/remotes/origin/only-remote`,
      `${sha('d')} refs/tags/only-tag`,
      `^${sha('e')}`,
      '',
    ];

    it('リモート、タグ、peeled、コメントの行はブランチとして読まない。CRLF でも読む', () => {
      for (const eol of ['\n', '\r\n']) {
        const p = parsePackedRefs(mixed.join(eol));
        assert.deepEqual([...p.heads], ['main', 'topic/x']);
        assert.equal(p.refs.get('refs/tags/only-tag'), sha('d'), 'タグの値は peeled の行で上書きしない');
        assert.equal(p.refs.get('refs/heads/main'), sha('a'));
      }
    });

    it('1 回の見直しで、リポジトリごとに 1 度だけ読み、変わらなければ読み直さない', () => {
      const a = gitDir('count-a', mixed.join('\n'));
      const b = gitDir('count-b', mixed.join('\n'));
      const picks: Record<string, string> = {};
      for (const dir of [a, b]) {
        picks[basePickKey(dir, 'topic/x')] = 'main';
        picks[basePickKey(dir, 'main')] = 'topic/x';
      }
      const start = packedRefsReads();
      assert.equal(prunedBasePicks(picks), undefined);
      assert.equal(packedRefsReads() - start, 2, 'リポジトリの数だけ');
      assert.equal(prunedBasePicks(picks), undefined);
      assert.equal(packedRefsReads() - start, 2, '更新時刻と大きさが同じなら読まない');
    });

    it('大きさが同じでも、更新時刻が変われば読み直す', () => {
      const dir = gitDir('rewrite', `${sha('a')} refs/heads/aaaa\n`);
      const key = basePickKey(dir, 'aaaa');
      assert.equal(prunedBasePicks({ [key]: 'aaaa' }), undefined);
      writeFileSync(join(dir, 'packed-refs'), `${sha('a')} refs/heads/bbbb\n`);
      old(join(dir, 'packed-refs'), 30_000);
      assert.deepEqual(prunedBasePicks({ [key]: 'aaaa' }), {}, '消えたブランチの値を外す');
    });

    it('書いた直後のファイルは覚えない', () => {
      const dir = gitDir('fresh');
      const file = join(dir, 'packed-refs');
      writeFileSync(file, `${sha('a')} refs/heads/main\n`);
      const now = statSync(file).mtimeMs;
      const start = packedRefsReads();
      readPackedRefs(dir, now);
      readPackedRefs(dir, now);
      assert.equal(packedRefsReads() - start, 2);
    });

    it('リモートやタグにしかない名前と、ばらのファイルもない名前は消えたとみなす', () => {
      const dir = gitDir('gone', mixed.join('\n'));
      const k = (n: string) => basePickKey(dir, n);
      assert.deepEqual(
        prunedBasePicks({ [k('main')]: 'topic/x', [k('origin/only-remote')]: 'main', [k('only-remote')]: 'main', [k('only-tag')]: 'main', [k('topic/x')]: 'none' }),
        { [k('main')]: 'topic/x' },
      );
    });

    it('ばらのファイルを先に見る。packed-refs がなくても読める', () => {
      const dir = gitDir('loose');
      writeFileSync(join(dir, 'refs', 'heads', 'main'), `${sha('a')}\n`);
      const start = packedRefsReads();
      assert.equal(branchExists(dir, 'main'), true);
      assert.equal(packedRefsReads() - start, 0, 'ばらのファイルがあれば packed-refs を開かない');
      assert.equal(branchExists(dir, 'none'), false);
    });

    it('読めないリポジトリ、reftable、packed-refs を開けないときは決めない', () => {
      const missing = join(tmp.path, 'missing', '.git');
      const reftable = gitDir('reftable', mixed.join('\n'));
      mkdirSync(join(reftable, 'reftable'));
      const unreadable = gitDir('unreadable');
      mkdirSync(join(unreadable, 'packed-refs'), { recursive: true });
      assert.equal(branchExists(missing, 'main'), undefined);
      assert.equal(branchExists(reftable, 'main'), undefined);
      assert.equal(branchExists(unreadable, 'main'), undefined, 'ファイルとして読めない');
      const picks = { [basePickKey(missing, 'x')]: 'y', [basePickKey(reftable, 'x')]: 'y', [basePickKey(unreadable, 'x')]: 'y' };
      assert.equal(prunedBasePicks(picks), undefined);
    });
  });

  it('見本データの候補は、推定を先頭に重ねずに並べる', () => {
    assert.deepEqual(fixtureBaseChoices('develop', ['main', 'develop'], undefined), {
      current: 'develop',
      inferred: 'develop',
      candidates: [{ name: 'develop', own: 1 }, { name: 'main', own: 3 }],
    });
  });
});

describe('選んだ分岐元と git の数', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const g = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t', '-c', 'commit.gpgsign=false', '-c', 'core.logAllRefUpdates=true', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();

  it('選ぶと遅れ・未マージ・マージ済みが選んだ先との比較に切り替わり、やめると戻る', async () => {
    const r = join(tmp.path, 'r');
    try {
      g(tmp.path, 'init', '-q', '-b', 'main', r);
    } catch {
      return;
    }
    g(r, 'commit', '-q', '--allow-empty', '-m', 'root');
    const dev = join(tmp.path, 'dev');
    g(r, 'worktree', 'add', '-q', '-b', 'develop', dev, 'main');
    g(dev, 'commit', '-q', '--allow-empty', '-m', 'd1');
    const w = join(tmp.path, 'w');
    g(r, 'worktree', 'add', '-q', '-b', 'feature', w, 'develop');
    g(w, 'commit', '-q', '--allow-empty', '-m', 'f1');
    g(dev, 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
    g(r, 'commit', '-q', '--allow-empty', '-m', 'm1');

    let picked: string | undefined;
    let wake: (() => void) | undefined;
    const status = createGitStatus(() => wake?.(), undefined, undefined, undefined, undefined, () => ({
      fetchEnabled: false,
      countUntracked: true,
      remoteOf: () => undefined,
      pickedBase: () => picked,
    }));
    const list = () => [view({ workDir: w, commonDir: join(r, '.git'), baseBranch: 'main', mainBranch: 'main', worktree: { key: 'w', label: 'w', branch: 'feature' } })];
    /** 調べ直しを待ってから、結果を付けた一覧を返す */
    const settled = async () => {
      const done = new Promise<void>((res) => (wake = res));
      status.invalidate();
      status.apply(list());
      await done;
      return status.apply(list())[0]!;
    };

    const auto = await settled();
    assert.equal(auto.baseBranch, 'develop');
    assert.equal(auto.basePicked, undefined);
    assert.equal(auto.changes?.merged, true);

    picked = 'main';
    const chosen = await settled();
    assert.equal(chosen.baseBranch, 'main');
    assert.equal(chosen.basePicked, true);
    assert.equal(chosen.changes?.merged, false);
    assert.equal(chosen.changes?.behind, 1);
    assert.equal(chosen.changes?.ahead, 2);

    picked = undefined;
    const back = await settled();
    assert.equal(back.baseBranch, 'develop');
    assert.equal(back.basePicked, undefined);
    assert.equal(back.changes?.merged, true);
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
