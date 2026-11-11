// アイランド型の縁取り（bezel.ts）の形の計算。Electron を使わない、純粋な計算だけを置く（テストするため）。
//
// 最前面に固定している間、帯（ウィジェット）のない 3 辺（上の辺、下の辺、反対側の辺）にも、作業領域の端に沿って黒い線を引く。
// 画面の端に接したウィンドウ（最大化やスナップ）の端に Windows が描く明るい枠の線を覆って隠し、
// 反対側の上下の角には、帯の角と同じ内向きの角丸を付ける（画面全体がベゼルの内側に丸く収まって見える）。
// 帯の側の角丸と線は、ウィジェットのウィンドウが描く（styles.css の html.island）。
//
// 線は窓の形（setShape）で切り出す。角丸は、縁をなめらかにするため、角の窓に半透明の絵（cornerBitmap）を貼る（bezel.ts の ImageView）。
// 窓の形には半透明がなく、1 DIP ごとの段になる（画面の拡大 125% では段の高さが 1 と 2 ピクセルで交じり、ぎざぎざが目立った）。
// ImageView が使えないとき（試験的な機能なので、なくなったとき）は、角の窓も形の段（shape）で描く。

import type { Edge, Rect } from './appbar-place';

/** 角の窓に貼る角丸の絵。box は窓の中で絵を置く所（DIP）。vertical と horizontal は、角が接する画面の端 */
export interface BezelCorner {
  vertical: 'top' | 'bottom';
  horizontal: 'left' | 'right';
  box: Rect;
  radius: number;
  line: number;
}

/**
 * 縁取りの 1 枚。rect はウィンドウの場所（画面の座標、DIP）、shape はその中で黒く塗る所（ウィンドウの中の座標、DIP）。
 * 窓は透明にしてあり、shape の外は描かれずクリックも通る。corner があれば、その絵を貼り、shape は絵が使えないときだけ使う
 */
export interface BezelPart {
  name: 'top' | 'bottom' | 'far' | 'topCorner' | 'bottomCorner';
  rect: Rect;
  shape: Rect[];
  corner?: BezelCorner;
}

/**
 * 縁取りの窓の短い辺の長さ（DIP）。Windows には窓の最小の大きさ（幅 29・高さ 38 DIP ほど）があり、
 * それより小さく置くと窓が広げられ、画面に収めるために内側へ押し出された（反対側の線が画面の端から 30px ほど内側に出た）。
 * 最小より大きく取り、線と角丸は窓の画面の端の側だけに塗る（残りは透明でクリックも通る）
 */
export const BEZEL_WINDOW = 40;

/**
 * 内向きの角丸を、横 1 行ずつの黒い帯で表す。返すのは、角の箱（radius × radius）の上から i 行目で、
 * 円の中心から遠い側の端から数えて黒く塗る幅。円の中心は箱の角（作業領域の内側の角）に置く。
 * 行の真ん中の高さで円の外側にある分を塗る（ぎざぎざは 1 行ごとの段になる。ウィンドウの形にはぼかしがない）
 */
export function filletRows(radius: number): number[] {
  const rows: number[] = [];
  for (let i = 0; i < radius; i++) {
    // 上から i 行目の真ん中の、円の中心（箱の下の角）からの高さ
    const dy = radius - (i + 0.5);
    const inside = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    rows.push(Math.max(0, Math.round(radius - inside)));
  }
  return rows;
}

/**
 * 縁取りの 5 枚（上の辺、下の辺、反対側の辺、反対側の上と下の角）。edge はウィジェットを置いた端、
 * area は作業領域（帯の分は引かれている。DIP）、radius は角丸の半径、line は線の太さ（どちらも DIP）。角丸は線の内側の角につなぐ。
 * 作業領域が角丸を描けないほど小さいときは何も返さない
 */
