// セッションの読み取り（src/main/sessions.ts）を、一時フォルダに作った偽のデータで確かめる

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { readFixture, readSessions, shortBranch, toState, type DataPaths } from '../src/main/sessions';
import type { SessionView } from '../src/shared/types';
import { tempDir, writeJson } from './helpers';

/** Windows の PID は 4 の倍数なので、奇数の PID のプロセスはない */
const DEAD_PID = 2_147_483_645;

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
      '(無題)', 'dead', 'entered worktree', 'no git', 'other repo', 'outside worktree', 'outside worktree without anchors', 'shared worktree', 'spawned', 'waiting', 'worktree',
    ]);
  });

  it('対応待ち → 処理中 → 待機 → 停止中 の順', () => {
    assert.deepEqual(sessions.map((s) => s.state), [
      'waiting', 'busy', 'idle', 'idle', 'idle', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped',
    ]);
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
    assert.equal(byTitle('(無題)')?.state, 'stopped');
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
    assert.equal(byTitle('(無題)')?.repoKey, plain.repoKey);
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
    assert.deepEqual(['no git', '(無題)', 'spawned'].map((t) => byTitle(t)?.seq), [1, 2, 3]);
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
    assert.deepEqual(list.map((s) => s.id), ['local_b', 'local_c', 'local_a']);
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
