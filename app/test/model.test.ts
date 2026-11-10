// 画面に出す形への組み立て（src/renderer/model.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_ARCHIVE, buildRepos, cardBadge, displayState, changeItems, changesTooltip, displayOrder, fetchStatusLines, formatAgo, isLive, revivedCards, revivedSessions,
  nextAttention, nextCycleTarget, PENDING_FOCUS_MS, resolveFocus, shortcutTarget, stateLabel, statusIconName, tooltip, waitingLabel, type ArchiveOptions,
  ALERT_COLLECT_MS, ALERT_GAP_MS, alertDelay, alertSound, attentionReason, attentionStateOf, mergeAlerts, pickAlerts, toastContent, type Alert,
  alertActions, hasAlertOutput, newlyFlagged, openedInClaude, canToggleArchive,
  HELD_RANK, compareSessions, heldFor, holdTooltip, isHeld, rankOf, releasedHolds, startupConfirmedAt,
} from '../src/renderer/model';
import type { GitChanges, SessionView } from '../src/shared/types';
import { cardKeyOf } from '../src/shared/card-key';
import { view } from './helpers';

const MIN = 60_000;
const wt = (key: string) => ({ key, label: key, branch: `claude/${key}-123abc` });
const opts = (patch: Partial<ArchiveOptions> = {}): ArchiveOptions => ({ ...NO_ARCHIVE, ...patch });
const clean: GitChanges = { changed: 0, untracked: 0, ahead: 0, behind: 0, merged: false };

