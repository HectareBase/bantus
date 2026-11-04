// めくれと一覧のウィンドウ（flyout.html）。ウィジェットの外（画面の内側）に、透明なウィンドウを 1 つだけ作って使い回す。
// 置き方と動かし方は docs/design/worktree-cards.md の「ウィンドウの作り」。
// - ふだんはフォーカスを取らない。押して一覧を開いたときだけ取り、外のクリック（blur）と Esc で閉じる
// - めくれと一覧の上だけクリックを受け取り、ほかは下（ウィジェットや後ろのウィンドウ）へ通す
// - めくれを出している間だけカーソルの位置を見て、めくれから外れたらすぐ消す（動きは付けない）

import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import type { FlyAction, FlyContent, FlyRequest, FlyShow, TipRect } from '../shared/types';
import { contains, flyoutBounds, type Rect } from './tip-place';

/** めくれを出している間に、カーソルの位置を見る間隔 */
const POLL_MS = 30;

export interface FlyoutDeps {
  preload: string;
  web: string;
  widget: () => BrowserWindow | undefined;
  edge: () => 'left' | 'right';
  area: () => Rect;
  /** 一覧の中の操作を、ウィジェットの画面へ渡す */
  onAction: (action: FlyAction) => void;
  /** 出しているもの（消えたら undefined）と、一覧を開いているか */
  onState: (key: string | undefined, open: boolean) => void;
}

export interface Flyout {
  show(request: FlyRequest): void;
  update(key: string, content: FlyContent, count: number): void;
  leave(key: string): void;
  hide(): void;
  window(): BrowserWindow;
  reload(): void;
}

export function isFlyRequest(v: unknown): v is FlyRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.key === 'string' && typeof r.count === 'number' && typeof r.open === 'boolean' && isRect(r.anchor) && isContent(r.content);
}

export function isContent(v: unknown): v is FlyContent {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (c.kind === 'timeline' || c.kind === 'plain') ? Array.isArray(c.items) : c.kind === 'cards' && Array.isArray(c.cards);
}

function isRect(v: unknown): v is TipRect {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

function isAction(v: unknown): v is FlyAction {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (a.type === 'open' || a.type === 'toggle') return typeof a.id === 'string';
  return a.type === 'toggle-card' && typeof a.key === 'string';
}

export function createFlyout(deps: FlyoutDeps): Flyout {
  const win = new BrowserWindow({
    width: 340,
    height: 600,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    // 隠れている間も描き終えて知らせられるようにする
    webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.loadFile(join(deps.web, 'flyout.html'));

  /** 出している（出そうとしている）もの */
  let key: string | undefined;
  let open = false;
  /** 中身を描き終え、見せてよいか（描き終えるまでは見せない。古い中身が一瞬見えないように） */
  let ready = false;
  /** クリックを受け取る場所（ウィンドウの中の座標） */
  let solid: TipRect[] = [];
  let ignoring: boolean | undefined;
  let poll: NodeJS.Timeout | undefined;
  /** フォーカスを取れなかったときだけ、開いている間 Esc を登録する */
  let escRegistered = false;

  function setIgnore(value: boolean) {
    if (value === ignoring) return;
    ignoring = value;
    win.setIgnoreMouseEvents(value, { forward: true });
  }

  function tick() {
    if (!key || !win.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = solid.some((r) => contains(r, c.x - b.x, c.y - b.y));
    setIgnore(!inside);
    // めくれだけのときは、外れたらすぐ消す。めくれの場所がまだ届いていなければ待つ
    if (!open && solid.length && !inside) hide();
  }

  function startPoll() {
    clearInterval(poll);
    poll = setInterval(tick, POLL_MS);
  }

  function hide() {
    clearInterval(poll);
    poll = undefined;
    const had = key !== undefined;
    key = undefined;
    open = false;
    ready = false;
    solid = [];
    if (escRegistered) {
      globalShortcut.unregister('Escape');
      escRegistered = false;
    }
    if (!win.isDestroyed()) {
      win.hide();
      win.setFocusable(false);
      win.webContents.send('fly:hide');
    }
    if (had) deps.onState(undefined, false);
  }

  /** 押して一覧を開いたときだけフォーカスを取る（Esc と外のクリックで閉じるため） */
  function takeFocus() {
    win.setFocusable(true);
    win.focus();
    setTimeout(() => {
      if (!open || win.isDestroyed() || win.isFocused() || escRegistered) return;
      // Windows が前面に出すのを断ったときは、開いている間だけ Esc を受け取る
      escRegistered = globalShortcut.register('Escape', () => hide());
    }, 100);
  }

  function setOpen() {
    if (!key || open) return;
    open = true;
    takeFocus();
    deps.onState(key, true);
  }

  win.on('blur', () => {
    if (open) hide();
  });

  ipcMain.on('fly:solid', (e, rects: unknown) => {
    if (e.sender !== win.webContents || !key) return;
    if (!Array.isArray(rects) || !rects.every(isRect)) return;
    solid = rects;
    if (!ready) {
      ready = true;
      win.showInactive();
      startPoll();
      if (open) takeFocus();
    }
    tick();
  });
  ipcMain.on('fly:request-open', (e) => {
    if (e.sender !== win.webContents || !key) return;
    setOpen();
    win.webContents.send('fly:open');
  });
  ipcMain.on('fly:action', (e, action: unknown) => {
    if (e.sender !== win.webContents || !isAction(action)) return;
    if (action.type === 'open') hide();
    deps.onAction(action);
  });
  ipcMain.on('fly:close', (e) => {
    if (e.sender === win.webContents) hide();
  });

  return {
    show(request) {
      // 開いている一覧があるときは、ほかの重なりに乗っても出さない（開けるのは 1 つだけ）。見出しから開くときは置き換える
      if (open && !request.open) return;
      if (key === request.key && !request.open) return;
      const widget = deps.widget();
      if (!widget || widget.isDestroyed()) return;
      if (key) hide();
      const edge = deps.edge();
      const { bounds, top } = flyoutBounds(edge, widget.getBounds(), deps.area(), request.anchor);
      key = request.key;
      open = request.open;
      ready = false;
      solid = [];
      win.setBounds(bounds);
      // 置いた直後はクリックを下へ通しておき、場所が届いてから受け取る
      ignoring = undefined;
      setIgnore(true);
      const show: FlyShow = {
        key: request.key,
        side: edge === 'right' ? 'left' : 'right',
        top,
        height: Math.round(request.anchor.height),
        count: request.count,
        content: request.content,
        open: request.open,
      };
      win.webContents.send('fly:show', show);
      deps.onState(key, open);
    },
    update(k, content, count) {
      if (k === key) win.webContents.send('fly:content', content, count);
    },
    leave(k) {
      // めくれを見せる前に重なりから外れたら、出すのをやめる。見せたあとはカーソルの位置で決める
      if (k === key && !ready && !open) hide();
    },
    hide,
    window: () => win,
    reload() {
      hide();
      win.webContents.reload();
    },
  };
}
