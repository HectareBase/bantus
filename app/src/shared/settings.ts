// 設定項目の定義。項目やカテゴリを足すときは、ここに足すだけで設定画面にも出る。

export interface Settings {
  /** ウィジェットを置く画面の端 */
  edge: 'left' | 'right';
  /** 置くモニター。'primary' か、モニターの ID（文字列） */
  display: string;
  /** 広げたときのウィジェットの幅（px）。設定画面には出さず、ウィジェットの内側の端をドラッグして変える */
  width: number;
  /** 背景の不透明度（%）。0 で背景が消え、カードとタイトルバーだけが浮かぶ */
  backgroundOpacity: number;
  /** カードとタイトルバーの塗りの不透明度（%） */
  cardOpacity: number;
  /** カードの見出しの帯の濃さ（%）。0 で塗らず、区切り線だけになる */
  headerShade: number;
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
  /** 行の 2 行目に、最後に動きがあった時刻（「◯分前」）を出す */
  showUpdated: boolean;
  /** Windows にサインインしたときに開く。インストール版でだけ使える（npm start のときは灰色にする） */
  openAtLogin: boolean;
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
  /** 設定ウィンドウを最後に閉じたときの位置と大きさ（最大化前の大きさ）。設定画面には出さない */
  settingsWindow?: WindowBounds;
}

/** 並び順。fixed は位置が動かない順、recent は最後に動きがあった順、priority は対応待ち → 処理中 → 待機 → 停止中、同じなら recent */
export type SortOrder = 'fixed' | 'recent' | 'priority';

/** 手で決めたアーカイブ。archived は手でアーカイブした、shown は手で戻した（自動ではアーカイブしない） */
export type ArchiveMark = 'archived' | 'shown';

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
  width: 264,
  backgroundOpacity: 100,
  cardOpacity: 50,
  headerShade: 5,
  pinned: true,
  mainArchiveMinutes: 10,
  projectOrder: 'fixed',
  worktreeOrder: 'fixed',
  sessionOrder: 'fixed',
  showUpdated: true,
  openAtLogin: false,
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
};

/** ドラッグで変えられる幅の範囲（px） */
export const WIDTH_MIN = 200;
export const WIDTH_MAX = 480;

/** ツールチップの時間のスライダー。右端（この値）は「出さない」 */
export const TOOLTIP_OFF_MS = 2000;

export type CategoryId = 'general' | 'cards' | 'notify' | 'about';

export interface Category {
  id: CategoryId;
  label: string;
  /** 左の一覧に出すアイコン。lucide の名前で、renderer/icons.ts にあるもの（scripts/make-lucide-icons.mjs で足す） */
  icon: string;
}

/** 左の一覧の並び。中身のないカテゴリは画面に出さない */
export const CATEGORIES: Category[] = [
  { id: 'general', label: '全体', icon: 'app-window' },
  { id: 'cards', label: 'カードの表示', icon: 'list' },
  { id: 'notify', label: '通知', icon: 'bell' },
  { id: 'about', label: '情報', icon: 'info' },
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
}

/** アーカイブの印を付けられるセッションの ID。見本データの ID（`local_all-01` など）も通す */
export const SESSION_KEY_ID = /^local_[\w-]{1,64}$/;

/** カードの目印として受け付ける文字列（リポジトリのフォルダとワークツリーの目印を | でつないだもの） */
export function isCardKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 1024 && !/[\x00-\x1f]/.test(key);
}

export type SettingDef =
  | (Base<
      | 'edge' | 'mainArchiveMinutes' | 'projectOrder' | 'worktreeOrder' | 'sessionOrder' | 'showUpdated' | 'openAtLogin'
      | 'notifyWaiting' | 'notifyDone' | 'sound' | 'soundType' | 'toast' | 'flash' | 'muteWhenOpen'
    > & {
      type: 'segmented';
      options: { value: string | number | boolean; label: string }[];
      /** 'sound' にすると、右に「試聴」のボタンを付ける。選んだときにもその音を鳴らす */
      preview?: 'sound';
    })
  | (Base<'display'> & { type: 'display' })
  | (Base<'backgroundOpacity' | 'cardOpacity' | 'headerShade' | 'soundVolume' | 'tooltipDelayMs'> & {
      type: 'slider'; min: number; max: number; step: number; unit: string;
      /** 値の見せ方。なければ値に unit を付ける */
      format?: (value: number) => string;
    });

