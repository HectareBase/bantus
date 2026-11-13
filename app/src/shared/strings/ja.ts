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

  /** 右クリックのメニュー（カードの見出しとウィジェットのタイトル） */
  menu: {
    openInExplorer: 'エクスプローラーで開く',
    openInTerminal: 'ターミナルで開く',
    copySessionId: 'ID をコピー',
    quit: 'アプリを終了',
  },

  /** 設定の「モニター」の選択肢 */
  monitor: {
    primary: 'メインのモニター',
    other: (n: number, width: number, height: number) => `モニター ${n}（${width}×${height}）`,
  },

  /** 自動の切り替え（self-update）のお知らせ */
  update: {
    reinstall: '依存パッケージが変わりました。npm run setup を実行してから再起動してください',
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
    /** 待機中で、バックグラウンドの作業が動いている（docs/research/session-status.md） */
    background: 'バックグラウンドで作業中',
    /** 処理中か対応待ちから、ターンを終えずにプロセスが止まった（停止中のうち、ウィジェットが動いている間に見たもの） */
    interrupted: '中断',
    /** 知らない waitingFor（「対応待ち（その他）」） */
    waitingOther: 'その他',
    /** waitingFor がないとき */
    unknown: '不明',
    held: '保留',
    /** 対応待ちと、その理由（通知バナーの本文、以前のセッションの一覧） */
    waitingWithReason: (reason: string) => `対応待ち（${reason}）`,
  },

  /** 経過時間 */
  time: {
    justNow: 'たった今',
    minutesAgo: (n: number) => `${n} 分前`,
    hoursAgo: (n: number) => `${n} 時間前`,
    daysAgo: (n: number) => `${n} 日前`,
    heldJustNow: '保留したばかり',
    /** 保留の札（行とカードの 2 段目）で、1 分たつまで。「保留したばかり」は長く、狭い幅でメモの枠を押し出すため短くする */
    heldJustNowShort: '保留',
    heldMinutes: (n: number) => `保留 ${n} 分`,
    heldHours: (n: number) => `保留 ${n} 時間`,
    heldDays: (n: number) => `保留 ${n} 日`,
    /** 処理中の行の 2 行目。今のターンが始まってからの経過 */
    busyJustNow: '始めたばかり',
    busyMinutes: (n: number) => `${n} 分経過`,
    /** 1 時間を超えたら。m が 0 なら分を省く */
    busyHours: (h: number, m: number) => (m ? `${h} 時間 ${m} 分` : `${h} 時間`),
  },

  /** ツールチップの行 */
  tooltip: {
    worktree: (branch: string) => `ワークツリー：${branch}`,
    origin: (branch: string) => `メインの作業フォルダ：${branch}`,
    /** ワークツリーのカードの見出し。遅れと未マージを比べている先 */
    base: (branch: string) => `分岐元：${branch}`,
    waiting: (reason: string) => `対応待ち：${reason}`,
    /** 待機中で、バックグラウンドの作業が動いているとき。n は作業の数 */
    background: (n: number) => `バックグラウンドで作業中：${n} 件（終わると Claude が続けます）`,
    /** 処理中のタスクリストの進み具合（状態の札の中の棒）。n は今の手順の番号、total は手順の数。棒の aria-label にも使う */
    plan: (n: number, total: number) => `タスクリスト：手順 ${n}/${total}`,
    needsAction: (what: string) => `次にすること：${what}`,
    unknownBranch: '（ブランチ不明）',
    contextPercent: (pct: number, tokens: string, window: string) => `コンテキスト：${pct}%（${tokens} / ${window}）`,
    contextUnknownWindow: (tokens: string, model?: string) => `コンテキスト：${tokens}（上限不明${model ? `：${model}` : ''}）`,
  },

  /** コミットされていない変更（docs/design/git-changes.md） */
  changes: {
    merged: 'マージ済み',
    /** 分岐元ではなく main（メインの作業フォルダのブランチ）に入っていたとき。base は分岐元（わからなければ undefined） */
    mergedInto: (into: string, base?: string) => (base ? `${into} にマージ済み（${base} には未マージ）` : `${into} にマージ済み`),
    changed: (n: number) => `変更 ${n}`,
    untracked: (n: number) => `未追跡 ${n}`,
    /** 内訳（「変更 2」「未追跡 1」）を並べるときの区切り */
    separator: '・',
    uncommitted: (parts: string) => `未コミットの変更：${parts}`,
    aheadOfBase: (n: number) => `未マージのコミット：${n}`,
    /** 比べている分岐元がわかるとき */
    aheadOfNamedBase: (base: string, n: number) => `${base} に未マージのコミット：${n}`,
    unpushed: (n: number) => `push していないコミット：${n}`,
    behind: (n: number) => `元のブランチからの遅れ：${n}`,
    /** 比べている分岐元がわかるとき。メインの作業フォルダの追跡するブランチ（`origin/main` など）にも使う */
    behindNamed: (base: string, n: number) => `${base} からの遅れ：${n}`,
  },

  /** 通知バナー（Windows のトースト通知）の本文 */
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
    originFolder: 'メインの作業フォルダ',
    /** 一覧の分岐元の行のツールチップ */
    branchedFromTip: (branch: string, mainBranch: string) =>
      `分岐元：${branch}\n遅れと未マージのコミットは、このブランチと比べている（メインの作業フォルダは ${mainBranch}）`,
    badgeWaiting: (n: number) => `対応待ち ${n}`,
    badgeBusy: (n: number) => `処理中 ${n}`,
    badgeHeld: (n: number) => `保留 ${n}`,
    /** タイトルバーの PC 全体の使用率。ラベルは短い英字のまま */
    cpuLabel: 'CPU',
    memLabel: 'MEM',
    cpuTip: (pct: number) => `CPU ${pct}%`,
    memTip: (used: string, total: string, pct: number) => `MEM ${used} / ${total} GB（${pct}%）`,
  },

  /** ウィンドウの切り替え（ウィジェットの一番下の帯。docs/design/window-switcher.md） */
  switcher: {
    aria: 'ウィンドウの切り替え',
    /** 最小化しているウィンドウのツールチップ。title はウィンドウのタイトル */
    minimized: (title: string) => `${title}\n最小化しています`,
    /** 今前面にあるウィンドウのツールチップ */
    front: (title: string) => `${title}\n前面にあります`,
    /** ほかのウィンドウの後ろにあるウィンドウのツールチップ */
    behind: (title: string) => `${title}\nほかのウィンドウの後ろにあります`,
    /** 帯に入りきらないウィンドウをまとめたボタンのツールチップ */
    more: (n: number) => `ほかのウィンドウ ${n} 件`,
  },

  /** HTML ビューア（ウィジェットの下。docs/design/html-viewer.md） */
  viewer: {
    aria: 'HTML ビューア',
    resize: 'ドラッグで高さを変える。ダブルクリックで自動に戻す',
    reload: '再読み込みする',
    openExternal: 'ブラウザーで開く',
    collapse: '畳む',
    expand: '広げる',
    /** 開いているセッションがまだないとき */
    noSession: '開いているセッションがありません',
    noPath: '設定でファイルの場所を指定してください',
    noDir: 'このセッションでは表示できません',
    missing: 'ファイルがありません',
    archived: 'このカードはアーカイブしています',
  },

  /** 以前のセッションの一覧（flyout） */
  flyout: {
    startedOnMain: 'main で始めたセッション',
    continuedIn: (branch: string) => `ワークツリー（${branch}）で続けている`,
    /** 起点の行のツールチップ。folder はメインの作業フォルダの場所。分岐元と取り違えないよう、ブランチ名は出さない */
    startedIn: (folder: string) => `メインの作業フォルダで始めたセッション\n${folder}`,
    startedInUnknown: 'メインの作業フォルダで始めたセッション',
    /** タイムラインの根（分岐元）の下の段 */
    baseRoot: '分岐元',
    /** 分岐元ではなく main に入ってマージ済みにしたとき */
    baseRootMerged: (into: string) => `分岐元（${into} にマージ済み）`,
    /** マージ済みのカードの見出しのツールチップ。分岐元ではなく main に入っていたとき */
    mergedInto: (into: string) => `${into} にマージ済み`,
    unarchive: 'アーカイブから戻す',
    archive: 'アーカイブ',
    merged: 'マージ済み',
    archivedCard: 'アーカイブしたカード',
    unarchiveCard: 'カードをアーカイブから戻す',
    noSummary: 'まとめはありません',
    summaryHint: 'マウスを乗せると、最後のターンのまとめを表示します',
  },

  /** カードの見出しの git の印を押したときに開く詳細（renderer/flyout-git.ts、docs/design/git-detail.md） */
  gitDetail: {
    /** 印の読み上げ名 */
    openAria: 'git の詳細を開く',
    loading: '読み込んでいます…',
    failed: 'git の情報を読めませんでした',
    /** ブランチ名がわからないとき（HEAD がブランチを指していない） */
    detached: 'ブランチなし',
    merged: 'マージ済み',
    /** 見出しの、今のブランチと分岐元の間の印の読み上げ名 */
    fromBase: '分岐元',
    /** 見出しの札のツールチップ */
    behind: (upstream: string, n: number) => `${upstream} からの遅れ：${n}`,
    uncommitted: 'コミットしていない変更',
    /** コミットしていない変更の 2 行目 */
    uncommittedParts: (changed: number, untracked: number) => `変更 ${changed}・未追跡 ${untracked}`,
    /** HEAD の行のツールチップの印 */
    head: '今のコミット（HEAD）',
    /** コミットの行のツールチップの最後の行 */
    copyHint: 'クリックで ID をコピー',
    /** 行を押して ID を写したあと、2 行目に少しのあいだ出す */
    copied: 'ID をコピーしました',
    /** たたんだコミット。押すと全部出す */
    more: (n: number) => `ほか ${n} 件`,
    expand: 'すべて表示',
    /** 上限で切ったとき、並べていない分 */
    beyondLimit: (n: number, limit: number) => `ほかに ${n} 件（表示は ${limit} 件まで）`,
    forkHere: 'ここから分岐',
    /** メインのカードで、追跡するブランチの所（一番下の ◇） */
    pushedHere: 'ここまで push 済み',
    /** 分岐点から分岐元が先に進んだ件数 */
    baseAhead: (n: number) => `その後 ${n} 件進んでいる`,
    /** マージ済みのとき、一番上の ◇ の 2 行目 */
    mergedHere: 'ここにマージ済み',
    /** 下の段（乗せていないとき） */
    totalAhead: (base: string, n: number) => `${base} にないコミット：${n} 件`,
    totalMerged: (n: number) => `マージしたコミット：${n} 件`,
    totalRecent: (n: number) => `最近のコミット：${n} 件`,
    totalUnpushed: (n: number) => `push していないコミット：${n} 件`,
    noCommits: (base: string) => `${base} にないコミットはありません`,
    hint: 'マウスを乗せると、コミットの本文を表示します',
    noBody: '本文はありません',
    /** マージコミットの 2 行目の札 */
    mergeTag: 'マージ',
    /** 分岐元を取り込んだマージの 1 行目 */
    mergeOf: (name: string) => `${name} を取り込み`,
    /** 分岐元を取り込んだマージの 2 行目に足す（count は「3」や「3+」） */
    baseCommits: (base: string, count: string) => `${base} の ${count} コミット`,
    /** マージに乗せたときの下の段（count は「3」や「3+」） */
    mergeSummary: (name: string, count: string) => `${name} を取り込み · ${count} コミット`,
    /** 分岐元を取り込んだマージに乗せたときの下の段 */
    baseNotCounted: 'このブランチの作業には数えない',
    /** マージの取り込んだコミットを開け閉めするトグル */
    showMerged: '取り込んだコミットを表示',
    hideMerged: '取り込んだコミットを隠す',
  },

  /** 設定の画面 */
  settings: {
    navAria: '設定のカテゴリ',
    categories: {
      general: '一般',
      look: 'デザイン',
      cards: 'カードの表示',
      notify: '通知',
      git: 'git',
      viewer: 'HTML ビューア',
      about: 'このアプリについて',
    },
    groups: {
      position: '位置',
      tooltip: 'ツールチップ',
      startup: '起動',
      performance: 'パフォーマンス',
      titleBar: 'タイトルバー',
      switcher: 'ウィンドウの切り替え',
      theme: 'テーマ',
      widget: 'ウィジェット',
      statusColors: '状態の色',
      archive: 'アーカイブ',
      order: '並び順',
      rowSize: '行の大きさ',
      rowContent: '行に表示する項目',
      fetch: 'リモートの取得',
      changes: '変更の数',
      notifyWhen: '通知するタイミング',
      sound: '音',
      windowsNotify: 'Windows の通知',
      viewerShow: '表示',
      viewerFile: 'ファイル',
      viewerLook: '見た目',
    },
    /** ツールチップの時間の見せ方 */
    tooltipDelay: {
      off: '表示しない',
      seconds: (s: number) => `${s.toFixed(1)} 秒`,
    },
    /** 項目ごとの名前と説明 */
    items: {
      edge: { label: '画面の端', description: 'ウィジェットを置く側' },
      display: { label: 'モニター', description: '外部モニターのつなぎ方ごとに覚える' },
      openAtLogin: { label: 'Windows の起動時に開く', description: 'サインインしたときにウィジェットを開く。インストール版でだけ使える' },
      hardwareAcceleration: {
        label: 'ハードウェアアクセラレーション',
        description: 'GPU で描く。オンにするとメモリが 100 MB ほど増える。切り替えると Bantus が再起動する',
      },
      tooltipDelayMs: { label: '表示までの時間', description: 'マウスポインターを合わせてから出るまで。右端にすると表示しない' },
      theme: { label: '配色', description: 'ウィジェットと設定の明るさ。システムは Windows の設定に従う' },
      island: { label: '表示形式', description: 'ベゼル：画面の縁の黒とつながる帯で表示する。フロート：デスクトップの上に浮いたパネルで表示し、背景とカードの透け具合を変えられる' },
      islandRadius: { label: '角の丸み', description: '帯と画面の縁がつながる角の丸みの大きさ' },
      islandLine: { label: '縁の太さ', description: '帯の内側の端に引く黒い線の太さ。最前面に固定しているときは、画面の残りの 3 辺の線も同じ太さにする' },
      backgroundOpacity: { label: '背景の不透明度', description: '0% で背景が消え、カードとタイトルバーだけが浮かぶ' },
      cardOpacity: { label: 'カードの不透明度', description: 'カードとタイトルバーの塗り。0% で枠だけになる' },
      headerShade: { label: '見出しの濃さ', description: 'カードの見出しの帯。0% で区切り線だけになる' },
      activeHighlight: { label: '開いている行の濃さ', description: 'デスクトップで今開いているセッションの行の塗りと斜線。50% が標準、0% で塗らない' },
      zoom: { label: '表示の拡大率', description: 'ウィジェットの文字やカードの大きさ' },
      statusColors: { label: '状態の色', description: 'アイコンと帯の色。ライトとダークで同じ色を使う' },
      motion: {
        label: 'アニメーション効果',
        description: '控えめにすると回転や点滅を止め、状態を色と枠で示す。CPU の負担が減る。並べ替えの動きは残す',
      },
      mainArchiveMinutes: {
        label: 'メインの作業フォルダを自動でアーカイブ',
        description: '待機になってからこの時間が過ぎたセッションを隠す。デスクトップのアーカイブには影響しない',
      },
      projectOrder: { label: 'プロジェクト', description: 'カードの並び' },
      worktreeOrder: { label: 'ワークツリー', description: 'プロジェクトの中のカードの並び。名前順では、メインの作業フォルダを先頭にする' },
      sessionOrder: { label: 'セッション', description: 'カードの中の行の並び。作成順では、新しく作ったものが上' },
      rowPadding: { label: '上下の余白', description: 'セッションの行の上と下の余白' },
      showUpdated: { label: '更新日時', description: '2 行目の「◯分前」（処理中は「◯分経過」）' },
      showState: { label: '状態の文字', description: '2 行目の「処理中」「許可待ち」など' },
      showSystemUsage: { label: 'CPU とメモリ', description: 'PC 全体の使用率を表示する' },
      showWindowSwitcher: {
        label: 'ウィンドウのアイコンを表示する',
        description: 'ウィジェットと同じモニターにある Claude 以外のウィンドウを、一番下に並べる。アイコンを押すと、そのウィンドウを前面に出す',
      },
      showContext: { label: 'コンテキスト', description: '2 行目の使用率（「12%」）。上限がわからないモデルはトークン数' },
      gitFetch: {
        label: '定期的に取得する',
        description: 'git fetch でリモートのブランチを取ってくる。メインの作業フォルダの遅れと、GitHub でマージしたワークツリーがわかる。作業中のファイルとローカルのブランチには触れない',
      },
      gitFetchMinutes: { label: '間隔', description: 'リポジトリごとに、最後に試してから数える' },
      gitFetchNow: { label: '今すぐ取得', description: '表示しているカードのリポジトリを取得する', button: '取得' },
      showChanges: { label: 'カードに変更の数を表示する', description: '見出しの右の、変更、未追跡、コミットの数' },
      countUntracked: { label: '未追跡のファイルを数える', description: 'オフにすると、大きなリポジトリで調べるのが速くなる' },
      notifyWaiting: { label: '対応待ちになったとき', description: '許可や回答を待っているとき' },
      notifyDone: { label: '完了したとき', description: '処理中から待機になったとき。Claude 本体の通知と重なることがある' },
      muteWhenOpen: { label: '開いているセッションは通知しない', description: 'Claude が前面にあり、そのセッションを開いているとき' },
      sound: { label: '音を鳴らす' },
      soundType: { label: '音の種類', description: '対応待ちは高め、完了は低めの音になる' },
      soundVolume: { label: '音量' },
      toast: { label: '通知バナー', description: '画面の隅に出る Windows の通知。クリックするとそのセッションを開く。音は上の「音」の設定に従う' },
      flash: { label: 'タスクバーの点滅', description: '3 秒ほどで止まる。ウィジェットが前面にあるときは点滅しない' },
      viewerEnabled: { label: 'HTML を表示する', description: 'カードの下に、今開いているセッションの作業フォルダにある HTML ファイルを表示する' },
      viewerPath: {
        label: 'ファイルの場所',
        description: '作業フォルダから見た相対パス。すべてのリポジトリで共通',
        placeholder: 'docs/index.html',
      },
      viewerAutoReload: { label: '変更時に自動で再読み込み', description: 'ファイルが書き換わったら、スクロールの位置を保ったまま再読み込みする' },
      viewerZoom: { label: '表示の拡大率', description: 'HTML の文字の大きさ。ウィジェットの拡大率とは別に決める' },
      viewerAutoHeight: { label: 'HTML の高さ', description: '自動では、カードの下の空きを HTML で埋める。境目をドラッグすると手動になる' },
    },
    /** ファイルの場所を受け付けない理由（入力欄の下に出す） */
    viewerPathProblems: {
      absolute: '絶対パスは使えません。作業フォルダから見た相対パスで書いてください',
      outside: '作業フォルダの外は指定できません',
      extension: '.html か .htm のファイルを指定してください',
      invalid: 'ファイル名に使えない文字や形があります',
    },
    /** 選択肢の文字 */
    options: {
      on: 'オン',
      off: 'オフ',
      orderName: '名前順',
      orderCreated: '作成順',
      orderRecent: '更新順',
      orderPriority: '優先度順',
      lookBezel: 'ベゼル',
      lookFloat: 'フロート',
      left: '左',
      right: '右',
      motionFull: '標準',
      motionSubtle: '控えめ',
      themeSystem: 'システム',
      themeLight: 'ライト',
      themeDark: 'ダーク',
      minutes: (n: number) => `${n} 分`,
      hours: (n: number) => `${n} 時間`,
      never: 'しない',
      soundChime: 'チャイム',
      soundBell: 'ベル',
      soundPop: 'ポン',
      fitHeight: '自動',
      manualHeight: '手動',
    },
    /** 「今すぐ取得」の横に出す、取得の様子 */
    fetchStatus: {
      off: '定期的な取得はオフです',
      running: '取得しています…',
      never: 'まだ取得していません',
      last: (ago: string) => `最後の取得：${ago}`,
      failed: (repo: string, kind: string) => `${repo}：${kind}`,
      kinds: {
        auth: '認証に失敗（止めています。もう一度押すと試します）',
        lock: 'ロックで失敗（次の回に試します）',
        other: '失敗（次の回に試します）',
        offline: '通信できません',
      },
    },
    preview: 'テスト',
    /** 状態の色 */
    colors: {
      busy: { label: '処理中', description: 'Claude が作業している。バックグラウンドで作業中のときもこの色' },
      waiting: { label: '対応待ち', description: '許可や回答など、操作を待っている' },
      idle: { label: '待機中', description: '次の指示を待っている。完了したときの帯もこの色' },
      held: { label: '保留', description: 'あとで再開するために止めている。状態のアイコンを押して付け外しする' },
      stopped: { label: '中断', description: '処理中や対応待ちのまま、プロセスが止まっている。ただ止まっているだけのセッションは待機中の色' },
      previewAria: 'ウィジェットの見本',
      resetAll: 'すべて既定に戻す',
      reset: '既定に戻す',
      custom: 'カスタム',
      customAria: (state: string) => `${state}の色をカスタムで選ぶ`,
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
      stopped: 'テストを流して結果を見る',
    },
    /** 「このアプリについて」のカテゴリ */
    about: {
      app: 'バージョン情報',
      version: 'バージョン',
      data: '参照しているデータ',
      folder: 'フォルダ',
      readOnly: '読み取り専用',
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
