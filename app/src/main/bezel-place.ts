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
 * 線の太さ（DIP）。隣のウィンドウの枠の線は物理ピクセルで 1px。形は DIP の整数でしか渡せないので 1 にする
 * （拡大率 100% 以上では 1 物理ピクセル以上になり、枠の線を覆える）
 */
export const BEZEL_LINE = 1;

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
 * 縁取りの 3 枚。edge はウィジェットを置いた端、area は作業領域（帯の分は引かれている。DIP）、radius は角丸の半径（DIP）。
 * 作業領域が角丸を描けないほど小さいときは何も返さない
 */
export function bezelParts(edge: Edge, area: Rect, radius: number): BezelPart[] {
  const r = Math.max(1, Math.round(radius));
  if (area.width < r * 2 || area.height < r * 2) return [];
  const w = area.width;
  const rows = filletRows(r);
  // 反対側の角の箱。左に帯があれば右の角、右に帯があれば左の角
  const farRight = edge === 'left';
  const filletRect = (y: number, width: number): Rect => (farRight ? { x: w - width, y, width, height: 1 } : { x: 0, y, width, height: 1 });
  const top: Rect[] = [{ x: 0, y: 0, width: w, height: BEZEL_LINE }];
  const bottom: Rect[] = [{ x: 0, y: r - BEZEL_LINE, width: w, height: BEZEL_LINE }];
  rows.forEach((width, i) => {
    // 円の下の端の近くは幅が 0 になるが、反対側の線は角の箱の中も通す（線の太さは塗る）。そうしないと線との間にすき間が空く
    const wide = Math.max(width, BEZEL_LINE);
    // 上の辺の角は、箱の上の行ほど広い（rows はそのまま）。下の辺の角は上下を返す
    top.push(filletRect(i, wide));
    bottom.push(filletRect(r - 1 - i, wide));
  });
  const farHeight = area.height - r * 2;
  return [
    { name: 'top', rect: { x: area.x, y: area.y, width: w, height: r }, shape: top },
    { name: 'bottom', rect: { x: area.x, y: area.y + area.height - r, width: w, height: r }, shape: bottom },
    {
      name: 'far',
      rect: { x: farRight ? area.x + w - BEZEL_LINE : area.x, y: area.y + r, width: BEZEL_LINE, height: farHeight },
      shape: [{ x: 0, y: 0, width: BEZEL_LINE, height: farHeight }],
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
