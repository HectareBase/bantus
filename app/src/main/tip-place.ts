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
 * 画面（CSS px）の四角を、画面の座標（DIP）にする。表示の拡大率（設定の zoom）が 1 でないと、2 つは食い違う。
 * 逆向き（画面の座標から CSS px）は 1 / zoom を渡す
 */
export function scaleRect<T extends Rect>(r: T, zoom: number): T {
  return { ...r, x: r.x * zoom, y: r.y * zoom, width: r.width * zoom, height: r.height * zoom };
}

/**
 * @param widget ウィジェットのウィンドウ（画面の座標）
 * @param anchor 基準の要素（ウィジェットの中の、画面の座標）
 * @param size ツールチップの中身の大きさ（影の余白を除く、画面の座標）
 * @param zoom 表示の拡大率。影の余白とすき間（CSS px）を画面の座標にするのに使う
 */
export function tipBounds(edge: 'left' | 'right', widget: Rect, area: Rect, anchor: Rect, size: { width: number; height: number }, zoom = 1): Rect {
  const margin = TIP_MARGIN * zoom;
  const gap = TIP_GAP * zoom;
  const width = Math.ceil(size.width + margin * 2);
  const height = Math.ceil(size.height + margin * 2);
  const outside = edge === 'left' ? widget.x + widget.width + gap - margin : widget.x - gap - width + margin;
  // 内側に入りきらないとき（ウィジェットが広い、モニターが狭い）は、作業領域の端で止める
  const x = clamp(outside, area.x - margin, area.x + area.width - width + margin);
  const y = clamp(widget.y + anchor.y - margin, area.y - margin, area.y + area.height - height + margin);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// ---- めくれと一覧のウィンドウ（flyout） ----

/** 一覧の幅 */
export const FLY_LIST_WIDTH = 300;
/** ウィジェットの端と一覧のすき間 */
export const FLY_GAP = 3;
/** 一覧の外側の、影を描く余白 */
export const FLY_SHADOW = 8;

/**
 * めくれと一覧のウィンドウを置く場所。カードの端（画面の内側の端）から外へ、作業領域の高さいっぱいに取る。
 * めくれはカードの端から伸び、一覧はウィジェットの端からすき間をあけて開くので、ウィンドウはその両方が入る幅にする。
 * 縦の位置は一覧の画面が決めるので、ウィンドウは動かさずに済む。top はカードの上端（ウィンドウの中の座標）、
 * inset はウィンドウのカード側の端から一覧までの距離。どれも画面の座標
 * @param anchor カード（ウィジェットの中の、画面の座標）
 * @param zoom 表示の拡大率。一覧の幅とすき間（CSS px）を画面の座標にするのに使う
 */
export function flyoutBounds(edge: 'left' | 'right', widget: Rect, area: Rect, anchor: Rect, zoom = 1): { bounds: Rect; top: number; inset: number } {
  // ウィジェットが右端なら、カードの左端から左へ。左端なら、カードの右端から右へ
  const inset = Math.round((edge === 'right' ? anchor.x : widget.width - (anchor.x + anchor.width)) + FLY_GAP * zoom);
  const width = inset + Math.ceil((FLY_LIST_WIDTH + FLY_SHADOW) * zoom);
  const x = edge === 'right' ? widget.x + anchor.x - width : widget.x + anchor.x + anchor.width;
  return {
    bounds: { x: Math.round(x), y: area.y, width, height: area.height },
    top: Math.round(widget.y + anchor.y - area.y),
    inset,
  };
}

/** 点が四角の中にあるか */
export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/**
 * カーソルがどこにいるか。solid はめくれと一覧（ウィンドウの中の座標）、hit は重なりの的とめくれが飛び出す所（画面の座標）。
 * 的はカードの中へ少しかかっていて、めくれのウィンドウの外にある。ウィジェット側からゆっくり乗せたときもめくれを消さないよう、両方を見る
 */
export function inHoverZone(
  cursor: { x: number; y: number },
  win: Rect,
  solid: Rect[],
  hit: Rect[],
): { solid: boolean; hit: boolean } {
  return {
    solid: solid.some((r) => contains(r, cursor.x - win.x, cursor.y - win.y)),
    hit: hit.some((r) => contains(r, cursor.x, cursor.y)),
  };
}
