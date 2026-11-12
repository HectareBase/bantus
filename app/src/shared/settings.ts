// 設定項目の定義。項目やカテゴリを足すときは、ここに足すだけで設定画面にも出る。

import { ja } from './strings/ja.js';
import { checkViewerPath } from './viewer-path.js';
import { normalizeDisplayByLayout } from './display-layout.js';

const T = ja.settings;

export interface Settings {
  /** ウィジェットを置く画面の端 */
  edge: 'left' | 'right';
  /**
   * 古い版の、置くモニターの単一の設定（'primary' か、モニターの ID の文字列）。今は displayByLayout を使い、
   * これは覚えのない構成で使う値として残す。今つながっている構成へ移したら 'primary' に戻す（display-layout.ts）
   */
  display: string;
  /** モニターの接続状態（構成のキー）ごとに、置くモニター（'primary' かモニターのしるし）。設定画面の「表示するモニター」で変わる */
  displayByLayout: Record<string, string>;
  /** 広げたときのウィジェットの幅（px）。設定画面には出さず、ウィジェットの内側の端をドラッグして変える */
  width: number;
  /**
   * アイランド型（画面の端のベゼルの黒に張り付く一枚の帯）で描く。オンのときは帯をいつも黒で塗り、
   * 背景とカードの不透明度は使わない（テーマにかかわらず暗い配色にする）
   */
  island: boolean;
  /** アイランド型の内向きの角丸の半径（px。ウィジェットの拡大率をかける） */
  islandRadius: number;
  /** アイランド型の縁の黒い線の太さ（px。ウィジェットの拡大率をかける）。帯の内側の端と、帯のない 3 辺の線 */
  islandLine: number;
  /** 背景の不透明度（%）。0 で背景が消え、カードとタイトルバーだけが浮かぶ */
  backgroundOpacity: number;
  /** カードとタイトルバーの塗りの不透明度（%） */
  cardOpacity: number;
  /** カードの見出しの帯の濃さ（%）。0 で塗らず、区切り線だけになる */
  headerShade: number;
  /**
   * デスクトップで今開いているセッションの行（とめくれの一覧の行）の強調の濃さ（%）。
   * highlightScale で倍率にして CSS の --hl に入れる。50 が以前からの見た目（倍率 1）、0 で強調しない
   */
  activeHighlight: number;
  /**
   * ウィジェット・ツールチップ・めくれの表示の拡大率（%）。Windows のディスプレイの拡大とは別に、その上からかける。
   * 設定ウィンドウにはかけない。幅（width）は画面の座標のままなので、拡大すると中身が窮屈になる
   */
  zoom: number;
  /** テーマ。system は Windows に従う。メインプロセスが nativeTheme.themeSource に当て、すべてのウィンドウにすぐ反映する */
  theme: Theme;
  /** 状態ごとのアイコンの色（#rrggbb）。ライトとダークで同じ色を使う。対応待ちは理由にかかわらず 1 色 */
  statusColors: StatusColors;
  /**
   * 動き続ける表示（処理中の輪、光の帯、点滅）。subtle はそれを止め、状態を行の塗りと枠で示す（html[data-motion="subtle"]）。
   * OS の「動きを減らす」のときも subtle と同じ見た目にする（status-colors.ts の applyMotion）
   */
  motion: Motion;
  /** ウィジェットをほかのウィンドウより前に固定する。設定画面には出さず、タイトルバーのピンで切り替える */
  pinned: boolean;
  /** main（元のフォルダ）のセッションを、落ち着いてから自動でアーカイブするまでの分。0 ならしない */
  mainArchiveMinutes: number;
  /** カード（プロジェクト）の並び。fixed は名前順 */
  projectOrder: SortOrder;
  /** プロジェクトの中のカード（ワークツリー）の並び。fixed は元のフォルダを先頭に、あとは名前順 */
  worktreeOrder: SortOrder;
  /** 行（セッション）の並び。fixed は新しく作ったものが上 */
  sessionOrder: SortOrder;
  /** 行（セッション）の上下の余白（px）。小さくすると 1 画面に多くの行が入る */
  rowPadding: number;
  /** 行の 2 行目に、最後に動きがあった時刻（「◯分前」）を出す */
  showUpdated: boolean;
  /** 行の 2 行目に、状態を文字で出す（「処理中」「許可待ち」など） */
  showState: boolean;
  /** 行の 2 行目に、コンテキストの使用率（「12%」）を出す */
  showContext: boolean;
  /** タイトルバーに PC 全体の CPU とメモリの使用率を出す。出さないときは取得のタイマーも止める */
  showSystemUsage: boolean;
  /**
   * ウィジェットの一番下に、同じモニターにある Claude 以外のウィンドウのアイコンを並べる（docs/design/window-switcher.md）。
   * 出さないときは、ウィンドウを調べるタイマーも止める
   */
  showWindowSwitcher: boolean;
  /**
   * リモートを定期的に取得する（git fetch）。既定はオフ。オンにしたときだけ git の通信をする（docs/design/git-fetch.md）。
   * 元のフォルダのカードの遅れと、リモートでマージしたワークツリーのマージ済みを出すのに使う
   */
  gitFetch: boolean;
  /** 取得の間隔（分） */
  gitFetchMinutes: number;
  /** カードの見出しに変更の印を出す */
  showChanges: boolean;
  /** 未追跡のファイルを数える。数えないと git status に --untracked-files=no を付ける */
  countUntracked: boolean;
  /** Windows にサインインしたときに開く。インストール版でだけ使える（npm start のときは灰色にする） */
  openAtLogin: boolean;
  /**
   * GPU（ハードウェア アクセラレーション）で描く。既定は使わない（GPU のプロセスのメモリが大きく減る。docs/design/gpu.md）。
   * 起動するとき（app の ready より前）にだけ効くので、変えたらメインプロセスが起動し直す
   */
  hardwareAcceleration: boolean;
  /** 対応待ちになったときに知らせる（音、トースト、タスクバーの点滅） */
  notifyWaiting: boolean;
  /** 完了した（処理中から待機になった）ときに知らせる。Claude 本体の通知と重なるので、既定は知らせない */
  notifyDone: boolean;
  /** 知らせるときに音を鳴らす */
  sound: boolean;
  /** 音の種類。音は renderer/sound.ts でその場で作る（ファイルは同梱しない） */
  soundType: SoundType;
  /** 音量（%） */
  soundVolume: number;
  /** 知らせるときに Windows の通知（トースト）を出す */
  toast: boolean;
  /** 知らせるときにタスクバーを数秒だけ点滅させる */
  flash: boolean;
  /** Claude が前面で、そのセッションを開いているときは知らせない */
  muteWhenOpen: boolean;
  /** ツールチップが出るまでの時間（ms）。TOOLTIP_OFF_MS（スライダーの右端）なら出さない */
  tooltipDelayMs: number;
  /**
   * Bantus の中だけのアーカイブで、手で決めたもの（セッションの ID → 手でアーカイブした／手で戻した）。
   * 自動の決まりより優先する。設定画面には出さず、行のトグルで切り替える。デスクトップの isArchived には書かない
   */
  archive: Record<string, ArchiveMark>;
  /** カード（ワークツリー）を手でアーカイブした／戻したもの（カードの目印 → 印）。設定画面には出さない */
  archivedCards: Record<string, ArchiveMark>;
  /** 保留の印（セッションの ID → 印）。設定画面には出さず、行の状態のアイコンで切り替える（docs/design/hold.md） */
  holds: Record<string, HoldMark>;
  /** 保留にしたカード（カードの目印 → 印）。設定画面には出さず、カードの見出しのアイコンで切り替える */
  heldCards: Record<string, HoldMark>;
  /** カードの一覧の下に HTML ビューアを出す（docs/design/html-viewer.md） */
  viewerEnabled: boolean;
  /**
   * ビューアに出すファイル。作業フォルダ（元のフォルダならリポジトリのルート）から見た相対パスで、区切りは /。空ならまだ決めていない。
   * すべてのリポジトリで共通（リポジトリごとに変えるときは、リポジトリの目印からパスへの表を足す）
   */
  viewerPath: string;
  /** ファイルが変わったら読み込み直す */
  viewerAutoReload: boolean;
  /** ビューアの HTML の拡大率（%）。ウィジェットの拡大率（zoom）とは別で、重ねてはかけない */
  viewerZoom: number;
  /** ビューアの高さを、カードの一覧が使っていない空いた場所に合わせる。つまみをドラッグすると false になる */
  viewerAutoHeight: boolean;
  /** 手で決めたビューアの HTML の高さ（CSS px）。設定画面には出さず、つまみのドラッグで変える。上限はウィンドウの高さで決まる（画面側） */
  viewerHeight: number;
  /** ビューアを畳んでいる（見出しだけを出す）。設定画面には出さず、見出しのボタンで切り替える */
  viewerCollapsed: boolean;
  /** 設定ウィンドウを最後に閉じたときの位置と大きさ（最大化前の大きさ）。設定画面には出さない */
  settingsWindow?: WindowBounds;
}

