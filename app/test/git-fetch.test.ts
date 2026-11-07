// リモートの取得（src/main/git-fetch.ts）を、偽の git で確かめる

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIRST_DELAY_MS, RETRY_DELAY_MS, afterFetch, classifyFetchError, createGitFetch, fetchArgs, fetchIntervalMs, nextFetchAt,
  type FetchFailure,
} from '../src/main/git-fetch';

const MIN = 60_000;

describe('fetchArgs', () => {
  it('ログインの画面を出さず、FETCH_HEAD を書かず、ついでの掃除をしない。--prune と --all は付けない', () => {
    const args = fetchArgs('origin');
    assert.deepEqual(args, ['-c', 'credential.interactive=never', 'fetch', '--no-auto-gc', '--no-auto-maintenance', '--no-write-fetch-head', '--quiet', 'origin']);
    assert.equal(args.includes('--prune'), false);
    assert.equal(args.includes('--all'), false);
  });
});

describe('classifyFetchError', () => {
  it('ロック', () => {
    assert.equal(classifyFetchError("error: cannot lock ref 'refs/remotes/origin/main': is at abc but expected def", false), 'lock');
    assert.equal(classifyFetchError("fatal: Unable to create 'C:/r/.git/index.lock': File exists.", false), 'lock');
  });
  it('認証の失敗', () => {
    assert.equal(classifyFetchError("remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/o/r.git/'", false), 'auth');
    assert.equal(classifyFetchError("fatal: could not read Username for 'https://github.com': terminal prompts disabled", false), 'auth');
    assert.equal(classifyFetchError('Permission denied (publickey).\nfatal: Could not read from remote repository.', false), 'auth');
  });
  it('通信できない（オフライン、打ち切り）', () => {
    assert.equal(classifyFetchError("fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com", false), 'offline');
    assert.equal(classifyFetchError('', true), 'offline');
  });
  it('それ以外', () => assert.equal(classifyFetchError("fatal: 'nowhere' does not appear to be a git repository", false), 'other'));
});

describe('nextFetchAt', () => {
  const start = 1_000_000;
  it('まだ試していなければ、起動（オンにした時刻）の 1 分後', () => assert.equal(nextFetchAt(undefined, start, 10 * MIN), start + FIRST_DELAY_MS));
  it('試したことがあれば、最後に試してから間隔ぶんあと', () => assert.equal(nextFetchAt({ triedAt: start + 5 * MIN }, start, 10 * MIN), start + 15 * MIN));
  it('ロックのやり直しを待っていれば、その時刻', () => assert.equal(nextFetchAt({ triedAt: start, retryAt: start + MIN }, start, 10 * MIN), start + MIN));
  it('認証の失敗で止めていれば、取得しない', () => assert.equal(nextFetchAt({ triedAt: start, stopped: true }, start, 10 * MIN), undefined));
});

describe('fetchIntervalMs', () => {
  it('5 / 10 / 30 分', () => assert.deepEqual([5, 10, 30].map(fetchIntervalMs), [5 * MIN, 10 * MIN, 30 * MIN]));
  it('ほかの値は 10 分', () => assert.equal(fetchIntervalMs(7), 10 * MIN));
});

describe('afterFetch', () => {
  it('うまくいったら失敗を消す', () => assert.deepEqual(afterFetch({ triedAt: 1, failure: 'other' }, 5, 'ok'), { triedAt: 5, okAt: 5 }));
  it('ロックは 1 分後に 1 度だけやり直す', () => {
    const first = afterFetch({ okAt: 1 }, 10, 'lock');
    assert.deepEqual(first, { triedAt: 10, okAt: 1, failure: 'lock', retryAt: 10 + RETRY_DELAY_MS });
    assert.deepEqual(afterFetch(first, 20, 'lock'), { triedAt: 20, okAt: 1, failure: 'lock' });
  });
  it('認証の失敗は止める', () => assert.deepEqual(afterFetch(undefined, 3, 'auth'), { triedAt: 3, failure: 'auth', stopped: true }));
  it('オフラインは次の回まで待つだけ', () => assert.deepEqual(afterFetch({ okAt: 1 }, 3, 'offline'), { triedAt: 3, okAt: 1, failure: 'offline' }));
});

/** 偽の git。results に並べた順に結果を返す（'ok' か失敗の種類） */
function fakeGit(results: ('ok' | FetchFailure)[], remote: string | undefined) {
  const calls: { dir: string; remote: string }[] = [];
  const messages: Record<FetchFailure, string> = {
    lock: 'error: cannot lock ref',
    auth: 'fatal: Authentication failed',
    offline: 'fatal: Could not resolve host: github.com',
    other: 'fatal: something else',
  };
  return {
    calls,
    run: async (dir: string, r: string) => {
      calls.push({ dir, remote: r });
      const result = results.shift() ?? 'ok';
      if (result !== 'ok') throw new Error(messages[result]);
    },
    remoteOf: async () => remote,
  };
}

