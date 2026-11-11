// サイドバー型ウィジェットのメインプロセス。画面の端に、枠のない透明なウィンドウを置く。
// 背景の色と濃さは画面側（CSS）で塗る。透明なウィンドウには Mica を使えない。

import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeTheme, Notification, powerMonitor, screen, shell, Tray, type Display } from 'electron';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAppBar, type AppBar } from './appbar';
import { areaWithoutBar, barOverhang, placeWidget, type PlacedBar } from './appbar-place';
import { createBezel, type Bezel } from './bezel';
import { bezelArea, bezelParts } from './bezel-place';
import { createFlyout, isContent, isFlyRequest, isFlyTargets, type Flyout } from './flyout';
import { foregroundProcessName, raiseClaudeWindow, sendOpenToClaude, startForegroundProbe, stopForegroundProbe } from './foreground';
import { createGitFetch, type FetchTarget } from './git-fetch';
import { createGitStatus } from './git-status';
import { cardFolder, isFolder, openTerminal } from './open-folder';
import { OPEN_SETTINGS_ARG, relaunchArgs } from './relaunch';
import { startSelfUpdate } from './self-update';
import { createSystemUsage } from './system-usage';
import { copyableId } from './session-id';
import { desktopDataFolders, folderKey, InterruptTracker, readFixtureHolds, readSessions, sessionDataFolders, watchSessions } from './sessions';
import { getSettings, onSettingsChange, settingsFilePath, updateSettings } from './settings-store';
import { scaleRect, tipBounds } from './tip-place';
import { createViewer, type Viewer } from './viewer';
import { liveViewerKeys, resolveViewerTarget, type ViewerFs } from './viewer-target';
import { worktreeAppUserModelId, worktreeInitialSettings, worktreeName, worktreeUserData, type GitEntry } from './worktree';
import { cardKeyOf } from '../shared/card-key';
import { SESSION_KEY_ID, clampWidth, isCardKey, widthLimit, normalizeHold, type ArchiveMark, type HoldMark, type Settings, type WindowBounds } from '../shared/settings';
import { DISPLAY_SETTLE_MS, PRIMARY, RESUME_SETTLE_MS, currentChoice, displayChoices, migrateLegacyDisplay, pickMonitor, rememberChoice, settleTimers } from '../shared/display-layout';
import { ja } from '../shared/strings/ja';
import type { AboutInfo, DisplayChoices, SessionView, TipRect, ToastRequest, ViewerState, WidgetLayout } from '../shared/types';

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
/** WM_COPYDATA を送ってから、Claude が前に出たかを確かめるまでの時間 */
const FRONT_CHECK_MS = 400;
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
/**
 * アプリバー（appbar.ts）。固定（pinned）がオンで、ウィジェットが見えている間だけ登録し、ほかのウィンドウの最大化で重ならないようにする。
 * appBarRect は登録している帯の場所（画面の座標）。fullscreenApp は全画面のアプリが開いている間（最前面を一時的に外す）
 */
let appBar: AppBar | undefined;
let appBarRect: PlacedBar | undefined;
let fullscreenApp = false;
/** アイランド型の縁取り（帯のない 3 辺の黒い線と角丸）。最前面に固定してアプリバーにしている間だけ出す */
let bezel: Bezel | undefined;
/** 本当に終わるところ（トレイの「終了」、OS のシャットダウン）。立っていないときは、ウィジェットを閉じずに隠す */
let quitting = false;
/** 出しているトースト。変数に持っておかないと、ガベージコレクションでクリックが届かなくなる */
const toasts = new Set<Notification>();
/**
 * リモートの定期的な取得（docs/design/git-fetch.md）。設定でオンにしたときだけ動く。
 * 取得が終わったら、そのリポジトリの作業フォルダを調べ直す。様子が変わったら設定画面に送る
 */
const gitFetch = createGitFetch(
  (commonDir) => {
    gitStatus.invalidate(commonDir);
    sendSessions();
  },
  () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('fetch:status', gitFetch.status());
  },
);
/** 取得の時刻が来たかを見る間隔 */
const FETCH_TICK_MS = 15_000;
/** 作業フォルダごとのコミットされていない変更。調べ終えて結果が変わったら、一覧を送り直す */
const gitStatus = createGitStatus(() => sendSessions(), undefined, undefined, undefined, undefined, () => {
  const s = getSettings();
  return { fetchEnabled: s.gitFetch, countUntracked: s.countUntracked, remoteOf: (commonDir) => gitFetch.remoteOf(commonDir) };
});
/** 最後に読んだセッションの一覧と、画面が出している（アーカイブしていない）カードの目印。取得の対象を決めるのに使う */
let lastSessions: SessionView[] = [];
let fetchCards = new Set<string>();
/** 画面から出しているカードの目印が一度でも届いたか（届くまでは、アーカイブしたカードを見分けられない） */
let fetchCardsKnown = false;
/** HTML ビューア（viewer.ts）と、画面が今開いているセッション */
let viewer: Viewer | undefined;
let viewerTargetId: string | undefined;
/** 前に当てた git の設定（変わったときだけ調べ直す） */
let appliedGit: Pick<Settings, 'gitFetch' | 'countUntracked'> | undefined;

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

