// 新しく未確認になった行に、状態の色の光を左から右へ一度だけ横切らせる。
// 描き直すたびに動かないよう、CSS の属性ではなく element.animate() で動かす（flip.ts と同じ）。
// 光は行の角丸の中に収める。行そのものは切らず、重ねた入れ物（.sweep）だけを overflow: hidden にする。

import { afterMoves, enabled } from './flip.js';

const SWEEP_MS = 2000;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** 光の要素。入れ物は行ごとに 1 つだけ作り、使い回す */
function lightOf(row: HTMLElement): HTMLElement {
  let light = row.querySelector<HTMLElement>(':scope > .sweep > .sweep-light');
  if (!light) {
    const box = document.createElement('span');
    box.className = 'sweep';
    box.setAttribute('aria-hidden', 'true');
    light = document.createElement('span');
    light.className = 'sweep-light';
    box.append(light);
    row.append(box);
  }
  return light;
}

/**
 * 並べ替えの動き（FLIP）が終わってから光を走らせる（移動中の行の上では光らせない）。
 * 待っている間に帯が消えた、行がなくなった、動かせなくなったときは走らせない
 */
export async function sweep(row: HTMLElement): Promise<void> {
  if (!enabled()) return;
  await afterMoves();
  if (!enabled() || !row.isConnected || !row.hasAttribute('data-attention') || !row.getClientRects().length) return;
  const light = lightOf(row);
  for (const a of light.getAnimations()) a.cancel();
  // 終わったら fill を残さず、ふだんの opacity: 0 に戻す
  light.animate(
    [
      { transform: 'translateX(-100%)', opacity: 1 },
      { transform: 'translateX(100%)', opacity: 1 },
    ],
    { duration: SWEEP_MS, easing: EASING },
  );
}
