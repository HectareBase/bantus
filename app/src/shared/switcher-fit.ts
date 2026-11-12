// ウィンドウの切り替えの帯（renderer/switcher.ts）に並べるアイコンの数。DOM を使わないので、テストから直接呼べる

/** アイコンのボタンの幅、ボタンの間、「+N」のボタンの幅（px）。styles.css の .switcher-item、.switcher-bar、.switcher-more と合わせる */
export const SWITCHER_ITEM = 24;
export const SWITCHER_GAP = 2;
export const SWITCHER_MORE = 32;

/**
 * 帯に並べるアイコンの数。total はウィンドウの数、width は帯の中の幅（px）。
 * すべて入るならすべて。入りきらないときは「+N」のボタンの分を空けて、入るだけ（0 のこともある）
 */
export function switcherFit(total: number, width: number, item = SWITCHER_ITEM, gap = SWITCHER_GAP, more = SWITCHER_MORE): number {
  if (total <= 0) return 0;
  if (total * item + (total - 1) * gap <= width) return total;
  return Math.max(0, Math.min(total - 1, Math.floor((width - more) / (item + gap))));
}
