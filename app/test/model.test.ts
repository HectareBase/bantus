// 画面に出す形への組み立て（src/renderer/model.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_FOLD, buildCards, buildGroups, cardBadge, cardLayout, changeItems, changesTooltip, displayOrder, foldCounts, foldLabel, formatAgo,
  nextAttention, nextCycleTarget, resolveFocus, shortcutTarget, stateOfRank, statusIconName, tooltip, waitingLabel, type FoldOptions,
} from '../src/renderer/model';
import type { SessionView } from '../src/shared/types';
import { view } from './helpers';

describe('buildCards', () => {
  it('リポジトリごとにまとめ、停止中を分ける', () => {
    const cards = buildCards([
      view({ repoKey: 'a', state: 'idle' }),
      view({ repoKey: 'a', state: 'stopped' }),
      view({ repoKey: 'b', state: 'idle' }),
    ]);
    const a = cards.find((c) => c.key === 'a')!;
    assert.equal(a.active.length, 1);
    assert.equal(a.stopped.length, 1);
  });

  it('急ぐカード → 新しいカードの順', () => {
    const cards = buildCards([
      view({ repoKey: 'old-idle', state: 'idle', lastActivityAt: 1 }),
      view({ repoKey: 'new-idle', state: 'idle', lastActivityAt: 9 }),
      view({ repoKey: 'busy', state: 'busy', lastActivityAt: 0 }),
      view({ repoKey: 'stopped', state: 'stopped', lastActivityAt: 99 }),
      view({ repoKey: 'waiting', state: 'waiting', lastActivityAt: 0 }),
    ]);
    assert.deepEqual(cards.map((c) => c.key), ['waiting', 'busy', 'new-idle', 'old-idle', 'stopped']);
  });
});

describe('buildGroups', () => {
  it('メインは「メイン（ブランチ名）」、ブランチがわからなければ「メイン」', () => {
    assert.equal(buildGroups([view({ mainBranch: 'main' })])[0]?.label, 'メイン（main）');
    assert.equal(buildGroups([view()])[0]?.label, 'メイン');
  });

  it('同じワークツリーは 1 つの小見出しにまとめ、急ぐ順に並べる', () => {
    const wt = { key: 'w', label: 'w-label', branch: 'claude/w-123abc' };
    const groups = buildGroups([
      view({ state: 'idle', lastActivityAt: 50 }),
      view({ worktree: wt, state: 'idle' }),
      view({ worktree: wt, state: 'waiting' }),
    ]);
    assert.deepEqual(groups.map((g) => [g.label, g.sessions.length, g.isMain]), [['w-label', 2, false], ['メイン', 1, true]]);
    assert.equal(groups[0]?.tooltip, 'claude/w-123abc');
  });
});

describe('cardBadge', () => {
  const card = (...patches: Partial<SessionView>[]) => buildCards(patches.map((p) => view(p)))[0]!;
  it('対応待ちがあれば件数を出す', () =>
    assert.deepEqual(cardBadge(card({ state: 'waiting' }, { state: 'waiting' }, { state: 'busy' })), { state: 'waiting', text: '要対応 2' }));
  it('なければ処理中', () => assert.deepEqual(cardBadge(card({ state: 'busy' }, { state: 'idle' })), { state: 'busy', text: '処理中 1' }));
  it('待機と停止中だけなら出さない', () => assert.deepEqual(cardBadge(card({ state: 'idle' }, { state: 'stopped' })), { state: '', text: '' }));
});