/** 並び順。fixed は位置が動かない順、recent は最後に動きがあった順、priority は対応待ち → 処理中 → 待機（停止中を含む）→ 保留、同じなら recent */
export type SortOrder = 'fixed' | 'recent' | 'priority';

/** テーマ。system は Windows の設定に従う */
export type Theme = 'system' | 'light' | 'dark';

/**
 * 色を設定できる状態。held は保留（Bantus の中だけの印で、セッションの状態ではない）。
 * stopped は中断（処理中か対応待ちのまま止まった）の色。前は停止中の色だったので、保存した設定を生かすため鍵の名前はそのまま
 */
export type ColorState = 'busy' | 'waiting' | 'idle' | 'stopped' | 'held';
export type StatusColors = Record<ColorState, string>;

/** 設定画面に並べる順 */
export const COLOR_STATES: ColorState[] = ['busy', 'waiting', 'idle', 'held', 'stopped'];

/** 既定の色。両方のテーマで見える、中くらいの明るさ */
export const DEFAULT_STATUS_COLORS: StatusColors = { busy: '#3b8eea', waiting: '#e6a100', idle: '#4caf50', stopped: '#8b8b8b', held: '#e05aa8' };

/** 色の候補 */
export const COLOR_SWATCHES = ['#3b8eea', '#4caf50', '#e6a100', '#e5534b', '#a371f7', '#e05aa8', '#26a69a', '#f0883e', '#8b8b8b'];

