// 画面に出す形への組み立て（src/renderer/model.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_ARCHIVE, buildRepos, cardBadge, changeItems, changesTooltip, displayOrder, formatAgo, isLive, revivedCards, revivedSessions,
  nextAttention, nextCycleTarget, resolveFocus, shortcutTarget, statusIconName, tooltip, waitingLabel, type ArchiveOptions,
  ALERT_COLLECT_MS, ALERT_GAP_MS, alertDelay, alertSound, attentionReason, mergeAlerts, pickAlerts, toastContent, type Alert,
  alertActions, hasAlertOutput, newlyFlagged, openedInClaude,
} from '../src/renderer/model';
import type { GitChanges, SessionView } from '../src/shared/types';
import { view } from './helpers';

const MIN = 60_000;
const wt = (key: string) => ({ key, label: key, branch: `claude/${key}-123abc` });
const opts = (patch: Partial<ArchiveOptions> = {}): ArchiveOptions => ({ ...NO_ARCHIVE, ...patch });
const clean: GitChanges = { changed: 0, untracked: 0, ahead: 0, behind: 0, merged: false };

describe('buildRepos：カードの分け方', () => {
  it('リポジトリごとにまとめ、ワークツリー（元のフォルダを含む）ごとに 1 枚のカードにする', () => {
    const repos = buildRepos([
      view({ repoKey: 'a', repoName: 'app', mainBranch: 'main' }),
      view({ repoKey: 'a', repoName: 'app', worktree: wt('x') }),
      view({ repoKey: 'a', repoName: 'app', worktree: wt('x') }),
      view({ repoKey: 'b', repoName: 'docs' }),
    ]);
    assert.deepEqual(repos.map((r) => [r.name, r.cards.map((c) => [c.label, c.isMain])]), [
      ['app', [['main', true], ['x', false]]],
      ['docs', [['元のフォルダ', true]]],
    ]);
  });

  it('カードの目印は、リポジトリとワークツリーの目印をつないだもの', () => {
    const [repo] = buildRepos([view({ repoKey: 'r', worktree: wt('x') }), view({ repoKey: 'r' })]);
    assert.deepEqual(repo!.cards.map((c) => c.key).sort(), ['r|', 'r|x']);
  });

  it('見出しのツールチップは、ブランチ名の全体と作業フォルダ', () => {
    const [repo] = buildRepos([view({ worktree: wt('x'), workDir: 'C:/Repo/wt' })]);
    assert.equal(repo!.cards[0]!.tooltip, 'ワークツリー：claude/x-123abc\nC:/Repo/wt');
  });

  it('リポジトリの並びは設定に従う（固定は名前順）', () => {
    const list = [
      view({ repoKey: 'k10', repoName: 'app10', lastActivityAt: 5 }),
      view({ repoKey: 'k2', repoName: 'app2', lastActivityAt: 9 }),
      view({ repoKey: 'kb', repoName: 'beta', state: 'waiting', lastActivityAt: 1 }),
    ];
    const sorted = (project: 'fixed' | 'recent' | 'priority') =>
      buildRepos(list, opts({ sort: { project, worktree: 'fixed', session: 'fixed' } })).map((r) => r.key);
    assert.deepEqual(sorted('fixed'), ['k2', 'k10', 'kb']);
    assert.deepEqual(sorted('recent'), ['k2', 'k10', 'kb']);
    assert.deepEqual(sorted('priority'), ['kb', 'k2', 'k10']);
  });

  it('カードの並びは、固定なら元のフォルダが先頭で、あとは名前順', () => {
    const [repo] = buildRepos(
      [view({ worktree: wt('zeta'), state: 'waiting' }), view({}), view({ worktree: wt('alpha') })],
      opts({ sort: { project: 'fixed', worktree: 'fixed', session: 'fixed' } }),
    );
    assert.deepEqual(repo!.cards.map((c) => c.label), ['元のフォルダ', 'alpha', 'zeta']);
  });

  it('見出しの git の印は、そのカードの作業フォルダの結果', () => {
    const some: GitChanges = { ...clean, changed: 2, behind: 3 };
    const [repo] = buildRepos([view({ worktree: wt('x') }), view({ worktree: wt('x'), changes: some }), view({})]);
    assert.deepEqual(repo!.cards.find((c) => !c.isMain)?.changes, some);
    assert.equal(repo!.cards.find((c) => c.isMain)?.changes, undefined);
  });
});