describe('nextAttention', () => {
  it('対応待ちになったら付ける（起動した時点で対応待ちでも）', () => {
    assert.equal(nextAttention('busy', 'waiting', false), true);
    assert.equal(nextAttention(undefined, 'waiting', false), true);
  });
  it('処理中から待機になったら付ける', () => assert.equal(nextAttention('busy', 'idle', false), true));
  it('起動した時点で待機なら付けない', () => assert.equal(nextAttention(undefined, 'idle', false), false));
  it('処理中になったら消す', () => {
    assert.equal(nextAttention('waiting', 'busy', true), false);
    assert.equal(nextAttention('idle', 'busy', true), false);
  });
  it('対応待ちから待機・停止中になったら消す', () => {
    assert.equal(nextAttention('waiting', 'idle', true), false);
    assert.equal(nextAttention('waiting', 'stopped', true), false);
  });
  it('状態が同じなら今のまま', () => {
    assert.equal(nextAttention('idle', 'idle', true), true);
    assert.equal(nextAttention('idle', 'idle', false), false);
  });
});

describe('tooltip と waitingLabel', () => {
  it('知っている理由は日本語にする', () => assert.equal(waitingLabel('permission prompt'), '許可待ち'));
  it('知らない理由はそのまま、なければ「不明」', () => {
    assert.equal(waitingLabel('some new reason'), 'some new reason');
    assert.equal(waitingLabel(undefined), '不明');
  });
  it('ワークツリー、理由、対応が必要、まとめを行に分ける', () => {
    const text = tooltip(view({
      title: 't',
      state: 'waiting',
      waitingFor: 'input needed',
      worktree: { key: 'k', label: 'l', branch: 'claude/l-abcdef' },
      needsAction: 'review',
      detail: 'done',
    }));
    assert.equal(text, 't\nワークツリー：claude/l-abcdef\n対応待ち：回答待ち\n対応が必要：review\ndone');
  });
  it('対応待ちでなければ理由を出さない', () => assert.equal(tooltip(view({ title: 't', waitingFor: 'x' })), 't'));
});

describe('formatAgo', () => {
  const now = 100 * 24 * 3_600_000;
  it('境目', () => {
    assert.equal(formatAgo(0, now), '');
    assert.equal(formatAgo(now - 59_999, now), 'たった今');
    assert.equal(formatAgo(now - 60_000, now), '1 分前');
    assert.equal(formatAgo(now - 3_600_000, now), '1 時間前');
    assert.equal(formatAgo(now - 24 * 3_600_000, now), '1 日前');
  });
});

describe('stateOfRank', () => {
  it('順位から状態に戻す', () => assert.deepEqual([0, 1, 2, 3].map(stateOfRank), ['waiting', 'busy', 'idle', 'stopped']));
});

describe('resolveFocus', () => {
  const sessions = [view({ id: 'a', focused: true }), view({ id: 'b' })];
  const pending = { id: 'b', until: 2000 };

  it('クリックがなければファイルの値', () => assert.deepEqual(resolveFocus(sessions, undefined, 1000), { id: 'a', pending: undefined }));
  it('ファイルが追いつくまでは、クリックしたセッション', () =>
    assert.deepEqual(resolveFocus(sessions, pending, 1000), { id: 'b', pending }));
  it('ファイルが追いついたら、待つのをやめる', () => {
    const caught = [view({ id: 'a' }), view({ id: 'b', focused: true })];
    assert.deepEqual(resolveFocus(caught, pending, 1000), { id: 'b', pending: undefined });
  });
  it('時間が過ぎたら、ファイルの値に戻す', () => assert.deepEqual(resolveFocus(sessions, pending, 2000), { id: 'a', pending: undefined }));
  it('クリックしたセッションがなくなったら、ファイルの値', () =>
    assert.deepEqual(resolveFocus([view({ id: 'a', focused: true })], pending, 1000), { id: 'a', pending: undefined }));
});