/**
 * GPU（ハードウェア アクセラレーション）を使うか。app の ready より前にしか切り替えられないので、起動したときの設定で決める。
 * 設定を変えたら起動し直す（docs/design/gpu.md）。データフォルダを決めたあとに読む（ワークツリー版と見本データは設定が別）
 */
const HARDWARE_ACCELERATION = getSettings().hardwareAcceleration;
if (!HARDWARE_ACCELERATION) app.disableHardwareAcceleration();

/** トレイと設定ウィンドウに出す名前。ワークツリー版はワークツリー名を添えて、いつものウィジェットと見分ける */
const APP_LABEL = WORKTREE ? ja.app.worktreeLabel(WORKTREE) : ja.app.name;

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

/**
 * ウィジェットを置くモニター。モニターの接続状態（構成）ごとに覚えた選択を使い、覚えがなければメインのモニター。
 * 構成の見分け方は display-layout.ts
 */
function targetDisplay(s: Settings): Display {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const id = pickMonitor(currentChoice(s, all), all, primary.id);
  return all.find((d) => d.id === id) ?? primary;
}

/** 古い版の単一のモニターの設定を、今の構成の覚えに移す（その id のモニターが今つながっているときだけ） */
function migrateDisplaySetting() {
  const migrated = migrateLegacyDisplay(getSettings(), screen.getAllDisplays());
  if (migrated) updateSettings(migrated);
}

/**
 * ウィジェットを置く作業領域。アプリバーとして登録している間は、Windows の作業領域からウィジェット自身の分が引かれるので、
 * その分を足し戻す（ツールチップ、めくれ、幅の上限もこれを使う）
 */
function widgetArea(s: Settings) {
  const d = targetDisplay(s);
  return areaWithoutBar(d.workArea, d.bounds, appBarRect);
}

/** ウィジェットの幅。ドラッグ中はその幅 */
function widgetWidth(s: Settings): number {
  return Math.min(dragWidth ?? s.width, widthLimit(widgetArea(s).width));
}

function sidebarBounds() {
  const s = getSettings();
  return placeWidget(s.edge, widgetArea(s), widgetWidth(s), appBarRect);
}

/** 最前面にするか。固定していても、全画面のアプリが開いている間は外す */
function applyAlwaysOnTop(s: Settings) {
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(s.pinned && !fullscreenApp);
}

/**
 * アプリバーにする場所。固定がオンで、ウィジェットが見えている間だけ。
 * 幅はドラッグ中の幅ではなく保存した幅にし、離したとき（設定に保存したとき）に置き直す。ドラッグ中に帯を動かすと、
 * 作業領域が変わるたびに Windows がウィジェットを新しい作業領域の中へ押し込み、こちらが戻すのとで点滅する
 */