/** #rrggbb（大文字も受け付け、小文字にそろえる）なら返す。そうでなければ undefined */
export function normalizeColor(v: unknown): string | undefined {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
}

/** 手で決めたアーカイブ。archived は手でアーカイブした、shown は手で戻した（自動ではアーカイブしない） */
export type ArchiveMark = 'archived' | 'shown';

/** 保留の印。note は理由のメモ（空でもよい）、since は保留にした時刻（Unix ミリ秒） */
export interface HoldMark {
  note: string;
  since: number;
}

/** メモの長さの上限 */
export const HOLD_NOTE_MAX = 200;

/** メモを保存する形にそろえる。改行や制御文字は空白にし、空白を詰め、前後の空白を除いて上限で切る */
export function normalizeNote(v: unknown): string {
  if (typeof v !== 'string') return '';
  return [...v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, HOLD_NOTE_MAX).join('').trim();
}

/** アニメーション効果。full（標準）が以前からの見た目 */
export type Motion = 'full' | 'subtle';

/** 強調の濃さ（%）の既定値。倍率 1（以前からの見た目） */
export const HIGHLIGHT_NORMAL = 50;

/** 強調の濃さ（%）から、塗りとストライプの不透明度にかける倍率を出す。0% で 0、50% で 1、100% で 2 */
export function highlightScale(percent: number): number {
  return Number.isFinite(percent) ? Math.max(0, percent) / HIGHLIGHT_NORMAL : 1;
}

/** 前の版の 3 択（薄い・標準・濃い）の値を、同じ倍率になる濃さ（%）に置き換える（倍率 0.5・1・2） */
const LEGACY_HIGHLIGHT: Record<string, number> = { subtle: 25, normal: 50, strong: 100 };