describe('buildRepos：ワークツリーのアーカイブ', () => {
  const list = () => [
    view({ id: 'old', worktree: wt('x'), state: 'stopped', lastActivityAt: 10 }),
    view({ id: 'mid', worktree: wt('x'), state: 'idle', lastActivityAt: 20 }),
    view({ id: 'new', worktree: wt('x'), state: 'idle', lastActivityAt: 30 }),
  ];
  const card = (sessions: SessionView[], o = opts()) => buildRepos(sessions, o)[0]!.cards[0]!;

  it('最後に動いたもの（作った順ではない）を残し、ほかの落ち着いたものをアーカイブする', () => {
    const sessions = list();
    sessions[0]!.lastActivityAt = 99;
    const c = card(sessions);
    assert.deepEqual(c.sessions.map((s) => s.id), ['old']);
    assert.deepEqual(c.archived.map((s) => s.id), ['new', 'mid']);
  });

  it('処理中、対応待ち、未確認のものはアーカイブしない', () => {
    const sessions = list();
    sessions[0]!.state = 'busy';
    sessions[1]!.state = 'waiting';
    assert.deepEqual(card(sessions).sessions.map((s) => s.id).sort(), ['mid', 'new', 'old']);
    assert.deepEqual(card(list(), opts({ attention: new Set(['mid']) })).sessions.map((s) => s.id).sort(), ['mid', 'new']);
  });

  it('手で戻したものは出し、手でアーカイブしたものは隠す', () => {
    const c = card(list(), opts({ marks: { old: 'shown', new: 'archived' } }));
    assert.deepEqual(c.sessions.map((s) => s.id).sort(), ['old']);
    assert.deepEqual(c.archived.map((s) => s.id).sort(), ['mid', 'new']);
  });

  it('手でアーカイブしても、動いていれば出す', () => {
    const sessions = list();
    sessions[2]!.state = 'busy';
    assert.deepEqual(card(sessions, opts({ marks: { new: 'archived' } })).sessions.map((s) => s.id), ['new']);
  });

  it('タイムラインは新しく作ったものが上。spawnedFrom でつながれば実線、なければ破線', () => {
    const sessions = list();
    sessions[2]!.spawnedFrom = 'mid';
    const c = card(sessions);
    assert.deepEqual(c.timeline.map((t) => [t.session.id, t.archived, t.link]), [
      ['new', false, 'solid'],
      ['mid', true, 'dashed'],
      ['old', true, undefined],
    ]);
  });
});

