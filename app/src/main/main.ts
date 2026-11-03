// サイドバー型ウィジェットのメインプロセス。画面の端に、枠のない透明なウィンドウを置く。
// 背景の色と濃さは画面側（CSS）で塗る。透明なウィンドウには Mica を使えない。

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Notification, screen, shell, Tray, type Display } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { foregroundProcessName, startForegroundProbe, stopForegroundProbe } from './foreground';
import { createGitStatus } from './git-status';
import { readSessions, sessionDataFolders, watchSessions } from './sessions';
import { getSettings, onSettingsChange, settingsFilePath, updateSettings } from './settings-store';
import { tipBounds } from './tip-place';
import { ALWAYS_SHOW_ID, WIDTH_MAX, WIDTH_MIN, type Settings, type WindowBounds } from '../shared/settings';
import type { AboutInfo, DisplayOption, TipRect, ToastRequest, WidgetLayout } from '../shared/types';

/** 設定ウィンドウの最初の大きさと、いちばん小さい大きさ */
const SETTINGS_SIZE = { width: 880, height: 640 };
const SETTINGS_MIN = { width: 520, height: 400 };
const SESSION_ID = /^local_[0-9a-f-]{36}$/;
const PRELOAD = join(__dirname, '..', 'preload', 'preload.js');
const WEB = join(__dirname, '..', '..', 'web', 'renderer');
/**
 * アプリのアイコン（npm run icons で assets/icon.svg から作る）。
 * exe では asar の中の .ico を Tray が読めないことがあるので、assets/ を resources の下に外出しして読む（electron-builder.yml の extraResources）
 */
const ICON = app.isPackaged
  ? join(process.resourcesPath, 'assets', 'icon.ico')
  : join(__dirname, '..', '..', '..', 'assets', 'icon.ico');
/** electron-builder.yml の appId と同じ値。通知やタスクバーで、このアプリを見分けるのに使う */
const APP_USER_MODEL_ID = 'io.github.hectarebase.bantus';
/** 未確認のセッションを表示順に開くショートカット（Ctrl+Alt+Space はほかのアプリが使っていた） */
const CYCLE_SHORTCUT = 'Control+Alt+N';
/** Claude デスクトップのプロセス名 */
const CLAUDE_PROCESS = 'claude';
/** タスクバーを点滅させる長さ。止めたあとはオレンジのまま残さない */
const FLASH_MS = 3_000;

let win: BrowserWindow | undefined;
let settingsWin: BrowserWindow | undefined;
let tipWin: BrowserWindow | undefined;
/** 今出そうとしているツールチップの基準の要素。消したら undefined にし、遅れて届いた大きさは捨てる */
let tipAnchor: TipRect | undefined;
let tipHideTimer: NodeJS.Timeout | undefined;
/** 変数に持っておかないと、ガベージコレクションでトレイから消える */
let tray: Tray | undefined;
/** ドラッグ中の幅。離すまでは保存しない */
let dragWidth: number | undefined;
let lastSent = '';
/** タスクバーの点滅を止めるタイマー */
let flashTimer: NodeJS.Timeout | undefined;
/** 出しているトースト。変数に持っておかないと、ガベージコレクションでクリックが届かなくなる */
const toasts = new Set<Notification>();
/** 作業フォルダごとのコミットされていない変更。調べ終えて結果が変わったら、一覧を送り直す */
const gitStatus = createGitStatus(() => sendSessions());

app.setAppUserModelId(APP_USER_MODEL_ID);

// 見本データで動かすとき（開発用）は、データフォルダを分ける。設定が別になり、いつものウィジェットと同時に起動できる
if (process.env.WIDGET_FIXTURE) app.setPath('userData', `${app.getPath('userData')}-debug`);

/**
 * Windows の起動時に開く設定を変えられるか。npm start では electron.exe が登録されてしまうので、インストール版でだけ使う。
 * 見本データで動かすときも、いつものウィジェットの登録に触れないよう使わない
 */
const LOGIN_ITEM_AVAILABLE = app.isPackaged && !process.env.WIDGET_FIXTURE;

// ---- Windows の起動時に開く ----