/** 音の種類。chime は 2 音のチャイム、bell は余韻の長い鐘、pop は短い 1 音 */
export type SoundType = 'chime' | 'bell' | 'pop';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_SETTINGS: Settings = {
  edge: 'right',
  display: 'primary',
  displayByLayout: {},
  width: 264,
  island: true,
  islandRadius: 12,
  islandLine: 1,
  backgroundOpacity: 100,
  cardOpacity: 50,
  headerShade: 5,
  activeHighlight: HIGHLIGHT_NORMAL,
  zoom: 100,
  theme: 'system',
  statusColors: DEFAULT_STATUS_COLORS,
  motion: 'full',
  pinned: true,
  mainArchiveMinutes: 10,
  projectOrder: 'fixed',
  worktreeOrder: 'fixed',
  sessionOrder: 'fixed',
  rowPadding: 4,
  showUpdated: true,
  showState: true,
  showContext: true,
  showSystemUsage: true,
  showWindowSwitcher: true,
  gitFetch: false,
  gitFetchMinutes: 10,
  showChanges: true,
  countUntracked: true,
  openAtLogin: false,
  hardwareAcceleration: false,
  notifyWaiting: true,
  notifyDone: false,
  sound: true,
  soundType: 'chime',
  soundVolume: 60,
  toast: false,
  flash: true,
  muteWhenOpen: true,
  tooltipDelayMs: 400,
  archive: {},
  archivedCards: {},
  holds: {},
  heldCards: {},
  viewerEnabled: false,
  viewerPath: '',
  viewerAutoReload: true,
  viewerZoom: 100,
  viewerAutoHeight: true,
  viewerHeight: 240,
  viewerCollapsed: false,
};

/**
 * 幅の範囲（px）。実際の上限は、置く画面の作業領域の半分（widthLimit）。
 * WIDTH_MAX は保存された値の行き過ぎを切るだけのもの
 */
export const WIDTH_MIN = 200;
export const WIDTH_MAX = 3840;

/** 作業領域の幅から、ウィジェットの幅の上限を出す（半分まで） */
export function widthLimit(areaWidth: number): number {
  return Math.floor(areaWidth / 2);
}

/** ドラッグ中の幅を範囲に収める。下限は WIDTH_MIN、上限は作業領域の半分（作業領域が狭いときは半分を優先する） */
export function clampWidth(width: number, areaWidth: number): number {
  return Math.min(widthLimit(areaWidth), Math.max(WIDTH_MIN, Math.round(width)));
}

/**
 * ビューアの HTML の高さの範囲（CSS px）。上限は保存値の行き過ぎを切るだけのもの。
 * 実際の上限は「ウィンドウの高さ − VIEWER_ROOM」（カードの一覧と見出しの分を残す。画面側で決める）
 */
export const VIEWER_HEIGHT_MIN = 80;
export const VIEWER_HEIGHT_MAX = 4000;
export const VIEWER_ROOM = 160;

/** ウィンドウの高さ（CSS px）に合わせて、ビューアの高さを範囲に収める。ウィンドウが低いときは下限を優先する */
export function clampViewerHeight(height: number, windowHeight: number): number {
  return Math.max(VIEWER_HEIGHT_MIN, Math.min(Math.round(height), windowHeight - VIEWER_ROOM));
}

/**
 * 高さを自動で決めるときの、ビューアの HTML の高さ（CSS px）。
 * shared はカードの一覧とビューアの HTML で分け合える高さ、cards はカードの一覧の中身の高さ。
 * 残りをすべてビューアに渡す。足りなければ下限にし、カードの一覧のほうをスクロールさせる。
 * 端数は切り捨てる（カードの一覧が 1px 足りずにスクロールバーを出さないように）
 */
export function autoViewerHeight(shared: number, cards: number): number {
  if (!Number.isFinite(shared) || !Number.isFinite(cards)) return VIEWER_HEIGHT_MIN;
  return Math.max(VIEWER_HEIGHT_MIN, Math.floor(shared - cards));
}

/** ツールチップの時間のスライダー。右端（この値）は「出さない」 */
export const TOOLTIP_OFF_MS = 2000;

export type CategoryId = 'general' | 'look' | 'cards' | 'notify' | 'git' | 'viewer' | 'about';

export interface Category {
  id: CategoryId;
  label: string;
  /** 左の一覧に出すアイコン。lucide の名前で、renderer/icons.ts にあるもの（scripts/make-lucide-icons.mjs で足す） */
  icon: string;
}

/** 左の一覧の並び。中身のないカテゴリは画面に出さない */
export const CATEGORIES: Category[] = [
  { id: 'general', label: T.categories.general, icon: 'app-window' },
  { id: 'look', label: T.categories.look, icon: 'palette' },
  { id: 'cards', label: T.categories.cards, icon: 'list' },
  { id: 'notify', label: T.categories.notify, icon: 'bell' },
  { id: 'git', label: T.categories.git, icon: 'git-branch' },
  { id: 'viewer', label: T.categories.viewer, icon: 'panel-bottom' },
  { id: 'about', label: T.categories.about, icon: 'info' },
];