describe('buildRepos：起点（main で始めたセッション）', () => {
  const list = (originState: SessionView['state'] = 'idle') => [
    view({ id: 'origin', state: originState, createdAt: 1, lastActivityAt: 10 }),
    view({ id: 'q', state: 'idle', createdAt: 2, lastActivityAt: 20 }),
    view({ id: 'w1', worktree: wt('x'), spawnedFrom: 'origin', createdAt: 3, lastActivityAt: 30 }),
  ];

  it('落ち着いていれば、ワークツリーのカードのアーカイブ（タイムラインの一番下）に入る', () => {
    const [repo] = buildRepos(list());
    const main = repo!.cards.find((c) => c.isMain)!;
    const x = repo!.cards.find((c) => !c.isMain)!;
    assert.equal(x.stackCount, 1);
    assert.deepEqual(main.sessions.map((s) => s.id), ['q']);
    assert.deepEqual(main.timeline.map((t) => [t.session.id, t.origin]), [['origin', true]], 'main の一覧にも起点を出す');
    assert.equal(main.stackCount, 1);
    assert.deepEqual(x.archived.map((s) => s.id), ['origin']);
    assert.deepEqual(x.timeline.map((t) => [t.session.id, t.origin, t.link]), [['w1', false, 'solid'], ['origin', true, undefined]]);
  });

  it('処理中・対応待ちのうちは main に出す（タイムラインの一番下にも出す）', () => {
    const [repo] = buildRepos(list('busy'));
    assert.deepEqual(repo!.cards.find((c) => c.isMain)!.sessions.map((s) => s.id).sort(), ['origin', 'q']);
    const x = repo!.cards.find((c) => !c.isMain)!;
    assert.deepEqual(x.archived, []);
    assert.equal(x.stackCount, 1, '起点が main に出ていても、重なりは残す');
    assert.deepEqual(x.timeline.map((t) => [t.session.id, t.archived]), [['w1', false], ['origin', false]]);
  });

  it('手で戻したものは main に残す。ワークツリーのカードの重なりは残す', () => {
    const [repo] = buildRepos(list(), opts({ marks: { origin: 'shown' } }));
    assert.ok(repo!.cards.find((c) => c.isMain)!.sessions.some((s) => s.id === 'origin'));
    const x = repo!.cards.find((c) => !c.isMain)!;
    assert.deepEqual([x.archived.length, x.stackCount], [0, 1]);
  });

  it('main のセッションがすべて起点として移っても、main のカードは行なしで出し、一覧から起点をたどれる', () => {
    const [repo] = buildRepos([list()[0]!, list()[2]!].map((s) => ({ ...s })));
    const main = repo!.cards.find((c) => c.isMain)!;
    assert.deepEqual([main.sessions.length, main.stackCount], [0, 1]);
  });
});

describe('buildRepos：main のアーカイブ', () => {
  const now = 100 * MIN;
  const list = () => [
    view({ id: 'recent', state: 'idle', lastActivityAt: now - 5 * MIN }),
    view({ id: 'old', state: 'idle', lastActivityAt: now - 15 * MIN }),
    view({ id: 'stopped', state: 'stopped', lastActivityAt: now - 60 * MIN }),
    view({ id: 'busy', state: 'busy', lastActivityAt: now - 60 * MIN }),
  ];
  const main = (o: Partial<ArchiveOptions>) => buildRepos(list(), opts({ now, mainMinutes: 10, ...o }))[0]!.cards[0]!;

  it('落ち着いてから決めた分がたったものをアーカイブする。動いているものは隠さない', () => {
    const c = main({});
    assert.deepEqual(c.sessions.map((s) => s.id).sort(), ['busy', 'recent']);
    assert.deepEqual(c.archived.map((s) => s.id).sort(), ['old', 'stopped']);
    assert.deepEqual(c.timeline.map((t) => t.archived), [true, true]);
  });

  it('確認した時刻が新しければ、そこから数える', () => {
    const c = main({ confirmedAt: new Map([['old', now - 2 * MIN]]) });
    assert.ok(c.sessions.some((s) => s.id === 'old'));
  });

  it('0 分（しない）なら自動ではアーカイブしない', () => assert.equal(main({ mainMinutes: 0 }).archived.length, 0));

  it('手の印は自動の決まりより先', () => {
    const c = main({ marks: { old: 'shown', recent: 'archived' } });
    assert.deepEqual(c.archived.map((s) => s.id).sort(), ['recent', 'stopped']);
  });

  it('main のカードは、ワークツリーのアーカイブの決まり（最後に動いたもの以外）を使わない', () => {
    assert.equal(main({ mainMinutes: 0 }).sessions.length, 4);
  });
});