/** 起動したときに、Windows の登録を設定に写す（タスク マネージャーなど、ほかの場所で変えられていることがある） */
function readLoginItem() {
  if (!LOGIN_ITEM_AVAILABLE) return;
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  if (openAtLogin !== getSettings().openAtLogin) updateSettings({ openAtLogin });
}

/** 設定が変わったら、Windows の登録に写す */
function applyLoginItem(s: Settings) {
  if (!LOGIN_ITEM_AVAILABLE) return;
  if (app.getLoginItemSettings().openAtLogin !== s.openAtLogin) app.setLoginItemSettings({ openAtLogin: s.openAtLogin });
}

// ---- 位置と見た目 ----

function targetDisplay(s: Settings): Display {
  if (s.display !== 'primary') {
    const found = screen.getAllDisplays().find((d) => String(d.id) === s.display);
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

function sidebarBounds() {
  const s = getSettings();
  const area = targetDisplay(s).workArea;
  const width = Math.min(dragWidth ?? s.width, Math.floor(area.width / 2));
  const x = s.edge === 'left' ? area.x : area.x + area.width - width;
  return { x, y: area.y, width, height: area.height };
}

function widgetLayout(s: Settings): WidgetLayout {
  const { edge, backgroundOpacity, cardOpacity, headerShade, pinned, groupLimit, foldScope, projectOrder, worktreeOrder, sessionOrder, showSeq, showUpdated, alwaysShow } = s;
  const { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen } = s;
  return {
    edge, backgroundOpacity, cardOpacity, headerShade, pinned, groupLimit, foldScope, projectOrder, worktreeOrder, sessionOrder, showSeq, showUpdated, alwaysShow,
    notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen,
  };
}

function applySettings(s: Settings) {
  if (!win || win.isDestroyed()) return;
  win.setBounds(sidebarBounds());
  // 固定を外すと、ほかのウィンドウをクリックしたときにその後ろへ回る
  win.setAlwaysOnTop(s.pinned);
  // 背景を見せるなら、クリックを後ろへ通すのをやめる（通すかどうかは、背景が 0% のときに画面側が決める）
  if (s.backgroundOpacity > 0) win.setIgnoreMouseEvents(false);
  win.webContents.send('layout', widgetLayout(s));
}

function displayOptions(): DisplayOption[] {
  const primaryId = screen.getPrimaryDisplay().id;
  const others = screen.getAllDisplays().filter((d) => d.id !== primaryId);
  return [
    { id: 'primary', label: 'メインのモニター' },
    ...others.map((d, i) => ({ id: String(d.id), label: `モニター ${i + 2}（${d.size.width}×${d.size.height}）` })),
  ];
}

// ---- ウィンドウ ----

function createWidget(): BrowserWindow {
  const w = new BrowserWindow({
    ...sidebarBounds(),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: getSettings().pinned,
    show: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: ICON,
    // 知らせる音は、クリックなどの操作なしに鳴らす
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  w.loadFile(join(WEB, 'index.html'));
  w.once('ready-to-show', () => {
    applySettings(getSettings());
    w.show();
    sendSessions(true);
    if (process.env.WIDGET_SCREENSHOT) void captureAndQuit(w, process.env.WIDGET_SCREENSHOT);
  });
  return w;
}

/**
 * ツールチップのウィンドウ。ウィジェットの外（画面の内側）に出すので、別のウィンドウにする。
 * フォーカスを取らず、クリックは後ろへ通す。出すたびに作ると遅いので、1 つを使い回す
 */
function createTipWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 400,
    height: 200,
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
    // 隠れている間も、大きさを測って返せるようにする
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  w.setIgnoreMouseEvents(true);
  // 固定したウィジェットより前に出す
  w.setAlwaysOnTop(true, 'pop-up-menu');
  w.loadFile(join(WEB, 'tip.html'));
  return w;
}

/** ツールチップの中身の大きさが届いたら、置いて見せる */
function placeTip(width: number, height: number) {
  if (!tipAnchor || !win || win.isDestroyed() || !tipWin || tipWin.isDestroyed()) return;
  const s = getSettings();
  tipWin.setBounds(tipBounds(s.edge, win.getBounds(), targetDisplay(s).workArea, tipAnchor, { width, height }));
  if (!tipWin.isVisible()) tipWin.showInactive();
  tipWin.webContents.send('tip:visible', true);
}

function hideTip() {
  tipAnchor = undefined;
  if (!tipWin || tipWin.isDestroyed() || !tipWin.isVisible()) return;
  tipWin.webContents.send('tip:visible', false);
  // 薄くなり終えてから隠す（tip.css の消えるアニメーションより少し長く）
  clearTimeout(tipHideTimer);
  tipHideTimer = setTimeout(() => {
    if (!tipAnchor) tipWin?.hide();
  }, 120);
}

function isTipRect(v: unknown): v is TipRect {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

/** 開発用：折りたたみもすべて開いた画面を PNG に保存して終わる（WIDGET_SCREENSHOT に保存先） */
async function captureAndQuit(w: BrowserWindow, path: string) {
  await new Promise((r) => setTimeout(r, 500));
  // ふだんは 1 つしか開けないので、ボタンは押さずに見た目だけ開く
  await w.webContents.executeJavaScript("document.querySelectorAll('.fold').forEach((f) => f.classList.add('open'))");
  // 点滅や回転の途中で撮らないよう、アニメーションを止める
  await w.webContents.insertCSS('*, *::before, *::after { animation: none !important; }');
  // 画面に収まらない分も撮れるよう、ウィンドウを中身の高さまで伸ばす（スクロールする要素のいちばん大きな高さ）
  const overflow: number = await w.webContents.executeJavaScript(
    "Math.max(0, ...[...document.querySelectorAll('*')].map((e) => e.scrollHeight - e.clientHeight))",
  );
  if (overflow > 0) w.setBounds({ ...w.getBounds(), height: w.getBounds().height + overflow });
  // ツールチップを見たいときは、その要素にフォーカスして出す（WIDGET_SCREENSHOT_FOCUS に CSS セレクター）。
  // ウィンドウの大きさを変えると消えるので、伸ばしたあとに出す
  const focus = process.env.WIDGET_SCREENSHOT_FOCUS;
  if (focus) await w.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(focus)})?.focus()`);
  await new Promise((r) => setTimeout(r, 300));
  try {
    const image = await w.webContents.capturePage();
    writeFileSync(path, image.toPNG());
    // ツールチップは別のウィンドウなので、出ていれば別のファイルに撮る
    if (tipWin?.isVisible()) writeFileSync(path.replace(/(\.png)?$/i, '-tooltip.png'), (await tipWin.webContents.capturePage()).toPNG());
  } catch (e) {
    console.error('画面を保存できませんでした：', e);
    app.exit(1);
  }
  app.quit();
}

/** タイトルバー（上の端）のうち、幅 100px・高さ 30px 以上がどこかのモニターの作業領域に入っているか */
function titleBarVisible(b: WindowBounds): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const h = Math.min(b.y + 30, a.y + a.height) - Math.max(b.y, a.y);
    return w >= 100 && h >= 30;
  });
}

/** 前に閉じたときの位置と大きさに戻す。モニターが外れるなどでタイトルバーが見えなければ、大きさだけ戻して真ん中に出す */
function restoreSettingsBounds(w: BrowserWindow) {
  const saved = getSettings().settingsWindow;
  if (!saved) return;
  const bounds = { ...saved, width: Math.max(SETTINGS_MIN.width, saved.width), height: Math.max(SETTINGS_MIN.height, saved.height) };
  if (titleBarVisible(bounds)) return w.setBounds(bounds);
  w.setSize(bounds.width, bounds.height);
  w.center();
}

function sameBounds(a: WindowBounds, b: WindowBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  const w = new BrowserWindow({
    ...SETTINGS_SIZE,
    minWidth: SETTINGS_MIN.width,
    minHeight: SETTINGS_MIN.height,
    title: 'Bantus — 設定',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  settingsWin = w;
  // コンストラクターに大きさを渡すより、setBounds のほうがずれが小さい（拡大率 125% で、コンストラクターは 6px ほど大きくなる）
  restoreSettingsBounds(w);
  // 開いたときの位置と大きさ。閉じるときにこれと同じなら保存しない（座標の丸めで、開くたびに数 px ずつずれていくのを防ぐ）
  const opened = w.getNormalBounds();
  w.loadFile(join(WEB, 'settings.html'));
  w.once('ready-to-show', () => w.show());
  // 閉じるときに位置と大きさを覚える。最大化していても、元に戻したときの大きさを保存する
  w.on('close', () => {
    const bounds = w.getNormalBounds();
    if (!sameBounds(bounds, opened)) updateSettings({ settingsWindow: bounds });
  });
  w.on('closed', () => (settingsWin = undefined));
}

/** ウィジェットを前に出す（固定を外して後ろに回ったときや、隠れたときに使う） */
function showWidget() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.moveTop();
}

/** タスクトレイのアイコン。クリックでウィジェットを前に出し、右クリックで表示、設定、終了 */
function createTray(): Tray {
  const t = new Tray(ICON);
  t.setToolTip('Bantus');
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: '表示', click: () => showWidget() },
      { label: '設定', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: '終了', click: () => app.quit() },
    ]),
  );
  t.on('click', () => showWidget());
  return t;
}

/** カーソルの位置から、内側の端がそこに来る幅を出す */
function widthAtCursor(): number {
  const s = getSettings();
  const area = targetDisplay(s).workArea;
  const cursor = screen.getCursorScreenPoint();
  const w = s.edge === 'left' ? cursor.x - area.x : area.x + area.width - cursor.x;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(w)));
}

/**
 * タスクバーのボタンを数秒だけ点滅させる（音やトーストと同じ、1 回だけの知らせ）。
 * 続けて頼まれたら止める時刻を延ばす。止めるときは flashFrame(false) で、オレンジのまま残さない
 */
function flashTaskbar() {
  if (!win || win.isDestroyed() || win.isFocused()) return;
  win.flashFrame(true);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = undefined;
    if (win && !win.isDestroyed()) win.flashFrame(false);
  }, FLASH_MS);
}

/** Claude のウィンドウが前面にあるか。調べられなかったときは false */
async function claudeInFront(): Promise<boolean> {
  return (await foregroundProcessName())?.toLowerCase() === CLAUDE_PROCESS;
}

function openSession(id: unknown) {
  if (typeof id === 'string' && SESSION_ID.test(id)) {
    shell.openExternal(`claude://claude.ai/epitaxy/${id}`);
  }
}

function isToastRequest(v: unknown): v is ToastRequest {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === 'string' && typeof t.title === 'string' && typeof t.body === 'string';
}

/**
 * Windows の通知（トースト）を出す。音は画面側で鳴らすので、通知の音は消す。
 * npm start のとき（インストールしていない版）は、Windows が出さないことがある
 */
function showToast(t: ToastRequest) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: t.title, body: t.body, icon: ICON, silent: true });
  toasts.add(n);
  // 画面側の openRow を通して開く（未確認の帯を消す）。画面がなければここで開く
  n.on('click', () => {
    if (win && !win.isDestroyed()) win.webContents.send('toast-click', t.id);
    else openSession(t.id);
  });
  n.on('close', () => toasts.delete(n));
  n.on('failed', () => toasts.delete(n));
  n.show();
}

