// めくれの寸法と、重なりに反応する範囲（docs/design/worktree-cards.md）。ウィジェットの画面とめくれの画面の両方で使う。

import type { TipRect } from './types';

/** めくれがカードの端から外へ飛び出す幅。隠れている重なり（見えている幅 6px）のおよそ 2 倍 */
export const FLAP_WIDTH = 18;
/** めくれはカードの上下からこれだけ内側（重なりと同じ） */
export const FLAP_INSET = 6;

/**
 * 重なりに反応する範囲。重なりの的と、めくれが飛び出す所を合わせた四角（ウィジェットの中の座標）。
 * めくれが隠れていても、飛び出す所にカーソルを置けばめくれを出す。edge はウィジェットを置いた端（right なら左へ飛び出す）
 */
export function flapZone(edge: 'left' | 'right', card: TipRect, hit: TipRect): TipRect {
  const flap = {
    x: edge === 'right' ? card.x - FLAP_WIDTH : card.x + card.width,
    y: card.y + FLAP_INSET,
    width: FLAP_WIDTH,
    height: Math.max(0, card.height - FLAP_INSET * 2),
  };
  const x = Math.min(flap.x, hit.x);
  const y = Math.min(flap.y, hit.y);
  return {
    x,
    y,
    width: Math.max(flap.x + flap.width, hit.x + hit.width) - x,
    height: Math.max(flap.y + flap.height, hit.y + hit.height) - y,
  };
}
