import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLY_GAP, FLY_LIST_WIDTH, FLY_SHADOW, TIP_GAP, TIP_MARGIN, contains, flyoutBounds, inHoverZone, tipBounds } from '../src/main/tip-place';

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

describe('flyoutBounds', () => {
  const card = { x: 8, y: 120, width: 254, height: 80 };
  it('右端のウィジェットなら、カードの左端から左へ、作業領域の高さいっぱいに置く。一覧はウィジェットの端からすき間をあける', () => {
    // 字下げしたカード（左端が 20）
    const widget = { x: 1656, y: 0, width: 264, height: 1040 };
    const { bounds, top, inset } = flyoutBounds('right', widget, area, { ...card, x: 20, width: 242 });
    assert.equal(inset, 20 + FLY_GAP);
    const width = inset + FLY_LIST_WIDTH + FLY_SHADOW;
    assert.deepEqual(bounds, { x: 1656 + 20 - width, y: 0, width, height: 1040 });
    assert.equal(top, 120);
    // 一覧のウィジェット側の端は、ウィジェットの左端からすき間の分だけ離れる
    assert.equal(bounds.x + bounds.width - inset, widget.x - FLY_GAP);
  });
  it('左端のウィジェットなら、カードの右端から右へ', () => {
    const widget = { x: 0, y: 0, width: 264, height: 1040 };
    const { bounds, inset } = flyoutBounds('left', widget, area, card);
    assert.equal(bounds.x, 262);
    assert.equal(bounds.x + inset, 264 + FLY_GAP);
  });
  it('作業領域が画面の上から始まらないときは、その分を引いた位置をカードの上端にする', () => {
    const top = flyoutBounds('left', { x: 0, y: 40, width: 264, height: 1000 }, { ...area, y: 40, height: 1000 }, card).top;
    assert.equal(top, 120);
  });
  it('contains は右端と下端を含まない', () => {
    assert.equal(contains({ x: 0, y: 0, width: 10, height: 10 }, 9, 9), true);
    assert.equal(contains({ x: 0, y: 0, width: 10, height: 10 }, 10, 5), false);
  });
});

describe('inHoverZone', () => {
  // 右端のウィジェット：めくれのウィンドウはカードの端（x=1664）から左。重なりの的はカードの中へ 4px かかる
  const win = { x: 1324, y: 0, width: 340, height: 1040 };
  const flap = { x: 310, y: 126, width: 30, height: 68 };
  const hit = { x: 1656, y: 126, width: 12, height: 68 };
  it('ウィジェット側から乗せた（的のうちカードにかかった所）ときは、めくれの外でも的の中', () =>
    assert.deepEqual(inHoverZone({ x: 1666, y: 150 }, win, [flap], hit), { solid: false, hit: true }));
  it('めくれの上ではクリックを受け取る', () => assert.deepEqual(inHoverZone({ x: 1640, y: 150 }, win, [flap], hit), { solid: true, hit: false }));
  it('どちらからも外れた', () => assert.deepEqual(inHoverZone({ x: 1700, y: 150 }, win, [flap], hit), { solid: false, hit: false }));
  it('的がなければ、めくれだけで決める', () => assert.deepEqual(inHoverZone({ x: 1660, y: 150 }, win, [flap], undefined), { solid: true, hit: false }));
});
