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
  /** ウィジェットの見た目に関わる設定（置く側、背景とカードの不透明度）が変わったとき */
  onLayout(listener: (layout: WidgetLayout) => void): void;
  /** 起動時に今の見た目の設定を取りに行く（起動直後に送られた onLayout を取りこぼさないため） */
  getLayout(): Promise<WidgetLayout>;
  /** 巡回のショートカットが押されたとき。開く先は画面側が決める（未確認の帯を画面側で覚えているため） */
  onCycle(listener: () => void): void;
  openSession(id: string): void;
  setCollapsed(collapsed: boolean): void;
  /** true にすると、ウィジェットへのクリックを後ろのウィンドウへ通す（背景が 0% のとき、何もない所の上で使う） */
  setClickThrough(through: boolean): void;
  /** 内側の端のドラッグで幅を変える。move のたびにメインプロセスがカーソルの位置から幅を決め、end で保存する */
  resizeStart(): void;
  resizeMove(): void;
  resizeEnd(): void;
  openSettings(): void;
  /** 最前面への固定を切り替える。保存され、onLayout で画面に戻ってくる */
  setPinned(pinned: boolean): void;
}

export type WidgetLayout = Pick<Settings, 'edge' | 'backgroundOpacity' | 'cardOpacity' | 'pinned'>;

export interface DisplayOption {
  id: string;
  label: string;
}

export interface AboutInfo {
  version: string;
  settingsFile: string;
  dataFolders: string[];
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
  }
}
