// コミットされていない変更（src/main/git-status.ts）を、偽の git で確かめる

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGitStatus, hasUpstream, parseCounts, parseStatus, parseUpstream, readBranchInfo, withUpstream, type GitOptions } from '../src/main/git-status';
import { view } from './helpers';

describe('parseStatus', () => {
  it('変更、名前の変更、衝突、未追跡、push していないコミットを数える', () => {
    const out = [
      '# branch.oid 0123456789abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
      '1 A. N... 000000 100644 100644 000 ccc src/b.ts',
      '2 R. N... 100644 100644 100644 ddd ddd R100 src/new.ts\tsrc/old.ts',
      'u UU N... 100644 100644 100644 100644 e f g src/conflict.ts',
      '? notes.txt',
      '? tmp/',
      '',
    ].join('\n');
    assert.deepEqual(parseStatus(out), { changed: 4, untracked: 2, ahead: 2, behind: 0, merged: false });
  });

  it('変更がなく、追跡するブランチもなければすべて 0', () => {
    assert.deepEqual(parseStatus('# branch.oid 0123\n# branch.head main\n'), { changed: 0, untracked: 0, ahead: 0, behind: 0, merged: false });
  });

  it('Windows の改行でも数える', () => {
    assert.deepEqual(parseStatus('# branch.ab +1 -0\r\n? a\r\n'), { changed: 0, untracked: 1, ahead: 1, behind: 0, merged: false });
  });
});

/** 呼ばれたフォルダを覚える偽の git。結果は outputs から返し、ないフォルダは失敗にする */
function fakeGit(outputs: Record<string, string>) {
  const calls: string[] = [];
  const run = async (dir: string) => {
    calls.push(dir);
    if (!(dir in outputs)) throw new Error('not a git repository');
    return outputs[dir]!;
  };
  return { calls, run };
}

const tick = () => new Promise((r) => setImmediate(r));
const noBranch = async () => ({ behind: 0, ahead: 0, merged: false });

describe('createGitStatus', () => {
  it('作業フォルダごとに 1 回だけ調べ、終わったら onUpdate を呼んで結果を付ける', async () => {
    const git = fakeGit({ 'C:/Repo': '1 .M N... a b c d e f\n? x\n' });
    let updates = 0;
    const status = createGitStatus(() => updates++, git.run, () => 0, noBranch, () => true);
    const sessions = () => [view({ workDir: 'C:/Repo' }), view({ workDir: 'c:/repo/', state: 'busy' }), view({})];

    const first = status.apply(sessions());
    assert.equal(first[0]!.changes, undefined, 'まだ調べていなければ付けない');
    await tick();
    assert.deepEqual(git.calls, ['C:/Repo']);
    assert.equal(updates, 1);

    const second = status.apply(sessions());
    assert.deepEqual(second.map((s) => s.changes), [
      { changed: 1, untracked: 1, ahead: 0, behind: 0, merged: false },
      { changed: 1, untracked: 1, ahead: 0, behind: 0, merged: false },
      undefined,
    ]);
    await tick();
    assert.equal(git.calls.length, 1, '新しいうちは調べ直さない');
  });

  it('調べられなかったフォルダには何も付けない', async () => {
    const git = fakeGit({});
    const status = createGitStatus(() => {}, git.run, () => 0, noBranch, () => true);
    status.apply([view({ workDir: 'C:/NoGit' })]);
    await tick();
    assert.equal(status.apply([view({ workDir: 'C:/NoGit' })])[0]!.changes, undefined);
  });

  it('古くなったら調べ直す。停止中だけのフォルダは長く使い回す', async () => {
    const git = fakeGit({ 'C:/A': '', 'C:/B': '' });
    let now = 0;
    const status = createGitStatus(() => {}, git.run, () => now, noBranch, () => true);
    const list = () => [view({ workDir: 'C:/A', state: 'idle' }), view({ workDir: 'C:/B', state: 'stopped' })];
    status.apply(list());
    await tick();
    now = 60_000;
    status.apply(list());
    await tick();
    assert.deepEqual(git.calls, ['C:/A', 'C:/B', 'C:/A']);
    now = 6 * 60_000;
    status.apply(list());
    await tick();
    assert.deepEqual(git.calls.slice(3).sort(), ['C:/A', 'C:/B']);
  });

  it('処理中のセッションが処理中でなくなったら、新しくてもすぐ調べ直す', async () => {
    const git = fakeGit({ 'C:/A': '' });
    const status = createGitStatus(() => {}, git.run, () => 0, noBranch, () => true);
    status.apply([view({ workDir: 'C:/A', state: 'busy' })]);
    await tick();
    status.apply([view({ workDir: 'C:/A', state: 'busy' })]);
    await tick();
    assert.equal(git.calls.length, 1);
    status.apply([view({ workDir: 'C:/A', state: 'idle' })]);
    await tick();
    assert.equal(git.calls.length, 2);
  });

  it('結果が変わらなければ onUpdate を呼ばない', async () => {
    const git = fakeGit({ 'C:/A': '? x\n' });
    let now = 0;
    let updates = 0;
    const status = createGitStatus(() => updates++, git.run, () => now, noBranch, () => true);
    status.apply([view({ workDir: 'C:/A' })]);
    await tick();
    now = 60_000;
    status.apply([view({ workDir: 'C:/A' })]);
    await tick();
    assert.equal(git.calls.length, 2);
    assert.equal(updates, 1);
  });
});

