// バックグラウンドの作業の数え方（src/main/background-work.ts）と、jsonl の差分の読み取り（src/main/jsonl-tail.ts）を確かめる。
// 記録は一時フォルダに作った偽のもので、本物の Claude のデータには触れない。

import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { countBackgroundWork, createBackgroundReader } from '../src/main/background-work';
import { projectDirName } from '../src/main/context-usage';
import { createJsonlTail } from '../src/main/jsonl-tail';
import { disposeBackgroundReaders, readSessions, toState } from '../src/main/sessions';
import { stateLabel, statusIconName, tooltip } from '../src/renderer/model';
import { ja } from '../src/shared/strings/ja';
import { tempDir, writeJson } from './helpers';

/** 偽の時刻の起点（Unix ミリ秒） */
const T0 = 1_000_000_000_000;
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

/** ツールの結果の行（開始） */
function result(toolUseResult: Record<string, unknown>, sec = 10): string {
  return JSON.stringify({
    type: 'user',
    timestamp: at(sec),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'ok' }] },
    toolUseResult,
  });
}

function notification(id: string, status?: string): string {
  return `<task-notification>\n<task-id>${id}</task-id>\n${status ? `<status>${status}</status>\n` : ''}<summary>done</summary>\n</task-notification>`;
}

/** 終了の通知（ユーザーの発言として入る行） */
function userNote(id: string, status?: string, sec = 20): string {
  return JSON.stringify({ type: 'user', timestamp: at(sec), message: { role: 'user', content: notification(id, status) } });
}

/** 終了の通知（キューに入った行） */
function queued(id: string, status?: string, sec = 20): string {
  return JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: at(sec), content: notification(id, status) });
}

const bash = (id: string, sec?: number) => result({ interrupted: false, backgroundTaskId: id }, sec);
const agent = (id: string, sec?: number) => result({ status: 'async_launched', agentId: id, isAsync: true }, sec);
const monitor = (id: string, sec?: number) => result({ taskId: id, timeoutMs: 300000, persistent: false }, sec);

describe('countBackgroundWork（記録の行から数える）', () => {
  it('Bash：開始して終わっていなければ 1、終われば 0', () => {
    assert.equal(countBackgroundWork([bash('b1')]), 1);
    assert.equal(countBackgroundWork([bash('b1'), queued('b1', 'completed')]), 0);
    assert.equal(countBackgroundWork([bash('b1'), userNote('b1', 'killed')]), 0);
  });

  it('自動でバックグラウンドに回った Bash（timedOutAfterMs）も数える', () =>
    assert.equal(countBackgroundWork([result({ backgroundTaskId: 'b2', timedOutAfterMs: 120000 })]), 1));

  it('サブエージェント：async_launched を開始、通知で終わる', () => {
    assert.equal(countBackgroundWork([agent('a1')]), 1);
    assert.equal(countBackgroundWork([agent('a1'), userNote('a1', 'failed')]), 0);
    // 同期のサブエージェント（completed で返る）は数えない
    assert.equal(countBackgroundWork([result({ status: 'completed', agentId: 'a2' })]), 0);
  });

  it('Monitor：途中のイベントの通知（status なし）は終了と数えない', () => {
    assert.equal(countBackgroundWork([monitor('m1'), queued('m1'), userNote('m1')]), 1);
    assert.equal(countBackgroundWork([monitor('m1'), queued('m1'), userNote('m1', 'stopped')]), 0);
    // timeoutMs も persistent もない taskId は Monitor と見なさない
    assert.equal(countBackgroundWork([result({ taskId: 't1' })]), 0);
  });

  it('TaskStop で止めた作業は、終了の通知がなくても終わったと数える', () => {
    const stop = (id: string, message = `Successfully stopped task: ${id} (sleep 600)`) =>
      result({ message, task_id: id, task_type: 'local_bash', command: 'sleep 600' }, 30);
    assert.equal(countBackgroundWork([bash('b1'), stop('b1')]), 0);
    assert.equal(countBackgroundWork([bash('b1'), agent('a1'), stop('a1')]), 1);
    // 止められなかったときは数え続ける
    assert.equal(countBackgroundWork([bash('b1'), stop('b1', 'No task found with ID: b1')]), 1);
    // 別の作業を止めても変わらない
    assert.equal(countBackgroundWork([bash('b1'), stop('b9')]), 1);
  });

  it('いくつも動いているときは数を足す。同じ ID は 1 回だけ数える', () =>
    assert.equal(countBackgroundWork([bash('b1'), bash('b1'), agent('a1'), monitor('m1'), queued('a1', 'completed'), userNote('a1', 'completed')]), 2));

  it('CLI が起動した時刻（startedAt）より前に始まった作業は数えない', () => {
    const lines = [bash('old', 5), bash('new', 15)];
    assert.equal(countBackgroundWork(lines), 2);
    assert.equal(countBackgroundWork(lines, T0 + 10_000), 1);
  });

  it('ツールの結果に通知と同じ文字が出ても、終了と数えない', () => {
    const echo = JSON.stringify({
      type: 'user',
      timestamp: at(20),
      message: { role: 'user', content: [{ type: 'tool_result', content: notification('b1', 'completed') }] },
      toolUseResult: { stdout: notification('b1', 'completed') },
    });
    assert.equal(countBackgroundWork([bash('b1'), echo]), 1);
  });

  it('壊れた行と関係のない行は飛ばす', () =>
    assert.equal(countBackgroundWork(['{"type":"user","toolUseResult":{"backgroundTaskId"', '', JSON.stringify({ type: 'assistant' }), bash('b1')]), 1));
});