describe('buildRepos：カードごとのアーカイブ', () => {
  const merged: GitChanges = { ...clean, behind: 2, merged: true };
  it('マージ済みとワークツリーがないカードは隠し、見出しの件数に入れる', () => {
    const [repo] = buildRepos([
      view({ worktree: wt('a'), changes: merged }),
      view({ worktree: wt('b'), changes: { ...clean, gone: true } }),
      view({ worktree: wt('c'), changes: clean }),
    ]);
    assert.deepEqual(repo!.cards.map((c) => c.label), ['c']);
    assert.deepEqual(repo!.hiddenCards.map((c) => [c.label, c.merged]).sort(), [['a', true], ['b', true]]);
  });

  it('手で戻したカードは出し、手でアーカイブしたカードは隠す', () => {
    const [repo] = buildRepos(
      [view({ repoKey: 'r', worktree: wt('a'), changes: merged }), view({ repoKey: 'r', worktree: wt('c') })],
      opts({ cardMarks: { 'r|a': 'shown', 'r|c': 'archived' } }),
    );
    assert.deepEqual(repo!.cards.map((c) => c.label), ['a']);
  });

  it('中のセッションが動いていれば、マージ済みでも隠さない', () => {
    const [repo] = buildRepos([view({ worktree: wt('a'), changes: merged, state: 'busy' })]);
    assert.equal(repo!.hiddenCards.length, 0);
  });

  it('main のカードは隠さない', () => {
    const [repo] = buildRepos([view({ repoKey: 'r' })], opts({ cardMarks: { 'r|': 'archived' } }));
    assert.equal(repo!.cards.length, 1);
  });
});

describe('動き出したものの印を外す', () => {
  const sessions = [
    view({ id: 'a', repoKey: 'r', worktree: wt('x'), state: 'busy' }),
    view({ id: 'b', repoKey: 'r', state: 'idle' }),
    view({ id: 'c', repoKey: 'r', state: 'idle' }),
  ];
  it('手でアーカイブしたセッションが動き出したら外す（未確認も動いているものとする）', () =>
    assert.deepEqual(revivedSessions(sessions, { marks: { a: 'archived', b: 'archived', c: 'shown' }, attention: new Set(['c']) }), ['a']));
  it('手でアーカイブしたカードの中が動き出したら外す', () =>
    assert.deepEqual(revivedCards(sessions, { cardMarks: { 'r|x': 'archived', 'r|': 'archived' }, attention: new Set() }), ['r|x']));
  it('isLive', () => {
    assert.equal(isLive(view({ state: 'waiting' }), new Set()), true);
    assert.equal(isLive(view({ id: 'z', state: 'stopped' }), new Set(['z'])), true);
    assert.equal(isLive(view({ state: 'idle' }), new Set()), false);
  });
});