interface Base<K extends keyof Settings> {
  key: K;
  category: CategoryId;
  /** カテゴリの中の見出し */
  group: string;
  label: string;
  description?: string;
  /** インストール版（exe）でだけ使える項目。npm start のときは灰色にして、押せなくする */
  packagedOnly?: boolean;
  /** この設定（オンかオフ）がオフのときは、灰色にして押せなくする */
  enabledBy?: BooleanKey;
  /** この設定（オンかオフ）が value のときだけ出す（関係のないときは灰色にせず、隠す） */
  shownWhen?: { key: BooleanKey; value: boolean };
}

/** オンかオフの設定 */
type BooleanKey = { [K in keyof Settings]-?: Settings[K] extends boolean ? K : never }[keyof Settings];

/** ボタンで動かすこと（設定の値は持たない）。gitFetchNow は「今すぐ取得」 */
export type ActionId = 'gitFetchNow';

/** アーカイブの印を付けられるセッションの ID。見本データの ID（`local_all-01` など）も通す */
export const SESSION_KEY_ID = /^local_[\w-]{1,64}$/;

/** カードの目印として受け付ける文字列（リポジトリのフォルダとワークツリーの目印を | でつないだもの） */
export function isCardKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 1024 && !/[\x00-\x1f]/.test(key);
}

export type SettingDef =
  | (Base<
      'edge' | 'island' | 'theme' | 'motion' | 'mainArchiveMinutes' | 'projectOrder' | 'worktreeOrder' | 'sessionOrder' | 'gitFetchMinutes' | 'soundType' | 'viewerAutoHeight'
    > & {
      type: 'segmented';
      options: { value: string | number | boolean; label: string }[];
      /** 'sound' にすると、右に「テスト」のボタンを付ける。選んだときにもその音を鳴らす */
      preview?: 'sound';
    })
  /** オンかオフ。トグルスイッチで描き、横に「オン」「オフ」を出す。ラベルは「〜する」か、オンオフで意味が通る名前にする */
  | (Base<BooleanKey> & { type: 'toggle' })
  | (Base<'display'> & { type: 'display' })
  | (Base<'islandRadius' | 'islandLine' | 'backgroundOpacity' | 'cardOpacity' | 'headerShade' | 'activeHighlight' | 'zoom' | 'viewerZoom' | 'rowPadding' | 'soundVolume' | 'tooltipDelayMs'> & { type: 'slider'; min: number; max: number; step: number; unit: string; format?: (value: number) => string })
  /** 状態ごとの色。行の見本、状態ごとの行、「すべて既定に戻す」をまとめて描く */
  | (Base<'statusColors'> & { type: 'status-colors' })
  /**
   * 1 行の文字。stacked（名前の下）に出し、入力を確定したとき（change）に check で検査する。
   * だめなら理由を入力欄の下に出し、保存しない。保存された値も check を通らなければ既定値に戻す
   */
  | (Base<'viewerPath'> & { type: 'text'; placeholder?: string; check: (value: string) => { value: string } | { error: string } })
  /** ボタン。押すとメインプロセスで action を動かし、横に最後の結果を出す。設定の値は持たない */
  | (Omit<Base<keyof Settings>, 'key'> & { type: 'action'; key: ActionId; button: string });

