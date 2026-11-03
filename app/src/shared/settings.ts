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
  /** ワークツリーのグループごとに見せるセッションの数。0 ならすべて。残りは折りたたみに入れる */
  groupLimit: number;
  /** 隠したセッションと停止中をまとめる折りたたみの単位。repo はカード（プロジェクト）に 1 つ、worktree は小見出しごと */
  foldScope: 'repo' | 'worktree';
  /** カード（プロジェクト）の並び。fixed は名前順 */
  projectOrder: SortOrder;
  /** 小見出し（ワークツリー）の並び。fixed は元のフォルダを先頭に、あとは名前順 */
  worktreeOrder: SortOrder;
  /** 行（セッション）の並び。fixed は新しく作ったものが上 */
  sessionOrder: SortOrder;
  /** 行に、ワークツリーごとの通し番号を出す */
  showSeq: boolean;
  /** 行の 2 行目に、最後に動きがあった時刻（「◯分前」）を出す */
  showUpdated: boolean;
  /** Windows にサインインしたときに開く。インストール版でだけ使える（npm start のときは灰色にする） */
  openAtLogin: boolean;
  /** 対応待ちになったときに知らせる（音とトースト） */
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
  /** Claude が前面で、そのセッションを開いているときは知らせない */
  muteWhenOpen: boolean;
  /** 上限に関係なく、いつも一覧に出すセッションの ID。設定画面には出さず、行の星で切り替える */
  alwaysShow: string[];
  /** 設定ウィンドウを最後に閉じたときの位置と大きさ（最大化前の大きさ）。設定画面には出さない */
  settingsWindow?: WindowBounds;
}

/** 並び順。fixed は位置が動かない順、recent は最後に動きがあった順、priority は対応待ち → 処理中 → 待機 → 停止中、同じなら recent */
export type SortOrder = 'fixed' | 'recent' | 'priority';

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
  groupLimit: 5,
  foldScope: 'repo',
  projectOrder: 'fixed',
  worktreeOrder: 'fixed',
  sessionOrder: 'fixed',
  showSeq: true,
  showUpdated: true,
  openAtLogin: false,
  notifyWaiting: true,
  notifyDone: false,
  sound: true,
  soundType: 'chime',
  soundVolume: 60,
  toast: false,
  muteWhenOpen: true,
  alwaysShow: [],
};

/** ドラッグで変えられる幅の範囲（px） */
export const WIDTH_MIN = 200;
export const WIDTH_MAX = 480;

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

/** 常に表示にできるセッションの ID。見本データの ID（`local_all-01` など）も通す */
export const ALWAYS_SHOW_ID = /^local_[\w-]{1,64}$/;

export type SettingDef =
  | (Base<
      | 'edge' | 'foldScope' | 'groupLimit' | 'projectOrder' | 'worktreeOrder' | 'sessionOrder' | 'showSeq' | 'showUpdated' | 'openAtLogin'
      | 'notifyWaiting' | 'notifyDone' | 'sound' | 'soundType' | 'toast' | 'muteWhenOpen'
    > & {
      type: 'segmented';
      options: { value: string | number | boolean; label: string }[];
      /** 'sound' にすると、右に「試聴」のボタンを付ける。選んだときにもその音を鳴らす */
      preview?: 'sound';
    })
  | (Base<'display'> & { type: 'display' })
  | (Base<'backgroundOpacity' | 'cardOpacity' | 'headerShade' | 'soundVolume'> & { type: 'slider'; min: number; max: number; step: number; unit: string });

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
    key: 'openAtLogin', category: 'general', group: '起動', type: 'segmented', packagedOnly: true,
    label: 'Windows の起動時に開く', description: 'サインインしたときにウィジェットを開く。インストール版でだけ使える',
    options: [{ value: true, label: '開く' }, { value: false, label: '開かない' }],
  },
  {
    key: 'groupLimit', category: 'cards', group: '一覧', type: 'segmented',
    label: 'グループごとの表示数', description: '残りは折りたたみに入る。対応待ち、未確認、開いているもの、常に表示のものはいつも出る',
    options: [{ value: 3, label: '3' }, { value: 5, label: '5' }, { value: 8, label: '8' }, { value: 0, label: 'すべて' }],
  },
  {
    key: 'foldScope', category: 'cards', group: '一覧', type: 'segmented',
    label: '折りたたみのまとめ方', description: '残りと停止中を、カードの下にまとめるか、ワークツリーごとに分けるか',
    options: [{ value: 'repo', label: 'プロジェクト' }, { value: 'worktree', label: 'ワークツリー' }],
  },
  {
    key: 'projectOrder', category: 'cards', group: '並び順', type: 'segmented',
    label: 'プロジェクト', description: 'カードの並び。固定は名前順',
    options: ORDER_OPTIONS,
  },
  {
    key: 'worktreeOrder', category: 'cards', group: '並び順', type: 'segmented',
    label: 'ワークツリー', description: '小見出しの並び。固定は元のフォルダを先頭に、あとは名前順',
    options: ORDER_OPTIONS,
  },
  {
    key: 'sessionOrder', category: 'cards', group: '並び順', type: 'segmented',
    label: 'セッション', description: '行の並び。固定は新しく作ったものが上。表示数を超えたときに折りたたむものは、どの並びでも優先度で選ぶ',
    options: ORDER_OPTIONS,
  },
  {
    key: 'showSeq', category: 'cards', group: '行に出すもの', type: 'segmented',
    label: 'セッションの番号', description: 'ワークツリーごとに作った順の番号。状態のアイコンの右に出す',
    options: SHOW_OPTIONS,
  },
  {
    key: 'showUpdated', category: 'cards', group: '行に出すもの', type: 'segmented',
    label: '更新日時', description: '2 行目の「◯分前」。ブランチ名も出ない行は 1 行になる',
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
  if (Array.isArray(src.alwaysShow)) {
    out.alwaysShow = [...new Set(src.alwaysShow.filter((id): id is string => typeof id === 'string' && ALWAYS_SHOW_ID.test(id)))];
  }
  const bounds = normalizeBounds(src.settingsWindow);
  if (bounds) out.settingsWindow = bounds;
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
