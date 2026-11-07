// カードの作業フォルダを探す（src/main/open-folder.ts）
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardFolder, isFolder } from '../src/main/open-folder';
import { cardKeyOf } from '../src/shared/card-key';
import { tempDir, view } from './helpers';

describe('cardFolder', () => {
  const main = view({ id: 'local_a', repoKey: 'c:\\repo', workDir: 'C:\\repo' });
  const wt = view({ id: 'local_b', repoKey: 'c:\\repo', worktree: { key: 'x', label: 'x', branch: 'claude/x' }, workDir: 'C:\\repo\\.claude\\worktrees\\x' });

  it('カードの目印が同じセッションの作業フォルダを返す', () => {
    assert.equal(cardFolder([main, wt], cardKeyOf(wt)), wt.workDir);
    assert.equal(cardFolder([main, wt], cardKeyOf(main)), main.workDir);
  });

  it('作業フォルダがわかるセッションを選ぶ', () => {
    const unknown = { ...wt, id: 'local_c', workDir: undefined };
    assert.equal(cardFolder([unknown, wt], cardKeyOf(wt)), wt.workDir);
  });

  it('見つからなければ undefined', () => {
    assert.equal(cardFolder([main], cardKeyOf(wt)), undefined);
    assert.equal(cardFolder([{ ...wt, workDir: undefined }], cardKeyOf(wt)), undefined);
  });
});

describe('isFolder', () => {
  it('あるフォルダだけ true', () => {
    const dir = tempDir();
    try {
      assert.equal(isFolder(dir.path), true);
      assert.equal(isFolder(`${dir.path}-none`), false);
    } finally {
      dir.cleanup();
    }
  });
});