describe('元のブランチとの差', () => {
  it('rev-list の件数を読む', () => {
    assert.deepEqual(parseCounts('3\t1\n'), { left: 3, right: 1 });
    assert.deepEqual(parseCounts(''), { left: 0, right: 0 });
  });

  /** git のコマンド（引数をつないだもの）→ 出力。ないものは失敗にする */
  const fake = (outputs: Record<string, string>) => async (_dir: string, args: string[]) => {
    const key = args.join(' ');
    if (!(key in outputs)) throw new Error(`unexpected: ${key}`);
    return outputs[key]!;
  };
  const counts = 'rev-list --left-right --count refs/heads/main...HEAD';
  const first = 'rev-list --first-parent --reverse HEAD..refs/heads/main';

  it('ワークツリーにしかないコミットがあれば、マージ済みではない', async () =>
    assert.deepEqual(await readBranchInfo('C:/W', 'main', fake({ [counts]: '2\t1\n' })), { behind: 2, ahead: 1, merged: false }));
  it('作ったばかり（元のブランチと同じ）なら、マージ済みではない', async () =>
    assert.deepEqual(await readBranchInfo('C:/W', 'main', fake({ [counts]: '0\t0\n' })), { behind: 0, ahead: 0, merged: false }));
  it('元のブランチの線の上にある（進んだ main から作っただけ）なら、マージ済みではない', async () =>
    assert.deepEqual(
      await readBranchInfo('C:/W', 'main', fake({ [counts]: '2\t0\n', [first]: 'c1\nc2\n', 'rev-parse c1^1 HEAD': 'h\nh\n' })),
      { behind: 2, ahead: 0, merged: false },
    ));
  it('マージコミットで元のブランチに入ったら、マージ済み', async () =>
    assert.deepEqual(
      await readBranchInfo('C:/W', 'main', fake({ [counts]: '1\t0\n', [first]: 'm\n', 'rev-parse m^1 HEAD': 'p\nh\n' })),
      { behind: 1, ahead: 0, merged: true },
    ));
  it('元のブランチが手元になければ、差なし', async () =>
    assert.deepEqual(await readBranchInfo('C:/W', 'gone', fake({})), { behind: 0, ahead: 0, merged: false }));

  it('元のブランチがあるフォルダだけ、差も調べて件数に入れる', async () => {
    const calls: string[] = [];
    const branch = async (dir: string, base: string) => {
      calls.push(`${dir}:${base}`);
      return { behind: 5, ahead: 3, merged: true };
    };
    const status = createGitStatus(() => {}, async () => '', () => 0, branch, () => true);
    const list = () => [view({ workDir: 'C:/W', baseBranch: 'main' }), view({ workDir: 'C:/M' })];
    status.apply(list());
    await tick();
    await tick();
    assert.deepEqual(calls, ['C:/W:main']);
    // 追跡するブランチがない（status の出力に branch.upstream がない）ので、元のブランチとの差を ahead にする
    assert.deepEqual(status.apply(list()).map((s) => s.changes), [
      { changed: 0, untracked: 0, ahead: 3, behind: 5, merged: true, aheadOfBase: true },
      { changed: 0, untracked: 0, ahead: 0, behind: 0, merged: false },
    ]);
  });

  it('フォルダがもうなければ、ないことを印にする', async () => {
    const status = createGitStatus(() => {}, async () => { throw new Error('no'); }, () => 0, async () => ({ behind: 0, ahead: 0, merged: false }), () => false);
    status.apply([view({ workDir: 'C:/Gone' })]);
    await tick();
    assert.equal(status.apply([view({ workDir: 'C:/Gone' })])[0]!.changes?.gone, true);
  });
});