describe('statusIconName', () => {
  it('対応待ちは理由ごとに変える', () => {
    assert.equal(statusIconName('waiting', 'permission prompt'), 'shield');
    assert.equal(statusIconName('waiting', 'input needed'), 'keyboard');
    assert.equal(statusIconName('waiting', 'dialog open'), 'app-window');
  });
  it('知らない理由と理由なしは circle-alert', () => {
    assert.equal(statusIconName('waiting', 'some new reason'), 'circle-alert');
    assert.equal(statusIconName('waiting'), 'circle-alert');
  });
  it('ほかの状態は理由を見ない', () => {
    assert.deepEqual((['busy', 'idle', 'stopped'] as const).map((s) => statusIconName(s, 'permission prompt')), ['progress-ring', 'message-square-more', 'circle-minus']);
  });
});

describe('displayOrder と nextCycleTarget', () => {
  // 画面の並び：カード waiting（w1）→ カード main（m1 処理中、m2 待機。ワークツリーなし）→ カード wt（メイン t1、ワークツリー t2）
  const wt = { key: 'wt|x', label: 'x', branch: 'claude/x-123abc' };
  const sessions: SessionView[] = [
    view({ id: 'm2', repoKey: 'main', state: 'idle', lastActivityAt: 30 }),
    view({ id: 'm1', repoKey: 'main', state: 'busy', lastActivityAt: 20 }),
    view({ id: 't1', repoKey: 'wt', state: 'idle', lastActivityAt: 5 }),
    view({ id: 't2', repoKey: 'wt', state: 'idle', lastActivityAt: 10, worktree: wt }),
    view({ id: 's1', repoKey: 'main', state: 'stopped', lastActivityAt: 99 }),
    view({ id: 'w1', repoKey: 'waiting', state: 'waiting', lastActivityAt: 1 }),
  ];

  it('画面の上から順に並べ、停止中は入れない', () =>
    assert.deepEqual(displayOrder(sessions).map((s) => s.id), ['w1', 'm2', 'm1', 't2', 't1']));

  it('未確認があれば、表示順でいちばん上のもの', () =>
    assert.equal(nextCycleTarget(sessions, new Set(['t1', 'm1']), 'w1'), 'm1'));
  it('今開いている行は、未確認でも選ばない', () =>
    assert.equal(nextCycleTarget(sessions, new Set(['w1', 't2']), 'w1'), 't2'));
  it('未確認がなければ、今開いている行の次', () => assert.equal(nextCycleTarget(sessions, new Set(), 'm1'), 't2'));
  it('最後の行の次は先頭に戻る', () => assert.equal(nextCycleTarget(sessions, new Set(), 't1'), 'w1'));
  it('今開いている行が一覧にない（停止中）か、わからなければ先頭', () => {
    assert.equal(nextCycleTarget(sessions, new Set(), 's1'), 'w1');
    assert.equal(nextCycleTarget(sessions, new Set(), undefined), 'w1');
  });
  it('ほかに行がなければ何もしない', () => {
    assert.equal(nextCycleTarget([view({ id: 'a' })], new Set(['a']), 'a'), undefined);
    assert.equal(nextCycleTarget([], new Set(), undefined), undefined);
  });

  it('Claude が前面になければ、未確認があっても今開いている行を前面に出す', () =>
    assert.equal(shortcutTarget(sessions, new Set(['t1']), 'm1', false), 'm1'));
  it('Claude が前面にあれば、いつもどおり次へ進む', () =>
    assert.equal(shortcutTarget(sessions, new Set(['t1']), 'm1', true), 't1'));
  it('前面になくても、今開いている行が一覧にない（停止中）か、わからなければ次へ進む', () => {
    assert.equal(shortcutTarget(sessions, new Set(), 's1', false), 'w1');
    assert.equal(shortcutTarget(sessions, new Set(), undefined, false), 'w1');
  });
});

