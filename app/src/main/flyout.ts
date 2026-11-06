// めくれと一覧のウィンドウ（flyout.html）。ウィジェットの外（画面の内側）に、透明なウィンドウを 1 つだけ作って使い回す。
// 置き方と動かし方は docs/design/worktree-cards.md の「ウィンドウの作り」。
// - ウィンドウはウィジェットと一緒に出したままにし、めくれと一覧は中身（CSS）だけで出し入れする。
//   乗せるたびにウィンドウを出すと、Windows の表示のアニメーション（下から浮き上がる動き）がかかるため
// - 乗せただけではフォーカスを取らない。押して一覧を開いたときだけ取り、外のクリック（blur）と Esc で閉じる
// - めくれと一覧の上だけクリックを受け取り、ほかは下（ウィジェットや後ろのウィンドウ）へ通す
// - めくれを出している間は、カーソルが重なりに反応する範囲とめくれのどちらからも外れたら、すぐ消す（動きは付けない）
// - めくれが隠れていても、ウィジェットの外の、めくれが飛び出す所にカーソルが入ったら、ウィジェットの画面に知らせて出してもらう
//   （ウィジェットの外はウィジェットの画面からは見えないので、ウィジェットが出ている間はいつもカーソルの位置を見る）

import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import type { FlyAction, FlyContent, FlyRequest, FlyShow, FlyTarget, TipRect } from '../shared/types';
import { contains, flyoutBounds, inHoverZone, scaleRect, type Rect } from './tip-place';

/** カーソルの位置を見る間隔 */
const POLL_MS = 30;
/** 外のクリックで閉じてから、同じものを開き直さない長さ */
const REOPEN_GUARD_MS = 400;
/** 一覧を開いたまま、ほかの重なりに乗ったとき、切り替えるまでとどまるのを待つ長さ */
const SWITCH_DWELL_MS = 150;
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
  /** 表示の拡大率（1 で等倍）。画面から届く四角は CSS px なので、これを掛けて画面の座標にする */
  zoom: () => number;
  /** 一覧の中の操作を、ウィジェットの画面へ渡す */
  onAction: (action: FlyAction) => void;
  /** ウィジェットの外で、重なりに反応する範囲にカーソルが入った */
  onHover: (key: string) => void;
  /** 出しているもの（消えたら undefined）と、一覧を開いているか */
  onState: (key: string | undefined, open: boolean) => void;
}

export interface Flyout {
  show(request: FlyRequest): void;
  update(key: string, content: FlyContent, count: number): void;
  /** 出しているものが key なら消す（ウィジェットの一覧をスクロールした） */
  leave(key: string): void;
  hide(): void;
  /** 重なりに反応する範囲（ウィジェットの中の座標） */
  setTargets(targets: FlyTarget[]): void;
  /** めくれか一覧を出しているか（撮影用） */
  showing(): boolean;
  /** ウィジェットが出た・隠れたときに、ウィンドウも出す・隠す */
  setWidgetVisible(visible: boolean): void;
  window(): BrowserWindow;
  reload(): void;
}

export function isFlyRequest(v: unknown): v is FlyRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.key === 'string' && typeof r.count === 'number' && typeof r.open === 'boolean'
    && isRect(r.anchor) && isRect(r.hit) && (r.tab === undefined || isRect(r.tab)) && isContent(r.content);
}

export function isContent(v: unknown): v is FlyContent {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (c.kind === 'timeline' || c.kind === 'plain') ? Array.isArray(c.items) : c.kind === 'cards' && Array.isArray(c.cards);
}

