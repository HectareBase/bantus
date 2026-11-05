import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLAP_INSET, FLAP_WIDTH, flapZone } from '../src/shared/flap';

describe('flapZone', () => {
  const card = { x: 20, y: 100, width: 240, height: 60 };
  it('右端に置いたときは、的とカードの左へ飛び出すめくれを合わせる', () => {
    const hit = { x: 12, y: 106, width: 12, height: 48 };
    assert.deepEqual(flapZone('right', card, hit), { x: 20 - FLAP_WIDTH, y: 100 + FLAP_INSET, width: 24 - (20 - FLAP_WIDTH), height: 60 - FLAP_INSET * 2 });
  });
  it('左端に置いたときは、カードの右へ飛び出し、ウィジェットの外へはみ出す', () => {
    const hit = { x: 256, y: 106, width: 12, height: 48 };
    const zone = flapZone('left', card, hit);
    assert.equal(zone.x, 256);
    assert.equal(zone.x + zone.width, 260 + FLAP_WIDTH);
  });
  it('的のほうが大きいときは的を残す', () => {
    const hit = { x: 0, y: 90, width: 24, height: 80 };
    const zone = flapZone('right', card, hit);
    assert.equal(zone.y, 90);
    assert.equal(zone.height, 80);
  });
});
