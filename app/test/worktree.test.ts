// ワークツリー版の判定と値（src/main/worktree.ts）
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { safeName, worktreeAppUserModelId, worktreeInitialSettings, worktreeName, worktreeUserData, type GitEntry } from '../src/main/worktree';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const root = join('C:', 'repo');
const wt = join(root, '.claude', 'worktrees', 'feature-x');

/** 決まったフォルダにだけ .git がある偽のファイルシステム */
const fakeGit = (entries: Record<string, GitEntry>) => (dir: string) => entries[dir];

describe('worktreeName', () => {
  it('上のフォルダの .git がファイルなら、そのフォルダの名前を返す', () => {
    const git = fakeGit({ [wt]: 'file', [root]: 'dir' });
    assert.equal(worktreeName(join(wt, 'app'), git), 'feature-x');
  });

  it('main のチェックアウト（.git がフォルダ）なら undefined', () => {
    assert.equal(worktreeName(join(root, 'app'), fakeGit({ [root]: 'dir' })), undefined);
  });

  it('いちばん近い .git で決める（ワークツリーの中の .git ファイルが先）', () => {
    // ワークツリーは main のチェックアウトの中にあるが、近い方の .git ファイルで判定する
    assert.equal(worktreeName(join(wt, 'app', 'dist'), fakeGit({ [wt]: 'file', [root]: 'dir' })), 'feature-x');
  });

  it('.git がどこにもなければ undefined', () => {
    assert.equal(worktreeName(join(root, 'app'), fakeGit({})), undefined);
  });
});

describe('ワークツリー版の値', () => {
  it('データフォルダは名前つきで、見本データならさらに -debug', () => {
    assert.equal(worktreeUserData('C:\\AppData\\Bantus', 'feature-x', false), 'C:\\AppData\\Bantus-wt-feature-x');
    assert.equal(worktreeUserData('C:\\AppData\\Bantus', 'feature-x', true), 'C:\\AppData\\Bantus-wt-feature-x-debug');
  });

  it('使えない文字は _ にする', () => {
    assert.equal(safeName('a b/c:日本'), 'a_b_c___');
    assert.equal(worktreeAppUserModelId('io.example.app', 'x y'), 'io.example.app.wt.x_y');
  });

  it('最初の設定は、いつもの設定を写して端を反対にする', () => {
    const s = worktreeInitialSettings({ ...DEFAULT_SETTINGS, edge: 'right', width: 420, openAtLogin: true });
    assert.equal(s.edge, 'left');
    assert.equal(s.width, 420);
    assert.equal(s.openAtLogin, false);
    assert.equal(worktreeInitialSettings({ edge: 'left' }).edge, 'right');
  });

  it('いつもの設定が読めなければ、既定の反対の端', () => {
    assert.equal(worktreeInitialSettings(undefined).edge, DEFAULT_SETTINGS.edge === 'left' ? 'right' : 'left');
  });
});