describe('cardLayout', () => {
  const wt = { key: 'w', label: 'w', branch: 'claude/w-123abc' };
  const opts = (patch: Partial<FoldOptions> = {}): FoldOptions => ({ ...NO_FOLD, limit: 2, ...patch });
  const ids = (list: SessionView[]) => list.map((s) => s.id);
  // 急ぐ順に並べてある（メインプロセスと同じ）
  const sessions = (): SessionView[] => [
    view({ id: 'b1', state: 'busy' }),
    view({ id: 'i1', state: 'idle', lastActivityAt: 30 }),
    view({ id: 'i2', state: 'idle', lastActivityAt: 20 }),
    view({ id: 'i3', state: 'idle', lastActivityAt: 10 }),
    view({ id: 's1', state: 'stopped' }),
  ];
  const layout = (list: SessionView[], o: FoldOptions) => cardLayout(buildCards(list)[0]!, o);

  it('上限がなければ、停止中だけを折りたたむ', () => {
    const l = layout(sessions(), NO_FOLD);
    assert.deepEqual(ids(l.sections[0]!.sessions), ['b1', 'i1', 'i2', 'i3']);
    assert.deepEqual([ids(l.fold!.hidden), ids(l.fold!.stopped)], [[], ['s1']]);
  });

  it('上限を超えた分は、急ぐ順で後ろのものから隠す', () => {
    const l = layout(sessions(), opts());
    assert.deepEqual(ids(l.sections[0]!.sessions), ['b1', 'i1']);
    assert.deepEqual([ids(l.fold!.hidden), ids(l.fold!.stopped)], [['i2', 'i3'], ['s1']]);
  });

  it('隠したものも停止中もなければ、折りたたみを出さない', () =>
    assert.equal(layout([view(), view()], opts()).fold, undefined));

  it('対応待ちは上限を超えても出し、枠を先に使う', () => {
    const list = [view({ id: 'w1', state: 'waiting' }), view({ id: 'w2', state: 'waiting' }), view({ id: 'w3', state: 'waiting' }), view({ id: 'b1', state: 'busy' })];
    const l = layout(list, opts());
    assert.deepEqual(ids(l.sections[0]!.sessions), ['w1', 'w2', 'w3']);
    assert.deepEqual(ids(l.fold!.hidden), ['b1']);
  });

  it('常に表示は枠を先に使い、並びは急ぐ順のまま', () => {
    const l = layout(sessions(), opts({ alwaysShow: new Set(['i3']) }));
    assert.deepEqual(ids(l.sections[0]!.sessions), ['b1', 'i3']);
  });

  it('常に表示の停止中は、一覧に残す', () => {
    const l = layout(sessions(), opts({ alwaysShow: new Set(['s1']) }));
    assert.deepEqual(ids(l.sections[0]!.sessions), ['b1', 's1']);
    assert.deepEqual(ids(l.fold!.stopped), []);
  });

  it('未確認と今開いているものは、ほかの行を押し出さずに枠の外へ足す', () => {
    const l = layout(sessions(), opts({ extra: new Set(['i3']) }));
    assert.deepEqual(ids(l.sections[0]!.sessions), ['b1', 'i1', 'i3']);
    assert.deepEqual(ids(l.fold!.hidden), ['i2']);
  });

  it('上限はワークツリーのグループごとにかける', () => {
    const list = [
      view({ id: 'm1' }), view({ id: 'm2' }), view({ id: 'm3' }),
      view({ id: 't1', worktree: wt }), view({ id: 't2', worktree: wt }), view({ id: 't3', worktree: wt }),
    ];
    const l = layout(list, opts());
    assert.deepEqual(l.sections.map((g) => ids(g.sessions)), [['m1', 'm2'], ['t1', 't2']]);
    assert.deepEqual(ids(l.fold!.hidden), ['m3', 't3']);
  });

  it('ワークツリーごとにまとめるときは、グループごとに折りたたむ', () => {
    const list = [
      view({ id: 'm1' }), view({ id: 'm2' }), view({ id: 'm3' }),
      view({ id: 't1', worktree: wt }), view({ id: 'ts', worktree: wt, state: 'stopped' }),
    ];
    const l = layout(list, opts({ scope: 'worktree' }));
    assert.equal(l.fold, undefined);
    assert.deepEqual(l.sections.map((g) => [g.key, ids(g.fold?.hidden ?? []), ids(g.fold?.stopped ?? [])]), [
      ['', ['m3'], []],
      ['w', [], ['ts']],
    ]);
  });

  it('ワークツリーごとにまとめるときは、停止中しかないワークツリーにも小見出しを出す', () => {
    const list = [view({ id: 'm1' }), view({ id: 'ts', worktree: wt, state: 'stopped' })];
    assert.deepEqual(layout(list, opts({ scope: 'worktree' })).sections.map((g) => [g.group?.label, ids(g.sessions)]), [
      ['メイン', ['m1']],
      ['w', []],
    ]);
    // リポジトリごとなら、小見出しを出さない
    assert.deepEqual(layout(list, opts()).sections.map((g) => g.group), [undefined]);
  });
});

