// カードの git の詳細（src/main/git-detail.ts）を、偽の git で確かめる

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOG_LIMIT, RECENT_FETCH, RECENT_LIMIT, buildDetail, cleanBody, createGitDetailReader, groupMerges, parseLog, parseMergeSubject, readLog, shortBranch, splitSubject, withTitles } from '../src/main/git-detail';
import type { ParsedCommit } from '../src/main/git-detail';
import { mergeCountLabel, mergeHeadline } from '../src/shared/git-merge';

/** `git log --format=...` と同じ形の出力を作る */
function record(short: string, parents: string, seconds: number, subject: string, body = ''): string {
  return `${short}\x1f${parents}\x1f${seconds}\x1f${subject}\x1f${body}\x1e\n`;
}

describe('splitSubject', () => {
  it('<種別>(<範囲>): <要約> を種別と要約に分ける', () => {
    assert.deepEqual(splitSubject('feat(app): ツールチップを自前で描く'), { type: 'feat', scope: 'app', text: 'ツールチップを自前で描く' });
    assert.deepEqual(splitSubject('fix: 直す'), { type: 'fix', text: '直す' });
    assert.deepEqual(splitSubject('refactor(main)!: 作り直す'), { type: 'refactor', scope: 'main', text: '作り直す' });
    assert.deepEqual(splitSubject('fix(): 空の範囲'), { type: 'fix', text: '空の範囲' });
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
      { short: 'abc1234', parents: ['def5678'], at: 1_000_000, subject: 'feat(app): 足す', type: 'feat', scope: 'app', text: '足す', body: '本文' },
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
    const many = Array.from({ length: 9 }, (_, i) => record(`b${String(i).padStart(6, '0')}`, `b${String(i + 1).padStart(6, '0')}`, 100 - i, `c${i}`)).join('');
    const g = fakeGit([[/^log /, many]]);
    const log = await readLog('/r', undefined, false, undefined, g.run);
    assert.equal(log.mode, 'main');
    assert.equal(log.commits.length, RECENT_LIMIT);
    assert.equal(g.calls.length, 1);
    assert.match(g.calls[0]!, new RegExp(`-n ${RECENT_FETCH} HEAD$`));
  });

  it('メインのカードで push していないコミットがあれば、追跡するブランチにないものを全部読む', async () => {
    const many = Array.from({ length: 9 }, (_, i) => record(`b${String(i).padStart(6, '0')}`, i === 8 ? 'f000000' : `b${String(i + 1).padStart(6, '0')}`, 100 - i, `c${i}`)).join('');
    const g = fakeGit([[/^log .*@\{upstream\}\.\.HEAD$/, many], [/^rev-parse --abbrev-ref @\{upstream\}$/, 'origin/main\n']]);
    const log = await readLog('/r', undefined, false, undefined, g.run, true);
    assert.deepEqual({ mode: log.mode, n: log.commits.length, total: log.total, fork: log.fork, tracking: log.tracking }, { mode: 'main', n: 9, total: 9, fork: 'f000000', tracking: 'origin/main' });
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

  it('メインのカードは push していない数と遅れが変わったら読み直す（追跡するブランチの先頭は読まない）', async () => {
    const g = fakeGit([[/^log /, record('aaaa111', 'bbbb222', 1, 'x')], [/^rev-parse /, 'origin/main\n']]);
    const read = createGitDetailReader(g.run, () => ({ head: 'h', refs: [] }));
    const main = { dir: '/repo', branch: 'main', changes: { changed: 0, untracked: 0, ahead: 1, behind: 0, merged: false } };
    const d = await read(main);
    assert.equal(d.tracking, 'origin/main');
    await read(main);
    assert.equal(read.stats().calls, 2);
    await read({ ...main, changes: { ...main.changes, ahead: 0 } });
    assert.equal(read.stats().calls, 3);
  });

  it('分岐元が手元になければ、最近のコミットを出す', async () => {
    const g = fakeGit([[/^log /, record('aaaa111', 'bbbb222', 1, 'x')]]);
    const read = createGitDetailReader(g.run, () => ({ head: 'h', refs: [null] }));
    const d = await read(src);
    assert.equal(d.mode, 'main');
    assert.match(g.calls[0]!, /HEAD$/);
  });

  it('マージにセッションのタイトルを付ける。覚えた並びは使い回し、タイトルの変化は反映する', async () => {
    const out = record('eeee111', 'bbbb222 aaaa111', 2, "Merge branch 'claude/aaa-1a2b3c'") + record('aaaa111', 'bbbb222', 1, 'a') + record('bbbb222', 'f000000', 1, 'b');
    const read = createGitDetailReader(fakeGit([[/^log /, out]]).run, () => ({ head: 'h', refs: ['b'] }));
    const d1 = await read({ ...src, titles: new Map([['claude/aaa-1a2b3c', '一つ目']]) });
    assert.equal(d1.commits[0]!.merge!.title, '一つ目');
    const d2 = await read({ ...src, titles: new Map([['claude/aaa-1a2b3c', '二つ目']]) });
    assert.equal(d2.commits[0]!.merge!.title, '二つ目');
    assert.equal(read.stats().calls, 1);
  });
});

describe('parseMergeSubject', () => {
  it('Merge branch の形から取り込んだブランチを読む', () => {
    assert.deepEqual(parseMergeSubject("Merge branch 'refs/heads/claude/fix-login-1a2b3c'"), { branch: 'claude/fix-login-1a2b3c', remote: false });
    assert.deepEqual(parseMergeSubject("Merge branch 'main' into claude/x-1a2b3c"), { branch: 'main', remote: false });
    assert.deepEqual(parseMergeSubject("Merge remote-tracking branch 'origin/main'"), { branch: 'origin/main', remote: true });
    assert.deepEqual(parseMergeSubject("Merge remote-tracking branch 'refs/remotes/origin/main' into main"), { branch: 'origin/main', remote: true });
  });

  it('形が読めなければ undefined', () => {
    assert.equal(parseMergeSubject('Merge pull request #1 from a/b'), undefined);
    assert.equal(parseMergeSubject('feat(app): 足す'), undefined);
    assert.equal(parseMergeSubject("Merge branch ''"), undefined);
  });
});

describe('shortBranch', () => {
  it('refs/heads/ と末尾の乱数を除く', () => {
    assert.equal(shortBranch('refs/heads/claude/fix-login-1a2b3c'), 'claude/fix-login');
    assert.equal(shortBranch('claude/git-detail-merges-5f69ab'), 'claude/git-detail-merges');
  });

  it('数字のない語や 6 桁でないものは残す', () => {
    assert.equal(shortBranch('feature/facade'), 'feature/facade');
    assert.equal(shortBranch('fix-decade'), 'fix-decade');
    assert.equal(shortBranch('main'), 'main');
    assert.equal(shortBranch('topic-12345'), 'topic-12345');
  });
});

/** 親を指定したコミット（groupMerges 用） */
function pc(short: string, parents: string[], subject = short): ParsedCommit {
  return { short, parents, at: 0, subject, text: subject, body: '' };
}

describe('groupMerges', () => {
  it('first-parent の線を本線にし、マージの 2 番目の親から辿れるものを子にたたむ', () => {
    // m1 ← m2 ← c0 が本線。m1 は a2 ← a1 を、m2 は b1 を取り込んだ
    const commits = [
      pc('m1', ['m2', 'a2'], "Merge branch 'refs/heads/claude/aaa-1a2b3c'"),
      pc('a2', ['a1']),
      pc('m2', ['c0', 'b1'], "Merge branch 'claude/bbb-4d5e6f'"),
      pc('a1', ['c0']),
      pc('b1', ['c0']),
      pc('c0', ['f0']),
    ];
    const g = groupMerges(commits, { complete: true });
    assert.deepEqual(g.commits.map((c) => c.short), ['m1', 'm2', 'c0']);
    const m1 = g.commits[0]!.merge!;
    assert.deepEqual({ branch: m1.branch, name: m1.name, children: m1.children.map((c) => c.short), more: m1.more }, { branch: 'claude/aaa-1a2b3c', name: 'claude/aaa', children: ['a2', 'a1'], more: undefined });
    assert.deepEqual(g.commits[1]!.merge!.children.map((c) => c.short), ['b1']);
    assert.equal(g.commits[2]!.merge, undefined);
    assert.equal(g.excluded, 0);
    // 画面へは親を渡さない
    assert.ok(!('parents' in g.commits[0]!));
  });

  it('マージの子が日時のずれでマージより前に並んでいても本線に出さない', () => {
    const g = groupMerges([pc('h1', ['m1']), pc('a1', ['c0']), pc('m1', ['c0', 'a1']), pc('c0', [])], { complete: true });
    assert.deepEqual(g.commits.map((c) => c.short), ['h1', 'm1', 'c0']);
    assert.deepEqual(g.commits[1]!.merge!.children.map((c) => c.short), ['a1']);
  });

  it('範囲の外へ続くまとまりは N+（complete のときは分岐元のものとして数えない）', () => {
    const commits = [pc('m1', ['c0', 'a2']), pc('a2', ['a1']), pc('c0', ['x'])];
    assert.equal(mergeCountLabel(groupMerges(commits, { complete: false }).commits[0]!.merge!), '1+');
    assert.equal(mergeCountLabel(groupMerges(commits, { complete: true }).commits[0]!.merge!), '1');
  });

  it('分岐元を取り込んだマージは fromBase にし、件数から外す', () => {
    const commits = [pc('h1', ['m1']), pc('m1', ['w1', 'b9'], "Merge branch 'main' into claude/x-1a2b3c"), pc('w1', ['f0'])];
    const g = groupMerges(commits, { base: 'main', complete: true });
    assert.equal(g.commits[1]!.merge!.fromBase, true);
    assert.equal(g.excluded, 1);
    const remote = groupMerges([pc('m1', ['w1', 'b9'], "Merge remote-tracking branch 'origin/main'"), pc('w1', ['f0'])], { base: 'main', complete: true });
    assert.equal(remote.commits[0]!.merge!.fromBase, true);
    // 分岐元以外のブランチは fromBase にしない
    assert.equal(groupMerges([pc('m1', ['w1', 'b9'], "Merge branch 'develop'"), pc('w1', [])], { base: 'main', complete: true }).commits[0]!.merge!.fromBase, undefined);
  });

  it('件名の形が読めないマージは名前を持たず、件名をそのまま出す', () => {
    const g = groupMerges([pc('m1', ['c0', 'a1'], 'Merge pull request #3'), pc('a1', ['c0']), pc('c0', [])], { complete: true });
    const m = g.commits[0]!.merge!;
    assert.equal(m.name, undefined);
    assert.equal(mergeHeadline(m, g.commits[0]!.text), 'Merge pull request #3');
  });
});

describe('withTitles', () => {
  it('取り込んだブランチのセッションのタイトルを付ける（分岐元のものには付けない）', () => {
    const g = groupMerges([pc('m1', ['m2', 'a1'], "Merge branch 'claude/aaa-1a2b3c'"), pc('a1', ['m2']), pc('m2', ['c0', 'b1'], "Merge branch 'main'"), pc('b1', []), pc('c0', [])], { base: 'main', complete: true });
    const out = withTitles(g.commits, new Map([['claude/aaa-1a2b3c', 'ログインのバグ修正'], ['main', 'x']]));
    assert.equal(mergeHeadline(out[0]!.merge!, out[0]!.text), 'ログインのバグ修正');
    assert.equal(out[1]!.merge!.title, undefined);
    // 元の並び（覚えておくもの）は変えない。タイトルがなければブランチ名
    assert.equal(g.commits[0]!.merge!.title, undefined);
    assert.equal(mergeHeadline(g.commits[0]!.merge!, g.commits[0]!.text), 'claude/aaa');
  });
});

describe('readLog とマージ', () => {
  it('ワークツリーで分岐元を取り込んだマージは total に数えず、分岐点は first-parent の線の端（git は 1 回）', async () => {
    const out =
      record('aaaa111', 'eeee111', 3, 'feat: b') +
      record('eeee111', 'bbbb222 9999999', 2, "Merge branch 'main' into claude/x-1a2b3c") +
      record('bbbb222', 'ffff000', 1, 'feat: a');
    const g = fakeGit([[/^log /, out]]);
    const log = await readLog('/r', 'main', false, undefined, g.run);
    assert.equal(g.calls.length, 1);
    assert.equal(log.total, 2);
    assert.equal(log.fork, 'ffff000');
    assert.equal(log.commits[1]!.merge!.fromBase, true);
  });

  it('一番古いものが取り込んだブランチのコミットでも、分岐点は本線の端', async () => {
    const out = record('eeee111', 'bbbb222 aaaa111', 3, "Merge branch 'claude/aaa-1a2b3c'") + record('bbbb222', 'ffff000', 2, 'b') + record('aaaa111', 'cccc000', 1, 'a');
    const log = await readLog('/r', 'main', false, undefined, fakeGit([[/^log /, out]]).run);
    assert.equal(log.fork, 'ffff000');
    assert.equal(log.total, 3);
  });

  it('メインのカードの最近のコミットは、マージの子をたたんで本線で数える（git は 1 回）', async () => {
    const out =
      record('eeee111', 'eeee222 aaaa111', 5, "Merge branch 'refs/heads/claude/aaa-1a2b3c'") +
      record('aaaa111', 'cccc000', 4, 'feat: a') +
      record('eeee222', 'cccc000 bbbb111', 3, "Merge branch 'claude/bbb-4d5e6f'") +
      record('bbbb111', 'bbbb000', 2, 'fix: b') +
      record('cccc000', 'dddd000', 1, 'docs: c');
    const g = fakeGit([[/^log /, out]]);
    const log = await readLog('/r', undefined, false, undefined, g.run);
    assert.equal(g.calls.length, 1);
    assert.deepEqual(log.commits.map((c) => c.short), ['eeee111', 'eeee222', 'cccc000']);
    assert.equal(log.total, 3);
    assert.equal(mergeCountLabel(log.commits[0]!.merge!), '1');
    // bbbb111 の親は取ってきた範囲の外
    assert.equal(mergeCountLabel(log.commits[1]!.merge!), '1+');
  });
});
