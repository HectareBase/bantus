import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BEZEL_WINDOW, bezelArea, bezelParts, cornerBitmap, filletRows } from '../src/main/bezel-place';

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
  const byName = (parts: ReturnType<typeof bezelParts>) => Object.fromEntries(parts.map((p) => [p.name, p]));

  it('上の辺・下の辺・反対側の辺と、反対側の上と下の角の 5 枚', () =>
    assert.deepEqual(bezelParts('left', area, 12, 1).map((p) => p.name), ['top', 'bottom', 'far', 'topCorner', 'bottomCorner']));

  it('上と下の辺は作業領域の幅いっぱいで、高さは Windows の最小の大きさより大きく取る。線はいちばん外側の線の太さの分', () => {
    const { top, bottom } = byName(bezelParts('left', area, 12, 3));
    assert.deepEqual(top!.rect, { x: 288, y: 48, width: 2784, height: BEZEL_WINDOW });
    assert.deepEqual(bottom!.rect, { x: 288, y: 48 + 1680 - BEZEL_WINDOW, width: 2784, height: BEZEL_WINDOW });
    assert.deepEqual(top!.shape, [{ x: 0, y: 0, width: 2784, height: 3 }]);
    assert.deepEqual(bottom!.shape, [{ x: 0, y: BEZEL_WINDOW - 3, width: 2784, height: 3 }]);
  });

  it('窓はどれも Windows の最小の大きさ（幅 29・高さ 38 DIP ほど）より大きい', () => {
    for (const p of bezelParts('left', area, 12, 1)) assert.ok(p.rect.width >= 40 && p.rect.height >= 40, p.name);
  });

  it('角丸と線が窓より大きければ、窓も大きくする', () => {
    const { top, far, topCorner } = byName(bezelParts('left', area, 40, 6));
    assert.equal(top!.rect.height, 46);
    assert.equal(far!.rect.width, 46);
    assert.deepEqual([topCorner!.rect.width, topCorner!.rect.height], [46, 46]);
  });

  it('帯が左なら、反対側の線は作業領域の右の端に引き、角は右の角に置く', () => {
    const { far, topCorner, bottomCorner } = byName(bezelParts('left', area, 12, 2));
    assert.equal(far!.rect.x + far!.rect.width, 288 + 2784);
    // 線と角丸の箱の分だけ上下を空ける
    assert.deepEqual([far!.rect.y, far!.rect.height], [48 + 14, 1680 - 28]);
    assert.deepEqual(far!.shape, [{ x: BEZEL_WINDOW - 2, y: 0, width: 2, height: 1680 - 28 }]);
    assert.deepEqual(topCorner!.rect, { x: 288 + 2784 - BEZEL_WINDOW, y: 48, width: BEZEL_WINDOW, height: BEZEL_WINDOW });
    assert.deepEqual(topCorner!.corner, { vertical: 'top', horizontal: 'right', box: { x: BEZEL_WINDOW - 14, y: 0, width: 14, height: 14 }, radius: 12, line: 2 });
    assert.deepEqual(bottomCorner!.rect, { x: 288 + 2784 - BEZEL_WINDOW, y: 48 + 1680 - BEZEL_WINDOW, width: BEZEL_WINDOW, height: BEZEL_WINDOW });
    assert.deepEqual(bottomCorner!.corner!.box, { x: BEZEL_WINDOW - 14, y: BEZEL_WINDOW - 14, width: 14, height: 14 });
  });

  it('帯が右なら、反対側の線と角は作業領域の左の端に置く', () => {
    const { far, topCorner, bottomCorner } = byName(bezelParts('right', { ...area, x: 0 }, 12, 1));
    assert.equal(far!.rect.x, 0);
    assert.equal(far!.shape[0]!.x, 0);
    assert.equal(topCorner!.rect.x, 0);
    assert.equal(topCorner!.corner!.horizontal, 'left');
    assert.equal(topCorner!.corner!.box.x, 0);
    for (const r of [...topCorner!.shape, ...bottomCorner!.shape]) assert.equal(r.x, 0);
  });

  it('絵が使えないときの角の段は、線のすぐ内側から 1 行ずつ、反対側の線の太さの分も続けて塗る。下の角は上下を返す', () => {
    const { topCorner, bottomCorner } = byName(bezelParts('left', area, 12, 3));
    assert.deepEqual(topCorner!.shape.map((r) => r.y), Array.from({ length: 12 }, (_, i) => 3 + i));
    assert.deepEqual(topCorner!.shape.map((r) => r.width), filletRows(12).map((w) => w + 3));
    for (const r of topCorner!.shape) assert.equal(r.x + r.width, BEZEL_WINDOW);
    assert.deepEqual(bottomCorner!.shape.map((r) => [BEZEL_WINDOW - 1 - r.y, r.width]), topCorner!.shape.map((r) => [r.y, r.width]));
  });

  it('作業領域が小さすぎれば何も描かない', () => assert.deepEqual(bezelParts('left', { x: 0, y: 0, width: 20, height: 20 }, 12, 1), []));
});

describe('cornerBitmap', () => {
  const alpha = (buf: Buffer, n: number, x: number, y: number) => buf[(y * n + x) * 4 + 3]!;

  it('右上の角：上と右の端の線は黒、円の内側（左下）は透明、縁は半透明でなじませる', () => {
    const n = 20;
    const buf = cornerBitmap({ vertical: 'top', horizontal: 'right', radius: 16, line: 4 }, n, 1);
    assert.equal(buf.length, n * n * 4);
    assert.equal(alpha(buf, n, 0, 0), 255);
    assert.equal(alpha(buf, n, n - 1, n - 1), 255);
    assert.equal(alpha(buf, n, 0, n - 1), 0);
    assert.equal(alpha(buf, n, 8, 12), 0);
    // 色は黒（BGR は 0）
    for (let i = 0; i < buf.length; i += 4) assert.deepEqual([buf[i], buf[i + 1], buf[i + 2]], [0, 0, 0]);
    const partial = Array.from({ length: n * n }, (_, i) => buf[i * 4 + 3]!).filter((a) => a > 0 && a < 255);
    assert.ok(partial.length >= 10, `半透明の画素 ${partial.length}`);
  });

  it('ほかの角は右上の絵を左右か上下に返した形', () => {
    const n = 15;
    const corner = { radius: 12, line: 2 };
    const tr = cornerBitmap({ ...corner, vertical: 'top', horizontal: 'right' }, n, 1.25);
    const bl = cornerBitmap({ ...corner, vertical: 'bottom', horizontal: 'left' }, n, 1.25);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) assert.equal(alpha(bl, n, x, y), alpha(tr, n, n - 1 - x, n - 1 - y), `${x},${y}`);
  });

  it('線の太さは画面の拡大率をかけて物理ピクセルにそろえる', () => {
    const n = 30;
    const buf = cornerBitmap({ vertical: 'top', horizontal: 'right', radius: 4, line: 2 }, n, 1.5);
    // 線は 3 ピクセル。角丸から離れた列で、上から 3 行が黒、4 行目からは透明
    assert.deepEqual([0, 1, 2, 3].map((y) => alpha(buf, n, 5, y)), [255, 255, 255, 0]);
  });
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
