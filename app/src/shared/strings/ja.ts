// 画面に出す文言（日本語）。画面の文字はここにだけ書く（docs/strings.md）。
// 値が入る文言は関数にする。文字列をつなげて文を作らない。
// ほかの言語を足すときは、同じ形のオブジェクトを `satisfies Messages` で作る。

export const ja = {
  app: {
    name: 'Bantus',
    /** ワークツリー版の名前（タスクトレイ、通知、ウィンドウの題名） */
    worktreeLabel: (worktree: string) => `Bantus（ワークツリー：${worktree}）`,
  },

  /** ウィンドウの題名 */
  window: {
    settings: (app: string) => `${app} — 設定`,
    tip: (app: string) => `${app} — ツールチップ`,
    flyout: (app: string) => `${app} — 以前のセッション`,
  },

  /** タスクトレイのメニュー */
  tray: {
    show: '表示',
    settings: '設定',
    quit: '終了',
  },

  /** 設定の「モニター」の選択肢 */
  monitor: {
    primary: 'メインのモニター',
    other: (n: number, width: number, height: number) => `モニター ${n}（${width}×${height}）`,
  },

  /** 自動の切り替え（self-update）のお知らせ */
  update: {
    reinstall: '依存パッケージが変わりました。npm run setup を実行してから起動し直してください',
    buildFailed: '新しいコードをビルドできませんでした。今の版のまま動きます',
  },

  /** セッションの読み取りで、値がないときの代わり */
  session: {
    untitled: '（無題）',
    noFolder: '（フォルダなし）',
  },

  /** 対応待ちの理由（waitingFor の値ごと）。docs/research/session-status.md */
  waiting: {
    'permission prompt': '許可待ち',
    'input needed': '回答待ち',
    'dialog open': 'ダイアログの応答待ち',
    'sandbox request': 'サンドボックスの許可待ち',
    'worker request': 'ワーカーへの応答待ち',
    'goal proposal': 'ゴールの確認待ち',
  },

  /** 状態の文字 */
  state: {
    busy: '処理中',
    idle: '待機中',
    stopped: '停止中',
    /** 知らない waitingFor（「対応待ち（その他）」） */
    waitingOther: 'その他',
    /** waitingFor がないとき */
    unknown: '不明',
    held: '保留',
    /** 対応待ちと、その理由（トーストの本文、以前のセッションの一覧） */
    waitingWithReason: (reason: string) => `対応待ち（${reason}）`,
  },

  /** 経過時間 */
  time: {
    justNow: 'たった今',
    minutesAgo: (n: number) => `${n} 分前`,
    hoursAgo: (n: number) => `${n} 時間前`,
    daysAgo: (n: number) => `${n} 日前`,
    heldJustNow: '保留したばかり',
    heldMinutes: (n: number) => `保留 ${n} 分`,
    heldHours: (n: number) => `保留 ${n} 時間`,
    heldDays: (n: number) => `保留 ${n} 日`,
  },

  /** ツールチップの行 */
  tooltip: {
    worktree: (branch: string) => `ワークツリー：${branch}`,
    origin: (branch: string) => `元のフォルダ：${branch}`,
    waiting: (reason: string) => `対応待ち：${reason}`,
    needsAction: (what: string) => `次にすること：${what}`,
    unknownBranch: '（ブランチ不明）',
    contextPercent: (pct: number, tokens: string, window: string) => `コンテキスト：${pct}%（${tokens} / ${window}）`,
    contextUnknownWindow: (tokens: string, model?: string) => `コンテキスト：${tokens}（上限不明${model ? `：${model}` : ''}）`,
  },

  /** コミットされていない変更（docs/design/git-changes.md） */
  changes: {
    merged: 'マージ済み',
    changed: (n: number) => `変更 ${n}`,
    untracked: (n: number) => `未追跡 ${n}`,
    /** 内訳（「変更 2」「未追跡 1」）を並べるときの区切り */
    separator: '・',
    uncommitted: (parts: string) => `未コミットの変更：${parts}`,
    aheadOfBase: (n: number) => `未マージのコミット：${n}`,
    unpushed: (n: number) => `push していないコミット：${n}`,
    behind: (n: number) => `元のブランチからの遅れ：${n}`,
  },

  /** トースト通知の本文 */
  toast: {
    done: '完了',
    withRest: (reason: string, rest: number) => `${reason}。ほかに ${rest} 件`,
  },

  /** ウィジェット（index.html と renderer.ts） */
  widget: {
    pinned: '最前面の固定を外す',
    pin: '最前面に固定する',
    pinAria: '最前面に固定',
    settings: '設定',
    resize: 'ドラッグで幅を変える',
    archiveCard: 'カードをアーカイブ',
    archive: 'アーカイブ',
    archiveTip: 'アーカイブ',
    holdNoteAria: '保留の理由のメモ',
    holdOff: '保留を外す',
    holdOn: '保留する',
    archivedCount: (n: number) => `アーカイブ済み ${n} 件`,
    /** カードの名前。main のブランチがわからないとき */
    originFolder: '元のフォルダ',
    badgeWaiting: (n: number) => `対応待ち ${n}`,
    badgeBusy: (n: number) => `処理中 ${n}`,
    badgeHeld: (n: number) => `保留 ${n}`,
  },

  /** 以前のセッションの一覧（flyout） */
  flyout: {
    startedOnMain: 'main で始めたセッション',
    continuedIn: (branch: string) => `ワークツリー（${branch}）で続けている`,
    startedIn: (branch: string) => `元のフォルダ（${branch}）で始めたセッション`,
    unarchive: 'アーカイブから戻す',
    archive: 'アーカイブ',
    merged: 'マージ済み',
    archivedCard: 'アーカイブしたカード',
    unarchiveCard: 'カードをアーカイブから戻す',
    noSummary: 'まとめはありません',
    summaryHint: 'マウスを乗せると、最後のターンのまとめを表示します',
  },

  /** 設定の画面 */
  settings: {
    navAria: '設定のカテゴリ',
    categories: {
      general: '全体',
      look: '見た目',
      cards: 'カードの表示',
      notify: '通知',
      about: '情報',
    },
    groups: {
      position: '位置',
      tooltip: 'ツールチップ',
      startup: '起動',
      brightness: '明るさ',
      widget: 'ウィジェット',
      statusColors: '状態の色',
      archive: 'アーカイブ',
      order: '並び順',
      rowSize: '行の大きさ',
      rowContent: '行に出すもの',
      notifyWhen: '知らせるとき',
      sound: '音',
      windowsNotify: 'Windows の通知',
    },
    /** ツールチップの時間の見せ方 */
    tooltipDelay: {
      off: '表示しない',
      seconds: (s: number) => `${s.toFixed(1)} 秒`,
    },
    /** 項目ごとの名前と説明 */
    items: {
      edge: { label: '画面の端', description: 'ウィジェットを置く側' },
      display: { label: 'モニター' },
      openAtLogin: { label: 'Windows の起動時に開く', description: 'サインインしたときにウィジェットを開く。インストール版でだけ使える' },
      tooltipDelayMs: { label: '表示までの時間', description: 'ポインタを載せてから出るまで。右端にすると出さない' },
      theme: { label: 'テーマ', description: 'ウィジェットと設定の明るさ。システムは Windows の設定に従う' },
      backgroundOpacity: { label: '背景の不透明度', description: '0% で背景が消え、カードとタイトルバーだけが浮かぶ' },
      cardOpacity: { label: 'カードの不透明度', description: 'カードとタイトルバーの塗り。0% で枠だけになる' },
      headerShade: { label: '見出しの濃さ', description: 'カードの見出しの帯。0% で区切り線だけになる' },
      zoom: { label: '表示の拡大率', description: 'ウィジェットの文字やカードの大きさ' },
      statusColors: { label: '状態の色', description: 'アイコンと帯の色。ライトとダークで同じ色を使う' },
      mainArchiveMinutes: {
        label: '元のフォルダを自動でアーカイブ',
        description: '待機になってからこの時間が過ぎたセッションを隠す。デスクトップのアーカイブには影響しない',
      },
      projectOrder: { label: 'プロジェクト', description: 'カードの並び。固定は名前順' },
      worktreeOrder: { label: 'ワークツリー', description: 'プロジェクトの中のカードの並び。固定は元のフォルダを先頭に、あとは名前順' },
      sessionOrder: { label: 'セッション', description: 'カードの中の行の並び。固定は新しく作ったものが上' },
      rowPadding: { label: '上下の余白', description: 'セッションの行の上と下の余白' },
      showUpdated: { label: '更新日時', description: '2 行目の「◯分前」' },
      showState: { label: '状態の文字', description: '2 行目の「処理中」「許可待ち」など' },
      showContext: { label: 'コンテキスト', description: '2 行目の使用率（「12%」）。上限がわからないモデルはトークン数' },
      notifyWaiting: { label: '対応待ちになったとき', description: '許可や回答を待っているとき' },
      notifyDone: { label: '完了したとき', description: '処理中から待機になったとき。Claude 本体の通知と重なることがある' },
      muteWhenOpen: { label: '開いているセッション', description: 'Claude が前面にあり、そのセッションを開いているとき' },
      sound: { label: '音を鳴らす' },
      soundType: { label: '音の種類', description: '対応待ちは高め、完了は低めの音になる' },
      soundVolume: { label: '音量' },
      toast: { label: 'トースト通知', description: 'クリックするとそのセッションを開く。音は上の「音」の設定に従う' },
      flash: { label: 'タスクバーの点滅', description: '3 秒ほどで止まる。ウィジェットが前面にあるときは点滅しない' },
    },
    /** 選択肢の文字 */
    options: {
      show: '表示',
      hide: '非表示',
      notify: '知らせる',
      noNotify: '知らせない',
      orderFixed: '固定',
      orderRecent: '更新日時',
      orderPriority: '優先度',
      left: '左',
      right: '右',
      open: '開く',
      noOpen: '開かない',
      themeSystem: 'システム',
      themeLight: 'ライト',
      themeDark: 'ダーク',
      minutes: (n: number) => `${n} 分`,
      hours: (n: number) => `${n} 時間`,
      never: 'しない',
      ring: '鳴らす',
      noRing: '鳴らさない',
      soundChime: 'チャイム',
      soundBell: 'ベル',
      soundPop: 'ポン',
      showToast: '出す',
      noToast: '出さない',
      flash: '点滅させる',
      noFlash: '点滅させない',
    },
    preview: '試聴',
    /** 状態の色 */
    colors: {
      busy: { label: '処理中', description: 'Claude が作業している' },
      waiting: { label: '対応待ち', description: '許可や回答など、操作を待っている' },
      idle: { label: '待機中', description: '次の指示を待っている。完了したときの帯もこの色' },
      held: { label: '保留', description: 'あとで再開するために止めている。状態のアイコンを押して付け外しする' },
      stopped: { label: '停止中', description: '動いていないセッション' },
      previewAria: 'ウィジェットの見本',
      resetAll: 'すべて既定に戻す',
      reset: '既定に戻す',
      custom: '自由に選ぶ',
      customAria: (state: string) => `${state}の色を自由に選ぶ`,
      choicesAria: (state: string) => `${state}の色の候補`,
      currentAria: (state: string, color: string) => `${state}の色：${color}`,
    },
    /** 状態の色の見本に並べる行の名前 */
    previewRows: {
      busy: '検索の結果を並べ替える',
      permission: 'コマンドを動かす許可を待つ',
      input: '質問への回答を待つ',
      idle: '設定画面の文言を直す',
      held: 'ほかのブランチのマージを待つ',
      stopped: '古いブランチを片付ける',
    },
    /** 「情報」のカテゴリ */
    about: {
      app: 'このアプリ',
      version: 'バージョン',
      data: '読み取っているデータ',
      folder: 'フォルダ',
      readOnly: '読むだけで、書き換えはしません',
      settingsFile: '設定の保存先',
      file: 'ファイル',
    },
  },
} as const;

/** 文言の形。値の文字は問わず、キーと関数の引数だけをそろえる */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { readonly [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof ja>;
