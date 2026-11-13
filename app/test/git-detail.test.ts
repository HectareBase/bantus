// カードの git の詳細（src/main/git-detail.ts）を、偽の git で確かめる

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOG_LIMIT, RECENT_LIMIT, buildDetail, cleanBody, createGitDetailReader, parseLog, readLog, splitSubject } from '../src/main/git-detail';

/** `git log --format=...` と同じ形の出力を作る */
function record(short: string, parents: string, seconds: number, subject: string, body = ''): string {
  return `${short}\x1f${parents}\x1f${seconds}\x1f${subject}\x1f${body}\x1e\n`;
}

describe('splitSubject', () => {
  it('<種別>(<範囲>): <要約> を種別と要約に分ける', () => {
    assert.deepEqual(splitSubject('feat(app): ツールチップを自前で描く'), { type: 'feat', text: 'ツールチップを自前で描く' });
    assert.deepEqual(splitSubject('fix: 直す'), { type: 'fix', text: '直す' });
    assert.deepEqual(splitSubject('refactor(main)!: 作り直す'), { type: 'refactor', text: '作り直す' });
  });

  it('形が合わなければ件名をそのまま出す', () => {
    assert.deepEqual(splitSubject("Merge branch 'x'"), { text: "Merge branch 'x'" });
    assert.deepEqual(splitSubject('feat(app):すき間なし'), { text: 'feat(app):すき間なし' });
    assert.deepEqual(splitSubject('1.0: リリース'), { text: '1.0: リリース' });
  });
});

describe('cleanBody', () => {
  it('末尾のトレーラーの段落を除く', () => {
    assert.equal(cleanBody('説明の 1 行目\n2 行目\n\nCo-Authored-By: someone\n'), '説明の 1 行目\n2 行目');
  });

  it('本文の途中の「名前: 値」の行は残す', () => {
    assert.equal(cleanBody('理由: 遅いから\nほかの説明'), '理由: 遅いから\nほかの説明');
  });

  it('トレーラーだけなら空', () => {
    assert.equal(cleanBody('Signed-off-by: a\n'), '');
  });

  it('長いものは切る', () => {
    const body = cleanBody('あ'.repeat(5000));
    assert.ok(body.length < 1100);
    assert.ok(body.endsWith('…'));
  });
});

describe('parseLog', () => {
  it('ID、親、時刻、件名、本文を読む', () => {
    const out = record('abc1234', 'def5678', 1000, 'feat(app): 足す', '本文\n\nCo-Authored-By: x\n') + record('def5678', '', 900, '最初');
    assert.deepEqual(parseLog(out), [
      { short: 'abc1234', parents: ['def5678'], at: 1_000_000, subject: 'feat(app): 足す', type: 'feat', text: '足す', body: '本文' },
      { short: 'def5678', parents: [], at: 900_000, subject: '最初', text: '最初', body: '' },
    ]);
  });

  it('マージコミットの親を両方読む', () => {
    assert.deepEqual(parseLog(record('aaaa111', 'bbbb222 cccc333', 1, 'm'))[0]!.parents, ['bbbb222', 'cccc333']);
  });

  it('空の出力や壊れた行は飛ばす', () => {
    assert.deepEqual(parseLog(''), []);
    assert.deepEqual(parseLog('fatal: something\n'), []);
  });
});

/** 偽の git。呼ばれた引数を記録し、最初に合ったものの答えを返す */
function fakeGit(answers: [RegExp, string][]) {
  const calls: string[] = [];
  const run = async (_dir: string, args: string[]) => {
    const line = args.join(' ');
    calls.push(line);
    const hit = answers.find(([re]) => re.test(line));
    if (!hit) throw new Error(`unexpected git ${line}`);
    return hit[1];
  };
  return { run, calls };
}

