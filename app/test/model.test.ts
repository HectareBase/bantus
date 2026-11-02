// 画面に出す形への組み立て（src/renderer/model.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCards, buildGroups, cardBadge, formatAgo, stateOfRank, tooltip, waitingLabel } from '../src/renderer/model';
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
