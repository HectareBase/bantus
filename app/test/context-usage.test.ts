// コンテキストの使用量（src/main/context-usage.ts と、表示の src/renderer/model.ts）を確かめる。
// 会話の記録は一時フォルダに偽物を作り、本物の ~/.claude には触れない。

import assert from 'node:assert/strict';
import { appendFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { contextWindowOf, createContextReader, parseLastUsage, projectDirName, readLastUsage } from '../src/main/context-usage';
import { readSessions } from '../src/main/sessions';
import { contextLabel, contextLevel, contextPercent, contextTooltip, formatTokens } from '../src/renderer/model';
import { tempDir, writeJson } from './helpers';

const usage = (input: number, read: number, create: number) => ({
  input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 99,
});
const assistant = (u: object, extra: object = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-5-5', usage: u }, ...extra });
const user = (text = 'hi') => JSON.stringify({ type: 'user', isSidechain: false, message: { content: text } });
const lines = (...l: string[]) => `${l.join('\n')}\n`;

describe('parseLastUsage（分子）', () => {
  it('最後のアシスタントの発言の input + cache_read + cache_creation', () => {
    const text = lines(assistant(usage(1, 10, 100)), user(), assistant(usage(2, 20_000, 3_000)), user());
    assert.deepEqual(parseLastUsage(text), { tokens: 23_002, model: 'claude-opus-5-5' });
  });
  it('サブエージェントの発言（isSidechain）は除く', () => {
    const text = lines(assistant(usage(5, 500, 0)), assistant(usage(1, 1, 1), { isSidechain: true }));
    assert.equal(parseLastUsage(text)?.tokens, 505);
  });
  it('使用量が 0 の発言と、壊れた行は飛ばす', () => {
    const text = lines(assistant(usage(3, 0, 0)), assistant(usage(0, 0, 0)), '{"type":"assistant","usage":');
    assert.equal(parseLastUsage(text)?.tokens, 3);
  });
  it('先頭の切れた行（末尾だけを読んだとき）を飛ばす', () => {
    const full = lines(assistant(usage(7, 0, 0)));
    assert.equal(parseLastUsage(full.slice(10)), undefined);
    assert.equal(parseLastUsage(`xx"assistant","usage"}\n${full}`)?.tokens, 7);
  });
  it('アシスタントの発言がなければ undefined', () => assert.equal(parseLastUsage(lines(user(), user())), undefined));
  it('欠けた項目は 0 として数える', () =>
    assert.equal(parseLastUsage(lines(assistant({ input_tokens: 4 })))?.tokens, 4));
});

describe('contextWindowOf（分母）', () => {
  it('get_usage で確かめたモデルは 100 万', () => assert.equal(contextWindowOf('claude-opus-5-5'), 1_000_000));
  it('[1m] の付いたモデルは 100 万', () => assert.equal(contextWindowOf('claude-sonnet-5-5[1m]'), 1_000_000));
  it('対応表にないモデルとモデルなしは undefined（割合を出さない）', () => {
    assert.equal(contextWindowOf('claude-sonnet-5-5'), undefined);
    assert.equal(contextWindowOf('claude-haiku-5-5'), undefined);
    assert.equal(contextWindowOf(undefined), undefined);
  });
});

describe('projectDirName', () => {
  it('英数字以外を - にする', () =>
    assert.equal(projectDirName('C:\\Work\\my-app\\.claude\\worktrees\\a_b'), 'C--Work-my-app--claude-worktrees-a-b'));
});

describe('ファイルの末尾から読む', () => {
  const tmp = tempDir();
  after(tmp.cleanup);

  it('最後の発言のあとに大きな行があっても、読む大きさを広げて見つける', () => {
    const path = join(tmp.path, 'big.jsonl');
    writeJson(path, lines(assistant(usage(1, 2, 3)), user('x'.repeat(200 * 1024))));
    const size = Buffer.byteLength(lines(assistant(usage(1, 2, 3)), user('x'.repeat(200 * 1024))));
    assert.equal(readLastUsage(path, size)?.tokens, 6);
  });

  it('作業フォルダから記録を見つけ、大きさと更新時刻が変わったときだけ読み直す', () => {
    const projects = join(tmp.path, 'projects');
    const path = join(projects, projectDirName('C:\\repo'), 'abc-1.jsonl');
    writeJson(path, lines(assistant(usage(10, 0, 0))));
    const reader = createContextReader(projects);
    assert.deepEqual(reader.read('abc-1', ['C:\\repo'], 'claude-opus-5-5'), { tokens: 10, window: 1_000_000, model: 'claude-opus-5-5' });
    appendFileSync(path, lines(assistant(usage(20, 0, 0))));
    assert.equal(reader.read('abc-1', ['C:\\repo'], undefined)?.tokens, 20);
  });

  it('作業フォルダが違っても projects の下を探す。モデルがなければ記録の値を使う', () => {
    const projects = join(tmp.path, 'projects2');
    writeJson(join(projects, 'somewhere-else', 'abc-2.jsonl'), lines(assistant(usage(1, 1, 1))));
    const got = createContextReader(projects).read('abc-2', ['C:\\nowhere'], undefined);
    assert.deepEqual(got, { tokens: 3, window: 1_000_000, model: 'claude-opus-5-5' });
  });

  it('知らないモデルは窓の大きさを付けない', () => {
    const projects = join(tmp.path, 'projects3');
    writeJson(join(projects, 'p', 'abc-3.jsonl'), lines(assistant(usage(5, 0, 0))));
    assert.deepEqual(createContextReader(projects).read('abc-3', [], 'claude-haiku-5-5'), { tokens: 5, model: 'claude-haiku-5-5' });
  });

  it('同じ大きさ・同じ時刻なら読み直さない（使い回し）', () => {
    const projects = join(tmp.path, 'projects4');
    const path = join(projects, 'p', 'abc-4.jsonl');
    const a = lines(assistant(usage(1, 0, 0)));
    writeJson(path, a);
    const reader = createContextReader(projects);
    assert.equal(reader.read('abc-4', [], undefined)?.tokens, 1);
    // 同じ長さで中身だけ変え、時刻を戻す
    writeJson(path, a.replace('"input_tokens":1', '"input_tokens":2'));
    utimesSync(path, new Date(1_000_000), new Date(1_000_000));
    reader.read('abc-4', [], undefined);
    writeJson(path, a.replace('"input_tokens":1', '"input_tokens":3'));
    utimesSync(path, new Date(1_000_000), new Date(1_000_000));
    assert.equal(reader.read('abc-4', [], undefined)?.tokens, 2);
  });

  it('記録がなければ undefined', () =>
    assert.equal(createContextReader(join(tmp.path, 'none')).read('abc-5', ['C:\\repo'], undefined), undefined));

  it('readSessions がセッションに使用量を付ける', () => {
    const base = join(tmp.path, 'data');
    const projects = join(tmp.path, 'projects5');
    writeJson(join(base, 'claude_x', 'claude-code-sessions', 'a', 'b', 'local_s1.json'), {
      sessionId: 'local_s1', cliSessionId: 'cli-1', cwd: 'C:\\repo', model: 'claude-opus-5-5', lastActivityAt: 1,
    });
    writeJson(join(projects, projectDirName('C:\\repo'), 'cli-1.jsonl'), lines(assistant(usage(0, 250_000, 0))));
    const [s] = readSessions({ runningDir: join(tmp.path, 'running'), dataBase: base, projectsDir: projects });
    assert.deepEqual(s?.context, { tokens: 250_000, window: 1_000_000, model: 'claude-opus-5-5' });
  });
});

describe('使用率の表示', () => {
  const c = (tokens: number, window?: number) => ({ tokens, ...(window ? { window } : {}) });
  it('割合', () => {
    assert.equal(contextPercent(c(112_847, 1_000_000)), 11);
    assert.equal(contextPercent(c(112_847)), undefined);
  });
  it('70% から high、90% から full', () => {
    assert.equal(contextLevel(c(694_000, 1_000_000)), 'normal');
    assert.equal(contextLevel(c(700_000, 1_000_000)), 'high');
    assert.equal(contextLevel(c(900_000, 1_000_000)), 'full');
    assert.equal(contextLevel(c(990_000)), 'normal');
  });
  it('割合がわかれば %、わからなければトークン数に単位を付ける', () => {
    assert.equal(contextLabel(c(120_000, 1_000_000)), '12%');
    assert.equal(contextLabel(c(120_000)), '120k tok');
    assert.equal(contextLabel(undefined), '');
  });
  it('トークン数の書き方', () => {
    assert.deepEqual([999, 1234, 123_456, 1_234_567].map(formatTokens), ['999', '1.2k', '123k', '1.2M']);
  });
  it('ツールチップ', () => {
    assert.equal(contextTooltip(c(120_000, 1_000_000)), 'コンテキスト：12%（120k / 1.0M）');
    assert.equal(contextTooltip({ tokens: 5000, model: 'claude-haiku-5-5' }), 'コンテキスト：5.0k（窓の大きさがわからないモデル：claude-haiku-5-5）');
  });
});
