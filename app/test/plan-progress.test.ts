// 処理中のタスクリストの作り直し（src/main/plan-progress.ts）と、行の札の進み具合の表示（src/renderer/model.ts）を確かめる。
// 記録は一時フォルダに作った偽のもので、本物の Claude のデータには触れない。

import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { projectDirName } from '../src/main/context-usage';
import { applyPlanLines, createPlanReader, newPlanState, rebuildPlan, turnStart } from '../src/main/plan-progress';
import { nextPillFit, planLabel, planSteps, tooltip } from '../src/renderer/model';
import { ja } from '../src/shared/strings/ja';
import type { SessionView } from '../src/shared/types';
import { tempDir, writeJson } from './helpers';

let n = 0;
/** アシスタントの発言の行（ツールの呼び出し 1 つ） */
function call(name: string, input: Record<string, unknown>, id = `toolu_${++n}`): string {
  return JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
}
const plan = (input: Record<string, unknown>, id?: string) => call('mcp__ccd_turn__update_plan', input, id);
const items = (...statuses: string[]) => plan({ items: statuses.map((status, i) => ({ content: `手順 ${i + 1}`, status })), scope: 'first_task' });
const wrapUp = () => call('mcp__ccd_turn__wrap_up', { recap: 'おわり' });
/** 本当のユーザーの発言 */
/** 記録の timestamp の形（ISO 8601 の文字列）。分から作る */
const at = (min: number) => new Date(min * 60_000).toISOString();
const userSays = (text = 'お願い', timestamp?: string) =>
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: text }, ...(timestamp && { timestamp }) });
/** ツールの結果（ターンの区切りではない） */
const toolResult = (text = 'Plan updated: step 2 of 3 is in progress.') =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: [{ type: 'text', text }] }] }, toolUseResult: [{ type: 'text', text }] });
/** CLI が入れた発言（isMeta） */
const meta = () => JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '<command-name>x</command-name>' } });

describe('rebuildPlan（記録からタスクリストを作り直す）', () => {
  it('items → advance → done/start の順に当てはめる', () => {
    const lines = [userSays(), items('in_progress', 'pending', 'pending')];
    assert.deepEqual(rebuildPlan(lines), ['active', 'todo', 'todo']);
    lines.push(toolResult('Plan shown (3 steps).'), plan({ advance: true }));
    assert.deepEqual(rebuildPlan(lines), ['done', 'active', 'todo']);
    lines.push(plan({ done: [2], start: 3 }));
    assert.deepEqual(rebuildPlan(lines), ['done', 'done', 'active']);
    lines.push(plan({ advance: true }));
    assert.deepEqual(rebuildPlan(lines), ['done', 'done', 'done']);
  });

  it('advance は今の手順の次から始める。今の手順がなければ最初の「これから」', () => {
    assert.deepEqual(rebuildPlan([items('completed', 'pending', 'in_progress', 'pending'), plan({ advance: true })]), ['done', 'todo', 'done', 'active']);
    assert.deepEqual(rebuildPlan([items('completed', 'pending', 'pending'), plan({ advance: true })]), ['done', 'active', 'todo']);
  });

  it('done だけ、範囲の外の番号', () => {
    assert.deepEqual(rebuildPlan([items('in_progress', 'pending'), plan({ done: [1, 9, 0] })]), ['done', 'todo']);
  });

  it('新しい items でリストを立て直す', () => {
    const lines = [items('in_progress', 'pending'), plan({ advance: true }), items('completed', 'in_progress', 'pending', 'pending')];
    assert.deepEqual(rebuildPlan(lines), ['done', 'active', 'todo', 'todo']);
  });

  it('前のターンのリストは使わない。ツールの結果と CLI が入れた発言はターンの区切りにしない', () => {
    assert.equal(rebuildPlan([items('in_progress', 'pending'), userSays('次の作業')]), undefined);
    assert.deepEqual(rebuildPlan([items('in_progress', 'pending'), toolResult(), meta()]), ['active', 'todo']);
    // 次のターンで作ったリストは使う
    assert.deepEqual(rebuildPlan([items('in_progress', 'pending'), userSays(), items('pending', 'in_progress', 'pending')]), ['todo', 'active', 'todo']);
  });

  it('リストの前の advance は無視する', () => {
    assert.equal(rebuildPlan([userSays(), plan({ advance: true })]), undefined);
  });

  it('手順が 1 つのときは出さない', () => {
    assert.equal(rebuildPlan([items('in_progress')]), undefined);
  });

  it('wrap_up のあとは、すべて終わったものとする', () => {
    assert.deepEqual(rebuildPlan([items('completed', 'in_progress', 'pending'), wrapUp()]), ['done', 'done', 'done']);
  });

  it('同じ tool_use.id は 1 回だけ数える。api-request-blob とサブエージェントの発言は数えない', () => {
    const adv = plan({ advance: true }, 'toolu_same');
    assert.deepEqual(rebuildPlan([items('in_progress', 'pending', 'pending'), adv, adv]), ['done', 'active', 'todo']);
    const blob = JSON.stringify({ type: 'api-request-blob', message: { content: [{ type: 'tool_use', id: 'toolu_b', name: 'mcp__ccd_turn__update_plan', input: { advance: true } }] } });
    const side = JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', id: 'toolu_s', name: 'mcp__ccd_turn__update_plan', input: { advance: true } }] } });
    assert.deepEqual(rebuildPlan([items('in_progress', 'pending'), blob, side]), ['active', 'todo']);
  });

  it('壊れた行は飛ばす', () => {
    const state = newPlanState();
    applyPlanLines(state, [items('in_progress', 'pending'), '{"type":"assistant","message":{"content":[{"name":"mcp__ccd_turn__update_plan"']);
    assert.deepEqual(state.steps, ['active', 'todo']);
  });
});

