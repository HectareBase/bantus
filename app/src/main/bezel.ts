// アイランド型の縁取り（形は bezel-place.ts）。帯のない 3 辺に、黒い線と反対側の角丸を出す。
//
// 負荷を抑えるため、Web のページを持たない BaseWindow を使う（描画のプロセスを起こさない）。
// 窓は透明にし、黒い所の形を setShape で切り出す（形の中だけを背景色の黒で塗る）。形の外は描かれない。
// 透明にしないと、setShape の外も Windows の既定の灰色で塗られて見えた。窓は細い帯なので、透明の合成の負荷は小さい。
// 線の上のクリックも通すよう、setIgnoreMouseEvents(true) にする。ほかのウィンドウの前に出し、フォーカスは取らない。
// 窓は 3 枚。隠すときは hide するだけで、場所か形が変わったときだけ作り直す。
// 作った窓の場所と大きさを setBounds で変えると、Windows の窓の最小の大きさ（高さ 38 DIP ほど）に引っかかり、
// 広げられなかったり、下の辺の窓が上へずれたりした。作った直後の 1 回目の setBounds は思ったとおりに置けるので、作り直す。
// Web のページを持たない窓なので、作り直しは軽い。
// 反対側の角は、角丸の絵（cornerBitmap）を ImageView で貼る（縁を半透明にしてなめらかにする。描画のプロセスは増えない）。
// その窓は形を切らず、背景も透明にする（絵の透けた所がそのまま透ける）。ImageView は試験的な機能なので、ないときは形の段で描く。

import * as electron from 'electron';
import { BaseWindow, nativeImage } from 'electron';
import { cornerBitmap, type BezelPart } from './bezel-place';

/** ImageView（試験的な機能）。なくなっていれば undefined */
const ImageView: typeof electron.ImageView | undefined = (electron as Partial<typeof electron>).ImageView;

export interface Bezel {
  /** 縁取りを出す（parts が空なら隠す）。scale は画面の拡大率（角丸の絵を物理ピクセルの細かさで描く） */
  show(parts: BezelPart[], scale: number): void;
  hide(): void;
  /**
   * 窓を閉じ、次の show で作り直す。Windows の拡大率が変わると、Windows が窓の大きさを新しい拡大率に合わせて変えてしまい、
   * 場所と形が同じなら置き直さないので、ずれたまま残った
   */
  reset(): void;
  /** 窓を閉じる（終了するとき） */
  destroy(): void;
}

/** Windows 以外では何もしないものを返す（setShape は Windows と Linux だけ） */
export function createBezel(): Bezel {
  if (process.platform !== 'win32') return { show: () => {}, hide: () => {}, reset: () => {}, destroy: () => {} };
  const windows = new Map<BezelPart['name'], BaseWindow>();
  /** 最後に当てた場所と形。同じなら当て直さない（ちらつかせない） */
  const applied = new Map<BezelPart['name'], string>();

  function windowFor(name: BezelPart['name'], picture: boolean): BaseWindow {
    let w = windows.get(name);
    if (w && !w.isDestroyed()) return w;
    w = new BaseWindow({
      show: false,
      frame: false,
      // 枠のない窓に Windows が付ける見えない縁（大きさを変える所）を付けない。付けると、置いた場所から線がずれる
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      transparent: true,
      alwaysOnTop: true,
      // 形で切る窓は、形の中を背景の黒で塗る。絵を貼る窓は背景を塗らない
      backgroundColor: picture ? '#00000000' : '#000000',
    });
    w.setIgnoreMouseEvents(true);
    windows.set(name, w);
    applied.delete(name);
    return w;
  }

  function hide() {
    for (const w of windows.values()) {
      if (w.isDestroyed() || !w.isVisible()) continue;
      w.hide();
    }
  }

  function show(parts: BezelPart[], scale: number) {
    if (parts.length === 0) return hide();
    for (const part of parts) {
      const picture = part.corner !== undefined && ImageView !== undefined;
      const key = JSON.stringify(picture ? [part.rect, part.corner, scale] : [part.rect, part.shape]);
      if (applied.has(part.name) && applied.get(part.name) !== key) {
        // 場所か形が変わった。置き直さずに作り直す
        windows.get(part.name)?.destroy();
        windows.delete(part.name);
      }
      const w = windowFor(part.name, picture);
      // 出す前に置いて形を切る（作ったばかりの窓を先に出すと、既定の大きさの黒い四角が一瞬見える）
      if (applied.get(part.name) !== key) {
        w.setBounds(part.rect);
        if (picture && ImageView && part.corner) {
          const size = Math.round(part.corner.box.width * scale);
          const image = nativeImage.createFromBitmap(cornerBitmap(part.corner, size, scale), { width: size, height: size, scaleFactor: scale });
          const view = new ImageView();
          view.setImage(image);
          view.setBounds(part.corner.box);
          w.contentView.addChildView(view);
        } else w.setShape(part.shape);
        applied.set(part.name, key);
      }
      if (!w.isVisible()) w.showInactive();
      // ウィジェットと同じ高さの最前面。出し直すたびに前へ戻す
      w.moveTop();
    }
  }

  function destroy() {
    for (const w of windows.values()) if (!w.isDestroyed()) w.destroy();
    windows.clear();
    applied.clear();
  }

  return { show, hide, reset: destroy, destroy };
}