const SHOW_OPTIONS = [
  { value: true, label: '表示' },
  { value: false, label: '非表示' },
];

const NOTIFY_OPTIONS = [
  { value: true, label: '知らせる' },
  { value: false, label: '知らせない' },
];

const ORDER_OPTIONS = [
  { value: 'fixed', label: '固定' },
  { value: 'recent', label: '更新日時' },
  { value: 'priority', label: '優先度' },
];

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'edge', category: 'general', group: '位置', type: 'segmented',
    label: '画面の端', description: 'ウィジェットを置く側',
    options: [{ value: 'left', label: '左' }, { value: 'right', label: '右' }],
  },
  { key: 'display', category: 'general', group: '位置', type: 'display', label: 'モニター' },
  {
    key: 'backgroundOpacity', category: 'general', group: '見た目', type: 'slider',
    label: '背景の不透明度', description: '0% で背景が消え、カードとタイトルバーだけが浮かぶ',
    min: 0, max: 100, step: 5, unit: '%',
  },
  {
    key: 'cardOpacity', category: 'general', group: '見た目', type: 'slider',
    label: 'カードの不透明度', description: 'カードとタイトルバーの塗り。0% で枠だけになる',
    min: 0, max: 100, step: 5, unit: '%',
  },
  {
    key: 'headerShade', category: 'general', group: '見た目', type: 'slider',
    label: '見出しの濃さ', description: 'カードの見出し（プロジェクト名）の帯。0% で塗らず、区切り線だけになる',
    min: 0, max: 20, step: 1, unit: '%',
  },
  {
    key: 'tooltipDelayMs', category: 'general', group: 'ツールチップ', type: 'slider',
    label: '表示までの時間', description: 'ポインタを載せてから出るまで。右端にすると出さない',
    min: 0, max: TOOLTIP_OFF_MS, step: 100, unit: '秒',
    format: (v) => (v >= TOOLTIP_OFF_MS ? '表示しない' : `${(v / 1000).toFixed(1)} 秒`),
  },
  {
    key: 'openAtLogin', category: 'general', group: '起動', type: 'segmented', packagedOnly: true,
    label: 'Windows の起動時に開く', description: 'サインインしたときにウィジェットを開く。インストール版でだけ使える',
    options: [{ value: true, label: '開く' }, { value: false, label: '開かない' }],
  },
  {
    key: 'mainArchiveMinutes', category: 'cards', group: 'アーカイブ', type: 'segmented',
    label: 'main を自動でアーカイブ',
    description: '元のフォルダのセッションを、落ち着いてから（確認してから）この時間で隠す。ワークツリーは最後に動いたもの以外をすぐに隠す。Bantus の中だけで、デスクトップのアーカイブには触れない',
    options: [{ value: 10, label: '10 分' }, { value: 30, label: '30 分' }, { value: 60, label: '1 時間' }, { value: 0, label: 'しない' }],
  },
  {
    key: 'projectOrder', category: 'cards', group: '並び順', type: 'segmented',
    label: 'プロジェクト', description: 'カードの並び。固定は名前順',
    options: ORDER_OPTIONS,
  },
  {
    key: 'worktreeOrder', category: 'cards', group: '並び順', type: 'segmented',
    label: 'ワークツリー', description: 'プロジェクトの中のカードの並び。固定は元のフォルダを先頭に、あとは名前順',
    options: ORDER_OPTIONS,
  },
  {
    key: 'sessionOrder', category: 'cards', group: '並び順', type: 'segmented',
    label: 'セッション', description: 'カードの中の行の並び。固定は新しく作ったものが上',
    options: ORDER_OPTIONS,
  },
  {
    key: 'showUpdated', category: 'cards', group: '行に出すもの', type: 'segmented',
    label: '更新日時', description: '2 行目の「◯分前」',
    options: SHOW_OPTIONS,
  },
  {
    key: 'notifyWaiting', category: 'notify', group: '知らせるとき', type: 'segmented',
    label: '対応待ちになったとき', description: '許可や回答を待っているとき',
    options: NOTIFY_OPTIONS,
  },
  {
    key: 'notifyDone', category: 'notify', group: '知らせるとき', type: 'segmented',
    label: '完了したとき', description: '処理中から待機になったとき。Claude 本体の通知と重なることがある',
    options: NOTIFY_OPTIONS,
  },
  {
    key: 'muteWhenOpen', category: 'notify', group: '知らせるとき', type: 'segmented',
    label: '開いているセッション', description: 'Claude が前面にあり、そのセッションを開いているとき',
    options: [{ value: false, label: '知らせる' }, { value: true, label: '知らせない' }],
  },
  {
    key: 'sound', category: 'notify', group: '音', type: 'segmented',
    label: '音を鳴らす', description: '何件かが一度に変わっても 1 回だけ鳴らし、続けて鳴るときは数秒あける',
    options: [{ value: true, label: '鳴らす' }, { value: false, label: '鳴らさない' }],
  },
  {
    key: 'soundType', category: 'notify', group: '音', type: 'segmented', preview: 'sound',
    label: '音の種類', description: '対応待ちは高め、完了は低めの音になる',
    options: [{ value: 'chime', label: 'チャイム' }, { value: 'bell', label: 'ベル' }, { value: 'pop', label: 'ポン' }],
  },
  {
    key: 'soundVolume', category: 'notify', group: '音', type: 'slider',
    label: '音量', min: 0, max: 100, step: 5, unit: '%',
  },
  {
    key: 'toast', category: 'notify', group: 'Windows の通知', type: 'segmented',
    label: 'トースト通知', description: 'クリックするとそのセッションを開く。通知そのものの音は出さず、上の「音」に従う',
    options: [{ value: true, label: '出す' }, { value: false, label: '出さない' }],
  },
  {
    key: 'flash', category: 'notify', group: 'Windows の通知', type: 'segmented',
    label: 'タスクバーの点滅', description: '3 秒ほどで止まり、オレンジのままにはしない。ウィジェットが前面にあるときは点滅させない',
    options: [{ value: true, label: '点滅させる' }, { value: false, label: '点滅させない' }],
  },
];