/** 並び順。fixed の名前は中身に合わせて変える（カードは名前順、行は作成順） */
const orderOptions = (fixed: string) => [
  { value: 'fixed', label: fixed },
  { value: 'recent', label: T.options.orderRecent },
  { value: 'priority', label: T.options.orderPriority },
];

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'edge', category: 'general', group: T.groups.position, type: 'segmented',
    ...T.items.edge,
    options: [{ value: 'left', label: T.options.left }, { value: 'right', label: T.options.right }],
  },
  { key: 'display', category: 'general', group: T.groups.position, type: 'display', ...T.items.display },
  {
    key: 'tooltipDelayMs', category: 'general', group: T.groups.tooltip, type: 'slider',
    ...T.items.tooltipDelayMs,
    min: 0, max: TOOLTIP_OFF_MS, step: 100, unit: '',
    format: (v) => (v >= TOOLTIP_OFF_MS ? T.tooltipDelay.off : T.tooltipDelay.seconds(v / 1000)),
  },
  {
    key: 'showSystemUsage', category: 'general', group: T.groups.titleBar, type: 'toggle',
    ...T.items.showSystemUsage,
  },
  {
    key: 'showWindowSwitcher', category: 'general', group: T.groups.switcher, type: 'toggle',
    ...T.items.showWindowSwitcher,
  },
  {
    key: 'openAtLogin', category: 'general', group: T.groups.startup, type: 'toggle', packagedOnly: true,
    ...T.items.openAtLogin,
  },
  {
    key: 'hardwareAcceleration', category: 'general', group: T.groups.performance, type: 'toggle',
    ...T.items.hardwareAcceleration,
  },
  {
    key: 'theme', category: 'look', group: T.groups.theme, type: 'segmented',
    ...T.items.theme,
    options: [{ value: 'system', label: T.options.themeSystem }, { value: 'light', label: T.options.themeLight }, { value: 'dark', label: T.options.themeDark }],
  },
  {
    key: 'island', category: 'look', group: T.groups.widget, type: 'segmented',
    ...T.items.island,
    options: [{ value: true, label: T.options.lookBezel }, { value: false, label: T.options.lookFloat }],
  },
  {
    key: 'islandRadius', category: 'look', group: T.groups.widget, type: 'slider', shownWhen: { key: 'island', value: true },
    ...T.items.islandRadius,
    min: 4, max: 32, step: 2, unit: 'px',
  },
  {
    key: 'islandLine', category: 'look', group: T.groups.widget, type: 'slider', shownWhen: { key: 'island', value: true },
    ...T.items.islandLine,
    min: 1, max: 6, step: 1, unit: 'px',
  },
  {
    key: 'backgroundOpacity', category: 'look', group: T.groups.widget, type: 'slider', shownWhen: { key: 'island', value: false },
    ...T.items.backgroundOpacity,
    min: 0, max: 100, step: 5, unit: '%',
  },
  {
    key: 'cardOpacity', category: 'look', group: T.groups.widget, type: 'slider', shownWhen: { key: 'island', value: false },
    ...T.items.cardOpacity,
    min: 0, max: 100, step: 5, unit: '%',
  },
  {
    key: 'headerShade', category: 'look', group: T.groups.widget, type: 'slider',
    ...T.items.headerShade,
    min: 0, max: 20, step: 1, unit: '%',
  },
  {
    key: 'activeHighlight', category: 'look', group: T.groups.widget, type: 'slider',
    ...T.items.activeHighlight,
    min: 0, max: 100, step: 5, unit: '%',
  },
  {
    key: 'zoom', category: 'look', group: T.groups.widget, type: 'slider',
    ...T.items.zoom,
    min: 80, max: 150, step: 5, unit: '%',
  },
  {
    key: 'motion', category: 'look', group: T.groups.statusColors, type: 'segmented',
    ...T.items.motion,
    options: [{ value: 'full', label: T.options.motionFull }, { value: 'subtle', label: T.options.motionSubtle }],
  },
  {
    key: 'statusColors', category: 'look', group: T.groups.statusColors, type: 'status-colors',
    ...T.items.statusColors,
  },
  {
    key: 'mainArchiveMinutes', category: 'cards', group: T.groups.archive, type: 'segmented',
    ...T.items.mainArchiveMinutes,
    options: [{ value: 10, label: T.options.minutes(10) }, { value: 30, label: T.options.minutes(30) }, { value: 60, label: T.options.hours(1) }, { value: 0, label: T.options.never }],
  },
  {
    key: 'projectOrder', category: 'cards', group: T.groups.order, type: 'segmented',
    ...T.items.projectOrder,
    options: orderOptions(T.options.orderName),
  },
  {
    key: 'worktreeOrder', category: 'cards', group: T.groups.order, type: 'segmented',
    ...T.items.worktreeOrder,
    options: orderOptions(T.options.orderName),
  },
  {
    key: 'sessionOrder', category: 'cards', group: T.groups.order, type: 'segmented',
    ...T.items.sessionOrder,
    options: orderOptions(T.options.orderCreated),
  },
  {
    key: 'rowPadding', category: 'cards', group: T.groups.rowSize, type: 'slider',
    ...T.items.rowPadding,
    min: 0, max: 12, step: 1, unit: 'px',
  },
  {
    key: 'showUpdated', category: 'cards', group: T.groups.rowContent, type: 'toggle',
    ...T.items.showUpdated,
  },
  {
    key: 'showState', category: 'cards', group: T.groups.rowContent, type: 'toggle',
    ...T.items.showState,
  },
  {
    key: 'showContext', category: 'cards', group: T.groups.rowContent, type: 'toggle',
    ...T.items.showContext,
  },
  {
    key: 'notifyWaiting', category: 'notify', group: T.groups.notifyWhen, type: 'toggle',
    ...T.items.notifyWaiting,
  },
  {
    key: 'notifyDone', category: 'notify', group: T.groups.notifyWhen, type: 'toggle',
    ...T.items.notifyDone,
  },
  {
    key: 'muteWhenOpen', category: 'notify', group: T.groups.notifyWhen, type: 'toggle',
    ...T.items.muteWhenOpen,
  },
  {
    key: 'sound', category: 'notify', group: T.groups.sound, type: 'toggle',
    ...T.items.sound,
  },
  {
    key: 'soundType', category: 'notify', group: T.groups.sound, type: 'segmented', preview: 'sound',
    ...T.items.soundType,
    options: [{ value: 'chime', label: T.options.soundChime }, { value: 'bell', label: T.options.soundBell }, { value: 'pop', label: T.options.soundPop }],
  },
  {
    key: 'soundVolume', category: 'notify', group: T.groups.sound, type: 'slider',
    ...T.items.soundVolume, min: 0, max: 100, step: 5, unit: '%',
  },
  {
    key: 'toast', category: 'notify', group: T.groups.windowsNotify, type: 'toggle',
    ...T.items.toast,
  },
  {
    key: 'flash', category: 'notify', group: T.groups.windowsNotify, type: 'toggle',
    ...T.items.flash,
  },
  {
    key: 'gitFetch', category: 'git', group: T.groups.fetch, type: 'toggle',
    ...T.items.gitFetch,
  },
  {
    key: 'gitFetchMinutes', category: 'git', group: T.groups.fetch, type: 'segmented', enabledBy: 'gitFetch',
    ...T.items.gitFetchMinutes,
    options: [5, 10, 30].map((n) => ({ value: n, label: T.options.minutes(n) })),
  },
  {
    key: 'gitFetchNow', category: 'git', group: T.groups.fetch, type: 'action', enabledBy: 'gitFetch',
    ...T.items.gitFetchNow,
  },
  {
    key: 'showChanges', category: 'git', group: T.groups.changes, type: 'toggle',
    ...T.items.showChanges,
  },
  {
    key: 'countUntracked', category: 'git', group: T.groups.changes, type: 'toggle',
    ...T.items.countUntracked,
  },
  {
    key: 'viewerEnabled', category: 'viewer', group: T.groups.viewerShow, type: 'toggle',
    ...T.items.viewerEnabled,
  },
  {
    key: 'viewerPath', category: 'viewer', group: T.groups.viewerFile, type: 'text', enabledBy: 'viewerEnabled',
    ...T.items.viewerPath,
    check: (value) => {
      const r = checkViewerPath(value);
      return 'path' in r ? { value: r.path } : { error: T.viewerPathProblems[r.problem] };
    },
  },
  {
    key: 'viewerAutoReload', category: 'viewer', group: T.groups.viewerFile, type: 'toggle', enabledBy: 'viewerEnabled',
    ...T.items.viewerAutoReload,
  },
  {
    key: 'viewerZoom', category: 'viewer', group: T.groups.viewerLook, type: 'slider', enabledBy: 'viewerEnabled',
    ...T.items.viewerZoom,
    min: 50, max: 200, step: 10, unit: '%',
  },
  {
    key: 'viewerAutoHeight', category: 'viewer', group: T.groups.viewerLook, type: 'segmented', enabledBy: 'viewerEnabled',
    ...T.items.viewerAutoHeight,
    options: [{ value: true, label: T.options.fitHeight }, { value: false, label: T.options.manualHeight }],
  },
];

