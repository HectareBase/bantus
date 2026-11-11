// アイランド型の縁取り（bezel.ts）の形の計算。Electron を使わない、純粋な計算だけを置く（テストするため）。
//
// 最前面に固定している間、帯（ウィジェット）のない 3 辺（上の辺、下の辺、反対側の辺）にも、作業領域の端に沿って黒い線を引く。
// 画面の端に接したウィンドウ（最大化やスナップ）の端に Windows が描く明るい枠の線を覆って隠し、
// 反対側の上下の角には、帯の角と同じ内向きの角丸を付ける（画面全体がベゼルの内側に丸く収まって見える）。
// 帯の側の角丸と線は、ウィジェットのウィンドウが描く（styles.css の html.island）。

import type { Edge, Rect } from './appbar-place';

/**
 * 縁取りの 1 枚。rect はウィンドウの場所（画面の座標、DIP）、shape はその中で黒く塗る所（ウィンドウの中の座標、DIP）。
 * 窓は透明にしてあり、shape の外は描かれずクリックも通る
 */
export interface BezelPart {
  name: 'top' | 'bottom' | 'far';
  rect: Rect;
  shape: Rect[];
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
 * 縁取りの 3 枚。edge はウィジェットを置いた端、area は作業領域（帯の分は引かれている。DIP）、
 * radius は角丸の半径、line は線の太さ（どちらも DIP）。角丸は線の内側の角につなぐ。
 * 作業領域が角丸を描けないほど小さいときは何も返さない
 */
export function bezelParts(edge: Edge, area: Rect, radius: number, line: number): BezelPart[] {
  const r = Math.max(1, Math.round(radius));
  const l = Math.max(1, Math.round(line));
  // 角の箱（線の分を含む）
  const corner = r + l;
  if (area.width < corner * 2 || area.height < corner * 2) return [];
  const w = area.width;
  // 窓の高さ（上と下の辺）と幅（反対側の辺）。角の箱より大きく、Windows の最小の大きさより大きく取る
  const t = Math.max(corner, BEZEL_WINDOW);
  const rows = filletRows(r);
  // 反対側の角。左に帯があれば右の角、右に帯があれば左の角
  const farRight = edge === 'left';
  const filletRect = (y: number, width: number): Rect => (farRight ? { x: w - width, y, width, height: 1 } : { x: 0, y, width, height: 1 });
  const top: Rect[] = [{ x: 0, y: 0, width: w, height: l }];
  // 下の辺の窓は下の端にそろえて置くので、線と角丸は窓の下の端から描く
  const bottom: Rect[] = [{ x: 0, y: t - l, width: w, height: l }];
  rows.forEach((width, i) => {
    // 角丸の行は、反対側の線の分（l）も続けて塗る。円の下の端の近くは角丸の幅が 0 になり、線の太さだけが残る
    const wide = width + l;
    // 上の辺の角は、上の線のすぐ下から、箱の上の行ほど広い（rows はそのまま）。下の辺の角は上下を返す
    top.push(filletRect(l + i, wide));
    bottom.push(filletRect(t - 1 - l - i, wide));
  });
  const farHeight = area.height - corner * 2;
  return [
    { name: 'top', rect: { x: area.x, y: area.y, width: w, height: t }, shape: top },
    { name: 'bottom', rect: { x: area.x, y: area.y + area.height - t, width: w, height: t }, shape: bottom },
    {
      name: 'far',
      rect: { x: farRight ? area.x + w - t : area.x, y: area.y + corner, width: t, height: farHeight },
      shape: [{ x: farRight ? t - l : 0, y: 0, width: l, height: farHeight }],
    },
  ];
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