/** 保存されていた値や画面から届いた値を、定義に合う値にそろえる。合わないものは既定値に戻す */
export function normalizeSettings(input: unknown): Settings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const def of SETTING_DEFS) {
    const v = src[def.key];
    switch (def.type) {
      case 'segmented':
        if (def.options.some((o) => o.value === v)) (out as any)[def.key] = v;
        break;
      case 'display':
        if (typeof v === 'string' && v) out.display = v;
        break;
      case 'slider':
        if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = Math.min(def.max, Math.max(def.min, Math.round(v)));
        break;
    }
  }
  // 設定画面に出さない項目
  const w = src.width;
  if (typeof w === 'number' && Number.isFinite(w)) out.width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(w)));
  if (typeof src.pinned === 'boolean') out.pinned = src.pinned;
  out.archive = normalizeMarks(src.archive, (id) => SESSION_KEY_ID.test(id));
  out.archivedCards = normalizeMarks(src.archivedCards, isCardKey);
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

/** 印の表から、目印と値が正しいものだけを残す */
function normalizeMarks(input: unknown, validKey: (key: string) => boolean): Record<string, ArchiveMark> {
  const out: Record<string, ArchiveMark> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, mark] of Object.entries(input)) {
    if ((mark === 'archived' || mark === 'shown') && validKey(key)) out[key] = mark;
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
