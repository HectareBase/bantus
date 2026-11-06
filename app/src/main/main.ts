// サイドバー型ウィジェットのメインプロセス。画面の端に、枠のない透明なウィンドウを置く。
// 背景の色と濃さは画面側（CSS）で塗る。透明なウィンドウには Mica を使えない。

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeTheme, Notification, screen, shell, Tray, type Display } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFlyout, isContent, isFlyRequest, isFlyTargets, type Flyout } from './flyout';
import { foregroundProcessName, raiseClaudeWindow, startForegroundProbe, stopForegroundProbe } from './foreground';
import { createGitStatus } from './git-status';
import { startSelfUpdate } from './self-update';
import { readSessions, sessionDataFolders, watchSessions } from './sessions';
import { getSettings, onSettingsChange, settingsFilePath, updateSettings } from './settings-store';
import { scaleRect, tipBounds } from './tip-place';
import { worktreeAppUserModelId, worktreeInitialSettings, worktreeName, worktreeUserData, type GitEntry } from './worktree';
import { cardKeyOf } from '../shared/card-key';
import { SESSION_KEY_ID, WIDTH_MAX, WIDTH_MIN, isCardKey, type ArchiveMark, type Settings, type WindowBounds } from '../shared/settings';
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
/** めくれと一覧のウィンドウ（flyout.ts） */
let flyout: Flyout | undefined;
/** 今出そうとしているツールチップの基準の要素（ウィジェットの中の座標、CSS px）。消したら undefined にし、遅れて届いた大きさは捨てる */
let tipAnchor: TipRect | undefined;
let tipHideTimer: NodeJS.Timeout | undefined;
/** 変数に持っておかないと、ガベージコレクションでトレイから消える */
let tray: Tray | undefined;
/** ドラッグ中の幅。離すまでは保存しない */
let dragWidth: number | undefined;
let lastSent = '';
/** 最後にかけた表示の拡大率。変わったときだけ、出ているツールチップとめくれを消す（置き場所がずれるため） */
let appliedZoom = 1;
/** タスクバーの点滅を止めるタイマー */
let flashTimer: NodeJS.Timeout | undefined;
/** 出しているトースト。変数に持っておかないと、ガベージコレクションでクリックが届かなくなる */
const toasts = new Set<Notification>();
/** 作業フォルダごとのコミットされていない変更。調べ終えて結果が変わったら、一覧を送り直す */
const gitStatus = createGitStatus(() => sendSessions());

/** フォルダの .git の種類（ワークツリーの判定に使う） */
function gitEntry(dir: string): GitEntry {
  try {
    return statSync(join(dir, '.git')).isFile() ? 'file' : 'dir';
  } catch {
    return undefined;
  }
}

/** ワークツリーの中から npm start したときの、ワークツリー名。インストール版と main のチェックアウトでは undefined */
const WORKTREE = app.isPackaged ? undefined : worktreeName(app.getAppPath(), gitEntry);

/**
 * ワークツリー版のデータフォルダを、いつものウィジェットと分ける（二重起動の検査も別になり、並べて動かせる）。
 * 初めてのときは、いつもの設定を写して端を反対側にする
 */
function useWorktreeUserData(name: string) {
  const base = app.getPath('userData');
  const dir = worktreeUserData(base, name, !!process.env.WIDGET_FIXTURE);
  app.setPath('userData', dir);
  const file = join(dir, 'settings.json');
  if (existsSync(file)) return;
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(join(base, 'settings.json'), 'utf8'));
  } catch {
    // いつもの設定がなければ既定値から
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(worktreeInitialSettings(saved), null, 2));
  } catch (e) {
    console.error('ワークツリー版の設定を作れませんでした：', e);
  }
}

app.setAppUserModelId(WORKTREE ? worktreeAppUserModelId(APP_USER_MODEL_ID, WORKTREE) : APP_USER_MODEL_ID);

if (WORKTREE) useWorktreeUserData(WORKTREE);
// 見本データで動かすとき（開発用）は、データフォルダを分ける。設定が別になり、いつものウィジェットと同時に起動できる
else if (process.env.WIDGET_FIXTURE) app.setPath('userData', `${app.getPath('userData')}-debug`);

/** トレイと設定ウィンドウに出す名前。ワークツリー版はワークツリー名を添えて、いつものウィジェットと見分ける */
const APP_LABEL = WORKTREE ? `Bantus（ワークツリー：${WORKTREE}）` : 'Bantus';

