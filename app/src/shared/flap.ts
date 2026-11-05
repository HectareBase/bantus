// めくれの寸法と置き場所（docs/design/worktree-cards.md）。ウィジェットの画面とめくれの画面の両方で使う。

import type { TipRect } from './types';

/** めくれがカードの端から外へ飛び出す幅。隠れている重なり（見えている幅 6px）のおよそ 2 倍 */
export const FLAP_WIDTH = 18;
/** めくれはカードの上端からこれだけ下（重なりと同じ） */
export const FLAP_INSET = 6;
/**
 * めくれの高さ。カードの高さによらず、見出しの横に出る短いつまみにする（カードが長くても細長い帯にしない）。
 * 低いカードでは、カードの上下から FLAP_INSET 内側に収める
 */
export const FLAP_HEIGHT = 32;

/** めくれの高さ。カードの高さに合わせて縮める */
export function flapHeight(cardHeight: number): number {
  return Math.max(16, Math.min(FLAP_HEIGHT, cardHeight - FLAP_INSET * 2));
}

/**
 * めくれ（つまみ）が飛び出す所（ウィジェットの中の座標）。めくれが隠れていても、ここにカーソルを置けばめくれを出す。
 * edge はウィジェットを置いた端（right なら左へ飛び出す）
 */
export function flapRect(edge: 'left' | 'right', card: TipRect): TipRect {
  return {
    x: edge === 'right' ? card.x - FLAP_WIDTH : card.x + card.width,
    y: card.y + FLAP_INSET,
    width: FLAP_WIDTH,
    height: flapHeight(card.height),
  };
}