const flush = () => new Promise((r) => setImmediate(r));
const target = { commonDir: 'c:/r/.git', dir: 'C:/r', branch: 'main', name: 'r' };

/** 時刻を進められる取得の待ち行列 */
function setup(results: ('ok' | FetchFailure)[], remote?: string | null) {
  const clock = { now: 0 };
  const git = fakeGit(results, remote === null ? undefined : remote ?? 'origin');
  const fetched: string[] = [];
  const f = createGitFetch((c) => fetched.push(c), () => {}, git.run, git.remoteOf, () => clock.now);
  f.setTargets([target]);
  const at = async (ms: number) => {
    clock.now = ms;
    f.tick();
    await flush();
  };
  return { f, git, fetched, clock, at };
}

describe('createGitFetch', () => {
  it('オフのときは取得しない', async () => {
    const { git, at } = setup([]);
    await at(10 * MIN);
    assert.equal(git.calls.length, 0);
  });

  it('オンにしてから 1 分後に取得し、終わったらそのリポジトリを知らせる。次は間隔ぶんあと', async () => {
    const { f, git, fetched, at } = setup([]);
    f.setOptions({ enabled: true, minutes: 5 });
    await at(30_000);
    assert.equal(git.calls.length, 0);
    await at(MIN);
    assert.deepEqual(git.calls, [{ dir: 'C:/r', remote: 'origin' }]);
    assert.deepEqual(fetched, ['c:/r/.git']);
    assert.equal(f.remoteOf('c:/r/.git'), 'origin');
    assert.equal(f.status().lastAt, MIN);
    await at(5 * MIN);
    assert.equal(git.calls.length, 1);
    await at(6 * MIN);
    assert.equal(git.calls.length, 2);
  });

  it('追跡するリモートがなければ取得しない', async () => {
    const { f, git, fetched, at } = setup([], null);
    f.setOptions({ enabled: true, minutes: 10 });
    await at(MIN);
    assert.equal(git.calls.length, 0);
    assert.deepEqual(fetched, []);
  });

  it('認証の失敗でそのリポジトリを止め、設定画面に出す。「今すぐ取得」でまた試す', async () => {
    const { f, git, at } = setup(['auth', 'ok']);
    f.setOptions({ enabled: true, minutes: 5 });
    await at(MIN);
    assert.deepEqual(f.status().failures, [{ name: 'r', failure: 'auth' }]);
    await at(60 * MIN);
    assert.equal(git.calls.length, 1);
    f.fetchNow();
    await flush();
    assert.equal(git.calls.length, 2);
    assert.deepEqual(f.status().failures, []);
  });

  it('オフラインは設定画面に出さない', async () => {
    const { f, at } = setup(['offline']);
    f.setOptions({ enabled: true, minutes: 5 });
    await at(MIN);
    assert.deepEqual(f.status().failures, []);
  });

  it('ロックは 1 分後にやり直す。待っている間は設定画面に出さない', async () => {
    const { f, git, at } = setup(['lock', 'ok']);
    f.setOptions({ enabled: true, minutes: 30 });
    await at(MIN);
    assert.deepEqual(f.status().failures, []);
    await at(2 * MIN);
    assert.equal(git.calls.length, 2);
    assert.equal(f.status().lastAt, 2 * MIN);
  });

  it('ロックのやり直しでもだめなら出し、次の回まで待つ', async () => {
    const { f, git, at } = setup(['lock', 'lock']);
    f.setOptions({ enabled: true, minutes: 30 });
    await at(MIN);
    await at(2 * MIN);
    assert.deepEqual(f.status().failures, [{ name: 'r', failure: 'lock' }]);
    await at(3 * MIN);
    assert.equal(git.calls.length, 2);
    await at(32 * MIN);
    assert.equal(git.calls.length, 3);
  });

  it('オフにしたら記録を消し、リモートも返さない。もう一度オンにしたら、その 1 分後から', async () => {
    const { f, git, clock, at } = setup([]);
    f.setOptions({ enabled: true, minutes: 5 });
    await at(MIN);
    f.setOptions({ enabled: false, minutes: 5 });
    assert.equal(f.remoteOf('c:/r/.git'), undefined);
    assert.deepEqual(f.status(), { enabled: false, running: false, failures: [] });
    clock.now = 10 * MIN;
    f.setOptions({ enabled: true, minutes: 5 });
    await at(10 * MIN);
    assert.equal(git.calls.length, 1);
    await at(11 * MIN);
    assert.equal(git.calls.length, 2);
  });

  it('対象から外れたリポジトリは取得しない', async () => {
    const { f, git, at } = setup([]);
    f.setOptions({ enabled: true, minutes: 5 });
    f.setTargets([]);
    await at(MIN);
    assert.equal(git.calls.length, 0);
  });
});
