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
    const local = (n: number, d: object) =>
      writeJson(join(dir, `local_0000000${n}-0000-0000-0000-000000000000.json`), {
        sessionId: `local_0000000${n}-0000-0000-0000-000000000000`,
        lastActivityAt: 1000 * n,
        ...d,
      });
    local(1, { title: 'waiting', cliSessionId: 'cli-1', gitAnchors: [anchor] });
    local(2, {
      title: 'worktree',
      cliSessionId: 'cli-2',
      // 末尾の区切りと大文字小文字が違っても、同じカードになる
      gitAnchors: [{ ...anchor, gitRoot: `${repo.toUpperCase()}\\` }],
      worktreeName: 'fix-login',
      branch: 'claude/fix-login-1a2b3c',
    });
    local(3, { title: 'no git', cliSessionId: 'cli-3', originCwd: join(tmp.path, 'plain') });
    local(4, {
      title: 'dead',
      cliSessionId: 'cli-4',
      gitAnchors: [anchor],
      postTurnSummary: { needs_action: 'approve', status_detail: 'tests pass' },
    });
    local(5, { title: 'archived', cliSessionId: 'cli-1', isArchived: true });
    local(6, { cliSessionId: 'cli-5', cwd: join(tmp.path, 'plain') });
    writeJson(join(dir, 'local_broken.json'), '{');
    writeJson(join(dir, 'other.json'), { sessionId: 'x', title: 'not a session file' });

    sessions = readSessions(paths);
  });
  after(() => tmp.cleanup());

  it('アーカイブ済みと壊れたファイル、local_ 以外は読まない', () => {
    assert.deepEqual(sessions.map((s) => s.title).sort(), ['(無題)', 'dead', 'no git', 'waiting', 'worktree']);
  });

  it('対応待ち → 処理中 → 待機 → 停止中 の順', () => {
    assert.deepEqual(sessions.map((s) => s.state), ['waiting', 'busy', 'idle', 'stopped', 'stopped']);
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

  it('git の情報がなければ元の作業フォルダでまとめる', () => {
    const plain = byTitle('no git')!;
    assert.equal(plain.repoName, 'plain');
    assert.equal(plain.mainBranch, undefined);
    assert.equal(byTitle('(無題)')?.repoKey, plain.repoKey);
  });

  it('最後のターンのまとめを読む', () => {
    assert.equal(byTitle('dead')?.needsAction, 'approve');
    assert.equal(byTitle('dead')?.detail, 'tests pass');
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