export function isFlyTargets(v: unknown): v is FlyTarget[] {
  return Array.isArray(v) && v.every((t) => t && typeof t === 'object' && typeof (t as FlyTarget).key === 'string' && isRect((t as FlyTarget).zone));
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

/** 重なりの的とめくれが飛び出す所を、画面の座標にする。画面の座標は整数に丸まるので、端の 1px でちらつかないよう少し広げる */
function hitRects(widget: Rect, request: FlyRequest, zoom: number): Rect[] {
  return [request.hit, ...(request.tab ? [request.tab] : [])]
    .map((r) => scaleRect(r, zoom))
    .map((r) => ({ x: widget.x + r.x - 1, y: widget.y + r.y - 1, width: r.width + 2, height: r.height + 2 }));
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
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
    webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setIgnoreMouseEvents(true);
  win.loadFile(join(deps.web, 'flyout.html'));

  /** ウィジェットが出ているか（ウィンドウはこれに合わせて出したままにする） */
  let widgetVisible = false;
  /** 出している（出そうとしている）もの */
  let key: string | undefined;
  let open = false;
  /** 中身を描き終えたか。描き終えるまでは、カーソルの位置で消さない */
  let ready = false;
  /** クリックを受け取る場所（ウィンドウの中の座標、CSS px）。めくれと一覧 */
  let solid: TipRect[] = [];
  /** 重なりの的とめくれが飛び出す所（画面の座標）。ここかめくれの上にいる間は、めくれを消さない */
  let hit: Rect[] = [];
  let ignoring = true;
  let poll: NodeJS.Timeout | undefined;
  /** 重なりに反応する範囲（ウィジェットの中の座標、CSS px） */
  let targets: FlyTarget[] = [];
  /** ウィジェットの外で、カーソルが入っている範囲（入ったときに 1 度だけ知らせる） */
  let hovered: string | undefined;
  /** フォーカスを取れなかったときだけ、開いている間 Esc を登録する */
  let escRegistered = false;
  /** 外のクリックで閉じたもの（同じ重なりを押して閉じたときに、開き直さないため） */
  let closedByBlur: { key: string; at: number } | undefined;

  function setIgnore(value: boolean) {
    if (value === ignoring) return;
    ignoring = value;
    dbg('ignore', value);
    win.setIgnoreMouseEvents(value);
  }

  /** ウィンドウを出しておく。透明で中身もないので、Windows の表示のアニメーションは見えない */
  function ensureShown() {
    if (win.isDestroyed() || win.isVisible() || !widgetVisible) return;
    win.showInactive();
  }

  /** ウィジェットに合わせた場所。カードによらず同じなので、変わったとき（幅や端を変えた）だけ置き直す */
  function place(anchor: TipRect): { top: number; inset: number; zoom: number } | undefined {
    const widget = deps.widget();
    if (!widget || widget.isDestroyed()) return undefined;
    const zoom = deps.zoom();
    const { bounds, top, inset } = flyoutBounds(deps.edge(), widget.getBounds(), deps.area(), scaleRect(anchor, zoom), zoom);
    if (!sameRect(win.getBounds(), bounds)) win.setBounds(bounds);
    return { top, inset, zoom };
  }

  /** ウィジェットが出ていて、めくれを出しているか反応する範囲があるときだけカーソルを見る */
  function syncPoll() {
    const want = widgetVisible && !win.isDestroyed() && (key !== undefined || targets.length > 0);
    if (want && !poll) poll = setInterval(tick, POLL_MS);
    if (!want && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  }

  /** ウィジェットの外で、重なりに反応する範囲に入ったら知らせる。ウィジェットの中は、ウィジェットの画面が自分で見る */
  function watchOutside(c: Electron.Point, onSolid: boolean) {
    const widget = deps.widget();
    let found: string | undefined;
    if (widget && !widget.isDestroyed() && !onSolid) {
      const wb = widget.getBounds();
      if (!contains(wb, c.x, c.y)) {
        const zoom = deps.zoom();
        found = targets.find((t) => {
          const z = scaleRect(t.zone, zoom);
          return contains({ x: wb.x + z.x, y: wb.y + z.y, width: z.width, height: z.height }, c.x, c.y);
        })?.key;
      }
    }
    if (found && found !== hovered && found !== key) {
      dbg('hover outside', found);
      deps.onHover(found);
    }
    hovered = found;
  }

  function tick() {
    // 終了の途中などでウィンドウが壊れたあとに呼ばれたら、カーソルを見るのをやめる。
    // 壊れたウィンドウを触ると 30ms ごとに例外になり、エラーのダイアログが閉じても出続ける
    if (win.isDestroyed()) {
      syncPoll();
      return;
    }
    const c = screen.getCursorScreenPoint();
    if (!key || !ready) {
      if (!key) watchOutside(c, false);
      return;
    }
    const zoom = deps.zoom();
    const zone = inHoverZone(c, win.getBounds(), solid.map((r) => scaleRect(r, zoom)), hit);
    // カーソルがめくれや一覧に入ったら一番上へ上げ直す。ウィジェットを押したあとは、Windows がウィジェットを上にするため
    if (zone.solid && ignoring) win.moveTop();
    setIgnore(!zone.solid);
    // めくれだけのときは、重なりの的とめくれのどちらからも外れたら、すぐ消す
    if (!open && !zone.solid && !zone.hit) hide();
    // めくれや一覧の上では、ほかの重なりの範囲に重なっていても反応しない
    watchOutside(c, zone.solid);
  }

  function hide() {
    dbg('hide', key);
    cancelSwitch();
    const had = key !== undefined;
    key = undefined;
    open = false;
    ready = false;
    solid = [];
    hit = [];
    if (escRegistered) {
      globalShortcut.unregister('Escape');
      escRegistered = false;
    }
    if (!win.isDestroyed()) {
      setIgnore(true);
      win.webContents.send('fly:hide');
    }
    syncPoll();
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

  /** めくれから一覧へ変形させる */
  function setOpen() {
    if (!key || open) return;
    open = true;
    win.moveTop();
    takeFocus();
    win.webContents.send('fly:open');
    deps.onState(key, true);
  }

  /** 一覧を開いたまま、ほかの重なりに乗ったときの切り替え */
  let pendingSwitch: { key: string; timer: NodeJS.Timeout } | undefined;

  function cancelSwitch() {
    if (!pendingSwitch) return;
    clearTimeout(pendingSwitch.timer);
    pendingSwitch = undefined;
  }

  function scheduleSwitch(request: FlyRequest) {
    if (pendingSwitch?.key === request.key) return;
    cancelSwitch();
    const timer = setTimeout(() => {
      pendingSwitch = undefined;
      const widget = deps.widget();
      if (!open || !widget || widget.isDestroyed()) return;
      const wb = widget.getBounds();
      const target = hitRects(wb, request, deps.zoom());
      // まだその重なりの的の上にいるときだけ切り替える
      if (!inHoverZone(screen.getCursorScreenPoint(), win.getBounds(), [], target).hit) return;
      hide();
      api.show(request);
    }, SWITCH_DWELL_MS);
    pendingSwitch = { key: request.key, timer };
  }

  win.on('closed', () => syncPoll());

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
      win.moveTop();
      syncPoll();
      if (open) takeFocus();
    }
    tick();
  });
  ipcMain.on('fly:request-open', (e) => {
    dbg('request-open', key, open);
    if (e.sender === win.webContents) setOpen();
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

  const api: Flyout = {
    show(request) {
      dbg('show', request.key, request.open, 'current', key, open);
      // 開いている一覧を外のクリック（重なりを押した）で閉じた直後は、同じものを開き直さない（押すたびに開け閉めする）
      if (request.open && closedByBlur?.key === request.key && Date.now() - closedByBlur.at < REOPEN_GUARD_MS) return;
      // 一覧を開いているときに、ほかの重なりに乗った：少しとどまったら一覧を閉じて、その重なりのめくれを出す（開けるのは 1 つだけ）。
      // 一覧からウィジェットへカーソルを戻すときに、通りがかった重なりで一覧が閉じないよう、とどまるのを待つ
      if (open && !request.open && key !== request.key) {
        scheduleSwitch(request);
        return;
      }
      cancelSwitch();
      if (key === request.key) {
        // 同じ重なりの上を動いているだけなら何もしない。押されたら、出ているめくれをそのまま一覧へ変形させる
        // （上下の具合でクリックがめくれでなくウィジェットに届いても、同じ動きにする）
        if (request.open && !open) setOpen();
        return;
      }
      if (key) hide();
      ensureShown();
      const placed = place(request.anchor);
      const widget = deps.widget();
      if (!placed || !widget) return;
      const wb = widget.getBounds();
      key = request.key;
      open = request.open;
      ready = false;
      solid = [];
      // 画面の座標は整数に丸まるので、端の 1px でちらつかないよう少し広げる
      hit = hitRects(wb, request, placed.zoom);
      // めくれの画面は CSS px で描くので、画面の座標から戻す。高さは画面から届いた値（CSS px）のまま
      const show: FlyShow = {
        key: request.key,
        side: deps.edge() === 'right' ? 'left' : 'right',
        top: placed.top / placed.zoom,
        inset: placed.inset / placed.zoom,
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
      if (k === key) hide();
    },
    hide,
    setTargets(next) {
      targets = next;
      syncPoll();
    },
    showing: () => key !== undefined,
    setWidgetVisible(visible) {
      widgetVisible = visible;
      if (win.isDestroyed()) return;
      if (visible) {
        ensureShown();
        syncPoll();
      } else {
        hide();
        win.hide();
      }
    },
    window: () => win,
    reload() {
      hide();
      win.webContents.reload();
    },
  };
  return api;
}
