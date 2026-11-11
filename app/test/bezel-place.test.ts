import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BEZEL_WINDOW, bezelArea, bezelParts, filletRows } from '../src/main/bezel-place';

describe('filletRows', () => {
  it('上の行ほど広く、下の行ほど狭い（ベゼルの辺から帯の辺へなめらかにつなぐ）', () => {
    const rows = filletRows(12);
    assert.equal(rows.length, 12);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i]! <= rows[i - 1]!, `${i} 行目`);
    assert.ok(rows[0]! >= 9);
    assert.ok(rows[11]! <= 1);
  });
});

describe('bezelParts', () => {
  const area = { x: 288, y: 48, width: 2784, height: 1680 };

  it('上の辺・下の辺・反対側の辺の 3 枚', () =>
    assert.deepEqual(bezelParts('left', area, 12, 1).map((p) => p.name), ['top', 'bottom', 'far']));

  it('上と下の辺は作業領域の幅いっぱいで、高さは Windows の最小の大きさより大きく取る。線はいちばん外側の線の太さの分', () => {
    const [top, bottom] = bezelParts('left', area, 12, 3);
    assert.deepEqual(top!.rect, { x: 288, y: 48, width: 2784, height: BEZEL_WINDOW });
    assert.deepEqual(bottom!.rect, { x: 288, y: 48 + 1680 - BEZEL_WINDOW, width: 2784, height: BEZEL_WINDOW });
    assert.deepEqual(top!.shape[0], { x: 0, y: 0, width: 2784, height: 3 });
    assert.deepEqual(bottom!.shape[0], { x: 0, y: BEZEL_WINDOW - 3, width: 2784, height: 3 });
  });

  it('窓はどれも Windows の最小の大きさ（幅 29・高さ 38 DIP ほど）より大きい', () => {
    for (const p of bezelParts('left', area, 12, 1)) assert.ok(p.rect.width >= 40 && p.rect.height >= 40, p.name);
  });

  it('角丸と線が窓より大きければ、窓も大きくする', () => {
    const [top, , far] = bezelParts('left', area, 40, 6);
    assert.equal(top!.rect.height, 46);
    assert.equal(far!.rect.width, 46);
  });

  it('角丸は上の線のすぐ下から 1 行ずつ塗り、反対側の線の太さの分も続けて塗る', () => {
    const [top] = bezelParts('left', area, 12, 3);
    assert.deepEqual(top!.shape.slice(1).map((r) => r.y), Array.from({ length: 12 }, (_, i) => 3 + i));
    assert.deepEqual(top!.shape.slice(1).map((r) => r.width), filletRows(12).map((w) => w + 3));
  });

  it('帯が左なら、反対側の線は作業領域の右の端に引き、角丸は右の角に付ける', () => {
    const [top, , far] = bezelParts('left', area, 12, 2);
    assert.equal(far!.rect.x + far!.rect.width, 288 + 2784);
    // 線と角丸の箱の分だけ上下を空ける
    assert.deepEqual([far!.rect.y, far!.rect.height], [48 + 14, 1680 - 28]);
    // 線は窓の右の端の線の太さの分
    assert.deepEqual(far!.shape, [{ x: BEZEL_WINDOW - 2, y: 0, width: 2, height: 1680 - 28 }]);
    for (const r of top!.shape.slice(1)) assert.equal(r.x + r.width, 2784);
  });

  it('帯が右なら、反対側の線は作業領域の左の端に引き、角丸は左の角に付ける', () => {
    const [top, bottom, far] = bezelParts('right', { ...area, x: 0 }, 12, 1);
    assert.equal(far!.rect.x, 0);
    assert.equal(far!.shape[0]!.x, 0);
    for (const r of [...top!.shape.slice(1), ...bottom!.shape.slice(1)]) assert.equal(r.x, 0);
  });

  it('下の辺の角丸は上の辺の角丸を上下に返した形', () => {
    const [top, bottom] = bezelParts('left', area, 12, 2);
    const t = top!.shape.slice(1).map((r) => [r.y, r.width]);
    const b = bottom!.shape.slice(1).map((r) => [BEZEL_WINDOW - 1 - r.y, r.width]);
    assert.deepEqual(b, t);
  });

  it('作業領域が小さすぎれば何も描かない', () => assert.deepEqual(bezelParts('left', { x: 0, y: 0, width: 20, height: 20 }, 12, 1), []));
});

describe('bezelArea', () => {
  // 作業領域が古いまま（帯を広げる前の内側の端 288）
  const stale = { x: 288, y: 48, width: 2784, height: 1680 };

  it('帯が左なら、左の端はアプリバーの内側の端にそろえ、右の端は作業領域のまま', () =>
    assert.deepEqual(bezelArea('left', stale, { edge: 'left', rect: { x: 0, y: 48, width: 359, height: 1680 } }), { x: 359, y: 48, width: 3072 - 359, height: 1680 }));

  it('帯が右なら、右の端はアプリバーの内側の端にそろえ、左の端は作業領域のまま', () =>
    assert.deepEqual(bezelArea('right', { x: 0, y: 48, width: 2784, height: 1680 }, { edge: 'right', rect: { x: 2700, y: 48, width: 372, height: 1680 } }), { x: 0, y: 48, width: 2700, height: 1680 }));

  it('アプリバーがない、または別の端にあれば作業領域のまま', () => {
    assert.deepEqual(bezelArea('left', stale, undefined), stale);
    assert.deepEqual(bezelArea('left', stale, { edge: 'right', rect: { x: 2700, y: 48, width: 372, height: 1680 } }), stale);
  });
});