describe('turnStart（今のターンが始まった時刻）', () => {
  const t1 = at(0);
  const t2 = at(90);

  it('最後の本当のユーザーの発言の timestamp。ツールの結果、CLI が入れた発言、アシスタントの発言では変えない', () => {
    const tagged = (line: string, timestamp: string) => JSON.stringify({ ...JSON.parse(line), timestamp });
    const lines = [userSays('前', t1), items('in_progress', 'pending'), userSays('今', t2), tagged(toolResult(), at(120)), tagged(meta(), at(130)), plan({ advance: true })];
    assert.equal(turnStart(lines), 90 * 60_000);
  });

  it('発言がない、時刻がない、時刻が読めないときは undefined', () => {
    assert.equal(turnStart([items('in_progress', 'pending')]), undefined);
    assert.equal(turnStart([userSays('前', t1), userSays('今')]), undefined);
    assert.equal(turnStart([userSays('今', 'あいう')]), undefined);
  });
});

describe('createPlanReader（増えた分だけ読む）', () => {
  const tmp = tempDir();
  after(tmp.cleanup);
  const folder = 'C:\\repo';
  const jsonl = (projects: string, id: string) => join(projects, projectDirName(folder), `${id}.jsonl`);

  it('増えた分を読んで進める。書き込み途中の行は、改行が来るまで読まない', () => {
    const projects = join(tmp.path, 'p1');
    const path = jsonl(projects, 'cli-1');
    writeJson(path, `${userSays()}\n${items('in_progress', 'pending', 'pending')}\n`);
    const reader = createPlanReader(projects, () => {});
    try {
      assert.deepEqual(reader.read('cli-1', [folder]), ['active', 'todo', 'todo']);
      const line = plan({ advance: true });
      appendFileSync(path, line.slice(0, 20));
      assert.deepEqual(reader.read('cli-1', [folder]), ['active', 'todo', 'todo']);
      appendFileSync(path, `${line.slice(20)}\n`);
      assert.deepEqual(reader.read('cli-1', [folder]), ['done', 'active', 'todo']);
      // 次のターン
      reader.pause('cli-1');
      appendFileSync(path, `${userSays()}\n`);
      assert.equal(reader.read('cli-1', [folder]), undefined);
    } finally {
      reader.dispose();
    }
  });

  it('ターンの途中から読み始めても、ターンが始まった時刻を返す。次のターンで進める', () => {
    const projects = join(tmp.path, 'p4');
    const path = jsonl(projects, 'cli-4');
    const t1 = at(0);
    const t2 = at(45);
    writeJson(path, `${userSays('前', t1)}
${wrapUp()}
${userSays('今', t2)}
${items('in_progress', 'pending')}
${toolResult()}
`);
    const reader = createPlanReader(projects, () => {});
    try {
      assert.equal(reader.since('cli-4'), undefined, 'read の前');
      reader.read('cli-4', [folder]);
      assert.equal(reader.since('cli-4'), 45 * 60_000);
      reader.pause('cli-4');
      const t3 = at(180);
      appendFileSync(path, `${wrapUp()}
${userSays('次', t3)}
`);
      reader.read('cli-4', [folder]);
      assert.equal(reader.since('cli-4'), 180 * 60_000);
    } finally {
      reader.dispose();
    }
  });

  it('ファイルが小さくなったら最初から読み直す', () => {
    const projects = join(tmp.path, 'p2');
    const path = jsonl(projects, 'cli-2');
    writeJson(path, `${items('in_progress', 'pending', 'pending')}\n${plan({ advance: true })}\n`);
    const reader = createPlanReader(projects, () => {});
    try {
      assert.deepEqual(reader.read('cli-2', [folder]), ['done', 'active', 'todo']);
      writeJson(path, `${items('in_progress', 'pending')}\n`);
      assert.deepEqual(reader.read('cli-2', [folder]), ['active', 'todo']);
    } finally {
      reader.dispose();
    }
  });

  it('大きい記録は少しずつ読み、読み終えたら知らせる', async () => {
    const projects = join(tmp.path, 'p3');
    const filler = JSON.stringify({ type: 'attachment', data: 'x'.repeat(1000) });
    writeJson(jsonl(projects, 'cli-3'), `${userSays()}\n${items('in_progress', 'pending')}\n${Array.from({ length: 600 }, () => filler).join('\n')}\n`);
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const reader = createPlanReader(projects, resolve);
    try {
      assert.equal(reader.read('cli-3', [folder]), undefined);
      await done;
      assert.deepEqual(reader.read('cli-3', [folder]), ['active', 'todo']);
    } finally {
      reader.dispose();
    }
  });
});