function appBarWanted() {
  const s = getSettings();
  if (!s.pinned || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return undefined;
  // アイランド型では、角丸の透明な列の分は取らない（列は隣のウィンドウに重ねる。barOverhang）
  const width = Math.min(s.width, widthLimit(widgetArea(s).width)) - barOverhang(s.island, s.zoom / 100);
  return { edge: s.edge, monitor: targetDisplay(s).bounds, width };
}

/**
 * アイランド型の縁取りを、今の状態に合わせて出す・隠す。アイランド型で、最前面に固定してアプリバーにしていて、
 * ウィジェットが見えていて、全画面のアプリが開いていない間だけ出す。作業領域はアプリバーの分が引かれたもの（Windows の値のまま）
 */
function syncBezel() {
  if (!bezel) return;
  const s = getSettings();
  const visible = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  if (!s.island || !s.pinned || !appBarRect || fullscreenApp || !visible) return bezel.hide();
  const d = targetDisplay(s);
  bezel.show(bezelParts(s.edge, bezelArea(s.edge, d.workArea, appBarRect), barOverhang(true, s.zoom / 100)));
}

/**
 * アプリバーが動いたあと、少し待ってから縁取りを出し直す。
 * - すぐには引かない。帯の幅を変えると、Windows がウィジェットを作業領域の中へ一瞬押し込み、keepAppBarBounds が戻す。
 *   縁取りの窓を作り直すあいだはメインのプロセスが止まり、戻すのが 0.1 秒ほど遅れて、ウィジェットが動いて見えた。戻し終えてから引く
 * - 作業領域（上下と反対側の辺）は Windows が少し遅れて変えるので、落ち着いたころにもう一度引く
 */
let bezelSoon: NodeJS.Timeout | undefined;
let bezelSettle: NodeJS.Timeout | undefined;
function syncBezelLater() {
  if (bezelSoon) clearTimeout(bezelSoon);
  if (bezelSettle) clearTimeout(bezelSettle);
  bezelSoon = setTimeout(() => {
    bezelSoon = undefined;
    syncBezel();
  }, 120);
  bezelSettle = setTimeout(() => {
    bezelSettle = undefined;
    syncBezel();
  }, 500);
}

/**
 * 幅を変えて離したときに、押し込まれた場所を見せないよう、ウィジェットを一瞬透明にする（keepAppBarBounds の押し込み）。
 * アプリバーの場所が決まって戻したら（onPlaced）出し直す。決まらなかったときのために、少し待っても出し直す
 */
let veilTimer: NodeJS.Timeout | undefined;
function veilWidget() {
  if (!win || win.isDestroyed()) return;
  win.setOpacity(0);
  if (veilTimer) clearTimeout(veilTimer);
  veilTimer = setTimeout(unveilWidget, 400);
}
function unveilWidget() {
  if (veilTimer) clearTimeout(veilTimer);
  veilTimer = undefined;
  if (!win || win.isDestroyed() || win.getOpacity() === 1) return;
  win.setOpacity(1);
}

/**
 * アプリバーを登録している間に、ウィジェットがこちらの置いた場所から動かされたら戻す。
 * 帯の分だけ作業領域が縮むと、Windows がウィジェットを作業領域の中へ押し込むことがある
 */
function keepAppBarBounds() {
  if (!appBarRect || !win || win.isDestroyed()) return;
  const want = sidebarBounds();
  const now = win.getBounds();
  if (Math.abs(now.x - want.x) > 1 || Math.abs(now.width - want.width) > 1) {
    // 帯の幅を変えると、作業領域が変わったときに Chromium がウィンドウを作業領域の左上の動いた分だけずらす（押し込み）。
    // 押し込まれた直後（move の中や WM_WINDOWPOSCHANGED の中）に setBounds しても同じだけずらされて戻らず、
    // アプリバーの場所が決まったあと（onPlaced のころ）にやっと戻る。ここでは move の処理を終えてから戻す。
    // 戻るまでの 40 ms ほどは押し込まれた場所が見える（アイランド型より前からある動き）。幅を変えたときは veilWidget で透明にして隠す
    setImmediate(() => {
      if (!win || win.isDestroyed()) return;
      win.setBounds(sidebarBounds());
    });
  }
}

/**
 * クリックを後ろのウィンドウへ通すことがあるか。背景が 0% のときは枠の外、アイランド型のときは帯の内側の角丸の分（帯の外の透明なところ）を通す。
 * アイランド型では背景を塗らないので、背景の不透明度にかかわらずこちらに従う
 */
function canClickThrough(s: Settings): boolean {
  return s.island || s.backgroundOpacity === 0;
}

function widgetLayout(s: Settings): WidgetLayout {
  const { edge, island, backgroundOpacity, cardOpacity, headerShade, activeHighlight, pinned, mainArchiveMinutes, projectOrder, worktreeOrder, sessionOrder, rowPadding, showUpdated, showState, showContext, showSystemUsage, archive, archivedCards, holds, heldCards } = s;
  const { notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen, statusColors, motion, tooltipDelayMs, showChanges } = s;
  const { viewerEnabled, viewerPath, viewerAutoHeight, viewerHeight, viewerCollapsed } = s;
  return {
    edge, island, backgroundOpacity, cardOpacity, headerShade, activeHighlight, pinned, mainArchiveMinutes, projectOrder, worktreeOrder, sessionOrder, rowPadding, showUpdated, showState, showContext, showSystemUsage, archive, archivedCards, holds, heldCards,
    notifyWaiting, notifyDone, sound, soundType, soundVolume, toast, flash, muteWhenOpen, statusColors, motion, tooltipDelayMs, showChanges,
    viewerEnabled, viewerPath, viewerAutoHeight, viewerHeight, viewerCollapsed,
  };
}

/**
 * テーマをすべてのウィンドウに当てる。画面の CSS は prefers-color-scheme のままで、themeSource を変えると
 * 開いているウィンドウ（ウィジェット・設定・一覧・ツールチップ）の見た目がすぐ切り替わる
 */
function applyTheme(s: Settings) {
  if (nativeTheme.themeSource !== s.theme) nativeTheme.themeSource = s.theme;
}

/** 一覧（めくれ）の状態の色と、今開いている行の強調の濃さと、アニメーション効果。ウィジェットには layout で届く */
function sendFlyoutColors() {
  const w = flyout?.window();
  const { statusColors, activeHighlight, motion, island } = getSettings();
  if (w && !w.isDestroyed()) w.webContents.send('fly:colors', statusColors, activeHighlight, motion, island);
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
  viewer?.applyZoom();
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
  applyAlwaysOnTop(s);
  // 固定、端、幅、モニターが変わったら、アプリバーを登録し直す（または外す）
  appBar?.sync();
  // アイランド型や拡大率が変わったら、縁取りを出し直す（アプリバーの場所が変わったときは onPlaced からも呼ぶ）
  syncBezel();
  // 背景を見せるなら、クリックを後ろへ通すのをやめる（通すかどうかは、背景が 0% のときとアイランド型のときに画面側が決める）
  if (!canClickThrough(s)) win.setIgnoreMouseEvents(false);
  win.webContents.send('layout', widgetLayout(s));
  updateSystemUsage();
}

/** タイトルバーの CPU とメモリ。取得のタイマーは 1 つだけで、出す設定で、ウィジェットが見えている間だけ動かす */
const systemUsage = createSystemUsage((usage) => {
  if (win && !win.isDestroyed()) win.webContents.send('system-usage', usage);
});

function updateSystemUsage() {
  const shown = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  systemUsage.setActive(shown && getSettings().showSystemUsage);
}

/** 設定画面のモニターの選択肢。値はメインが 'primary'、ほかはモニターのしるし（抜き差しで変わる id は使わない） */
function displayOptions(): DisplayChoices {
  const all = screen.getAllDisplays();
  const { values, selected } = displayChoices(getSettings(), all, screen.getPrimaryDisplay().id);
  const options = values.map(({ id, value }, i) => {
    if (value === PRIMARY) return { id: value, label: ja.monitor.primary };
    const d = all.find((x) => x.id === id)!;
    return { id: value, label: ja.monitor.other(i + 1, d.size.width, d.size.height) };
  });
  return { options, selected };
}

// ---- ウィンドウ ----

function createWidget(): BrowserWindow {
  const w = new BrowserWindow({
    ...sidebarBounds(),
    frame: false,
    resizable: false,
    movable: false,
    // タスクバーのボタンのクリックで、最小化と元に戻すを切り替える
    minimizable: true,
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
  // タスクバーなどから閉じても、終わらずにトレイへ隠れる。本当に閉じるのは終了するときだけ
  // Windows のシャットダウンやサインアウトでは before-quit が来ないので、ここで目印を立てる（止めるとシャットダウンを妨げる）
  w.on('session-end', () => {
    quitting = true;
  });
  w.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide();
  });
  // ウィジェットが動いたり大きさが変わったりしたら、置き場所がずれるので消す
  w.on('move', () => {
    hideTip();
    flyout?.hide();
    keepAppBarBounds();
  });
  w.on('resize', () => {
    hideTip();
    flyout?.hide();
  });
  // 隠したときと最小化したときは、ツールチップとめくれも隠す
  const hidden = () => {
    hideTip();
    flyout?.setWidgetVisible(false);
  };
  w.on('hide', hidden);
  w.on('minimize', hidden);
  // めくれのウィンドウはウィジェットと一緒に出したままにする（乗せるたびに出すと、Windows の表示のアニメーションがかかる）
  w.on('show', () => flyout?.setWidgetVisible(true));
  w.on('restore', () => flyout?.setWidgetVisible(true));
  // CPU とメモリの取得は、見えている間だけ
  w.on('show', updateSystemUsage);
  w.on('hide', updateSystemUsage);
  w.on('minimize', updateSystemUsage);
  w.on('restore', updateSystemUsage);
  // 隠したときと最小化したときはアプリバーを外し、出したら登録し直す
  const syncAppBar = () => {
    appBar?.sync();
    syncBezel();
  };
  w.on('show', syncAppBar);
  w.on('hide', syncAppBar);
  w.on('minimize', syncAppBar);
  w.on('restore', syncAppBar);
  // 読み込み直したら、最後の値を送り直す（値が変わるまで送らないため）
  w.webContents.on('did-finish-load', () => {
    const last = systemUsage.last();
    if (last && getSettings().showSystemUsage) w.webContents.send('system-usage', last);
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
  tipWin.setBounds(tipBounds(s.edge, win.getBounds(), widgetArea(s), scaleRect(tipAnchor, zoom), size, zoom));
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
    title: ja.window.settings(APP_LABEL),
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

/** ウィジェットを前に出す（固定を外して後ろに回ったとき、最小化したとき、閉じてトレイに隠れたときに使う） */
function showWidget() {
  // ふつうは閉じても隠れるだけだが、万一なくなっていたら作り直す（表示は ready-to-show で行う）
  if (!win || win.isDestroyed()) {
    win = createWidget();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.moveTop();
  win.focus();
}

/** タスクトレイのアイコン。クリックでウィジェットを前に出し、右クリックで表示、設定、終了 */
function createTray(): Tray {
  const t = new Tray(ICON);
  t.setToolTip(APP_LABEL);
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: ja.tray.show, click: () => showWidget() },
      { label: ja.tray.settings, click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: ja.tray.quit, click: () => app.quit() },
    ]),
  );
  t.on('click', () => showWidget());
  return t;
}

/**
 * カードの見出しの右クリックメニュー。作業フォルダは画面から受け取らず、セッションから探す（画面が任意のパスを開けないように）。
 * フォルダがわからない、またはもうないときは、項目を押せなくする
 */
function showCardMenu(key: string) {
  if (!win || win.isDestroyed()) return;
  const dir = cardFolder(lastSessions, key);
  const enabled = !!dir && isFolder(dir);
  Menu.buildFromTemplate([
    {
      label: ja.menu.openInExplorer,
      enabled,
      click: () => {
        if (dir) void shell.openPath(dir).then((err) => err && console.error(`フォルダを開けませんでした: ${err}`));
      },
    },
    { label: ja.menu.openInTerminal, enabled, click: () => dir && openTerminal(dir) },
  ]).popup({ window: win });
}

/**
 * セッションの行（ウィジェットと一覧）の右クリックメニュー。画面から受け取った ID は、今知っているセッションにあるときだけコピーする。
 * `local_` の ID がないときは、項目を押せなくする
 */
function showSessionMenu(target: BrowserWindow, rawId: unknown) {
  if (target.isDestroyed()) return;
  const id = copyableId(lastSessions, rawId);
  Menu.buildFromTemplate([
    { label: ja.menu.copySessionId, enabled: !!id, click: () => id && clipboard.writeText(id) },
  ]).popup({ window: target });
}

/** ウィジェットのタイトルの右クリックメニュー */
function showTitleMenu() {
  if (!win || win.isDestroyed()) return;
  Menu.buildFromTemplate([{ label: ja.menu.quit, click: () => app.quit() }]).popup({ window: win });
}

/** カーソルの位置から、内側の端がそこに来る幅を出す。作業領域の半分で止める（見た目の幅と合わせる） */
function widthAtCursor(): number {
  const s = getSettings();
  const area = widgetArea(s);
  const cursor = screen.getCursorScreenPoint();
  const w = s.edge === 'left' ? cursor.x - area.x : area.x + area.width - cursor.x;
  // アイランド型では取っ手が帯の内側の端（ウィンドウの端から角丸の列の分だけ内側）にあるので、列の分を足してウィンドウの幅にする
  return clampWidth(w + barOverhang(s.island, s.zoom / 100), area.width);
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

/**
 * セッションを開く。claude:// リンクだと毎回 claude.exe がもう 1 つ起動するので（ウイルス対策の検査で遅れることがある）、
 * 本体に WM_COPYDATA を直接送って切り替える。送れなかったとき（ウィンドウがない、結果が 0、PowerShell が使えない、
 * 時間切れ）だけリンクで開く。時間切れのあとで送られた場合は同じセッションに 2 回切り替わるだけで、害はない
 */
async function openSession(id: unknown) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return;
  if (await sendOpenToClaude(id, desktopDataFolders())) {
    // 本体はふつう自分で前に出る。出なかったときだけ、あとから前に出す
    await new Promise((r) => setTimeout(r, FRONT_CHECK_MS));
    if (!(await claudeInFront())) await raiseClaudeWindow();
    return;
  }
  shell.openExternal(`claude://claude.ai/epitaxy/${id}`);
}

/**
 * もう開いているセッションの Claude のウィンドウを前に出す。
 * リンクだと 2 つ目の claude.exe が起動して URL を渡すまでに約 260 ms かかるので、直接前に出す。
 * 前に出せなかったとき（Windows に断られた、PowerShell が使えない）は、openSession で開き直す
 */
async function raiseSession(id: unknown) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return;
  if (!(await raiseClaudeWindow())) await openSession(id);
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
    else void openSession(t.id);
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

/**
 * 起動し直す。before-quit の片付け（トレイのアイコンなど）を通すため、exit ではなく quit で終える。
 * openSettings なら、起動し直したあとに設定ウィンドウを開く（設定を変えて起動し直したとき）
 */
function relaunch(openSettings = false) {
  app.relaunch({ args: relaunchArgs(app.isPackaged, app.getAppPath(), openSettings) });
  app.quit();
}

/** 切り替えの失敗などを、トレイのツールチップと Windows の通知で伝える。undefined でツールチップを戻す */
function updateNotice(message: string | undefined) {
  tray?.setToolTip(message ? `${APP_LABEL}\n${message}` : APP_LABEL);
  if (!message) return;
  console.log(message);
  if (Notification.isSupported()) new Notification({ title: APP_LABEL, body: message, icon: ICON }).show();
}

/** ビューアが読むファイル。realpath をとる（リンクをたどった先が作業フォルダの中かを確かめるため） */
const viewerFs: ViewerFs = {
  realFile: (path) => {
    try {
      return statSync(path).isFile() ? realpathSync.native(path) : undefined;
    } catch {
      return undefined;
    }
  },
  realDir: (path) => {
    try {
      return statSync(path).isDirectory() ? realpathSync.native(path) : undefined;
    } catch {
      return undefined;
    }
  },
};

/** HTML ビューアに出すものを決め直す（一覧、設定、出しているカード、開いているセッションが変わったとき） */
function refreshViewer(force = false) {
  if (!viewer) return;
  const s = getSettings();
  const shown = fetchCardsKnown ? fetchCards : undefined;
  if (!s.viewerEnabled) {
    viewer.update({ state: { kind: 'off' } }, new Set(), s.viewerAutoReload, force);
    return;
  }
  const session = viewerTargetId ? lastSessions.find((x) => x.id === viewerTargetId) : undefined;
  viewer.update(resolveViewerTarget(session, s.viewerPath, shown, viewerFs), liveViewerKeys(lastSessions, shown), s.viewerAutoReload, force);
}

function isViewerRect(v: unknown): v is TipRect {
  return isTipRect(v) && v.width >= 0 && v.height >= 0;
}

/** 中断（処理中か対応待ちのまま止まった）の見分け。ウィジェットが動いている間に見た変化で決める */
const interrupts = new InterruptTracker();

/** 前回と同じ内容なら送らない（画面の描き直しを減らす） */
function sendSessions(force = false) {
  if (!win || win.isDestroyed()) return;
  // 見本データの作業フォルダ（HTML ビューアの見本）では git を動かさない。見本の changes をそのまま見せる
  const sessions = interrupts.apply(process.env.WIDGET_FIXTURE ? readSessions() : gitStatus.apply(readSessions()));
  lastSessions = sessions;
  updateFetchTargets();
  refreshViewer();
  const json = JSON.stringify(sessions);
  if (!force && json === lastSent) return;
  lastSent = json;
  win.webContents.send('sessions', sessions);
  // 一覧から消えた（デスクトップでアーカイブや削除された）セッションとカードは、アーカイブと保留の印からも外す。読めずに空のときは外さない
  if (sessions.length) {
    const { archive, archivedCards, holds, heldCards } = getSettings();
    const ids = new Set(sessions.map((s) => s.id));
    const cardKeys = new Set(sessions.map(cardKeyOf));
    const patch: Partial<Settings> = {};
    const keptSessions = pruneMarks(archive, ids);
    if (keptSessions) patch.archive = keptSessions;
    const keptCards = pruneMarks(archivedCards, cardKeys);
    if (keptCards) patch.archivedCards = keptCards;
    const keptHolds = pruneMarks(holds, ids);
    if (keptHolds) patch.holds = keptHolds;
    const keptHeldCards = pruneMarks(heldCards, cardKeys);
    if (keptHeldCards) patch.heldCards = keptHeldCards;
    if (Object.keys(patch).length) updateSettings(patch);
  }
}

/**
 * 取得するリポジトリ：出しているカードのセッションがあるリポジトリ（commonDir ごとに 1 つ）。
 * git は元のフォルダで動かす（元のフォルダのカードがなければ、ワークツリーで）。見本データのときは取得しない
 */
function updateFetchTargets() {
  if (process.env.WIDGET_FIXTURE) return;
  const byRepo = new Map<string, FetchTarget>();
  for (const s of lastSessions) {
    if (!s.commonDir || !s.workDir || !s.mainBranch || !fetchCards.has(cardKeyOf(s))) continue;
    const key = folderKey(s.commonDir);
    if (!byRepo.has(key) || !s.worktree) byRepo.set(key, { commonDir: key, dir: s.workDir, branch: s.mainBranch, name: s.repoName });
  }
  gitFetch.setTargets([...byRepo.values()]);
}

/** git の設定を当てる。取得のオンとオフ、未追跡を数えるかが変わったら、すべての作業フォルダを調べ直す */
function applyGitSettings(s: Settings) {
  gitFetch.setOptions({ enabled: s.gitFetch, minutes: s.gitFetchMinutes });
  const changed = appliedGit && (appliedGit.gitFetch !== s.gitFetch || appliedGit.countUntracked !== s.countUntracked);
  appliedGit = { gitFetch: s.gitFetch, countUntracked: s.countUntracked };
  if (!changed) return;
  gitStatus.invalidate();
  sendSessions(true);
}

/** 今ない目印の印を外す。外すものがなければ undefined */
function pruneMarks<T>(marks: Record<string, T>, keys: ReadonlySet<string>): Record<string, T> | undefined {
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

/** 保留の印を付けるか外す（null で外す）。印の形が合わなければ undefined */
function setHoldMark(marks: Record<string, HoldMark>, key: string, mark: unknown): Record<string, HoldMark> | undefined {
  const hold = mark === null ? null : normalizeHold(mark);
  if (hold === undefined) return undefined;
  const next = { ...marks };
  if (hold === null) delete next[key];
  else next[key] = hold;
  return next;
}

// ---- 起動 ----

app.whenReady().then(() => {
  // 見本データに書いた保留を、見本データ用の設定に入れる（設定にもうある印はそのまま）
  if (process.env.WIDGET_FIXTURE) {
    const seed = readFixtureHolds(process.env.WIDGET_FIXTURE);
    const { holds, heldCards } = getSettings();
    updateSettings({ holds: { ...seed.holds, ...holds }, heldCards: { ...seed.heldCards, ...heldCards } });
  }
  applyTheme(getSettings());
  win = createWidget();
  bezel = createBezel();
  appBar = createAppBar({
    window: () => win,
    wanted: appBarWanted,
    onPlaced: (bar) => {
      appBarRect = bar;
      if (win && !win.isDestroyed()) win.setBounds(sidebarBounds());
      // 戻した場所が描かれてから出し直す（同じ処理の中で出すと、押し込まれた場所の絵が一瞬見えた）
      if (veilTimer) setTimeout(unveilWidget, 16);
      syncBezelLater();
    },
    onFullscreen: (on) => {
      fullscreenApp = on;
      applyAlwaysOnTop(getSettings());
      syncBezel();
    },
  });
  tipWin = createTipWindow();
  flyout = createFlyout({
    preload: PRELOAD,
    web: WEB,
    widget: () => win,
    edge: () => getSettings().edge,
    area: () => widgetArea(getSettings()),
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
  applyGitSettings(getSettings());
  const fetchTimer = setInterval(() => gitFetch.tick(), FETCH_TICK_MS);
  const stopSelfUpdate = SELF_UPDATE ? startSelfUpdate(app.getAppPath(), { reload: reloadWindows, relaunch: () => relaunch(), notice: updateNotice }) : () => {};
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
  if (process.argv.includes(OPEN_SETTINGS_ARG)) openSettingsWindow();

  ipcMain.on('open-session', (_e, id: unknown) => void openSession(id));
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
    // アプリバーの幅が変わると、Chromium がウィジェットを一瞬押し込む。そのあいだ透明にして隠す
    if (appBarRect && width !== getSettings().width) veilWidget();
    updateSettings({ width });
  });
  ipcMain.on('set-click-through', (_e, value: unknown) => {
    // forward: true で、クリックは通してもマウスの移動は画面側に届き続ける（カードに乗ったら戻せる）
    if (canClickThrough(getSettings())) win?.setIgnoreMouseEvents(value === true, { forward: true });
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
  ipcMain.on('set-hold', (_e, id: unknown, mark: unknown) => {
    if (typeof id !== 'string' || !SESSION_KEY_ID.test(id)) return;
    const holds = setHoldMark(getSettings().holds, id, mark);
    if (holds) updateSettings({ holds });
  });
  ipcMain.on('set-card-hold', (_e, key: unknown, mark: unknown) => {
    if (!isCardKey(key)) return;
    const heldCards = setHoldMark(getSettings().heldCards, key, mark);
    if (heldCards) updateSettings({ heldCards });
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

  ipcMain.on('card-menu', (e, key: unknown) => {
    if (e.sender === win?.webContents && typeof key === 'string') showCardMenu(key);
  });
  // 行の右クリック。ウィジェットと一覧（めくれ）のどちらからも受け取る
  ipcMain.on('session-menu', (e, id: unknown) => {
    const target = [win, flyout?.window()].find((w) => w && !w.isDestroyed() && e.sender === w.webContents);
    if (target) showSessionMenu(target, id);
  });
  ipcMain.on('title-menu', (e) => {
    if (e.sender === win?.webContents) showTitleMenu();
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
  // ウィジェットのイベント（隠す・最小化など）は createWidget で登録する。めくれより先に出ていたときだけ、ここで知らせる
  if (win.isVisible() && !win.isMinimized()) flyout.setWidgetVisible(true);

  // HTML ビューア（docs/design/html-viewer.md）。画面からはセッションの ID と場所だけを受け取り、パスはこちらで引く
  viewer = createViewer({
    window: () => win,
    zoom: zoomFactor,
    pageZoom: () => getSettings().viewerZoom / 100,
    dark: () => nativeTheme.shouldUseDarkColors,
    onState: (state: ViewerState) => {
      if (win && !win.isDestroyed()) win.webContents.send('viewer:state', state);
    },
    refresh: () => refreshViewer(),
  });
  nativeTheme.on('updated', () => viewer?.applyTheme());
  ipcMain.on('viewer-target', (e, id: unknown) => {
    if (e.sender !== win?.webContents) return;
    if (id !== null && (typeof id !== 'string' || !SESSION_KEY_ID.test(id))) return;
    viewerTargetId = id ?? undefined;
    refreshViewer(true);
  });
  ipcMain.on('viewer-bounds', (e, rect: unknown) => {
    if (e.sender !== win?.webContents) return;
    if (rect === null) viewer?.setBounds(undefined);
    else if (isViewerRect(rect)) viewer?.setBounds(rect);
  });
  ipcMain.on('viewer-reload', (e) => {
    if (e.sender !== win?.webContents) return;
    // ファイルができた・消えたも拾う
    refreshViewer();
    viewer?.reload();
  });
  ipcMain.on('viewer-open-external', (e) => {
    if (e.sender === win?.webContents) viewer?.openExternal();
  });
  ipcMain.on('viewer-layout', (e, patch: unknown) => {
    if (e.sender !== win?.webContents || !patch || typeof patch !== 'object') return;
    const { viewerHeight, viewerAutoHeight, viewerCollapsed } = patch as Record<string, unknown>;
    const next: Partial<Settings> = {};
    if (typeof viewerHeight === 'number' && Number.isFinite(viewerHeight)) next.viewerHeight = viewerHeight;
    if (typeof viewerAutoHeight === 'boolean') next.viewerAutoHeight = viewerAutoHeight;
    if (typeof viewerCollapsed === 'boolean') next.viewerCollapsed = viewerCollapsed;
    if (Object.keys(next).length) updateSettings(next);
  });

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('layout:get', () => widgetLayout(getSettings()));
  ipcMain.on('settings:set', (_e, patch: unknown) => {
    if (patch && typeof patch === 'object') updateSettings(patch as Partial<Settings>);
  });
  ipcMain.handle('settings:displays', () => displayOptions());
  ipcMain.on('settings:set-display', (_e, value: unknown) => {
    if (typeof value !== 'string' || !value || value.length > 300) return;
    updateSettings(rememberChoice(getSettings(), screen.getAllDisplays(), value));
  });
  ipcMain.on('settings:action', (_e, id: unknown) => {
    if (id === 'gitFetchNow') gitFetch.fetchNow();
  });
  ipcMain.handle('fetch:status', () => gitFetch.status());
  ipcMain.on('fetch-cards', (_e, keys: unknown) => {
    if (!Array.isArray(keys) || !keys.every(isCardKey)) return;
    fetchCards = new Set(keys);
    fetchCardsKnown = true;
    updateFetchTargets();
    refreshViewer();
  });
  ipcMain.handle('settings:about', (): AboutInfo => ({
    version: app.getVersion(),
    settingsFile: settingsFilePath(),
    dataFolders: sessionDataFolders(),
    packaged: LOGIN_ITEM_AVAILABLE,
  }));

  readLoginItem();
  onSettingsChange((s) => {
    // GPU の設定は起動し直さないと効かない。設定ウィンドウを開いたまま起動し直す
    if (s.hardwareAcceleration !== HARDWARE_ACCELERATION) {
      relaunch(true);
      return;
    }
    applySettings(s);
    applyLoginItem(s);
    applyGitSettings(s);
    refreshViewer();
    settingsWin?.webContents.send('settings:changed', s);
  });

  // 画面の構成や作業領域が変わったら、端に置き直す。モニターの構成が変わったら、その構成で覚えたモニターへ移る
  migrateDisplaySetting();
  const reposition = () => {
    migrateDisplaySetting();
    if (win && !win.isDestroyed()) win.setBounds(sidebarBounds());
    appBar?.sync();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:displays-changed');
  };
  // つないだ・外した直後は、モニターの一覧や作業領域が何度か続けて変わる。すぐ置き直し、落ち着いたころにもう一度読み直す
  const settle = settleTimers(reposition);
  screen.on('display-metrics-changed', () => {
    if (win && !win.isDestroyed()) win.setBounds(sidebarBounds());
    appBar?.sync();
    // タスクバーが動いたなど、アプリバーの場所は同じでも作業領域が変わることがある。
    // 帯の幅を変えたときもここへ来る。すぐ作り直すとメインのプロセスが 0.1 秒ほど止まり、ウィジェットを戻すのが遅れるので、少し待つ
    syncBezelLater();
  });
  screen.on('display-added', () => { reposition(); settle(DISPLAY_SETTLE_MS); });
  screen.on('display-removed', () => { reposition(); settle(DISPLAY_SETTLE_MS); });
  // スタンバイからの復帰やロックの解除のあとは、モニターがつながり直すまで時間がかかる。何度か間をあけて読み直す
  powerMonitor.on('resume', () => settle(RESUME_SETTLE_MS));
  powerMonitor.on('unlock-screen', () => settle(RESUME_SETTLE_MS));

  app.on('before-quit', () => {
    stopWatching();
    clearInterval(fetchTimer);
    systemUsage.setActive(false);
    stopSelfUpdate();
    globalShortcut.unregisterAll();
    stopForegroundProbe();
    bezel?.destroy();
    // アプリバーを外す（外さないと、ほかのウィンドウの最大化が帯の分だけ狭いまま残る）
    appBar?.stop();
    tray?.destroy();
  });
});

// 終わるときだけ、ウィジェットを本当に閉じる（ふつうに閉じたときはトレイへ隠れる）
app.on('before-quit', () => {
  quitting = true;
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
