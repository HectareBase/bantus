// アプリバー（appbar.ts）の場所の計算。Electron も PowerShell も使わない、純粋な計算だけを置く（テストするため）。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Edge = 'left' | 'right';

/** SHAppBarMessage の矩形（left, top, right, bottom） */
export interface Ltrb {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 登録しているアプリバー。rect は画面の座標（DIP）、edge は登録した端 */
export interface PlacedBar {
  edge: Edge;
  rect: Rect;
}

/** ABE_LEFT と ABE_RIGHT */
export function abEdge(edge: Edge): number {
  return edge === 'left' ? 0 : 2;
}

export function toLtrb(r: Rect): Ltrb {
  return { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
}

export function fromLtrb(r: Ltrb): Rect {
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/**
 * ABM_QUERYPOS に渡す最初の案。モニター全体（作業領域ではない）の端に、幅 width の帯を取る。
 * タスクバーやほかのアプリバーとの重なりは、シェルが QUERYPOS で削る（Microsoft の例と同じ手順）
 */
export function proposeRect(edge: Edge, monitor: Ltrb, width: number): Ltrb {
  return edge === 'left'
    ? { ...monitor, right: monitor.left + width }
    : { ...monitor, left: monitor.right - width };
}

/** QUERYPOS で動かされた矩形を、端の側を基準に幅 width に戻す（ABM_SETPOS に渡す） */
export function fitWidth(edge: Edge, queried: Ltrb, width: number): Ltrb {
  return edge === 'left'
    ? { ...queried, right: queried.left + width }
    : { ...queried, left: queried.right - width };
}

export function sameLtrb(a: Ltrb | undefined, b: Ltrb | undefined): boolean {
  return !!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

/** 2 つの四角が重なるか */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * ウィジェットの場所を決めるのに使う作業領域。アプリバーとして登録すると、Windows の作業領域（display.workArea）から
 * ウィジェット自身の分が引かれるので、そのモニターにあるアプリバーの分を足し戻す（登録する前と同じ広さにする）。
 * アプリバーがほかのモニターにあるとき（モニターを変えた直後など）は、作業領域をそのまま返す
 */
export function areaWithoutBar(workArea: Rect, monitor: Rect, bar: PlacedBar | undefined): Rect {
  if (!bar || !overlaps(bar.rect, monitor)) return workArea;
  const left = Math.min(workArea.x, bar.rect.x);
  const right = Math.max(workArea.x + workArea.width, bar.rect.x + bar.rect.width);
  return { x: left, y: workArea.y, width: right - left, height: workArea.height };
}

/**
 * ウィジェットの場所。縦は作業領域いっぱい。横は、同じ端にアプリバーを登録しているなら、シェルが決めた帯の端の側にそろえる
 * （ほかのアプリバーが同じ端にあると、帯は画面の端から内側へずれる）。そうでなければ作業領域の端に置く。
 * 幅は width（ドラッグ中は帯が追いつくまで帯と食い違うが、ウィジェットはカーソルにすぐ付いていく）
 */
export function placeWidget(edge: Edge, area: Rect, width: number, bar: PlacedBar | undefined): Rect {
  const own = bar && bar.edge === edge && overlaps(bar.rect, area) ? bar.rect : undefined;
  let x: number;
  if (edge === 'left') x = own ? own.x : area.x;
  else x = (own ? own.x + own.width : area.x + area.width) - width;
  return { x, y: area.y, width, height: area.height };
}

/**
 * ウィンドウのうち、アプリバーとして画面の幅を取らない分（DIP）。アイランド型では、ウィンドウの内側の端に角丸と縁の線を描く透明な列があり
 * （styles.css の --island-col。角丸の半径と線の太さの和）、そこまで取ると最大化したウィンドウとのあいだに列の幅の隙間ができる。
 * 列は隣のウィンドウに重ね（クリックは後ろへ通す）、アプリバーは帯の幅だけを取る。拡大率をかけると CSS px が DIP で大きくなるので、zoom（1 で等倍）をかける
 */
export function barOverhang(s: { island: boolean; islandRadius: number; islandLine: number }, zoom: number): number {
  return s.island ? Math.round((s.islandRadius + s.islandLine) * zoom) : 0;
}
