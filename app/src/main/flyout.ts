// めくれと一覧のウィンドウ（flyout.html）。ウィジェットの外（画面の内側）に、透明なウィンドウを 1 つだけ作って使い回す。
// 置き方と動かし方は docs/design/worktree-cards.md の「ウィンドウの作り」。
// - 乗せただけではフォーカスを取らない（showInactive）。押して一覧を開いたときだけ取り、外のクリック（blur）と Esc で閉じる
// - めくれと一覧の上だけクリックを受け取り、ほかは下（ウィジェットや後ろのウィンドウ）へ通す
// - めくれを出している間だけカーソルの位置を見て、めくれから外れたらすぐ消す（動きは付けない）

import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import type { FlyAction, FlyContent, FlyRequest, FlyShow, TipRect } from '../shared/types';
import { contains, flyoutBounds, type Rect } from './tip-place';

/** めくれを出している間に、カーソルの位置を見る間隔 */
const POLL_MS = 30;
/** 見せる前に重なりから外れたとき、描き終わるのを待つ長さ */
const LEAVE_GRACE_MS = 200;
/** 外のクリックで閉じてから、同じものを開き直さない長さ */
const REOPEN_GUARD_MS = 400;
/** 出し入れの記録（FLY_DEBUG を付けたときだけ。docs/design/worktree-cards.md の「手で確かめること」） */
const dbg = (...a: unknown[]) => {
  if (process.env.FLY_DEBUG) console.log('[fly]', ...a);
};

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
    // フォーカスを取れるウィンドウにして showInactive() で出す。setFocusable で切り替えると、Windows では
    // そのあとクリックが下のウィンドウへ抜けるようになるので使わない。押したときは Windows が自然にフォーカスを移す
    focusable: true,
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
  /** 外のクリックで閉じたもの（同じ重なりを押して閉じたときに、開き直さないため） */
  let closedByBlur: { key: string; at: number } | undefined;

  function setIgnore(value: boolean) {
    if (value === ignoring) return;
    ignoring = value;
    dbg('ignore', value);
    win.setIgnoreMouseEvents(value, { forward: true });
  }

  function tick() {
    if (!key || !win.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = solid.some((r) => contains(r, c.x - b.x, c.y - b.y));
    // カーソルが入ったら一番上へ上げ直す。閉じたあと Windows がウィジェットを前に戻し、重なりの上のクリックを取られることがあるため
    if (inside && ignoring !== false) win.moveTop();
    setIgnore(!inside);
    // めくれだけのときは、外れたらすぐ消す。めくれの場所がまだ届いていなければ待つ
    if (!open && solid.length && !inside) hide();
  }

  function startPoll() {
    clearInterval(poll);
    poll = setInterval(tick, POLL_MS);
  }

  function hide() {
    dbg('hide', key, new Error().stack?.split('\n')[2]?.trim());
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
      win.webContents.send('fly:hide');
    }
    if (had) deps.onState(undefined, false);
  }

  /** 押して一覧を開いたときだけフォーカスを取る（Esc と外のクリックで閉じるため） */
  function takeFocus() {
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
    dbg('blur', open);
    if (!open) return;
    closedByBlur = { key: key!, at: Date.now() };
    hide();
  });

  ipcMain.on('fly:solid', (e, rects: unknown) => {
    if (e.sender !== win.webContents || !key) return;
    if (!Array.isArray(rects) || !rects.every(isRect)) return;
    solid = rects;
    if (!ready) {
      ready = true;
      // Windows では最前面のウィンドウどうしの上下が、最後に触ったもので決まる（Electron の高さの指定は効かない）。
      // ウィジェットを押したあとはウィジェットが上に来て、重なりの上のクリックを取られるので、見せるたびに一番上へ上げ直す
      win.setAlwaysOnTop(true, 'pop-up-menu');
      win.showInactive();
      win.moveTop();
      startPoll();
      if (open) takeFocus();
    }
    tick();
  });
  ipcMain.on('fly:request-open', (e) => {
    dbg('request-open', key, open);
    if (e.sender !== win.webContents || !key) return;
    setOpen();
    win.webContents.send('fly:open');
  });
  ipcMain.on('fly:action', (e, action: unknown) => {
    if (e.sender !== win.webContents || !isAction(action)) return;
    dbg('action', action.type);
    if (action.type === 'open') hide();
    deps.onAction(action);
  });
  ipcMain.on('fly:close', (e) => {
    if (e.sender === win.webContents) hide();
  });

  return {
    show(request) {
      dbg('show', request.key, request.open, 'current', key, open);
      // 開いている一覧を外のクリック（重なりを押した）で閉じた直後は、同じものを開き直さない（押すたびに開け閉めする）
      if (request.open && closedByBlur?.key === request.key && Date.now() - closedByBlur.at < REOPEN_GUARD_MS) return;
      // 開いている一覧があるときは、ほかの重なりに乗っても出さない（開けるのは 1 つだけ）。見出しから開くときは置き換える
      if (open && !request.open) return;
      if (key === request.key) {
        if (!request.open) return;
        // めくれを出している重なりが押された：上下の具合でクリックがウィジェットに届いても、めくれを押したときと同じく変形させる
        if (ready && !open) {
          setOpen();
          win.webContents.send('fly:open');
          return;
        }
        if (open) return;
      }
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
      // 見せたあとはカーソルの位置で決める（外れていれば tick がすぐ消す）。ウィンドウを出す途中には、
      // カーソルが動いていなくても重なりから外れた知らせが届くことがあるので、見せる前でもすぐには消さない。
      // 描き終わらないまま時間がたったときだけ、出すのをやめる
      if (k !== key || ready || open) return;
      setTimeout(() => {
        if (k === key && !ready && !open) hide();
      }, LEAVE_GRACE_MS);
    },
    hide,
    window: () => win,
    reload() {
      hide();
      win.webContents.reload();
    },
  };
}
