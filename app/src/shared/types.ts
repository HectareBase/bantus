// メインプロセスと画面の両方で使う型

import type { ArchiveMark, Settings } from './settings';

/** 表示上の状態。並び順もこの順（docs/research/session-status.md） */
export type SessionState = 'waiting' | 'busy' | 'idle' | 'stopped';

export interface SessionView {
  /** `local_` から始まる ID。claude:// リンクに使う */
  id: string;
  title: string;
  /** カードの目印。リポジトリのフォルダ（git の情報がなければ元の作業フォルダ）を小文字にしたもの */
  repoKey: string;
  /** カードの名前（リポジトリのフォルダ名） */
  repoName: string;
  /** メインの作業場所のブランチ名（`.git/HEAD` から。わからなければ undefined） */
  mainBranch?: string;
  /** ワークツリーのときだけ。小見出しの目印と表示名 */
  worktree?: {
    key: string;
    /** 短くした表示名（`claude/` と末尾の英数字を省く） */
    label: string;
    /** 元のブランチ名（ツールチップ用） */
    branch: string;
  };
  /** ワークツリーを作った元のブランチ（`sourceBranch`。なければ元のフォルダのブランチ）。遅れとマージ済みを調べるのに使う */
  baseBranch?: string;
  /** 別のセッションから作られたときの、元のセッションの ID（`spawnedFrom.sessionId`。サイドチャットは除く） */
  spawnedFrom?: string;
  /** 最後のターンのまとめの文章（`turnWrapUp.description`）。一覧の下の段に出す */
  summary?: string;
  /** git status を調べる作業フォルダ（git 管理でなければ undefined） */
  workDir?: string;
  /** 作業フォルダのコミットされていない変更。まだ調べていない、または調べられなかったときは undefined */
  changes?: GitChanges;
  state: SessionState;
  /** state が waiting のときの理由（`permission prompt` など） */
  waitingFor?: string;
  /** 最後のターンのまとめで「対応が必要」とされた内容 */
  needsAction?: string;
  /** 最後のターンのまとめ（ツールチップ用） */
  detail?: string;
  /** 作った時刻（Unix ミリ秒）。わからなければ 0 */
  createdAt: number;
  /** ワークツリーごとの通し番号（作った順に 1 から。アーカイブ済みも数える）。表示のためだけに使う */
  seq?: number;
  /** 最後に動きがあった時刻（Unix ミリ秒） */
  lastActivityAt: number;
  /** デスクトップで今開いているセッション（`lastFocusedAt` が一番新しいもの）だけ true */
  focused?: boolean;
  /** デスクトップで最後に開いた時刻（`lastFocusedAt`、Unix ミリ秒）。サイドチャットで開いたときは親の値にする。開いたことがなければ省く */
  focusedAt?: number;
}

/** `git status` から数えた件数（src/main/git-status.ts） */
export interface GitChanges {
  /** 変更したファイル（ステージしたものも含む） */
  changed: number;
  /** 未追跡のファイル（.gitignore に入っているものは除く） */
  untracked: number;
  /** まだ push していないコミット（追跡するブランチがなければ 0） */
  ahead: number;
  /** 元のブランチ（baseBranch）にあって、まだ取り込んでいないコミット。元のブランチがわからなければ 0 */
  behind: number;
  /** 元のブランチにマージコミットで入った（docs/design/worktree-cards.md） */
  merged: boolean;
  /** 作業フォルダがもうない（ワークツリーを消した） */
  gone?: boolean;
}

export interface WidgetApi {
  onSessions(listener: (sessions: SessionView[]) => void): void;
  /** ウィジェットの見た目に関わる設定（置く側、不透明度、並び順、アーカイブ）と、通知の設定が変わったとき */
  onLayout(listener: (layout: WidgetLayout) => void): void;
  /** 起動時に今の見た目の設定を取りに行く（起動直後に送られた onLayout を取りこぼさないため） */
  getLayout(): Promise<WidgetLayout>;
  /** 巡回のショートカットが押されたとき。開く先は画面側が決める（未確認の帯を画面側で覚えているため） */
  /** ショートカットが押された。claudeInFront は Claude のウィンドウが前面にあったか */
  onCycle(listener: (claudeInFront: boolean) => void): void;
  openSession(id: string): void;
  /** true にすると、ウィジェットへのクリックを後ろのウィンドウへ通す（背景が 0% のとき、何もない所の上で使う） */
  setClickThrough(through: boolean): void;
  /** 内側の端のドラッグで幅を変える。move のたびにメインプロセスがカーソルの位置から幅を決め、end で保存する */
  resizeStart(): void;
  resizeMove(): void;
  resizeEnd(): void;
  openSettings(): void;
  /** 最前面への固定を切り替える。保存され、onLayout で画面に戻ってくる */
  setPinned(pinned: boolean): void;
  /** セッションのアーカイブの印を変える（null で外して自動の決まりに戻す）。保存され、onLayout で画面に戻ってくる */
  setArchive(id: string, mark: ArchiveMark | null): void;
  /** カードのアーカイブの印を変える */
  setCardArchive(key: string, mark: ArchiveMark | null): void;
  /** 重なりに乗った・一覧を開くとき。めくれと一覧のウィンドウ（flyout.html）に出す */
  showFlyout(request: FlyRequest): void;
  /** 開いている（めくれを出している）一覧の中身だけを差し替える */
  updateFlyout(key: string, content: FlyContent, count: number): void;
  /** めくれの前に重なりから外れたとき。めくれを出していれば消す */
  leaveFlyout(key: string): void;
  /** 一覧の中の操作（行を押した、トグルを押した） */
  onFlyAction(listener: (action: FlyAction) => void): void;
  /** めくれ・一覧の出し入れ。key は出しているもの（消えたら undefined）、open は一覧を開いているか */
  onFlyState(listener: (key: string | undefined, open: boolean) => void): void;
  /** タスクバーを数秒だけ点滅させる。知らせる変化があったときに使う。ウィジェットが前面なら何もしない */
  flashTaskbar(): void;
  /** Claude のウィンドウが前面にあるか。調べられなかったときは false（知らせないより、知らせるほうを選ぶ） */
  isClaudeInFront(): Promise<boolean>;
  /** Windows の通知（トースト）を出す。クリックすると onToastClick に届く */
  showToast(toast: ToastRequest): void;
  /** トーストがクリックされたとき。開くのは画面側（未確認の帯を消すため） */
  onToastClick(listener: (id: string) => void): void;
  /** ツールチップを出す。rect は基準の要素（ウィジェットの中の座標）。ツールチップは別のウィンドウで、ウィジェットの外に出る */
  showTip(text: string, rect: TipRect): void;
  hideTip(): void;
}

