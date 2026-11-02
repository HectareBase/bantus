// サイドバー型ウィジェットのメインプロセス。画面の端に、枠のない透明なウィンドウを置く。
// 背景の色と濃さは画面側（CSS）で塗る。透明なウィンドウには Mica を使えない。

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, shell, Tray, type Display } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSessions, sessionDataFolders, watchSessions } from './sessions';
import { getSettings, onSettingsChange, settingsFilePath, updateSettings } from './settings-store';
import { WIDTH_MAX, WIDTH_MIN, type Settings } from '../shared/settings';
import type { AboutInfo, DisplayOption, WidgetLayout } from '../shared/types';

const COLLAPSED_WIDTH = 52;
const SESSION_ID = /^local_[0-9a-f-]{36}$/;
const PRELOAD = join(__dirname, '..', 'preload', 'preload.js');
const WEB = join(__dirname, '..', '..', 'web', 'renderer');
/** アプリのアイコン（npm run icons で assets/icon.svg から作る） */
const ICON = join(__dirname, '..', '..', '..', 'assets', 'icon.ico');
/** 未確認のセッションを表示順に開くショートカット（Ctrl+Alt+Space はほかのアプリが使っていた） */
const CYCLE_SHORTCUT = 'Control+Alt+N';

let win: BrowserWindow | undefined;
let settingsWin: BrowserWindow | undefined;
/** 変数に持っておかないと、ガベージコレクションでトレイから消える */
let tray: Tray | undefined;
let collapsed = false;
/** ドラッグ中の幅。離すまでは保存しない */
let dragWidth: number | undefined;
let lastSent = '';

// 見本データで動かすとき（開発用）は、データフォルダを分ける。設定が別になり、いつものウィジェットと同時に起動できる
if (process.env.WIDGET_FIXTURE) app.setPath('userData', `${app.getPath('userData')}-debug`);

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
  const width = collapsed ? COLLAPSED_WIDTH : Math.min(dragWidth ?? s.width, Math.floor(area.width / 2));
  const x = s.edge === 'left' ? area.x : area.x + area.width - width;
  return { x, y: area.y, width, height: area.height };
}

function widgetLayout(s: Settings): WidgetLayout {
  return { edge: s.edge, backgroundOpacity: s.backgroundOpacity, cardOpacity: s.cardOpacity };
}

function applySettings(s: Settings) {
  if (!win || win.isDestroyed()) return;
  win.setBounds(sidebarBounds());
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
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: ICON,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
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

/** 開発用：停止中もすべて開いた画面を PNG に保存して終わる（WIDGET_SCREENSHOT に保存先） */
async function captureAndQuit(w: BrowserWindow, path: string) {
  await new Promise((r) => setTimeout(r, 500));
  await w.webContents.executeJavaScript(
    "document.querySelectorAll('.stopped:not([hidden]) .stopped-toggle').forEach((b) => b.click())",
  );
  // 点滅や回転の途中で撮らないよう、アニメーションを止める
  await w.webContents.insertCSS('*, *::before, *::after { animation: none !important; }');
  // ツールチップを見たいときは、その要素にフォーカスして出す（WIDGET_SCREENSHOT_FOCUS に CSS セレクター）
  const focus = process.env.WIDGET_SCREENSHOT_FOCUS;
  if (focus) await w.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(focus)})?.focus()`);
  // 画面に収まらない分も撮れるよう、ウィンドウを中身の高さまで伸ばす（スクロールする要素のいちばん大きな高さ）
  const overflow: number = await w.webContents.executeJavaScript(
    "Math.max(0, ...[...document.querySelectorAll('*')].map((e) => e.scrollHeight - e.clientHeight))",
  );
  if (overflow > 0) w.setBounds({ ...w.getBounds(), height: w.getBounds().height + overflow });
  await new Promise((r) => setTimeout(r, 300));
  try {
    const image = await w.webContents.capturePage();
    writeFileSync(path, image.toPNG());
  } catch (e) {
    console.error('画面を保存できませんでした：', e);
    app.exit(1);
  }
  app.quit();
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 680,
    height: 520,
    minWidth: 520,
    minHeight: 400,
    title: 'Bantus — 設定',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  settingsWin.loadFile(join(WEB, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin?.show());
  settingsWin.on('closed', () => (settingsWin = undefined));
}

/** タスクトレイのアイコン。クリックでウィジェットを前に出し、右クリックで設定と終了 */
function createTray(): Tray {
  const t = new Tray(ICON);
  t.setToolTip('Bantus');
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: '設定', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: '終了', click: () => app.quit() },
    ]),
  );
  t.on('click', () => {
    if (!win || win.isDestroyed()) return;
    win.show();
    win.moveTop();
  });
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

/** 前回と同じ内容なら送らない（画面の描き直しを減らす） */
function sendSessions(force = false) {
  if (!win || win.isDestroyed()) return;
  const sessions = readSessions();
  const json = JSON.stringify(sessions);
  if (!force && json === lastSent) return;
  lastSent = json;
  win.webContents.send('sessions', sessions);
}

// ---- 起動 ----

app.whenReady().then(() => {
  win = createWidget();
  tray = createTray();
  const stopWatching = watchSessions(() => sendSessions());
  // 撮影だけのときは登録しない（いつものウィジェットのキーを奪わない）
  if (!process.env.WIDGET_SCREENSHOT) {
    const ok = globalShortcut.register(CYCLE_SHORTCUT, () => win?.webContents.send('cycle'));
    if (!ok) console.error(`ショートカット ${CYCLE_SHORTCUT} を登録できませんでした（ほかのアプリが使用中）`);
  }

  ipcMain.on('open-session', (_e, id: unknown) => {
    if (typeof id === 'string' && SESSION_ID.test(id)) {
      shell.openExternal(`claude://claude.ai/epitaxy/${id}`);
    }
  });
  ipcMain.on('set-collapsed', (_e, value: unknown) => {
    collapsed = value === true;
    win?.setBounds(sidebarBounds());
  });
  ipcMain.on('resize-start', () => {
    if (!collapsed) dragWidth = getSettings().width;
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
  ipcMain.on('quit', () => app.quit());

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
  }));

  onSettingsChange((s) => {
    applySettings(s);
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
    tray?.destroy();
  });
});

app.on('window-all-closed', () => app.quit());

// 二重起動を防ぐ
if (!app.requestSingleInstanceLock()) {
  if (process.env.WIDGET_FIXTURE) console.error('同じデータフォルダのウィジェットがもう動いています');
  app.quit();
}
