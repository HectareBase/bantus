// サイドバー型ウィジェットのメインプロセス。画面の右端に、枠のない Mica のウィンドウを置く。

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';
import { readSessions, watchSessions } from './sessions';

const WIDTH = 264;
const COLLAPSED_WIDTH = 52;
const SESSION_ID = /^local_[0-9a-f-]{36}$/;

let win: BrowserWindow | undefined;
let lastSent = '';

function sidebarBounds(width: number) {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - width, y: area.y, width, height: area.height };
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    ...sidebarBounds(WIDTH),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  w.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  w.once('ready-to-show', () => {
    w.show();
    sendSessions(true);
  });
  return w;
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

app.whenReady().then(() => {
  win = createWindow();
  const stopWatching = watchSessions(() => sendSessions());

  ipcMain.on('open-session', (_e, id: unknown) => {
    if (typeof id === 'string' && SESSION_ID.test(id)) {
      shell.openExternal(`claude://claude.ai/epitaxy/${id}`);
    }
  });
  ipcMain.on('set-collapsed', (_e, collapsed: unknown) => {
    win?.setBounds(sidebarBounds(collapsed === true ? COLLAPSED_WIDTH : WIDTH));
  });
  ipcMain.on('quit', () => app.quit());

  // 画面の構成や作業領域が変わったら、右端に置き直す
  const reposition = () => win?.setBounds(sidebarBounds(win.getBounds().width));
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  app.on('before-quit', stopWatching);
});

app.on('window-all-closed', () => app.quit());

// 二重起動を防ぐ
if (!app.requestSingleInstanceLock()) app.quit();