describe('foldLabel と foldCounts', () => {
  const fold = (hidden: SessionView[], stopped: SessionView[], changedFolders = 0) => ({ key: 'k', hidden, stopped, changedFolders });
  it('隠したものと停止中の件数', () => {
    assert.equal(foldLabel(fold([view(), view()], [view({ state: 'stopped' })])), 'ほか 2 件・停止中 1');
    assert.equal(foldLabel(fold([view()], [])), 'ほか 1 件');
    assert.equal(foldLabel(fold([], [view({ state: 'stopped' })])), '停止中 1');
  });
  it('変更が残る作業フォルダがあれば添える', () => {
    assert.equal(foldLabel(fold([], [view({ state: 'stopped' })], 2)), '停止中 1・変更が残る作業フォルダ 2');
  });
  it('状態ごとの件数を急ぐ順に。0 件の状態は出さない', () => {
    assert.deepEqual(foldCounts(fold([view({ state: 'idle' }), view({ state: 'busy' }), view({ state: 'idle' })], [view({ state: 'stopped' })])), [
      { state: 'busy', count: 1 }, { state: 'idle', count: 2 }, { state: 'stopped', count: 1 },
    ]);
    assert.deepEqual(foldCounts(fold([], [view({ state: 'stopped' })])), [{ state: 'stopped', count: 1 }]);
  });
});

describe('displayOrder と nextCycleTarget（折りたたみあり）', () => {
  const sessions: SessionView[] = [
    view({ id: 'a1', state: 'idle', lastActivityAt: 30 }),
    view({ id: 'a2', state: 'idle', lastActivityAt: 20 }),
    view({ id: 'a3', state: 'idle', lastActivityAt: 10 }),
    view({ id: 's1', state: 'stopped' }),
  ];
  const opts: FoldOptions = { ...NO_FOLD, limit: 3, alwaysShow: new Set(['a3', 's1']) };

  it('折りたたみの中は入れず、常に表示のものは停止中でも入れる', () =>
    assert.deepEqual(displayOrder(sessions, opts).map((s) => s.id), ['a1', 'a3', 's1']));
  it('巡回も見えている行だけ', () => assert.equal(nextCycleTarget(sessions, new Set(), 'a1', opts), 'a3'));
});

