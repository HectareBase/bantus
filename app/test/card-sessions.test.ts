// カードの ID をコピーするセッションを探す（src/main/card-sessions.ts）
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardSessions, menuLabel } from '../src/main/card-sessions';
import { cardKeyOf } from '../src/shared/card-key';
import { view } from './helpers';

describe('cardSessions', () => {
  const wtInfo = { key: 'x', label: 'x', branch: 'claude/x' };
  const main = view({ id: 'local_a', repoKey: 'c:\repo', lastActivityAt: 1 });
  const old = view({ id: 'local_b', repoKey: 'c:\repo', worktree: wtInfo, lastActivityAt: 1 });
  const recent = view({ id: 'local_c', repoKey: 'c:\repo', worktree: wtInfo, lastActivityAt: 2 });

  it('カードの目印が同じセッションを、新しく動いた順に返す', () => {
    assert.deepEqual(cardSessions([main, old, recent], cardKeyOf(old)).map((s) => s.id), ['local_c', 'local_b']);
    assert.deepEqual(cardSessions([main, old, recent], cardKeyOf(main)).map((s) => s.id), ['local_a']);
  });

  it('local_ の ID がないセッションは除く', () => {
    assert.deepEqual(cardSessions([{ ...old, id: 'cse_x' }], cardKeyOf(old)), []);
  });

  it('知らない目印なら空', () => {
    assert.deepEqual(cardSessions([main], 'c:\other|'), []);
  });
});

describe('menuLabel', () => {
  it('& を重ねる', () => {
    assert.equal(menuLabel('A & B'), 'A && B');
  });
});