describe('hasUpstream', () => {
  it('追跡するブランチがあるか', () => {
    assert.equal(hasUpstream('# branch.oid 1\n# branch.head x\n# branch.upstream origin/x\n'), true);
    assert.equal(hasUpstream('# branch.oid 1\n# branch.head x\n'), false);
  });
});

describe('parseUpstream', () => {
  it('追跡するブランチの名前と、# branch.ab の -B（遅れ）を読む', () =>
    assert.deepEqual(parseUpstream('# branch.oid 1\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -7\n'), { name: 'origin/main', behind: 7 }));
  it('Windows の改行でも読む', () =>
    assert.deepEqual(parseUpstream('# branch.upstream origin/main\r\n# branch.ab +0 -3\r\n'), { name: 'origin/main', behind: 3 }));
  it('追跡するブランチがなければ undefined', () => assert.equal(parseUpstream('# branch.oid 1\n# branch.head x\n'), undefined));
  it('追跡するブランチが消えていて ab の行がなければ遅れ 0', () =>
    assert.deepEqual(parseUpstream('# branch.upstream origin/gone\n'), { name: 'origin/gone', behind: 0 }));
  it('parseStatus は -B を behind に入れない（元のブランチとの差と混ぜない）', () =>
    assert.equal(parseStatus('# branch.upstream origin/main\n# branch.ab +1 -4\n').behind, 0));
});

describe('withUpstream', () => {
  const c = { changed: 0, untracked: 0, ahead: 1, behind: 0, merged: false };
  const up = { name: 'origin/main', behind: 3 };
  it('取得がオンなら、追跡するブランチからの遅れを入れる', () =>
    assert.deepEqual(withUpstream(c, up, true), { ...c, behind: 3, upstream: 'origin/main' }));
  it('取得がオフなら入れない', () => assert.deepEqual(withUpstream(c, up, false), c));
  it('追跡するブランチがなければそのまま', () => assert.deepEqual(withUpstream(c, undefined, true), c));
});

