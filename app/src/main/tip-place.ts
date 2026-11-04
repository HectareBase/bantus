// ツールチップのウィンドウを置く場所。ウィジェットの外の、画面の内側（真ん中の側）に出し、ほかのセッションの行に重ねない。
// 縦は基準の要素の上端にそろえ、作業領域からはみ出すときは中へずらす。

/** ツールチップの影を描く余白。ウィンドウはこの分だけ中身より大きい */
export const TIP_MARGIN = 8;
/** ウィジェットの端とツールチップのすき間 */
export const TIP_GAP = 4;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * @param widget ウィジェットのウィンドウ（画面の座標）
 * @param anchor 基準の要素（ウィジェットの中の座標）
 * @param size ツールチップの中身の大きさ（影の余白を除く）
 */
export function tipBounds(edge: 'left' | 'right', widget: Rect, area: Rect, anchor: Rect, size: { width: number; height: number }): Rect {
  const width = Math.ceil(size.width) + TIP_MARGIN * 2;
  const height = Math.ceil(size.height) + TIP_MARGIN * 2;
  const outside = edge === 'left' ? widget.x + widget.width + TIP_GAP - TIP_MARGIN : widget.x - TIP_GAP - width + TIP_MARGIN;
  // 内側に入りきらないとき（ウィジェットが広い、モニターが狭い）は、作業領域の端で止める
  const x = clamp(outside, area.x - TIP_MARGIN, area.x + area.width - width + TIP_MARGIN);
  const y = clamp(widget.y + anchor.y - TIP_MARGIN, area.y - TIP_MARGIN, area.y + area.height - height + TIP_MARGIN);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// ---- めくれと一覧のウィンドウ（flyout） ----

/** めくれと一覧のウィンドウの幅（一覧の幅と影の余白） */
export const FLY_WIDTH = 340;

/**
 * めくれと一覧のウィンドウを置く場所。カードの端（画面の内側の端）から外へ、作業領域の高さいっぱいに取る。
 * 縦の位置は一覧の画面が決めるので、ウィンドウは動かさずに済む。top はカードの上端（ウィンドウの中の座標）
 * @param anchor カード（ウィジェットの中の座標）
 */
export function flyoutBounds(edge: 'left' | 'right', widget: Rect, area: Rect, anchor: Rect): { bounds: Rect; top: number } {
  // ウィジェットが右端なら、カードの左端から左へ。左端なら、カードの右端から右へ
  const x = edge === 'right' ? widget.x + anchor.x - FLY_WIDTH : widget.x + anchor.x + anchor.width;
  return {
    bounds: { x: Math.round(x), y: area.y, width: FLY_WIDTH, height: area.height },
    top: Math.round(widget.y + anchor.y - area.y),
  };
}

/** 点が四角の中にあるか */
export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}