/** 前回と同じ内容なら送らない（画面の描き直しを減らす） */
function sendSessions(force = false) {
  if (!win || win.isDestroyed()) return;
  const sessions = gitStatus.apply(readSessions());
  const json = JSON.stringify(sessions);
  if (!force && json === lastSent) return;
  lastSent = json;
  win.webContents.send('sessions', sessions);
  // 一覧から消えた（アーカイブや削除された）セッションは、常に表示からも外す。読めずに空のときは外さない
  const { alwaysShow } = getSettings();
  if (sessions.length && alwaysShow.length) {
    const ids = new Set(sessions.map((s) => s.id));
    const kept = alwaysShow.filter((id) => ids.has(id));
    if (kept.length !== alwaysShow.length) updateSettings({ alwaysShow: kept });
  }
}

// ---- 起動 ----

app.whenReady().then(() => {
  win = createWidget();
  tipWin = createTipWindow();
  tray = createTray();
  const stopWatching = watchSessions(() => sendSessions());
  // 撮影だけのときは登録しない（いつものウィジェットのキーを奪わない）
  if (!process.env.WIDGET_SCREENSHOT) {
    startForegroundProbe();
    const ok = globalShortcut.register(CYCLE_SHORTCUT, async () => {
      // 未確認の行がなく Claude が前面にないときは、次へ進まずに今のセッションを前面に出す（決めるのは画面側）。調べられなかったときは前面にあるものとして扱う
      const name = await foregroundProcessName();
      const claudeInFront = name === undefined || name.toLowerCase() === CLAUDE_PROCESS;
      win?.webContents.send('cycle', claudeInFront);
    });
    if (!ok) console.error(`ショートカット ${CYCLE_SHORTCUT} を登録できませんでした（ほかのアプリが使用中）`);
  }

  ipcMain.on('open-session', (_e, id: unknown) => openSession(id));
  ipcMain.on('resize-start', () => {
    dragWidth = getSettings().width;
  });
  ipcMain.on('resize-move', () => {
    if (dragWidth === undefined) return;
    dragWidth = widthAtCursor();
    win?.setBounds(sidebarBounds());
  });
  ipcMain.on('resize-end', () => {
    if (dragWidth === undefined) return;
    const width = dragWidth;
    dragWidth = undefined;
    updateSettings({ width });
  });
  ipcMain.on('set-click-through', (_e, value: unknown) => {
    // forward: true で、クリックは通してもマウスの移動は画面側に届き続ける（カードに乗ったら戻せる）
    if (getSettings().backgroundOpacity === 0) win?.setIgnoreMouseEvents(value === true, { forward: true });
  });
  ipcMain.on('open-settings', () => openSettingsWindow());
  ipcMain.on('set-pinned', (_e, value: unknown) => {
    if (typeof value === 'boolean') updateSettings({ pinned: value });
  });
  ipcMain.on('set-always-show', (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string' || !ALWAYS_SHOW_ID.test(id) || typeof on !== 'boolean') return;
    const rest = getSettings().alwaysShow.filter((x) => x !== id);
    updateSettings({ alwaysShow: on ? [...rest, id] : rest });
  });

  ipcMain.on('flash-taskbar', () => flashTaskbar());
  ipcMain.handle('claude-in-front', () => claudeInFront());
  ipcMain.on('show-toast', (_e, toast: unknown) => {
    if (isToastRequest(toast)) showToast(toast);
  });

  ipcMain.on('tip-show', (_e, text: unknown, rect: unknown) => {
    if (typeof text !== 'string' || !text || !isTipRect(rect) || !tipWin || tipWin.isDestroyed()) return;
    clearTimeout(tipHideTimer);
    tipAnchor = rect;
    tipWin.webContents.send('tip:text', text);
  });
  ipcMain.on('tip-hide', () => hideTip());
  ipcMain.on('tip:size', (_e, width: unknown, height: unknown) => {
    if (typeof width === 'number' && typeof height === 'number') placeTip(width, height);
  });
  // ウィジェットが動いたり大きさが変わったりしたら、置き場所がずれるので消す
  win.on('move', () => hideTip());
  win.on('resize', () => hideTip());
  win.on('hide', () => hideTip());

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('layout:get', () => widgetLayout(getSettings()));
  ipcMain.on('settings:set', (_e, patch: unknown) => {
    if (patch && typeof patch === 'object') updateSettings(patch as Partial<Settings>);
  });
  ipcMain.handle('settings:displays', () => displayOptions());
  ipcMain.handle('settings:about', (): AboutInfo => ({
    version: app.getVersion(),
    settingsFile: settingsFilePath(),
    dataFolders: sessionDataFolders(),
    packaged: LOGIN_ITEM_AVAILABLE,
  }));

  readLoginItem();
  onSettingsChange((s) => {
    applySettings(s);
    applyLoginItem(s);
    settingsWin?.webContents.send('settings:changed', s);
  });

  // 画面の構成や作業領域が変わったら、端に置き直す
  const reposition = () => win?.setBounds(sidebarBounds());
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  app.on('before-quit', () => {
    stopWatching();
    globalShortcut.unregisterAll();
    stopForegroundProbe();
    tray?.destroy();
  });
});

app.on('window-all-closed', () => app.quit());

// 二重起動を防ぐ
if (!app.requestSingleInstanceLock()) {
  if (process.env.WIDGET_FIXTURE) console.error('同じデータフォルダのウィジェットがもう動いています');
  app.quit();
}