describe('取得と組み合わせたとき', () => {
  const STATUS = '# branch.oid 1\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -2\n? x\n';
  const opts = (patch: Partial<GitOptions> = {}): (() => GitOptions) => () => ({ fetchEnabled: true, countUntracked: true, remoteOf: () => 'origin', ...patch });

  it('元のフォルダのカードに、取得がオンのときだけ遅れを出す', async () => {
    let fetchEnabled = true;
    const status = createGitStatus(() => {}, async () => STATUS, () => 0, noBranch, () => true, () => ({ fetchEnabled, countUntracked: true, remoteOf: () => undefined }));
    status.apply([view({ workDir: 'C:/R' })]);
    await tick();
    assert.deepEqual(status.apply([view({ workDir: 'C:/R' })])[0]!.changes, { changed: 0, untracked: 1, ahead: 0, behind: 2, merged: false, upstream: 'origin/main' });
    fetchEnabled = false;
    assert.deepEqual(status.apply([view({ workDir: 'C:/R' })])[0]!.changes, { changed: 0, untracked: 1, ahead: 0, behind: 0, merged: false });
  });

  it('ワークツリーの遅れは元のブランチと比べたまま', async () => {
    const branch = async () => ({ behind: 5, ahead: 0, merged: false });
    const status = createGitStatus(() => {}, async () => STATUS, () => 0, branch, () => true, opts());
    status.apply([view({ workDir: 'C:/W', baseBranch: 'main' })]);
    await tick();
    await tick();
    const changes = status.apply([view({ workDir: 'C:/W', baseBranch: 'main' })])[0]!.changes;
    assert.equal(changes?.behind, 5);
    assert.equal(changes?.upstream, undefined);
  });

  it('リモートが分かっていれば、ワークツリーのマージ済みを refs/remotes/<リモート>/<元のブランチ> でも調べる', async () => {
    const refs: (string | undefined)[] = [];
    const branch = async (_dir: string, _base: string, remoteRef?: string) => {
      refs.push(remoteRef);
      return { behind: 0, ahead: 0, merged: false };
    };
    const status = createGitStatus(() => {}, async () => '', () => 0, branch, () => true, opts());
    status.apply([view({ workDir: 'C:/W', baseBranch: 'main', commonDir: 'C:/R/.git' })]);
    await tick();
    await tick();
    const none = createGitStatus(() => {}, async () => '', () => 0, branch, () => true, opts({ remoteOf: () => undefined }));
    none.apply([view({ workDir: 'C:/W2', baseBranch: 'main', commonDir: 'C:/R/.git' })]);
    await tick();
    await tick();
    assert.deepEqual(refs, ['refs/remotes/origin/main', undefined]);
  });

  it('未追跡を数えないときは、git status にそう伝える', async () => {
    const flags: (boolean | undefined)[] = [];
    const status = createGitStatus(() => {}, async (_dir, untracked) => {
      flags.push(untracked);
      return '';
    }, () => 0, noBranch, () => true, opts({ countUntracked: false }));
    status.apply([view({ workDir: 'C:/R' })]);
    await tick();
    assert.deepEqual(flags, [false]);
  });

  it('invalidate したリポジトリの作業フォルダだけを調べ直す', async () => {
    const git = fakeGit({ 'C:/R': '', 'C:/R/w': '', 'C:/O': '' });
    const status = createGitStatus(() => {}, git.run, () => 0, noBranch, () => true, opts());
    const list = () => [
      view({ workDir: 'C:/R', commonDir: 'C:/R/.git' }),
      view({ workDir: 'C:/R/w', commonDir: 'C:/R/.git' }),
      view({ workDir: 'C:/O', commonDir: 'C:/O/.git' }),
    ];
    status.apply(list());
    await tick();
    status.invalidate('c:/r/.git');
    status.apply(list());
    await tick();
    assert.deepEqual(git.calls.slice(3), ['C:/R', 'C:/R/w']);
  });
});

describe('readBranchInfo とリモートの写し', () => {
  const fake = (outputs: Record<string, string>) => async (_dir: string, args: string[]) => {
    const key = args.join(' ');
    if (!(key in outputs)) throw new Error(`unexpected: ${key}`);
    return outputs[key]!;
  };
  const local = 'rev-list --left-right --count refs/heads/main...HEAD';
  const remote = 'rev-list --left-right --count refs/remotes/origin/main...HEAD';
  const firstRemote = 'rev-list --first-parent --reverse HEAD..refs/remotes/origin/main';

  it('手元の main に取り込む前でも、リモートの main にマージコミットで入ったらマージ済み。遅れと先行は手元と比べる', async () =>
    assert.deepEqual(
      await readBranchInfo('C:/W', 'main', fake({ [local]: '0\t2\n', [remote]: '3\t0\n', [firstRemote]: 'm\n', 'rev-parse m^1 HEAD': 'p\nh\n' }), 'refs/remotes/origin/main'),
      { behind: 0, ahead: 2, merged: true },
    ));
  it('リモートにもまだ入っていなければ、マージ済みではない', async () =>
    assert.deepEqual(
      await readBranchInfo('C:/W', 'main', fake({ [local]: '0\t2\n', [remote]: '1\t2\n' }), 'refs/remotes/origin/main'),
      { behind: 0, ahead: 2, merged: false },
    ));
  it('リモートの写しがなければ、マージ済みではない', async () =>
    assert.deepEqual(await readBranchInfo('C:/W', 'main', fake({ [local]: '0\t2\n' }), 'refs/remotes/origin/main'), { behind: 0, ahead: 2, merged: false }));
});