/** 保存されていた値や画面から届いた値を、定義に合う値にそろえる。合わないものは既定値に戻す */
export function normalizeSettings(input: unknown): Settings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const def of SETTING_DEFS) {
    let v = src[def.key];
    // 前の版の開いている行の濃さ（薄い・標準・濃い）は、近い濃さ（%）に置き換える
    if (def.key === 'activeHighlight' && typeof v === 'string') v = LEGACY_HIGHLIGHT[v];
    switch (def.type) {
      case 'segmented':
        if (def.options.some((o) => o.value === v)) (out as any)[def.key] = v;
        break;
      case 'toggle':
        if (typeof v === 'boolean') out[def.key] = v;
        break;
      case 'display':
        if (typeof v === 'string' && v) out.display = v;
        break;
      case 'slider':
        if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = Math.min(def.max, Math.max(def.min, Math.round(v)));
        break;
      case 'status-colors':
        out.statusColors = normalizeStatusColors(v);
        break;
      case 'text':
        if (typeof v === 'string') {
          const r = def.check(v);
          if ('value' in r) out[def.key] = r.value;
        }
        break;
      case 'action':
        break;
    }
  }
  // 設定画面に出さない項目
  const w = src.width;
  if (typeof w === 'number' && Number.isFinite(w)) out.width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(w)));
  if (typeof src.pinned === 'boolean') out.pinned = src.pinned;
  out.displayByLayout = normalizeDisplayByLayout(src.displayByLayout);
  const vh = src.viewerHeight;
  if (typeof vh === 'number' && Number.isFinite(vh)) out.viewerHeight = Math.min(VIEWER_HEIGHT_MAX, Math.max(VIEWER_HEIGHT_MIN, Math.round(vh)));
  if (typeof src.viewerCollapsed === 'boolean') out.viewerCollapsed = src.viewerCollapsed;
  out.archive = normalizeMarks(src.archive, (id) => SESSION_KEY_ID.test(id));
  out.archivedCards = normalizeMarks(src.archivedCards, isCardKey);
  out.holds = normalizeHolds(src.holds, (id) => SESSION_KEY_ID.test(id));
  out.heldCards = normalizeHolds(src.heldCards, isCardKey);
  // 前の版の「常に表示」の星は、手で戻したものとして引き継ぐ
  if (Array.isArray(src.alwaysShow)) {
    for (const id of src.alwaysShow) {
      if (typeof id === 'string' && SESSION_KEY_ID.test(id) && !out.archive[id]) out.archive[id] = 'shown';
    }
  }
  const bounds = normalizeBounds(src.settingsWindow);
  if (bounds) out.settingsWindow = bounds;
  return out;
}

