import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TIP_GAP, TIP_MARGIN, tipBounds } from '../src/main/tip-place';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 200, height: 40 };

describe('tipBounds', () => {
  it('右端のウィジェットなら左（画面の内側）に出す', () => {
    const widget = { x: 1520, y: 0, width: 400, height: 1040 };
    const b = tipBounds('right', widget, area, { x: 10, y: 100, width: 380, height: 44 }, size);
    // 中身の右端がウィジェットの左端からすき間の分だけ離れる
    assert.equal(b.x + b.width - TIP_MARGIN, widget.x - TIP_GAP);
    assert.equal(b.y + TIP_MARGIN, 100);
    assert.equal(b.width, 200 + TIP_MARGIN * 2);
  });

  it('左端のウィジェットなら右に出す', () => {
    const widget = { x: 0, y: 0, width: 400, height: 1040 };
    const b = tipBounds('left', widget, area, { x: 10, y: 100, width: 380, height: 44 }, size);
    assert.equal(b.x + TIP_MARGIN, 400 + TIP_GAP);
  });

  it('下にはみ出すときは作業領域の中へ上げる', () => {
    const widget = { x: 1520, y: 0, width: 400, height: 1040 };
    const b = tipBounds('right', widget, area, { x: 10, y: 1020, width: 380, height: 20 }, size);
    assert.equal(b.y + b.height - TIP_MARGIN, 1040);
  });

  it('別のモニターの座標でもそのモニターの中に収める', () => {
    const second = { x: -1280, y: 0, width: 1280, height: 1000 };
    const widget = { x: -1280, y: 0, width: 400, height: 1000 };
    const b = tipBounds('left', widget, second, { x: 0, y: -50, width: 52, height: 40 }, size);
    assert.equal(b.x + TIP_MARGIN, -1280 + 400 + TIP_GAP);
    assert.equal(b.y + TIP_MARGIN, 0);
  });
});