/**
 * main に入った新しいコードへ自動で切り替えるか。main のチェックアウトから npm start したときだけ。
 * インストール版、ワークツリー版、見本データでは切り替えない
 */
const SELF_UPDATE = !app.isPackaged && !WORKTREE && !process.env.WIDGET_FIXTURE;

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
  const { edge, backgroundOpacity, cardOpacity, headerShade, pinned, mainArchiveMinutes, projectOrder, worktreeOrder, sessionOrder, rowPadding, showUpdated, showState, archive, archivedCards } = s;
  const { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen, statusColors } = s;
  return {
    edge, backgroundOpacity, cardOpacity, headerShade, pinned, mainArchiveMinutes, projectOrder, worktreeOrder, sessionOrder, rowPadding, showUpdated, showState, archive, archivedCards,
    notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen, statusColors,
  };
}

/**
 * テーマをすべてのウィンドウに当てる。画面の CSS は prefers-color-scheme のままで、themeSource を変えると
 * 開いているウィンドウ（ウィジェット・設定・一覧・ツールチップ）の見た目がすぐ切り替わる
 */
function applyTheme(s: Settings) {
  if (nativeTheme.themeSource !== s.theme) nativeTheme.themeSource = s.theme;
}

/** 一覧（めくれ）の状態の色。ウィジェットの色は layout で届く */
function sendFlyoutColors() {
  const w = flyout?.window();
  if (w && !w.isDestroyed()) w.webContents.send('fly:colors', getSettings().statusColors);
}

/** 表示の拡大率（1 で等倍） */
function zoomFactor(): number {
  return getSettings().zoom / 100;
}

/**
 * ウィジェット・ツールチップ・めくれに表示の拡大率をかける。設定ウィンドウにはかけない。
 * Electron では拡大率はウィンドウ（webContents）ごとで、同じ file:// でもほかのウィンドウには移らない
 */
function applyZoom() {
  const zoom = zoomFactor();
  const changed = zoom !== appliedZoom;
  appliedZoom = zoom;
  for (const w of [win, tipWin, flyout?.window()]) {
    if (w && !w.isDestroyed()) w.webContents.setZoomFactor(zoom);
  }
  if (changed) {
    hideTip();
    flyout?.hide();
  }
}

/** 読み込むたびに（読み込み直しでも）拡大率をかけ直す */
function keepZoom(w: BrowserWindow) {
  w.webContents.on('did-finish-load', () => w.webContents.setZoomFactor(zoomFactor()));
}

function applySettings(s: Settings) {
  applyTheme(s);
  sendFlyoutColors();
  if (!win || win.isDestroyed()) return;
  applyZoom();
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
  keepZoom(w);
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
  keepZoom(w);
  w.loadFile(join(WEB, 'tip.html'));
  return w;
}

