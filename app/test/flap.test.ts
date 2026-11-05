import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLAP_HEIGHT, FLAP_INSET, FLAP_WIDTH, flapHeight, flapRect } from '../src/shared/flap';

describe('flapRect', () => {
  const card = { x: 20, y: 100, width: 240, height: 400 };
  it('右端に置いたときは、カードの左へ飛び出す', () => {
    assert.deepEqual(flapRect('right', card), { x: 20 - FLAP_WIDTH, y: 100 + FLAP_INSET, width: FLAP_WIDTH, height: FLAP_HEIGHT });
  });
  it('左端に置いたときは、カードの右へ飛び出す', () => {
    assert.deepEqual(flapRect('left', card), { x: 260, y: 100 + FLAP_INSET, width: FLAP_WIDTH, height: FLAP_HEIGHT });
  });
  it('カードが長くてもつまみの高さで、低いカードでは中に収める', () => {
    assert.equal(flapHeight(400), FLAP_HEIGHT);
    assert.equal(flapHeight(40), 40 - FLAP_INSET * 2);
    assert.equal(flapHeight(10), 16);
  });
});