describe('createJsonlTail（増えた分だけ読む）', () => {
  const tmp = tempDir();
  after(tmp.cleanup);

  it('最初は全体、次は増えた分だけ。書きかけの最後の行は、改行が来るまで残す', () => {
    const path = join(tmp.path, 'a.jsonl');
    writeFileSync(path, '{"n":1}\n{"n":2}\n{"n":');
    const tail = createJsonlTail(path);
    assert.deepEqual(tail.read()?.lines, ['{"n":1}', '{"n":2}']);
    assert.deepEqual(tail.read()?.lines, []);
    appendFileSync(path, '3}\r\n{"n":4}');
    assert.deepEqual(tail.read()?.lines, ['{"n":3}']);
    appendFileSync(path, '\n');
    assert.deepEqual(tail.read()?.lines, ['{"n":4}']);
    assert.equal(tail.pending(), 0);
  });

  it('文字の途中で区切って読んでも、文字が壊れない', () => {
    const path = join(tmp.path, 'b.jsonl');
    writeFileSync(path, '{"t":"日本語"}\n');
    const tail = createJsonlTail(path);
    const got: string[] = [];
    for (let i = 0; i < 40; i++) got.push(...(tail.read(2)?.lines ?? []));
    assert.deepEqual(got, ['{"t":"日本語"}']);
  });

  it('ファイルが小さくなったら、最初から読み直す', () => {
    const path = join(tmp.path, 'c.jsonl');
    writeFileSync(path, '{"n":1}\n{"n":2}\n');
    const tail = createJsonlTail(path);
    tail.read();
    writeFileSync(path, '{"n":9}\n');
    assert.deepEqual(tail.read(), { lines: ['{"n":9}'], reset: true, more: false });
  });

  it('大きさの上限で止めたら more が true', () => {
    const path = join(tmp.path, 'd.jsonl');
    writeFileSync(path, '{"n":1}\n{"n":2}\n');
    const tail = createJsonlTail(path);
    assert.deepEqual(tail.read(10), { lines: ['{"n":1}'], reset: false, more: true });
    assert.deepEqual(tail.read(10), { lines: ['{"n":2}'], reset: false, more: false });
  });

  it('ファイルがなければ undefined', () => assert.equal(createJsonlTail(join(tmp.path, 'none.jsonl')).read(), undefined));
});