describe('コミットされていない変更', () => {
  const some = { changed: 3, untracked: 2, ahead: 1 };
  it('印は変更・未追跡・push していないコミットの順に、0 でないものだけ', () => {
    assert.deepEqual(changeItems(some), [
      { icon: 'file-pen-line', count: 3 },
      { icon: 'file-plus', count: 2 },
      { icon: 'arrow-up', count: 1 },
    ]);
    assert.deepEqual(changeItems({ changed: 0, untracked: 0, ahead: 4 }), [{ icon: 'arrow-up', count: 4 }]);
    assert.deepEqual(changeItems({ changed: 0, untracked: 0, ahead: 0 }), []);
    assert.deepEqual(changeItems(undefined), []);
  });
  it('内訳はあるものだけ', () => {
    assert.equal(changesTooltip(some), 'コミットされていない変更：変更 3・未追跡 2\npush していないコミット：1');
    assert.equal(changesTooltip({ changed: 0, untracked: 1, ahead: 0 }), 'コミットされていない変更：未追跡 1');
    assert.equal(changesTooltip({ changed: 0, untracked: 0, ahead: 0 }), '');
  });
  it('セッションのツールチップの最後に添える', () => {
    assert.equal(tooltip(view({ title: 't', changes: { changed: 1, untracked: 0, ahead: 0 } })), 't\nコミットされていない変更：変更 1');
  });
  it('小見出しはそのワークツリーの結果を持つ', () => {
    const wt = { key: 'k', label: 'k', branch: 'k' };
    const groups = buildGroups([view({ worktree: wt }), view({ worktree: wt, changes: some }), view({})]);
    assert.deepEqual(groups.find((g) => !g.isMain)?.changes, some);
    assert.equal(groups.find((g) => g.isMain)?.changes, undefined);
  });
  it('小見出しがないときはメインの変更を見出しに出す。あるときは出さない', () => {
    const [flat] = buildCards([view({ changes: some })]);
    assert.deepEqual(cardLayout(flat!).headerChanges, some);
    const [split] = buildCards([view({ changes: some }), view({ worktree: { key: 'k', label: 'k', branch: 'k' } })]);
    assert.equal(cardLayout(split!).headerChanges, undefined);
    const [stoppedWt] = buildCards([view({ state: 'stopped', worktree: { key: 'k', label: 'k', branch: 'k' }, changes: some })]);
    assert.equal(cardLayout(stoppedWt!).headerChanges, undefined, '停止中のワークツリーの変更は見出しに出さない');
  });
  describe('折りたたみの「変更が残る作業フォルダ」', () => {
    const dirty = { changed: 1, untracked: 0, ahead: 0 };
    const wt = (key: string) => ({ key, label: key, branch: key });
    const list = () => [
      view({ state: 'idle', workDir: 'C:/Repo', changes: dirty }),
      view({ state: 'idle', workDir: 'C:/Repo/wt-x', worktree: wt('x') }),
      view({ state: 'stopped', workDir: 'c:/repo', changes: dirty }),
      view({ state: 'stopped', workDir: 'C:/Repo/wt-a', worktree: wt('a'), changes: dirty }),
      view({ state: 'stopped', workDir: 'C:/Repo/wt-a', worktree: wt('a'), changes: dirty }),
      view({ state: 'stopped', workDir: 'C:/Repo/wt-b', worktree: wt('b'), changes: { changed: 0, untracked: 0, ahead: 2 } }),
    ];
    const opts = (scope: 'repo' | 'worktree'): FoldOptions => ({ ...NO_FOLD, scope });
    it('リポジトリごと：小見出しに出ていないフォルダだけを数え、push していないだけのものは数えない', () => {
      const [card] = buildCards(list());
      assert.equal(cardLayout(card!, opts('repo')).fold?.changedFolders, 1);
    });
    it('ワークツリーごと：どのフォルダも小見出しに出るので数えない', () => {
      const [card] = buildCards(list());
      const folds = cardLayout(card!, opts('worktree')).sections.map((g) => g.fold?.changedFolders ?? 0);
      assert.deepEqual(folds.filter((n) => n > 0), []);
    });
    it('小見出しがないとき：見出しに出るメインは数えず、停止中のワークツリーは数える', () => {
      const [card] = buildCards([
        view({ state: 'stopped', workDir: 'C:/Repo', changes: dirty }),
        view({ state: 'stopped', workDir: 'C:/Repo/wt-a', worktree: wt('a'), changes: dirty }),
      ]);
      const layout = cardLayout(card!, opts('repo'));
      assert.deepEqual(layout.headerChanges, dirty);
      assert.equal(layout.fold?.changedFolders, 1);
    });
  });
});