describe('cardBadge', () => {
  const badge = (...patches: Partial<SessionView>[]) => cardBadge(patches.map((p) => view(p)));
  it('対応待ちがあれば件数を出す', () =>
    assert.deepEqual(badge({ state: 'waiting' }, { state: 'waiting' }, { state: 'busy' }), { state: 'waiting', text: '要対応 2' }));
  it('なければ処理中', () => assert.deepEqual(badge({ state: 'busy' }, { state: 'idle' }), { state: 'busy', text: '処理中 1' }));
  it('待機と停止中だけなら出さない', () => assert.deepEqual(badge({ state: 'idle' }, { state: 'stopped' }), { state: '', text: '' }));
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

describe('attentionReason', () => {
  it('対応待ちになったら対応待ち（初めて見たときも。起動直後に鳴らさないのは renderer）', () => {
    assert.equal(attentionReason('busy', 'waiting'), 'waiting');
    assert.equal(attentionReason('idle', 'waiting'), 'waiting');
    assert.equal(attentionReason(undefined, 'waiting'), 'waiting');
  });
  it('処理中から待機になったら完了', () => assert.equal(attentionReason('busy', 'idle'), 'done'));
  it('ほかの変化と、状態が同じときは知らせない', () => {
    assert.equal(attentionReason('waiting', 'waiting'), undefined);
    assert.equal(attentionReason('waiting', 'idle'), undefined);
    assert.equal(attentionReason('idle', 'busy'), undefined);
    assert.equal(attentionReason('busy', 'stopped'), undefined);
    assert.equal(attentionReason(undefined, 'idle'), undefined);
  });
});

describe('知らせるものの選び方', () => {
  const all = { waiting: true, done: true, muteWhenOpen: true };
  const a = (id: string, reason: Alert['reason']): Alert => ({ id, reason });

  it('まとめるとき、同じセッションは対応待ちを残す', () => {
    assert.deepEqual(mergeAlerts([a('x', 'waiting')], [a('x', 'done'), a('y', 'done')]), [a('x', 'waiting'), a('y', 'done')]);
    assert.deepEqual(mergeAlerts([a('x', 'done')], [a('x', 'waiting')]), [a('x', 'waiting')]);
  });
  it('最初は少しだけ待ち、続くときは前から数秒あける', () => {
    assert.equal(alertDelay(-Infinity, 1_000), ALERT_COLLECT_MS);
    assert.equal(alertDelay(1_000, 2_000), ALERT_GAP_MS - 1_000);
    assert.equal(alertDelay(1_000, 1_000 + ALERT_GAP_MS + 5), ALERT_COLLECT_MS);
  });
  it('対応待ちを先に並べる', () =>
    assert.deepEqual(pickAlerts([a('x', 'done'), a('y', 'waiting'), a('z', 'done')], all, undefined).map((x) => x.id), ['y', 'x', 'z']));
  it('設定で切った理由は外す', () => {
    assert.deepEqual(pickAlerts([a('x', 'done'), a('y', 'waiting')], { ...all, done: false }, undefined).map((x) => x.id), ['y']);
    assert.deepEqual(pickAlerts([a('x', 'done'), a('y', 'waiting')], { ...all, waiting: false }, undefined).map((x) => x.id), ['x']);
  });
  it('Claude が前面で開いているセッションは外す（設定で切れば外さない）', () => {
    assert.deepEqual(pickAlerts([a('x', 'waiting'), a('y', 'waiting')], all, 'x').map((x) => x.id), ['y']);
    assert.deepEqual(pickAlerts([a('x', 'waiting')], { ...all, muteWhenOpen: false }, 'x').map((x) => x.id), ['x']);
  });
  it('音は、対応待ちが 1 つでもあれば対応待ち。なければ鳴らさない', () => {
    assert.equal(alertSound([a('x', 'done'), a('y', 'waiting')]), 'waiting');
    assert.equal(alertSound([a('x', 'done')]), 'done');
    assert.equal(alertSound([]), undefined);
  });
  it('トーストは先頭のセッションの名前と理由。ほかにもあれば件数を添える', () => {
    const s1 = view({ title: 'fix login', state: 'waiting', waitingFor: 'permission prompt' });
    const s2 = view({ title: 'docs' });
    assert.deepEqual(toastContent([a(s1.id, 'waiting')], [s1, s2]), { id: s1.id, title: 'fix login', body: '対応待ち（許可待ち）' });
    assert.deepEqual(toastContent([a(s2.id, 'done'), a(s1.id, 'done')], [s1, s2]), { id: s2.id, title: 'docs', body: '完了。ほかに 1 件' });
    assert.equal(toastContent([], [s1]), undefined);
    assert.equal(toastContent([a('local_gone', 'done')], [s1]), undefined);
  });
});

describe('音・トースト・点滅の決め方（alertActions）', () => {
  const on = { sound: true, toast: true, flash: true };
  const off = { sound: false, toast: false, flash: false };
  const a = (id: string, reason: Alert['reason']): Alert => ({ id, reason });
  const s1 = view({ title: 'fix login' });

  it('知らせ方が 1 つでもオンなら動く。すべてオフなら動かない', () => {
    assert.equal(hasAlertOutput(off), false);
    assert.equal(hasAlertOutput({ ...off, flash: true }), true);
  });
  it('知らせるものがなければ、何もしない（点滅もしない）', () => assert.equal(alertActions([], on, [s1]), undefined));
  it('すべてオンなら、音・トースト・点滅をそろって出す', () =>
    assert.deepEqual(alertActions([a(s1.id, 'done')], on, [s1]), {
      sound: 'done', toast: { id: s1.id, title: 'fix login', body: '完了' }, flash: true,
    }));
  it('点滅だけオンなら、点滅だけ', () =>
    assert.deepEqual(alertActions([a(s1.id, 'waiting')], { ...off, flash: true }, [s1]), { sound: undefined, toast: undefined, flash: true }));
  it('点滅をオフにすれば、音とトーストだけ', () =>
    assert.equal(alertActions([a(s1.id, 'waiting')], { ...on, flash: false }, [s1])?.flash, false));
  it('すべてオフなら undefined（前に知らせた時刻も進めない）', () => assert.equal(alertActions([a(s1.id, 'waiting')], off, [s1]), undefined));
});

describe('Claude 本体で開いたか（openedInClaude）', () => {
  it('前に見た時刻より新しくなったら開いた', () => assert.equal(openedInClaude(100, 200), true));
  it('同じか、戻ったなら開いていない', () => {
    assert.equal(openedInClaude(200, 200), false);
    assert.equal(openedInClaude(200, 100), false);
  });
  it('開いたことがなかったセッションを初めて開いたら、開いた', () => assert.equal(openedInClaude(0, 50), true));
  it('初めて見たセッションは、開いたとはみなさない', () => assert.equal(openedInClaude(undefined, 500), false));
  it('時刻がないままなら開いていない', () => assert.equal(openedInClaude(0, undefined), false));
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
  // 画面の並び（急ぐ順）：リポジトリ waiting（w1）→ main（m1 処理中、m2 待機）→ wt（ワークツリー t2、元のフォルダ t1）
  // main の s1 は停止中で、ワークツリーの t0 は最後に動いたものではないのでアーカイブされている
  const x = wt('x');
  const sessions: SessionView[] = [
    view({ id: 'm2', repoKey: 'main', state: 'idle', lastActivityAt: 30 }),
    view({ id: 'm1', repoKey: 'main', state: 'busy', lastActivityAt: 20 }),
    view({ id: 't1', repoKey: 'wt', state: 'idle', lastActivityAt: 5 }),
    view({ id: 't2', repoKey: 'wt', state: 'idle', lastActivityAt: 10, worktree: x }),
    view({ id: 't0', repoKey: 'wt', state: 'stopped', lastActivityAt: 8, worktree: x }),
    view({ id: 's1', repoKey: 'main', state: 'stopped', lastActivityAt: 99 }),
    view({ id: 'w1', repoKey: 'waiting', state: 'waiting', lastActivityAt: 1 }),
  ];
  const withMain = opts({ marks: { s1: 'archived' } });

  it('画面の上から順に並べ、アーカイブしたものは入れない', () =>
    assert.deepEqual(displayOrder(sessions, withMain).map((s) => s.id), ['w1', 'm1', 'm2', 't2', 't1']));

  it('並び順の設定に従う', () => {
    const fixed = opts({ marks: { s1: 'archived' }, sort: { project: 'fixed', worktree: 'fixed', session: 'fixed' } });
    // リポジトリは名前順（main → waiting → wt）、元のフォルダが先頭、セッションは新しく作ったものが上
    assert.deepEqual(displayOrder(sessions, fixed).map((s) => s.id), ['m1', 'm2', 'w1', 't1', 't2']);
  });

  it('未確認があれば、表示順でいちばん上のもの', () =>
    assert.equal(nextCycleTarget(sessions, new Set(['t1', 'm1']), 'w1', withMain), 'm1'));
  it('今開いている行は、未確認でも選ばない', () =>
    assert.equal(nextCycleTarget(sessions, new Set(['w1', 't2']), 'w1', withMain), 't2'));
  it('未確認がなければ、今開いている行の次', () => assert.equal(nextCycleTarget(sessions, new Set(), 'm2', withMain), 't2'));
  it('最後の行の次は先頭に戻る', () => assert.equal(nextCycleTarget(sessions, new Set(), 't1', withMain), 'w1'));
  it('今開いている行が一覧にない（アーカイブした）か、わからなければ先頭', () => {
    assert.equal(nextCycleTarget(sessions, new Set(), 't0', withMain), 'w1');
    assert.equal(nextCycleTarget(sessions, new Set(), undefined, withMain), 'w1');
  });
  it('未確認のものはアーカイブから出るので、巡回に入る', () =>
    assert.equal(nextCycleTarget(sessions, new Set(['t0']), 'w1', withMain), 't0'));
  it('ほかに行がなければ何もしない', () => {
    assert.equal(nextCycleTarget([view({ id: 'a' })], new Set(['a']), 'a'), undefined);
    assert.equal(nextCycleTarget([], new Set(), undefined), undefined);
  });

  it('Claude が前面になくても、未確認の行があればそちらを開く', () =>
    assert.equal(shortcutTarget(sessions, new Set(['t1']), 'm1', false, withMain), 't1'));
  it('未確認が今開いている行だけなら、前面になければ今開いている行を前面に出す', () =>
    assert.equal(shortcutTarget(sessions, new Set(['m1']), 'm1', false, withMain), 'm1'));
  it('未確認がなく Claude が前面になければ、今開いている行を前面に出す', () =>
    assert.equal(shortcutTarget(sessions, new Set(), 'm1', false, withMain), 'm1'));
  it('Claude が前面にあれば、いつもどおり次へ進む', () =>
    assert.equal(shortcutTarget(sessions, new Set(['t1']), 'm1', true, withMain), 't1'));
  it('前面になくても、今開いている行が一覧にない（アーカイブした）か、わからなければ次へ進む', () => {
    assert.equal(shortcutTarget(sessions, new Set(), 't0', false, withMain), 'w1');
    assert.equal(shortcutTarget(sessions, new Set(), undefined, false, withMain), 'w1');
  });
});

describe('コミットされていない変更と、元のブランチとの差', () => {
  const some: GitChanges = { ...clean, changed: 3, untracked: 2, ahead: 1, behind: 4 };
  it('印は変更・未追跡・push していないコミット・遅れの順に、0 でないものだけ', () => {
    assert.deepEqual(changeItems(some), [
      { icon: 'file-pen-line', count: 3 },
      { icon: 'file-plus', count: 2 },
      { icon: 'arrow-up', count: 1 },
      { icon: 'arrow-down', count: 4 },
    ]);
    assert.deepEqual(changeItems({ ...clean, ahead: 4 }), [{ icon: 'arrow-up', count: 4 }]);
    assert.deepEqual(changeItems(clean), []);
    assert.deepEqual(changeItems(undefined), []);
  });
  it('内訳はあるものだけ', () => {
    assert.equal(changesTooltip(some), 'コミットされていない変更：変更 3・未追跡 2\npush していないコミット：1\n元のブランチからの遅れ：4');
    assert.equal(changesTooltip({ ...clean, untracked: 1 }), 'コミットされていない変更：未追跡 1');
    assert.equal(changesTooltip(clean), '');
  });
  it('マージ済みなら、内訳の代わりにマージのアイコンだけ', () => {
    assert.deepEqual(changeItems({ ...some, merged: true }), [{ icon: 'git-merge', count: 0 }]);
    assert.equal(changesTooltip({ ...clean, merged: true }), 'マージ済み（元のブランチに入った）');
  });
  it('追跡するブランチがないワークツリーは、元のブランチにまだ入っていないコミットとして説明する', () =>
    assert.equal(changesTooltip({ ...clean, ahead: 2, aheadOfBase: true }), '元のブランチにまだ入っていないコミット：2'));
  it('セッションのツールチップの最後に添える', () => {
    assert.equal(tooltip(view({ title: 't', changes: { ...clean, changed: 1 } })), 't\nコミットされていない変更：変更 1');
  });
});

describe('newlyFlagged', () => {
  it('前の描画で帯がなかったものだけを返す', () => {
    assert.deepEqual(newlyFlagged(new Set(['a']), new Set(['a', 'b']), true), ['b']);
  });
  it('帯が残っているだけ、消えただけのものは返さない', () => {
    assert.deepEqual(newlyFlagged(new Set(['a', 'b']), new Set(['a']), true), []);
  });
  it('最初の描画では返さない', () => {
    assert.deepEqual(newlyFlagged(new Set(), new Set(['a', 'b']), false), []);
  });
});
