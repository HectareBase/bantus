// HTML ビューア（docs/design/html-viewer.md）。ウィジェットの下の場所に、WebContentsView を重ねて HTML を出す。
// iframe は使わない（表示した HTML のスクリプトから preload の API に手が届いてしまうため）。
// ビューは作業フォルダごとに作って残し、切り替えでは表示と非表示を入れ替えるだけにする（スクロールの位置が残る）。

import { session, shell, WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from 'electron';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TipRect, ViewerState } from '../shared/types';
import type { ViewerTarget } from './viewer-target';

/** 残しておくビューの数。あふれたものはスクロールの位置を覚えてから閉じる */
export const VIEWER_KEEP = 4;
/** ファイルが変わってから読み込み直すまでの待ち（保存が何回かに分かれても 1 回にまとめる） */
const RELOAD_DELAY_MS = 300;
/** 閉じたビューのスクロールの位置を覚えておく数 */
const SCROLL_MEMORY = 32;
/** 保存しないパーティション（ほかのウィンドウとクッキーやストレージを分ける。persist: を付けないのでディスクに書かない） */
const PARTITION = 'viewer';
/** スクロールの読み書きは隔離した世界で動かす（ページのスクリプトが scrollTo などを書き換えていても影響されない） */
const WORLD_ID = 1001;

interface Scroll {
  x: number;
  y: number;
}

interface Entry {
  key: string;
  file: string;
  dir: string;
  view: WebContentsView;
  watcher?: FSWatcher;
  reloadTimer?: NodeJS.Timeout;
  /** 次に読み込み終えたときに戻すスクロールの位置 */
  pendingScroll?: Scroll;
}

export interface ViewerDeps {
  window: () => BrowserWindow | undefined;
  /** 表示の拡大率（1 で等倍）。画面から届く座標（CSS px）にかける */
  zoom: () => number;
  /** 様子が変わったとき（画面に送る） */
  onState: (state: ViewerState) => void;
  /** ファイルが消えたり現れたりしたときに、出すものを決め直してもらう */
  refresh: () => void;
}

export interface Viewer {
  /** 出すものと、残してよいビューの目印を当てる。force なら様子が同じでも送る */
  update(target: ViewerTarget, liveKeys: ReadonlySet<string>, autoReload: boolean, force?: boolean): void;
  /** HTML を出す場所（ウィジェットの中の座標、CSS px）。undefined で隠す */
  setBounds(rect: TipRect | undefined): void;
  /** 拡大率が変わったとき */
  applyZoom(): void;
  /** 今のファイルを読み込み直す（スクロールの位置は保つ） */
  reload(): void;
  /** 今のファイルをいつものブラウザーで開く */
  openExternal(): void;
}

/** http(s) のリンクだけを、いつものブラウザーに渡す */
function openIfWeb(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url);
  } catch {
    // URL でなければ何もしない
  }
}

let partitionReady = false;

/** パーティションの決まり：権限の要求はすべて断る。ダウンロードもさせない */
function preparePartition() {
  if (partitionReady) return;
  partitionReady = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
}

/** 表示した HTML にさせないこと：ページの移動（http(s) ならブラウザーに渡す）、新しいウィンドウ、webview */
function guard(wc: WebContents) {
  wc.on('will-navigate', (e, url) => {
    e.preventDefault();
    openIfWeb(url);
  });
  wc.on('will-redirect', (e) => e.preventDefault());
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    openIfWeb(url);
    return { action: 'deny' };
  });
}

async function readScroll(wc: WebContents): Promise<Scroll | undefined> {
  if (wc.isDestroyed()) return undefined;
  try {
    const r: unknown = await wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: '[window.scrollX, window.scrollY]' }]);
    if (Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === 'number' && Number.isFinite(n))) return { x: r[0], y: r[1] };
  } catch {
    // 読み込みの途中などで読めなければ、戻さない
  }
  return undefined;
}

/**
 * スクロールの位置を戻す。中身が後から描かれるページもあるので、高さが足りるまで何度か試す（最大 3 秒）。
 * 縦のスクロールバーの分だけ scrollWidth が innerWidth より小さくなることがあるので、はみ出しの量は 0 で下を切る
 */
function restoreScroll(wc: WebContents, { x, y }: Scroll) {
  const code = `(async () => {
    const x = ${Math.max(0, Math.round(x))}, y = ${Math.max(0, Math.round(y))};
    for (let i = 0; i < 30; i++) {
      const el = document.scrollingElement || document.documentElement;
      if (Math.max(0, el.scrollHeight - innerHeight) >= y && Math.max(0, el.scrollWidth - innerWidth) >= x) { scrollTo(x, y); return; }
      await new Promise((r) => setTimeout(r, 100));
    }
    scrollTo(x, y);
  })()`;
  wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }]).catch(() => {});
}