export interface ToastRequest {
  /** クリックで開くセッションの ID */
  id: string;
  title: string;
  body: string;
}

export interface TipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** ツールチップのウィンドウ（tip.html）の API */
export interface TipApi {
  /** 中身を差し替える。画面側は大きさを測って reportSize で返す */
  onText(listener: (text: string) => void): void;
  /** 置き終えたら true、消すときは false。薄くするアニメーションに使う */
  onVisible(listener: (visible: boolean) => void): void;
  reportSize(width: number, height: number): void;
}

// ---- めくれと一覧のウィンドウ（flyout） ----

/** 一覧の 1 行 */
export interface FlyItem {
  id: string;
  title: string;
  state: SessionState;
  waitingFor?: string;
  /** Bantus の中でアーカイブしているか */
  archived: boolean;
  /** main で始めたセッション（起点） */
  origin: boolean;
  /** デスクトップで今開いている */
  focused: boolean;
  /** 1 つ下の行（より古いもの）とのつなぎ方。solid は spawnedFrom、dashed は時刻の順で並べただけ。一番下はなし */
  link?: 'solid' | 'dashed';
  /** 下の段（「1 時間前」など） */
  sub: string;
  /** 乗せたときに一覧の下の段に出す、最後のターンのまとめ */
  summary?: string;
}

/** マージ済み・手でアーカイブしたカード（リポジトリの見出しから開く一覧） */
export interface FlyCard {
  key: string;
  label: string;
  merged: boolean;
  items: FlyItem[];
}

export type FlyContent =
  | { kind: 'timeline'; items: FlyItem[] }
  | { kind: 'plain'; items: FlyItem[] }
  | { kind: 'cards'; cards: FlyCard[] };

export interface FlyRequest {
  /** カードの目印（リポジトリの見出しから開くときは `repo:<目印>`） */
  key: string;
  /** めくれに出す件数 */
  count: number;
  /** カード（または見出し）の位置。ウィジェットの中の座標 */
  anchor: TipRect;
  content: FlyContent;
  /** true なら、めくれを出さずにすぐ一覧を開く（リポジトリの見出し） */
  open: boolean;
}

export type FlyAction =
  | { type: 'open'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'toggle-card'; key: string };

/** めくれと一覧のウィンドウ（flyout.html）の API */
export interface FlyoutApi {
  /** 出す。side は開く向き（ウィジェットが右端なら left） */
  onShow(listener: (show: FlyShow) => void): void;
  onContent(listener: (content: FlyContent, count: number) => void): void;
  /** めくれから一覧へ変形する */
  onOpen(listener: () => void): void;
  onHide(listener: () => void): void;
  /** クリックを受け取る場所（ウィンドウの中の座標）。ほかはクリックを下へ通す */
  reportSolid(rects: TipRect[]): void;
  /** めくれが押された */
  requestOpen(): void;
  action(action: FlyAction): void;
  close(): void;
}

export interface FlyShow {
  key: string;
  side: 'left' | 'right';
  /** カードの上端と高さ（ウィンドウの中の座標） */
  top: number;
  height: number;
  count: number;
  content: FlyContent;
  open: boolean;
}

export type WidgetLayout = Pick<
  Settings,
  | 'edge' | 'backgroundOpacity' | 'cardOpacity' | 'headerShade' | 'pinned' | 'mainArchiveMinutes'
  | 'projectOrder' | 'worktreeOrder' | 'sessionOrder' | 'showUpdated' | 'archive' | 'archivedCards'
  | 'notifyWaiting' | 'notifyDone' | 'sound' | 'soundType' | 'soundVolume' | 'toast' | 'flash' | 'muteWhenOpen'
>;

export interface DisplayOption {
  id: string;
  label: string;
}

export interface AboutInfo {
  version: string;
  settingsFile: string;
  dataFolders: string[];
  /** インストール版（exe）で動いているか。false なら packagedOnly の項目を灰色にする。見本データで動かしているときも false */
  packaged: boolean;
}

export interface SettingsApi {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): void;
  onChange(listener: (settings: Settings) => void): void;
  displays(): Promise<DisplayOption[]>;
  about(): Promise<AboutInfo>;
}

declare global {
  interface Window {
    widget: WidgetApi;
    settingsApi: SettingsApi;
    tipApi: TipApi;
    flyoutApi: FlyoutApi;
  }
}
