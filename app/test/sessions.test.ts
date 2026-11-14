// セッションの読み取り（src/main/sessions.ts）を、一時フォルダに作った偽のデータで確かめる

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createJsonCache, FULL_SCAN_MS, InterruptTracker, jsonCacheFor, readDefaultBranch, readFixture, readSessions, sessionCacheStats, shortBranch, toState, type DataPaths } from '../src/main/sessions';
import type { SessionView } from '../src/shared/types';
import { tempDir, writeJson as writeInPlace } from './helpers';

/**
 * Claude と同じく、一時ファイル（`<名前>.tmp`）に書いてから名前を変えて差し替える（docs/research/data-sources.md）。
 * フォルダの更新時刻が変わるので、readSessions がフォルダの時刻を見て省く仕組みでも変化を拾う
 */
function writeJson(path: string, data: unknown) {
  writeInPlace(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

/** Windows の PID は 4 の倍数なので、奇数の PID のプロセスはない */
const DEAD_PID = 2_147_483_645;

describe('InterruptTracker（中断の見分け）', () => {
  const v = (id: string, state: SessionView['state'], extra: Partial<SessionView> = {}): SessionView =>
    ({ id, title: id, repoKey: 'r', repoName: 'r', state, createdAt: 0, lastActivityAt: 0, ...extra });
  it('処理中か対応待ちから止まったものに付け、止まっている間は残す', () => {
    const t = new InterruptTracker();
    t.apply([v('a', 'busy'), v('b', 'waiting'), v('c', 'idle')]);
    const stopped = t.apply([v('a', 'stopped'), v('b', 'stopped'), v('c', 'stopped')]);
    assert.deepEqual(stopped.map((s) => !!s.interrupted), [true, true, false]);
    assert.equal(t.apply([v('a', 'stopped')])[0]?.interrupted, true);
  });
  it('起動した時点で止まっていたものには付けない', () => {
    assert.equal(new InterruptTracker().apply([v('a', 'stopped')])[0]?.interrupted, undefined);
  });
  it('動き出したら外す', () => {
    const t = new InterruptTracker();
    t.apply([v('a', 'busy')]);
    t.apply([v('a', 'stopped')]);
    assert.equal(t.apply([v('a', 'idle')])[0]?.interrupted, undefined);
    assert.equal(t.apply([v('a', 'stopped')])[0]?.interrupted, undefined);
  });
  it('読めずに空のときは覚えたまま。見本データの印は残す', () => {
    const t = new InterruptTracker();
    t.apply([v('a', 'busy')]);
    t.apply([]);
    assert.equal(t.apply([v('a', 'stopped')])[0]?.interrupted, true);
    assert.equal(new InterruptTracker().apply([v('x', 'stopped', { interrupted: true })])[0]?.interrupted, true);
  });
});

describe('toState', () => {
  it('動いていなければ停止中', () => assert.equal(toState(undefined), 'stopped'));
  it('waiting と busy はそのまま', () => {
    assert.equal(toState({ status: 'waiting' }), 'waiting');
    assert.equal(toState({ status: 'busy' }), 'busy');
  });
  it('idle、空、知らない値は待機', () => {
    assert.equal(toState({ status: 'idle' }), 'idle');
    assert.equal(toState({}), 'idle');
    assert.equal(toState({ status: 'something-new' }), 'idle');
  });
});

describe('shortBranch', () => {
  it('claude/ と末尾の英数字を省く', () => assert.equal(shortBranch('claude/xenodochial-golick-8c38f8'), 'xenodochial-golick'));
  it('当てはまらなければそのまま', () => {
    assert.equal(shortBranch('feature/login'), 'feature/login');
    assert.equal(shortBranch('claude/abc-12345'), 'abc-12345');
  });
});

describe('readSessions（偽のデータフォルダ）', () => {
  const tmp = tempDir();
  let sessions: SessionView[] = [];
  const byTitle = (title: string) => sessions.find((s) => s.title === title);

  before(() => {
    const paths: DataPaths = { runningDir: join(tmp.path, 'sessions'), dataBase: join(tmp.path, 'Claude-Data') };
    const repo = join(tmp.path, 'Repo');
    writeJson(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const anchor = { gitRoot: repo, commonDir: join(repo, '.git') };

    // 動いている CLI（PID はこのテストのプロセスを借りる）
    const pid = process.pid;
    writeJson(join(paths.runningDir, '1.json'), { pid, sessionId: 'cli-1', status: 'waiting', waitingFor: 'permission prompt' });
    writeJson(join(paths.runningDir, '2.json'), { pid, sessionId: 'cli-2', status: 'busy', waitingFor: 'stale' });
    writeJson(join(paths.runningDir, '3.json'), { pid, sessionId: 'cli-3' });
    writeJson(join(paths.runningDir, '4.json'), { pid: DEAD_PID, sessionId: 'cli-4', status: 'busy' });
    writeJson(join(paths.runningDir, '5.json'), '{ broken');
    writeJson(join(paths.runningDir, 'not-a-pid.json'), { pid, sessionId: 'cli-5', status: 'busy' });

    const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
    const localId = (n: number) => `local_0000000${n}-0000-0000-0000-000000000000`;
    const local = (n: number, d: object) =>
      writeJson(join(dir, `${localId(n)}.json`), {
        sessionId: localId(n),
        lastActivityAt: 1000 * n,
        ...d,
      });
    local(1, { title: 'waiting', cliSessionId: 'cli-1', gitAnchors: [anchor], lastFocusedAt: 500, createdAt: 10 });
    local(2, {
      title: 'worktree',
      cliSessionId: 'cli-2',
      // 末尾の区切りと大文字小文字が違っても、同じカードになる
      gitAnchors: [{ ...anchor, gitRoot: `${repo.toUpperCase()}\\` }],
      worktreeName: 'fix-login',
      worktreePath: join(repo, '.claude', 'worktrees', 'fix-login'),
      branch: 'claude/fix-login-1a2b3c',
      sourceBranch: 'develop',
      turnWrapUp: { description: 'ログインの修正を終えた。' },
      lastFocusedAt: 300,
    });
    local(3, { title: 'no git', cliSessionId: 'cli-3', originCwd: join(tmp.path, 'plain') });
    local(4, {
      title: 'dead',
      cliSessionId: 'cli-4',
      gitAnchors: [anchor],
      postTurnSummary: { needs_action: 'approve', status_detail: 'tests pass' },
      createdAt: 30,
    });
    // アーカイブ済みは、lastFocusedAt が新しくても選ばない。通し番号には数える
    local(5, { title: 'archived', cliSessionId: 'cli-1', isArchived: true, lastFocusedAt: 900, gitAnchors: [anchor], createdAt: 20 });
    local(6, { cliSessionId: 'cli-5', cwd: join(tmp.path, 'plain') });
    // サイドチャット（btw）。親（2 の worktree）より後に lastFocusedAt が書かれる
    local(7, {
      title: 'btw: side chat',
      cliSessionId: 'cli-1',
      lastFocusedAt: 700,
      spawnedFrom: { sessionId: localId(2), sideSession: true, btw: true },
    });
    // btw の付かない別のセッションは、普通のセッションとして出す
    local(8, { title: 'spawned', cwd: join(tmp.path, 'plain'), spawnedFrom: { sessionId: 'local_x', sideSession: true } });
    // リポジトリの外のワークツリー（git worktree add）。gitAnchors の 1 つ目がワークツリーのフォルダになる
    const outside = join(tmp.path, 'Repo-ext');
    writeJson(join(outside, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'Repo-ext')}\n`);
    writeJson(join(repo, '.git', 'worktrees', 'Repo-ext', 'HEAD'), 'ref: refs/heads/feature/ext\n');
    local(9, {
      title: 'outside worktree',
      cwd: outside,
      originCwd: outside,
      gitAnchors: [{ gitRoot: outside, commonDir: anchor.commonDir }, anchor],
    });
    // 途中でワークツリーに入った（EnterWorktree）。local_*.json は元のままで、CLI の cwd だけがワークツリーのサブフォルダを指す
    const moved = join(repo, '.claude', 'worktrees', 'moved');
    writeJson(join(moved, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'moved').replace(/\\/g, '/')}\n`);
    writeJson(join(repo, '.git', 'worktrees', 'moved', 'HEAD'), 'ref: refs/heads/worktree-moved\n');
    writeJson(join(paths.runningDir, '6.json'), { pid, sessionId: 'cli-6', status: 'idle', cwd: join(moved, 'app') });
    local(10, { title: 'entered worktree', cliSessionId: 'cli-6', cwd: repo, originCwd: repo, gitAnchors: [anchor] });
    // 別のリポジトリのワークツリーに移っていても、そのワークツリーとしては扱わない
    const other = join(tmp.path, 'Other-wt');
    writeJson(join(other, '.git'), `gitdir: ${join(tmp.path, 'Other', '.git', 'worktrees', 'x')}\n`);
    writeJson(join(paths.runningDir, '7.json'), { pid, sessionId: 'cli-7', status: 'idle', cwd: other });
    local(11, { title: 'other repo', cliSessionId: 'cli-7', cwd: repo, originCwd: repo, gitAnchors: [anchor], createdAt: 40 });
    // ワークツリーのセッションが、作業フォルダを分けずに始めたセッション。ワークツリーの名前を持たず、gitRoot も元のリポジトリ
    const fixLogin = join(repo, '.claude', 'worktrees', 'fix-login');
    writeJson(join(fixLogin, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'fix-login')}\n`);
    writeJson(join(repo, '.git', 'worktrees', 'fix-login', 'HEAD'), 'ref: refs/heads/claude/fix-login-1a2b3c\n');
    local(12, { title: 'shared worktree', cwd: fixLogin, originCwd: fixLogin, gitAnchors: [anchor], createdAt: 50, spawnedFrom: { sessionId: localId(2) } });
    // リポジトリの外のワークツリーで始めたが、gitAnchors がなく cwd（ここではサブフォルダ）だけを持つ。.git ファイルから上へたどって元のリポジトリを探す
    const bare = join(tmp.path, 'Repo-bare');
    const bareGitDir = join(repo, '.git', 'worktrees', 'Repo-bare');
    writeJson(join(bare, '.git'), `gitdir: ${bareGitDir}\n`);
    writeJson(join(bareGitDir, 'HEAD'), 'ref: refs/heads/feature/bare\n');
    writeJson(join(bareGitDir, 'commondir'), '../..\n');
    local(13, { title: 'outside worktree without anchors', cwd: join(bare, 'app'), createdAt: 60 });
    writeJson(join(dir, 'local_broken.json'), '{');
    writeJson(join(dir, 'other.json'), { sessionId: 'x', title: 'not a session file' });

    sessions = readSessions(paths);
  });
  after(() => tmp.cleanup());

  it('アーカイブ済み、サイドチャット、壊れたファイル、local_ 以外は読まない', () => {
    assert.deepEqual(sessions.map((s) => s.title).sort(), [
      'dead', 'entered worktree', 'no git', 'other repo', 'outside worktree', 'outside worktree without anchors', 'shared worktree', 'spawned', 'waiting', 'worktree', '（無題）',
    ]);
  });

  it('対応待ち → 処理中 → 待機と停止中（混ぜて新しい順）', () => {
    assert.deepEqual(sessions.slice(0, 2).map((s) => s.state), ['waiting', 'busy']);
    const rest = sessions.slice(2);
    assert.deepEqual([...new Set(rest.map((s) => s.state))].sort(), ['idle', 'stopped']);
    assert.deepEqual(rest.map((s) => s.lastActivityAt), [...rest].map((s) => s.lastActivityAt).sort((a, b) => b - a));
  });

  it('lastFocusedAt が一番新しいセッションだけが focused。サイドチャットなら親', () => {
    assert.deepEqual(sessions.filter((s) => s.focused).map((s) => s.title), ['worktree']);
  });

  it('focusedAt は lastFocusedAt。サイドチャットで開いたら親の値にし、開いたことがなければ省く', () => {
    assert.equal(byTitle('waiting')?.focusedAt, 500);
    assert.equal(byTitle('worktree')?.focusedAt, 700);
    assert.equal(byTitle('no git')?.focusedAt, undefined);
  });

  it('waitingFor は対応待ちのときだけ', () => {
    assert.equal(byTitle('waiting')?.waitingFor, 'permission prompt');
    assert.equal(byTitle('worktree')?.waitingFor, undefined);
  });

  it('PID のファイル名でないものや、終わったプロセスは停止中', () => {
    assert.equal(byTitle('dead')?.state, 'stopped');
    assert.equal(byTitle('（無題）')?.state, 'stopped');
  });

  it('ワークツリーも元のリポジトリのカードに入り、ブランチ名を短くする', () => {
    const main = byTitle('waiting')!;
    const wt = byTitle('worktree')!;
    assert.equal(wt.repoKey, main.repoKey);
    assert.equal(main.repoName, 'Repo');
    assert.equal(main.mainBranch, 'main');
    assert.deepEqual(wt.worktree, { key: 'fix-login', label: 'fix-login', branch: 'claude/fix-login-1a2b3c' });
  });

  it('リポジトリの外のワークツリーも元のリポジトリのカードに入り、ブランチは .git ファイルの先から読む', () => {
    const main = byTitle('waiting')!;
    const wt = byTitle('outside worktree')!;
    assert.equal(wt.repoKey, main.repoKey);
    assert.equal(wt.repoName, 'Repo');
    assert.equal(wt.mainBranch, 'main');
    assert.equal(wt.worktree?.branch, 'feature/ext');
    assert.equal(wt.worktree?.label, 'feature/ext');
    assert.notEqual(wt.worktree?.key, byTitle('worktree')?.worktree?.key);
  });

  it('gitAnchors がなく cwd だけを持つ外のワークツリーも、.git ファイルから元のリポジトリを探してそのカードに入れる', () => {
    const main = byTitle('waiting')!;
    const wt = byTitle('outside worktree without anchors')!;
    assert.equal(wt.repoKey, main.repoKey);
    assert.equal(wt.repoName, 'Repo');
    assert.equal(wt.mainBranch, 'main');
    assert.equal(wt.worktree?.branch, 'feature/bare');
    assert.equal(wt.worktree?.key, join(tmp.path, 'Repo-bare').toLowerCase());
    assert.equal(wt.baseBranch, 'main');
    assert.equal(wt.workDir, join(tmp.path, 'Repo-bare'));
  });

  it('途中でワークツリーに入ったセッションは、CLI の今の作業フォルダからワークツリーを見つける', () => {
    const main = byTitle('waiting')!;
    const wt = byTitle('entered worktree')!;
    assert.equal(wt.repoKey, main.repoKey);
    assert.equal(wt.worktree?.branch, 'worktree-moved');
    assert.equal(wt.workDir, join(tmp.path, 'Repo', '.claude', 'worktrees', 'moved'));
    assert.equal(wt.seq, 1);
  });

  it('ワークツリーで作業フォルダを分けずに始めたセッションは、そのワークツリーと同じカードにまとめる', () => {
    const wt = byTitle('shared worktree')!;
    assert.deepEqual(wt.worktree, byTitle('worktree')?.worktree);
    assert.equal(wt.baseBranch, 'develop');
    assert.equal(wt.workDir, join(tmp.path, 'Repo', '.claude', 'worktrees', 'fix-login'));
    assert.equal(wt.seq, 2);
  });

  it('別のリポジトリのワークツリーに移ったセッションは、メインのまま', () => {
    assert.equal(byTitle('other repo')?.worktree, undefined);
    assert.equal(byTitle('other repo')?.workDir, join(tmp.path, 'Repo'));
    assert.equal(byTitle('other repo')?.seq, 4);
  });

  it('元のブランチ：アプリのワークツリーは sourceBranch、自分で作ったものは元のフォルダのブランチ、main にはない', () => {
    assert.equal(byTitle('worktree')?.baseBranch, 'develop');
    assert.equal(byTitle('outside worktree')?.baseBranch, 'main');
    assert.equal(byTitle('waiting')?.baseBranch, undefined);
  });

  it('spawnedFrom と最後のターンのまとめを読む', () => {
    assert.equal(byTitle('spawned')?.spawnedFrom, 'local_x');
    assert.equal(byTitle('worktree')?.summary, 'ログインの修正を終えた。');
    assert.equal(byTitle('waiting')?.spawnedFrom, undefined);
    assert.equal(byTitle('waiting')?.summary, undefined);
  });

  it('git の情報がなければ元の作業フォルダでまとめる', () => {
    const plain = byTitle('no git')!;
    assert.equal(plain.repoName, 'plain');
    assert.equal(plain.mainBranch, undefined);
    assert.equal(byTitle('（無題）')?.repoKey, plain.repoKey);
  });

  it('git status を調べるフォルダ：ワークツリーはその場所、メインはリポジトリ、git でなければなし', () => {
    assert.equal(byTitle('waiting')?.workDir, join(tmp.path, 'Repo'));
    assert.equal(byTitle('worktree')?.workDir, join(tmp.path, 'Repo', '.claude', 'worktrees', 'fix-login'));
    assert.equal(byTitle('outside worktree')?.workDir, join(tmp.path, 'Repo-ext'));
    assert.equal(byTitle('no git')?.workDir, undefined);
  });

  it('通し番号はワークツリーごとに作った順。アーカイブ済みも数え、createdAt が同じなら ID 順', () => {
    assert.equal(byTitle('waiting')?.seq, 1);
    assert.equal(byTitle('dead')?.seq, 3);
    assert.equal(byTitle('worktree')?.seq, 1);
    assert.equal(byTitle('outside worktree')?.seq, 1);
    assert.deepEqual(['no git', '（無題）', 'spawned'].map((t) => byTitle(t)?.seq), [1, 2, 3]);
  });

  it('最後のターンのまとめを読む', () => {
    assert.equal(byTitle('dead')?.needsAction, 'approve');
    assert.equal(byTitle('dead')?.detail, 'tests pass');
  });
});

describe('readSessions（親がないサイドチャット）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());

  it('親が一覧にないときは、どの行も focused にしない', () => {
    const paths: DataPaths = { runningDir: join(tmp.path, 'sessions'), dataBase: join(tmp.path, 'Claude-Data') };
    const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
    writeJson(join(dir, 'local_parent.json'), { sessionId: 'local_parent', title: 'parent', isArchived: true, lastFocusedAt: 100 });
    writeJson(join(dir, 'local_other.json'), { sessionId: 'local_other', title: 'other', lastFocusedAt: 50 });
    writeJson(join(dir, 'local_btw.json'), {
      sessionId: 'local_btw',
      title: 'btw: side chat',
      lastFocusedAt: 200,
      spawnedFrom: { sessionId: 'local_parent', btw: true },
    });
    const list = readSessions(paths);
    assert.deepEqual(list.map((s) => s.title), ['other']);
    assert.equal(list.some((s) => s.focused), false);
  });
});

describe('readFixture', () => {
  const tmp = tempDir();
  const file = join(tmp.path, 'fixture.json');
  const now = 10 * 60_000;
  before(() =>
    writeJson(file, [
      { id: 'local_a', title: 'a', repoKey: 'r', repoName: 'r', state: 'stopped', minutesAgo: 1 },
      { id: 'local_b', title: 'b', repoKey: 'r', repoName: 'r', state: 'waiting', waitingFor: 'dialog open', minutesAgo: 5 },
      { id: 'local_c', title: 'c', repoKey: 'r', repoName: 'r', state: 'idle', minutesAgo: 2 },
    ]),
  );
  after(() => tmp.cleanup());

  it('minutesAgo から時刻を出し、実データと同じ順に並べる', () => {
    const list = readFixture(file, now, 0);
    // 停止中は待機と同じ順位で、新しい順
    assert.deepEqual(list.map((s) => s.id), ['local_b', 'local_a', 'local_c']);
    assert.equal(list[0]?.lastActivityAt, now - 5 * 60_000);
    assert.equal('minutesAgo' in list[0]!, false);
  });

  it('通し番号はファイルに書いた順', () => {
    const list = readFixture(file, now, 0);
    assert.deepEqual(['local_a', 'local_b', 'local_c'].map((id) => list.find((s) => s.id === id)?.seq), [1, 2, 3]);
  });

  it('巡回では状態を 1 つずつ進め、waitingFor を合わせる', () => {
    // now / cycle がちょうど 1 なので、1 段進む
    const list = readFixture(file, now, now);
    const get = (id: string) => list.find((s) => s.id === id)!;
    assert.equal(get('local_a').state, 'waiting');
    assert.equal(get('local_a').waitingFor, 'input needed');
    assert.equal(get('local_b').state, 'busy');
    assert.equal(get('local_b').waitingFor, undefined);
    assert.equal(get('local_c').state, 'stopped');
  });

  it('ファイルがなければ空', () => assert.deepEqual(readFixture(join(tmp.path, 'none.json'), now, 0), []));
});

describe('createJsonCache（解釈した JSON の使い回し）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const file = join(tmp.path, 'a.json');

  it('変わっていなければ読み直さず、同じ中身を返す', () => {
    writeJson(file, { n: 1 });
    const cache = createJsonCache();
    const first = cache.read(file);
    assert.deepEqual(first, { n: 1 });
    assert.equal(cache.read(file), first);
    assert.equal(cache.stats().reads, 1);
  });

  it('大きさか更新時刻が変わったら読み直す', () => {
    writeJson(file, { n: 1 });
    const cache = createJsonCache();
    cache.read(file);
    writeJson(file, { n: 22 });
    assert.deepEqual(cache.read(file), { n: 22 });
    // 同じ大きさでも、更新時刻が変われば読み直す
    writeJson(file, { n: 33 });
    utimesSync(file, new Date(1_000_000), new Date(1_000_000));
    assert.deepEqual(cache.read(file), { n: 33 });
    assert.equal(cache.stats().reads, 3);
  });

  it('読めなかったものは覚えない', () => {
    writeJson(file, '{ broken');
    const cache = createJsonCache();
    assert.equal(cache.read(file), undefined);
    assert.equal(cache.read(file), undefined);
    assert.equal(cache.stats().reads, 2);
    assert.equal(cache.stats().size, 0);
  });

  it('prune で、前の prune から読まなかったファイルを外す', () => {
    const other = join(tmp.path, 'b.json');
    writeJson(file, { n: 1 });
    writeJson(other, { n: 2 });
    const cache = createJsonCache();
    cache.read(file);
    cache.read(other);
    cache.prune();
    assert.equal(cache.stats().size, 2);
    cache.read(file);
    cache.prune();
    assert.equal(cache.stats().size, 1);
  });
});

describe('readSessions（使い回し）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const paths: DataPaths = { runningDir: join(tmp.path, 'sessions'), dataBase: join(tmp.path, 'Claude-Data') };
  const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
  const file = (n: number) => join(dir, `local_${n}.json`);

  it('変わっていないセッションのファイルは読み直さず、変わったものと消えたものは反映する', () => {
    writeJson(file(1), { sessionId: 'local_1', title: 'one', lastActivityAt: 1 });
    writeJson(file(2), { sessionId: 'local_2', title: 'two', lastActivityAt: 2 });
    writeJson(join(paths.runningDir, '1.json'), { pid: process.pid, sessionId: 'cli-1', status: 'busy' });
    const files = jsonCacheFor(paths.dataBase);
    assert.deepEqual(readSessions(paths).map((s) => s.title), ['two', 'one']);
    assert.equal(files.stats().reads, 2);

    readSessions(paths);
    assert.equal(files.stats().reads, 2);

    writeJson(file(1), { sessionId: 'local_1', title: 'one renamed', lastActivityAt: 3 });
    rmSync(file(2));
    assert.deepEqual(readSessions(paths).map((s) => s.title), ['one renamed']);
    assert.equal(files.stats().reads, 3);
    assert.equal(files.stats().size, 1);
  });

  it('作った一覧を書き換えても、次の一覧に響かない', () => {
    const [first] = readSessions(paths);
    first!.title = 'changed';
    first!.changes = { changed: 1, untracked: 0, ahead: 0, behind: 0, merged: false };
    const [again] = readSessions(paths);
    assert.equal(again!.title, 'one renamed');
    assert.equal(again!.changes, undefined);
  });
});

describe('createJsonCache（置き換え）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());

  it('同じ大きさ・同じ更新時刻でも、ファイルを置き換えたら読み直す', () => {
    const file = join(tmp.path, 'a.json');
    const next = join(tmp.path, 'a.json.tmp');
    const at = new Date(2_000_000);
    writeJson(file, { status: 'busy' });
    utimesSync(file, at, at);
    const cache = createJsonCache();
    assert.deepEqual(cache.read(file), { status: 'busy' });
    writeJson(next, { status: 'idle' });
    utimesSync(next, at, at);
    renameSync(next, file);
    assert.deepEqual(cache.read(file), { status: 'idle' });
  });
});

describe('readSessions（呼び出しをまたぐ使い回し）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const paths: DataPaths = { runningDir: join(tmp.path, 'sessions'), dataBase: join(tmp.path, 'Claude-Data') };
  const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
  const file = (n: number) => join(dir, `local_${n}.json`);
  const repo = join(tmp.path, 'Repo');
  const anchor = { gitRoot: repo, commonDir: join(repo, '.git') };
  const stats = () => sessionCacheStats(paths.dataBase);
  /** 前の値からの増え */
  const delta = (before: ReturnType<typeof stats>) => {
    const now = stats();
    return {
      archivedBuilds: now.archivedBuilds - before.archivedBuilds,
      worktreeReads: now.worktreeReads - before.worktreeReads,
      anchorSearches: now.anchorSearches - before.anchorSearches,
    };
  };
  writeJson(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

  it('作業フォルダがリポジトリの一番上なら、.git を読まずにワークツリーでないとする', () => {
    writeJson(file(1), { sessionId: 'local_1', title: 'main', cwd: repo, gitAnchors: [anchor], createdAt: 1 });
    const s = stats();
    const [view] = readSessions(paths, 0);
    assert.equal(view!.worktree, undefined);
    assert.equal(delta(s).worktreeReads, 0);
  });

  it('.git の探索は期限まで使い回し、期限が切れたら探し直す（その間に作ったワークツリーも反映する）', () => {
    const wt = join(repo, '.claude', 'worktrees', 'late');
    writeJson(join(wt, 'README'), 'x');
    // gitAnchors がなく、作業フォルダから探すセッションと、元のリポジトリの gitAnchors でワークツリーのフォルダから始めたセッション
    writeJson(file(2), { sessionId: 'local_2', title: 'no anchors', cwd: join(tmp.path, 'Ext', 'app'), createdAt: 2 });
    writeJson(file(3), { sessionId: 'local_3', title: 'late worktree', cwd: wt, gitAnchors: [anchor], createdAt: 3 });
    const s = stats();
    readSessions(paths, 0);
    const first = delta(s);
    assert.equal(first.anchorSearches, 1);
    assert.ok(first.worktreeReads > 0);
    const byTitle = (list: SessionView[], title: string) => list.find((v) => v.title === title)!;

    // あとからワークツリーにする（.git ファイルを置く）。期限の前は前の結果のまま
    writeJson(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'late')}\n`);
    writeJson(join(repo, '.git', 'worktrees', 'late', 'HEAD'), 'ref: refs/heads/claude/late-abcdef\n');
    const s2 = stats();
    assert.equal(byTitle(readSessions(paths, 59_999), 'late worktree').worktree, undefined);
    assert.deepEqual(delta(s2), { archivedBuilds: 0, worktreeReads: 0, anchorSearches: 0 });

    const s3 = stats();
    assert.equal(byTitle(readSessions(paths, 60_000), 'late worktree').worktree?.branch, 'claude/late-abcdef');
    assert.equal(delta(s3).anchorSearches, 1);
    rmSync(file(2));
    rmSync(file(3));
  });

  it('アーカイブ済みのセッションは中身が変わるまで作り直さず、通し番号は変わらない', () => {
    const wtPath = join(repo, '.claude', 'worktrees', 'w');
    const wt = { worktreeName: 'w', worktreePath: wtPath, branch: 'claude/w-123456', gitAnchors: [anchor] };
    writeJson(file(4), { sessionId: 'local_4', title: 'old', isArchived: true, createdAt: 10, ...wt });
    writeJson(file(5), { sessionId: 'local_5', title: 'old 2', isArchived: true, createdAt: 11, ...wt });
    // 名前を持たず、同じワークツリーのフォルダから始めたセッション。アーカイブ済みの名前のカードにまとめる
    writeJson(join(wtPath, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'w')}\n`);
    writeJson(join(repo, '.git', 'worktrees', 'w', 'HEAD'), 'ref: refs/heads/claude/w-123456\n');
    writeJson(file(6), { sessionId: 'local_6', title: 'live', cwd: wtPath, gitAnchors: [anchor], createdAt: 12 });
    const live = (list: SessionView[]) => list.find((v) => v.title === 'live')!;

    const s = stats();
    const first = live(readSessions(paths, 0));
    assert.equal(delta(s).archivedBuilds, 2);
    assert.equal(first.worktree?.key, 'w');
    assert.equal(first.seq, 3);
    // 返した値を書き換えても、使い回す中身に響かない
    first.worktree!.key = 'changed';
    first.seq = 99;

    const s2 = stats();
    const again = live(readSessions(paths, 1));
    assert.equal(delta(s2).archivedBuilds, 0);
    assert.equal(again.worktree?.key, 'w');
    assert.equal(again.seq, 3);

    // 中身が変わったものだけ作り直す。作った順が変われば番号も変わる
    writeJson(file(4), { sessionId: 'local_4', title: 'old', isArchived: true, createdAt: 13, ...wt });
    const s3 = stats();
    assert.equal(live(readSessions(paths, 2)).seq, 2);
    assert.equal(delta(s3).archivedBuilds, 1);
  });
});

describe('readSessions（archived-sessions.idx でアーカイブ済みの stat を省く）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  let n = 0;
  /** テストごとに別のデータフォルダ（使い回しの表と、全件を見直した時刻を分ける） */
  function setup() {
    const paths: DataPaths = { runningDir: join(tmp.path, `run${++n}`), dataBase: join(tmp.path, `data${n}`) };
    const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
    const file = (id: string) => join(dir, `local_${id}.json`);
    const write = (id: string, archived: boolean, extra: object = {}) =>
      writeJson(file(id), { sessionId: `local_${id}`, title: id, isArchived: archived, createdAt: id.charCodeAt(0), ...extra });
    const index = (data: unknown) => writeJson(join(dir, 'archived-sessions.idx'), data);
    const files = jsonCacheFor(paths.dataBase);
    /** readSessions 1 回の stat の回数と、出た一覧（タイトルと通し番号） */
    const run = (now: number) => {
      const before = files.stats().stats;
      const list = readSessions(paths, now).map((v) => `${v.title}#${v.seq}`);
      return { stats: files.stats().stats - before, list };
    };
    return { write, index, run, files };
  }

  it('.idx に載り、覚えている中身もアーカイブ済みなら stat しない。結果は全件を見たときと同じ', () => {
    const { write, index, run, files } = setup();
    write('a', true);
    write('b', true);
    write('c', false);
    index({ v: 1, archived: ['local_a', 'local_b'] });
    const first = run(0);
    assert.equal(first.stats, 3);
    assert.deepEqual(first.list, ['c#3']);
    // フォルダの時刻を変えて（c を差し替えて）、.idx を使う道を通す
    write('c', false);
    const second = run(1_000);
    assert.equal(second.stats, 1);
    assert.deepEqual(second.list, first.list);
    // stat を省いたものも表から外さない
    assert.equal(files.stats().size, 3);
    write('c', false);
    assert.equal(run(2_000).stats, 1);
  });

  for (const [name, data] of [
    ['.idx がない', undefined],
    ['.idx が JSON でない', '{"v":1,"archived":['],
    ['.idx の v が違う', { v: 2, archived: ['local_a'] }],
    ['.idx の archived が文字列の配列でない', { v: 1, archived: ['local_a', 1] }],
  ] as const) {
    it(`${name}ときは、すべてを stat する`, () => {
      const { write, index, run } = setup();
      write('a', true);
      write('c', false);
      if (data !== undefined) index(data);
      const first = run(0);
      // フォルダの時刻を変えて、.idx を使う道を通す
      write('c', false);
      const second = run(1_000);
      assert.equal(second.stats, 2);
      assert.deepEqual(second.list, first.list);
      assert.deepEqual(second.list, ['c#2']);
    });
  }

  it('アーカイブ：ファイルと .idx のどちらが先に書かれても、両方が書かれたら正しい', () => {
    for (const fileFirst of [true, false]) {
      const { write, index, run } = setup();
      write('a', false);
      index({ v: 1, archived: [] });
      assert.deepEqual(run(0).list, ['a#1']);
      if (fileFirst) write('a', true);
      else index({ v: 1, archived: ['local_a'] });
      // 途中：.idx だけ先なら、覚えている中身がアーカイブ済みでないので stat して読む（まだ一覧に出る）
      const mid = run(1_000);
      assert.equal(mid.stats, 1);
      assert.deepEqual(mid.list, fileFirst ? [] : ['a#1']);
      if (fileFirst) index({ v: 1, archived: ['local_a'] });
      else write('a', true);
      const done = run(2_000);
      assert.deepEqual(done.list, []);
      // 両方がそろったら、次からは stat しない
      assert.equal(run(3_000).stats, 0);
    }
  });

  it('アーカイブを戻す：ファイルと .idx のどちらが先に書かれても、両方が書かれたら正しい', () => {
    for (const fileFirst of [true, false]) {
      const { write, index, run } = setup();
      write('a', true);
      index({ v: 1, archived: ['local_a'] });
      assert.deepEqual(run(0).list, []);
      if (fileFirst) write('a', false, { title: 'back' });
      else index({ v: 1, archived: [] });
      run(1_000);
      if (fileFirst) index({ v: 1, archived: [] });
      else write('a', false, { title: 'back' });
      const done = run(2_000);
      assert.equal(done.stats, 1);
      assert.deepEqual(done.list, ['back#1']);
    }
  });

  it('一定の間隔ですべてを stat し、.idx が取りこぼした変化を拾う', () => {
    const { write, index, run } = setup();
    write('a', true);
    write('c', false);
    index({ v: 1, archived: ['local_a'] });
    run(0);
    // .idx が変わらないまま、ファイルだけアーカイブを戻した（取りこぼし）。周期の前は前の中身のまま
    write('a', false, { title: 'back' });
    const before = run(FULL_SCAN_MS - 1);
    assert.equal(before.stats, 1);
    assert.deepEqual(before.list, ['c#2']);
    const after = run(FULL_SCAN_MS);
    assert.equal(after.stats, 2);
    assert.deepEqual(after.list.sort(), ['back#1', 'c#2']);
    // 時計が戻ったときも、すべてを見直す
    assert.equal(run(0).stats, 2);
  });
});

describe('readSessions（フォルダの更新時刻で stat を省く）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  let n = 0;
  function setup() {
    const paths: DataPaths = { runningDir: join(tmp.path, `run${++n}`), dataBase: join(tmp.path, `data${n}`) };
    const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
    const file = (id: string) => join(dir, `local_${id}.json`);
    const data = (id: string, title = id) => ({ sessionId: `local_${id}`, title, createdAt: id.charCodeAt(0) });
    const files = jsonCacheFor(paths.dataBase);
    // フォルダの時刻が落ち着いた（DIR_SETTLE_MS より前に書かれた）ものとして読む。settled: false なら今の時刻と比べる
    const run = (now: number, settled = true) => {
      const before = files.stats().stats;
      const list = readSessions(paths, now, settled ? Infinity : Date.now()).map((v) => v.title).sort();
      return { stats: files.stats().stats - before, list };
    };
    return { dir, file, data, run, files };
  }

  it('フォルダの時刻が今に近いときは覚えない。同じ刻みのうちに続けて書かれた変化も拾う', () => {
    const { dir, file, data, run } = setup();
    writeJson(file('a'), data('a'));
    assert.deepEqual(run(0, false).list, ['a']);
    // 同じ刻みのうちの書き込み（フォルダの時刻が変わらない）を、上書きで再現する
    const before = statSync(dir).mtimeMs;
    writeFileSync(file('a'), JSON.stringify(data('a', 'same-tick')));
    assert.equal(statSync(dir).mtimeMs, before);
    const again = run(1_000, false);
    assert.equal(again.stats, 1);
    assert.deepEqual(again.list, ['same-tick']);
  });

  it('フォルダの時刻が同じなら、中のファイルを stat しない。省いたものも表から外さない', () => {
    const { file, data, run, files } = setup();
    writeJson(file('a'), data('a'));
    writeJson(file('b'), data('b'));
    assert.equal(run(0).stats, 2);
    const again = run(1_000);
    assert.equal(again.stats, 0);
    assert.deepEqual(again.list, ['a', 'b']);
    assert.equal(files.stats().size, 2);
    assert.deepEqual(run(2_000).list, ['a', 'b']);
  });

  it('名前を変えての差し替え、足したファイル、消したファイルを拾う', () => {
    const { dir, file, data, run } = setup();
    writeJson(file('a'), data('a'));
    writeJson(file('b'), data('b'));
    // 時刻の刻みは粗く、同じ刻みのうちの名前の変更では時刻が変わらないので、前の時刻を過去にずらしておく
    utimesSync(dir, 1_000_000, 1_000_000);
    run(0);
    const before = statSync(dir).mtimeMs;
    writeJson(file('a'), data('a', 'renamed'));
    // 名前を変えるとフォルダの更新時刻が変わる（この仕組みの前提）
    assert.notEqual(statSync(dir).mtimeMs, before);
    // このあとの足すと消すが、名前の変更と同じ刻みに入るとフォルダの時刻が変わらない。落ち着いた時刻として覚えさせるので、
    // 覚える前に過去へずらし、足すと消すで必ず変わるようにする（実際の読み込みは、今に近い時刻を覚えないので取りこぼさない）
    utimesSync(dir, 2_000_000, 2_000_000);
    const changed = run(1_000);
    assert.deepEqual(changed.list, ['b', 'renamed']);
    writeJson(file('c'), data('c'));
    rmSync(file('b'));
    assert.deepEqual(run(2_000).list, ['c', 'renamed']);
  });

  it('上書き（フォルダの時刻が変わらない変化）は、全件の見直しの周期で拾う', () => {
    const { dir, file, data, run } = setup();
    writeJson(file('a'), data('a'));
    run(0);
    const before = statSync(dir).mtimeMs;
    writeFileSync(file('a'), JSON.stringify(data('a', 'overwritten')));
    assert.equal(statSync(dir).mtimeMs, before);
    const early = run(FULL_SCAN_MS - 1);
    assert.equal(early.stats, 0);
    assert.deepEqual(early.list, ['a']);
    const full = run(FULL_SCAN_MS);
    assert.equal(full.stats, 1);
    assert.deepEqual(full.list, ['overwritten']);
  });

  it('前回読めなかったファイルは、フォルダの時刻が同じでも読み直す', () => {
    const { file, run } = setup();
    writeJson(file('a'), '{"sessionId":');
    assert.deepEqual(run(0).list, []);
    const again = run(1_000);
    assert.equal(again.stats, 1);
  });
});