export function bezelParts(edge: Edge, area: Rect, radius: number, line: number): BezelPart[] {
  const r = Math.max(1, Math.round(radius));
  const l = Math.max(1, Math.round(line));
  // 角の箱（線の分を含む）
  const c = r + l;
  if (area.width < c * 2 || area.height < c * 2) return [];
  const w = area.width;
  // 窓の高さ（上と下の辺）と幅（反対側の辺、角）。角の箱より大きく、Windows の最小の大きさより大きく取る
  const t = Math.max(c, BEZEL_WINDOW);
  const rows = filletRows(r);
  // 反対側の角。左に帯があれば右の角、右に帯があれば左の角
  const farRight = edge === 'left';
  const cornerX = farRight ? area.x + w - t : area.x;
  const boxX = farRight ? t - c : 0;
  const filletRect = (y: number, width: number): Rect => (farRight ? { x: t - width, y, width, height: 1 } : { x: 0, y, width, height: 1 });
  // 絵が使えないときの角の段。角丸の行は、反対側の線の分（l）も続けて塗る。上の角は上の線のすぐ下から、下の角は上下を返す
  const topSteps = rows.map((width, i) => filletRect(l + i, width + l));
  const bottomSteps = rows.map((width, i) => filletRect(t - 1 - l - i, width + l));
  const corner = (vertical: 'top' | 'bottom'): BezelCorner => ({
    vertical,
    horizontal: farRight ? 'right' : 'left',
    box: { x: boxX, y: vertical === 'top' ? 0 : t - c, width: c, height: c },
    radius: r,
    line: l,
  });
  const farHeight = area.height - c * 2;
  return [
    // 下の辺の窓は下の端にそろえて置くので、線は窓の下の端に引く
    { name: 'top', rect: { x: area.x, y: area.y, width: w, height: t }, shape: [{ x: 0, y: 0, width: w, height: l }] },
    { name: 'bottom', rect: { x: area.x, y: area.y + area.height - t, width: w, height: t }, shape: [{ x: 0, y: t - l, width: w, height: l }] },
    {
      name: 'far',
      rect: { x: farRight ? area.x + w - t : area.x, y: area.y + c, width: t, height: farHeight },
      shape: [{ x: farRight ? t - l : 0, y: 0, width: l, height: farHeight }],
    },
    { name: 'topCorner', rect: { x: cornerX, y: area.y, width: t, height: t }, shape: topSteps, corner: corner('top') },
    { name: 'bottomCorner', rect: { x: cornerX, y: area.y + area.height - t, width: t, height: t }, shape: bottomSteps, corner: corner('bottom') },
  ];
}

/**
 * 角丸の絵（BGRA、色は黒で、不透明度だけを持つ。黒なので乗算済みでも同じ）。size は絵の 1 辺のピクセル数（物理ピクセル）、
 * scale は画面の拡大率（1 で等倍）。角の箱いっぱいに、画面の端の側の線（太さ line）と、線の内側の角につなぐ内向きの角丸（半径 radius）を描く。
 * 縁は 1 ピクセルを 4 × 4 に分けて、円の外側にある割合で塗る（なめらかにする）
 */
export function cornerBitmap(corner: Pick<BezelCorner, 'vertical' | 'horizontal' | 'radius' | 'line'>, size: number, scale: number): Buffer {
  const n = size;
  // 線は窓の形と同じく、物理ピクセルにそろえる
  const lp = Math.max(1, Math.round(corner.line * scale));
  const rp = corner.radius * scale;
  // 右上の角として描き、ほかの角は左右か上下を返す。円の中心は線の内側の角から半径だけ内側
  const cx = n - lp - rp;
  const cy = lp + rp;
  const black = (x: number, y: number) => y < lp || x > n - lp || (x > cx && y < cy && Math.hypot(x - cx, y - cy) > rp);
  const buf = Buffer.alloc(n * n * 4);
  const SUB = 4;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = corner.horizontal === 'right' ? x : n - 1 - x;
      const fy = corner.vertical === 'top' ? y : n - 1 - y;
      let hit = 0;
      for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) if (black(fx + (sx + 0.5) / SUB, fy + (sy + 0.5) / SUB)) hit++;
      buf[(y * n + x) * 4 + 3] = Math.round((hit / (SUB * SUB)) * 255);
    }
  }
  return buf;
}

/**
 * 縁取りを引く範囲（DIP）。上下と反対側の辺は作業領域から、帯の側の端は登録したアプリバー（bar）の内側の端から取る。
 * 幅を変えたりアイランド型を切り替えたりした直後は、アプリバーは動いても Electron の作業領域が古いままのことがあり、
 * 作業領域だけで決めると、帯の側の端が古い場所（角丸の列の分ずれた所など）に残った。
 * bar が別の端にあるとき（端を変えた直後）は作業領域のまま
 */
export function bezelArea(edge: Edge, workArea: Rect, bar: { edge: Edge; rect: Rect } | undefined): Rect {
  if (!bar || bar.edge !== edge) return workArea;
  const right = workArea.x + workArea.width;
  if (edge === 'left') {
    const x = bar.rect.x + bar.rect.width;
    return { x, y: workArea.y, width: Math.max(0, right - x), height: workArea.height };
  }
  const end = bar.rect.x;
  return { x: workArea.x, y: workArea.y, width: Math.max(0, end - workArea.x), height: workArea.height };
}