describe('createBackgroundReader（セッションごとの差分の読み取り）', () => {
  const tmp = tempDir();
  after(tmp.cleanup);
  const folder = 'C:\\repo';
  const jsonl = (projects: string, id: string) => join(projects, projectDirName(folder), `${id}.jsonl`);

  it('増えた分を読んで数を更新する。startedAt が変わったら数え直す', () => {
    const projects = join(tmp.path, 'p1');
    const path = jsonl(projects, 'cli-1');
    writeJson(path, `${bash('b1', 5)}\n${bash('b2', 15)}\n`);
    const reader = createBackgroundReader(projects, () => {});
    try {
      assert.equal(reader.read('cli-1', [folder], undefined), 2);
      appendFileSync(path, `${queued('b2', 'completed', 30)}\n`);
      assert.equal(reader.read('cli-1', [folder], undefined), 1);
      // CLI を再起動した（b1 は終了の通知がないまま消えた）
      assert.equal(reader.read('cli-1', [folder], T0 + 10_000), 0);
    } finally {
      reader.dispose();
    }
  });

  it('大きい記録は少しずつ読み、読み終えたら知らせる', async () => {
    const projects = join(tmp.path, 'p2');
    const filler = JSON.stringify({ type: 'assistant', message: { content: 'x'.repeat(1000) } });
    writeJson(jsonl(projects, 'cli-2'), `${Array.from({ length: 600 }, () => filler).join('\n')}\n${bash('b1')}\n`);
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const reader = createBackgroundReader(projects, () => resolve());
    try {
      assert.equal(reader.read('cli-2', [folder], undefined), undefined, '読み終えるまでは数を返さない');
      await done;
      assert.equal(reader.read('cli-2', [folder], undefined), 1);
    } finally {
      reader.dispose();
    }
  });

  it('記録がなければ undefined', () => {
    const reader = createBackgroundReader(join(tmp.path, 'none'), () => {});
    assert.equal(reader.read('cli-3', [folder], undefined), undefined);
    reader.dispose();
  });
});

describe('readSessions がバックグラウンドの作業の数を付ける', () => {
  const tmp = tempDir();
  const folder = 'C:\\repo';
  after(() => {
    disposeBackgroundReaders();
    tmp.cleanup();
  });

  it('待機中なら数を付け、処理中なら付けない。shell は待機中で作業 1 以上', () => {
    const base = join(tmp.path, 'data');
    const runningDir = join(tmp.path, 'running');
    const projects = join(tmp.path, 'projects');
    const dir = join(base, 'claude_x', 'claude-code-sessions', 'a', 'b');
    for (const n of [1, 2, 3]) {
      writeJson(join(dir, `local_s${n}.json`), { sessionId: `local_s${n}`, title: `s${n}`, cliSessionId: `cli-${n}`, cwd: folder, lastActivityAt: n });
    }
    writeJson(join(runningDir, '1.json'), { pid: process.pid, sessionId: 'cli-1', status: 'idle', startedAt: T0 });
    writeJson(join(runningDir, '2.json'), { pid: process.pid, sessionId: 'cli-2', status: 'busy', startedAt: T0 });
    writeJson(join(runningDir, '3.json'), { pid: process.pid, sessionId: 'cli-3', status: 'shell', startedAt: T0 });
    for (const n of [1, 2]) writeJson(join(projects, projectDirName(folder),`cli-${n}.jsonl`), `${bash('b1')}\n${agent('a1')}\n`);
    const sessions = readSessions({ runningDir, dataBase: base, projectsDir: projects });
    const by = (title: string) => sessions.find((s) => s.title === title);
    assert.equal(by('s1')?.state, 'idle');
    assert.equal(by('s1')?.background, 2);
    assert.equal(by('s2')?.state, 'busy');
    assert.equal(by('s2')?.background, undefined);
    assert.equal(by('s3')?.state, 'idle');
    assert.equal(by('s3')?.background, 1);
  });

  it('toState は shell を待機として扱う', () => assert.equal(toState({ status: 'shell' }), 'idle'));
});

describe('バックグラウンドで作業中の表示（renderer/model.ts）', () => {
  it('待機中で作業があれば、砂時計と専用の文字。ツールチップに件数', () => {
    assert.equal(statusIconName('idle', undefined, 2), 'hourglass');
    assert.equal(stateLabel('idle', undefined, 2), ja.state.background);
    assert.equal(statusIconName('idle'), 'message-square-more');
    assert.equal(stateLabel('idle', undefined, 0), ja.state.idle);
    // 待機中のときだけ（処理中になれば、残っていても処理中の表示）
    assert.equal(stateLabel('busy', undefined, 2), ja.state.busy);
    const tip = tooltip({ id: 'local_x', title: 't', repoKey: 'r', repoName: 'r', state: 'idle', background: 3, createdAt: 0, lastActivityAt: 0 });
    assert.ok(tip.includes(ja.tooltip.background(3)));
  });
});
