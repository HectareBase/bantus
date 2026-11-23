// カードを分岐元の下にぶら下げる並び（src/renderer/card-tree.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutCardTree, type TreeCard } from '../src/renderer/card-tree';
import { buildRepos, displayOrder, NO_ARCHIVE } from '../src/renderer/model';
import { view } from './helpers';

const main: TreeCard = { key: 'main', isMain: true, label: 'main', branch: 'main' };
const wt = (name: string, base?: string): TreeCard => ({ key: name, isMain: false, label: name, branch: name, ...(base && { base }) });
const shape = (rows: ReturnType<typeof layoutCardTree>) => rows.map((r) => `${'-'.repeat(r.depth)}${r.kind === 'group' ? '[' + r.label + ']' : r.label}`);

describe('layoutCardTree', () => {
  it('分岐元のカードの下にぶら下げ、兄弟は渡された順のまま', () => {
    const rows = layoutCardTree([wt('b', 'a'), wt('a', 'main'), main, wt('c', 'a'), wt('d', 'main')]);
    assert.deepEqual(shape(rows), ['main', '-a', '--b', '--c', '-d']);
  });

  it('線の形：最後の兄弟、親の縦線、子があるか', () => {
    const rows = layoutCardTree([main, wt('a', 'main'), wt('b', 'a'), wt('c', 'main')]);
    const b = rows.find((r) => r.key === 'b')!;
    assert.deepEqual(b.rails, [true], 'a の下にまだ c があるので、1 段目の縦線を通す');
    assert.equal(b.last, true);
    assert.equal(rows.find((r) => r.key === 'a')!.hasChildren, true);
    assert.equal(rows.find((r) => r.key === 'c')!.last, true);
    const lastBranch = layoutCardTree([main, wt('a', 'main'), wt('b', 'a')]).find((r) => r.key === 'b')!;
    assert.deepEqual(lastBranch.rails, [false]);
  });

  it('カードのない分岐元は見出しの段にし、元のフォルダの下に置く', () => {
    const rows = layoutCardTree([main, wt('a', 'develop'), wt('b', 'develop')]);
    assert.deepEqual(shape(rows), ['main', '-[develop]', '--a', '--b']);
    assert.equal(rows[1]!.key, 'group:develop');
  });

  it('元のフォルダのカードがなければ、見出しの段を一番上に置く', () =>
    assert.deepEqual(shape(layoutCardTree([wt('a', 'main'), wt('b', 'develop')])), ['[main]', '-a', '[develop]', '-b']));

  it('アーカイブした親は短い名前の見出しの段にする', () => {
    const hidden = [{ key: 'x', isMain: false, label: 'parent', branch: 'claude/parent-123' }];
    assert.equal(layoutCardTree([main, wt('a', 'claude/parent-123')], hidden)[1]!.label, 'parent');
  });

  it('深さの上限より深いものは同じ深さに並べ、親の名前を添える', () => {
    const rows = layoutCardTree([main, wt('a', 'main'), wt('b', 'a'), wt('c', 'b'), wt('d', 'c')]);
    assert.deepEqual(shape(rows), ['main', '-a', '--b', '--c', '--d']);
    assert.equal(rows.find((r) => r.key === 'c')!.via, 'b');
    assert.equal(rows.find((r) => r.key === 'd')!.via, 'c');
    assert.equal(rows.find((r) => r.key === 'b')!.via, undefined);
  });

  it('分岐元が互いを指していても、すべてのカードを 1 回ずつ出す', () => {
    const rows = layoutCardTree([main, wt('a', 'b'), wt('b', 'a')]);
    assert.deepEqual(rows.map((r) => r.key).sort(), ['a', 'b', 'main']);
  });

  it('自分自身が分岐元なら一番上の段', () => assert.deepEqual(shape(layoutCardTree([wt('a', 'a')])), ['a']));
});

describe('buildRepos とツリー', () => {
  const session = (name: string, base: string) => view({ repoKey: 'r', mainBranch: 'main', baseBranch: base, worktree: { key: name, label: name, branch: name } });
  const list = () => [view({ repoKey: 'r', mainBranch: 'main' }), session('z-parent', 'main'), session('a-child', 'z-parent')];

  it('オフなら今の並びのままで、段を作らない', () => {
    const repo = buildRepos(list(), { ...NO_ARCHIVE, sort: { ...NO_ARCHIVE.sort, worktree: 'fixed' } })[0]!;
    assert.deepEqual(repo.cards.map((c) => c.label), ['main', 'a-child', 'z-parent']);
    assert.equal(repo.tree, undefined);
  });

  it('オンならカードと巡回の順もツリーの順になる', () => {
    const sessions = list();
    const opts = { ...NO_ARCHIVE, tree: true, sort: { ...NO_ARCHIVE.sort, worktree: 'fixed' as const } };
    const repo = buildRepos(sessions, opts)[0]!;
    assert.deepEqual(repo.cards.map((c) => c.label), ['main', 'z-parent', 'a-child']);
    assert.deepEqual(repo.tree!.map((r) => r.depth), [0, 1, 2]);
    assert.deepEqual(displayOrder(sessions, opts).map((s) => s.worktree?.label), [undefined, 'z-parent', 'a-child']);
  });
});
