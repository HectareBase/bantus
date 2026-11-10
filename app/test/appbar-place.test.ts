import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abEdge, areaWithoutBar, fitWidth, fromLtrb, placeWidget, proposeRect, sameLtrb, toLtrb } from '../src/main/appbar-place';

const monitor = { left: 0, top: 0, right: 1920, bottom: 1080 };

describe('abEdge', () => {
  it('left は ABE_LEFT（0）、right は ABE_RIGHT（2）', () => {
    assert.equal(abEdge('left'), 0);
    assert.equal(abEdge('right'), 2);
  });
});

describe('proposeRect', () => {
  it('左端ならモニターの左から幅の分', () => {
    assert.deepEqual(proposeRect('left', monitor, 400), { left: 0, top: 0, right: 400, bottom: 1080 });
  });
  it('右端ならモニターの右から幅の分', () => {
    assert.deepEqual(proposeRect('right', monitor, 400), { left: 1520, top: 0, right: 1920, bottom: 1080 });
  });
  it('2 つ目のモニター（負の座標）でも端から取る', () => {
    assert.deepEqual(proposeRect('left', { left: -1920, top: 0, right: 0, bottom: 1080 }, 300), { left: -1920, top: 0, right: -1620, bottom: 1080 });
  });
});

describe('fitWidth', () => {
  it('ほかのアプリバーで内側へずらされたら、端の側を基準に幅を戻す（左）', () => {
    // QUERYPOS で 100px 内側へ押された
    assert.deepEqual(fitWidth('left', { left: 100, top: 0, right: 400, bottom: 1040 }, 400), { left: 100, top: 0, right: 500, bottom: 1040 });
  });
  it('右', () => {
    assert.deepEqual(fitWidth('right', { left: 1520, top: 0, right: 1820, bottom: 1040 }, 400), { left: 1420, top: 0, right: 1820, bottom: 1040 });
  });
});

describe('sameLtrb', () => {
  it('同じなら true、片方がなければ false', () => {
    assert.equal(sameLtrb(monitor, { ...monitor }), true);
    assert.equal(sameLtrb(monitor, { ...monitor, right: 1919 }), false);
    assert.equal(sameLtrb(undefined, monitor), false);
  });
});

describe('toLtrb と fromLtrb', () => {
  it('行き来しても変わらない', () => {
    const r = { x: 10, y: 20, width: 300, height: 400 };
    assert.deepEqual(toLtrb(r), { left: 10, top: 20, right: 310, bottom: 420 });
    assert.deepEqual(fromLtrb(toLtrb(r)), r);
  });
});

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('areaWithoutBar', () => {
  it('アプリバーがなければ作業領域のまま', () => {
    const work = { x: 0, y: 0, width: 1920, height: 1040 };
    assert.deepEqual(areaWithoutBar(work, display, undefined), work);
  });
  it('左端の帯の分が引かれた作業領域に、帯を足し戻す', () => {
    const work = { x: 400, y: 0, width: 1520, height: 1040 };
    const bar = { edge: 'left' as const, rect: { x: 0, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(areaWithoutBar(work, display, bar), { x: 0, y: 0, width: 1920, height: 1040 });
  });
  it('右端', () => {
    const work = { x: 0, y: 0, width: 1520, height: 1040 };
    const bar = { edge: 'right' as const, rect: { x: 1520, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(areaWithoutBar(work, display, bar), { x: 0, y: 0, width: 1920, height: 1040 });
  });
  it('Windows がまだ作業領域を縮めていなくても、広げすぎない', () => {
    const work = { x: 0, y: 0, width: 1920, height: 1040 };
    const bar = { edge: 'left' as const, rect: { x: 0, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(areaWithoutBar(work, display, bar), work);
  });
  it('帯がほかのモニターにあれば、作業領域のまま', () => {
    const work = { x: 1920, y: 0, width: 1920, height: 1040 };
    const other = { x: 1920, y: 0, width: 1920, height: 1080 };
    const bar = { edge: 'left' as const, rect: { x: 0, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(areaWithoutBar(work, other, bar), work);
  });
});

describe('placeWidget', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  it('アプリバーがなければ作業領域の端', () => {
    assert.deepEqual(placeWidget('left', area, 400, undefined), { x: 0, y: 0, width: 400, height: 1040 });
    assert.deepEqual(placeWidget('right', area, 400, undefined), { x: 1520, y: 0, width: 400, height: 1040 });
  });
  it('同じ端の帯が内側へずれていたら、帯の端の側にそろえる', () => {
    const bar = { edge: 'left' as const, rect: { x: 100, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(placeWidget('left', area, 400, bar), { x: 100, y: 0, width: 400, height: 1040 });
    const right = { edge: 'right' as const, rect: { x: 1420, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(placeWidget('right', area, 400, right), { x: 1420, y: 0, width: 400, height: 1040 });
  });
  it('ドラッグ中は帯と幅が違っても、端の側を基準に幅を変える', () => {
    const right = { edge: 'right' as const, rect: { x: 1520, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(placeWidget('right', area, 500, right), { x: 1420, y: 0, width: 500, height: 1040 });
  });
  it('端を変えた直後（帯がまだ前の端）は、帯を使わない', () => {
    const bar = { edge: 'left' as const, rect: { x: 0, y: 0, width: 400, height: 1040 } };
    assert.deepEqual(placeWidget('right', area, 400, bar), { x: 1520, y: 0, width: 400, height: 1040 });
  });
});