describe('札の進み具合（model.ts）', () => {
  const view = (state: SessionView['state'], plan?: SessionView['plan']): SessionView =>
    ({ id: 'local_a', title: 'a', repoKey: 'r', repoName: 'r', state, createdAt: 0, lastActivityAt: 0, ...(plan && { plan }) });

  it('処理中で手順が 2 つ以上のときだけ出す', () => {
    assert.deepEqual(planSteps(view('busy', ['done', 'active', 'todo'])), ['done', 'active', 'todo']);
    assert.equal(planSteps(view('busy', ['active'])), undefined);
    assert.equal(planSteps(view('idle', ['done', 'active'])), undefined);
    assert.equal(planSteps(view('busy')), undefined);
  });

  it('今の手順の番号を文にする。すべて終わったら最後の番号', () => {
    assert.equal(planLabel(['done', 'active', 'todo']), ja.tooltip.plan(2, 3));
    assert.equal(planLabel(['done', 'todo', 'todo']), ja.tooltip.plan(2, 3));
    assert.equal(planLabel(['done', 'done']), ja.tooltip.plan(2, 2));
    assert.ok(tooltip(view('busy', ['done', 'active', 'todo'])).includes(ja.tooltip.plan(2, 3)));
    assert.ok(!tooltip(view('busy')).includes(ja.tooltip.plan(1, 2)));
  });
});

describe('札の詰め方の段（nextPillFit）', () => {
  it('棒を細くした札 → 文字を隠す → 棒を隠す、の順に進み、その先はない', () => {
    assert.equal(nextPillFit('full'), 'text-hidden');
    assert.equal(nextPillFit('text-hidden'), 'plan-hidden');
    assert.equal(nextPillFit('plan-hidden'), undefined);
  });
});
