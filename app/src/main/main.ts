// サイドバー型ウィジェットのメインプロセス。画面の端に、枠のない透明なウィンドウを置く。
// 背景の色と濃さは画面側（CSS）で塗る。透明なウィンドウには Mica を使えない。

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, shell, Tray, type Display } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { foregroundProcessName, startForegroundProbe, stopForegroundProbe } from './foreground';
import { createGitStatus } from './git-status';
import { readSessions, sessionDataFolders, watchSessions } from './sessions';
import { getSettings, onSettingsChange, settingsFilePath, updateSettings } from './settings-store';
import { ALWAYS_SHOW_ID, WIDTH_MAX, WIDTH_MIN, type Settings, type WindowBounds } from '../shared/settings';
import type { AboutInfo, DisplayOption, WidgetLayout } from '../shared/types';

const COLLAPSED_WIDTH = 52;
/** 設定ウィンドウの最初の大きさと、いちばん小さい大きさ */
const SETTINGS_SIZE = { width: 880, height: 640 };
const SETTINGS_MIN = { width: 520, height: 400 };
const SESSION_ID = /^local_[0-9a-f-]{36}$/;
const PRELOAD = join(__dirname, '..', 'preload', 'preload.js');
const WEB = join(__dirname, '..', '..', 'web', 'renderer');
/** アプリのアイコン（npm run icons で assets/icon.svg から作る） */
const ICON = join(__dirname, '..', '..', '..', 'assets', 'icon.ico');
/** 未確認のセッションを表示順に開くショートカット（Ctrl+Alt+Space はほかのアプリが使っていた） */
const CYCLE_SHORTCUT = 'Control+Alt+N';
/** Claude デスクトップのプロセス名 */
const CLAUDE_PROCESS = 'claude';

let win: BrowserWindow | undefined;
let settingsWin: BrowserWindow | undefined;
/** 変数に持っておかないと、ガベージコレクションでトレイから消える */
let tray: Tray | undefined;
let collapsed = false;
/** ドラッグ中の幅。離すまでは保存しない */
let dragWidth: number | undefined;
let lastSent = '';
/** 作業フォルダごとのコミットされていない変更。調べ終えて結果が変わったら、一覧を送り直す */
const gitStatus = createGitStatus(() => sendSessions());

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
  const { edge, backgroundOpacity, cardOpacity, pinned, groupLimit, foldScope, alwaysShow } = s;
  return { edge, backgroundOpacity, cardOpacity, pinned, groupLimit, foldScope, alwaysShow };
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
    skipTaskbar: true,
    alwaysOnTop: getSettings().pinned,
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

/** 開発用：折りたたみもすべて開いた画面を PNG に保存して終わる（WIDGET_SCREENSHOT に保存先） */
async function captureAndQuit(w: BrowserWindow, path: string) {
  await new Promise((r) => setTimeout(r, 500));
  // ふだんは 1 つしか開けないので、ボタンは押さずに見た目だけ開く
  await w.webContents.executeJavaScript("document.querySelectorAll('.fold').forEach((f) => f.classList.add('open'))");
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
  tray = createTray();
  const stopWatching = watchSessions(() => sendSessions());
  // 撮影だけのときは登録しない（いつものウィジェットのキーを奪わない）
  if (!process.env.WIDGET_SCREENSHOT) {
    startForegroundProbe();
    const ok = globalShortcut.register(CYCLE_SHORTCUT, async () => {
      // Claude が前面にないときは、次へ進まずに今のセッションを前面に出す。調べられなかったときは前面にあるものとして扱う
      const name = await foregroundProcessName();
      const claudeInFront = name === undefined || name.toLowerCase() === CLAUDE_PROCESS;
      win?.webContents.send('cycle', claudeInFront);
    });
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
  ipcMain.on('set-pinned', (_e, value: unknown) => {
    if (typeof value === 'boolean') updateSettings({ pinned: value });
  });
  ipcMain.on('set-always-show', (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string' || !ALWAYS_SHOW_ID.test(id) || typeof on !== 'boolean') return;
    const rest = getSettings().alwaysShow.filter((x) => x !== id);
    updateSettings({ alwaysShow: on ? [...rest, id] : rest });
  });

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
