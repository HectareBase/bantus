// 並びが変わったときのアニメーション（FLIP）。動かす前の位置を測り、DOM を書き換え、
// 新しい位置から元の位置までずらした状態で始めて、transform だけで今の位置へ戻す。
// View Transitions は使わない：スナップショットが main のスクロールの枠で切れずにタイトルバーへはみ出し、
// 動いている間は回転や点滅も止まる。element.animate() なら DOM のまま動くので、どちらも起きない。

const ANIMATION_ID = 'flip';
const MOVE_MS = 220;
const APPEAR_MS = 160;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** 動かしてよいか。動きを減らす設定のときと、見えていない（html.paused）ときは動かさない */
export function enabled(): boolean {
  const root = document.documentElement;
  return !reducedMotion.matches && !root.classList.contains('paused');
}

/** 見えている要素だけの位置。たたんだ「停止中」の中など、表示されていないものは測らない */
function rectOf(el: Element): DOMRect | undefined {
  return el.isConnected && el.getClientRects().length ? el.getBoundingClientRect() : undefined;
}

/**
 * mutate で DOM を書き換え、collect が返す要素のうち位置が変わったものを動かす。
 * collect は親を子より先に返す（カードを行より先に）。子は親と一緒に動くので、親のずれを差し引く。
 * 前の描画で見えていなかった要素は、ふわっと出す（最初の描画では何もしない）。
 */
export function flip(collect: () => Iterable<HTMLElement>, mutate: () => void) {
  if (!enabled()) {
    mutate();
    return;
  }
  const before = new Map<HTMLElement, DOMRect>();
  for (const el of collect()) {
    const rect = rectOf(el);
    if (rect) before.set(el, rect);
  }
  // 途中のアニメーションは、今見えている位置を測ってから止める（そこから続けて動かす）
  for (const a of document.getAnimations()) if (a.id === ANIMATION_ID) a.cancel();

  mutate();

  // 動かし始めると子の位置に親の transform が乗るので、先にすべて測る
  const after = new Map<HTMLElement, DOMRect>();
  for (const el of collect()) {
    const rect = rectOf(el);
    if (rect) after.set(el, rect);
  }

  const moved = new Map<HTMLElement, { x: number; y: number }>();
  const appeared = new Set<HTMLElement>();
  for (const [el, last] of after) {
    const first = before.get(el);
    if (!first) {
      // 親がふわっと出るなら、子は親に任せる
      if (before.size && !hasAncestorIn(el, appeared)) {
        appeared.add(el);
        animate(el, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], APPEAR_MS);
      }
      continue;
    }
    const delta = { x: first.left - last.left, y: first.top - last.top };
    moved.set(el, delta);
    const parent = nearestAncestorIn(el, moved);
    const x = delta.x - (parent?.x ?? 0);
    const y = delta.y - (parent?.y ?? 0);
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
    animate(el, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], MOVE_MS);
  }
}

/** 今の並べ替えの動きが終わるまで待つ。待っている間に次の並べ替えが始まったら、それも待つ */
export async function afterMoves(): Promise<void> {
  for (;;) {
    const moving = document.getAnimations().filter((a) => a.id === ANIMATION_ID && a.playState !== 'finished');
    if (!moving.length) return;
    await Promise.allSettled(moving.map((a) => a.finished));
  }
}

function animate(el: HTMLElement, keyframes: Keyframe[], duration: number) {
  const a = el.animate(keyframes, { duration, easing: EASING });
  a.id = ANIMATION_ID;
}

function nearestAncestorIn<T>(el: HTMLElement, map: Map<HTMLElement, T>): T | undefined {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const v = map.get(p);
    if (v) return v;
  }
  return undefined;
}

function hasAncestorIn(el: HTMLElement, set: Set<HTMLElement>): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return true;
  return false;
}
