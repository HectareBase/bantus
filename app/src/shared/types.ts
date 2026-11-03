// メインプロセスと画面の両方で使う型

import type { Settings } from './settings';

/** 表示上の状態。並び順もこの順（docs/session-status.md） */
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
}

/** `git status` から数えた件数（src/main/git-status.ts） */
export interface GitChanges {
  /** 変更したファイル（ステージしたものも含む） */
  changed: number;
  /** 未追跡のファイル（.gitignore に入っているものは除く） */
  untracked: number;
  /** まだ push していないコミット（追跡するブランチがなければ 0） */
  ahead: number;
}

export interface WidgetApi {
  onSessions(listener: (sessions: SessionView[]) => void): void;
  /** ウィジェットの見た目に関わる設定（置く側、不透明度、一覧の表示数と折りたたみ、常に表示）と、通知の設定が変わったとき */
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
  /** セッションを常に表示にするか切り替える。保存され、onLayout で画面に戻ってくる */
  setAlwaysShow(id: string, on: boolean): void;
  /** 未確認のセッションの ID を知らせる。増えたらタスクバーを点滅させ、なくなったら止める */
  setAttention(ids: string[]): void;
  /** Claude のウィンドウが前面にあるか。調べられなかったときは false（知らせないより、知らせるほうを選ぶ） */
  isClaudeInFront(): Promise<boolean>;
  /** Windows の通知（トースト）を出す。クリックすると、そのセッションを開く */
  showToast(toast: ToastRequest): void;
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

export type WidgetLayout = Pick<
  Settings,
  | 'edge' | 'backgroundOpacity' | 'cardOpacity' | 'headerShade' | 'pinned' | 'groupLimit' | 'foldScope'
  | 'projectOrder' | 'worktreeOrder' | 'sessionOrder' | 'showSeq' | 'showUpdated' | 'alwaysShow'
  | 'notifyWaiting' | 'notifyDone' | 'sound' | 'soundType' | 'soundVolume' | 'toast' | 'muteWhenOpen'
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
  }
}
