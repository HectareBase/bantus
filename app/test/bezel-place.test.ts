import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BEZEL_LINE, bezelParts, filletRows } from '../src/main/bezel-place';

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
    assert.deepEqual(bezelParts('left', area, 12).map((p) => p.name), ['top', 'bottom', 'far']));

  it('上と下の辺は作業領域の幅いっぱいで、高さは角丸の分。線はいちばん外側の 1 行', () => {
    const [top, bottom] = bezelParts('left', area, 12);
    assert.deepEqual(top!.rect, { x: 288, y: 48, width: 2784, height: 12 });
    assert.deepEqual(bottom!.rect, { x: 288, y: 48 + 1680 - 12, width: 2784, height: 12 });
    assert.deepEqual(top!.shape[0], { x: 0, y: 0, width: 2784, height: BEZEL_LINE });
    assert.deepEqual(bottom!.shape[0], { x: 0, y: 12 - BEZEL_LINE, width: 2784, height: BEZEL_LINE });
  });

  it('角の箱の行はすべて塗り、反対側の線とすき間なくつなぐ', () => {
    const [top] = bezelParts('left', area, 12);
    assert.deepEqual(top!.shape.slice(1).map((r) => r.y), Array.from({ length: 12 }, (_, i) => i));
    assert.ok(top!.shape.slice(1).every((r) => r.width >= BEZEL_LINE));
  });

  it('帯が左なら、反対側の線は作業領域の右の端に引き、角丸は右の角に付ける', () => {
    const [top, , far] = bezelParts('left', area, 12);
    assert.equal(far!.rect.x + far!.rect.width, 288 + 2784);
    assert.deepEqual([far!.rect.y, far!.rect.height], [48 + 12, 1680 - 24]);
    for (const r of top!.shape.slice(1)) assert.equal(r.x + r.width, 2784);
  });

  it('帯が右なら、反対側の線は作業領域の左の端に引き、角丸は左の角に付ける', () => {
    const [top, bottom, far] = bezelParts('right', { ...area, x: 0 }, 12);
    assert.equal(far!.rect.x, 0);
    for (const r of [...top!.shape.slice(1), ...bottom!.shape.slice(1)]) assert.equal(r.x, 0);
  });

  it('下の辺の角丸は上の辺の角丸を上下に返した形', () => {
    const [top, bottom] = bezelParts('left', area, 12);
    const t = top!.shape.slice(1).map((r) => [r.y, r.width]);
    const b = bottom!.shape.slice(1).map((r) => [11 - r.y, r.width]);
    assert.deepEqual(b, t);
  });

  it('作業領域が小さすぎれば何も描かない', () => assert.deepEqual(bezelParts('left', { x: 0, y: 0, width: 10, height: 10 }, 12), []));
});