describe('canToggleArchive：ホイールクリックで切り替えてよいか', () => {
  it('処理中・対応待ちでまだアーカイブしていないときは切り替えない', () => {
    assert.equal(canToggleArchive('busy', false), false);
    assert.equal(canToggleArchive('waiting', false), false);
  });
  it('それ以外と、アーカイブ済みのものは切り替えられる', () => {
    assert.equal(canToggleArchive('idle', false), true);
    assert.equal(canToggleArchive('busy', true), true);
  });
});

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
      ['docs', [['メインの作業フォルダ', true]]],
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

  it('見出しのツールチップに、分岐元を添える', () => {
    const [repo] = buildRepos([view({ worktree: wt('x'), baseBranch: 'develop', workDir: 'C:/Repo/wt' })]);
    assert.equal(repo!.cards[0]!.tooltip, 'ワークツリー：claude/x-123abc\n分岐元：develop\nC:/Repo/wt');
  });

  it('ワークツリーのカードには分岐元を持たせ、元のフォルダのブランチと違うときだけ offMain にする', () => {
    const [repo] = buildRepos([
      view({ mainBranch: 'main' }),
      view({ mainBranch: 'main', worktree: wt('a'), baseBranch: 'main' }),
      view({ mainBranch: 'main', worktree: wt('b'), baseBranch: 'integration/new_feature' }),
      view({ mainBranch: 'main', worktree: wt('c') }),
    ]);
    const by = (label: string) => repo!.cards.find((c) => c.label === label)!;
    assert.equal(by('main').base, undefined, '元のフォルダのカードには持たせない');
    assert.equal(by('a').base?.branch, 'main', 'main から切ったいつものワークツリーも、一覧には分岐元を出す');
    assert.equal(by('a').base?.offMain, false);
    assert.equal(by('c').base, undefined, '分岐元がわからなければ持たせない');
    assert.equal(by('b').base?.branch, 'integration/new_feature');
    assert.equal(by('b').base?.offMain, true);
    assert.match(by('b').base!.tip, /^分岐元：integration\/new_feature\n.*main/);
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
    assert.deepEqual(repo!.cards.map((c) => c.label), ['メインの作業フォルダ', 'alpha', 'zeta']);
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

  it('main のカードの起点の行には行き先のワークツリー、ワークツリーのカードの起点の行には元のフォルダを出す', () => {
    const sessions = list().map((s) => ({ ...s, mainBranch: 'main' }));
    // 同じ起点から 2 つ目のワークツリーを作っても、行き先は一番古い 1 つだけ
    sessions.push({ ...view({ id: 'w2', worktree: wt('y'), spawnedFrom: 'origin', createdAt: 4, lastActivityAt: 40 }), mainBranch: 'main' });
    const [repo] = buildRepos(sessions);
    const main = repo!.cards.find((c) => c.isMain)!;
    assert.deepEqual(main.timeline.map((t) => [t.session.id, t.place]), [
      ['origin', { icon: 'corner-down-right', label: 'x', tip: 'ワークツリー（claude/x-123abc）で続けている' }],
    ]);
    const x = repo!.cards.find((c) => c.key === cardKeyOf(sessions[2]!))!;
    assert.deepEqual(x.timeline.map((t) => [t.session.id, t.place]), [
      ['w1', undefined],
      ['origin', { icon: 'house', label: 'メインの作業フォルダ', tip: 'メインの作業フォルダで始めたセッション' }],
    ]);
    const y = repo!.cards.find((c) => c.key === cardKeyOf(sessions[3]!))!;
    assert.ok(y.timeline.every((t) => !t.origin), '行き先ではないカードには起点を出さない');
  });

  it('元のフォルダのブランチがわからなければ「元のフォルダ」と出す', () => {
    const [repo] = buildRepos(list('busy'));
    const x = repo!.cards.find((c) => !c.isMain)!;
    assert.deepEqual(x.timeline.find((t) => t.origin)!.place?.label, 'メインの作業フォルダ');
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

describe('戻ったセッションの猶予', () => {
  const now = 100 * MIN;
  const revived = new Set(['r']);
  it('ワークツリーで一番新しくなくても、落ち着いてから決めた分はアーカイブしない', () => {
    const sessions = [
      view({ id: 'r', worktree: wt('x'), state: 'idle', lastActivityAt: now - 5 * MIN }),
      view({ id: 'n', worktree: wt('x'), state: 'idle', lastActivityAt: now - 1 * MIN }),
    ];
    const card = (o: Partial<ArchiveOptions>) => buildRepos(sessions, opts({ now, mainMinutes: 10, ...o }))[0]!.cards[0]!;
    assert.deepEqual(card({ revived }).sessions.map((s) => s.id).sort(), ['n', 'r']);
    assert.deepEqual(card({}).archived.map((s) => s.id), ['r'], '戻っていなければ今までどおり');
    assert.deepEqual(card({ revived, now: now + 6 * MIN }).archived.map((s) => s.id), ['r'], '猶予がすぎたらアーカイブする');
    assert.deepEqual(card({ revived, confirmedAt: new Map([['r', now + 3 * MIN]]), now: now + 6 * MIN }).sessions.length, 2, '確認した時刻から数える');
  });
  it('main の自動アーカイブがオフでも、10 分の猶予を使う', () => {
    const sessions = [
      view({ id: 'r', worktree: wt('x'), state: 'idle', lastActivityAt: now - 9 * MIN }),
      view({ id: 'n', worktree: wt('x'), state: 'idle', lastActivityAt: now }),
    ];
    assert.equal(buildRepos(sessions, opts({ now, mainMinutes: 0, revived }))[0]!.cards[0]!.sessions.length, 2);
  });
  it('起点は、猶予の間は main に残す', () => {
    const sessions = [
      view({ id: 'r', state: 'idle', lastActivityAt: now - 1 * MIN }),
      view({ id: 'w', worktree: wt('x'), spawnedFrom: 'r', lastActivityAt: now }),
    ];
    const [repo] = buildRepos(sessions, opts({ now, mainMinutes: 10, revived }));
    assert.deepEqual(repo!.cards.find((c) => c.isMain)!.sessions.map((s) => s.id), ['r']);
  });
  it('マージ済みのカードも、猶予の間は隠さない', () => {
    const sessions = [view({ id: 'r', worktree: wt('x'), state: 'idle', lastActivityAt: now, changes: { ...clean, merged: true } })];
    assert.equal(buildRepos(sessions, opts({ now, revived }))[0]!.hiddenCards.length, 0);
    assert.equal(buildRepos(sessions, opts({ now }))[0]!.hiddenCards.length, 1);
  });
});

describe('確認した直後の猶予', () => {
  const now = 100 * MIN;
  const sessions = [
    view({ id: 'o', worktree: wt('x'), state: 'idle', lastActivityAt: now - 30 * MIN }),
    view({ id: 'n', worktree: wt('x'), state: 'idle', lastActivityAt: now - 20 * MIN }),
  ];
  const confirmedAt = new Map([['o', now]]);
  const card = (o: Partial<ArchiveOptions>) => buildRepos(sessions, opts({ now, mainMinutes: 10, confirmedAt, ...o }))[0]!.cards[0]!;
  it('ワークツリーで一番新しくなくても、確認した直後は出しておく', () => {
    assert.deepEqual(card({}).sessions.map((s) => s.id).sort(), ['n', 'o']);
    assert.deepEqual(card({ confirmedAt: new Map() }).archived.map((s) => s.id), ['o'], '確認していなければ今までどおり');
  });
  it('猶予がすぎたらアーカイブする', () => {
    assert.deepEqual(card({ now: now + 10 * MIN }).archived.map((s) => s.id), ['o']);
    assert.deepEqual(card({ mainMinutes: 0, now: now + 9 * MIN }).sessions.length, 2, 'main の自動アーカイブがオフなら 10 分');
  });
  it('手でアーカイブしたものは、確認した直後でもアーカイブのまま', () => {
    assert.deepEqual(card({ marks: { o: 'archived' } }).archived.map((s) => s.id), ['o']);
    assert.deepEqual(card({ marks: { n: 'archived' }, confirmedAt: new Map([['n', now]]) }).sessions.length, 0, '一番新しいものでも');
  });
  it('起点は、確認した直後は main に残す。手でアーカイブしたら移す', () => {
    const list = [
      view({ id: 'r', state: 'idle', lastActivityAt: now - 30 * MIN }),
      view({ id: 'w', worktree: wt('x'), spawnedFrom: 'r', lastActivityAt: now }),
    ];
    const mainCard = (o: Partial<ArchiveOptions>) =>
      buildRepos(list, opts({ now, mainMinutes: 10, confirmedAt: new Map([['r', now]]), ...o }))[0]!.cards.find((c) => c.isMain);
    assert.deepEqual(mainCard({})!.sessions.map((s) => s.id), ['r']);
    assert.deepEqual(mainCard({ now: now + 10 * MIN })!.sessions, [], '猶予がすぎたら移す');
    assert.deepEqual(mainCard({ marks: { r: 'archived' } })!.sessions, []);
  });
  it('マージ済みのカードは、確認した直後は隠さない。手でアーカイブしたら隠す', () => {
    const list = [view({ id: 'm', worktree: wt('x'), state: 'idle', lastActivityAt: now - 30 * MIN, changes: { ...clean, merged: true } })];
    const hidden = (o: Partial<ArchiveOptions>) =>
      buildRepos(list, opts({ now, mainMinutes: 10, confirmedAt: new Map([['m', now]]), ...o }))[0]!.hiddenCards.length;
    assert.equal(hidden({}), 0);
    assert.equal(hidden({ now: now + 10 * MIN }), 1);
    assert.equal(hidden({ cardMarks: { [cardKeyOf(list[0]!)]: 'archived' } }), 1);
  });
});

describe('startupConfirmedAt：起動した直後の猶予', () => {
  const now = 100 * MIN;
  // 再起動した直後の一覧。確認した時刻はまだない
  const list = (originAt: number) => [
    view({ id: 'r', state: 'idle', lastActivityAt: originAt }),
    view({ id: 'w', worktree: wt('x'), spawnedFrom: 'r', state: 'idle', lastActivityAt: now - 40 * MIN }),
  ];
  const boot = (sessions: SessionView[], o: Partial<ArchiveOptions> = {}) =>
    buildRepos(sessions, opts({ now, mainMinutes: 60, confirmedAt: startupConfirmedAt(sessions), ...o }))[0]!;

  it('動いていないセッションは、最後に動いた時刻を確認した時刻とする。処理中・対応待ちは入れない', () => {
    const seed = startupConfirmedAt([
      view({ id: 'i', state: 'idle', lastActivityAt: 5 }),
      view({ id: 's', state: 'stopped', lastActivityAt: 6 }),
      view({ id: 'b', state: 'busy', lastActivityAt: 7 }),
      view({ id: 'q', state: 'waiting', lastActivityAt: 8 }),
    ]);
    assert.deepEqual([...seed].sort(), [['i', 5], ['s', 6]]);
  });
  it('最後に動いてから猶予の内の起点は、main に残す', () => {
    const repo = boot(list(now - 30 * MIN));
    assert.deepEqual(repo.cards.find((c) => c.isMain)!.sessions.map((s) => s.id), ['r']);
    const without = buildRepos(list(now - 30 * MIN), opts({ now, mainMinutes: 60 }))[0]!;
    assert.deepEqual(without.cards.find((c) => c.isMain)!.sessions, [], '種がなければすぐに移る（直す前の動き）');
  });
  it('最後に動いてから猶予を過ぎた起点は、ワークツリーのカードへ移す', () => {
    const repo = boot(list(now - 61 * MIN));
    assert.deepEqual(repo.cards.find((c) => c.isMain)!.sessions, []);
    assert.deepEqual(repo.cards.find((c) => !c.isMain)!.timeline.find((t) => t.origin)?.session.id, 'r');
  });
  it('ワークツリーの最新以外は、最後に動いてから猶予の内なら出し、過ぎたらアーカイブする', () => {
    const sessions = [
      view({ id: 'o', worktree: wt('x'), state: 'idle', lastActivityAt: now - 30 * MIN }),
      view({ id: 'old', worktree: wt('x'), state: 'idle', lastActivityAt: now - 90 * MIN }),
      view({ id: 'n', worktree: wt('x'), state: 'idle', lastActivityAt: now - 10 * MIN }),
    ];
    const card = boot(sessions).cards[0]!;
    assert.deepEqual(card.sessions.map((s) => s.id).sort(), ['n', 'o']);
    assert.deepEqual(card.archived.map((s) => s.id), ['old']);
  });
  it('main の自動アーカイブの結果は変えない（落ち着いた時刻は最後に動いた時刻のまま）', () => {
    const sessions = [
      view({ id: 'a', state: 'idle', lastActivityAt: now - 30 * MIN }),
      view({ id: 'b', state: 'idle', lastActivityAt: now - 90 * MIN }),
      view({ id: 'c', state: 'busy', lastActivityAt: now - 120 * MIN }),
    ];
    const ids = (r: ReturnType<typeof boot>) => {
      const main = r.cards.find((c) => c.isMain)!;
      return [main.sessions.map((s) => s.id).sort(), main.archived.map((s) => s.id)];
    };
    assert.deepEqual(ids(boot(sessions)), ids(buildRepos(sessions, opts({ now, mainMinutes: 60 }))[0]!));
    assert.deepEqual(ids(boot(sessions)), [['a', 'c'], ['b']]);
  });
});

describe('cardBadge', () => {
  const badge = (...patches: Partial<SessionView>[]) => cardBadge(patches.map((p) => view(p)));
  it('対応待ちがあれば件数を出す', () =>
    assert.deepEqual(badge({ state: 'waiting' }, { state: 'waiting' }, { state: 'busy' }), { state: 'waiting', text: '対応待ち 2' }));
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
  it('待機と停止中の行き来では今のまま（完了の帯はプロセスが止まっても残す）', () => {
    assert.equal(nextAttention('idle', 'stopped', true), true);
    assert.equal(nextAttention('stopped', 'idle', true), true);
    assert.equal(nextAttention('stopped', 'idle', false), false);
  });
  it('処理中のまま止まった（中断）ときは付けない', () => {
    assert.equal(nextAttention('busy', 'stopped', false), false);
    assert.equal(nextAttention('background', 'stopped', false), false);
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

describe('バックグラウンドで作業中の待機（未確認と知らせ）', () => {
  it('attentionStateOf：待機中で作業があれば background', () => {
    assert.equal(attentionStateOf({ state: 'idle', background: 2 }), 'background');
    assert.equal(attentionStateOf({ state: 'idle' }), 'idle');
    assert.equal(attentionStateOf({ state: 'busy', background: 2 }), 'busy');
  });
  it('処理中からバックグラウンドで作業中になっても、帯を付けず知らせない', () => {
    assert.equal(nextAttention('busy', 'background', false), false);
    assert.equal(attentionReason('busy', 'background'), undefined);
  });
  it('バックグラウンドで作業中になったら、残っていた帯を消す', () => {
    assert.equal(nextAttention('idle', 'background', true), false);
    assert.equal(nextAttention('waiting', 'background', true), false);
  });
  it('作業が終わって待機になったら付けて、完了と知らせる', () => {
    assert.equal(nextAttention('background', 'idle', false), true);
    assert.equal(attentionReason('background', 'idle'), 'done');
  });
  it('作業中から対応待ちになったら対応待ち', () => assert.equal(attentionReason('background', 'waiting'), 'waiting'));
  it('起動した時点で作業中なら付けない', () => {
    assert.equal(nextAttention(undefined, 'background', false), false);
    assert.equal(attentionReason(undefined, 'background'), undefined);
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

describe('displayState', () => {
  it('停止中は待機中と同じに見せる', () => assert.equal(displayState({ state: 'stopped' }), 'idle'));
  it('中断だけは stopped のまま', () => assert.equal(displayState({ state: 'stopped', interrupted: true }), 'stopped'));
  it('ほかの状態は変えない', () => {
    assert.deepEqual((['waiting', 'busy', 'idle'] as const).map((state) => displayState({ state })), ['waiting', 'busy', 'idle']);
  });
});

describe('stateLabel', () => {
  it('処理中、待機中、中断（stopped は displayState が中断のときだけ返す）', () => {
    assert.equal(stateLabel('busy'), '処理中');
    assert.equal(stateLabel('idle'), '待機中');
    assert.equal(stateLabel('stopped'), '中断');
  });
  it('対応待ちは理由を言葉にする', () => {
    assert.equal(stateLabel('waiting', 'permission prompt'), '許可待ち');
    assert.equal(stateLabel('waiting', 'input needed'), '回答待ち');
  });
  it('知らない理由やないときは「その他」（対応待ち（その他））', () => {
    assert.equal(stateLabel('waiting', 'some new reason'), 'その他');
    assert.equal(stateLabel('waiting', undefined), 'その他');
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
    assert.equal(text, 't\nワークツリー：claude/l-abcdef\n対応待ち：回答待ち\n次にすること：review\ndone');
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
  // a を開いていた（focusedAt 500）。1000 に b をクリックした
  const sessions = [view({ id: 'a', focused: true, focusedAt: 500 }), view({ id: 'b' })];
  const pending = { id: 'b', at: 1000, until: 1000 + PENDING_FOCUS_MS };

  it('クリックがなければファイルの値', () => assert.deepEqual(resolveFocus(sessions, undefined, 1000), { id: 'a', pending: undefined }));
  it('ファイルが追いつくまでは、クリックしたセッション', () =>
    assert.deepEqual(resolveFocus(sessions, pending, 1500), { id: 'b', pending }));
  it('5 秒を過ぎてもファイルが古いままなら、クリックしたセッションを保つ（前の行に戻さない）', () =>
    assert.deepEqual(resolveFocus(sessions, pending, 1000 + 6_000), { id: 'b', pending }));
  it('ファイルが追いついたら、待つのをやめる', () => {
    const caught = [view({ id: 'a', focusedAt: 500 }), view({ id: 'b', focused: true, focusedAt: 4500 })];
    assert.deepEqual(resolveFocus(caught, pending, 4500), { id: 'b', pending: undefined });
  });
  it('クリックのあとで別のセッションの focusedAt が進んだら、そちらに従う', () => {
    const other = [view({ id: 'a', focusedAt: 500 }), view({ id: 'b' }), view({ id: 'c', focused: true, focusedAt: 2000 })];
    assert.deepEqual(resolveFocus(other, pending, 2500), { id: 'c', pending: undefined });
  });
  it('クリックより前の focusedAt は、本体で開いたものとみなさない', () => {
    const older = [view({ id: 'a', focused: true, focusedAt: 1000 }), view({ id: 'b' })];
    assert.deepEqual(resolveFocus(older, pending, 1500), { id: 'b', pending });
  });
  it('安全のための期限が過ぎたら、ファイルの値に戻す', () =>
    assert.deepEqual(resolveFocus(sessions, pending, pending.until), { id: 'a', pending: undefined }));
  it('クリックしたセッションがなくなったら、ファイルの値', () =>
    assert.deepEqual(resolveFocus([view({ id: 'a', focused: true, focusedAt: 500 })], pending, 1500), { id: 'a', pending: undefined }));
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
  it('未確認がなければ、処理中の行は飛ばす', () => assert.equal(nextCycleTarget(sessions, new Set(), 'w1', withMain), 'm2'));
  it('今開いている行が処理中でも、その次へ進む', () => assert.equal(nextCycleTarget(sessions, new Set(), 'm1', withMain), 'm2'));
  it('ほかが全部処理中なら何もしない', () => {
    const busy = [view({ id: 'a', state: 'idle' }), view({ id: 'b', state: 'busy' }), view({ id: 'c', state: 'busy' })];
    assert.equal(nextCycleTarget(busy, new Set(), 'a'), undefined);
    assert.equal(nextCycleTarget(busy, new Set(), 'b'), 'a');
    assert.equal(nextCycleTarget(busy.slice(1), new Set(), undefined), undefined);
  });

  it('Claude が前面になくても、未確認の行があればそちらを開く', () =>
    assert.deepEqual(shortcutTarget(sessions, new Set(['t1']), 'm1', false, withMain), { id: 't1', raise: false }));
  it('未確認が今開いている行だけなら、前面になければ今開いている行を前面に出す', () =>
    assert.deepEqual(shortcutTarget(sessions, new Set(['m1']), 'm1', false, withMain), { id: 'm1', raise: true }));
  it('未確認がなく Claude が前面になければ、今開いている行を前面に出す', () =>
    assert.deepEqual(shortcutTarget(sessions, new Set(), 'm1', false, withMain), { id: 'm1', raise: true }));
  it('Claude が前面にあれば、いつもどおり次へ進む', () =>
    assert.deepEqual(shortcutTarget(sessions, new Set(['t1']), 'm1', true, withMain), { id: 't1', raise: false }));
  it('前面になくても、今開いている行が一覧にない（アーカイブした）か、わからなければ次へ進む', () => {
    assert.deepEqual(shortcutTarget(sessions, new Set(), 't0', false, withMain), { id: 'w1', raise: false });
    assert.deepEqual(shortcutTarget(sessions, new Set(), undefined, false, withMain), { id: 'w1', raise: false });
  });
  it('ほかに行がなければ何もしない', () =>
    assert.equal(shortcutTarget([view({ id: 'a' })], new Set(), 'a', true), undefined));
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
    assert.equal(changesTooltip(some), '未コミットの変更：変更 3・未追跡 2\npush していないコミット：1\n元のブランチからの遅れ：4');
    assert.equal(changesTooltip({ ...clean, untracked: 1 }), '未コミットの変更：未追跡 1');
    assert.equal(changesTooltip(clean), '');
  });
  it('マージ済みなら、内訳の代わりにマージのアイコンだけ', () => {
    assert.deepEqual(changeItems({ ...some, merged: true }), [{ icon: 'git-merge', count: 0 }]);
    assert.equal(changesTooltip({ ...clean, merged: true }), 'マージ済み');
    // 分岐元ではなく main に入っていたときは、先の名前と、分岐元には入っていないことを出す
    assert.equal(changesTooltip({ ...clean, ahead: 1, merged: true, mergedInto: 'main' }, 'develop'), 'main にマージ済み（develop には未マージ）');
    assert.equal(changesTooltip({ ...clean, merged: true, mergedInto: 'main' }), 'main にマージ済み');
  });
  it('元のフォルダの遅れは、追跡するブランチの名前を出す', () => {
    assert.equal(changesTooltip({ ...clean, ahead: 1, behind: 3, upstream: 'origin/main' }), 'push していないコミット：1\norigin/main からの遅れ：3');
    assert.deepEqual(changeItems({ ...clean, behind: 3, upstream: 'origin/main' }), [{ icon: 'arrow-down', count: 3 }]);
  });
  it('取得の様子：オフ、まだ、最後の取得と失敗。オフラインの種類も文がある', () => {
    const now = 10 * 60_000;
    assert.deepEqual(fetchStatusLines({ enabled: false, running: false, failures: [] }, now), ['定期的な取得はオフです']);
    assert.deepEqual(fetchStatusLines({ enabled: true, running: false, failures: [] }, now), ['まだ取得していません']);
    assert.deepEqual(fetchStatusLines({ enabled: true, running: true, lastAt: 0, failures: [] }, now), ['取得しています…']);
    assert.deepEqual(
      fetchStatusLines({ enabled: true, running: false, lastAt: now - 3 * 60_000, failures: [{ name: 'repo', failure: 'auth' }] }, now),
      [`最後の取得：${formatAgo(now - 3 * 60_000, now)}`, 'repo：認証に失敗（止めています。もう一度押すと試します）'],
    );
  });
  it('追跡するブランチがないワークツリーは、未マージのコミットとして説明する', () =>
    assert.equal(changesTooltip({ ...clean, ahead: 2, aheadOfBase: true }), '未マージのコミット：2'));
  it('分岐元がわかれば、遅れと未マージに比べている先の名前を出す', () => {
    assert.equal(
      changesTooltip({ ...clean, ahead: 3, aheadOfBase: true, behind: 1 }, 'integration/new_feature'),
      'integration/new_feature に未マージのコミット：3\nintegration/new_feature からの遅れ：1',
    );
    // push していないコミットは分岐元と関係ない。追跡するブランチがあれば、遅れはそちらの名前
    assert.equal(changesTooltip({ ...clean, ahead: 1, behind: 2, upstream: 'origin/main' }, 'develop'), 'push していないコミット：1\norigin/main からの遅れ：2');
  });
  it('セッションのツールチップの最後に添える', () => {
    assert.equal(tooltip(view({ title: 't', changes: { ...clean, changed: 1 } })), 't\n未コミットの変更：変更 1');
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

// ---- 保留（docs/design/hold.md） ----

describe('保留：アーカイブにかからない', () => {
  const held = (note = '') => ({ note, since: 0 });

  it('ワークツリーで一番新しくなくても、保留の行は出す', () => {
    const sessions = [
      view({ id: 'old', worktree: wt('x'), state: 'stopped', lastActivityAt: 10 }),
      view({ id: 'new', worktree: wt('x'), state: 'idle', lastActivityAt: 30 }),
    ];
    const c = buildRepos(sessions, opts({ holds: { old: held() } }))[0]!.cards[0]!;
    assert.deepEqual(c.sessions.map((s) => s.id).sort(), ['new', 'old']);
    assert.deepEqual(c.archived, []);
  });

  it('main の時間がたっても、保留の行は出す', () => {
    const sessions = [view({ id: 'm', state: 'idle', lastActivityAt: 0 })];
    const o = opts({ mainMinutes: 10, now: 60 * MIN, holds: { m: held() } });
    assert.deepEqual(buildRepos(sessions, o)[0]!.cards[0]!.sessions.map((s) => s.id), ['m']);
  });

  it('手でアーカイブした印が残っていても、保留が先', () => {
    const sessions = [view({ id: 'm', state: 'idle' })];
    const c = buildRepos(sessions, opts({ marks: { m: 'archived' }, holds: { m: held() } }))[0]!.cards[0]!;
    assert.deepEqual(c.sessions.map((s) => s.id), ['m']);
  });

  it('保留の起点は、ワークツリーのカードへ移さず main に出す', () => {
    const origin = view({ id: 'o', repoKey: 'r', state: 'stopped', lastActivityAt: 1 });
    const child = view({ id: 'c', repoKey: 'r', worktree: wt('x'), spawnedFrom: 'o', state: 'idle', lastActivityAt: 2 });
    const repo = buildRepos([origin, child], opts({ holds: { o: held() } }))[0]!;
    assert.deepEqual(repo.cards.find((c) => c.isMain)!.sessions.map((s) => s.id), ['o']);
  });

  it('保留のカードは、マージ済みでも隠さない（マージ済みの印は残す）', () => {
    const merged = { ...clean, merged: true };
    const sessions = [view({ repoKey: 'r', worktree: wt('x'), changes: merged })];
    assert.equal(buildRepos(sessions, opts())[0]!.cards.length, 0);
    const repo = buildRepos(sessions, opts({ heldCards: { 'r|x': held('レビュー待ち') } }))[0]!;
    assert.equal(repo.cards.length, 1);
    assert.equal(repo.cards[0]!.merged, true);
    assert.deepEqual(repo.cards[0]!.held, held('レビュー待ち'));
  });

  it('手でアーカイブしたカードの印が残っていても、保留が先', () => {
    const sessions = [view({ repoKey: 'r', worktree: wt('x') })];
    const repo = buildRepos(sessions, opts({ cardMarks: { 'r|x': 'archived' }, heldCards: { 'r|x': held() } }))[0]!;
    assert.equal(repo.cards.length, 1);
  });

  it('元のフォルダのカードには、保留を付けない', () => {
    const sessions = [view({ repoKey: 'r' })];
    assert.equal(buildRepos(sessions, opts({ heldCards: { 'r|': held() } }))[0]!.cards[0]!.held, undefined);
  });
});

describe('保留：動き出したら外す', () => {
  const sessions = [
    view({ id: 'a', repoKey: 'r', state: 'busy' }),
    view({ id: 'b', repoKey: 'r', state: 'waiting' }),
    view({ id: 'c', repoKey: 'r', state: 'idle' }),
    view({ id: 'd', repoKey: 'r', worktree: wt('x'), state: 'stopped' }),
    view({ id: 'e', repoKey: 'r', worktree: wt('y'), state: 'idle' }),
    view({ id: 'f', repoKey: 'r', worktree: wt('y'), state: 'busy' }),
  ];
  const mark = { note: 'メモ', since: 0 };
  const holds = { a: mark, b: mark, c: mark };
  const heldCards = { 'r|x': mark, 'r|y': mark };

  it('処理中・対応待ちになった保留の行を返す。待機・停止中のものは残す', () =>
    assert.deepEqual(releasedHolds(sessions, { holds, heldCards: {} }).sessions, ['a', 'b']));
  it('カードは、中のどれかが動き出したら返す', () =>
    assert.deepEqual(releasedHolds(sessions, { holds: {}, heldCards }).cards, ['r|y']));
  it('印のないものは返さない', () => assert.deepEqual(releasedHolds(sessions, { holds: {}, heldCards: {} }), { sessions: [], cards: [] }));
  it('処理中・対応待ちのものは、外す前でも保留として扱わない', () => {
    assert.equal(isHeld(sessions[0]!, { holds, heldCards }), false);
    assert.equal(isHeld(sessions[2]!, { holds, heldCards }), true);
    assert.equal(isHeld(sessions[3]!, { holds: {}, heldCards }), true, 'カードの保留の中の行');
  });
});

describe('保留：並び順と巡回', () => {
  it('優先度では、待機（停止中を含む）の後ろ', () => {
    const h = { holds: { held: { note: '', since: 0 } }, heldCards: {} };
    const sessions = [
      view({ id: 'stopped', state: 'stopped', lastActivityAt: 5 }),
      view({ id: 'held', state: 'idle', lastActivityAt: 40 }),
      view({ id: 'idle', state: 'idle', lastActivityAt: 10 }),
      view({ id: 'busy', state: 'busy', lastActivityAt: 20 }),
    ];
    assert.deepEqual([...sessions].sort(compareSessions('priority', h)).map((s) => s.id), ['busy', 'idle', 'stopped', 'held']);
    assert.equal(rankOf(sessions[1]!, h), HELD_RANK);
    assert.ok(HELD_RANK > rankOf(sessions[2]!, h) && HELD_RANK > rankOf(sessions[0]!, h));
  });

  it('固定・更新日時では今のまま', () => {
    const h = { holds: { a: { note: '', since: 0 } }, heldCards: {} };
    const sessions = [view({ id: 'b', lastActivityAt: 5 }), view({ id: 'a', lastActivityAt: 10 })];
    assert.deepEqual([...sessions].sort(compareSessions('recent', h)).map((s) => s.id), ['a', 'b']);
  });

  it('カードの並びの優先度にも使う', () => {
    const sessions = [
      view({ id: 'p', repoKey: 'r', worktree: wt('p'), state: 'idle', lastActivityAt: 99 }),
      view({ id: 'q', repoKey: 'r', worktree: wt('q'), state: 'stopped', lastActivityAt: 2 }),
      view({ id: 'i', repoKey: 'r', worktree: wt('i'), state: 'idle', lastActivityAt: 1 }),
    ];
    const repo = buildRepos(sessions, opts({ heldCards: { 'r|p': { note: '', since: 0 } } }))[0]!;
    // 停止中は待機と同じ順位で、新しい順に並ぶ
    assert.deepEqual(repo.cards.map((c) => c.label), ['q', 'i', 'p']);
  });

  describe('巡回（Ctrl+Alt+N）からは外す', () => {
    const sessions = [
      view({ id: 'a', repoKey: 'r', state: 'idle', lastActivityAt: 30 }),
      view({ id: 'h', repoKey: 'r', state: 'idle', lastActivityAt: 20 }),
      view({ id: 'b', repoKey: 'r', state: 'idle', lastActivityAt: 10 }),
      view({ id: 'c', repoKey: 's', worktree: wt('x'), state: 'idle', lastActivityAt: 5 }),
    ];
    const o = opts({
      sort: { project: 'fixed', worktree: 'fixed', session: 'recent' },
      holds: { h: { note: '', since: 0 } },
      heldCards: { 's|x': { note: '', since: 0 } },
    });
    it('保留の行と、保留のカードの行は飛ばす', () => {
      assert.equal(nextCycleTarget(sessions, new Set(), 'a', o), 'b');
      assert.equal(nextCycleTarget(sessions, new Set(), 'b', o), 'a');
    });
    it('今開いている行が保留なら、その次から', () => assert.equal(nextCycleTarget(sessions, new Set(), 'h', o), 'b'));
    it('未確認の帯があれば、保留の行でも入れる', () => assert.equal(nextCycleTarget(sessions, new Set(['h']), 'a', o), 'h'));
  });
});

describe('保留：バッジとツールチップ', () => {
  it('対応待ち・処理中がないときだけ、保留の件数を出す', () => {
    assert.deepEqual(cardBadge([view({ state: 'idle' })], 2), { state: 'held', text: '保留 2' });
    assert.deepEqual(cardBadge([view({ state: 'busy' })], 2), { state: 'busy', text: '処理中 1' });
    assert.deepEqual(cardBadge([view({ state: 'idle' })], 0), { state: '', text: '' });
  });

  it('リポジトリの件数は、保留のカードと、保留のカードの外の保留の行', () => {
    const sessions = [
      view({ id: 'm', repoKey: 'r', state: 'idle' }),
      view({ id: 'x1', repoKey: 'r', worktree: wt('x'), state: 'idle' }),
      view({ id: 'y1', repoKey: 'r', worktree: wt('y'), state: 'stopped' }),
    ];
    const mark = { note: '', since: 0 };
    const repo = buildRepos(sessions, opts({ holds: { m: mark, x1: mark }, heldCards: { 'r|x': mark } }))[0]!;
    assert.deepEqual(repo.badge, { state: 'held', text: '保留 2' });
  });

  it('保留してからの長さ', () => {
    assert.equal(heldFor(0, 30_000), '保留したばかり');
    assert.equal(heldFor(0, 5 * MIN), '保留 5 分');
    assert.equal(heldFor(0, 3 * 60 * MIN), '保留 3 時間');
    assert.equal(heldFor(0, 2 * 24 * 60 * MIN), '保留 2 日');
  });

  it('ツールチップは経過とメモの全文。行では名前のすぐ下', () => {
    const mark = { note: 'fix-login のマージ後に再開', since: 0 };
    assert.equal(holdTooltip(mark, 2 * 24 * 60 * MIN), '保留 2 日\nfix-login のマージ後に再開');
    assert.equal(holdTooltip({ note: '', since: 0 }, 10 * MIN), '保留 10 分');
    assert.equal(tooltip(view({ title: 't' }), mark, 0), 't\n保留したばかり\nfix-login のマージ後に再開');
  });
});
