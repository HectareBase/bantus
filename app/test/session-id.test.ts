// 行の右クリックメニューでコピーする ID の確認（src/main/session-id.ts）
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { copyableId } from '../src/main/session-id';
import { view } from './helpers';

describe('copyableId', () => {
  const sessions = [view({ id: 'local_a' }), view({ id: 'cse_b' })];

  it('知っているセッションの local_ の ID を返す', () => {
    assert.equal(copyableId(sessions, 'local_a'), 'local_a');
  });

  it('知らない ID は返さない', () => {
    assert.equal(copyableId(sessions, 'local_z'), undefined);
    assert.equal(copyableId(sessions, 'なにか'), undefined);
  });

  it('local_ で始まらない ID は返さない', () => {
    assert.equal(copyableId(sessions, 'cse_b'), undefined);
  });

  it('文字列でなければ返さない', () => {
    assert.equal(copyableId(sessions, undefined), undefined);
    assert.equal(copyableId(sessions, 1), undefined);
  });
});
