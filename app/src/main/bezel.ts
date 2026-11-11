// アイランド型の縁取り（形は bezel-place.ts）。帯のない 3 辺に、黒い線と反対側の角丸を出す。
//
// 負荷を抑えるため、Web のページを持たない BaseWindow を使う（描画のプロセスを起こさない）。
// 窓は透明にし、黒い所の形を setShape で切り出す（形の中だけを背景色の黒で塗る）。形の外は描かれない。
// 透明にしないと、setShape の外も Windows の既定の灰色で塗られて見えた。窓は細い帯なので、透明の合成の負荷は小さい。
// 線の上のクリックも通すよう、setIgnoreMouseEvents(true) にする。ほかのウィンドウの前に出し、フォーカスは取らない。
// 窓は 3 枚を作り置き、場所と形だけを変える（出し入れのたびに作り直さない）。

import { BaseWindow } from 'electron';
import type { BezelPart } from './bezel-place';

export interface Bezel {
  /** 縁取りを出す（parts が空なら隠す） */
  show(parts: BezelPart[]): void;
  hide(): void;
  /** 窓を閉じる（終了するとき） */
  destroy(): void;
}

/** Windows 以外では何もしないものを返す（setShape は Windows と Linux だけ） */
export function createBezel(): Bezel {
  if (process.platform !== 'win32') return { show: () => {}, hide: () => {}, destroy: () => {} };
  const windows = new Map<BezelPart['name'], BaseWindow>();
  /** 最後に当てた場所と形。同じなら当て直さない（ちらつかせない） */
  const applied = new Map<BezelPart['name'], string>();

  function windowFor(name: BezelPart['name']): BaseWindow {
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
      backgroundColor: '#000000',
    });
    w.setIgnoreMouseEvents(true);
    windows.set(name, w);
    applied.delete(name);
    return w;
  }

  function hide() {
    for (const [name, w] of windows) {
      if (w.isDestroyed() || !w.isVisible()) continue;
      w.hide();
      // 出し直すときに、場所と形を当て直す
      applied.delete(name);
    }
  }

  function show(parts: BezelPart[]) {
    if (parts.length === 0) return hide();
    for (const part of parts) {
      const w = windowFor(part.name);
      if (!w.isVisible()) w.showInactive();
      const key = JSON.stringify([part.rect, part.shape]);
      if (applied.get(part.name) !== key) {
        w.setBounds(part.rect);
        w.setShape(part.shape);
        applied.set(part.name, key);
      }
      // ウィジェットと同じ高さの最前面。出し直すたびに前へ戻す
      w.moveTop();
    }
  }

  function destroy() {
    for (const w of windows.values()) if (!w.isDestroyed()) w.destroy();
    windows.clear();
  }

  return { show, hide, destroy };
}