/** ツールチップの中身の大きさ（CSS px）が届いたら、置いて見せる */
function placeTip(width: number, height: number) {
  if (!tipAnchor || !win || win.isDestroyed() || !tipWin || tipWin.isDestroyed()) return;
  const s = getSettings();
  // 画面から届く大きさと位置は CSS px なので、拡大率を掛けて画面の座標にする
  const zoom = zoomFactor();
  const size = { width: width * zoom, height: height * zoom };
  tipWin.setBounds(tipBounds(s.edge, win.getBounds(), targetDisplay(s).workArea, scaleRect(tipAnchor, zoom), size, zoom));
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

/** 開発用：画面を PNG に保存して終わる（WIDGET_SCREENSHOT に保存先） */
async function captureAndQuit(w: BrowserWindow, path: string) {
  await new Promise((r) => setTimeout(r, 500));
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
  // 一覧を見たいときは、その要素を押して開く（WIDGET_SCREENSHOT_FLY に CSS セレクター。重なりの的など）
  const fly = process.env.WIDGET_SCREENSHOT_FLY;
  if (fly) await w.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(fly)})?.click()`);
  await new Promise((r) => setTimeout(r, fly ? 600 : 300));
  try {
    const image = await w.webContents.capturePage();
    writeFileSync(path, image.toPNG());
    // ツールチップは別のウィンドウなので、出ていれば別のファイルに撮る
    if (tipWin?.isVisible()) writeFileSync(path.replace(/(\.png)?$/i, '-tooltip.png'), (await tipWin.webContents.capturePage()).toPNG());
    // めくれと一覧も別のウィンドウなので、出ていれば別のファイルに撮る
    const flyWin = flyout?.window();
    if (flyWin && flyout?.showing()) writeFileSync(path.replace(/(\.png)?$/i, '-flyout.png'), (await flyWin.webContents.capturePage()).toPNG());
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
    title: `${APP_LABEL} — 設定`,
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
  // settings.html の <title> で上書きされないようにする
  w.on('page-title-updated', (e) => e.preventDefault());
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
  t.setToolTip(APP_LABEL);
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

/**
 * もう開いているセッションの Claude のウィンドウを前に出す。
 * リンクだと 2 つ目の claude.exe が起動して URL を渡すまでに約 260 ms かかるので、直接前に出す。
 * 前に出せなかったとき（Windows に断られた、PowerShell が使えない）は、今までどおりリンクで開く
 */
async function raiseSession(id: unknown) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return;
  if (!(await raiseClaudeWindow())) openSession(id);
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

// ---- 新しいコードへの切り替え（self-update.ts） ----

/** ビルドし直した画面を読み込み直す。一覧は読み込み終えたら送り直す（前と同じでも送る） */
function reloadWindows() {
  hideTip();
  flyout?.reload();
  if (win && !win.isDestroyed()) {
    win.webContents.once('did-finish-load', () => sendSessions(true));
    win.webContents.reload();
  }
  if (tipWin && !tipWin.isDestroyed()) tipWin.webContents.reload();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.reload();
}

/** 起動し直す。before-quit の片付け（トレイのアイコンなど）を通すため、exit ではなく quit で終える */
function relaunch() {
  app.relaunch({ args: [app.getAppPath()] });
  app.quit();
}

/** 切り替えの失敗などを、トレイのツールチップと Windows の通知で伝える。undefined でツールチップを戻す */
function updateNotice(message: string | undefined) {
  tray?.setToolTip(message ? `${APP_LABEL}\n${message}` : APP_LABEL);
  if (!message) return;
  console.log(message);
  if (Notification.isSupported()) new Notification({ title: APP_LABEL, body: message, icon: ICON }).show();
}

/** 前回と同じ内容なら送らない（画面の描き直しを減らす） */
function sendSessions(force = false) {
  if (!win || win.isDestroyed()) return;
  const sessions = gitStatus.apply(readSessions());
  const json = JSON.stringify(sessions);
  if (!force && json === lastSent) return;
  lastSent = json;
  win.webContents.send('sessions', sessions);
  // 一覧から消えた（デスクトップでアーカイブや削除された）セッションとカードは、アーカイブの印からも外す。読めずに空のときは外さない
  if (sessions.length) {
    const { archive, archivedCards } = getSettings();
    const ids = new Set(sessions.map((s) => s.id));
    const cardKeys = new Set(sessions.map(cardKeyOf));
    const keptSessions = pruneMarks(archive, ids);
    const keptCards = pruneMarks(archivedCards, cardKeys);
    if (keptSessions || keptCards) updateSettings({ ...(keptSessions && { archive: keptSessions }), ...(keptCards && { archivedCards: keptCards }) });
  }
}

/** 今ない目印の印を外す。外すものがなければ undefined */
function pruneMarks(marks: Record<string, ArchiveMark>, keys: ReadonlySet<string>): Record<string, ArchiveMark> | undefined {
  const entries = Object.entries(marks);
  const kept = entries.filter(([k]) => keys.has(k));
  return kept.length === entries.length ? undefined : Object.fromEntries(kept);
}

/** 印を付けるか外す（null で外す） */
function setMark(marks: Record<string, ArchiveMark>, key: string, mark: unknown): Record<string, ArchiveMark> | undefined {
  if (mark !== null && mark !== 'archived' && mark !== 'shown') return undefined;
  const next = { ...marks };
  if (mark === null) delete next[key];
  else next[key] = mark;
  return next;
}

// ---- 起動 ----

app.whenReady().then(() => {
  applyTheme(getSettings());
  win = createWidget();
  tipWin = createTipWindow();
  flyout = createFlyout({
    preload: PRELOAD,
    web: WEB,
    widget: () => win,
    edge: () => getSettings().edge,
    area: () => targetDisplay(getSettings()).workArea,
    zoom: zoomFactor,
    onAction: (action) => win?.webContents.send('fly-action', action),
    onHover: (key) => {
      if (win && !win.isDestroyed()) win.webContents.send('fly-hover', key);
    },
    onState: (key, open) => {
      if (win && !win.isDestroyed()) win.webContents.send('fly-state', key, open);
    },
  });
  keepZoom(flyout.window());
  flyout.window().webContents.on('did-finish-load', sendFlyoutColors);
  applyZoom();
  tray = createTray();
  const stopWatching = watchSessions(() => sendSessions());
  const stopSelfUpdate = SELF_UPDATE ? startSelfUpdate(app.getAppPath(), { reload: reloadWindows, relaunch, notice: updateNotice }) : () => {};
  // 撮影だけのときは登録しない（いつものウィジェットのキーを奪わない）
  if (!process.env.WIDGET_SCREENSHOT) startForegroundProbe();
  // ワークツリー版も登録しない（いつものウィジェットが持っている）
  if (WORKTREE) console.log(`ワークツリー版（${WORKTREE}）なので、ショートカット ${CYCLE_SHORTCUT} は登録しません`);
  else if (!process.env.WIDGET_SCREENSHOT) {
    const ok = globalShortcut.register(CYCLE_SHORTCUT, async () => {
      // 未確認の行がなく Claude が前面にないときは、次へ進まずに今のセッションを前面に出す（決めるのは画面側）。調べられなかったときは前面にあるものとして扱う
      const name = await foregroundProcessName();
      const claudeInFront = name === undefined || name.toLowerCase() === CLAUDE_PROCESS;
      win?.webContents.send('cycle', claudeInFront);
    });
    if (!ok) console.error(`ショートカット ${CYCLE_SHORTCUT} を登録できませんでした（ほかのアプリが使用中）`);
  }

  ipcMain.on('open-session', (_e, id: unknown) => openSession(id));
  ipcMain.on('raise-session', (_e, id: unknown) => void raiseSession(id));
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
  ipcMain.on('set-archive', (_e, id: unknown, mark: unknown) => {
    if (typeof id !== 'string' || !SESSION_KEY_ID.test(id)) return;
    const archive = setMark(getSettings().archive, id, mark);
    if (archive) updateSettings({ archive });
  });
  ipcMain.on('set-card-archive', (_e, key: unknown, mark: unknown) => {
    if (!isCardKey(key)) return;
    const archivedCards = setMark(getSettings().archivedCards, key, mark);
    if (archivedCards) updateSettings({ archivedCards });
  });
  ipcMain.on('fly-show', (e, request: unknown) => {
    if (e.sender === win?.webContents && isFlyRequest(request)) flyout?.show(request);
  });
  ipcMain.on('fly-update', (e, key: unknown, content: unknown, count: unknown) => {
    if (e.sender === win?.webContents && typeof key === 'string' && isContent(content) && typeof count === 'number') flyout?.update(key, content, count);
  });
  ipcMain.on('fly-targets', (e, targets: unknown) => {
    if (e.sender === win?.webContents && isFlyTargets(targets)) flyout?.setTargets(targets);
  });
  ipcMain.on('fly-leave', (e, key: unknown) => {
    if (e.sender === win?.webContents && typeof key === 'string') flyout?.leave(key);
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
  win.on('move', () => {
    hideTip();
    flyout?.hide();
  });
  win.on('resize', () => {
    hideTip();
    flyout?.hide();
  });
  win.on('hide', () => {
    hideTip();
    flyout?.setWidgetVisible(false);
  });
  // めくれのウィンドウはウィジェットと一緒に出したままにする（乗せるたびに出すと、Windows の表示のアニメーションがかかる）
  win.on('show', () => flyout?.setWidgetVisible(true));
  if (win.isVisible()) flyout.setWidgetVisible(true);

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
    stopSelfUpdate();
    globalShortcut.unregisterAll();
    stopForegroundProbe();
    tray?.destroy();
  });
});

app.on('window-all-closed', () => app.quit());

/**
 * メインプロセスで拾われなかった例外は、ダイアログにせず記録だけにする。
 * Electron の既定ではダイアログが出て、タイマーの中の例外だと閉じてもすぐ同じものが出続ける
 */
process.on('uncaughtException', (e) => console.error('拾われなかった例外：', e));
process.on('unhandledRejection', (e) => console.error('拾われなかった Promise の失敗：', e));

// 二重起動を防ぐ
if (!app.requestSingleInstanceLock()) {
  if (process.env.WIDGET_FIXTURE) console.error('同じデータフォルダのウィジェットがもう動いています');
  app.quit();
}