describe('readDefaultBranch（既定のブランチを .git のファイルから読む）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const sha = 'a'.repeat(40);

  it('リモートの HEAD の指すブランチが手元にあれば、それ。origin を先に見る', () => {
    const git = join(tmp.path, 'r1', '.git');
    writeInPlace(join(git, 'refs', 'heads', 'develop'), `${sha}\n`);
    writeInPlace(join(git, 'refs', 'heads', 'trunk'), `${sha}\n`);
    writeInPlace(join(git, 'refs', 'remotes', 'aaa', 'HEAD'), 'ref: refs/remotes/aaa/trunk\n');
    writeInPlace(join(git, 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/develop\n');
    assert.equal(readDefaultBranch(git), 'develop');
  });

  it('リモートの HEAD がなければ、手元の main、master の順。packed-refs も見る', () => {
    const g2 = join(tmp.path, 'r2', '.git');
    writeInPlace(join(g2, 'packed-refs'), `# pack-refs with: peeled\n${sha} refs/heads/master\n${sha} refs/remotes/origin/main\n`);
    assert.equal(readDefaultBranch(g2), 'master');
    writeInPlace(join(g2, 'refs', 'heads', 'main'), `${sha}\n`);
    assert.equal(readDefaultBranch(g2), 'main');
  });

  it('リモートの HEAD の指すブランチが手元になければ、次の候補。どれもなければ undefined', () => {
    const g3 = join(tmp.path, 'r3', '.git');
    writeInPlace(join(g3, 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/develop\n');
    assert.equal(readDefaultBranch(g3), undefined);
    writeInPlace(join(g3, 'refs', 'heads', 'main'), `${sha}\n`);
    assert.equal(readDefaultBranch(g3), 'main');
  });
});

describe('readSessions（元のフォルダの分岐元と、ブランチにいないとき）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());
  const sha = 'b'.repeat(40);
  const setup = (name: string, head: string, extra: (git: string) => void = () => {}) => {
    const paths: DataPaths = { runningDir: join(tmp.path, name, 'sessions'), dataBase: join(tmp.path, name, 'Claude-Data') };
    const repo = join(tmp.path, name, 'Repo');
    const git = join(repo, '.git');
    writeInPlace(join(git, 'HEAD'), head);
    writeInPlace(join(git, 'refs', 'heads', 'main'), `${sha}\n`);
    writeInPlace(join(git, 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/main\n');
    extra(git);
    const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
    const anchor = { gitRoot: repo, commonDir: git };
    return { paths, repo, git, dir, anchor };
  };

  it('既定以外のブランチにいれば、既定のブランチを分岐元にする', () => {
    const { paths, dir, anchor } = setup('feature', 'ref: refs/heads/feature\n');
    writeJson(join(dir, 'local_1.json'), { sessionId: 'local_1', title: 'main', gitAnchors: [anchor] });
    const [v] = readSessions(paths, 0);
    assert.equal(v!.mainBranch, 'feature');
    assert.equal(v!.baseBranch, 'main');
    assert.equal(v!.mainHead, undefined);
  });

  it('既定のブランチにいれば、分岐元はない', () => {
    const { paths, dir, anchor } = setup('onmain', 'ref: refs/heads/main\n');
    writeJson(join(dir, 'local_1.json'), { sessionId: 'local_1', title: 'main', gitAnchors: [anchor] });
    const [v] = readSessions(paths, 0);
    assert.equal(v!.baseBranch, undefined);
  });

  it('ブランチにいなければ、短いコミット ID と、既定のブランチの分岐元', () => {
    const { paths, dir, anchor } = setup('detached', `${'c'.repeat(40)}\n`);
    writeJson(join(dir, 'local_1.json'), { sessionId: 'local_1', title: 'main', gitAnchors: [anchor] });
    const [v] = readSessions(paths, 0);
    assert.equal(v!.mainBranch, undefined);
    assert.equal(v!.mainHead, 'ccccccc');
    assert.equal(v!.baseBranch, 'main');
  });

  it('ワークツリーのブランチが記録の分岐元と同じなら、既定のブランチを分岐元にする', () => {
    const { paths, dir, anchor, repo } = setup('same', 'ref: refs/heads/main\n');
    writeJson(join(dir, 'local_1.json'), {
      sessionId: 'local_1',
      title: 'wt',
      worktreeName: 'w',
      worktreePath: join(repo, '.claude', 'worktrees', 'w'),
      branch: 'develop',
      sourceBranch: 'develop',
      gitAnchors: [anchor],
    });
    const [v] = readSessions(paths, 0);
    assert.equal(v!.worktree?.branch, 'develop');
    assert.equal(v!.baseBranch, 'main');
  });

  it('既定のブランチは期限（60 秒）まで使い回し、ふだんの読み直しでは読まない', () => {
    const { paths, dir, anchor } = setup('ttl', 'ref: refs/heads/feature\n');
    writeJson(join(dir, 'local_1.json'), { sessionId: 'local_1', title: 'main', gitAnchors: [anchor] });
    const reads = () => sessionCacheStats(paths.dataBase).defaultReads;
    readSessions(paths, 0);
    const first = reads();
    for (const t of [1_000, 30_000, 59_999]) assert.equal(readSessions(paths, t)[0]!.baseBranch, 'main');
    assert.equal(reads(), first, '期限の前は読み直さない');
    readSessions(paths, 60_000);
    assert.equal(reads(), first + 1);
  });
});

describe('readSessions（アプリが作ったワークツリーのカード名）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());

  it('ワークツリーの中でブランチを切り替えたら、記録の branch ではなく実際の HEAD の名前にする。目印は worktreeName のまま', () => {
    const paths: DataPaths = { runningDir: join(tmp.path, 'sessions'), dataBase: join(tmp.path, 'Claude-Data') };
    const repo = join(tmp.path, 'Repo');
    const git = join(repo, '.git');
    writeInPlace(join(git, 'HEAD'), 'ref: refs/heads/main\n');
    const wtPath = join(repo, '.claude', 'worktrees', 'w');
    writeInPlace(join(wtPath, '.git'), `gitdir: ${join(git, 'worktrees', 'w')}\n`);
    writeInPlace(join(git, 'worktrees', 'w', 'HEAD'), 'ref: refs/heads/claude/renamed-abcdef\n');
    const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
    const common = { worktreeName: 'w', branch: 'claude/w-123456', gitAnchors: [{ gitRoot: repo, commonDir: git }] };
    writeJson(join(dir, 'local_1.json'), { sessionId: 'local_1', title: 'switched', worktreePath: wtPath, ...common });
    // フォルダを消したなどで HEAD を読めなければ、記録のまま
    writeJson(join(dir, 'local_2.json'), { sessionId: 'local_2', title: 'gone', worktreePath: join(repo, '.claude', 'worktrees', 'gone'), ...common, worktreeName: 'gone' });
    const list = readSessions(paths, 0);
    const by = (t: string) => list.find((v) => v.title === t)!;
    assert.deepEqual(by('switched').worktree, { key: 'w', label: 'renamed', branch: 'claude/renamed-abcdef' });
    assert.deepEqual(by('gone').worktree, { key: 'gone', label: 'w', branch: 'claude/w-123456' });
  });
});

describe('readSessions（gitAnchors が空の配列）', () => {
  const tmp = tempDir();
  after(() => tmp.cleanup());

  it('空なら作業フォルダから .git を探す。git の外なら、これまでどおり git 管理でない', () => {
    const paths: DataPaths = { runningDir: join(tmp.path, 'sessions'), dataBase: join(tmp.path, 'Claude-Data') };
    const repo = join(tmp.path, 'Repo');
    writeInPlace(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeInPlace(join(repo, 'src', 'a.ts'), '');
    const dir = join(paths.dataBase, 'claude_x', 'claude-code-sessions', 'account', 'org');
    writeJson(join(dir, 'local_1.json'), { sessionId: 'local_1', title: 'empty', cwd: join(repo, 'src'), gitAnchors: [] });
    writeJson(join(dir, 'local_2.json'), { sessionId: 'local_2', title: 'plain', cwd: join(tmp.path, 'plain'), gitAnchors: [] });
    const list = readSessions(paths, 0);
    const by = (t: string) => list.find((v) => v.title === t)!;
    assert.equal(by('empty').workDir, repo);
    assert.equal(by('empty').mainBranch, 'main');
    assert.equal(by('plain').workDir, undefined);
  });
});
