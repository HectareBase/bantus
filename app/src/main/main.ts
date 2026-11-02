// サイドバー型ウィジェットのメインプロセス。画面の端に、枠のない透明なウィンドウを置く。
// 背景の色と濃さは画面側（CSS）で塗る。透明なウィンドウには Mica を使えない。

import { app, BrowserWindow, ipcMain, screen, shell, type Display } from 'electron';
import { join } from 'node:path';
import { readSessions, sessionDataFolders, watchSessions } from './sessions';
import { getSettings, onSettingsChange, settingsFilePath, updateSettings } from './settings-store';
import type { Settings } from '../shared/settings';
import type { AboutInfo, DisplayOption, WidgetLayout } from '../shared/types';

const WIDTH = 264;
const COLLAPSED_WIDTH = 52;
const SESSION_ID = /^local_[0-9a-f-]{36}$/;
const PRELOAD = join(__dirname, '..', 'preload', 'preload.js');
const WEB = join(__dirname, '..', '..', 'web', 'renderer');

let win: BrowserWindow | undefined;
let settingsWin: BrowserWindow | undefined;
let collapsed = false;
let lastSent = '';

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
  const width = collapsed ? COLLAPSED_WIDTH : WIDTH;
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
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.loadFile(join(WEB, 'index.html'));
  w.once('ready-to-show', () => {
    applySettings(getSettings());
    w.show();
    sendSessions(true);
  });
  return w;
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
    title: 'Claude ウィジェット — 設定',
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
  const stopWatching = watchSessions(() => sendSessions());

  ipcMain.on('open-session', (_e, id: unknown) => {
    if (typeof id === 'string' && SESSION_ID.test(id)) {
      shell.openExternal(`claude://claude.ai/epitaxy/${id}`);
    }
  });
  ipcMain.on('set-collapsed', (_e, value: unknown) => {
    collapsed = value === true;
    win?.setBounds(sidebarBounds());
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

  app.on('before-quit', stopWatching);
});

app.on('window-all-closed', () => app.quit());

// 二重起動を防ぐ
if (!app.requestSingleInstanceLock()) app.quit();