export function createViewer(deps: ViewerDeps): Viewer {
  /** 作業フォルダの目印 → ビュー。並びは使った順（最後が最近） */
  const entries = new Map<string, Entry>();
  /** 閉じたビューのスクロールの位置（作業フォルダの目印 → ファイルと位置） */
  const scrolls = new Map<string, Scroll & { file: string }>();
  let current: Entry | undefined;
  /** HTML を出す場所（CSS px） */
  let rect: TipRect | undefined;
  let autoReload = true;
  let lastState = '';

  function bounds(r: TipRect): Rectangle {
    const z = deps.zoom();
    const x = Math.round(r.x * z);
    const y = Math.round(r.y * z);
    return { x, y, width: Math.max(0, Math.round((r.x + r.width) * z) - x), height: Math.max(0, Math.round((r.y + r.height) * z) - y) };
  }

  function layout() {
    for (const e of entries.values()) {
      const show = e === current && rect !== undefined;
      if (show) e.view.setBounds(bounds(rect!));
      e.view.setVisible(show);
    }
  }

  function remember(key: string, file: string, pos: Scroll | undefined) {
    scrolls.delete(key);
    if (!pos) return;
    scrolls.set(key, { file, ...pos });
    while (scrolls.size > SCROLL_MEMORY) scrolls.delete(scrolls.keys().next().value!);
  }

  function stopWatching(e: Entry) {
    e.watcher?.close();
    e.watcher = undefined;
    clearTimeout(e.reloadTimer);
    e.reloadTimer = undefined;
  }

  /** ファイルの入ったフォルダを見張る（エディターは保存のときにファイルを置き換えることがあり、ファイルそのものを見張ると途切れる） */
  function startWatching(e: Entry) {
    if (e.watcher) return;
    const name = basename(e.file).toLowerCase();
    try {
      e.watcher = watch(dirname(e.file), (_event, changed) => {
        if (changed && changed.toString().toLowerCase() !== name) return;
        clearTimeout(e.reloadTimer);
        e.reloadTimer = setTimeout(() => {
          e.reloadTimer = undefined;
          if (entries.get(e.key) !== e) return;
          if (existsSync(e.file)) void reloadEntry(e);
          // 消えた・現れたを表示に出す
          deps.refresh();
        }, RELOAD_DELAY_MS);
      });
      e.watcher.on('error', () => stopWatching(e));
    } catch {
      // 見張れなくても表示はする
    }
  }

  /** ビューを閉じる。keepScroll なら、閉じる前にスクロールの位置を覚える（あふれて閉じるとき） */
  function close(e: Entry, keepScroll: boolean) {
    entries.delete(e.key);
    if (current === e) current = undefined;
    stopWatching(e);
    e.view.setVisible(false);
    const finish = () => {
      const win = deps.window();
      if (win && !win.isDestroyed()) win.contentView.removeChildView(e.view);
      if (!e.view.webContents.isDestroyed()) e.view.webContents.close();
    };
    if (!keepScroll) {
      scrolls.delete(e.key);
      finish();
      return;
    }
    void readScroll(e.view.webContents).then((pos) => {
      remember(e.key, e.file, pos);
      finish();
    });
  }

  function create(key: string, file: string, dir: string): Entry | undefined {
    const win = deps.window();
    if (!win || win.isDestroyed()) return undefined;
    preparePartition();
    const view = new WebContentsView({
      // preload は付けない。表示した HTML から Node や Bantus の API には届かない
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false },
    });
    // 背景のない HTML でも、ウィジェットの背景が透けて読みにくくならないようにする
    view.setBackgroundColor('#ffffff');
    const saved = scrolls.get(key);
    scrolls.delete(key);
    const e: Entry = { key, file, dir, view };
    if (saved && saved.file === file) e.pendingScroll = { x: saved.x, y: saved.y };
    const wc = view.webContents;
    guard(wc);
    wc.on('did-finish-load', () => {
      wc.setZoomFactor(deps.zoom());
      const pos = e.pendingScroll;
      e.pendingScroll = undefined;
      if (pos) restoreScroll(wc, pos);
    });
    // ウィンドウに足してから隠す。足す前に隠すと、あとで出してもページが隠れたまま（描かれない）になる
    win.contentView.addChildView(view);
    view.setVisible(false);
    wc.loadFile(file).catch(() => {});
    if (autoReload) startWatching(e);
    return e;
  }

  async function reloadEntry(e: Entry) {
    const wc = e.view.webContents;
    const pos = await readScroll(wc);
    if (entries.get(e.key) !== e || wc.isDestroyed()) return;
    if (pos) e.pendingScroll = pos;
    wc.reloadIgnoringCache();
  }

  function sendState(state: ViewerState, force: boolean) {
    const json = JSON.stringify(state);
    if (!force && json === lastState) return;
    lastState = json;
    deps.onState(state);
  }

  return {
    update(target, liveKeys, nextAutoReload, force = false) {
      // ワークツリーが消えた、カードをアーカイブした、ビューアを止めたものは閉じる
      for (const e of [...entries.values()]) {
        if (!liveKeys.has(e.key) || !existsSync(e.dir)) close(e, false);
      }
      if (nextAutoReload !== autoReload) {
        autoReload = nextAutoReload;
        for (const e of entries.values()) (autoReload ? startWatching : stopWatching)(e);
      }
      let next: Entry | undefined;
      if (target.state.kind === 'ok' && target.key && target.file && target.dir) {
        next = entries.get(target.key);
        // 設定のパスが変わった
        if (next && next.file.toLowerCase() !== target.file.toLowerCase()) {
          close(next, false);
          next = undefined;
        }
        if (next) {
          // 使った順の最後へ
          entries.delete(next.key);
          entries.set(next.key, next);
        } else {
          next = create(target.key, target.file, target.dir);
          if (next) entries.set(next.key, next);
        }
        // あふれた分を、古いほうから閉じる
        for (const e of [...entries.values()]) {
          if (entries.size <= VIEWER_KEEP) break;
          if (e !== next) close(e, true);
        }
      }
      current = next;
      layout();
      sendState(target.state, force);
    },
    setBounds(r) {
      rect = r;
      layout();
    },
    applyZoom() {
      for (const e of entries.values()) if (!e.view.webContents.isDestroyed()) e.view.webContents.setZoomFactor(deps.zoom());
      layout();
    },
    reload() {
      if (current) void reloadEntry(current);
    },
    openExternal() {
      if (current) void shell.openExternal(pathToFileURL(current.file).href);
    },
  };
}