/** 状態ごとの色。知らない状態は捨て、色でない値や欠けた状態は既定の色にする */
function normalizeStatusColors(input: unknown): StatusColors {
  const src = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_STATUS_COLORS };
  for (const state of COLOR_STATES) out[state] = normalizeColor(src[state]) ?? DEFAULT_STATUS_COLORS[state];
  return out;
}

/** 印の表から、目印と値が正しいものだけを残す */
function normalizeMarks(input: unknown, validKey: (key: string) => boolean): Record<string, ArchiveMark> {
  const out: Record<string, ArchiveMark> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, mark] of Object.entries(input)) {
    if ((mark === 'archived' || mark === 'shown') && validKey(key)) out[key] = mark;
  }
  return out;
}

/** 保留の印を 1 つそろえる。合わなければ undefined */
export function normalizeHold(input: unknown): HoldMark | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const { note, since } = input as Record<string, unknown>;
  if (typeof note !== 'string' || typeof since !== 'number' || !Number.isFinite(since)) return undefined;
  return { note: normalizeNote(note), since };
}

/** 保留の表から、目印と値が正しいものだけを残す */
function normalizeHolds(input: unknown, validKey: (key: string) => boolean): Record<string, HoldMark> {
  const out: Record<string, HoldMark> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    const mark = normalizeHold(value);
    if (mark && validKey(key)) out[key] = mark;
  }
  return out;
}

/** 4 つの値がそろった数なら整数にして返す。大きさは 1 以上。そうでなければ undefined */
function normalizeBounds(input: unknown): WindowBounds | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const b = input as Record<string, unknown>;
  const keys = ['x', 'y', 'width', 'height'] as const;
  if (!keys.every((k) => typeof b[k] === 'number' && Number.isFinite(b[k]))) return undefined;
  const [x, y, width, height] = keys.map((k) => Math.round(b[k] as number)) as [number, number, number, number];
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}
