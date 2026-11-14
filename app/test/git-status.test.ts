// コミットされていない変更（src/main/git-status.ts）を、偽の git で確かめる

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createBranchReader, createGitStatus, git as realGit, hasUpstream, parseCounts, parseStatus, parseUpstream, readBranchInfo, readRefs, withUpstream, type GitOptions, type ReadBranch } from '../src/main/git-status';
import { tempDir, view, writeJson } from './helpers';

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

  it('古くなったら調べ直す。ターンの途中のセッションがないフォルダは長く使い回す', async () => {
    const git = fakeGit({ 'C:/A': '', 'C:/B': '' });
    let now = 0;
    const status = createGitStatus(() => {}, git.run, () => now, noBranch, () => true);
    const list = () => [view({ workDir: 'C:/A', state: 'busy' }), view({ workDir: 'C:/B', state: 'stopped' })];
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

  it('待機中と停止中だけのフォルダは 5 分まで調べ直さない。対応待ちがあれば 30 秒で調べ直す', async () => {
    const git = fakeGit({ 'C:/Idle': '', 'C:/Wait': '' });
    let now = 0;
    const status = createGitStatus(() => {}, git.run, () => now, noBranch, () => true);
    const list = () => [
      view({ workDir: 'C:/Idle', state: 'idle' }),
      view({ workDir: 'C:/Idle', state: 'stopped' }),
      view({ workDir: 'C:/Wait', state: 'waiting' }),
    ];
    status.apply(list());
    await tick();
    assert.deepEqual(git.calls.sort(), ['C:/Idle', 'C:/Wait']);
    for (const t of [60_000, 2 * 60_000, 4 * 60_000 + 59_000]) {
      now = t;
      status.apply(list());
      await tick();
    }
    assert.equal(git.calls.filter((c) => c === 'C:/Idle').length, 1);
    assert.ok(git.calls.filter((c) => c === 'C:/Wait').length >= 3);
    now = 5 * 60_000;
    status.apply(list());
    await tick();
    assert.equal(git.calls.filter((c) => c === 'C:/Idle').length, 2);
  });

  it('待機中のフォルダでも、取得のあとや設定の変更（invalidate）ではすぐ調べ直す', async () => {
    const git = fakeGit({ 'C:/Idle': '' });
    let now = 0;
    const status = createGitStatus(() => {}, git.run, () => now, noBranch, () => true);
    status.apply([view({ workDir: 'C:/Idle', state: 'idle' })]);
    await tick();
    now = 1_000;
    status.invalidate();
    status.apply([view({ workDir: 'C:/Idle', state: 'idle' })]);
    await tick();
    assert.equal(git.calls.length, 2);
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
    status.apply([view({ workDir: 'C:/A', state: 'busy' })]);
    await tick();
    now = 60_000;
    status.apply([view({ workDir: 'C:/A', state: 'busy' })]);
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

  describe('マージした先（develop から切って main にマージしたもの）', () => {
    const dev = 'rev-list --left-right --count refs/heads/develop...HEAD';
    it('元のブランチに入っていなくても、main にマージコミットで入っていればマージ済みにし、先の名前を入れる', async () =>
      assert.deepEqual(
        await readBranchInfo('C:/W', 'develop', fake({ [dev]: '0\t1\n', [counts]: '1\t0\n', [first]: 'm\n', 'rev-parse m^1 HEAD': 'p\nh\n' }), undefined, 'main'),
        { behind: 0, ahead: 1, merged: true, mergedInto: 'main' },
      ));
    it('main の線の上にある（main に追いついただけ）なら、マージ済みにしない', async () =>
      assert.deepEqual(
        await readBranchInfo('C:/W', 'develop', fake({ [dev]: '0\t3\n', [counts]: '0\t0\n' }), undefined, 'main'),
        { behind: 0, ahead: 3, merged: false },
      ));
    it('元のブランチに入っていないコミットがなければ、main は調べない', async () => {
      const keys: string[] = [];
      const run = fake({ [dev]: '2\t0\n', 'rev-list --first-parent --reverse HEAD..refs/heads/develop': '' });
      const info = await readBranchInfo('C:/W', 'develop', (dir, args) => (keys.push(args.join(' ')), run(dir, args)), undefined, 'main');
      assert.deepEqual(info, { behind: 2, ahead: 0, merged: false });
      assert.ok(keys.every((k) => !k.includes('refs/heads/main')), keys.join('\n'));
    });
    it('元のブランチが main と同じなら、もう一度は調べない', async () =>
      assert.deepEqual(await readBranchInfo('C:/W', 'main', fake({ [counts]: '2\t1\n' }), undefined, 'main'), { behind: 2, ahead: 1, merged: false }));
  });

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

  it('追跡するブランチがあっても、push していないコミットが 0 なら元のブランチとの差を ahead にする（push した PR の後）', async () => {
    const branch = async () => ({ behind: 1, ahead: 4, merged: false });
    const pushed = '# branch.oid 1\n# branch.head w\n# branch.upstream origin/w\n# branch.ab +0 -0\n';
    const unpushed = '# branch.oid 1\n# branch.head w\n# branch.upstream origin/w\n# branch.ab +2 -0\n';
    const outputs: Record<string, string> = { 'C:/P': pushed, 'C:/U': unpushed };
    const status = createGitStatus(() => {}, async (dir) => outputs[dir]!, () => 0, branch, () => true);
    const list = () => [view({ workDir: 'C:/P', baseBranch: 'main' }), view({ workDir: 'C:/U', baseBranch: 'main' })];
    status.apply(list());
    await tick();
    await tick();
    assert.deepEqual(status.apply(list()).map((s) => s.changes), [
      { changed: 0, untracked: 0, ahead: 4, behind: 1, merged: false, aheadOfBase: true },
      // push していないコミットがあれば、そちらを出す
      { changed: 0, untracked: 0, ahead: 2, behind: 1, merged: false },
    ]);
  });

  it('元のフォルダのブランチを渡し、main に入っていたらマージした先を changes に入れる', async () => {
    const mains: (string | undefined)[] = [];
    const branch = async (_dir: string, _base: string, _remote?: string, main?: string) => {
      mains.push(main);
      return { behind: 0, ahead: 1, merged: true, mergedInto: 'main' };
    };
    const status = createGitStatus(() => {}, async () => '', () => 0, branch, () => true);
    const wt = { key: 'w', label: 'w', branch: 'w' };
    const list = () => [view({ workDir: 'C:/W', baseBranch: 'develop', mainBranch: 'main', worktree: wt })];
    status.apply(list());
    await tick();
    await tick();
    assert.deepEqual(mains, ['main']);
    assert.deepEqual(status.apply(list())[0]!.changes, { changed: 0, untracked: 0, ahead: 1, behind: 0, merged: true, mergedInto: 'main', aheadOfBase: true });
  });

  it('元のフォルダ（ワークツリーでない）の分岐元は割り出さず、main も渡さない。追跡するブランチがあっても遅れは分岐元と比べる', async () => {
    const found: string[] = [];
    const findBase = async (dir: string, recorded: string) => (found.push(dir), `${recorded}-found`);
    const seen: [string, string | undefined][] = [];
    const branch = async (_dir: string, base: string, _remote?: string, main?: string) => (seen.push([base, main]), { behind: 2, ahead: 1, merged: false });
    const out = '# branch.oid 1\n# branch.head feature\n# branch.upstream origin/feature\n# branch.ab +0 -3\n';
    const fetchOn: GitOptions = { fetchEnabled: true, countUntracked: true, remoteOf: () => undefined };
    const status = createGitStatus(() => {}, async () => out, () => 0, branch, () => true, () => fetchOn, findBase);
    const wt = { key: 'w', label: 'w', branch: 'w' };
    const list = () => [
      view({ workDir: 'C:/Main', baseBranch: 'main', mainBranch: 'feature' }),
      view({ workDir: 'C:/W', baseBranch: 'main', mainBranch: 'feature', worktree: wt }),
    ];
    status.apply(list());
    for (let i = 0; i < 4; i++) await tick();
    assert.deepEqual(found, ['C:/W']);
    assert.deepEqual(seen, [['main', undefined], ['main-found', 'feature']]);
    const [main] = status.apply(list());
    assert.deepEqual(main!.changes, { changed: 0, untracked: 0, ahead: 1, behind: 2, merged: false, aheadOfBase: true });
    assert.equal(main!.baseBranch, 'main');
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

describe('readRefs（.git のファイルから ref の先頭を読む）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(40);
  const repo = join(tmp.path, 'repo');
  const git = join(repo, '.git');
  const wt = join(tmp.path, 'wt');

  before(() => {
    writeJson(join(git, 'HEAD'), 'ref: refs/heads/main\n');
    writeJson(join(git, 'refs', 'heads', 'main'), `${a}\n`);
    writeJson(join(git, 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/main\n');
    writeJson(join(git, 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${b} refs/remotes/origin/main\n${c} refs/tags/v1\n^${a}\n`);
    // ワークツリー：.git ファイル → .git/worktrees/wt（HEAD はそこ、ref は共有の場所）
    writeJson(join(wt, '.git'), `gitdir: ${join(git, 'worktrees', 'wt')}\n`);
    writeJson(join(git, 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/claude/x\n');
    writeJson(join(git, 'worktrees', 'wt', 'commondir'), '../..\n');
    writeJson(join(git, 'refs', 'heads', 'claude', 'x'), `${c}\n`);
  });

  it('ばらのファイル、packed-refs、シンボリックな ref を読み、ないものは null', () =>
    assert.deepEqual(readRefs(repo, ['refs/heads/main', 'refs/remotes/origin/main', 'refs/remotes/origin/HEAD', 'refs/heads/none']), {
      head: a,
      refs: [a, b, b, null],
    }));

  it('ワークツリーの HEAD は、その gitdir から読み、ref は元のリポジトリから読む', () => {
    mkdirSync(join(wt, 'sub'), { recursive: true });
    assert.deepEqual(readRefs(join(wt, 'sub'), ['refs/heads/main']), { head: c, refs: [a] });
  });

  it('途中がフォルダやファイルの名前は packed-refs を見て、なければ null', () =>
    assert.deepEqual(readRefs(repo, ['refs/heads/claude', 'refs/heads/main/x']), { head: a, refs: [null, null] }));

  it('HEAD がコミットを直接指していれば、その ID', () => {
    const detached = join(tmp.path, 'detached');
    writeJson(join(detached, '.git', 'HEAD'), `${b}\n`);
    assert.deepEqual(readRefs(detached, []), { head: b, refs: [] });
  });

  it('まだコミットがない、reftable なら undefined', () => {
    const empty = join(tmp.path, 'empty');
    writeJson(join(empty, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    assert.equal(readRefs(empty, []), undefined);
    const reftable = join(tmp.path, 'reftable');
    writeJson(join(reftable, '.git', 'HEAD'), `${a}\n`);
    writeJson(join(reftable, '.git', 'reftable', 'tables.list'), '');
    assert.equal(readRefs(reftable, []), undefined);
  });

  it('本物の git と同じ値を読む（packed-refs とワークツリー）', () => {
    const real = join(tmp.path, 'real');
    const g = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
    try {
      g(tmp.path, 'init', '-q', '-b', 'main', real);
    } catch {
      return; // git がなければ確かめない
    }
    g(real, 'commit', '-q', '--allow-empty', '-m', 'one');
    g(real, 'branch', 'develop');
    g(real, 'pack-refs', '--all');
    g(real, 'commit', '-q', '--allow-empty', '-m', 'two');
    const tree = join(tmp.path, 'real-wt');
    g(real, 'worktree', 'add', '-q', '-b', 'feature', tree, 'develop');
    g(tree, 'commit', '-q', '--allow-empty', '-m', 'three');
    assert.deepEqual(readRefs(tree, ['refs/heads/develop', 'refs/heads/main', 'refs/remotes/origin/main']), {
      head: g(tree, 'rev-parse', 'HEAD'),
      refs: [g(real, 'rev-parse', 'refs/heads/develop'), g(real, 'rev-parse', 'refs/heads/main'), null],
    });
  });
});

describe('createBranchReader（ref が変わるまで使い回す）', () => {
  const counts = 'rev-list --left-right --count refs/heads/main...HEAD';
  const first = 'rev-list --first-parent --reverse HEAD..refs/heads/main';
  const outputs: Record<string, string> = {
    [counts]: '2\t0\n',
    [first]: 'c1\n',
    'rev-parse c1^1 HEAD': 'p\nh\n',
    'rev-list --left-right --count refs/heads/dev...HEAD': '0\t1\n',
  };
  type Refs = { head: string; refs: (string | null)[] } | undefined;
  const setup = (start: Refs) => {
    const calls: string[] = [];
    let state = start;
    const run = async (_dir: string, args: string[]) => {
      const key = args.join(' ');
      calls.push(key);
      if (!(key in outputs)) throw new Error(`unexpected: ${key}`);
      return outputs[key]!;
    };
    const read = createBranchReader(run, () => state);
    return { read, calls, set: (next: Refs) => (state = next) };
  };

  it('HEAD と ref の先頭が同じなら git を起動しない', async () => {
    const { read, calls } = setup({ head: 'h', refs: ['m'] });
    const one = await read('C:/W', 'main');
    assert.deepEqual(one, { behind: 2, ahead: 0, merged: true });
    const n = calls.length;
    // 返した結果を書き換えても、使い回す中身は変わらない
    one.merged = false;
    assert.deepEqual(await read('c:/w/', 'main'), { behind: 2, ahead: 0, merged: true });
    assert.equal(calls.length, n);
    assert.equal(read.stats().calls, n);
  });

  it('HEAD か ref の先頭が変わったら調べ直す', async () => {
    const { read, calls, set } = setup({ head: 'h', refs: ['m'] });
    await read('C:/W', 'main');
    const n = calls.length;
    set({ head: 'h2', refs: ['m'] });
    await read('C:/W', 'main');
    assert.equal(calls.length, 2 * n);
    set({ head: 'h2', refs: ['m2'] });
    await read('C:/W', 'main');
    assert.equal(calls.length, 3 * n);
  });

  it('比べる ref が違えば、同じフォルダでも調べ直す', async () => {
    const { read, calls } = setup({ head: 'h', refs: ['m'] });
    await read('C:/W', 'main');
    const n = calls.length;
    await read('C:/W', 'main', undefined, 'develop');
    assert.ok(calls.length > n);
  });

  it('先頭を読めなければ、毎回 git に聞く', async () => {
    const { read, calls } = setup(undefined);
    await read('C:/W', 'main');
    const n = calls.length;
    await read('C:/W', 'main');
    assert.equal(calls.length, 2 * n);
  });

  it('元のブランチがないと読めたら、git を起動せず遅れ 0', async () => {
    const { read, calls } = setup({ head: 'h', refs: [null] });
    assert.deepEqual(await read('C:/W', 'gone'), { behind: 0, ahead: 0, merged: false });
    assert.equal(calls.length, 0);
  });

  it('途中で git が失敗したら覚えない', async () => {
    const { read, calls } = setup({ head: 'h', refs: ['x'] });
    // other の rev-list は出力を用意していないので失敗する
    assert.deepEqual(await read('C:/W', 'other'), { behind: 0, ahead: 0, merged: false });
    await read('C:/W', 'other');
    assert.equal(calls.length, 2);
  });

  it('ないと読めたリモートの写しで git が失敗しても、覚えてよい', async () => {
    const { read, calls } = setup({ head: 'h', refs: ['m', null] });
    await read('C:/W', 'dev', 'refs/remotes/origin/dev');
    const n = calls.length;
    assert.equal(n, 2);
    await read('C:/W', 'dev', 'refs/remotes/origin/dev');
    assert.equal(calls.length, n);
  });
});

describe('readRefs（共有の場所の決め方とたどり方）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(40);

  it('commondir のない gitdir（サブモジュールなど）は、ref もその gitdir から読む', () => {
    const top = join(tmp.path, 'top');
    const modules = join(top, '.git', 'modules', 'sub');
    // 上のリポジトリにも同じ名前のブランチがあるが、読んではいけない
    writeJson(join(top, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeJson(join(top, '.git', 'refs', 'heads', 'main'), `${a}\n`);
    writeJson(join(modules, 'HEAD'), `${b}\n`);
    writeJson(join(modules, 'refs', 'heads', 'main'), `${c}\n`);
    writeJson(join(top, 'sub', '.git'), 'gitdir: ../.git/modules/sub\n');
    assert.deepEqual(readRefs(join(top, 'sub'), ['refs/heads/main', 'refs/heads/develop']), { head: b, refs: [c, null] });
  });

  it('HEAD が packed-refs にだけあるブランチを指していても読む', () => {
    const repo = join(tmp.path, 'packed');
    writeJson(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeJson(join(repo, '.git', 'packed-refs'), `${a} refs/heads/main\n`);
    assert.deepEqual(readRefs(repo, []), { head: a, refs: [] });
  });

  it('シンボリックな ref を何段もたどる。輪になっていれば読めないとする', () => {
    const repo = join(tmp.path, 'chain');
    writeJson(join(repo, '.git', 'HEAD'), `${a}\n`);
    writeJson(join(repo, '.git', 'refs', 'heads', 'x'), 'ref: refs/heads/y\n');
    writeJson(join(repo, '.git', 'refs', 'heads', 'y'), 'ref: refs/heads/z\n');
    writeJson(join(repo, '.git', 'refs', 'heads', 'z'), `${b}\n`);
    assert.deepEqual(readRefs(repo, ['refs/heads/x']), { head: a, refs: [b] });
    writeJson(join(repo, '.git', 'refs', 'heads', 'z'), 'ref: refs/heads/x\n');
    assert.equal(readRefs(repo, ['refs/heads/x']), undefined);
  });
});

describe('本物の git で、ふだんの読み直しで git を増やさない', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const g = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();

  it('元のフォルダが既定以外のブランチ（push 済みと未 push）でも、ref が変わらなければ分岐元との比べに git を起動しない', async () => {
    const repo = join(tmp.path, 'repo');
    const remote = join(tmp.path, 'remote.git');
    try {
      g(tmp.path, 'init', '-q', '-b', 'main', repo);
    } catch {
      return; // git がなければ確かめない
    }
    g(repo, 'commit', '-q', '--allow-empty', '-m', 'one');
    g(repo, 'switch', '-q', '-c', 'feature');
    g(repo, 'commit', '-q', '--allow-empty', '-m', 'two');
    g(repo, 'commit', '-q', '--allow-empty', '-m', 'three');

    const reader = createBranchReader();
    /** 分岐元との比べが終わるたびに解ける約束 */
    let done = () => {};
    let compared = new Promise<void>((r) => (done = r));
    const branch: ReadBranch = async (...args) => {
      try {
        return await reader(...args);
      } finally {
        done();
      }
    };
    let statusRuns = 0;
    const run = async (dir: string, untracked?: boolean) => {
      statusRuns++;
      return realGit(dir, ['status', '--porcelain=v2', '--branch', ...(untracked === false ? ['--untracked-files=no'] : [])]);
    };
    const status = createGitStatus(() => {}, run, () => 0, branch, () => true);
    const list = () => [view({ workDir: repo, baseBranch: 'main', mainBranch: 'feature' })];
    const round = async () => {
      compared = new Promise<void>((r) => (done = r));
      status.invalidate();
      status.apply(list());
      await compared;
      await tick();
      return status.apply(list())[0]!.changes;
    };

    // 1a：push していない。追跡するブランチがないので、分岐元に未マージの数を出す
    assert.deepEqual(await round(), { changed: 0, untracked: 0, ahead: 2, behind: 0, merged: false, aheadOfBase: true });
    const calls = reader.stats().calls;
    assert.ok(calls > 0);
    for (let i = 0; i < 3; i++) await round();
    assert.equal(reader.stats().calls, calls, 'ref が同じなら分岐元との比べに git を起動しない');
    assert.equal(statusRuns, 4, 'git status は読み直しのたびに 1 回だけ');

    // 1b：push 済み（追跡するブランチがあり、push していないコミットは 0）でも、分岐元に未マージの数を出す
    g(tmp.path, 'init', '-q', '--bare', remote);
    g(repo, 'remote', 'add', 'origin', remote);
    g(repo, 'push', '-q', '-u', 'origin', 'feature');
    assert.deepEqual(await round(), { changed: 0, untracked: 0, ahead: 2, behind: 0, merged: false, aheadOfBase: true });
    const after = reader.stats().calls;
    await round();
    assert.equal(reader.stats().calls, after);
  });
});