describe('readLog', () => {
  it('メインのカードは最近のコミットを数件だけ読む', async () => {
    const g = fakeGit([[/^log /, record('aaaa111', 'bbbb222', 1, 'x')]]);
    const log = await readLog('/r', undefined, false, undefined, g.run);
    assert.equal(log.mode, 'main');
    assert.equal(log.commits.length, 1);
    assert.equal(g.calls.length, 1);
    assert.match(g.calls[0]!, new RegExp(`-n ${RECENT_LIMIT} HEAD$`));
  });

  it('ワークツリーは分岐元にないコミットを読み、一番古いものの親を分岐点にする（git は 1 回）', async () => {
    const g = fakeGit([[/^log /, record('aaaa111', 'bbbb222', 2, 'b') + record('bbbb222', 'cccc333', 1, 'a')]]);
    const log = await readLog('/r', 'main', false, undefined, g.run);
    assert.deepEqual({ mode: log.mode, total: log.total, fork: log.fork }, { mode: 'worktree', total: 2, fork: 'cccc333' });
    assert.equal(g.calls.length, 1);
    assert.match(g.calls[0]!, /refs\/heads\/main\.\.HEAD$/);
    // 増減は数えない
    assert.ok(!g.calls.some((c) => /numstat|--stat|^diff/.test(c)));
  });

  it('コミットがなければ merge-base で分岐点を得る', async () => {
    const g = fakeGit([[/^log /, ''], [/^merge-base /, 'cccc3334444555566667777888899990000aaaa\n']]);
    const log = await readLog('/r', 'main', false, undefined, g.run);
    assert.equal(log.fork, 'cccc333');
    assert.equal(log.total, 0);
  });

  it('上限を超えたら切り、全体の数を数える', async () => {
    const many = Array.from({ length: LOG_LIMIT + 1 }, (_, i) => record(`a${String(i).padStart(6, '0')}`, 'ffff000', i, `c${i}`)).join('');
    const g = fakeGit([[/^log /, many], [/^merge-base /, 'ffff0001111\n'], [/^rev-list --count /, '120\n']]);
    const log = await readLog('/r', 'main', false, undefined, g.run);
    assert.equal(log.commits.length, LOG_LIMIT);
    assert.equal(log.total, 120);
    assert.equal(log.fork, 'ffff000');
  });

  it('マージ済みなら、マージした先の線で取り込む前から数える', async () => {
    const g = fakeGit([
      [/^rev-list --first-parent --reverse HEAD\.\.refs\/heads\/main$/, 'x1\nx2\n'],
      [/^log .*x1\^1\.\.HEAD$/, record('aaaa111', 'f000000', 1, 'a')],
    ]);
    const log = await readLog('/r', 'develop', true, 'main', g.run);
    assert.equal(log.commits.length, 1);
    assert.equal(log.fork, 'f000000');
  });
});

describe('buildDetail', () => {
  const changes = { changed: 2, untracked: 1, ahead: 3, behind: 4, merged: false };

  it('ワークツリーでは遅れを分岐元が進んだ数にし、見出しの ↓ は出さない', () => {
    const d = buildDetail({ dir: '/r', base: 'main', branch: 'claude/x', changes }, { mode: 'worktree', commits: [], total: 3, fork: 'abc' });
    assert.equal(d.behind, 0);
    assert.equal(d.baseAhead, 4);
    assert.equal(d.base, 'main');
  });

  it('メインのカードは取得がオンのとき（upstream があるとき）だけ ↓ を出す', () => {
    assert.equal(buildDetail({ dir: '/r', changes }, { mode: 'main', commits: [], total: 0 }).behind, 0);
    const d = buildDetail({ dir: '/r', changes: { ...changes, upstream: 'origin/main' } }, { mode: 'main', commits: [], total: 0 });
    assert.equal(d.behind, 4);
    assert.equal(d.upstream, 'origin/main');
  });

  it('読めなければ failed', () => {
    assert.equal(buildDetail({ dir: '/r', base: 'main' }, undefined).failed, true);
  });
});

describe('createGitDetailReader', () => {
  const src = { dir: '/repo/wt', base: 'main', branch: 'claude/x', changes: { changed: 0, untracked: 0, ahead: 1, behind: 0, merged: false } };

  it('HEAD と分岐元の先頭が同じなら git を起動しない', async () => {
    const g = fakeGit([[/^log /, record('aaaa111', 'bbbb222', 1, 'x')]]);
    let head = 'h1';
    const read = createGitDetailReader(g.run, () => ({ head, refs: ['b1'] }));
    await read(src);
    await read(src);
    assert.equal(read.stats().calls, 1);
    head = 'h2';
    await read(src);
    assert.equal(read.stats().calls, 2);
  });

  it('先頭を読めないときと、git が失敗したときは覚えない', async () => {
    let fail = true;
    const read = createGitDetailReader(async () => {
      if (fail) throw new Error('timeout');
      return record('aaaa111', 'bbbb222', 1, 'x');
    }, () => ({ head: 'h', refs: ['b'] }));
    assert.equal((await read(src)).failed, true);
    fail = false;
    assert.equal((await read(src)).failed, undefined);
    const noRefs = createGitDetailReader(async () => record('aaaa111', 'bbbb222', 1, 'x'), () => undefined);
    await noRefs(src);
    await noRefs(src);
    assert.equal(noRefs.stats().calls, 2);
  });

  it('分岐元が手元になければ、最近のコミットを出す', async () => {
    const g = fakeGit([[/^log /, record('aaaa111', 'bbbb222', 1, 'x')]]);
    const read = createGitDetailReader(g.run, () => ({ head: 'h', refs: [null] }));
    const d = await read(src);
    assert.equal(d.mode, 'main');
    assert.match(g.calls[0]!, /HEAD$/);
  });
});
